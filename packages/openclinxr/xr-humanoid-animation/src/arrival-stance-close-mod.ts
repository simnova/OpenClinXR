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
 *
 * ## CHANGED (was "## NOT FIXED"): the two prior gate attempts below both tried to separate a
 * dragging step from a legitimate one by a signal read off the toe's CURRENT state (height, or
 * remaining distance) — and both failed for the reason recorded: neither signal can tell "this toe
 * is near the floor because it is being dragged" from "this toe is near the floor because that is
 * where a legitimate swing step happens to be right now". `stopSlideL/R`'s own contact test used
 * `FOOT_CONTACT_HEIGHT_METERS` (0.06 m) to decide which frames to grade at all — the same signal
 * that could not separate the two cases at the gate. The walking clauses in the same test do not
 * have this problem: they grade by the clip's own labelled stance (`labelledStance`), not a height
 * band, so a swing foot is simply never graded while it is swinging. This close now publishes the
 * same kind of label — which toe is this frame's PLANT vs its SWING — onto `approach.lock`
 * (`case-owned-approach-frame-mod.ts`'s arrived branch), and the test reads it instead of the band
 * for `stopSlideL/R`, exactly as it already does for `walkSlideL/R`. The swing toe passing below
 * the 0.06 m band while it glides beside the plant foot is no longer a signal the test has to
 * interpret — it is simply excluded from the plant-side measurement, the same way a walking swing
 * foot already is.
 *
 * The two REVERTED attempts, kept for the record:
 *   - Height-above-floor gated (tight cap only when the swing toe reads near the floor): reduced
 *     the metric to 0.019 m (still over) and pushed `the-arrived-stance-closes.test.ts`'s own
 *     150-frame/0.06 m convergence fixture to 0.070 m (over its own cap) — that fixture's swing
 *     toe is DELIBERATELY held near the floor for its whole 0.5 m-split scenario, so a height
 *     signal cannot tell "dragging near the floor" from "that fixture's own known-good case".
 *   - Remaining-XZ-distance gated (tight cap only once the swing toe is nearly home): converged
 *     the fixture, but SC-05's own worst frame turned out to occur EARLY in its convergence, while
 *     remaining distance is still large — so this gate never engaged for it at all (measured:
 *     identical 0.024 m to the unmodified default).
 *
 * ALSO CHANGED: the swing toe's per-frame target now includes a minimum-jerk LIFT ARC (see
 * `ARRIVAL_CLOSE_SWING_LIFT_METERS`/`arrivalCloseSwingLiftFraction` below), the same triangular
 * rise-then-fall `settling-step-turn-mod.ts`'s `swingLiftFraction` already uses for the settling
 * turn's own steps. Before this the swing toe's target was the direct blend toward rest with no
 * height term of its own — whatever vertical motion it had came only from the rest snapshot's own
 * y differing from its current y, which for a stance already inside the contact band is small to
 * none: a real drag, not a step. The arc rises and falls to zero exactly at the rest target, so a
 * fully converged close ends at the same pose it always did.
 */

/** Plant-designation hysteresis: sub-epsilon dips never swap the plant foot. */
export const ARRIVAL_CLOSE_PLANT_HYSTERESIS_METERS = 0.005;

/** Blend per arrived frame toward rest. 0.12 converges a 0.075 m gap in ~32 frames. */
export const ARRIVAL_CLOSE_BLEND = 0.12;

/**
 * Peak height the swing toe's arc adds above the direct rest-blend target, in metres — the
 * "natural minimum toe clearance" range (~1.5-2 cm) named for this close, kept a little under the
 * 2 cm ceiling so a swing segment ending early (the frame cap, or a role swap) never leaves more
 * than a couple of millimetres of residual arc height on a toe the caller is about to call settled.
 */
export const ARRIVAL_CLOSE_SWING_LIFT_METERS = 0.018;

/**
 * x(t) = 10t^3 - 15t^4 + 6t^5, the minimum-jerk quintic on [0, 1]. Mirrors
 * `settling-step-turn-mod.ts`'s own local copy (same formula, same reason it is not a shared
 * export — see that file's header).
 */
function minimumJerkSample(t: number): number {
  const p = t < 0 ? 0 : t > 1 ? 1 : t;
  return 10 * p ** 3 - 15 * p ** 4 + 6 * p ** 5;
}

/**
 * Swing-toe lift fraction for this close, on [0, 1]: a triangular minimum-jerk rise then fall,
 * peaking at mid-convergence — the same shape `settling-step-turn-mod.ts`'s `swingLiftFraction`
 * uses for a walking step, applied here to a close's own progress (how much of THIS swing
 * segment's starting gap has closed) instead of a step's elapsed-time fraction.
 */
function arrivalCloseSwingLiftFraction(progress: number): number {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  return p <= 0.5 ? minimumJerkSample(p * 2) : minimumJerkSample((1 - p) * 2);
}

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
  /**
   * Which foot the swing-lift arc's progress is being tracked for. A role swap (this foot
   * differing from the current swing toe) resets the arc's segment: the newly-swinging foot
   * starts its own arc from 0, not wherever the previous swinger's arc had reached.
   */
  swingSegmentFoot: "left" | "right" | null;
  /**
   * Local-space distance from the swing toe's position at the START of its current segment to
   * its rest local — the arc progress denominator. Local space, not world: this is a progress
   * FRACTION only, never fed to a cap or a claim in metres (the actual per-frame world step, arc
   * included, is still bounded by the existing `maxStepMeters` halving loop below).
   */
  swingSegmentStartDistance: number;
};

export function createArrivalCloseState(): ArrivalCloseState {
  return {
    anchorXz: null,
    done: false,
    framesRun: 0,
    plantFoot: null,
    swingSegmentFoot: null,
    swingSegmentStartDistance: 0,
  };
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
      state: {
        anchorXz: input.state.anchorXz,
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
  // THE SWING ARC (see this file's header note). Progress is a FRACTION of how much of this
  // swing segment's starting gap has closed, measured in the toe's own local space — never fed to
  // a cap in metres, only to shape where the arc's minimum-jerk hump currently sits. A role swap
  // (this frame's swing toe differing from the last frame's) resets the segment: the newly-landed
  // former-plant foot starts its own arc from 0, not wherever the last swinger's had reached.
  //
  // XZ ONLY, DELIBERATELY: measured feeding the FULL 3D remaining distance (Y included) back into
  // its own next frame — the arc's own lift raises Y, so "how much closer is Y" partly reports the
  // arc's own previous contribution, not the underlying convergence. That closed a loop: bump grows
  // -> Y moves further from a Y-inclusive "remaining" on some frames than it started -> progress
  // clamps to 0 -> bump drops to 0 next frame -> the leg never reaches `localDone`'s 3 mm band, so
  // the whole close stalls at "active" for the rest of the observed run (measured: 0 contact frames
  // ever published for the OTHER foot in SC-05, because `closeActive` never yields to double
  // support). XZ is exactly the horizontal component the arc does not touch, so it is monotone
  // regardless of how large a lift this or the previous frame added.
  const swingSideId: "left" | "right" = swingToe === leftToe ? "left" : "right";
  const swingRestLocal = swingSideId === "left" ? snapshot.toeLeft : snapshot.toeRight;
  const savedSwingLocal = savedLocals.get(swingToe) ?? copyVec(swingToe);
  const remainingBeforeThisFrame = Math.hypot(
    savedSwingLocal.x - swingRestLocal.x,
    savedSwingLocal.z - swingRestLocal.z,
  );
  let swingSegmentFoot = input.state.swingSegmentFoot ?? null;
  let swingSegmentStartDistance = input.state.swingSegmentStartDistance ?? 0;
  if (swingSegmentFoot !== swingSideId) {
    swingSegmentFoot = swingSideId;
    swingSegmentStartDistance = remainingBeforeThisFrame;
  }
  const swingProgress =
    swingSegmentStartDistance > 1e-6
      ? Math.min(1, Math.max(0, 1 - remainingBeforeThisFrame / swingSegmentStartDistance))
      : 1;
  const swingLiftMeters = ARRIVAL_CLOSE_SWING_LIFT_METERS * arrivalCloseSwingLiftFraction(swingProgress);
  const liftedSwingRest: Vec3 = { ...swingRestLocal, y: swingRestLocal.y + swingLiftMeters };
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
    // written, so its world spot never drifts and the pin below moves nothing. The target
    // includes this frame's arc lift (see above); it rides the SAME attemptBlend halving as
    // the rest of the swing lerp, so the existing per-frame world-step cap below bounds the
    // lifted step exactly as it always bounded the flat one.
    lerpLocal(swingToe, liftedSwingRest);
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
      swingSegmentFoot,
      swingSegmentStartDistance,
    },
    maxStepMeters,
    sepXz: Math.hypot(afterLeft.x - afterRight.x, afterLeft.z - afterRight.z),
  };
}

