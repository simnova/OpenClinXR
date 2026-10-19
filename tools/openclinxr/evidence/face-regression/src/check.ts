/**
 * The whole-face regression check decision.
 *
 * `evaluateFaceRegression` is pure: given per-region metrics, per-region
 * thresholds and a declared-region list, it names every region that moved
 * beyond its threshold and was not declared. A declared region may move; every
 * other region that exceeds is a failure, because the point of the check is
 * that a change made in one card cannot silently move a region no card named.
 */
import type { RegionMetric } from "./metrics.js";

export type RegionThreshold = { dE: number; ssimL: number };

export type RegionVerdict = RegionMetric & {
  declared: boolean;
  threshold: RegionThreshold;
  pass: boolean;
};

export type CheckVerdict = {
  ok: boolean;
  failed: string[];
  regions: RegionVerdict[];
};

export function evaluateFaceRegression(input: {
  metrics: RegionMetric[];
  thresholds: Record<string, RegionThreshold>;
  declared?: string[];
}): CheckVerdict {
  const declared = new Set(input.declared ?? []);
  const regions: RegionVerdict[] = [];
  const failed: string[] = [];
  for (const m of input.metrics) {
    const threshold = input.thresholds[m.region] ?? { dE: Infinity, ssimL: -Infinity };
    const within = m.dE <= threshold.dE && m.ssimL >= threshold.ssimL;
    const isDeclared = declared.has(m.region);
    const pass = within || isDeclared;
    if (!pass) failed.push(m.region);
    regions.push({ ...m, declared: isDeclared, threshold, pass });
  }
  return { ok: failed.length === 0, failed, regions };
}

// ---------------------------------------------------------------------------
// CLI: `check` compares the station's current whole-face render with the last
// accepted golden and fails on any undeclared region; `--promote` writes a NEW
// immutable golden version and rewrites the tracked pointer.
//
//   check    --case <id|all> --declare <r1,r2|none> --card <taskId>
//            [--golden <version-dir>] [--render <dir>] [--store <root>]
//            [--plant-glb <path> --plant-label <name>]
//   --promote --approved-by <taskId> --from <render dir> --version <v>
//            [--store <root>]
//
// Region metrics are produced by src/regions.py (spawned through mise, pinned
// landmark model); the decision, heatmap sheets and promotion are TypeScript.
// Only runs when invoked directly; importing this module is side-effect free.
// ---------------------------------------------------------------------------
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { thresholdsFromCalibration, type Calibration } from "./thresholds.js";
import { resolveCaseRenderInputs, renderCase, sha256File, verifyInputShas } from "./render.js";
import { promoteGolden } from "./promote.js";
import { writeRegionSheet } from "./sheets.js";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const FACE_REGRESSION_DIR = resolve(SRC_DIR, "..");
const REGIONS_PY = join(FACE_REGRESSION_DIR, "src", "regions.py");
const GOLDEN_POINTER = join(FACE_REGRESSION_DIR, "golden-pointer.json");
const CALIBRATION = join(FACE_REGRESSION_DIR, "calibration.json");
const CASE_INPUTS = "packages/openclinxr/factory-stations/src/face_realism/case-inputs.json";
const RUN_REPORT = "packages/openclinxr/factory-stations/src/face_realism/case-run-report.json";
// The card names /Volumes/files/src/openclinxr-assets/store/face-regression;
// the station's own record (case-run-report.json:store) lives at
// /Volumes/files/openclinxr-assets/store (no /src). Overridable so the right
// root is used wherever the store is mounted.
const DEFAULT_STORE = process.env.FACE_REGRESSION_STORE
  ?? "/Volumes/files/src/openclinxr-assets/store/face-regression";

type Args = Record<string, string | boolean>;

function parseFlags(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new Error(`face-regression: unexpected arg ${a}`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i += 1; } else out[key] = true;
  }
  return out;
}

function parseDeclared(flags: Args): string[] {
  const v = String(flags.declare ?? "none");
  if (v === "none" || v === "") return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function loadThresholds(): Record<string, { dE: number; ssimL: number }> {
  if (!existsSync(CALIBRATION)) {
    throw new Error(`face-regression: no calibration at ${CALIBRATION}; run the noise/floor calibration (STEP 5/6) first`);
  }
  const cal = JSON.parse(readFileSync(CALIBRATION, "utf8")) as Calibration;
  const model = thresholdsFromCalibration(cal);
  const out: Record<string, { dE: number; ssimL: number }> = {};
  for (const [region, t] of Object.entries(model)) out[region] = { dE: t.maxDE, ssimL: t.minSsimL };
  return out;
}

type CaseRunReportShape = { store?: string; cases: Record<string, { runs: Record<string, { status: string }> }> };

function measureViaPython(input: { caseId: string; view: number; goldenPng: string; currentPng: string; outDir: string }): { metrics: RegionMetric[]; landmarksPath: string } {
  const metricsPath = join(input.outDir, `metrics-${input.caseId}-${input.view}.json`);
  const landmarksPath = join(input.outDir, `landmarks-${input.caseId}-${input.view}.json`);
  const proc = spawnSync(
    "mise",
    ["exec", "-C", "/Volumes/files/src/openclinxr", "--", "python3", REGIONS_PY,
      "--golden", input.goldenPng, "--current", input.currentPng,
      "--out", metricsPath, "--landmarks-out", landmarksPath,
      "--case", input.caseId, "--view", String(input.view)],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (proc.status !== 0 || !existsSync(metricsPath)) {
    throw new Error(`face-regression: regions.py refused: ${(proc.stderr || proc.stdout || "").slice(-2000)}`);
  }
  const report = JSON.parse(readFileSync(metricsPath, "utf8")) as { metrics: RegionMetric[] };
  return { metrics: report.metrics, landmarksPath };
}

function readGoldenPointer(store: string): { version: string; versionDir: string } {
  const ptr = JSON.parse(readFileSync(GOLDEN_POINTER, "utf8")) as { version?: string | null; versionDir?: string | null };
  if (!ptr.version || !ptr.versionDir) {
    throw new Error(`face-regression: no golden promoted yet (${GOLDEN_POINTER}); promote a seed before checking`);
  }
  return { version: ptr.version, versionDir: ptr.versionDir.startsWith("/") ? ptr.versionDir : join(store, "golden", ptr.version) };
}

function runCheck(argv: string[]): number {
  const flags = parseFlags(argv);
  const store = String(flags.store ?? DEFAULT_STORE);
  const card = flags.card ? String(flags.card) : null;
  if (!card) throw new Error("face-regression check: --card <taskId> is required (names the run dir)");
  const runDir = join(store, "runs", card);
  mkdirSync(runDir, { recursive: true });

  const runReport = JSON.parse(readFileSync(RUN_REPORT, "utf8")) as CaseRunReportShape;
  const caseInputs = JSON.parse(readFileSync(CASE_INPUTS, "utf8")) as { cases: Record<string, unknown> };
  const allCases = Object.keys(caseInputs.cases ?? {});
  const selection = String(flags.case ?? "all");
  const cases = selection === "all" ? allCases : selection.split(",").map((s) => s.trim());
  for (const c of cases) {
    if (!allCases.includes(c)) throw new Error(`face-regression check: unknown case ${c}`);
  }

  const golden = readGoldenPointer(store);
  const thresholds = loadThresholds();
  const declaredRegions = parseDeclared(flags);

  const results: Array<{ caseId: string; status: string; views: Array<{ view: number; ok: boolean; failed: string[] }> }> = [];
  let anyFailed = false;
  let anyAbsent = false;

  for (const caseId of cases) {
    const resolved = resolveCaseRenderInputs({ caseId, store: runReport.store ?? store, runReport });
    if (!resolved.ok) {
      anyAbsent = true;
      results.push({ caseId, status: resolved.status, views: [] });
      continue;
    }
    const renderDir = flags.render ? String(flags.render) : join(runDir, "render", caseId);
    if (!flags.render) {
      const variantPath = join(runDir, "variants", `${caseId}.variant.json`);
      const plantGlb = flags["plant-glb"] ? String(flags["plant-glb"]) : null;
      const glbAbs = plantGlb ?? resolved.inputs.glb;
      // A planted GLB is deliberately NOT the recorded one (that is the whole
      // point of the known-bad arm); every OTHER recorded input is still
      // re-hashed and refused on mismatch.
      const recorded = resolved.inputs.recordShas.filter((r) => plantGlb === null || r.path !== resolved.inputs.glb);
      const shaCheck = verifyInputShas({ inputs: recorded, hashFile: sha256File });
      if (!shaCheck.ok) throw new Error(`face-regression: input refused before render (sha mismatch): ${JSON.stringify(shaCheck.mismatches)} missing ${JSON.stringify(shaCheck.missing)}`);
      const outcome = renderCase({
        cwd: process.cwd(), caseId, runDir: renderDir,
        recordGlbSha256: plantGlb ? sha256File(plantGlb) : resolved.inputs.recordShas.find((r) => r.path === resolved.inputs.glb)?.sha256 ?? "",
        variantPath, glbAbs, albedo: resolved.inputs.albedo, normal: resolved.inputs.normal,
        roughness: resolved.inputs.roughness,
        plantLabel: flags["plant-label"] ? String(flags["plant-label"]) : undefined,
      });
      if (!outcome.ok) throw new Error(`face-regression: render refused: ${outcome.refusal}`);
    }
    const renderJson = existsSync(join(renderDir, "render.json"))
      ? JSON.parse(readFileSync(join(renderDir, "render.json"), "utf8")) as { views?: Array<{ yaw: number; png: string }>; planted?: boolean }
      : { views: [] };
    const views: Array<{ view: number; ok: boolean; failed: string[] }> = [];
    for (const v of renderJson.views ?? []) {
      const goldenPng = join(golden.versionDir, caseId, `${v.yaw}.png`);
      const currentPng = resolve(process.cwd(), v.png);
      if (!existsSync(goldenPng)) { anyAbsent = true; views.push({ view: v.yaw, ok: false, failed: [`golden missing ${goldenPng}`] }); continue; }
      const { metrics, landmarksPath } = measureViaPython({ caseId, view: v.yaw, goldenPng, currentPng, outDir: runDir });
      const verdict = evaluateFaceRegression({ metrics, thresholds, declared: declaredRegions });
      const lms = JSON.parse(readFileSync(landmarksPath, "utf8")) as { golden: [number, number][] };
      const sheetPath = join(runDir, "sheets", `${caseId}-${v.yaw}.png`);
      mkdirSync(dirname(sheetPath), { recursive: true });
      writeRegionSheet({ goldenPng, currentPng, goldenLandmarks: lms.golden, outPng: sheetPath, regions: metrics.map((m) => m.region) });
      if (!verdict.ok) anyFailed = true;
      views.push({ view: v.yaw, ok: verdict.ok, failed: verdict.failed });
    }
    results.push({ caseId, status: "ok", views });
  }

  const report = {
    card, goldenVersion: golden.version, declared: declaredRegions, runDir,
    cases: results,
    ok: !anyFailed && !anyAbsent,
  };
  writeFileSync(join(runDir, "check.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(join(runDir, "check.json"));
  return report.ok ? 0 : 1;
}

function runPromote(argv: string[]): number {
  const flags = parseFlags(argv);
  const store = String(flags.store ?? DEFAULT_STORE);
  const approvedBy = flags["approved-by"] ? String(flags["approved-by"]) : null;
  const from = flags.from ? resolve(process.cwd(), String(flags.from)) : null;
  const version = flags.version ? String(flags.version) : null;
  if (!approvedBy || !from || !version) throw new Error("face-regression --promote needs --approved-by <taskId> --from <render dir> --version <v>");
  const cases: Record<string, Record<string, string>> = {};
  for (const caseName of readdirSafe(from)) {
    const dir = join(from, caseName);
    const rjPath = join(dir, "render.json");
    if (!existsSync(rjPath)) continue;
    const rj = JSON.parse(readFileSync(rjPath, "utf8")) as { planted?: boolean; views?: Array<{ yaw: number; png: string }> };
    if (rj.planted) throw new Error(`face-regression: refused: a planted render (${caseName}) can never be promoted`);
    cases[caseName] = {};
    for (const v of rj.views ?? []) cases[caseName]![String(v.yaw)] = resolve(process.cwd(), v.png);
  }
  if (Object.keys(cases).length === 0) throw new Error(`face-regression: no case render.json under ${from}; nothing to promote`);
  const versionDir = join(store, "golden", version);
  if (existsSync(versionDir)) throw new Error(`face-regression: refused: version dir ${versionDir} already exists and is immutable`);
  const result = promoteGolden({ goldenRoot: join(store, "golden"), version, approvedBy, from, cases });
  if (!result.ok) throw new Error(`face-regression: promote refused: ${result.reason}`);
  const goldenJson = {
    version, approvedBy, from,
    files: Object.fromEntries(Object.entries(cases).map(([c, views]) => [c, Object.fromEntries(Object.entries(views).map(([v, src]) => [v, { src, sha256: sha256File(src) }]))])),
  };
  writeFileSync(join(versionDir, "golden.json"), `${JSON.stringify(goldenJson, null, 2)}\n`, "utf8");
  writeFileSync(GOLDEN_POINTER, `${JSON.stringify({ version, versionDir, promotedBy: approvedBy, from }, null, 2)}\n`, "utf8");
  console.log(versionDir);
  return 0;
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

const invokedDirectly = process.argv[1]?.endsWith("check.ts") ?? false;
if (invokedDirectly) {
  try {
    const argv = process.argv.slice(2);
    const code = argv.includes("--promote") ? runPromote(argv) : runCheck(argv);
    process.exitCode = code;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
