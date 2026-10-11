import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { computeTurnQuality, type TurnQualityFrame } from "../turn-quality-metrics.js";

/**
 * CCD-browser metrics (2026-10-11): score one `foot-plant-video.json` browser
 * capture from the REAL skeleton (physician bedside approach, full-body side
 * view) with the same disciplines as the headless SC-05 assay rows, so the
 * off/on comparison reads beside `ccd-stance-lock-cagematch.ts` Part A.
 *
 * Definitions over the capture's own `frames` (slot + both toe bones off the
 * loaded skeleton, with phase and stanceFoot):
 * - walkSlideM: max `slideMeters` over the report's stance windows. Those
 *   windows are maximal consecutive walking-phase runs of one stanceFoot, and
 *   slide is the stance toe's XZ span — the WALK-PHASE planted-foot slide.
 * - wholeSlideM: the same window-span discipline extended over ALL phases:
 *   maximal consecutive runs of one stanceFoot across walking + stopping +
 *   settling + arrived, max XZ span of the stance toe. Whole-approach slide.
 * - maxToeStepM: `computeTurnQuality`'s `maxToeStepPerFrameM` (largest
 *   single-frame XZ toe displacement, either foot, whole capture).
 * - heelMissMedianM / heelMissMaxM: median/max of per-frame `heelMissM` when
 *   the runtime exposes it; the shipped evidence ring carries no heel-miss
 *   field, so these read null (recorded, not fabricated). The capture tool was
 *   allowed a diagnostic read only — no runtime behaviour change — and there
 *   is no exposed field to read.
 * - arrivalErrM: XZ distance from the slot at the FIRST arrived sample to
 *   `targetWorld` — the browser analogue of the assay's arrival error.
 *
 * claimScope: arithmetic over one browser capture's recorded frames.
 * notEvidenceFor: gait realism, clinical plausibility, Quest performance.
 *
 * Usage: mise exec -- tsx tools/openclinxr/evidence/foot-plant/ccd-stance-lock/ccd-browser-metrics.ts \
 *   --report .openclinxr/evidence/ccd-browser/off/foot-plant-video.json \
 *   --out .openclinxr/evidence/ccd-browser/off/metrics.json
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
  heelMissM?: number | null;
};

function xzSpan(points: readonly Vec[]): number {
  let worst = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const d = Math.hypot(points[i]!.x - points[j]!.x, points[i]!.z - points[j]!.z);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

/** Maximal consecutive runs of one stanceFoot over every phase; max stance-toe XZ span. */
function wholeApproachSlide(frames: readonly ReportFrame[]): number | null {
  let run: Vec[] = [];
  let runFoot: string | null = null;
  let maxSlide: number | null = null;
  const flush = (): void => {
    if (run.length >= 1) maxSlide = Math.max(maxSlide ?? 0, xzSpan(run));
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

  const heelMisses = report.frames
    .map((f) => f.heelMissM)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const heelMissMedianM = median(heelMisses);
  const heelMissMaxM = heelMisses.length > 0 ? Math.max(...heelMisses) : null;

  const firstArrived = report.frames.find((f) => f.phase === "arrived") ?? null;
  const arrivalErrM =
    firstArrived?.slot && targetWorld
      ? Math.hypot(firstArrived.slot.x - targetWorld.x, firstArrived.slot.z - targetWorld.z)
      : null;

  const metrics = {
    schemaVersion: "openclinxr.ccd-browser-metrics.v1",
    report: reportPath,
    ccdStanceLockEnabled: report.ccdStanceLockEnabled ?? null,
    steppingTurnEnabled: report.steppingTurnEnabled ?? null,
    walkSlideM,
    wholeSlideM,
    maxToeStepM: quality.maxToeStepPerFrameM,
    heelMissMedianM,
    heelMissMaxM,
    heelMissExposed: heelMisses.length > 0,
    arrivalErrM,
  };
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  process.stdout.write(
    `walkSlide=${walkSlideM.toFixed(4)} whole=${wholeSlideM?.toFixed(4) ?? "?"} `
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
