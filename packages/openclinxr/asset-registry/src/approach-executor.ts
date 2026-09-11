import type { BedsideApproachPlan } from "./bedside-approach-path.js";
import type { Vector3 } from "./bedside-target.js";

/**
 * A goal executor for the bedside approach, and the foot-sliding measurement that grades it.
 *
 * Brief §7 step 4: "Start with a bounded actor path and validated clip/goal executor, stopping at
 * the proven target ... Measure continuous-path collisions, foot sliding, final pose and equipment
 * clearance."
 *
 * `planBedsideApproach` produced the bounded path and the collision and final-pose measurements.
 * This is the executor and the foot-sliding half.
 *
 * IT IS A GOAL EXECUTOR, NOT A CLIP EXECUTOR, and the distinction is the honest part. It advances
 * a root along a validated polyline at a walking speed and stops at the goal. It does not play an
 * animation clip, because this project ships no locomotion clip: the only approved motion source
 * is Mesh2Motion's seated/talking BVH (`public-humanoid-motion-license-review-2026-09-04.md`).
 *
 * THE CONSEQUENCE IS MEASURED, NOT HIDDEN. A root that translates with no leg animation slides its
 * feet by exactly the distance travelled. `footSlideMeters` reports that, and on this executor it
 * will report ~100% sliding. That is the true measurement of what the runtime does today, and it is
 * more useful than a `clipPlayed` flag the brief explicitly refuses. When a locomotion clip exists,
 * the same metric grades it without change.
 */

/** A walking speed for an unhurried clinician, in metres per second. */
export const CLINICIAN_WALK_SPEED_MPS = 1.1;

type ExecutorPose = {
  position: Vector3;
  headingRadians: number;
  /** True once the goal is reached; the pose then stops changing. */
  arrived: boolean;
  /** Distance still to travel along the path, in metres. */
  remainingMeters: number;
};

/**
 * The pose at `elapsedMs` along a plan.
 *
 * REFUSES an unusable plan rather than executing it. A plan with path violations was not proven,
 * and driving an actor along a route that collides is the failure step 4's collision measurement
 * exists to prevent — executing it anyway would make the measurement decorative.
 */
export function stepBedsideApproach(input: {
  plan: BedsideApproachPlan;
  elapsedMs: number;
  speedMetersPerSecond?: number;
}): ExecutorPose {
  const { plan } = input;
  if (plan.pathViolations.length > 0) {
    throw new Error(
      `stepBedsideApproach: refused to execute a plan with ${plan.pathViolations.length} path violation(s) — ${plan.pathViolations.map((violation) => violation.obstacleId).join(", ")}. A route that was not proven clear must not be walked; the collision measurement is the reason the plan carries them.`,
    );
  }
  const waypoints = plan.waypoints;
  const first = waypoints[0];
  const last = waypoints[waypoints.length - 1];
  if (!first || !last) {
    throw new Error("stepBedsideApproach: refused an empty plan — there is no path to execute.");
  }

  const speed = input.speedMetersPerSecond ?? CLINICIAN_WALK_SPEED_MPS;
  const legLengths: number[] = [];
  let total = 0;
  for (let i = 1; i < waypoints.length; i += 1) {
    const from = waypoints[i - 1]!.position;
    const to = waypoints[i]!.position;
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    legLengths.push(length);
    total += length;
  }

  const travelled = Math.max(0, (input.elapsedMs / 1000) * speed);
  if (travelled >= total) {
    return { position: last.position, headingRadians: last.headingRadians, arrived: true, remainingMeters: 0 };
  }

  let walked = 0;
  for (let i = 0; i < legLengths.length; i += 1) {
    const legLength = legLengths[i]!;
    if (walked + legLength >= travelled) {
      const t = legLength === 0 ? 0 : (travelled - walked) / legLength;
      const from = waypoints[i]!;
      const to = waypoints[i + 1]!;
      return {
        position: {
          x: from.position.x + (to.position.x - from.position.x) * t,
          y: from.position.y,
          z: from.position.z + (to.position.z - from.position.z) * t,
        },
        headingRadians: from.headingRadians,
        arrived: false,
        remainingMeters: total - travelled,
      };
    }
    walked += legLength;
  }
  return { position: last.position, headingRadians: last.headingRadians, arrived: true, remainingMeters: 0 };
}

/** One sampled frame of a foot, in world metres. */
type FootSample = { atMs: number; position: Vector3 };

type FootSlideReport = {
  /** Total horizontal distance a foot travelled WHILE IN CONTACT with the floor. */
  slideMeters: number;
  /** Frames judged to be in contact. Zero means the metric observed nothing, not that it passed. */
  contactFrames: number;
  /** The largest single-frame slide, which is where a pop shows up rather than a drift. */
  worstFrameSlideMeters: number;
};

/** Foot height under which a foot counts as planted, in metres. */
export const FOOT_CONTACT_HEIGHT_METERS = 0.06;

/**
 * How far a foot slid while it was on the floor.
 *
 * A planted foot should not translate. Any horizontal movement between two consecutive IN-CONTACT
 * frames is slide, and it is summed rather than averaged: averaging hides a pop inside a long
 * clean stretch, and a pop is what a viewer sees.
 *
 * `contactFrames` is returned so a zero result is legible. A clip whose foot never comes near the
 * floor reports zero slide and zero contact, which is not a pass — it is the metric saying it
 * observed nothing, and the two must not look alike.
 */
export function footSlideMeters(
  samples: readonly FootSample[],
  contactHeightMeters: number = FOOT_CONTACT_HEIGHT_METERS,
): FootSlideReport {
  let slideMeters = 0;
  let contactFrames = 0;
  let worstFrameSlideMeters = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]!;
    const inContact = sample.position.y <= contactHeightMeters;
    if (!inContact) continue;
    contactFrames += 1;
    const previous = samples[i - 1];
    if (!previous || previous.position.y > contactHeightMeters) continue;
    const step = Math.hypot(
      sample.position.x - previous.position.x,
      sample.position.z - previous.position.z,
    );
    slideMeters += step;
    if (step > worstFrameSlideMeters) worstFrameSlideMeters = step;
  }
  return { slideMeters, contactFrames, worstFrameSlideMeters };
}
