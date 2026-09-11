import type { Object3D } from "three";

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
 *  - NOT PINNED: window transitions. When the stance foot changes, the anchor is re-taken and no
 *    correction is applied, so the seam frame carries whatever the clip does.
 *  - NOT AFFECTED AT ALL: arrival error, settled heading, stopped-observation root travel, swept
 *    collision and limb integrity. The lock moves the body, so it can only make arrival WORSE.
 *
 * claimScope: the world XZ of one named stance toe is held constant across a contact window.
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
  /** This frame's applied correction, in metres. Zero on a window seam. */
  correctionMeters: { x: number; z: number };
  /** Both toes' signed height above the floor frame this frame, for the record. */
  toeHeightMeters: { left: number; right: number };
  /** True when both toes were inside the band: the frame the other foot is NOT pinned. */
  doubleSupport: boolean;
};

export function createStanceLockState(): StanceLockState {
  return {
    stanceFoot: null,
    anchorWorldXz: null,
    windowFrames: 0,
    correctionMeters: { x: 0, z: 0 },
    toeHeightMeters: { left: Number.NaN, right: Number.NaN },
    doubleSupport: false,
  };
}

function worldXz(node: Object3D): { x: number; y: number; z: number } {
  const elements = node.matrixWorld.elements;
  return { x: elements[12] ?? Number.NaN, y: elements[13] ?? Number.NaN, z: elements[14] ?? Number.NaN };
}

/**
 * Pin the stance toe and return the state.
 *
 * The caller supplies the two toe objects rather than a rig-name lookup: bone names differ between
 * rails and a lookup that guesses is the pattern-matching `chain-ownership.ts` refuses. A null toe
 * means the rig does not carry that bone, and the lock then does nothing and says so through
 * `stanceFoot: null` rather than pinning a body part it could not find.
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
}): StanceLockState {
  const { actorSlot, leftToe, rightToe, state } = input;
  actorSlot.updateMatrixWorld(true);
  if (leftToe === null || rightToe === null) {
    return {
      ...createStanceLockState(),
      toeHeightMeters: {
        left: leftToe === null ? Number.NaN : worldXz(leftToe).y - input.floorOriginY,
        right: rightToe === null ? Number.NaN : worldXz(rightToe).y - input.floorOriginY,
      },
    };
  }
  const left = worldXz(leftToe);
  const right = worldXz(rightToe);
  const leftHeight = left.y - input.floorOriginY;
  const rightHeight = right.y - input.floorOriginY;
  const leftDown = leftHeight <= input.contactBandMeters;
  const rightDown = rightHeight <= input.contactBandMeters;

  // IN DOUBLE SUPPORT THE LOWER TOE CARRIES THE BODY. Hysteresis on the previous stance foot was
  // the first rule here and it is wrong for any gait without a flight phase: a foot that has begun
  // to swing is still inside the 0.06 m band for several frames, and keeping it as the stance foot
  // pins a toe that is deliberately moving forward — which drags the whole body backwards. Measured
  // on a 0.5 m-stride probe gait at 60 Hz, that produced a 0.228 m worst-frame displacement on
  // `toe1-1.L`, 45x the allowance, in the frames right after each stance change. The lower toe is
  // the one bearing weight, and it is the one that must not move.
  let stanceFoot: StanceFoot | null = null;
  if (leftDown && rightDown) stanceFoot = leftHeight <= rightHeight ? "left" : "right";
  else if (leftDown) stanceFoot = "left";
  else if (rightDown) stanceFoot = "right";

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
    };
  }
  const toe = stanceFoot === "left" ? left : right;
  const anchor = state.stanceFoot === stanceFoot ? state.anchorWorldXz : null;
  if (anchor === null) {
    // A NEW window: take the anchor where the clip actually put the foot and apply nothing. Forcing
    // the first frame back to the previous window's anchor would teleport the body a stride.
    return {
      stanceFoot,
      anchorWorldXz: { x: toe.x, z: toe.z },
      windowFrames: 1,
      correctionMeters: { x: 0, z: 0 },
      toeHeightMeters,
      doubleSupport,
    };
  }
  const correctionMeters = { x: anchor.x - toe.x, z: anchor.z - toe.z };
  actorSlot.position.x += correctionMeters.x;
  actorSlot.position.z += correctionMeters.z;
  actorSlot.updateMatrixWorld(true);
  return {
    stanceFoot,
    anchorWorldXz: anchor,
    windowFrames: state.windowFrames + 1,
    correctionMeters,
    toeHeightMeters,
    doubleSupport,
  };
}
