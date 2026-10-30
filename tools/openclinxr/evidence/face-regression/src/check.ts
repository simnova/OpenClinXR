/**
 * The whole-face regression check decision.
 *
 * `evaluateFaceRegression` is pure: given per-region metrics, per-region
 * thresholds and a declared-region list, it names every region that moved
 * beyond its threshold and was not declared. A declared region may move; every
 * other region that exceeds is a failure, because the point of the check is
 * that a change made in one card cannot silently move a region no card named.
 */
import type { RegionBounds, RegionMetric } from "./metrics.js";

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

export type CaseCheckResult = {
  caseId: string;
  status: string;
  reason?: string;
  views: Array<{ view: number; ok: boolean; failed: string[] }>;
};

/**
 * A case with no completed run is listed `absent` and does NOT fail the
 * check (the child station simply has nothing to compare yet). Every other
 * non-ok status is a failure: `refused` (no stage-4 GLB, no stage-3 albedo,
 * unknown case) names the case and fails, and a PRESENT case whose render
 * produced zero views (missing or empty render.json) fails — a present case
 * with nothing to compare is not a pass. A PRESENT case whose golden PNG is
 * missing still fails via its non-ok view.
 */
export function summarizeCheckResults(results: CaseCheckResult[]): { ok: boolean; failed: string[] } {
  const failed: string[] = [];
  for (const r of results) {
    if (r.status === "absent") continue;
    if (r.status !== "ok") {
      failed.push(`${r.caseId}: refused${r.reason ? ` ${r.reason}` : ""}`);
      continue;
    }
    if (r.views.length === 0) {
      failed.push(`${r.caseId}: no views (missing or empty render.json)`);
      continue;
    }
    for (const v of r.views) {
      if (!v.ok) failed.push(`${r.caseId}@${v.view}: ${v.failed.join(", ")}`);
    }
  }
  return { ok: failed.length === 0, failed };
}

export function evaluateFaceRegression(input: {
  metrics: RegionMetric[];
  thresholds: Record<string, RegionThreshold>;
  declared?: string[];
  /**
   * The ten regions the metrics list must cover (the CLI reads them from
   * `regions.py --dump-regions`, never retyped in TS). A metrics list that
   * lacks any of them fails; a region with `pixels: 0` fails as `empty mask`;
   * a region with no threshold fails as `no threshold`.
   */
  expectedRegions?: string[];
}): CheckVerdict {
  const declared = new Set(input.declared ?? []);
  const regions: RegionVerdict[] = [];
  const failed: string[] = [];
  const seen = new Set<string>();
  const missingThreshold: RegionThreshold = { dE: Infinity, ssimL: -Infinity };
  for (const m of input.metrics) {
    seen.add(m.region);
    const isDeclared = declared.has(m.region);
    if (m.pixels === 0) {
      failed.push(`${m.region}: empty mask`);
      regions.push({ ...m, declared: isDeclared, threshold: input.thresholds[m.region] ?? missingThreshold, pass: false });
      continue;
    }
    const threshold = input.thresholds[m.region];
    if (!threshold) {
      failed.push(`${m.region}: no threshold`);
      regions.push({ ...m, declared: isDeclared, threshold: missingThreshold, pass: false });
      continue;
    }
    const within = m.dE <= threshold.dE && m.ssimL >= threshold.ssimL;
    const pass = within || isDeclared;
    if (!pass) failed.push(m.region);
    regions.push({ ...m, declared: isDeclared, threshold, pass });
  }
  for (const r of input.expectedRegions ?? []) {
    if (!seen.has(r)) failed.push(`${r}: missing region`);
  }
  return { ok: failed.length === 0, failed, regions };
}

// ---------------------------------------------------------------------------
// CLI: `check` compares the station's current whole-face render with the last
// accepted golden and fails on any undeclared region; `--promote` writes a NEW
// immutable golden version and rewrites the tracked pointer.
//
//   check    --case <id|all> --declare <r1,r2|none> --card <taskId>
//            [--label <name>] [--golden <dir>] [--render <dir>] [--store <root>]
//            [--plant-glb <path> --plant-label <name>]
//   check    --render-only --label <name> --case <id|all> --card <taskId>
//            [--store <root>] [--plant-glb <path> --plant-label <name>]
//   --promote --approved-by <taskId> --from <render dir> --version <v>
//            [--store <root>]
//
// --label scopes outputs to runs/<card>/<label>/ (render, sheets, metrics,
// check.json). --golden takes a promoted version dir (<case>/<yaw>.png) OR an
// unpromoted render dir (<case>/render.json naming its PNGs); the default is
// the tracked golden-pointer.json. --render-only renders without golden or
// thresholds (the seed is rendered before any golden exists).
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
const CASE_INPUTS = "packages/openclinxr/stations/face-realism/src/case-inputs.json";
const RUN_REPORT = "packages/openclinxr/stations/face-realism/src/case-run-report.json";
// The brief names /Volumes/files/openclinxr-assets/store/face-regression (no
// /src): the store lives at /Volumes/files/openclinxr-assets, which is also
// where the station's own record (case-run-report.json:store) points.
// Overridable via FACE_REGRESSION_STORE / --store so the right root is used
// wherever the store is mounted.
const DEFAULT_STORE = process.env.FACE_REGRESSION_STORE
  ?? "/Volumes/files/openclinxr-assets/store/face-regression";

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
  return loadThresholdsFrom(CALIBRATION);
}

/** The check refuses to run while the calibration is not `calibrated`: with
 *  no thresholds every region would fail as `no threshold` (D3). */
export function loadThresholdsFrom(calPath: string): Record<string, { dE: number; ssimL: number }> {
  if (!existsSync(calPath)) {
    throw new Error(`face-regression: no calibration at ${calPath}; run the noise/floor calibration (STEP 5/6) first`);
  }
  const cal = JSON.parse(readFileSync(calPath, "utf8")) as Calibration & { status?: string };
  if (cal.status !== "calibrated") {
    throw new Error(`face-regression: calibration at ${calPath} has status '${cal.status ?? "missing"}', refusing; calibrate (STEP 5) first`);
  }
  const model = thresholdsFromCalibration(cal);
  const out: Record<string, { dE: number; ssimL: number }> = {};
  for (const [region, t] of Object.entries(model)) out[region] = { dE: t.maxDE, ssimL: t.minSsimL };
  return out;
}

/**
 * The ten regions the metrics list must cover, read from the single
 * implementation (`regions.py --dump-regions`), never retyped in TS (D4).
 */
export function loadExpectedRegions(input?: { regionsPy?: string; miseRoot?: string }): string[] {
  const proc = spawnSync(
    "mise",
    ["exec", "-C", input?.miseRoot ?? "/Volumes/files/src/openclinxr", "--", "python3", input?.regionsPy ?? REGIONS_PY, "--dump-regions"],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (proc.status !== 0) {
    throw new Error(`face-regression: --dump-regions refused: ${(proc.stderr || proc.stdout || "").slice(-2000)}`);
  }
  const table = JSON.parse(proc.stdout) as { PRECEDENCE: string[] };
  if (!Array.isArray(table.PRECEDENCE) || table.PRECEDENCE.length === 0) {
    throw new Error("face-regression: --dump-regions returned no PRECEDENCE list");
  }
  return table.PRECEDENCE;
}

export type GoldenSource = { kind: "promoted"; dir: string; version?: string | null } | { kind: "render-dir"; dir: string; version?: string | null };

/** A render dir holds per-case subdirs each naming its PNGs in render.json;
 *  a promoted version dir holds <case>/<yaw>.png directly. */
export function resolveGoldenSource(dir: string): GoldenSource {
  for (const entry of readdirSafe(dir)) {
    if (existsSync(join(dir, entry, "render.json"))) return { kind: "render-dir", dir };
  }
  return { kind: "promoted", dir };
}

export function goldenPngFor(source: GoldenSource, caseId: string, yaw: number): string {
  if (source.kind === "promoted") return join(source.dir, caseId, `${yaw}.png`);
  const rj = JSON.parse(readFileSync(join(source.dir, caseId, "render.json"), "utf8")) as {
    views?: Array<{ yaw: number; png: string }>;
  };
  const hit = (rj.views ?? []).find((v) => v.yaw === yaw);
  if (!hit) throw new Error(`face-regression: golden render dir ${source.dir} has no ${caseId} view ${yaw}`);
  return resolve(process.cwd(), hit.png);
}

/** `--label <name>` scopes a check's outputs to runs/<card>/<label>/
 *  (render, sheets, metrics, check.json) so seed, noise, known-good and
 *  known-bad renders never overwrite each other (D10). */
export function resolveRunPaths(input: { store: string; card: string; label?: string }): {
  cardDir: string;
  label: string;
  labelDir: string;
} {
  const label = input.label && input.label.length > 0 ? input.label : "check";
  if (!/^[a-z0-9._-]+$/i.test(label)) throw new Error(`face-regression: --label '${label}' is not a simple dir name`);
  const cardDir = join(input.store, "runs", input.card);
  return { cardDir, label, labelDir: join(cardDir, label) };
}

type CaseRunReportShape = { store?: string; cases: Record<string, { runs: Record<string, { status: string }> }> };

export type PythonRegionMetric = RegionMetric & { bbox: RegionBounds; heatmap: string };

export function measureRegions(input: {
  caseId: string;
  view: number | string;
  goldenPng: string;
  currentPng: string;
  outDir: string;
  fileTag: string;
  extraArgs?: string[];
}): { metrics: PythonRegionMetric[]; metricsPath: string; landmarksPath: string; heatmapDir: string } {
  const metricsPath = join(input.outDir, `${input.fileTag}-${input.caseId}-${input.view}.json`);
  const landmarksPath = join(input.outDir, `landmarks-${input.fileTag}-${input.caseId}-${input.view}.json`);
  const heatmapDir = join(input.outDir, "heatmaps", `${input.fileTag}-${input.caseId}-${input.view}`);
  const proc = spawnSync(
    "mise",
    ["exec", "-C", "/Volumes/files/src/openclinxr", "--", "python3", REGIONS_PY,
      "--golden", input.goldenPng, "--current", input.currentPng,
      "--out", metricsPath, "--landmarks-out", landmarksPath,
      "--heatmap-dir", heatmapDir,
      "--case", input.caseId, "--view", String(input.view),
      ...(input.extraArgs ?? [])],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (proc.status !== 0 || !existsSync(metricsPath)) {
    throw new Error(`face-regression: regions.py refused: ${(proc.stderr || proc.stdout || "").slice(-2000)}`);
  }
  const report = JSON.parse(readFileSync(metricsPath, "utf8")) as { metrics: PythonRegionMetric[] };
  return { metrics: report.metrics, metricsPath, landmarksPath, heatmapDir };
}

function measureViaPython(input: { caseId: string; view: number; goldenPng: string; currentPng: string; outDir: string }): { metrics: PythonRegionMetric[]; landmarksPath: string; heatmapDir: string } {
  const { metrics, landmarksPath, heatmapDir } = measureRegions({ ...input, fileTag: "metrics" });
  return { metrics, landmarksPath, heatmapDir };
}

function readGoldenPointer(store: string): { version: string; versionDir: string } {
  const ptr = JSON.parse(readFileSync(GOLDEN_POINTER, "utf8")) as { version?: string | null; versionDir?: string | null };
  if (!ptr.version || !ptr.versionDir) {
    throw new Error(`face-regression: no golden promoted yet (${GOLDEN_POINTER}); promote a seed before checking`);
  }
  return { version: ptr.version, versionDir: ptr.versionDir.startsWith("/") ? ptr.versionDir : join(store, "golden", ptr.version) };
}

function renderSelectedCases(input: {
  cases: string[];
  runReport: CaseRunReportShape;
  store: string;
  labelDir: string;
  flags: Args;
}): Array<{ caseId: string; runId: string; renderDir: string; planted: boolean; plantLabel: string | null }> {
  const done: Array<{ caseId: string; runId: string; renderDir: string; planted: boolean; plantLabel: string | null }> = [];
  for (const caseId of input.cases) {
    const resolved = resolveCaseRenderInputs({ caseId, store: input.runReport.store ?? input.store, runReport: input.runReport });
    if (!resolved.ok) {
      throw new Error(`face-regression: render-only refused for ${caseId}: ${resolved.reason}`);
    }
    const renderDir = input.flags.render ? String(input.flags.render) : join(input.labelDir, "render", caseId);
    const variantPath = join(input.labelDir, "variants", `${caseId}.variant.json`);
    const plantGlb = input.flags["plant-glb"] ? String(input.flags["plant-glb"]) : null;
    const glbAbs = plantGlb ?? resolved.inputs.glb;
    // A planted GLB is deliberately NOT the recorded one (that is the whole
    // point of the known-bad arm); every OTHER recorded input is still
    // re-hashed and refused on mismatch. The GLB itself is proven through the
    // tool's glb.sha256, not its inputs map (textures only), so provenance
    // covers the non-GLB record inputs; render.json still records every input.
    const recorded = resolved.inputs.recordShas.filter((r) => plantGlb === null || r.path !== resolved.inputs.glb);
    const provenanceInputs = recorded.filter((r) => r.path !== resolved.inputs.glb);
    const shaCheck = verifyInputShas({ inputs: recorded, hashFile: sha256File });
    if (!shaCheck.ok) throw new Error(`face-regression: input refused before render (sha mismatch): ${JSON.stringify(shaCheck.mismatches)} missing ${JSON.stringify(shaCheck.missing)}`);
    const outcome = renderCase({
      cwd: process.cwd(), caseId, runId: resolved.runId, runDir: renderDir,
      recordGlbSha256: plantGlb ? sha256File(plantGlb) : resolved.inputs.recordShas.find((r) => r.path === resolved.inputs.glb)?.sha256 ?? "",
      recordInputs: provenanceInputs,
      variantPath, glbAbs, albedo: resolved.inputs.albedo, normal: resolved.inputs.normal,
      roughness: resolved.inputs.roughness,
      plantLabel: input.flags["plant-label"] ? String(input.flags["plant-label"]) : undefined,
    });
    if (!outcome.ok) throw new Error(`face-regression: render refused: ${outcome.refusal}`);
    done.push({ caseId, runId: resolved.runId, renderDir, planted: outcome.planted, plantLabel: outcome.plantLabel ?? null });
  }
  return done;
}

function runCheck(argv: string[]): number {
  const flags = parseFlags(argv);
  const store = String(flags.store ?? DEFAULT_STORE);
  const card = flags.card ? String(flags.card) : null;
  if (!card) throw new Error("face-regression check: --card <taskId> is required (names the run dir)");
  const { label, labelDir } = resolveRunPaths({ store, card, label: flags.label ? String(flags.label) : undefined });
  mkdirSync(labelDir, { recursive: true });

  const runReport = JSON.parse(readFileSync(RUN_REPORT, "utf8")) as CaseRunReportShape;
  const caseInputs = JSON.parse(readFileSync(CASE_INPUTS, "utf8")) as { cases: Record<string, unknown> };
  const allCases = Object.keys(caseInputs.cases ?? {});
  const selection = String(flags.case ?? "all");
  const cases = selection === "all" ? allCases : selection.split(",").map((s) => s.trim());
  for (const c of cases) {
    if (!allCases.includes(c)) throw new Error(`face-regression check: unknown case ${c}`);
  }

  // Render-only mode renders the station output under the label without any
  // golden or threshold: the seed is rendered before any golden exists (D10).
  if (flags["render-only"]) {
    const done = renderSelectedCases({ cases, runReport, store, labelDir, flags });
    const summary = { card, label, labelDir, renderOnly: true, cases: done };
    writeFileSync(join(labelDir, "render.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(join(labelDir, "render.json"));
    return 0;
  }

  let golden: GoldenSource & { version: string | null };
  if (flags.golden) {
    const src = resolveGoldenSource(resolve(process.cwd(), String(flags.golden)));
    golden = src.kind === "promoted"
      ? { kind: "promoted", dir: src.dir, version: null }
      : { kind: "render-dir", dir: src.dir, version: null };
  } else {
    const ptr = readGoldenPointer(store);
    golden = { kind: "promoted", dir: ptr.versionDir, version: ptr.version };
  }
  const thresholds = loadThresholds();
  const expectedRegions = loadExpectedRegions();
  const declaredRegions = parseDeclared(flags);

  const results: CaseCheckResult[] = [];
  const rendered: Array<{ caseId: string; runId: string; renderDir: string; planted: boolean; plantLabel: string | null }> = [];
  const renderDirs = new Map<string, string>();
  const runIds = new Map<string, string>();
  // Fresh renders go through the shared path (re-hash, explicit --glb,
  // capture provenance); --render <dir> reuses existing render.json files.
  const toRender = flags.render ? [] : cases.filter((caseId) => {
    const resolved = resolveCaseRenderInputs({ caseId, store: runReport.store ?? store, runReport });
    return resolved.ok;
  });
  for (const r of renderSelectedCases({ cases: toRender, runReport, store, labelDir, flags })) {
    rendered.push(r);
    renderDirs.set(r.caseId, r.renderDir);
    runIds.set(r.caseId, r.runId);
  }

  for (const caseId of cases) {
    const resolved = resolveCaseRenderInputs({ caseId, store: runReport.store ?? store, runReport });
    if (!resolved.ok) {
      results.push({ caseId, status: resolved.status, reason: resolved.reason, views: [] });
      continue;
    }
    const renderDir = flags.render ? String(flags.render) : renderDirs.get(caseId)!;
    const renderJson = existsSync(join(renderDir, "render.json"))
      ? JSON.parse(readFileSync(join(renderDir, "render.json"), "utf8")) as { runId?: string; views?: Array<{ yaw: number; png: string }>; planted?: boolean }
      : { views: [] as Array<{ yaw: number; png: string }> };
    const caseRunId = renderJson.runId ?? resolved.runId;
    if (!flags.render) {
      const slot = rendered.find((r) => r.caseId === caseId);
      if (slot && renderJson.runId && slot.runId !== renderJson.runId) {
        throw new Error(`face-regression: render.json run ${renderJson.runId} != resolved run ${slot.runId} for ${caseId}`);
      }
    }
    const views: Array<{ view: number; ok: boolean; failed: string[] }> = [];
    for (const v of renderJson.views ?? []) {
      let goldenPng: string;
      try {
        goldenPng = goldenPngFor(golden, caseId, v.yaw);
      } catch (err) {
        views.push({ view: v.yaw, ok: false, failed: [err instanceof Error ? err.message : String(err)] });
        continue;
      }
      const currentPng = resolve(process.cwd(), v.png);
      if (!existsSync(goldenPng)) { views.push({ view: v.yaw, ok: false, failed: [`golden missing ${goldenPng}`] }); continue; }
      const { metrics, heatmapDir } = measureViaPython({ caseId, view: v.yaw, goldenPng, currentPng, outDir: labelDir });
      const verdict = evaluateFaceRegression({ metrics, thresholds, declared: declaredRegions, expectedRegions });
      const bounds: Record<string, RegionBounds> = {};
      const heatmaps: Record<string, string> = {};
      for (const m of metrics) {
        bounds[m.region] = m.bbox;
        heatmaps[m.region] = join(heatmapDir, m.heatmap);
      }
      const sheetPath = join(labelDir, "sheets", `${caseId}-${v.yaw}.png`);
      mkdirSync(dirname(sheetPath), { recursive: true });
      writeRegionSheet({
        goldenPng, currentPng, outPng: sheetPath,
        regions: metrics.map((m) => m.region), bounds, heatmaps,
        fullHeatmap: join(heatmapDir, "full.png"),
      });
      views.push({ view: v.yaw, ok: verdict.ok, failed: verdict.failed });
    }
    results.push({ caseId, status: "ok", reason: `station run ${caseRunId}`, views });
  }

  const summary = summarizeCheckResults(results);
  const report = {
    card, label, golden: { kind: golden.kind, dir: golden.dir, version: golden.version, promoted: golden.kind === "promoted" },
    declared: declaredRegions, labelDir,
    rendered: rendered.length > 0 ? rendered : undefined,
    cases: results,
    absent: results.filter((r) => r.status === "absent").map((r) => r.caseId),
    failed: summary.failed,
    ok: summary.ok,
  };
  writeFileSync(join(labelDir, "check.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(join(labelDir, "check.json"));
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
  // D9: golden.json carries, per case, the station run id and the record shas
  // from render.json (the brief requires them), not only the png shas.
  const provenance: Record<string, { runId: string | null; inputs: Array<{ path: string; sha256: string }>; planted: boolean; plantLabel: string | null }> = {};
  for (const caseName of readdirSafe(from)) {
    const dir = join(from, caseName);
    const rjPath = join(dir, "render.json");
    if (!existsSync(rjPath)) continue;
    const rj = JSON.parse(readFileSync(rjPath, "utf8")) as {
      runId?: string;
      planted?: boolean;
      plantLabel?: string | null;
      inputs?: Array<{ path: string; sha256: string }>;
      views?: Array<{ yaw: number; png: string }>;
    };
    if (rj.planted) throw new Error(`face-regression: refused: a planted render (${caseName}) can never be promoted`);
    cases[caseName] = {};
    for (const v of rj.views ?? []) cases[caseName]![String(v.yaw)] = resolve(process.cwd(), v.png);
    provenance[caseName] = { runId: rj.runId ?? null, inputs: rj.inputs ?? [], planted: Boolean(rj.planted), plantLabel: rj.plantLabel ?? null };
  }
  if (Object.keys(cases).length === 0) throw new Error(`face-regression: no case render.json under ${from}; nothing to promote`);
  const versionDir = join(store, "golden", version);
  if (existsSync(versionDir)) throw new Error(`face-regression: refused: version dir ${versionDir} already exists and is immutable`);
  const result = promoteGolden({ goldenRoot: join(store, "golden"), version, approvedBy, from, cases });
  if (!result.ok) throw new Error(`face-regression: promote refused: ${result.reason}`);
  const goldenJson = {
    version, approvedBy, from,
    files: Object.fromEntries(Object.entries(cases).map(([c, views]) => [c, Object.fromEntries(Object.entries(views).map(([v, src]) => [v, { src, sha256: sha256File(src) }]))])),
    provenance,
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
