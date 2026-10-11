import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  computeTurnQuality,
  PLANT_EPISODE_FOOTFALL_JUMP_METERS,
  PLANT_EPISODE_LIFT_METERS,
  type TurnQualityFrame,
} from "../turn-quality-metrics.js";

/**
 * CCD-browser metrics (2026-10-11, fixed 2026-10-11): score one
 * `foot-plant-video.json` browser capture from the REAL skeleton (physician
 * bedside approach, full-body side view) with the same disciplines as the
 * headless SC-05 assay rows, so the off/on comparison reads beside
 * `ccd-stance-lock-cagematch.ts` Part A.
 *
 * ONE WINDOW PER FOOT CONTACT. The first version of this file scored
 * `report.maxSlideMeters` — the max XZ span over the capture tool's stance
 * windows, which are maximal consecutive walking-phase runs of one stanceFoot
 * label. On the flag-off browser capture that read 0.51 m: 28 walking frames
 * collapsed into 3 windows, and the 16-frame left window's span mixes a
 * genuine plant drift with the landing snap that ends it, with no median and
 * no way to tell one footfall from the next. The fix recomputes windows from
 * the per-frame records (the runtime's own stance labels, recorded per frame)
 * with one footfall per window:
 * - walkContact*: maximal runs of one stanceFoot label within the walking
 *   phase, SPLIT on a same-foot footfall — a single-frame stance-toe step
 *   past PLANT_EPISODE_FOOTFALL_JUMP_METERS (0.05, turn-quality-metrics.ts:
 *   a pin cannot produce it) after the toe left the floor past
 *   PLANT_EPISODE_LIFT_METERS (0.008, turn-quality-metrics.ts: half the
 *   ~1.5-2 cm natural toe clearance). A jump without a lift is a planted
 *   foot snapping, not a landing, and stays in the episode — the same
 *   discipline `computeTurnQuality`'s settling `plantedSlideM` uses, so the
 *   settling episodes below validate the machinery bit-for-bit.
 * - slide per contact is the stance toe's max XZ excursion from its own
 *   touchdown anchor. Reported as median and max over the walk phase.
 *
 * VALIDATION: the same episode function over the settling phase must
 * reproduce `computeTurnQuality`'s `plantedSlideM` to within 0.01 m
 * (`metricValidationDeltaM`); it is the identical anchor/reset arithmetic on
 * the identical frames, so any larger gap is a bug in this file, not a
 * finding about the runtime. A metric that disagrees unexplained is not usable.
 *
 * - wholeSlideM: maximal-run span discipline over ALL phases (unchanged,
 *   legacy comparator).
 * - maxToeStepM: `computeTurnQuality`'s `maxToeStepPerFrameM`.
 * - heelMissMedianM / heelMissMaxM: median/max of per-frame
 *   `stanceLockHeelMissM` (the runtime's read-only stance-leg heel-target miss,
 *   exposed 2026-10-11; `heelMissM` read as a fallback for older captures).
 * - arrivalErrM: XZ distance from the slot at the FIRST arrived sample to
 *   `targetWorld`.
 *
 * claimScope: arithmetic over one browser capture's recorded frames.
 * notEvidenceFor: gait realism, clinical plausibility, Quest performance.
 *
 * Usage: mise exec -- tsx tools/openclinxr/evidence/foot-plant/ccd-stance-lock/ccd-browser-metrics.ts \
 *   --report .openclinxr/evidence/walk-slide/off/foot-plant-video.json \
 *   --out .openclinxr/evidence/walk-slide/off/metrics.json
 */

type Vec = { x: number; y: number; z: number };

type ReportFrame = {
  sample: number;
  tMs: number;
  phase: string;
  left: Vec | null;
  right: Vec | null;
  stanceFoot: string | null;
  slotYawRadians?: number | null;
  headYawWorldRadians?: number | null;
  slot?: { x: number; z: number } | null;
  stanceLockHeelMissM?: number | null;
  heelMissM?: number | null;
};

export type ContactEpisode = {
  foot: string;
  startSample: number;
  endSample: number;
  slideMeters: number;
};

function dist2d(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * One episode per foot contact within `phase`: maximal runs of one per-frame
 * stance label, split on same-foot footfalls with the exact anchor/reset
 * discipline of `plantEpisodeMaxSlide` (turn-quality-metrics.ts) — anchor at
 * the footfall frame, reset when the toe left the floor since the anchor
 * (> PLANT_EPISODE_LIFT_METERS) and came down further than
 * PLANT_EPISODE_FOOTFALL_JUMP_METERS from it.
 */
export function contactEpisodes(
  frames: readonly TurnQualityFrame[],
  phase: string,
): ContactEpisode[] {
  const scoped = frames.filter((f) => f.phase === phase && f.left !== null && f.right !== null);
  const episodes: ContactEpisode[] = [];
  let currentPlant: string | null = null;
  let anchor: { x: number; z: number } | null = null;
  let episodeMax = 0;
  let episodeStart = 0;
  let episodeEnd = 0;
  let liftedSinceAnchor = false;
  const floorY = 0;
  const closeEpisode = (): void => {
    if (currentPlant !== null && anchor !== null) {
      episodes.push({ foot: currentPlant, startSample: episodeStart, endSample: episodeEnd, slideMeters: episodeMax });
    }
  };
  for (const frame of scoped) {
    if (frame.stanceFoot !== "left" && frame.stanceFoot !== "right") continue;
    const plantToe = frame.stanceFoot === "left" ? frame.left : frame.right;
    if (plantToe === null) continue;
    const plantXz = { x: plantToe.x, z: plantToe.z };
    if (plantToe.y - floorY > PLANT_EPISODE_LIFT_METERS) liftedSinceAnchor = true;
    const isNewFootfall =
      frame.stanceFoot !== currentPlant ||
      (anchor !== null && liftedSinceAnchor && plantToe.y - floorY <= PLANT_EPISODE_LIFT_METERS &&
        dist2d(anchor, plantXz) > PLANT_EPISODE_FOOTFALL_JUMP_METERS);
    if (isNewFootfall) {
      closeEpisode();
      currentPlant = frame.stanceFoot;
      anchor = plantXz;
      episodeMax = 0;
      episodeStart = frame.sample;
      episodeEnd = frame.sample;
      liftedSinceAnchor = false;
    } else if (anchor !== null) {
      episodeMax = Math.max(episodeMax, dist2d(anchor, plantXz));
      episodeEnd = frame.sample;
    }
  }
  closeEpisode();
  return episodes;
}

/** Maximal consecutive runs of one stanceFoot over every phase; max stance-toe XZ span. */
function wholeApproachSlide(frames: readonly ReportFrame[]): number | null {
  let run: Vec[] = [];
  let runFoot: string | null = null;
  let maxSlide: number | null = null;
  const flush = (): void => {
    if (run.length >= 1) {
      let worst = 0;
      for (let i = 0; i < run.length; i += 1) {
        for (let j = i + 1; j < run.length; j += 1) {
          worst = Math.max(worst, Math.hypot(run[i]!.x - run[j]!.x, run[i]!.z - run[j]!.z));
        }
      }
      maxSlide = Math.max(maxSlide ?? 0, worst);
    }
    run = [];
    runFoot = null;
  };
  for (const frame of frames) {
    const foot = frame.stanceFoot;
    const toe = foot === "left" ? frame.left : foot === "right" ? frame.right : null;
    if ((foot !== "left" && foot !== "right") || toe === null) {
      flush();
      continue;
    }
    if (runFoot === null) runFoot = foot;
    if (foot !== runFoot) flush();
    if (runFoot === null) runFoot = foot;
    run.push(toe);
  }
  flush();
  return maxSlide;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flagValue = (flag: string): string | null => {
    const index = args.indexOf(flag);
    return index >= 0 ? (args[index + 1] ?? null) : null;
  };
  const reportPath = flagValue("--report");
  const outPath = flagValue("--out");
  if (!reportPath || !outPath) throw new Error("usage: --report <foot-plant-video.json> --out <metrics.json>");

  const report = JSON.parse(await readFile(reportPath, "utf8")) as {
    frames: ReportFrame[];
    stanceWindows: Array<{ slideMeters: number }>;
    maxSlideMeters: number;
    walkDiagnostics?: { targetWorld?: Vec | null } | null;
    targetWorld?: Vec | null;
    ccdStanceLockEnabled?: boolean;
    steppingTurnEnabled?: boolean;
  };
  // targetWorld lives under walkDiagnostics in foot-plant-video.json.
  const targetWorld = (report.walkDiagnostics as { targetWorld?: Vec | null } | null)?.targetWorld
    ?? report.targetWorld
    ?? null;

  const frames: TurnQualityFrame[] = report.frames.map((f) => ({
    sample: f.sample,
    tMs: f.tMs,
    phase: f.phase,
    left: f.left,
    right: f.right,
    stanceFoot: f.stanceFoot,
    slotYawRadians: f.slotYawRadians ?? null,
    headYawWorldRadians: f.headYawWorldRadians ?? null,
  }));
  const quality = computeTurnQuality({ frames });

  const walkSlideM = report.maxSlideMeters;
  const wholeSlideM = wholeApproachSlide(report.frames);

  const walkEpisodes = contactEpisodes(frames, "walking");
  const walkSlides = walkEpisodes.map((e) => e.slideMeters);
  const walkContactMedianM = median(walkSlides);
  const walkContactMaxM = walkSlides.length > 0 ? Math.max(...walkSlides) : null;

  const settlingEpisodes = contactEpisodes(frames, "settling");
  const settlingContactMaxM =
    settlingEpisodes.length > 0 ? Math.max(...settlingEpisodes.map((e) => e.slideMeters)) : null;
  const metricValidationDeltaM =
    settlingContactMaxM !== null && quality.plantedSlideM !== null
      ? Math.abs(settlingContactMaxM - quality.plantedSlideM)
      : null;

  const heelMisses = report.frames
    .map((f) => f.stanceLockHeelMissM ?? f.heelMissM ?? null)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const heelMissMedianM = median(heelMisses);
  const heelMissMaxM = heelMisses.length > 0 ? Math.max(...heelMisses) : null;

  const firstArrived = report.frames.find((f) => f.phase === "arrived") ?? null;
  const arrivalErrM =
    firstArrived?.slot && targetWorld
      ? Math.hypot(firstArrived.slot.x - targetWorld.x, firstArrived.slot.z - targetWorld.z)
      : null;

  const metrics = {
    schemaVersion: "openclinxr.ccd-browser-metrics.v2",
    report: reportPath,
    ccdStanceLockEnabled: report.ccdStanceLockEnabled ?? null,
    steppingTurnEnabled: report.steppingTurnEnabled ?? null,
    walkSlideM,
    wholeSlideM,
    walkContactCount: walkEpisodes.length,
    walkContactMedianM,
    walkContactMaxM,
    walkContactSlidesM: walkSlides,
    settlingContactMaxM,
    plantedSlideM: quality.plantedSlideM,
    metricValidationDeltaM,
    maxToeStepM: quality.maxToeStepPerFrameM,
    heelMissMedianM,
    heelMissMaxM,
    heelMissExposed: heelMisses.length > 0,
    arrivalErrM,
  };
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  process.stdout.write(
    `walkContact=${walkContactMedianM?.toFixed(4) ?? "?"}/${walkContactMaxM?.toFixed(4) ?? "?"} `
      + `(n=${walkEpisodes.length}, legacyMax=${walkSlideM.toFixed(4)}) `
      + `validDelta=${metricValidationDeltaM?.toFixed(5) ?? "?"} `
      + `maxStep=${quality.maxToeStepPerFrameM?.toFixed(4) ?? "?"} `
      + `heelMiss=${heelMissMedianM?.toFixed(4) ?? "unexposed"}/${heelMissMaxM?.toFixed(4) ?? "unexposed"} `
      + `arrival=${arrivalErrM?.toFixed(4) ?? "?"} -> ${outPath}\n`,
  );
}

const invokedAsScript =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("ccd-browser-metrics.ts");

if (invokedAsScript) {
  await main();
}
