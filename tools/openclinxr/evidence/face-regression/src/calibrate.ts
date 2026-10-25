/**
 * Calibration: noise + floor -> thresholds (card tsk_0e618fa5e9ac3e15 STEP 5).
 *
 *   calibrate --card <taskId> --baseline <labelA> --noise <labelB>
 *             --perturb-seed <n> --out <calibration.json> [--store <root>]
 *             [--case <id|all>]
 *
 * <labelA> is the seed candidate render dir, <labelB> a second from-scratch
 * render of identical inputs (both written by `check --render-only`). Per
 * region and metric:
 *   noise = max delta between the two renders (A vs B), over cases and views;
 *   floor = max metric between A and A perturbed by `--perturb-seed`
 *           (regions.py replaces current with golden offset by a seeded uniform
 *           integer in {-1,0,+1} per channel per pixel, clipped).
 * Threshold = max(noise, floor) is derived later by thresholdsFromCalibration.
 *
 * No number is typed: every value is copied from a regions.py metrics JSON by
 * code, and each entry records the metrics JSON path(s) it came from.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { measureRegions, resolveRunPaths } from "./check.js";

const DEFAULT_STORE = process.env.FACE_REGRESSION_STORE
  ?? "/Volumes/files/openclinxr-assets/store/face-regression";

type Args = Record<string, string | boolean>;

function parseFlags(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new Error(`face-regression calibrate: unexpected arg ${a}`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i += 1; } else out[key] = true;
  }
  return out;
}

type LabelSummary = {
  labelDir?: string;
  cases: Array<{ caseId: string; renderDir: string }>;
};

type ViewPng = { yaw: number; png: string };

function viewsOf(renderDir: string): ViewPng[] {
  const rj = JSON.parse(readFileSync(join(renderDir, "render.json"), "utf8")) as { views?: ViewPng[] };
  return (rj.views ?? []).map((v) => ({ yaw: v.yaw, png: resolve(process.cwd(), v.png) }));
}

function runCalibrate(argv: string[]): number {
  const flags = parseFlags(argv);
  const store = String(flags.store ?? DEFAULT_STORE);
  const card = flags.card ? String(flags.card) : null;
  const baseline = flags.baseline ? String(flags.baseline) : null;
  const noiseLabel = flags.noise ? String(flags.noise) : null;
  const out = flags.out ? resolve(process.cwd(), String(flags.out)) : null;
  const perturbSeed = flags["perturb-seed"] !== undefined ? Number(flags["perturb-seed"]) : NaN;
  if (!card || !baseline || !noiseLabel || !out || !Number.isInteger(perturbSeed)) {
    throw new Error("face-regression calibrate: needs --card <taskId> --baseline <labelA> --noise <labelB> --perturb-seed <n> --out <calibration.json>");
  }
  const dirA = resolveRunPaths({ store, card, label: baseline }).labelDir;
  const dirB = resolveRunPaths({ store, card, label: noiseLabel }).labelDir;
  const summaryA = JSON.parse(readFileSync(join(dirA, "render.json"), "utf8")) as LabelSummary;
  const summaryB = JSON.parse(readFileSync(join(dirB, "render.json"), "utf8")) as LabelSummary;
  const casesA = new Map(summaryA.cases.map((c) => [c.caseId, c.renderDir]));
  const casesB = new Map(summaryB.cases.map((c) => [c.caseId, c.renderDir]));
  const selection = String(flags.case ?? "all");
  const selected = selection === "all"
    ? [...casesA.keys()].filter((c) => casesB.has(c))
    : selection.split(",").map((s) => s.trim());
  for (const c of selected) {
    if (!casesA.has(c) || !casesB.has(c)) throw new Error(`face-regression calibrate: case ${c} missing from ${!casesA.has(c) ? baseline : noiseLabel}`);
  }
  const metricsDir = join(store, "runs", card, "calibration");
  mkdirSync(metricsDir, { recursive: true });

  const noiseByRegion = new Map<string, { dE: number[]; drop: number[]; sources: string[] }>();
  const floorByRegion = new Map<string, { dE: number[]; drop: number[]; sources: string[] }>();
  const bump = (
    table: Map<string, { dE: number[]; drop: number[]; sources: string[] }>,
    region: string, dE: number, ssimL: number, source: string,
  ) => {
    const row = table.get(region) ?? { dE: [], drop: [], sources: [] };
    row.dE.push(dE);
    row.drop.push(1 - ssimL);
    if (!row.sources.includes(source)) row.sources.push(source);
    table.set(region, row);
  };

  for (const caseId of selected) {
    const viewsA = viewsOf(casesA.get(caseId)!);
    const viewsB = new Map(viewsOf(casesB.get(caseId)!).map((v) => [v.yaw, v.png]));
    for (const va of viewsA) {
      const pngB = viewsB.get(va.yaw);
      if (!pngB) throw new Error(`face-regression calibrate: ${caseId} view ${va.yaw} missing from ${noiseLabel}`);
      if (!existsSync(va.png) || !existsSync(pngB)) {
        throw new Error(`face-regression calibrate: missing PNG for ${caseId}@${va.yaw}: ${va.png} / ${pngB}`);
      }
      const noise = measureRegions({
        caseId, view: va.yaw, goldenPng: va.png, currentPng: pngB,
        outDir: metricsDir, fileTag: "noise",
      });
      for (const m of noise.metrics) bump(noiseByRegion, m.region, m.dE, m.ssimL, noise.metricsPath);
      const floor = measureRegions({
        caseId, view: va.yaw, goldenPng: va.png, currentPng: va.png,
        outDir: metricsDir, fileTag: "floor",
        extraArgs: ["--perturb-seed", String(perturbSeed)],
      });
      for (const m of floor.metrics) bump(floorByRegion, m.region, m.dE, m.ssimL, floor.metricsPath);
    }
  }

  const regions: Record<string, {
    dE: { noise: number; floor: number; source: string };
    ssimL: { noiseDrop: number; floorDrop: number; source: string };
  }> = {};
  for (const [region, n] of noiseByRegion) {
    const f = floorByRegion.get(region);
    if (!f) throw new Error(`face-regression calibrate: region ${region} has noise but no floor measurement`);
    regions[region] = {
      dE: { noise: Math.max(...n.dE), floor: Math.max(...f.dE), source: `noise ${n.sources.join(",")}; floor ${f.sources.join(",")}` },
      ssimL: { noiseDrop: Math.max(...n.drop), floorDrop: Math.max(...f.drop), source: `noise ${n.sources.join(",")}; floor ${f.sources.join(",")}` },
    };
  }
  const calibration = {
    card,
    status: "calibrated",
    perturbation: `seed ${perturbSeed}; every 8-bit channel of the golden is offset by a seeded uniform integer in {-1,0,+1} (per-channel, per-pixel), clipped to 0..255`,
    seed: perturbSeed,
    baseline: { label: baseline, dir: dirA },
    noise: { label: noiseLabel, dir: dirB },
    metricsDir,
    regions,
  };
  writeFileSync(out, `${JSON.stringify(calibration, null, 2)}\n`, "utf8");
  console.log(out);
  return 0;
}

const invokedDirectly = process.argv[1]?.endsWith("calibrate.ts") ?? false;
if (invokedDirectly) {
  try {
    process.exitCode = runCalibrate(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
