import { readFile } from "node:fs/promises";

/**
 * Turn-quality metrics over a foot-plant-video.json capture: how the arrival turn behaves, not
 * the walk itself (see `walk-quality-metrics.ts` for that).
 *
 * Six metrics, each with the exact definition graded by:
 *  - residualTurnDeg: |target heading - slot yaw| at the walking -> settling transition.
 *  - settleSeconds: settling-phase duration.
 *  - floorPenetrationM: min toe y over settling+arrived, relative to the floor (toe y in the
 *    capture is already floor-relative — see `station-bedside-approach-mod.ts`'s `worldOf`, which
 *    the runtime reports against the same origin the contact band is measured from).
 *  - stepLiftsM: per swing episode during settling, the swing foot's max toe height.
 *  - plantedSlideM: max XZ distance a labelled-stance toe travels from its own episode's anchor
 *    during settling.
 *  - headLeadSeconds: how much earlier the head's world yaw reaches within 10 deg of the target
 *    heading than the slot (pelvis) yaw does.
 *
 * A field this script needs but a capture does not carry (an older capture, or a capture from a
 * probe rig with no head bone) reports `null` and the metric on it reports `"not recorded"` rather
 * than a fabricated number.
 *
 * claimScope: walking/settling/arrived-phase runtime toe, slot-yaw and head-yaw positions in
 * foot-plant-video.json.
 * notEvidenceFor: gait realism, clinical plausibility, Quest performance, or the walk itself.
 */

export const RESIDUAL_TURN_MAX_DEG = 45;
export const FLOOR_PENETRATION_MIN_METERS = -0.005;
export const STEP_LIFT_MIN_METERS = 0.015;
export const PLANTED_SLIDE_MAX_METERS = 0.02;
export const HEAD_LEAD_WITHIN_DEG = 10;

type Vec = { x: number; y: number; z: number };

export type TurnQualityFrame = {
  sample: number;
  tMs: number;
  phase: string;
  left: Vec | null;
  right: Vec | null;
  stanceFoot: string | null;
  slotYawRadians?: number | null;
  headYawWorldRadians?: number | null;
};

export type TurnQualityInput = {
  frames: TurnQualityFrame[];
  walkDiagnostics?: {
    targetHeadingRadians?: number | null;
  } | null;
};

export type StepLift = { episodeIndex: number; foot: string; maxLiftMeters: number; frameCount: number };

export type TurnQuality = {
  residualTurnDeg: number | null;
  residualTurnPass: boolean | null;
  settleSeconds: number | null;
  floorPenetrationM: number | null;
  floorPenetrationPass: boolean | null;
  stepLiftsM: StepLift[];
  minStepLiftM: number | null;
  stepLiftPass: boolean | null;
  plantedSlideM: number | null;
  plantedSlidePass: boolean | null;
  headLeadSeconds: number | null;
  headLeadPass: boolean | null;
  allPass: boolean;
};

function toDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Shortest absolute angle between two yaws, in radians. */
function absoluteYawDelta(from: number, to: number): number {
  const twoPi = Math.PI * 2;
  return Math.abs((((to - from + Math.PI) % twoPi) + twoPi) % twoPi - Math.PI);
}

function dist2d(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Contiguous runs of settling-phase frames sharing the same swing (non-plant) foot. */
function swingEpisodes(frames: readonly TurnQualityFrame[]): StepLift[] {
  const settling = frames.filter((f) => f.phase === "settling" && f.left !== null && f.right !== null);
  const episodes: StepLift[] = [];
  let currentSwing: string | null = null;
  let currentMax = Number.NEGATIVE_INFINITY;
  let currentCount = 0;
  const flush = (): void => {
    if (currentSwing !== null && currentCount > 0) {
      episodes.push({
        episodeIndex: episodes.length,
        foot: currentSwing,
        maxLiftMeters: currentMax,
        frameCount: currentCount,
      });
    }
    currentSwing = null;
    currentMax = Number.NEGATIVE_INFINITY;
    currentCount = 0;
  };
  for (const frame of settling) {
    if (frame.stanceFoot !== "left" && frame.stanceFoot !== "right") continue;
    const swingFoot = frame.stanceFoot === "left" ? "right" : "left";
    if (swingFoot !== currentSwing) {
      flush();
      currentSwing = swingFoot;
    }
    const swingToe = swingFoot === "left" ? frame.left : frame.right;
    if (swingToe !== null) {
      currentMax = Math.max(currentMax, swingToe.y);
      currentCount += 1;
    }
  }
  flush();
  return episodes;
}

/**
 * A same-foot re-plant within one simulated frame (33 ms at 30 fps) that a pinned stance could
 * not produce: `case-owned-approach-frame-mod.ts`'s `stanceFoot` reports `next.phaseFoot` through
 * double-support and flight frames too (`downFoot ?? next.phaseFoot` in
 * `clip-driven-settling-turn-mod.ts`), so the SAME name can legitimately span two separate
 * footfalls of the same foot with no intervening label change. A genuinely pinned toe moves by at
 * most the stance-lock's own per-frame correction cap; anything past this is a landing, not slide.
 */
const PLANT_EPISODE_FOOTFALL_JUMP_METERS = 0.05;
/** Toe height above the floor that counts as lifted: half the ~1.5-2 cm natural toe clearance. */
const PLANT_EPISODE_LIFT_METERS = 0.008;

/**
 * Contiguous runs of settling-phase frames sharing the same PLANTED (stance) foot label.
 *
 * ## CHANGED 2026-09-24: the anchor used to reset ONLY when the reported `stanceFoot` name
 * changed. Measured on a real capture: within one unbroken "right" streak the toe jumped 0.109 m
 * then 0.191 m in single frames (`.openclinxr/evidence/foot-plant-video/foot-plant-video.json`,
 * samples 43 and 46) while still reported "right" — two real footfalls of the same foot, not one
 * held stance, so the old anchor kept measuring across both landings and reported a ~0.28 m
 * "slide" that was mostly step travel. The stance SOURCE (`frame.stanceFoot`) was already correct
 * — this was a grouping bug in how the metric turned that label into episodes. Now the anchor also
 * resets on any single-frame step past `PLANT_EPISODE_FOOTFALL_JUMP_METERS`, which a pin cannot
 * produce, so each footfall gets its own anchor the way the label-change path always did.
 */
function plantEpisodeMaxSlide(frames: readonly TurnQualityFrame[]): number | null {
  const settling = frames.filter((f) => f.phase === "settling" && f.left !== null && f.right !== null);
  let currentPlant: string | null = null;
  let anchor: { x: number; z: number } | null = null;
  let maxSlide = Number.NEGATIVE_INFINITY;
  let liftedSinceAnchor = false;
  const floorY = 0;
  for (const frame of settling) {
    if (frame.stanceFoot !== "left" && frame.stanceFoot !== "right") continue;
    const plantToe = frame.stanceFoot === "left" ? frame.left : frame.right;
    if (plantToe === null) continue;
    const plantXz = { x: plantToe.x, z: plantToe.z };
    // A new footfall of the SAME foot needs evidence of a step: the toe left the floor since the
    // anchor was taken AND it came down somewhere else. A jump without a lift is a planted foot
    // snapping, which is exactly the slide this metric exists to catch, so it is not a reset.
    if (plantToe.y - floorY > PLANT_EPISODE_LIFT_METERS) liftedSinceAnchor = true;
    const isNewFootfall =
      frame.stanceFoot !== currentPlant ||
      (anchor !== null && liftedSinceAnchor && plantToe.y - floorY <= PLANT_EPISODE_LIFT_METERS &&
        dist2d(anchor, plantXz) > PLANT_EPISODE_FOOTFALL_JUMP_METERS);
    if (isNewFootfall) {
      currentPlant = frame.stanceFoot;
      anchor = plantXz;
      liftedSinceAnchor = false;
    }
    if (anchor !== null) maxSlide = Math.max(maxSlide, dist2d(anchor, plantXz));
  }
  return Number.isFinite(maxSlide) ? maxSlide : null;
}

export function computeTurnQuality(input: TurnQualityInput): TurnQuality {
  const frames = input.frames;
  const targetHeadingRadians = input.walkDiagnostics?.targetHeadingRadians ?? null;

  // (a) residualTurnDeg: at the walking -> settling transition, i.e. the first settling frame
  // (or, lacking one, the last walking frame) that carries a slot yaw.
  const firstSettling = frames.find((f) => f.phase === "settling" && f.slotYawRadians != null);
  const lastWalking = [...frames].reverse().find((f) => f.phase === "walking" && f.slotYawRadians != null);
  const transitionFrame = firstSettling ?? lastWalking ?? null;
  const residualTurnDeg =
    transitionFrame?.slotYawRadians != null && targetHeadingRadians !== null
      ? toDeg(absoluteYawDelta(transitionFrame.slotYawRadians, targetHeadingRadians))
      : null;

  // (b) settleSeconds: first settling frame to first arrived frame.
  const settlingStartMs = frames.find((f) => f.phase === "settling")?.tMs ?? null;
  const arrivedStartMs = frames.find((f) => f.phase === "arrived")?.tMs ?? null;
  const settleSeconds =
    settlingStartMs !== null && arrivedStartMs !== null ? (arrivedStartMs - settlingStartMs) / 1000 : null;

  // (c) floorPenetrationM: min toe y over settling + arrived.
  const grounded = frames.filter((f) => f.phase === "settling" || f.phase === "arrived");
  const heights: number[] = [];
  for (const frame of grounded) {
    if (frame.left !== null) heights.push(frame.left.y);
    if (frame.right !== null) heights.push(frame.right.y);
  }
  const floorPenetrationM = heights.length > 0 ? Math.min(...heights) : null;

  // (d) stepLiftsM: per swing episode during settling.
  const stepLiftsM = swingEpisodes(frames);
  const minStepLiftM =
    stepLiftsM.length > 0 ? Math.min(...stepLiftsM.map((s) => s.maxLiftMeters)) : null;

  // (e) plantedSlideM: max XZ slide of a labelled-stance toe during settling.
  const plantedSlideM = plantEpisodeMaxSlide(frames);

  // (f) headLeadSeconds: time by which head yaw reaches within HEAD_LEAD_WITHIN_DEG of the target
  // heading before slot yaw does.
  let headLeadSeconds: number | null = null;
  if (targetHeadingRadians !== null) {
    const withinDeg = (radians: number): boolean =>
      toDeg(absoluteYawDelta(radians, targetHeadingRadians)) <= HEAD_LEAD_WITHIN_DEG;
    const headFrame = frames.find((f) => f.headYawWorldRadians != null && withinDeg(f.headYawWorldRadians));
    const slotFrame = frames.find((f) => f.slotYawRadians != null && withinDeg(f.slotYawRadians));
    if (headFrame !== undefined && slotFrame !== undefined) {
      headLeadSeconds = (slotFrame.tMs - headFrame.tMs) / 1000;
    }
  }

  const residualTurnPass = residualTurnDeg === null ? null : residualTurnDeg <= RESIDUAL_TURN_MAX_DEG;
  const floorPenetrationPass =
    floorPenetrationM === null ? null : floorPenetrationM >= FLOOR_PENETRATION_MIN_METERS;
  const stepLiftPass = minStepLiftM === null ? null : minStepLiftM >= STEP_LIFT_MIN_METERS;
  const plantedSlidePass = plantedSlideM === null ? null : plantedSlideM <= PLANTED_SLIDE_MAX_METERS;
  const headLeadPass = headLeadSeconds === null ? null : headLeadSeconds > 0;

  return {
    residualTurnDeg,
    residualTurnPass,
    settleSeconds,
    floorPenetrationM,
    floorPenetrationPass,
    stepLiftsM,
    minStepLiftM,
    stepLiftPass,
    plantedSlideM,
    plantedSlidePass,
    headLeadSeconds,
    headLeadPass,
    allPass: [residualTurnPass, floorPenetrationPass, stepLiftPass, plantedSlidePass, headLeadPass].every(
      (pass) => pass === true,
    ),
  };
}

function fmt(value: number | null, digits: number): string {
  return value === null ? "not recorded" : value.toFixed(digits);
}

function printReport(quality: TurnQuality): void {
  const line = (name: string, value: string, pass: boolean | null): void => {
    process.stdout.write(`${pass === null ? "N/A " : pass ? "PASS" : "FAIL"} ${name}: ${value}\n`);
  };
  line(
    "residualTurnDeg",
    `${fmt(quality.residualTurnDeg, 2)} (target <= ${RESIDUAL_TURN_MAX_DEG})`,
    quality.residualTurnPass,
  );
  line("settleSeconds", fmt(quality.settleSeconds, 3), null);
  line(
    "floorPenetrationM",
    `${fmt(quality.floorPenetrationM, 5)} (target >= ${FLOOR_PENETRATION_MIN_METERS})`,
    quality.floorPenetrationPass,
  );
  line(
    "minStepLiftM",
    `${fmt(quality.minStepLiftM, 5)} over ${quality.stepLiftsM.length} swing episode(s) (target >= ${STEP_LIFT_MIN_METERS})`,
    quality.stepLiftPass,
  );
  for (const step of quality.stepLiftsM) {
    process.stdout.write(
      `  episode ${step.episodeIndex} (${step.foot} swing, ${step.frameCount} frames): ${step.maxLiftMeters.toFixed(5)} m\n`,
    );
  }
  line(
    "plantedSlideM",
    `${fmt(quality.plantedSlideM, 5)} (target <= ${PLANTED_SLIDE_MAX_METERS})`,
    quality.plantedSlidePass,
  );
  line("headLeadSeconds", `${fmt(quality.headLeadSeconds, 3)} (target > 0)`, quality.headLeadPass);
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("turn-quality-metrics.ts");

if (invokedAsScript) {
  const inputPath = process.argv[2] ?? "";
  if (!inputPath) {
    process.stderr.write("usage: turn-quality-metrics.ts <foot-plant-video.json>\n");
    process.exit(2);
  }
  const raw = JSON.parse(await readFile(inputPath, "utf8")) as TurnQualityInput;
  const quality = computeTurnQuality(raw);
  printReport(quality);
  const anyPass = [
    quality.residualTurnPass,
    quality.floorPenetrationPass,
    quality.stepLiftPass,
    quality.plantedSlidePass,
    quality.headLeadPass,
  ].some((pass) => pass !== null);
  process.exit(!anyPass ? 0 : quality.allPass ? 0 : 1);
}
