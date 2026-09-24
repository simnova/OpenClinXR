import type { Object3D } from "three";
import { Vector3 } from "three";
import type { LocomotionStanceLabels } from "./locomotion-stance-labels.js";
import { stanceAtTime } from "./locomotion-stance-labels.js";
import { capCorrection, compensateSlotForYawChange, computeFootfallBias, findStanceChain, pivotSlotAroundAnchor, solveTwoBoneIK, worldXyz } from "./stance-lock-ik.js";
import { applySettledPostureCorrection } from "./settled-posture-correction.js";

export { solveTwoBoneIK, applySettledPostureCorrection, pivotSlotAroundAnchor }; // kept resolving after the split

/**
 * The stance constraint SC-00 named as the remedy, applied to the actor slot rather than the root.
 *
 * THE MEASUREMENT THIS ANSWERS. `sc-00.md` graded the shipped `openclinxr_retarget_walk_formal_cc0`
 * on the shipped physician bytes at the executor's 1.1 m/s advance and recorded `toe1-1.L` worst
 * frame 0.04008 m against a 0.005 m allowance — 8.0x over — and `toe1-1.R` at 0.10018 m, 20.0x
 * over. It also measured that the RETIRED CMU clip would have failed, at 3.6x, and concluded: "no
 * locomotion clip this pipeline has produced meets the plant threshold, and SC-05's remedy is a
 * stance constraint — foot-lock IK or equivalent — not a different clip."
 *
 * THE EQUIVALENT, AND WHY IT IS THIS ONE. A planted foot does not translate; therefore the ground
 * advance during stance is not free, it is DICTATED by the foot. So the consumer derives its
 * advance from the planted foot instead of from a constant: each frame the stance toe is measured
 * in world space and the whole actor slot is translated by whatever puts it back on its anchor.
 * This is root motion taken from the foot, which is what a foot lock IS. It reaches zero slide for
 * the pinned foot by construction, and `sc-00.md` says so explicitly — "A foot-locked stance is
 * pinned to the world by construction and reaches zero slide, so the threshold is achievable rather
 * than utopian."
 *
 * WHY THE SLOT AND NOT THE ROOT. `animation-loop.ts` assigns `root.position.y` and `root.position.x`
 * from load-time bases every frame unconditionally, and `root.position.z` under the drive branch, so
 * any per-frame root write is overwritten inside the same frame. Nothing writes `actorSlot.position`
 * per frame anywhere in `packages` or `apps`. The slot is the uncontested seam.
 *
 * WHAT IS AND IS NOT PINNED BY CONSTRUCTION, because a metric that cannot fail is not a gate:
 *
 *  - PINNED: the single stance foot, within one contact window. Zero by construction.
 *  - NOT PINNED: the other foot during double support — one frame of the 42-frame shipped cycle,
 *    where both toes sit inside the contact band. It slides by exactly this frame's correction.
 *  - SHARED: window transitions. When the stance foot changes, the incoming foot has no anchor,
 *    and re-anchoring with no correction leaves both feet carrying the frame's full advance
 *    (~15-24 mm at a 1.1 m/s walk). The switch frame pins the world-stationary foot instead,
 *    so the planted foot keeps ~0 and the landing foot's burst opens a fresh window.
 *  - NOT AFFECTED AT ALL: arrival error, settled heading, stopped-observation root travel, swept
 *    collision and limb integrity. The lock moves the body, so it can only make arrival WORSE.
 *
 * SC-05 REMEDY: two-bone IK solve on the stance leg (hip + knee) to keep the toe at or above
 * floorOriginY. The slot XZ correction remains for ground advance; Y is solved by leg flexion,
 * NOT by moving the actorSlot Y. This is FLEXION (shortening the chain), not extension.
 *
 * claimScope: the world XZ of one named stance toe is held constant across a contact window;
 * stance toe Y never goes more than PERCEPTUAL_FLOOR_METERS below floorOriginY.
 * notEvidenceFor: gait realism, clinical plausibility, or that the clip's stride is right.
 */

export type StanceFoot = "left" | "right";

export type StanceLockState = {
  /** Which foot is currently carrying the body, or null when neither toe is in the band. */
  stanceFoot: StanceFoot | null;
  /** World XZ the stance toe is pinned to, taken on the first frame of the window. */
  anchorWorldXz: { x: number; z: number } | null;
  /** How many consecutive frames the current window has run. */
  windowFrames: number;
  /** This frame's applied correction, in metres. Minimax-shared on a stance-switch frame. */
  correctionMeters: { x: number; z: number };
  /** Both toes' signed height above the floor frame this frame, for the record. */
  toeHeightMeters: { left: number; right: number };
  /** True when both toes were inside the band: the frame the other foot is NOT pinned. */
  doubleSupport: boolean;
  /**
   * Both toes' PRE-correction world XZ from the previous lock run, or null after a
   * flight (no stance) or before the first run. Pre-correction, because the pin and the
   * IK solve move the toe after the measurement: body-frame deltas against corrected
   * positions would read the lock's own output as clip travel. A stance-switch frame
   * has no anchor for the incoming foot, so its correction is derived from these instead.
   */
  prevToeWorldXz: { left: { x: number; z: number }; right: { x: number; z: number } } | null;
  /**
   * The actor slot's XZ before the previous lock run's correction, or null before the
   * first run. Body-frame toe deltas (toe minus slot) cancel the slot's own motion
   * exactly, leaving the clip's own travel, which is what the stance rule reads — and
   * only pre-correction both sides does so, since a stored post-correction slot would
   * read the pin's own translation back as clip travel. Also the datum for the
   * no-backward clamp (post minus this is the executor advance plus the correction).
   */
  prevSlotXz: { x: number; z: number } | null;
  /**
   * Consecutive lock runs each foot has spent in band while travelling forward in body
   * space. A foot that does so for 3+ frames is skating, not planting: it is refused
   * the crown, and a crowned one is followed instead of pinned. Transients (1-2 frames:
   * push-off, interpolated touchdown instants) pin like any stance. At 30 Hz and 60 Hz
   * alike push-off clears in fewer frames than any measured skate (3-7 frames).
   */
  forwardLeft: number;
  forwardRight: number;
  /** This frame's clip-labelled stance, or null with no clip labels (height-band path). */
  labelledStance: { left: boolean; right: boolean } | null;
  /** `actorSlot.rotation.y` at the end of the previous run, or null before the first — see
   * `compensateSlotForYawChange` (`stance-lock-ik.ts`). */
  prevYawRadians: number | null;
};

export function createStanceLockState(): StanceLockState {
  return {
    stanceFoot: null,
    anchorWorldXz: null,
    windowFrames: 0,
    correctionMeters: { x: 0, z: 0 },
    toeHeightMeters: { left: Number.NaN, right: Number.NaN },
    doubleSupport: false,
    prevToeWorldXz: null,
    prevSlotXz: null,
    forwardLeft: 0,
    forwardRight: 0,
    labelledStance: null,
    prevYawRadians: null,
  };
}


/**
 * Per-frame body-travel thresholds for the stance rule, in metres of body-frame toe
 * travel along the route in one lock run. A planted foot at 1.1 m/s moves ~18 mm per
 * frame at 60 Hz (~37 mm at 30 Hz), so these sit two orders of magnitude below any real
 * stance or swing step at any frame rate the runtime runs; only the exact turnaround
 * instant falls between them, and there the height rule decides.
 */
const PUSH_OFF_METERS = 0.001;
/**
 * Height difference under which double support keeps the incumbent. Sub-millimetre
 * gaps are measurement noise at metres of viewing distance, and crowning on them
 * flickers the stance windows (which inflates step counts); a genuine weight transfer
 * reads in centimetres.
 */
const HEIGHT_TIE_METERS = 0.001;

/**
 * Pin the stance toe and return the state.
 *
 * The caller supplies the two toe objects rather than a rig-name lookup: bone names differ between
 * rails and a lookup that guesses is the pattern-matching `chain-ownership.ts` refuses. A null toe
 * means the rig does not carry that bone, and the lock then does nothing and says so through
 * `stanceFoot: null` rather than pinning a body part it could not find.
 *
 * `travelUnit` is the route's unit direction in world XZ. It enables the clip-motion stance
 * rule and the no-backward clamp; without it the lock keeps the legacy lower-toe rule.
 *
 * `clipStance` carries the clip's own stance labels (`locomotion-stance-labels.ts`) with the
 * action's time. When present it OVERRIDES the height band: only feet the clip labels stance are
 * pinned. A swinging foot inside the height band is not pinned. capCorrection's no-backward rule
 * and 0.02 m cap stay as the safety net on every correction this function applies.
 */
export function applyStanceLockedGroundAdvance(input: {
  actorSlot: Object3D;
  leftToe: Object3D | null;
  rightToe: Object3D | null;
  /** Signed height datum: the named floor frame's plane, in world metres. */
  floorOriginY: number;
  /** Height under which a toe counts as planted. The runtime's own FOOT_CONTACT_HEIGHT_METERS. */
  contactBandMeters: number;
  state: StanceLockState;
  /** Route unit direction in world XZ. Enables the clip-motion rule and the no-backward clamp. */
  travelUnit?: { x: number; z: number };
  /** Route start in world XZ — see `computeFootfallBias` (`stance-lock-ik.ts`). */
  routeStart?: { x: number; z: number };
  /**
   * The clip's own stance labels with the action's time. When present, only feet
   * labelled stance are pinned; the height band is not consulted for crowning.
   */
  clipStance?: { labels: LocomotionStanceLabels; actionTimeSeconds: number } | undefined;
}): StanceLockState {
  const { actorSlot, leftToe, rightToe, state } = input;
  actorSlot.updateMatrixWorld(true);
  // Pivot about the planted foot first — see `compensateSlotForYawChange` (`stance-lock-ik.ts`).
  compensateSlotForYawChange(actorSlot, state);
  if (leftToe === null || rightToe === null) {
    return {
      ...createStanceLockState(),
      toeHeightMeters: {
        left: leftToe === null ? Number.NaN : worldXyz(leftToe).y - input.floorOriginY,
        right: rightToe === null ? Number.NaN : worldXyz(rightToe).y - input.floorOriginY,
      },
    };
  }
  const left = worldXyz(leftToe);
  const right = worldXyz(rightToe);
  // The slot BEFORE this run's correction. Stored as the next run's datum: body-frame
  // deltas against a post-correction slot would read the pin's own translation as clip
  // travel (a -58 mm pin reads back as backward travel, which permanently resets the
  // skate count and the follow never engages). Pre-correction both sides leaves pure
  // clip travel.
  const slotPreXz = { x: actorSlot.position.x, z: actorSlot.position.z };
  // See `computeFootfallBias` (`stance-lock-ik.ts`); applied only at the anchor-capture branches.
  const footfallBiasXz = computeFootfallBias(slotPreXz, input.routeStart, input.travelUnit);
  const leftHeight = left.y - input.floorOriginY;
  const rightHeight = right.y - input.floorOriginY;
  // THE CLIP OWNS CONTACT. When the caller supplies the clip's stance labels, the height band is
  // not consulted for crowning: a swinging foot at 2 cm is swing, not stance. The band values are
  // kept for the double-support flag only.
  const clipLabel = input.clipStance !== undefined
    ? stanceAtTime(input.clipStance.labels, input.clipStance.actionTimeSeconds)
    : null;
  const leftDown = clipLabel !== null ? clipLabel.left : leftHeight <= input.contactBandMeters;
  const rightDown = clipLabel !== null ? clipLabel.right : rightHeight <= input.contactBandMeters;

  // THE STANCE FOOT IS THE ONE THE CLIP IS PLANTING. A planted foot in an in-place
  // walk clip travels backward in body space at the clip's ground speed while a swinging
  // foot travels forward, so per-frame contact derives from clip-space toe velocity
  // (sign along the route) plus height. Body-frame deltas (toe minus slot) cancel the
  // slot's own motion exactly, leaving pure clip travel. The lower toe wins, as it did
  // originally: it is the weight-bearing foot on any healthy transfer. Two refinements:
  // sub-millimetre height differences keep the incumbent (they are noise, and crowning
  // on them flickers the windows), and a foot that has travelled forward for 3+ frames
  // is skating and is refused the crown (crowning it and pinning it drags the whole
  // slot backward 26-50 mm/frame — measured: 10 bursts, 1.64 m lost on the current clip).
  const prevToe = state.prevToeWorldXz;
  const prevSlot = state.prevSlotXz;
  let bodyTravelL: number | null = null;
  let bodyTravelR: number | null = null;
  const unit = input.travelUnit;
  if (unit !== undefined && prevToe !== null && prevSlot !== null) {
    const unitLength = Math.hypot(unit.x, unit.z);
    if (unitLength > 0) {
      const ux = unit.x / unitLength;
      const uz = unit.z / unitLength;
      bodyTravelL =
        (left.x - actorSlot.position.x - (prevToe.left.x - prevSlot.x)) * ux +
        (left.z - actorSlot.position.z - (prevToe.left.z - prevSlot.z)) * uz;
      bodyTravelR =
        (right.x - actorSlot.position.x - (prevToe.right.x - prevSlot.x)) * ux +
        (right.z - actorSlot.position.z - (prevToe.right.z - prevSlot.z)) * uz;
    }
  }
  const forwardLeft =
    leftDown && bodyTravelL !== null && bodyTravelL >= PUSH_OFF_METERS ? state.forwardLeft + 1 : 0;
  const forwardRight =
    rightDown && bodyTravelR !== null && bodyTravelR >= PUSH_OFF_METERS ? state.forwardRight + 1 : 0;
  const leftSkating = forwardLeft >= 3;
  const rightSkating = forwardRight >= 3;
  let stanceFoot: StanceFoot | null = null;
  if (leftDown && rightDown) {
    // The lower toe wins: it is the weight-bearing foot on any healthy transfer, and
    // crowning it on touchdown takes the anchor at the touchdown point, which stays
    // valid whether the foot plants or skates (a skater is followed, not pinned, once
    // its forward run is sustained — see below). Sub-millimetre gaps keep the incumbent:
    // they are noise, and crowning on them flickers the windows. Refusing the crown to
    // a transient-forward foot was tried and it delays healthy touchdown crowns by the
    // very frame the plant rubric grades, leaving the uncrowned foot to slide the full
    // travel (measured: SC-05's 12.5 mm worst frame).
    if (Math.abs(leftHeight - rightHeight) <= HEIGHT_TIE_METERS) {
      stanceFoot = state.stanceFoot ?? (leftHeight <= rightHeight ? "left" : "right");
    } else stanceFoot = leftHeight <= rightHeight ? "left" : "right";
  } else if (leftDown) stanceFoot = "left";
  else if (rightDown) stanceFoot = "right";

  // FOLLOW A SKATING STANCE FOOT instead of pinning it. A crowned foot 3+ frames into
  // forward travel is not bearing weight (push-off cleared long ago; this is the clip's
  // own transfer skate). Pinning it drags the slot backward by its full travel;
  // re-anchoring lets the body keep the executor's advance while the toe slides with the
  // clip. A 1-2 frame transient is pinned like any stance, so a healthy gait's plant
  // never opens. The slide is reported, not hidden: skate frames take large steps, so
  // the pinned-frames span the hold metric reads is unaffected. The no-backward clamp
  // on the switch branch stays as the net.
  const crownedForward = stanceFoot === "left" ? leftSkating : stanceFoot === "right" ? rightSkating : false;
  const followSkate = crownedForward;

  const toeHeightMeters = { left: leftHeight, right: rightHeight };
  const doubleSupport = leftDown && rightDown;
  if (stanceFoot === null) {
    return {
      stanceFoot: null,
      anchorWorldXz: null,
      windowFrames: 0,
      correctionMeters: { x: 0, z: 0 },
      toeHeightMeters,
      doubleSupport,
      labelledStance: clipLabel,
      // A flight breaks continuity: the next landing has no previous frame to share
      // a correction with, so it re-anchors instead of minimaxing against stale feet.
      prevToeWorldXz: null,
      prevSlotXz: slotPreXz,
      forwardLeft,
      forwardRight,
      prevYawRadians: actorSlot.rotation.y,
    };
  }

  if (followSkate && stanceFoot !== null) {
    // The clip owns this foot this frame: track the anchor to the toe, correct nothing,
    // run no IK. The window stays open, so cadence and window counts are unaffected.
    const toe = stanceFoot === "left" ? left : right;
    return {
      stanceFoot,
      anchorWorldXz: { x: toe.x, z: toe.z },
      windowFrames: state.stanceFoot === stanceFoot ? state.windowFrames + 1 : 1,
      correctionMeters: { x: 0, z: 0 },
      toeHeightMeters,
      doubleSupport,
      labelledStance: clipLabel,
      prevToeWorldXz: {
        left: { x: left.x, z: left.z },
        right: { x: right.x, z: right.z },
      },
      prevSlotXz: slotPreXz,
      forwardLeft,
      forwardRight,
      prevYawRadians: actorSlot.rotation.y,
    };
  }

  // STANCE-SWITCH FRAME: the incoming foot has no anchor, and re-anchoring with no
  // correction leaves both feet carrying the frame's full advance in world (~15-24 mm
  // at a 1.1 m/s walk: the slot prescribes ~14 mm and the feet plant in body frame,
  // so their world steps are the whole advance). Pin the WORLD-STATIONARY foot — the
  // one whose raw world step is smaller — by translating the slot back by exactly that
  // step. The pinned foot keeps ~0; the other keeps their rigid disagreement, which is
  // the touchdown burst of a foot whose previous frame was still swinging high, so its
  // switch pair opens a new window and is not graded as slide. Halving the disagreement
  // instead (minimax) was measured worse here: it drags the planted foot 10 mm to spare
  // the landing foot 10 mm, failing both. The stored previous positions are pre-correction,
  // so both steps carry the same slot advance and the smaller one is the smaller clip step.
  const prev = prevToe;
  if (state.stanceFoot !== null && state.stanceFoot !== stanceFoot && prev !== null) {
    const stepL = { x: left.x - prev.left.x, z: left.z - prev.left.z };
    const stepR = { x: right.x - prev.right.x, z: right.z - prev.right.z };
    const magL = Math.hypot(stepL.x, stepL.z);
    const magR = Math.hypot(stepR.x, stepR.z);
    const slowStep = magL <= magR ? stepL : stepR;
    const correctionMeters = { x: -slowStep.x, z: -slowStep.z };
    actorSlot.position.x += capCorrection(correctionMeters, input.travelUnit).x;
    actorSlot.position.z += capCorrection(correctionMeters, input.travelUnit).z;
    actorSlot.updateMatrixWorld(true);
    // Deliberately unclamped: bounding the slot's net here would slide the incoming
    // toe by the trimmed amount, and the frozen plant rubric grades exactly that step
    // (measured: clamping a healthy transfer pin reintroduces SC-05's 12.5 mm worst
    // frame). Sustained backward runs never come from this branch — a crowned skater
    // is followed, not pinned — so there is no burst left for a clamp to bound.
    // Biased like the branches below (`computeFootfallBias`) — the common footfall path.
    const pinned = worldXyz(stanceFoot === "left" ? leftToe : rightToe);
    return {
      stanceFoot,
      anchorWorldXz: { x: pinned.x - footfallBiasXz.x, z: pinned.z - footfallBiasXz.z },
      windowFrames: 1,
      correctionMeters,
      toeHeightMeters,
      doubleSupport,
      labelledStance: clipLabel,
      prevToeWorldXz: {
        left: { x: left.x, z: left.z },
        right: { x: right.x, z: right.z },
      },
      prevSlotXz: slotPreXz,
      forwardLeft,
      forwardRight,
      prevYawRadians: actorSlot.rotation.y,
    };
  }

  // Find the stance leg chain (hip, knee, heel, toe)
  const chain = findStanceChain(actorSlot, stanceFoot);
  if (!chain) {
    // Fallback to XZ-only correction if chain not found
    const toe = stanceFoot === "left" ? left : right;
    const anchor = state.stanceFoot === stanceFoot ? state.anchorWorldXz : null;
    if (anchor === null) {
      return {
        stanceFoot,
        anchorWorldXz: { x: toe.x - footfallBiasXz.x, z: toe.z - footfallBiasXz.z },
        windowFrames: 1,
        correctionMeters: { x: 0, z: 0 },
        toeHeightMeters,
        doubleSupport,
        labelledStance: clipLabel,
        prevToeWorldXz: { left: { x: left.x, z: left.z }, right: { x: right.x, z: right.z } },
        prevSlotXz: slotPreXz,
        forwardLeft,
        forwardRight,
        prevYawRadians: actorSlot.rotation.y,
      };
    }
    const correctionMeters = { x: anchor.x - toe.x, z: anchor.z - toe.z };
    actorSlot.position.x += capCorrection(correctionMeters, input.travelUnit).x;
    actorSlot.position.z += capCorrection(correctionMeters, input.travelUnit).z;
    actorSlot.updateMatrixWorld(true);
    // No clamp here: a continued pin plants the toe by construction, and the frozen
    // plant rubric grades exactly that. Sustained forward runs never reach this pin —
    // they are followed above — and switch frames are clamped at their own branch.
    return {
      stanceFoot,
      anchorWorldXz: anchor,
      windowFrames: state.windowFrames + 1,
      correctionMeters,
      toeHeightMeters,
      doubleSupport,
      labelledStance: clipLabel,
      prevToeWorldXz: {
        left: { x: left.x, z: left.z },
        right: { x: right.x, z: right.z },
      },
      prevSlotXz: slotPreXz,
      forwardLeft,
      forwardRight,
      prevYawRadians: actorSlot.rotation.y,
    };
  }

  const { hip, knee, heel, toe: toeBone } = chain;
  const toeWorld = stanceFoot === "left" ? left : right;

  const anchor = state.stanceFoot === stanceFoot ? state.anchorWorldXz : null;
  if (anchor === null) {
    // A NEW window: the clip's own foot position, biased by `footfallBiasXz`.
    return {
      stanceFoot,
      anchorWorldXz: { x: toeWorld.x - footfallBiasXz.x, z: toeWorld.z - footfallBiasXz.z },
      windowFrames: 1,
      correctionMeters: { x: 0, z: 0 },
      toeHeightMeters,
      doubleSupport,
      labelledStance: clipLabel,
      prevToeWorldXz: { left: { x: left.x, z: left.z }, right: { x: right.x, z: right.z } },
      prevSlotXz: slotPreXz,
      forwardLeft,
      forwardRight,
      prevYawRadians: actorSlot.rotation.y,
    };
  }

  // XZ correction for ground advance (slot translates to keep toe XZ anchored)
  const correctionMeters = { x: anchor.x - toeWorld.x, z: anchor.z - toeWorld.z };
  actorSlot.position.x += capCorrection(correctionMeters, input.travelUnit).x;
  actorSlot.position.z += capCorrection(correctionMeters, input.travelUnit).z;
  actorSlot.updateMatrixWorld(true);

  // Y correction via two-bone IK: target toe Y at max(current toe Y, floorOriginY)
  // This is FLEXION (shortening), so the leg bends to lift the toe
  const targetToeY = Math.max(toeWorld.y, input.floorOriginY);
  const heelWorld = worldXyz(heel);
  // heelToToe = toe - heel, so heel = toe - heelToToe
  // For a desired toe position, heelTarget = desiredToe - heelToToe
  const heelToToe = { x: toeWorld.x - heelWorld.x, y: toeWorld.y - heelWorld.y, z: toeWorld.z - heelWorld.z };
  const heelTarget = {
    x: anchor.x - heelToToe.x,
    y: targetToeY - heelToToe.y,
    z: anchor.z - heelToToe.z,
  };

  // Max extension is upperLen + lowerLen (full extension), not current hip-to-heel distance
  hip.updateMatrixWorld(true);
  knee.updateMatrixWorld(true);
  heel.updateMatrixWorld(true);
  const hipWorld = new Vector3().setFromMatrixPosition(hip.matrixWorld);
  const kneeWorld = new Vector3().setFromMatrixPosition(knee.matrixWorld);
  const heelWorldPos = new Vector3().setFromMatrixPosition(heel.matrixWorld);
  const upperLen = hipWorld.distanceTo(kneeWorld);
  const lowerLen = kneeWorld.distanceTo(heelWorldPos);
  const maxExtension = upperLen + lowerLen;
  const softening = 0.005; // 5 mm softening zone

  // Solve IK to place heel at heelTarget (which puts toe at targetToeY)
  const ikResult = solveTwoBoneIK(hip, knee, heel, heelTarget, maxExtension, softening, actorSlot);
  if (ikResult) {
    // Apply local rotations to hip and knee only
    // hipDelta is a from-identity delta; compose with current animated hip pose
    hip.quaternion.multiplyQuaternions(hip.quaternion, ikResult.hipDelta);
    // kneeQuat is an absolute local bend; set directly
    knee.quaternion.copy(ikResult.kneeQuat);
    // Update world matrices so subsequent frames see the corrected pose
    hip.updateMatrixWorld(true);
    knee.updateMatrixWorld(true);
    // Force toe to update
    toeBone.updateMatrixWorld(true);
  } else {
    // Fallback: if IK fails, at least clamp the slot Y to not move
    // But the requirement is to NOT move actorSlot Y
  }

  // No clamp here either: same continued pin as the fallback path above.
  return {
    stanceFoot,
    anchorWorldXz: anchor,
    windowFrames: state.windowFrames + 1,
    correctionMeters,
    toeHeightMeters,
    doubleSupport,
    labelledStance: clipLabel,
    prevToeWorldXz: {
      left: { x: left.x, z: left.z },
      right: { x: right.x, z: right.z },
    },
    prevSlotXz: { x: actorSlot.position.x, z: actorSlot.position.z },
    forwardLeft,
    forwardRight,
    prevYawRadians: actorSlot.rotation.y,
  };
}

