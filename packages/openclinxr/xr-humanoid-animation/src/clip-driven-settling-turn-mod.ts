import type { Object3D } from "three";
import { type LocomotionStanceLabels, stanceAtTime } from "./locomotion-stance-labels.js";
import { computeFootfallBias, findStanceChain, pivotSlotAroundAnchor, worldXyz } from "./stance-lock-ik.js";
import { createStanceLockState, type StanceFoot, type StanceLockState } from "./stance-lock-mod.js";
import {
  applyStanceToeXzPin,
  correctPlantedFootHeight,
  type FootPinState,
  IDLE_FOOT_PIN_STATE,
  STANCE_TOE_PIN_RAMP_STEP,
  worldXz,
} from "./stance-toe-xz-pin-mod.js";


/**
 * Kept LOCAL rather than a new cross-package export. Must match
 * `bedside-approach-execution-mod.ts`'s `SETTLE_TURN_TOLERANCE_RADIANS` (xr-runtime-state) exactly
 * — the tolerance this module targets IS the one that function transitions settling on — but that
 * package's public `./bedside-approach-execution` subpath has an approved-surface allowlist this
 * value is not on, and the architecture gate refuses widening it. Same pattern this codebase
 * already uses for `minimumJerkSample` (`settling-step-turn-mod.ts`'s own header explains it).
 */
const SETTLE_TURN_TOLERANCE_RADIANS = (2 * Math.PI) / 180;

/**
 * The arrival turn, driven by the walk clip's own steps instead of a procedural rotate-and-slide.
 *
 * REPLACES `settling-step-turn-mod.ts`'s `applySettlingStepTurnPose` for the case-owned bedside
 * approach. Measured on the procedural turn (`.openclinxr/evidence/foot-plant-video/foot-plant-
 * video.json`, `turn-quality-metrics.ts`): floorPenetrationM -0.036, minStepLiftM 0.006 over 4
 * episodes (lift decaying 0.027 -> 0.006 as the toe never fully returns to rest between swaps),
 * plantedSlideM 0.110 — a swivel, not a step. The action stopping (`drive.locomotion = 0`) and a
 * hand-authored lift/swap is what produced that: with no clip playing, there is no clip pose to
 * pin against, and `applySettlingStepTurnPose` had to invent both the lift curve and the pivot.
 *
 * THE MECHANISM. The caller (`case-owned-approach-frame-mod.ts`) keeps the walk action PLAYING
 * during settling — at `SETTLING_LOCOMOTION_TIME_SCALE_FACTOR`, via
 * `bedside-approach-execution-mod.ts`'s settling-phase drive — with the executor's own forward
 * advance held at zero (`prescribedPositionXz` frozen on the walking-to-settling transition frame,
 * and left alone for the whole phase — see `advanceCaseOwnedBedsideApproach`). So the mixer keeps
 * producing genuine stance/swing steps; this module only decides how much of the settling turn's
 * yaw to add on top, and only on a frame the clip itself labels stance for the currently-designated
 * pivot foot (`LocomotionStanceLabels`, the SAME labels the walking stance lock reads).
 *
 * On such a frame, `actorSlot.rotation.y` is incremented FIRST (bounded per-phase, minimum-jerk —
 * see `SETTLING_CLIP_TURN_MAX_PHASE_RADIANS`), then `applyStanceLockedGroundAdvance` is run — the
 * SAME function the walking phase uses. Its very first act is `compensateSlotForYawChange`
 * (`stance-lock-ik.ts`), which reads exactly the yaw delta this module just wrote and pivots the
 * slot about the planted toe's last measured world position to cancel it precisely — the identity
 * `pivotSlotAroundAnchor` is proven against, not an approximation. The rest of that function then
 * runs its ordinary per-frame cycle unchanged: it pins the stance toe (capped at 0.02 m per frame,
 * never a slide), corrects any residual lateral drift against the anchored target position through
 * the SAME footfall-bias mechanism the walking phase uses, and lifts a submerged stance toe by leg
 * flexion. The swing toe is untouched by any of this — its height is whatever the mixer, playing
 * the clip, gives it, which is why a genuine swing lift shows up without this module asking for one.
 *
 * claimScope: the settling-phase yaw increment and its stance-lock pivot, for the case-owned
 * bedside approach.
 * notEvidenceFor: gait realism, clinical plausibility, or that a turn-in-place clip is not needed —
 * the underlying clip is still a forward walk played in place; this reuses its own steps rather
 * than inventing a synthetic one, but it is not a substitute for a rights-cleared turn take.
 */

/** ~30 deg. The per-stance-phase yaw budget the brief bounds each pivot window to. */
export const SETTLING_CLIP_TURN_MAX_PHASE_RADIANS = (30 * Math.PI) / 180;

/**
 * One phase's assumed duration, in seconds, absent a better signal: half the clip's own cycle at
 * the settling playback rate — the same "one stance, one swing" split a duty factor near 0.5
 * (`locomotion-stance-labels.ts`'s own measured ~0.53) already describes. Used only to shape the
 * minimum-jerk profile WITHIN a phase (a rate, not a hard duration) — a phase that runs longer just
 * keeps applying at its already-reached ceiling, and one that ends early (the label drops before
 * the estimate elapses) simply leaves the remainder for the next phase's budget.
 */
export function settlingClipTurnPhaseDurationSeconds(clipCycleSeconds: number, timeScaleFactor: number): number {
  const scale = timeScaleFactor > 0 ? timeScaleFactor : 1;
  return clipCycleSeconds > 0 ? clipCycleSeconds / 2 / scale : 1;
}

/** x(t) = 10t^3 - 15t^4 + 6t^5. Same quintic `settling-step-turn-mod.ts` uses; kept local for the
 * same reason that file keeps its own copy rather than a new cross-package dependency. */
function minimumJerkSample(t: number): number {
  const p = t < 0 ? 0 : t > 1 ? 1 : t;
  return 10 * p ** 3 - 15 * p ** 4 + 6 * p ** 5;
}

function shortestYawDelta(fromRadians: number, toRadians: number): number {
  return Math.atan2(Math.sin(toRadians - fromRadians), Math.cos(toRadians - fromRadians));
}

export type ClipDrivenSettlingTurnState = {
  lock: StanceLockState;
  /** The foot currently designated as this phase's pivot, or null before the first stance frame. */
  phaseFoot: StanceFoot | null;
  /** This phase's signed yaw budget, `min(30 deg, |remaining|) * sign(remaining)`, at phase start. */
  phaseBudgetRadians: number;
  /** Seconds elapsed in the current phase (advances only on stance-labelled frames). */
  phaseElapsedSeconds: number;
  /** Yaw already applied this phase — the running minimum-jerk target, so the step is a delta. */
  phaseAppliedRadians: number;
  /**
   * The pivot foot's world XZ, captured ONCE when this phase began, and pivoted about for every
   * yaw increment for the WHOLE phase — a FIXED anchor, not `compensateSlotForYawChange`'s own
   * continuously-updating one. MEASURED reason: the shared walking-phase pivot re-anchors to the
   * toe's latest world position every call, which is correct for tiny per-frame anticipatory yaw
   * (the toe barely moves between frames there) but compounds wrongly here, where dozens of small
   * increments spread a 30 deg phase over many frames — composing pivots around a slightly-moving
   * anchor is NOT the same as one pivot around a fixed point, and measured on the shipped
   * physician it produced ~2.5x the displacement a clean two-endpoint chord predicts (0.394 m
   * actual vs a ~0.159 m chord estimate, same phases). A fixed anchor makes the phase's own
   * displacement exactly the geometry `pivotSlotAroundAnchor`'s own proof describes: `2r sin(θ/2)`.
   */
  phasePivotAnchorXz: { x: number; z: number } | null;
  /**
   * The world point drift is measured against, and the route direction `applyStanceLockedGroundAdvance`
   * biases new stance windows back toward — both captured ONCE, on the first settling frame, so the
   * physician corrects back toward the spot he arrived at rather than chasing a moving reference.
   */
  anchorPositionXz: { x: number; z: number } | null;
  travelUnit: { x: number; z: number } | null;
  /** Per-foot toe-XZ IK pin (`applyStanceToeXzPin`): anchor plus ramp weight, left and right. */
  pin: { left: FootPinState; right: FootPinState };
  /**
   * Cumulative frames across the whole settling turn where `applyStanceToeXzPin` released rather
   * than applied because the footfall anchor was beyond `STANCE_TOE_PIN_MAX_REACH_FRACTION` of leg
   * reach. Exposed so a caller can report how often the guard fired.
   */
  reachReleasedFrameCount: number;
  /**
   * DEBUG/DIAGNOSTIC, not part of the published contract otherwise: THIS FRAME's reach-release
   * outcome per side, so a capture can attribute a toe jump to the pin releasing (raw clip pose
   * showing through) versus some other cause. `null` when the pin was not attempted this frame
   * (weight is 0) rather than a fabricated `false`.
   */
  reachReleasedThisFrame: { left: boolean | null; right: boolean | null };
  /** DEBUG/DIAGNOSTIC: this frame's pin anchor + weight per side, for turn-jump attribution. */
  pinDebugThisFrame: {
    left: { anchorXz: { x: number; z: number } | null; weight: number };
    right: { anchorXz: { x: number; z: number } | null; weight: number };
  };
};

export function createClipDrivenSettlingTurnState(): ClipDrivenSettlingTurnState {
  return {
    lock: createStanceLockState(),
    phaseFoot: null,
    phaseBudgetRadians: 0,
    phaseElapsedSeconds: 0,
    phaseAppliedRadians: 0,
    phasePivotAnchorXz: null,
    anchorPositionXz: null,
    travelUnit: null,
    pin: { left: IDLE_FOOT_PIN_STATE, right: IDLE_FOOT_PIN_STATE },
    reachReleasedFrameCount: 0,
    reachReleasedThisFrame: { left: null, right: null },
    pinDebugThisFrame: { left: { anchorXz: null, weight: 0 }, right: { anchorXz: null, weight: 0 } },
  };
}

export function applyClipDrivenSettlingTurn(input: {
  actorSlot: Object3D;
  leftToe: Object3D | null;
  rightToe: Object3D | null;
  floorOriginY: number;
  contactBandMeters: number;
  targetHeadingRadians: number;
  deltaSeconds: number;
  clipCycleSeconds: number;
  timeScaleFactor: number;
  clipStance: { labels: LocomotionStanceLabels; actionTimeSeconds: number } | undefined;
  state: ClipDrivenSettlingTurnState;
}): ClipDrivenSettlingTurnState {
  const { actorSlot, state } = input;
  const anchorPositionXz = state.anchorPositionXz ?? { x: actorSlot.position.x, z: actorSlot.position.z };
  // A FIXED axis (the target heading direction), captured once and held — NOT pointed at the
  // slot's own current drift. `computeFootfallBias(point, routeStart, unit)` returns the component
  // of `point - routeStart` PERPENDICULAR to `unit` (`stance-lock-ik.ts`'s own algebra: subtracting
  // the projection along `unit` leaves exactly that). Aiming `unit` AT the drift direction — tried
  // first — makes the drift vector PARALLEL to `unit` by construction, so its perpendicular
  // component, i.e. the bias `computeFootfallBias` returns, is always (0, 0): measured, every
  // `[offset2]` trace showed `bias=(0.0000,0.0000)`. Fixed below instead: `computeFootfallBias` is
  // called TWICE, once against the X axis and once against the Z axis, and the two results are
  // SUMMED — each call returns exactly the OTHER axis's component of the drift (a `unit=(1,0)` call
  // returns `(0, relZ)`; a `unit=(0,1)` call returns `(relX, 0)`), so the sum is the full 2D drift,
  // using the function exactly as written rather than defeating it.
  const travelUnit = { x: Math.sin(input.targetHeadingRadians), z: Math.cos(input.targetHeadingRadians) };

  const remaining = shortestYawDelta(actorSlot.rotation.y, input.targetHeadingRadians);
  const labelled = input.clipStance ? stanceAtTime(input.clipStance.labels, input.clipStance.actionTimeSeconds) : null;
  // A foot IS the pivot only when the clip labels it, and only it, stance this frame. Both-down
  // (double support) or neither keeps the incumbent phase foot rather than reassigning mid-window.
  const downFoot: StanceFoot | null =
    labelled === null
      ? null
      : labelled.left && !labelled.right
        ? "left"
        : labelled.right && !labelled.left
          ? "right"
          : state.phaseFoot;

  let next: ClipDrivenSettlingTurnState = { ...state, anchorPositionXz, travelUnit };
  if (Math.abs(remaining) > SETTLE_TURN_TOLERANCE_RADIANS && downFoot !== null) {
    if (next.phaseFoot !== downFoot) {
      // A new phase (a footfall): correct drift via `computeFootfallBias` FIRST — the one
      // correction mechanism this module uses, per direction — nudging the slot back toward the
      // settling anchor before this phase's fixed pivot point is captured, so the correction is
      // "the next footfall lands a little closer to true" rather than a mid-window slide. Called
      // twice against fixed orthogonal axes and summed — see the note on `travelUnit` above for
      // why: each call alone only returns ONE axis's worth of the drift.
      const slotXz = { x: actorSlot.position.x, z: actorSlot.position.z };
      const biasAlongX = computeFootfallBias(slotXz, anchorPositionXz, { x: 1, z: 0 });
      const biasAlongZ = computeFootfallBias(slotXz, anchorPositionXz, { x: 0, z: 1 });
      const bias = { x: biasAlongX.x + biasAlongZ.x, z: biasAlongX.z + biasAlongZ.z };
      if (bias.x !== 0 || bias.z !== 0) {
        actorSlot.position.x -= bias.x;
        actorSlot.position.z -= bias.z;
        actorSlot.updateMatrixWorld(true);
      }
      // The newly-planted foot becomes the pivot, with its own bounded budget taken fresh against
      // the CURRENT remaining turn (so a phase never asks for more than is left), and a FIXED
      // pivot anchor captured now (AFTER the bias above) — see `phasePivotAnchorXz`'s own note.
      const budget = Math.sign(remaining || 1) * Math.min(SETTLING_CLIP_TURN_MAX_PHASE_RADIANS, Math.abs(remaining));
      const toe = downFoot === "left" ? input.leftToe : input.rightToe;
      next = {
        ...next,
        phaseFoot: downFoot,
        phaseBudgetRadians: budget,
        phaseElapsedSeconds: 0,
        phaseAppliedRadians: 0,
        phasePivotAnchorXz: toe !== null ? worldXz(toe) : null,
      };
    }
    const elapsedSeconds = next.phaseElapsedSeconds + input.deltaSeconds;
    const phaseDurationSeconds = settlingClipTurnPhaseDurationSeconds(input.clipCycleSeconds, input.timeScaleFactor);
    const progress = phaseDurationSeconds > 0 ? Math.min(1, elapsedSeconds / phaseDurationSeconds) : 1;
    const desiredApplied = next.phaseBudgetRadians * minimumJerkSample(progress);
    const stepRadians = desiredApplied - next.phaseAppliedRadians;
    if (stepRadians !== 0) {
      // Pivot about the FIXED per-phase anchor first (a pure position transform — it does not
      // touch rotation.y), then apply the same delta to rotation.y. Order between the two does not
      // matter to `pivotSlotAroundAnchor` itself, since it only reads `yawDeltaRadians`.
      if (next.phasePivotAnchorXz !== null) pivotSlotAroundAnchor(actorSlot, next.phasePivotAnchorXz, stepRadians);
      actorSlot.rotation.y += stepRadians;
      actorSlot.updateMatrixWorld(true);
    }
    next = { ...next, phaseElapsedSeconds: elapsedSeconds, phaseAppliedRadians: desiredApplied };
  }

  // TOE-XZ PIN, per foot, via `applyStanceToeXzPin`. Replaces the old Y-only
  // `liftSubmergedStanceToe`: same reason `applyStanceLockedGroundAdvance` itself is not reused
  // here (its ground-advance job — matching the clip's own stance-foot forward speed — is exactly
  // wrong for a turn that wants zero net translation), plus the pin now also holds XZ so the clip's
  // own gait motion cannot carry the planted toe backward in body space (the defect this fix
  // targets). `stanceFootForY` names the foot the lock reports for continuity with the field below
  // (double-support / flight frames keep reporting the last designated foot); the pin loop below
  // ramps BOTH feet independently off the clip's raw per-foot labels, so a foot's weight reaches 0
  // a few frames after it stops being reported here, not the same frame.
  const stanceFootForY = downFoot ?? next.phaseFoot;
  let pin = next.pin;
  let reachReleasedFrameCount = next.reachReleasedFrameCount;
  const reachReleasedThisFrame: { left: boolean | null; right: boolean | null } = { left: null, right: null };
  const pinDebugThisFrame: ClipDrivenSettlingTurnState["pinDebugThisFrame"] = {
    left: { anchorXz: null, weight: 0 },
    right: { anchorXz: null, weight: 0 },
  };
  const pinSides: readonly StanceFoot[] = ["left", "right"];
  for (const side of pinSides) {
    const toe = side === "left" ? input.leftToe : input.rightToe;
    // HOLD THE OLD STANCE FOOT UNTIL THE HANDOFF IS CONFIRMED (measured 2026-09-25, turn-jump
    // investigation; coordinator direction: "a stance switch should hand the old stance foot to
    // swing only after it has lifted"). The raw PER-SAMPLE clip label (`labelled[side]`) can go
    // false a few frames before the REPORTED switch (`stanceFootForY`, computed above from the
    // smoothed `downFoot`/`phaseFoot`) — MEASURED on the real capture
    // (`.openclinxr/evidence/foot-plant-video/foot-plant-video.json`): the left foot's pin weight
    // started ramping down at sample 65 (1 -> 0.667 -> 0.333 -> ~0) while `stanceFoot` was still
    // reported "left" through sample 66, so the pin's own correction weakened and the toe drifted
    // 0.053, 0.122, 0.095 m across those three frames — growing as weight fell, not a footfall. A
    // foot now counts as stance for the PIN as long as EITHER the raw label says so (so the
    // INCOMING foot can still start ramping up early, preserving double-support overlap) OR it is
    // still the currently-REPORTED stance foot (so the OUTGOING foot cannot start releasing before
    // its own reported handoff), never anticipating a switch the rest of this function has not
    // committed to yet.
    const isStance = (labelled !== null && labelled[side]) || side === stanceFootForY;
    const current = pin[side];
    let anchorXz = current.anchorXz;
    let weight = current.weight;
    if (isStance) {
      if (anchorXz === null && toe !== null) anchorXz = worldXz(toe);
      weight = Math.min(1, weight + STANCE_TOE_PIN_RAMP_STEP);
    } else {
      weight = Math.max(0, weight - STANCE_TOE_PIN_RAMP_STEP);
      if (weight === 0) anchorXz = null;
    }
    pin = { ...pin, [side]: { anchorXz, weight } };
    pinDebugThisFrame[side] = { anchorXz, weight };
    if (weight > 0 && anchorXz !== null) {
      const result = applyStanceToeXzPin({
        actorSlot,
        stanceFoot: side,
        anchorXz,
        floorOriginY: input.floorOriginY,
        weight,
      });
      if (result.reachReleased) reachReleasedFrameCount += 1;
      reachReleasedThisFrame[side] = result.reachReleased;
      // DIRECT ANKLE CORRECTION (coordinator direction 2026-09-25) — see `correctPlantedFootHeight`'s
      // own header in stance-toe-xz-pin-mod.ts for why the XZ pin alone leaves the toe ~3-5 cm high.
      if (!result.reachReleased) {
        const chain = findStanceChain(actorSlot, side);
        if (chain !== null) {
          correctPlantedFootHeight({
            heel: chain.heel,
            toe: chain.toe,
            floorOriginY: input.floorOriginY,
            weight,
          });
        }
      }
    }
  }
  next = { ...next, pin, reachReleasedFrameCount, reachReleasedThisFrame, pinDebugThisFrame };

  const leftHeight = input.leftToe !== null ? worldXyz(input.leftToe).y - input.floorOriginY : Number.NaN;
  const rightHeight = input.rightToe !== null ? worldXyz(input.rightToe).y - input.floorOriginY : Number.NaN;
  const lock: StanceLockState = {
    ...next.lock,
    stanceFoot: stanceFootForY,
    correctionMeters: { x: 0, z: 0 },
    toeHeightMeters: { left: leftHeight, right: rightHeight },
    doubleSupport: labelled !== null && labelled.left && labelled.right,
    labelledStance: labelled,
    prevYawRadians: actorSlot.rotation.y,
  };

  return { ...next, lock };
}
