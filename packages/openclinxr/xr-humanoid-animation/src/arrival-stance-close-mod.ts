import type { Object3D } from "three";
import {
  copyVec,
  toeWorld,
  type Vec3,
} from "./toe-local-write.js";

/**
 * The arrival hold: a continuity hold, not a convergence.
 *
 * Once the settling turn ends, the feet stay where the turn put them. Each arrived frame
 * pins each toe to the world XZ it held on the first arrived frame (per-toe anchors, taken
 * once and never re-taken) by translating the slot against the designated plant toe's own
 * drift; no leg chain is slerped toward the rest snapshot, so the slot cannot walk after
 * the body has stopped. The rest snapshot is still captured — it seeds the settling rest
 * locals and the stop-take recapture — but the arrived phase no longer converges toward it.
 *
 * ## WHY THE GLIDE WENT AWAY (measured 2026-10-14, SC-05, flags off, n=3): the turn already
 * puts the feet on the target — turn-end distance to targetWorld [slot | toe-midpoint]
 * 0.028 | 0.028 m — and the old gradual close then glided them 0.075 m away toward the idle
 * rest stance (close-done 0.023 | 0.103 m). The target is authored as where the body STANDS
 * (`BEDSIDE_STANDOFF_METERS = 0.75`, "standing clearance from the patient",
 * `packages/openclinxr/asset-registry/src/bedside-target.ts`), so converging toward the
 * walk-start rest pose moved the actor AWAY from its stand point on every run. Worse, flags
 * off + `fixedClock=1` showed a 0.196 m one-frame SLOT jump on 2 of 3 runs when the close
 * re-took its anchor on a plant-foot role swap and dragged the slot across the inter-foot
 * gap. A hold with per-toe frozen anchors has no re-take and therefore no swap
 * discontinuity by construction.
 *
 * ## PRIOR HISTORY (kept for the record — describes the removed glide, not this hold):
 * the close was added 2026-10-11 to replace a snap that teleported a toe 0.39 m and froze
 * a 0.50 m split. It converged the swing leg toward the walk-start rest snapshot while the
 * plant (lower) toe held its spot, slerping one leg chain per frame with a minimum-jerk
 * lift arc. Two earlier gate attempts (height-banded and remaining-distance-gated step caps)
 * were reverted: neither signal could separate a dragging toe from a legitimate swing step.
 * The close also published which toe is this frame's PLANT vs its SWING onto `approach.lock`
 * (`labelledStance`), so the stop-slide clauses grade by label instead of the 0.06 m contact
 * band — the hold keeps publishing that label, now for a stationary stance.
 */

/**
 * Plant-designation hysteresis: sub-epsilon dips never swap the plant label. Kept for the
 * hold: the designation now only chooses which toe's anchor the slot translates against
 * and which `labelledStance` the frame publishes, so a one-frame dip must not flap it.
 */
export const ARRIVAL_CLOSE_PLANT_HYSTERESIS_METERS = 0.005;

/**
 * RETIRED 2026-10-14 (arrival hold): blend per arrived frame toward rest. Kept exported so
 * the convergence history stays greppable; the hold never reads it.
 */
export const ARRIVAL_CLOSE_BLEND = 0.12;

/**
 * RETIRED 2026-10-14 (arrival hold): peak height of the swing toe's lift arc. Kept exported
 * so the convergence history stays greppable; the hold never reads it.
 */
export const ARRIVAL_CLOSE_SWING_LIFT_METERS = 0.018;

export type Quat4 = { x: number; y: number; z: number; w: number };

/**
 * The actor's own standing pose, snapshotted before the clip poses the skeleton.
 * `restLocal` here is the TRUE rest — unlike the mid-stride locals the settling turn
 * used to capture on its first frame, which is why arrived frames froze a 0.50 m split
 * stance (walking median 0.385 m) with the left toe held 0.052 m up.
 */
export type RestStanceSnapshot = {
  /** Rest local quaternions of both leg chains, keyed by node name. */
  quats: Record<string, Quat4>;
  /** Rest local positions of both toe bones. */
  toeLeft: Vec3;
  toeRight: Vec3;
  /** World XZ toe separation at snapshot: the known-good arrival column. */
  sepXz: number;
  /** World heights of both toes at snapshot. */
  heightLeft: number;
  heightRight: number;
};

const LEG_CHAIN_BONE = /^(upperleg0[12]|lowerleg0[12]|foot)[LR]$/;

function collectLegChain(toe: Object3D, actorSlot: Object3D): Object3D[] {
  const chain: Object3D[] = [];
  let node: Object3D | null = toe.parent;
  let depth = 0;
  while (node !== null && node !== actorSlot && depth < 10) {
    const sanitised = node.name.replaceAll(".", "");
    if (LEG_CHAIN_BONE.test(sanitised)) chain.push(node);
    if (/^pelvis/.test(sanitised)) break;
    node = node.parent;
    depth += 1;
  }
  return chain;
}

/**
 * Snapshot the standing rest pose. Call on the first walking frame, when the skeleton
 * still holds the idle pose and the clip has not written a sample yet.
 */
export function captureRestStance(input: {
  actorSlot: Object3D;
  leftToe: Object3D | null;
  rightToe: Object3D | null;
}): RestStanceSnapshot | null {
  const { actorSlot, leftToe, rightToe } = input;
  if (leftToe === null || rightToe === null) return null;
  actorSlot.updateMatrixWorld(true);
  const quats: Record<string, Quat4> = {};
  for (const toe of [leftToe, rightToe]) {
    for (const bone of collectLegChain(toe, actorSlot)) {
      quats[bone.name] = { x: bone.quaternion.x, y: bone.quaternion.y, z: bone.quaternion.z, w: bone.quaternion.w };
    }
  }
  const left = toeWorld(leftToe);
  const right = toeWorld(rightToe);
  return {
    quats,
    toeLeft: copyVec(leftToe),
    toeRight: copyVec(rightToe),
    sepXz: Math.hypot(left.x - right.x, left.z - right.z),
    heightLeft: left.y,
    heightRight: right.y,
  };
}

export type ArrivalCloseState = {
  /**
   * World XZ each toe is pinned to, taken on the first close frame and NEVER re-taken —
   * not on a plant-foot role swap either. Per-toe (not one shared anchor) so a swap pins
   * the new plant to its OWN spot instead of dragging the slot across the inter-foot gap
   * (the 0.196 m fixed-clock jump that retired the glide).
   */
  leftAnchorXz: { x: number; z: number } | null;
  rightAnchorXz: { x: number; z: number } | null;
  done: boolean;
  /** Frames run; the hold yields to the settled correction alone after the cap. */
  framesRun: number;
  /**
   * Which foot the slot translates against this frame, and which `labelledStance` the
   * arrived lock publishes. A designation only — the hold writes no bone pose for
   * either foot, so a swap moves the slot by the new plant's own sub-millimetre drift,
   * never by the inter-foot distance.
   */
  plantFoot: "left" | "right" | null;
  /**
   * RETIRED 2026-10-14 (arrival hold): swing-lift arc segment tracking. Kept on the state
   * so existing state literals spread forward; the hold never reads them.
   */
  swingSegmentFoot: "left" | "right" | null;
  /** RETIRED 2026-10-14 (arrival hold): see `swingSegmentFoot`. */
  swingSegmentStartDistance: number;
};

export function createArrivalCloseState(): ArrivalCloseState {
  return {
    leftAnchorXz: null,
    rightAnchorXz: null,
    done: false,
    framesRun: 0,
    plantFoot: null,
    swingSegmentFoot: null,
    swingSegmentStartDistance: 0,
  };
}

/** Frames after which the hold yields even so (4 s at 30 fps); cadence unchanged. */
export const ARRIVAL_CLOSE_FRAME_CAP = 120;

/**
 * Arrival hold: after the turn, nothing moves the feet or the body except a continuity
 * hold. Each planted toe keeps the world XZ it held on the first arrived frame; the slot
 * translates only against the designated plant toe's own drift (sub-millimetre per frame
 * while nothing writes the pose), so it cannot walk after the body has stopped. No slerp
 * toward the rest quaternions, no re-taking of either anchor on a role swap. The settled
 * posture correction (arrived lock, runs after this) is untouched and still owns toe height.
 */
export function applyArrivalStanceClose(input: {
  actorSlot: Object3D;
  leftToe: Object3D | null;
  rightToe: Object3D | null;
  snapshot: RestStanceSnapshot;
  state: ArrivalCloseState;
  blendFactor?: number;
  maxStepMeters?: number;
}): { state: ArrivalCloseState; maxStepMeters: number; sepXz: number } {
  const { actorSlot, leftToe, rightToe } = input;
  if (leftToe === null || rightToe === null) {
    return {
      state: {
        leftAnchorXz: input.state.leftAnchorXz,
        rightAnchorXz: input.state.rightAnchorXz,
        done: true,
        framesRun: input.state.framesRun + 1,
        plantFoot: input.state.plantFoot,
        swingSegmentFoot: input.state.swingSegmentFoot ?? null,
        swingSegmentStartDistance: input.state.swingSegmentStartDistance ?? 0,
      },
      maxStepMeters: 0,
      sepXz: Number.NaN,
    };
  }
  actorSlot.updateMatrixWorld(true);
  const beforeLeft = toeWorld(leftToe);
  const beforeRight = toeWorld(rightToe);
  // Plant designation (LABELS + pin priority only — no pose is written for either foot).
  // Lower toe wins; hysteresis keeps the incumbent over sub-epsilon dips, and the
  // settling→arrived seeding (`case-owned-approach-frame-mod.ts`) biases the first frame.
  const rawPlantIsLeft = beforeLeft.y <= beforeRight.y;
  const rawPlantSide = (rawPlantIsLeft ? "left" : "right") as "left" | "right";
  let plantSide = rawPlantSide;
  if (input.state.plantFoot !== null && input.state.plantFoot !== rawPlantSide) {
    const incumbentY = input.state.plantFoot === "left" ? beforeLeft.y : beforeRight.y;
    const challengerY = rawPlantIsLeft ? beforeLeft.y : beforeRight.y;
    if (incumbentY - challengerY <= ARRIVAL_CLOSE_PLANT_HYSTERESIS_METERS) {
      plantSide = input.state.plantFoot;
    }
  }
  const plantIsLeft = plantSide === "left";
  const plantToe = plantIsLeft ? leftToe : rightToe;
  // Freeze BOTH anchors on the first close frame; a role swap never re-takes either.
  let leftAnchorXz = input.state.leftAnchorXz;
  let rightAnchorXz = input.state.rightAnchorXz;
  if (leftAnchorXz === null || rightAnchorXz === null) {
    leftAnchorXz = { x: beforeLeft.x, z: beforeLeft.z };
    rightAnchorXz = { x: beforeRight.x, z: beforeRight.z };
  }
  const plantAnchorXz = plantIsLeft ? leftAnchorXz : rightAnchorXz;
  const savedSlot = { x: actorSlot.position.x, z: actorSlot.position.z };
  // Pin the plant toe to its OWN anchor: translate the slot back by whatever moved it.
  // The only slot write here, and on a static pose it moves nothing.
  const plantNow = toeWorld(plantToe);
  actorSlot.position.x = savedSlot.x + (plantAnchorXz.x - plantNow.x);
  actorSlot.position.z = savedSlot.z + (plantAnchorXz.z - plantNow.z);
  actorSlot.updateMatrixWorld(true);
  const afterLeft = toeWorld(leftToe);
  const afterRight = toeWorld(rightToe);
  const stepLeft = Math.hypot(afterLeft.x - beforeLeft.x, afterLeft.y - beforeLeft.y, afterLeft.z - beforeLeft.z);
  const stepRight = Math.hypot(afterRight.x - beforeRight.x, afterRight.y - beforeRight.y, afterRight.z - beforeRight.z);
  return {
    state: {
      leftAnchorXz,
      rightAnchorXz,
      done: input.state.framesRun + 1 >= ARRIVAL_CLOSE_FRAME_CAP,
      framesRun: input.state.framesRun + 1,
      plantFoot: plantSide,
      swingSegmentFoot: input.state.swingSegmentFoot ?? null,
      swingSegmentStartDistance: input.state.swingSegmentStartDistance ?? 0,
    },
    maxStepMeters: Math.max(stepLeft, stepRight),
    sepXz: Math.hypot(afterLeft.x - afterRight.x, afterLeft.z - afterRight.z),
  };
}
