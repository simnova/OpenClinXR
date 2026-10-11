/**
 * Procedural stepping-turn PLAN (2026-10-11): turn-in-place as lift-and-place steps.
 *
 * WHY THIS EXISTS. Every approach design fails its slide budget in the 62-63 deg in-place
 * arrival turn, and the room cannot fit a facing-arrival path
 * (`docs/openclinxr/locomotion/arrival-turn-cagematch-2026-10-11.md`). The runtime's
 * settling turn rotates the body while feet pivot/slide; a human turns by LIFTING AND
 * PLACING each foot. This module plans that: N alternating steps for the residual yaw,
 * each lifting the swing foot on a smooth arc and placing it rotated about the pinned
 * stance foot, pelvis yaw following the feet.
 *
 * PURE GEOMETRY: no three.js, no bones, no mixer. Inputs are world-XZ foot positions and
 * yaws; outputs are per-step placements plus a per-frame evaluator. The runtime execution
 * (`stepping-turn-execution-mod.ts`) consumes this; the headless assay poses its markers
 * from the same published targets the browser feeds its leg CCD with.
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
/** Swing-foot lift peak above the stance baseline: a few cm. */
export const STEPPING_TURN_LIFT_PEAK_M = 0.035;
/**
 * Inter-foot distance placements converge toward: shoulder width. Settling entry inherits
 * the walk's mid-stride split (0.42-0.53 m measured on SC-05), and rotating about pivots
 * that wide walks the torso off the arrival spot (measured 0.30-0.36 m of slot travel on
 * a pure rotate-about-stance plan). Gathering each placement toward shoulder width keeps
 * pivot radii small so the turn happens in place; the reference ends shoulder-width apart.
 */
export const STEPPING_TURN_SHOULDER_WIDTH_M = 0.25;

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
  stanceY: number;
  /**
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
export function planSteppingTurn(input: {
  residualYawRadians: number;
  entryYawRadians: number;
  targetHeadingRadians: number;
  leftToeXz: Xz;
  rightToeXz: Xz;
  leftToeY: number;
  rightToeY: number;
  stanceBaselineY: number;
}): SteppingTurnPlan {
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
  // Per-foot world Y, threaded through the plan like XZ so every hand-off is continuous:
  // a foot starts a swing where its stance hold left it, and starts a stance where its
  // swing landed (the baseline). Only step 0 reads live heights, so nothing snaps.
  const footY: Record<StepFoot, number> = { left: input.leftToeY, right: input.rightToeY };
  const steps: SteppingTurnStep[] = [];
  let yawStart = entryYawRadians;
  let clockS = 0;
  for (let index = 0; index < stepCount; index += 1) {
    // Last step takes exactly the remainder so the plan lands on the target, not near it.
    const remaining = residualYawRadians - steps.reduce((sum, s) => sum + s.yawRadians, 0);
    const yaw = index === stepCount - 1 ? remaining : direction * Math.abs(residualYawRadians) / stepCount;
    const swingFoot: StepFoot = index % 2 === 0 ? firstSwing : firstSwing === "left" ? "right" : "left";
    const stanceFoot: StepFoot = swingFoot === "left" ? "right" : "left";
    const stanceXz = { ...feet[stanceFoot] };
    const swingFromXz = { ...feet[swingFoot] };
    const rotated = rotateAbout(swingFromXz, stanceXz, yaw);
    // Gather toward shoulder width (see STEPPING_TURN_SHOULDER_WIDTH_M): rotation alone
    // preserves a mid-stride split, and pivots that wide walk the torso off the spot.
    const dx = rotated.x - stanceXz.x;
    const dz = rotated.z - stanceXz.z;
    const dist = Math.hypot(dx, dz);
    const swingToXz = dist > STEPPING_TURN_SHOULDER_WIDTH_M
      ? {
        x: stanceXz.x + (dx / dist) * STEPPING_TURN_SHOULDER_WIDTH_M,
        z: stanceXz.z + (dz / dist) * STEPPING_TURN_SHOULDER_WIDTH_M,
      }
      : rotated;
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
    footY[stanceFoot] = stanceY;
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
  };
}

export type SteppingTurnTargets = {
  stepIndex: number;
  /** 0..1 phase within the step. */
  u: number;
  /** Absolute slot yaw the pelvis holds this frame. */
  yawRadians: number;
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
  // Swing path: rotate about the stance foot, then gather radially toward the planned
  // placement. The gather (shoulder-width cap) keeps the endpoint on the rotation ray by
  // construction, so scaling the rotated offset by a shaped 1 -> gatherScale lands
  // EXACTLY on swingToXz at u = 1 — a pure rotation would strand the endpoint at the
  // ungathered radius and teleport across the gather gap on the step boundary (measured
  // 0.226 m on the physician).
  const rotated = rotateAbout(step.swingFromXz, step.stanceXz, step.yawRadians * shaped);
  const endRadius = Math.hypot(step.swingToXz.x - step.stanceXz.x, step.swingToXz.z - step.stanceXz.z);
  const rotatedEnd = rotateAbout(step.swingFromXz, step.stanceXz, step.yawRadians);
  const rotatedEndRadius = Math.hypot(rotatedEnd.x - step.stanceXz.x, rotatedEnd.z - step.stanceXz.z);
  const gatherScale = rotatedEndRadius > 1e-9 ? endRadius / rotatedEndRadius : 1;
  const scale = 1 + (gatherScale - 1) * shaped;
  const swingXz = {
    x: step.stanceXz.x + (rotated.x - step.stanceXz.x) * scale,
    z: step.stanceXz.z + (rotated.z - step.stanceXz.z) * scale,
  };
  // Swing Y morphs from its (continuous) lift-off height to the baseline landing, plus
  // the lift arc. Stance Y holds its step value: pinned, by construction.
  const swingY = step.swingFromY + (plan.stanceBaselineY - step.swingFromY) * shaped
    + plan.liftPeakM * Math.sin(Math.PI * u);
  return {
    stepIndex: step.index,
    u,
    yawRadians,
    stanceFoot: step.stanceFoot,
    swingFoot: step.swingFoot,
    stanceToe: { x: step.stanceXz.x, y: step.stanceY, z: step.stanceXz.z },
    swingToe: {
      x: swingXz.x,
      y: swingY,
      z: swingXz.z,
    },
    done: elapsedS >= plan.totalS,
  };
}
