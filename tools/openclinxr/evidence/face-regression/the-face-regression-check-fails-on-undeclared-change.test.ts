import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateFaceRegression,
  promoteGolden,
  summarizeCheckResults,
  verifyInputShas,
  type Landmark,
  type RegionMetric,
} from "./src/index.js";
import { encodePngRgb } from "./src/png.js";

/**
 * Whole-face regression contract (card tsk_0e618fa5e9ac3e15).
 *
 * Every prior card graded only its own region in its own render path, so a
 * stale GLB's pink eyes, double brows, a dropped detail_bands pass and an
 * olive lip band each passed their own gate while the whole face regressed.
 * This contract proves the check that re-renders the station's actual face
 * output and compares it with the last accepted state.
 *
 * Single implementation: regions are measured ONLY by src/regions.py (skimage
 * CIEDE2000), driven here through the same `mise exec` spawn the `check` CLI
 * uses, with fixture landmark JSONs skipping detection. The decision goes
 * through the same `evaluateFaceRegression` the CLI uses. Synthetic fixtures
 * only: PNGs generated in a temp dir, fixture landmarks, and fake
 * station-record files carrying their real sha256.
 */

const REGIONS_PY = fileURLToPath(new URL("./src/regions.py", import.meta.url));
const MISE_ROOT = "/Volumes/files/src/openclinxr";
const SPAWN_TIMEOUT = 180_000;

const W = 240;
const H = 240;
const SKIN: [number, number, number] = [200, 160, 140];
const PAINT: [number, number, number] = [80, 40, 40];

const REGION_CENTRES: Record<string, [number, number]> = {
  eye_L: [80, 100],
  eye_R: [160, 100],
  brow_L: [80, 78],
  brow_R: [160, 78],
  lips: [120, 152],
  nose: [120, 120],
  cheek_L: [70, 130],
  cheek_R: [170, 130],
  forehead: [120, 58],
  chin: [120, 178],
};

type RegionTable = { REGION_LANDMARKS: Record<string, number[]>; REGION_ORDER: string[]; PRECEDENCE: string[] };

let cachedTable: RegionTable | null = null;

/** The region table, read from the single implementation (never duplicated). */
function regionTable(): RegionTable {
  if (!cachedTable) {
    const proc = spawnSync("mise", ["exec", "-C", MISE_ROOT, "--", "python3", REGIONS_PY, "--dump-regions"], {
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT,
    });
    if (proc.status !== 0) throw new Error(`regions.py --dump-regions refused: ${(proc.stderr || proc.stdout || "").slice(-2000)}`);
    cachedTable = JSON.parse(proc.stdout) as RegionTable;
  }
  return cachedTable;
}

function fakeLandmarks(): Landmark[] {
  const table = regionTable();
  const lms: Landmark[] = Array.from({ length: 478 }, () => [120, 120] as Landmark);
  for (const [region, idxs] of Object.entries(table.REGION_LANDMARKS)) {
    const centre = REGION_CENTRES[region];
    if (!centre) throw new Error(`test has no centre for region ${region}`);
    idxs.forEach((idx, k) => {
      const ang = (k / idxs.length) * Math.PI * 2;
      lms[idx] = [centre[0] + Math.cos(ang) * 10, centre[1] + Math.sin(ang) * 10];
    });
  }
  return lms;
}

function solidPng(rgb: [number, number, number]): Uint8Array {
  const px = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i += 1) {
    px[i * 3] = rgb[0];
    px[i * 3 + 1] = rgb[1];
    px[i * 3 + 2] = rgb[2];
  }
  return px;
}

/** Solid skin image, optionally with a filled disk painted over one region. */
function facePng(paintAt?: [number, number]): Uint8Array {
  const px = solidPng(SKIN);
  if (paintAt) {
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if ((x - paintAt[0]) ** 2 + (y - paintAt[1]) ** 2 <= 9 * 9) {
          const i = (y * W + x) * 3;
          px[i] = PAINT[0];
          px[i + 1] = PAINT[1];
          px[i + 2] = PAINT[2];
        }
      }
    }
  }
  return px;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type Fx = {
  dir: string;
  golden: string;
  unchanged: string;
  painted: string;
  landmarksPath: string;
  thresholds: Record<string, { dE: number; ssimL: number }>;
};

function makeFixtures(): Fx {
  const table = regionTable();
  const dir = mkdtempSync(join(tmpdir(), "face-regression-red-"));
  const golden = join(dir, "golden-front.png");
  const unchanged = join(dir, "unchanged-front.png");
  const painted = join(dir, "painted-front.png");
  writeFileSync(golden, encodePngRgb(W, H, facePng()));
  writeFileSync(unchanged, encodePngRgb(W, H, facePng()));
  writeFileSync(painted, encodePngRgb(W, H, facePng(REGION_CENTRES.eye_L!)));
  const landmarksPath = join(dir, "landmarks.json");
  writeFileSync(landmarksPath, `${JSON.stringify(fakeLandmarks())}\n`, "utf8");
  const thresholds: Record<string, { dE: number; ssimL: number }> = {};
  for (const region of table.REGION_ORDER) thresholds[region] = { dE: 2.0, ssimL: 0.98 };
  return { dir, golden, unchanged, painted, landmarksPath, thresholds };
}

type PythonReport = {
  precedence: string[];
  heatmapScale: { metric: string; min: number; max: number; mapping: string };
  heatmapDir: string;
  metrics: Array<RegionMetric & { bbox: { x0: number; y0: number; x1: number; y1: number }; heatmap: string }>;
};

/** Measure via the production path: regions.py through mise, fixture landmarks. */
function measureViaPython(fx: Fx, currentPng: string, tag: string): PythonReport {
  const outDir = join(fx.dir, tag);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, "metrics.json");
  const heatmapDir = join(outDir, "heatmaps");
  const proc = spawnSync(
    "mise",
    ["exec", "-C", MISE_ROOT, "--", "python3", REGIONS_PY,
      "--golden", fx.golden, "--current", currentPng,
      "--out", out, "--heatmap-dir", heatmapDir,
      "--golden-landmarks", fx.landmarksPath, "--current-landmarks", fx.landmarksPath,
      "--case", "test", "--view", "0"],
    { encoding: "utf8", timeout: SPAWN_TIMEOUT, maxBuffer: 64 * 1024 * 1024 },
  );
  if (proc.status !== 0 || !existsSync(out)) {
    throw new Error(`regions.py refused: ${(proc.stderr || proc.stdout || "").slice(-2000)}`);
  }
  return JSON.parse(readFileSync(out, "utf8")) as PythonReport;
}

describe("the face-regression check fails on undeclared change", () => {
  it("(1) unchanged image vs golden passes and every region is within threshold", { timeout: SPAWN_TIMEOUT }, () => {
    const fx = makeFixtures();
    const report = measureViaPython(fx, fx.unchanged, "unchanged");
    const table = regionTable();
    expect(report.metrics.map((m) => m.region).sort()).toEqual([...table.REGION_ORDER].sort());
    expect(report.precedence, "precedence recorded in the metrics JSON").toEqual(table.PRECEDENCE);
    expect(report.heatmapScale.metric, "fixed heatmap colour scale stated").toMatch(/CIEDE2000/);
    for (const m of report.metrics) {
      expect(existsSync(join(report.heatmapDir, m.heatmap)), `${m.region} heatmap PNG written`).toBe(true);
    }
    const verdict = evaluateFaceRegression({ metrics: report.metrics, thresholds: fx.thresholds });
    expect(verdict.failed, "unchanged render fails nothing").toEqual([]);
    expect(verdict.ok).toBe(true);
    for (const r of verdict.regions) {
      expect(r.dE, `${r.region} dE on an identical render`).toBeLessThanOrEqual(fx.thresholds[r.region]!.dE);
    }
  });

  it("(2) a change painted into eye_L but undeclared FAILS and names eye_L", { timeout: SPAWN_TIMEOUT }, () => {
    const fx = makeFixtures();
    const report = measureViaPython(fx, fx.painted, "painted");
    const verdict = evaluateFaceRegression({ metrics: report.metrics, thresholds: fx.thresholds });
    expect(verdict.ok, "an undeclared regional change is a failure").toBe(false);
    expect(verdict.failed, "the failing region is named").toContain("eye_L");
  });

  it("(2b) a change painted only inside the eye_L mask fails eye_L and no other region", { timeout: SPAWN_TIMEOUT }, () => {
    const fx = makeFixtures();
    const report = measureViaPython(fx, fx.painted, "single-region");
    const verdict = evaluateFaceRegression({ metrics: report.metrics, thresholds: fx.thresholds });
    expect(verdict.failed, "disjoint masks: only the painted region fails").toEqual(["eye_L"]);
    for (const m of report.metrics) {
      if (m.region === "eye_L") continue;
      expect(m.dE, `${m.region} shares no pixel with the eye_L change`).toBe(0);
    }
  });

  it("(3) the same eye_L change with declare eye_L passes", { timeout: SPAWN_TIMEOUT }, () => {
    const fx = makeFixtures();
    const report = measureViaPython(fx, fx.painted, "declared");
    const verdict = evaluateFaceRegression({ metrics: report.metrics, thresholds: fx.thresholds, declared: ["eye_L"] });
    expect(verdict.ok, "a declared region may move").toBe(true);
    expect(verdict.failed).toEqual([]);
    const eye = verdict.regions.find((r) => r.region === "eye_L")!;
    expect(eye.declared, "eye_L is marked declared").toBe(true);
  });

  it("(4) promoting into an existing golden version dir is refused and the dir bytes are unchanged", () => {
    const fx = makeFixtures();
    const goldenRoot = join(fx.dir, "golden");
    const version = "v1";
    const existing = join(goldenRoot, version);
    mkdirSync(existing, { recursive: true });
    writeFileSync(join(existing, "keep.txt"), "do not touch");
    const before = readdirSync(existing).map((n) => `${n}:${sha256(readFileSync(join(existing, n)))}`).sort();
    const result = promoteGolden({
      goldenRoot,
      version,
      approvedBy: "tsk_test_card",
      from: fx.dir,
      cases: { eye_L_case: { "0": fx.painted } },
    });
    expect(result.ok, "an existing version dir is never opened for write").toBe(false);
    expect(String(result.reason)).toMatch(/exists|immutable|refus/i);
    const after = readdirSync(existing).map((n) => `${n}:${sha256(readFileSync(join(existing, n)))}`).sort();
    expect(after, "existing version dir bytes unchanged").toEqual(before);
  });

  it("(5) a render input whose sha256 differs from the station record is refused", () => {
    const fx = makeFixtures();
    const recorded = sha256(readFileSync(fx.golden));
    const ok = verifyInputShas({ inputs: [{ path: fx.golden, sha256: recorded }], hashFile: (p) => sha256(readFileSync(p)) });
    expect(ok.ok).toBe(true);
    const planted = verifyInputShas({ inputs: [{ path: fx.painted, sha256: recorded }], hashFile: (p) => sha256(readFileSync(p)) });
    expect(planted.ok, "a GLB/albedo whose real sha differs from the record is refused").toBe(false);
    expect(planted.mismatches.map((m) => m.path)).toContain(fx.painted);
  });

  it("(6) a case with no completed run in the record is listed absent with no substitute", async () => {
    const mod = await import("./src/index.js");
    const resolved = mod.resolveCaseRun({
      caseId: "ghost_case",
      caseIds: ["ghost_case"],
      runReport: { cases: { ghost_case: { runs: { run1: { status: "refused" } } } } },
    });
    expect(resolved.status, "no completed run means absent, not a substitute").toBe("absent");
    expect(resolved.caseId).toBe("ghost_case");
    // Guard against a hidden fallback: the module must expose the status union.
    expect(typeof resolved.reason).toBe("string");
  });

  it("(6b) an absent case is listed absent in the summary and does not fail the check", () => {
    const summary = summarizeCheckResults([{ caseId: "ghost_case", status: "absent", views: [] }]);
    expect(summary.ok, "no completed run is not a regression").toBe(true);
    expect(summary.failed).toEqual([]);
  });

  it("(6c) a present case whose golden PNG is missing still fails", () => {
    const summary = summarizeCheckResults([
      { caseId: "ghost_case", status: "absent", views: [] },
      { caseId: "aisha", status: "ok", views: [{ view: 0, ok: false, failed: ["golden missing /store/golden/v1/aisha/0.png"] }] },
    ]);
    expect(summary.ok, "a missing golden for a present case is a failure").toBe(false);
    expect(summary.failed.join(" "), "the failing case is named").toMatch(/aisha/);
  });
});

describe("fixture sanity", () => {
  it("the region table covers the ten named face regions with real landmark indices", () => {
    const table = regionTable();
    expect(table.REGION_ORDER.sort()).toEqual([
      "brow_L", "brow_R", "cheek_L", "cheek_R", "chin",
      "eye_L", "eye_R", "forehead", "lips", "nose",
    ]);
    for (const region of table.REGION_ORDER) {
      expect(table.REGION_LANDMARKS[region]!.length, `${region} landmark indices`).toBeGreaterThanOrEqual(3);
    }
  });

  it("the temp fixture dir is outside the worktree", () => {
    const fx = makeFixtures();
    expect(existsSync(fx.dir)).toBe(true);
    expect(fx.dir.startsWith(tmpdir())).toBe(true);
  });
});
