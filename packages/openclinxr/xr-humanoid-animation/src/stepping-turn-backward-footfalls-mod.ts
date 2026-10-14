/**
 * Backward-planned turn footfalls (turn-backward slice): the turn's final pair by construction.
 *
 * CAUSE (measured, `.openclinxr/evidence/turn-backward/before`, plan on, n=3): the turn lands
 * each foot on its idle rest offset, but relative to a slot the walk left 0.099 m from the
 * target — turn-end toe-midpoint 0.096, final 0.095. The landing derives from the turn's ENTRY
 * pose (`stepping-turn-plan-mod.ts` threads `entrySlotXz` forward through the step arcs), so
 * where the pair ends depends on where the walk left the feet. The target is where the body
 * STANDS (`BEDSIDE_STANDOFF_METERS`, "standing clearance"), so the rest pair must end ON it.
 *
 * FIX (plan flag only): anchor the END. The final pair sits at its rest offsets about
 * `targetWorld` at the target heading (toe midpoint == targetWorld exactly: both toes share
 * the fore offset, laterals cancel), the final slot sits one fore offset behind the target,
 * and the earlier steps un-rotate backward from there — inverse of the step rotation about
 * the stance foot (`rotateXz` below is `stepping-turn-plan-mod.ts`'s `rotateAbout`; duplicated
 * rather than imported so the plan module binds no new public name). The walk slice (next)
 * removes the residual between the walk-exit stance and this list's start; step 0 keeps the
 * live entry stance, so the first step absorbs it (its reach is reported, gated by G2).
 *
 * EXACTNESS. The last step is exact for any step count: the final stance foot never moves
 * during it (its final spot IS the stance), and chaining makes every earlier landing that
 * same spot. Intermediate stances (3+ step turns only; SC-05 always plans 2) take the rest
 * rule about the backward slot path — slot-path pivots only, never the final pair. Every
 * swung foot's last move lands on a chained stance spot, so the final pair is at rest in the
 * final frame by construction.
 *
 * PURE GEOMETRY: no three.js, no bones, no mixer — same discipline as the plan module.
 */

import { restToeLanding, STEPPING_TURN_REST_FORE_OFFSET_M } from "./stepping-turn-rest-toe-landing-mod.js";
import type { StepFoot, SteppingTurnPlan, Xz } from "./stepping-turn-plan-mod.js";

export type BackwardTurnStepSpec = {
  swingFoot: StepFoot;
  /** Signed yaw this step covers (sums to the residual over all steps). */
  yawRadians: number;
};

export type BackwardTurnFootfallsInput = {
  /** World XZ of the stand target: the final toe midpoint lands here exactly. */
  targetXz: Xz;
  /** Absolute slot yaw at turn end (the plan lands exactly on target by construction). */
  targetHeadingRadians: number;
  /** Walk-start rest toe separation, world metres (must be > 0; validated by caller). */
  restSepM: number;
  /** Rest fore offset override, body frame (null/undefined keeps the measured idle anatomy). */
  restForeM?: number | null;
  /**
   * Turn step count and per-step yaw FROM THE EXISTING PLAN (same order, same signs):
   * the count, the yaw split and the swing sequence are the plan's; only the placements
   * are re-derived (backward from the target instead of forward from the entry).
   */
  steps: BackwardTurnStepSpec[];
};

export type BackwardTurnFootfallStep = {
  index: number;
  swingFoot: StepFoot;
  stanceFoot: StepFoot;
  yawRadians: number;
  /** Swing-foot world XZ placement: absolute, consumed verbatim by the turn. */
  swingToXz: Xz;
  /**
   * Stance-foot world XZ, fixed for the whole step. Step 0 is the IDEAL stance (rest in
   * step 0's end frame); the caller still anchors step 0 to the live entry stance and
   * reports live-minus-ideal as the walk residual.
   */
  stanceXz: Xz;
};

export type BackwardTurnFootfalls = {
  steps: BackwardTurnFootfallStep[];
  /** Backward slot at turn end: one fore offset behind the target at the target heading. */
  finalSlotXz: Xz;
  finalLeftXz: Xz;
  finalRightXz: Xz;
  /**
   * Step 0's ideal stance footfall (== steps[0].stanceXz, repeated for the report): the
   * walk-exit stance minus this is the residual the walk planning removes next.
   */
  idealFirstStanceXz: Xz;
};

function otherFoot(foot: StepFoot): StepFoot {
  return foot === "left" ? "right" : "left";
}

/** THREE Y-rotation convention (matches `rotateAbout` in `stepping-turn-plan-mod.ts`). */
function rotateXz(point: Xz, pivot: Xz, angleRadians: number): Xz {
  const dx = point.x - pivot.x;
  const dz = point.z - pivot.z;
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);
  return { x: pivot.x + dx * cos + dz * sin, z: pivot.z - dx * sin + dz * cos };
}

/** Absolute end yaw of step k: the plan lands exactly on target, so unroll backward. */
function endYawAt(input: BackwardTurnFootfallsInput, stepIndex: number): number {
  let yaw = input.targetHeadingRadians;
  for (let j = input.steps.length - 1; j > stepIndex; j -= 1) {
    yaw -= input.steps[j]?.yawRadians ?? 0;
  }
  return yaw;
}

function restFoot(input: BackwardTurnFootfallsInput, slotXz: Xz, endYaw: number, foot: StepFoot): Xz {
  return restToeLanding({
    slotEndXz: slotXz,
    endYawRadians: endYaw,
    swingFoot: foot,
    restSepM: input.restSepM,
    restForeM: input.restForeM ?? null,
  });
}

/** Build the ordered world footfalls of the turn, backward from the final pair. */
export function planBackwardTurnFootfalls(input: BackwardTurnFootfallsInput): BackwardTurnFootfalls {
  const count = input.steps.length;
  if (count < 1) throw new Error("planBackwardTurnFootfalls needs at least one step");
  const foreM = input.restForeM ?? STEPPING_TURN_REST_FORE_OFFSET_M;
  // Final slot: the pair midpoint sits foreM ahead of it at the target heading, so back off.
  const slotEnd: Xz = {
    x: input.targetXz.x - foreM * Math.sin(input.targetHeadingRadians),
    z: input.targetXz.z - foreM * Math.cos(input.targetHeadingRadians),
  };
  const finalPos: Record<StepFoot, Xz> = {
    left: restFoot(input, slotEnd, input.targetHeadingRadians, "left"),
    right: restFoot(input, slotEnd, input.targetHeadingRadians, "right"),
  };
  const stanceXz: Xz[] = new Array(count);
  const swingToXz: Xz[] = new Array(count);
  // Last step exact: the stance never moves during it; the landing is the final spot.
  const lastSpec = input.steps[count - 1];
  if (!lastSpec) throw new Error("planBackwardTurnFootfalls lost its last step");
  stanceXz[count - 1] = { ...finalPos[otherFoot(lastSpec.swingFoot)] };
  swingToXz[count - 1] = { ...finalPos[lastSpec.swingFoot] };
  let slot = rotateXz(slotEnd, stanceXz[count - 1] as Xz, -(lastSpec.yawRadians));
  // Earlier steps: chaining is exact (landing_k == stance_{k+1}); the stance takes the
  // rest rule in its own end frame about the backward slot path. At k = 0 `slot` is the
  // slot at the END of step 0, which is exactly the frame the ideal stance is defined in.
  for (let k = count - 2; k >= 0; k -= 1) {
    const spec = input.steps[k];
    if (!spec) throw new Error(`planBackwardTurnFootfalls lost step ${k}`);
    swingToXz[k] = { ...(stanceXz[k + 1] as Xz) };
    stanceXz[k] = restFoot(input, slot, endYawAt(input, k), otherFoot(spec.swingFoot));
    if (k > 0) slot = rotateXz(slot, stanceXz[k] as Xz, -(spec.yawRadians));
  }
  const first = stanceXz[0];
  if (!first) throw new Error("planBackwardTurnFootfalls lost its first stance");
  return {
    steps: input.steps.map((spec, index) => ({
      index,
      swingFoot: spec.swingFoot,
      stanceFoot: otherFoot(spec.swingFoot),
      yawRadians: spec.yawRadians,
      swingToXz: { ...(swingToXz[index] as Xz) },
      stanceXz: { ...(stanceXz[index] as Xz) },
    })),
    finalSlotXz: { ...slotEnd },
    finalLeftXz: { ...finalPos.left },
    finalRightXz: { ...finalPos.right },
    idealFirstStanceXz: { ...first },
  };
}

/** Live entry feet the turn's first step starts from (where the walk left them). */
export type BackwardTurnEntryFeet = { stanceXz: Xz; swingFromXz: Xz };

/**
 * Consume the footfall list in place of the entry-derived landing: swing placements and
 * stances (steps >= 1) come from the list verbatim. Step 0 keeps the live entry stance AND
 * swing-off, so the first step starts where the walk left the feet and absorbs the walk
 * residual in its reach. Yaw clock, durations and Y hand-off stay the plan's.
 */
export function overridePlanWithBackwardFootfalls(
  plan: SteppingTurnPlan,
  footfalls: BackwardTurnFootfalls,
  entry: { stanceXz: Xz; swingFromXz: Xz },
): SteppingTurnPlan {
  if (plan.steps.length !== footfalls.steps.length) {
    throw new Error("backward footfalls must match the plan step for step");
  }
  return {
    ...plan,
    steps: plan.steps.map((step, index) => {
      const foot = footfalls.steps[index];
      if (!foot || foot.swingFoot !== step.swingFoot) {
        throw new Error(`backward footfalls diverge from the plan at step ${index}`);
      }
      if (index === 0) {
        return { ...step, swingFromXz: { ...entry.swingFromXz }, swingToXz: { ...foot.swingToXz }, stanceXz: { ...entry.stanceXz } };
      }
      const prev = footfalls.steps[index - 1];
      if (!prev) throw new Error(`backward footfalls lost step ${index - 1}`);
      // The swing foot stood as the previous step's stance — except across step 0, whose
      // stance stayed live at the entry (the list's ideal was never stood on).
      const swingFromXz = index === 1 ? { ...entry.stanceXz } : { ...prev.stanceXz };
      return { ...step, swingFromXz, swingToXz: { ...foot.swingToXz }, stanceXz: { ...foot.stanceXz } };
    }),
  };
}

/** Live walk-exit stance minus the list's ideal first stance: the walk slice's residual. */
export function firstStanceResidualXz(
  footfalls: BackwardTurnFootfalls,
  liveStanceXz: Xz,
): { dx: number; dz: number; distM: number } {
  const dx = liveStanceXz.x - footfalls.idealFirstStanceXz.x;
  const dz = liveStanceXz.z - footfalls.idealFirstStanceXz.z;
  return { dx, dz, distM: Math.hypot(dx, dz) };
}

/**
 * Plan-flag gate for the execution module (kept here so that module stays at its zone
 * budget): forward when the flag is absent, the rest separation is invalid, or no target
 * was supplied; backward from the final pair otherwise.
 */
export function maybeOverridePlanWithBackwardFootfalls(input: {
  /** The plan built forward from the entry (its yaw split, sequence and clock are kept). */
  planned: SteppingTurnPlan;
  /** Entry toes (left/right) the first step's stance/swing-off are chosen from. */
  entryToes: { leftToeXz: Xz; rightToeXz: Xz };
  /** Turn-target world XZ the final pair anchors on; null skips (never overrides). */
  targetXz: Xz | null;
  targetHeadingRadians: number;
  /** Walk-start rest separation; null/invalid skips (the caller keeps its own gate). */
  restSepM: number | null;
  /** True only under `?footstepPlan=1` (read by the caller, passed in for node tests). */
  planEnabled: boolean;
}): SteppingTurnPlan {
  const { planned } = input;
  if (!input.planEnabled || input.targetXz === null) return planned;
  const restSep = input.restSepM;
  if (restSep === null || !(restSep > 0)) return planned;
  const first = planned.steps[0];
  if (!first) return planned;
  return overridePlanWithBackwardFootfalls(
    planned,
    planBackwardTurnFootfalls({
      targetXz: { x: input.targetXz.x, z: input.targetXz.z },
      targetHeadingRadians: input.targetHeadingRadians,
      restSepM: restSep,
      steps: planned.steps.map((s) => ({ swingFoot: s.swingFoot, yawRadians: s.yawRadians })),
    }),
    {
      stanceXz: first.stanceFoot === "left" ? { ...input.entryToes.leftToeXz } : { ...input.entryToes.rightToeXz },
      swingFromXz: first.swingFoot === "left" ? { ...input.entryToes.leftToeXz } : { ...input.entryToes.rightToeXz },
    },
  );
}
