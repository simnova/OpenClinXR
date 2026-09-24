import { type Object3D, Quaternion, Vector3 } from "three";
import {
  ARRIVAL_CLOSE_MAX_STEP_METERS,
  copyVec,
  toeWorld,
  type Vec3,
} from "./toe-local-write.js";

/**
 * The gradual arrival close: converging a split stride toward the walk-start rest snapshot.
 * Split out of `settling-step-turn-mod.ts` to clear that file's 500-line budget; behaviour is
 * unchanged, only the module boundary moved.
 */

/** Plant-designation hysteresis: sub-epsilon dips never swap the plant foot. */
export const ARRIVAL_CLOSE_PLANT_HYSTERESIS_METERS = 0.005;

/** Blend per arrived frame toward rest. 0.12 converges a 0.075 m gap in ~32 frames. */
export const ARRIVAL_CLOSE_BLEND = 0.12;

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
  /** World XZ the plant toe is pinned to, taken on the first close frame. */
  anchorXz: { x: number; z: number } | null;
  done: boolean;
  /** Frames run; the close yields to the settled correction after the cap. */
  framesRun: number;
  /**
   * Which foot the anchor belongs to. The lower toe changes as the swing leg lands,
   * and pinning the new plant to the old plant's anchor teleports the slot by the
   * inter-foot distance (measured 1.2 m). A role swap re-takes the anchor instead.
   */
  plantFoot: "left" | "right" | null;
};

export function createArrivalCloseState(): ArrivalCloseState {
  return { anchorXz: null, done: false, framesRun: 0, plantFoot: null };
}

/** Frames after which the close yields even unconverged (4 s at 30 fps). */
export const ARRIVAL_CLOSE_FRAME_CAP = 120;

/**
 * Gradual arrival close: slerp the SWING leg chain toward the walk-start rest snapshot
 * while the plant (lower) toe holds exactly where the walk left it — the same
 * slot-translate seam the walking stance lock uses pins it, and it is the only slot
 * write here. The swing toe glides beside the plant foot over ~1.7 s instead of the
 * 0.39 m snap `restoreSettlingRestToePose` produced on the settling→arrived transition.
 *
 * The plant leg is deliberately NOT slerped. Slerping it drifts the plant toe, and the
 * pin then walks the whole slot after the body has stopped — measured 55 mm of root
 * travel inside the stopped observation against its 5 mm cap. A planted foot staying
 * planted is what lets the close converge with a static slot: as the swing toe lands
 * lower, the roles swap and the other leg takes its turn, so both still converge.
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
  const { actorSlot, leftToe, rightToe, snapshot } = input;
  const blend = input.blendFactor ?? ARRIVAL_CLOSE_BLEND;
  if (leftToe === null || rightToe === null) {
    return {
      state: { anchorXz: input.state.anchorXz, done: true, framesRun: input.state.framesRun + 1, plantFoot: input.state.plantFoot },
      maxStepMeters: 0,
      sepXz: Number.NaN,
    };
  }
  actorSlot.updateMatrixWorld(true);
  const beforeLeft = toeWorld(leftToe);
  const beforeRight = toeWorld(rightToe);
  const rawPlantIsLeft = beforeLeft.y <= beforeRight.y;
  const rawPlantSide = (rawPlantIsLeft ? "left" : "right") as "left" | "right";
  // Hysteresis on the plant designation: keep the previous plant foot while the other
  // is lower by less than epsilon. Slerp arcs dip the swinging toe below the plant toe
  // for a frame or two, and swapping on every dip freezes each leg mid-convergence
  // (measured 49 mm stall with the swing-only close). Genuine touchdowns differ by
  // centimetres and still swap. (The walking lock deliberately has NO hysteresis —
  // pinning a swinging foot there drags the body; here the slot must not travel anyway.)
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
  let anchorXz = input.state.anchorXz;
  // A new plant foot must never inherit the old plant's anchor: the pin would drag
  // the slot across the inter-foot gap. A role swap re-takes the anchor instead.
  if (anchorXz === null || input.state.plantFoot !== plantSide) {
    const plant = toeWorld(plantToe);
    anchorXz = { x: plant.x, z: plant.z };
  }
  const cap = input.maxStepMeters ?? ARRIVAL_CLOSE_MAX_STEP_METERS;
  // Halve the blend until the frame's world step fits the cap (at most 4 halvings).
  let attemptBlend = blend;
  let afterLeft = beforeLeft;
  let afterRight = beforeRight;
  let maxStepMeters = 0;
  const savedQuats = new Map<Object3D, Quaternion>();
  const savedLocals = new Map<Object3D, Vec3>();
  const savedSlot = { x: actorSlot.position.x, z: actorSlot.position.z };
  const swingToe = plantToe === leftToe ? rightToe : leftToe;
  for (const toe of [swingToe]) {
    for (const bone of collectLegChain(toe, actorSlot)) {
      if (!savedQuats.has(bone)) savedQuats.set(bone, bone.quaternion.clone());
    }
    savedLocals.set(toe, copyVec(toe));
  }
  const restQuat = new Quaternion();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // Restore the slot BEFORE re-posing: measuring plantNow against the previous
    // attempt's pin-shifted slot compounds the pin instead of converging it.
    actorSlot.position.x = savedSlot.x;
    actorSlot.position.z = savedSlot.z;
    for (const [bone, saved] of savedQuats) {
      bone.quaternion.copy(saved);
      const rest = snapshot.quats[bone.name];
      if (!rest) continue;
      restQuat.set(rest.x, rest.y, rest.z, rest.w);
      bone.quaternion.slerp(restQuat, attemptBlend);
    }
    const lerpLocal = (toe: Object3D, rest: Vec3): void => {
      const saved = savedLocals.get(toe) ?? copyVec(toe);
      toe.position.set(
        saved.x + (rest.x - saved.x) * attemptBlend,
        saved.y + (rest.y - saved.y) * attemptBlend,
        saved.z + (rest.z - saved.z) * attemptBlend,
      );
    };
    // SWING SIDE ONLY (see the function comment): the plant toe's local is never
    // written, so its world spot never drifts and the pin below moves nothing.
    lerpLocal(swingToe, swingToe === leftToe ? snapshot.toeLeft : snapshot.toeRight);
    actorSlot.updateMatrixWorld(true);
    // Pin the plant toe: translate the slot back by whatever the slerp moved it.
    const plantNow = toeWorld(plantToe);
    actorSlot.position.x = savedSlot.x + (anchorXz.x - plantNow.x);
    actorSlot.position.z = savedSlot.z + (anchorXz.z - plantNow.z);
    actorSlot.updateMatrixWorld(true);
    afterLeft = toeWorld(leftToe);
    afterRight = toeWorld(rightToe);
    const stepLeft = Math.hypot(afterLeft.x - beforeLeft.x, afterLeft.y - beforeLeft.y, afterLeft.z - beforeLeft.z);
    const stepRight = Math.hypot(afterRight.x - beforeRight.x, afterRight.y - beforeRight.y, afterRight.z - beforeRight.z);
    maxStepMeters = Math.max(stepLeft, stepRight);
    if (maxStepMeters <= cap || attempt === 4) break;
    attemptBlend /= 2;
  }
  // Done when every chain bone is within ~0.6 deg of rest and both toe locals within 3 mm.
  const quatDone = [leftToe, rightToe].every((toe) =>
    collectLegChain(toe, actorSlot).every((bone) => {
      const rest = snapshot.quats[bone.name];
      if (!rest) return true;
      restQuat.set(rest.x, rest.y, rest.z, rest.w);
      return bone.quaternion.angleTo(restQuat) < 0.01;
    }),
  );
  const localDone =
    leftToe.position.distanceTo(new Vector3(snapshot.toeLeft.x, snapshot.toeLeft.y, snapshot.toeLeft.z)) < 0.003
    && rightToe.position.distanceTo(new Vector3(snapshot.toeRight.x, snapshot.toeRight.y, snapshot.toeRight.z)) < 0.003;
  return {
    state: {
      anchorXz,
      done: (quatDone && localDone) || input.state.framesRun + 1 >= ARRIVAL_CLOSE_FRAME_CAP,
      framesRun: input.state.framesRun + 1,
      plantFoot: plantSide,
    },
    maxStepMeters,
    sepXz: Math.hypot(afterLeft.x - afterRight.x, afterLeft.z - afterRight.z),
  };
}

