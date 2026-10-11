/**
 * Procedural stepping-turn PLAN (2026-10-11): turn-in-place as lift-and-place steps.
 *
 * WHY THIS EXISTS. Every approach design fails its slide budget in the 62-63 deg in-place
 * arrival turn, and the room cannot fit a facing-arrival path
 * (`docs/openclinxr/locomotion/arrival-turn-cagematch-2026-10-11.md`). The runtime's
 * settling turn rotates the body while feet pivot/slide; a human turns by LIFTING AND
 * PLACING each foot. This module plans that: N alternating steps for the residual yaw,
 * each lifting the swing foot on a smooth arc and placing it under the moving torso,
 * pelvis yaw following the feet.
 *
 * PLACEMENTS ARE BODY-RELATIVE, not rotated about the stance foot. An earlier revision
 * rotated each placement about the pinned stance and gathered the pair toward shoulder
 * width: the asymmetric gather (only the swing foot moves) drags the pair midpoint
 * toward the stance by half the gathered distance while the slot is unaffected —
 * measured 91-165 mm of pair-vs-slot offset at hold across rigs (a lunge the far leg
 * spans as 29 deg of knee bend), invariant across yaw splits 0.05-0.9. Predicting the
 * slot's rigid arc about each stance (closed form, exact to 0.1 mm against the assay)
 * and landing each swing under the predicted slot keeps the pair under the pelvis by
 * construction; migration magnitude is unchanged, but torso and feet travel together.
 *
 * PURE GEOMETRY: no three.js, no bones, no mixer. Inputs are world-XZ foot positions and
 * yaws; outputs are per-step placements plus a per-frame evaluator. The runtime execution
 * (`stepping-turn-execution-mod.ts`) consumes this; the headless assay poses its markers
 * from the same published targets the browser feeds its leg hinge with.
 *
 * Rhythm reference (not shipped): 2 steps for <= 90 deg, ~0.6-0.8 s per step, foot lift a
 * few cm, body yaw following the feet, ending shoulder-width apart facing the target.
 */

export type StepFoot = "left" | "right";

export type Xz = { x: number; z: number };

/** Max yaw one step covers: 45 deg, so a <= 90 deg residual plans exactly 2 steps. */
export const STEPPING_TURN_MAX_STEP_YAW_RADIANS = (45 * Math.PI) / 180;
/** Per-step duration: 0.7 s, inside the 0.6-0.8 s reference rhythm. */
export const STEPPING_TURN_STEP_DURATION_S = 0.7;
/** Swing-foot lift peak above the stance baseline: 0.030 m on every rig (NOT
 * leg-scaled). Clearance is absolute — floor bumps do not scale with legs — and the
 * 0.02 m lift bar is absolute too; scaling the lift down with the child (0.021 m)
 * left only 0.019 m measured after the landing morph, under the bar. The flexion cost
 * of the unscaled lift on short legs is measured per rig in the bake instead.
 */
export const STEPPING_TURN_LIFT_PEAK_M = 0.03;
/**
 * Pelvis dip peak during each step, physician scale (rig-scaled with the rest): small
 * enough to read as weight acceptance, large enough to share the lift span with the
 * knee. The dip SHORTENS spans (hip drops toward the heel), so it costs stance-side
 * flexion to buy swing-side smoothness; 0.015 keeps both sides inside their bars.
 * Stance Y targets stay world (the pin is XZ-only), so the dip never grinds a foot
 * into the floor.
 */
export const STEPPING_TURN_PELVIS_DIP_M = 0.015;
/**
 * Half inter-foot distance at placement (physician scale, leg-scaled per rig): feet
 * land 0.25 m apart (shoulder width), square under the torso. Each step's goal width
 * lerps from the live entry width toward shoulder across the turn, so a wide
 * mid-stride entry (0.42-0.53 m on SC-05) gathers progressively instead of dumping the
 * whole gather into step 0's travel (measured: the child's 0.42 m entry gathered to
 * 0.18 m in one step flew the swing heel 0.3 m+ and bent the short leg 68 deg).
 * Narrow entries keep their width throughout (never spread).
 */
export const STEPPING_TURN_REST_HALF_WIDTH_M = 0.125;
/**
 * Walk-start rest toe-separation scale reference, world meters: calibrates the rig
 * leg-length scale (see `steppingTurnLegScale`). Measured per rig on the same ward:
 * physician 0.5804, nurse 0.6246, child 0.4259 (walk-clip rest frame, identical phase
 * across rigs). Calibrated against independent leg-length spans (physician 0.7276,
 * child 0.5116, ratio 0.703): REF 0.6058 puts the physician at 0.96, the nurse at
 * 1.03 and the child at 0.70, bounding stance-proportion residuals to ±4%. A
 * physician-anchored REF (0.5804) instead overscales the nurse 8% and the child 5%.
 */
export const STEPPING_TURN_REST_SEP_REF_M = 0.6058;
/** Leg-length spatial scale from a walk-start rest separation. 1.0 when unknown. */
export function steppingTurnLegScale(restSepXzM: number | null | undefined): number {
  if (restSepXzM === null || restSepXzM === undefined || !(restSepXzM > 0)) return 1;
  return Math.min(1.2, Math.max(0.65, restSepXzM / STEPPING_TURN_REST_SEP_REF_M));
}

export type SteppingTurnStep = {
  index: number;
  swingFoot: StepFoot;
  stanceFoot: StepFoot;
  /** Signed yaw this step covers (sums to the residual over all steps). */
  yawRadians: number;
  /** Absolute slot yaw at this step's start. */
  yawStartRadians: number;
  startS: number;
  durationS: number;
  /** Swing-foot world XZ at lift-off and at placement. */
  swingFromXz: Xz;
  swingToXz: Xz;
  /** Stance-foot world XZ, fixed for the whole step. */
  stanceXz: Xz;
  /**
   * World Y the stance foot holds this step. Step 0 keeps the foot's live entry height
   * (no first-frame snap); later steps hold the baseline their foot landed at.
   */
  stanceY: number;  /**
   * World Y the swing foot leaves from. Step 0 keeps its live entry height; later steps
   * leave from wherever the foot was pinned as stance (continuous by construction).
   */
  swingFromY: number;
};

export type SteppingTurnPlan = {
  steps: SteppingTurnStep[];
  totalS: number;
  residualYawRadians: number;
  targetHeadingRadians: number;
  entryYawRadians: number;
  /** World Y the stance foot holds and the swing arc rises from. */
  stanceBaselineY: number;
  liftPeakM: number;
  legScale: number;
};

function minimumJerkSample(t: number): number {
  const p = t < 0 ? 0 : t > 1 ? 1 : t;
  return 10 * p ** 3 - 15 * p ** 4 + 6 * p ** 5;
}

function rotateAbout(point: Xz, pivot: Xz, angleRadians: number): Xz {
  const dx = point.x - pivot.x;
  const dz = point.z - pivot.z;
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);
  // THREE Y-rotation convention (matches pivotSlotAroundAnchor, stance-lock-ik.ts):
  // x' = x*cos + z*sin, z' = -x*sin + z*cos.
  return { x: pivot.x + dx * cos + dz * sin, z: pivot.z - dx * sin + dz * cos };
}

/**
 * Plan N alternating lift-and-place steps covering `residualYawRadians`.
 *
 * The INNER foot swings first: for a positive (toward-body-right) residual that is the
 * right foot, else the left. It has the shorter arc into the new heading, and stepping it
 * first keeps the weight on the outer leg as a stable pivot while the turn opens — the
 * reference rhythm's "inner foot steps first".
 */
export type SteppingTurnPlanInput = {
  residualYawRadians: number;
  entryYawRadians: number;
  targetHeadingRadians: number;
  leftToeXz: Xz;
  rightToeXz: Xz;
  leftToeY: number;
  rightToeY: number;
  stanceBaselineY: number;
  /** Slot XZ at entry: placements land relative to the torso predicted from here. */
  entrySlotXz: Xz;
  /** Rig leg-length spatial scale (1 = physician): scales widths and dip. */
  legScale: number;
};

/** Plan N alternating lift-and-place steps covering the residual yaw. */
export function planSteppingTurn(input: SteppingTurnPlanInput): SteppingTurnPlan {
  const { residualYawRadians, entryYawRadians, targetHeadingRadians, stanceBaselineY } = input;
  const direction = residualYawRadians >= 0 ? 1 : -1;
  const stepCount = Math.max(
    1,
    Math.ceil(Math.abs(residualYawRadians) / STEPPING_TURN_MAX_STEP_YAW_RADIANS),
  );
  const firstSwing: StepFoot = direction > 0 ? "right" : "left";
  const feet: Record<StepFoot, Xz> = {
    left: { ...input.leftToeXz },
    right: { ...input.rightToeXz },
  };
  // Goal-width schedule: lerp entry width toward shoulder across the steps so travel
  // distributes evenly instead of front-loading the gather. Never spreads.
  const entryWidth = Math.hypot(
    input.leftToeXz.x - input.rightToeXz.x,
    input.leftToeXz.z - input.rightToeXz.z,
  );
  const shoulderWidth = 2 * STEPPING_TURN_REST_HALF_WIDTH_M * input.legScale;
  // Per-foot world Y, threaded through the plan like XZ so every hand-off is continuous:
  // a foot starts a swing where its stance hold left it, and starts a stance where its
  // swing landed (the baseline). Only step 0 reads live heights, so nothing snaps.
  const footY: Record<StepFoot, number> = { left: input.leftToeY, right: input.rightToeY };
  const steps: SteppingTurnStep[] = [];
  let yawStart = entryYawRadians;
  let clockS = 0;
  // Predicted slot, threaded through the plan: each step arcs it rigidly about the
  // stance anchor by that step's yaw (the stance pin's closed form, exact). Goals land
  // under the predicted torso, so the pair travels WITH the slot instead of being
  // left behind by it.
  let slotPred = { ...input.entrySlotXz };
  for (let index = 0; index < stepCount; index += 1) {
    // Last step takes exactly the remainder so the plan lands on the target, not near it.
    const remaining = residualYawRadians - steps.reduce((sum, s) => sum + s.yawRadians, 0);
    const yaw = index === stepCount - 1 ? remaining : direction * Math.abs(residualYawRadians) / stepCount;
    const swingFoot: StepFoot = index % 2 === 0 ? firstSwing : firstSwing === "left" ? "right" : "left";
    const stanceFoot: StepFoot = swingFoot === "left" ? "right" : "left";
    const stanceXz = { ...feet[stanceFoot] };
    const swingFromXz = { ...feet[swingFoot] };
    // Body-centered goal: under the PREDICTED END slot at the step-end heading, square
    // (lateral rest offset, no fore/aft split — the turn squares the stance). Predicting
    // to the step end (not start) matters: the slot arcs about the stance during the
    // step, and a start-relative goal goes stale by the arc displacement (measured
    // 119 mm of hold offset with start-relative goals on SC-05 entries). The stance
    // stays exactly where it stands; only the swing travels.
    const yawEnd = yawStart + yaw;
    const slotEnd = rotateAbout(slotPred, stanceXz, yaw);
    const lateral: Xz = { x: Math.cos(yawEnd), z: -Math.sin(yawEnd) };
    const side = swingFoot === "right" ? 1 : -1;
    const goalWidth = Math.min(
      entryWidth,
      entryWidth + (shoulderWidth - entryWidth) * ((index + 1) / stepCount),
    );
    const swingToXz = {
      x: slotEnd.x + lateral.x * side * (goalWidth / 2),
      z: slotEnd.z + lateral.z * side * (goalWidth / 2),
    };
    // Step 0 keeps live heights (no snap); later steps continue from the hand-off:
    // stance holds what the foot landed at (baseline), swing leaves what its hold left.
    const stanceY = index === 0 ? footY[stanceFoot] : stanceBaselineY;
    const swingFromY = footY[swingFoot];
    steps.push({
      index,
      swingFoot,
      stanceFoot,
      yawRadians: yaw,
      yawStartRadians: yawStart,
      startS: clockS,
      durationS: STEPPING_TURN_STEP_DURATION_S,
      swingFromXz,
      swingToXz,
      stanceXz,
      stanceY,
      swingFromY,
    });
    feet[swingFoot] = swingToXz;
    footY[swingFoot] = stanceBaselineY;
    // The morphed stance below ends at the baseline, so the next step leaves from
    // there — not from the live height this step started at.
    footY[stanceFoot] = stanceBaselineY;
    // Advance the predicted slot through this step's rigid arc (stance-pin closed
    // form) so the next goal is relative to where the torso will be, not where it is.
    slotPred = slotEnd;
    yawStart += yaw;
    clockS += STEPPING_TURN_STEP_DURATION_S;
  }
  return {
    steps,
    totalS: clockS,
    residualYawRadians,
    targetHeadingRadians,
    entryYawRadians,
    stanceBaselineY,
    liftPeakM: STEPPING_TURN_LIFT_PEAK_M,
    legScale: input.legScale,
  };
}

export type SteppingTurnTargets = {
  stepIndex: number;
  /** 0..1 phase within the step. */
  u: number;
  /** Absolute slot yaw the pelvis holds this frame. */
  yawRadians: number;
  /** Slot Y drop below the entry height this frame (0 at placements). */
  pelvisDipM: number;
  stanceFoot: StepFoot;
  swingFoot: StepFoot;
  stanceToe: { x: number; y: number; z: number };
  swingToe: { x: number; y: number; z: number };
  done: boolean;
};

/** Per-frame evaluator: where the slot and both feet are at `elapsedS` into the plan. */
export function steppingTurnAt(plan: SteppingTurnPlan, elapsedS: number): SteppingTurnTargets {
  const lastIndex = plan.steps.length - 1;
  let step = plan.steps[lastIndex];
  if (!step) {
    throw new Error("steppingTurnAt evaluated an empty plan");
  }
  for (const candidate of plan.steps) {
    if (elapsedS < candidate.startS + candidate.durationS) {
      step = candidate;
      break;
    }
  }
  const u = Math.min(1, Math.max(0, (elapsedS - step.startS) / step.durationS));
  const shaped = minimumJerkSample(u);
  const yawRadians = step.yawStartRadians + step.yawRadians * shaped;
  // Swing path: straight min-jerk glide from lift-off to the body-relative
  // placement. Footsteps travel roughly straight; the placement (not the path shape)
  // is what the turn guarantees, and a straight blend lands EXACTLY on swingToXz at
  // u = 1 with no boundary teleport by construction.
  const swingXz = {
    x: step.swingFromXz.x + (step.swingToXz.x - step.swingFromXz.x) * shaped,
    z: step.swingFromXz.z + (step.swingToXz.z - step.swingFromXz.z) * shaped,
  };
  // Stance Y morphs from its (continuous) entry height to the baseline landing on
  // step 0 — the foot plants from a mid-stride hold to the rig's natural standing
  // height instead of floating a walk-pose hold for the whole turn (measured: a 6 cm
  // float bent the bake knees 44-62 deg). Later steps hold the baseline throughout,
  // so the morph is identity there. Slide is XZ; this descent is planting, not slide.
  const stanceY = step.stanceY + (plan.stanceBaselineY - step.stanceY) * shaped;
  // Swing Y morphs from its (continuous) lift-off height to the baseline landing, plus
  // the lift arc.
  const swingY = step.swingFromY + (plan.stanceBaselineY - step.swingFromY) * shaped
    + plan.liftPeakM * Math.sin(Math.PI * u);
  return {
    stepIndex: step.index,
    u,
    yawRadians,
    pelvisDipM: STEPPING_TURN_PELVIS_DIP_M * plan.legScale * Math.sin(Math.PI * u),
    stanceFoot: step.stanceFoot,
    swingFoot: step.swingFoot,
    stanceToe: { x: step.stanceXz.x, y: stanceY, z: step.stanceXz.z },
    swingToe: {
      x: swingXz.x,
      y: swingY,
      z: swingXz.z,
    },
    done: elapsedS >= plan.totalS,
  };
}
