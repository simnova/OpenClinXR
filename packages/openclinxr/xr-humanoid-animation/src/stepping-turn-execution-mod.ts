import type { Object3D } from "three";
import {
  planSteppingTurn,
  steppingTurnAt,
  type SteppingTurnPlan,
  type SteppingTurnTargets,
} from "./stepping-turn-plan-mod.js";
import {
  findSteppingLegChain,
  heelTargetForToeTarget,
  solveSteppingLegCcd,
} from "./stepping-turn-leg-ik-mod.js";
import { worldXyz } from "./stance-lock-ik.js";

/**
 * Stepping-turn EXECUTION (2026-10-11): run a `SteppingTurnPlan` through the settling phase.
 *
 * PER FRAME (flag on only; the caller owns the flag and the settling-phase gate):
 *  1. advance the plan clock, evaluate slot yaw + both toe world targets;
 *  2. write slot yaw (the pelvis follows the feet, per the plan);
 *  3. translate the slot XZ so the stance toe's world lands exactly on its anchor —
 *     zero slide by construction, the same exact-translate discipline
 *     `pivotSlotAroundAnchor` (stance-lock-ik.ts) uses for yaw pivots;
 *  4. where leg bones exist (browser rig), CCD each leg to its heel target derived
 *     from the toe target via the foot's current heel-to-toe offset; where they do
 *     not (headless assay markers), skip — the assay poses its markers from the
 *     published targets instead, and the toe locals are never written (writing a
 *     toe's local position moves only the toe, not the leg: the detached-toe trap).
 *
 * The returned targets are the published contract: the caller mirrors stanceFoot into
 * the settling-phase evidence fields and the assay poses its markers from them.
 */

export type SteppingTurnExecState = {
  plan: SteppingTurnPlan;
  elapsedS: number;
  lastTargets: SteppingTurnTargets | null;
};

function shortestYawDelta(fromRadians: number, toRadians: number): number {
  return Math.atan2(Math.sin(toRadians - fromRadians), Math.cos(toRadians - fromRadians));
}

/** Capture the entry pose and plan the turn. Null when there are no live toes to plan from. */
export function beginSteppingTurn(input: {
  actorSlot: Object3D;
  leftToe: Object3D | null;
  rightToe: Object3D | null;
  targetHeadingRadians: number;
  floorOriginY: number;
}): SteppingTurnExecState | null {
  const { actorSlot, leftToe, rightToe } = input;
  if (leftToe === null || rightToe === null) return null;
  actorSlot.updateMatrixWorld(true);
  leftToe.updateMatrixWorld(true);
  rightToe.updateMatrixWorld(true);
  const leftWorld = worldXyz(leftToe);
  const rightWorld = worldXyz(rightToe);
  const entryYaw = actorSlot.rotation.y;
  const plan = planSteppingTurn({
    residualYawRadians: shortestYawDelta(entryYaw, input.targetHeadingRadians),
    entryYawRadians: entryYaw,
    targetHeadingRadians: input.targetHeadingRadians,
    leftToeXz: { x: leftWorld.x, z: leftWorld.z },
    rightToeXz: { x: rightWorld.x, z: rightWorld.z },
    leftToeY: leftWorld.y,
    rightToeY: rightWorld.y,
    stanceBaselineY: Math.min(leftWorld.y, rightWorld.y),
  });
  return { plan, elapsedS: 0, lastTargets: steppingTurnAt(plan, 0) };
}

export function advanceSteppingTurn(input: {
  actorSlot: Object3D;
  leftToe: Object3D | null;
  rightToe: Object3D | null;
  deltaSeconds: number;
  state: SteppingTurnExecState;
}): SteppingTurnTargets {
  const { actorSlot, state } = input;
  state.elapsedS += input.deltaSeconds;
  const targets = steppingTurnAt(state.plan, state.elapsedS);
  state.lastTargets = targets;

  // Pelvis yaw follows the feet.
  actorSlot.rotation.y = targets.yawRadians;
  actorSlot.updateMatrixWorld(true);

  // Shape the legs where bones exist, then pin the stance toe to its anchor with an
  // exact rigid translate. Headless markers resolve no chain and skip the CCD, so the
  // pin reads the assay-posed locals there.
  //
  // ORDER (measured 2026-10-11: the reverse order walks the slot). The pin must read the
  // POST-CCD stance world, not the pre-CCD one: the mixer keeps playing the walk clip
  // underneath (leg weight 0.4), so the pre-CCD stance world is a walk-pose sample —
  // pinning THAT teleports the slot by the walk sample's own discontinuity every frame
  // (measured 0.42 m of slot travel on the child) and the subsequent CCD only moves the
  // foot. CCD first puts the foot where the plan says; the pin then cancels only the
  // yaw rotation's own displacement plus CCD residue — the exact-translate discipline
  // `compensateSlotForYawChange` (stance-lock-ik.ts) uses, rather than a drift chase.
  // Two passes: the second pin moves the slot by the first CCD's residue (~0.1 mm), so
  // the heel it disturbs stays within the probe-measured CCD miss.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const side of ["left", "right"] as const) {
      const chain = findSteppingLegChain(actorSlot, side);
      if (chain === null) continue;
      const toeTarget = side === targets.stanceFoot ? targets.stanceToe : targets.swingToe;
      const heelTarget = heelTargetForToeTarget({ chain, toeTargetWorld: toeTarget });
      solveSteppingLegCcd({ chain, heelTargetWorld: heelTarget });
    }
    actorSlot.updateMatrixWorld(true);
    const stanceToe = targets.stanceFoot === "left" ? input.leftToe : input.rightToe;
    if (stanceToe !== null) {
      stanceToe.updateMatrixWorld(true);
      const world = worldXyz(stanceToe);
      actorSlot.position.x += targets.stanceToe.x - world.x;
      actorSlot.position.z += targets.stanceToe.z - world.z;
      actorSlot.updateMatrixWorld(true);
    }
  }
  return targets;
}
