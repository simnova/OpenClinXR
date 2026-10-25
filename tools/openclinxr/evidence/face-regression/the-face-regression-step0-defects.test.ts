import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertCaptureProvenance,
  evaluateFaceRegression,
  goldenPngFor,
  loadThresholdsFrom,
  resolveCaseRenderInputs,
  resolveGoldenSource,
  resolveRunPaths,
  summarizeCheckResults,
  type CaseRunReport,
  type RegionMetric,
} from "./src/index.js";
import { encodePngRgb } from "./src/png.js";
import { decodePng } from "../decode-png.js";
import { writeRegionSheet } from "./src/index.js";

/**
 * STEP 0 review defects (card tsk_0e618fa5e9ac3e15 handback h2).
 *
 * Fixture-level only: synthetic PNGs in a temp dir, fixture run records
 * shaped like the real case-run-report.json, fixture calibration JSONs.
 * No station renders. The D4 region list comes from `regions.py
 * --dump-regions` (never retyped in TS); the D11 floor/heatmap arms drive
 * regions.py with fixture landmarks (no detection, no renders).
 */

const REGIONS_PY = fileURLToPath(new URL("./src/regions.py", import.meta.url));
const MISE_ROOT = "/Volumes/files/src/openclinxr";
const SPAWN_TIMEOUT = 180_000;

function fxDir(tag: string): string {
  return mkdtempSync(join(tmpdir(), `face-regression-step0-${tag}-`));
}

function solidPng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const px = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i += 1) {
    px[i * 3] = rgb[0];
    px[i * 3 + 1] = rgb[1];
    px[i * 3 + 2] = rgb[2];
  }
  return Buffer.from(encodePngRgb(w, h, px));
}

function dumpRegions(): string[] {
  const proc = spawnSync("mise", ["exec", "-C", MISE_ROOT, "--", "python3", REGIONS_PY, "--dump-regions"], {
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT,
  });
  if (proc.status !== 0) throw new Error(`--dump-regions refused: ${(proc.stderr || proc.stdout || "").slice(-2000)}`);
  return (JSON.parse(proc.stdout) as { PRECEDENCE: string[] }).PRECEDENCE;
}

function syntheticMetrics(regions: string[]): RegionMetric[] {
  return regions.map((region) => ({ region, dE: 0.1, ssimL: 0.999, landmarkDispPx: 0.05, pixels: 40 }));
}

function thresholdsFor(regions: string[]): Record<string, { dE: number; ssimL: number }> {
  return Object.fromEntries(regions.map((r) => [r, { dE: 2.0, ssimL: 0.98 }]));
}

/** Fixture run report shaped like the real record: stage 3 names the final
 *  albedo in extra.finalAlbedo, stage 4 carries the skin-normal byproduct. */
function fixtureReport(input?: { noFinalAlbedo?: boolean; noNormal?: boolean; normalName?: string }): CaseRunReport {
  const albedoFile = "/store/body2/run7/albedo_detail.png";
  const normalFile = `/store/body2/run7/${input?.normalName ?? "body2-lidconform.skin-normal.png"}`;
  const stages: CaseRunReport["cases"][string]["runs"][string]["stages"] = [
    {
      stage: 3,
      name: "skin_chain",
      outputs: [
        { path: "/store/body2/run7/albedo_corners.png", sha256: "aa".repeat(32) },
        { path: "/store/body2/run7/roughness.png", sha256: "bb".repeat(32) },
        { path: albedoFile, sha256: "cc".repeat(32) },
      ],
      ...(input?.noFinalAlbedo
        ? {}
        : { extra: { finalAlbedo: { file: albedoFile, sha256: "cc".repeat(32), stage: "detail_bands" } } }),
    },
    {
      stage: 4,
      name: "lid_conform_bake",
      outputs: [{ path: "/store/body2/run7/body2-lidconform.glb", sha256: "dd".repeat(32) }],
      ...(input?.noNormal ? {} : { byproducts: [{ path: normalFile, sha256: "ee".repeat(32) }] }),
    },
  ];
  return { cases: { body2: { runs: { run7: { status: "completed", stages } } } } };
}

describe("STEP0 D1 refused is a failure", () => {
  it("a refused case fails the summary and is named", () => {
    const summary = summarizeCheckResults([
      { caseId: "ghost", status: "refused", reason: "ghost: no stage-4 lid-conform GLB output", views: [] },
    ]);
    expect(summary.ok).toBe(false);
    expect(summary.failed.join(" ")).toMatch(/ghost/);
  });

  it("an unknown non-ok status fails closed", () => {
    const summary = summarizeCheckResults([{ caseId: "x", status: "weird", views: [] }]);
    expect(summary.ok).toBe(false);
  });
});

describe("STEP0 D2 zero views is a failure", () => {
  it("a present case with no views fails", () => {
    const summary = summarizeCheckResults([{ caseId: "aisha", status: "ok", views: [] }]);
    expect(summary.ok, "a present case with nothing to compare is not a pass").toBe(false);
    expect(summary.failed.join(" ")).toMatch(/aisha/);
  });
});

describe("STEP0 D3 missing threshold is a failure", () => {
  it("a region with no threshold fails as `no threshold`", () => {
    const regions = dumpRegions();
    const verdict = evaluateFaceRegression({ metrics: syntheticMetrics(regions), thresholds: {}, expectedRegions: regions });
    expect(verdict.ok).toBe(false);
    expect(verdict.failed, "every region names `no threshold`").toHaveLength(regions.length);
    for (const f of verdict.failed) expect(f).toMatch(/no threshold/);
  });

  it("check refuses while the calibration status is uncalibrated", () => {
    const dir = fxDir("cal");
    const calPath = join(dir, "calibration.json");
    writeFileSync(calPath, `${JSON.stringify({ status: "uncalibrated", perturbation: "p", seed: 1, regions: {} })}\n`, "utf8");
    expect(() => loadThresholdsFrom(calPath)).toThrow(/uncalibrated/);
  });
});

describe("STEP0 D4/D5 every region, non-empty", () => {
  it("a metrics list missing one precedence region fails", () => {
    const regions = dumpRegions();
    expect(regions).toHaveLength(10);
    const metrics = syntheticMetrics(regions.filter((r) => r !== "nose"));
    const verdict = evaluateFaceRegression({ metrics, thresholds: thresholdsFor(regions), expectedRegions: regions });
    expect(verdict.ok).toBe(false);
    expect(verdict.failed.join(" ")).toMatch(/nose/);
  });

  it("a region with pixels 0 fails as `empty mask`", () => {
    const regions = dumpRegions();
    const metrics = syntheticMetrics(regions);
    metrics[0]!.pixels = 0;
    const verdict = evaluateFaceRegression({ metrics, thresholds: thresholdsFor(regions), expectedRegions: regions });
    expect(verdict.ok).toBe(false);
    expect(verdict.failed.join(" ")).toMatch(/empty mask/);
  });
});

describe("STEP0 D6/D7 normal map and final albedo", () => {
  it("the normal comes from the stage-4 skin-normal byproduct, not a hardcoded name", () => {
    const resolved = resolveCaseRenderInputs({ caseId: "body2", store: "/store", runReport: fixtureReport() });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error("fixture should resolve");
    expect(resolved.inputs.normal).toBe("/store/body2/run7/body2-lidconform.skin-normal.png");
    expect(resolved.runId).toBe("run7");
    expect(resolved.inputs.recordShas.map((r) => r.path)).toContain(resolved.inputs.normal);
    const rough = resolved.inputs.recordShas.find((r) => r.path.endsWith("roughness.png"));
    expect(rough?.sha256, "roughness joins the re-hashed record set").toBe("bb".repeat(32));
  });

  it("a missing skin-normal byproduct is refused", () => {
    const resolved = resolveCaseRenderInputs({ caseId: "body2", store: "/store", runReport: fixtureReport({ noNormal: true }) });
    expect(resolved.ok).toBe(false);
  });

  it("the albedo is extra.finalAlbedo, not the first /albedo/ output", () => {
    const resolved = resolveCaseRenderInputs({ caseId: "body2", store: "/store", runReport: fixtureReport() });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error("fixture should resolve");
    expect(resolved.inputs.albedo, "albedo_detail.png wins over albedo_corners.png").toBe("/store/body2/run7/albedo_detail.png");
  });

  it("a record without extra.finalAlbedo is refused", () => {
    const resolved = resolveCaseRenderInputs({ caseId: "body2", store: "/store", runReport: fixtureReport({ noFinalAlbedo: true }) });
    expect(resolved.ok, "no final albedo means no golden-worthy input").toBe(false);
    if (resolved.ok) throw new Error("should have refused");
    expect(resolved.status).toBe("refused");
  });
});

describe("STEP0 D8 --golden is honoured", () => {
  it("a promoted version dir resolves <case>/<yaw>.png", () => {
    const dir = fxDir("golden-promoted");
    mkdirSync(join(dir, "aisha"), { recursive: true });
    writeFileSync(join(dir, "aisha", "0.png"), solidPng(8, 8, [1, 2, 3]));
    const src = resolveGoldenSource(dir);
    expect(src.kind).toBe("promoted");
    expect(goldenPngFor(src, "aisha", 0)).toBe(join(dir, "aisha", "0.png"));
  });

  it("an unpromoted render dir resolves PNGs through render.json and is marked unpromoted", () => {
    const dir = fxDir("golden-renderdir");
    mkdirSync(join(dir, "body2"), { recursive: true });
    const pngRel = join(dir, "body2", "v0.png");
    writeFileSync(pngRel, solidPng(8, 8, [4, 5, 6]));
    writeFileSync(
      join(dir, "body2", "render.json"),
      `${JSON.stringify({ caseId: "body2", views: [{ yaw: 0, png: pngRel, sha256: "x" }] })}\n`,
      "utf8",
    );
    const src = resolveGoldenSource(dir);
    expect(src.kind, "goldenPromoted: false for a render dir").toBe("render-dir");
    expect(goldenPngFor(src, "body2", 0)).toBe(pngRel);
  });
});

describe("STEP0 D9 render and golden provenance", () => {
  const recordInputs = [
    { path: "/store/a/run4/albedo_detail.png", sha256: "cc".repeat(32) },
    { path: "/store/a/run4/aisha-lidconform.skin-normal.png", sha256: "ee".repeat(32) },
  ];
  const captureFor = (inputs: Record<string, { sha256?: string }>, matched: string[] | null) => ({
    glb: { sha256: "dd".repeat(32) },
    inputs,
    skinOverrideApplied: matched === null ? null : { matchedMaterials: matched },
  });

  it("matching input shas and a non-empty material match pass", () => {
    const out = assertCaptureProvenance({
      capture: captureFor(
        { "/store/a/run4/albedo_detail.png": { sha256: "cc".repeat(32) }, "/store/a/run4/aisha-lidconform.skin-normal.png": { sha256: "ee".repeat(32) } },
        ["mpfb_skin"],
      ),
      recordInputs,
    });
    expect(out.ok).toBe(true);
  });

  it("a tool input sha that differs from the record is refused", () => {
    const out = assertCaptureProvenance({
      capture: captureFor({ "/store/a/run4/albedo_detail.png": { sha256: "ff".repeat(32) } }, ["mpfb_skin"]),
      recordInputs,
    });
    expect(out.ok).toBe(false);
    expect(String(out.refusal)).toMatch(/albedo_detail/);
  });

  it("an empty material match is refused (embedded skin rendered)", () => {
    const out = assertCaptureProvenance({
      capture: captureFor(
        { "/store/a/run4/albedo_detail.png": { sha256: "cc".repeat(32) }, "/store/a/run4/aisha-lidconform.skin-normal.png": { sha256: "ee".repeat(32) } },
        [],
      ),
      recordInputs,
    });
    expect(out.ok).toBe(false);
    expect(String(out.refusal)).toMatch(/matchedMaterials/);
  });
});

describe("STEP0 D10 run labels", () => {
  it("--label scopes outputs to runs/<card>/<label>/", () => {
    const paths = resolveRunPaths({ store: "/store", card: "tsk_x", label: "seed-a" });
    expect(paths.labelDir).toBe("/store/runs/tsk_x/seed-a");
  });

  it("the default label keeps the unlabelled layout", () => {
    const paths = resolveRunPaths({ store: "/store", card: "tsk_x" });
    expect(paths.label).toBe("check");
    expect(paths.labelDir).toBe("/store/runs/tsk_x/check");
  });

  it("a label that escapes the runs dir is refused", () => {
    expect(() => resolveRunPaths({ store: "/store", card: "tsk_x", label: "../evil" })).toThrow();
  });
});

describe("STEP0 D11 full-face row", () => {
  it("regions.py writes full.png and --perturb-seed perturbs the golden into the current", { timeout: SPAWN_TIMEOUT }, () => {
    const dir = fxDir("full");
    const w = 96;
    const h = 96;
    const golden = join(dir, "golden.png");
    writeFileSync(golden, solidPng(w, h, [200, 160, 140]));
    // Fixture landmarks: every region hull is a small disk around a centre.
    const centres: Array<[number, number]> = [[30, 40], [66, 40], [30, 30], [66, 30], [48, 60], [48, 48], [24, 56], [72, 56], [48, 24], [48, 76]];
    const table = JSON.parse(
      spawnSync("mise", ["exec", "-C", MISE_ROOT, "--", "python3", REGIONS_PY, "--dump-regions"], { encoding: "utf8", timeout: SPAWN_TIMEOUT }).stdout,
    ) as { REGION_LANDMARKS: Record<string, number[]>; PRECEDENCE: string[] };
    const lms: Array<[number, number]> = Array.from({ length: 478 }, () => [48, 48] as [number, number]);
    table.PRECEDENCE.forEach((region, ri) => {
      const c = centres[ri]!;
      table.REGION_LANDMARKS[region]!.forEach((idx, k) => {
        const ang = (k / table.REGION_LANDMARKS[region]!.length) * Math.PI * 2;
        lms[idx] = [c[0] + Math.cos(ang) * 8, c[1] + Math.sin(ang) * 8];
      });
    });
    const lmsPath = join(dir, "lms.json");
    writeFileSync(lmsPath, `${JSON.stringify(lms)}\n`, "utf8");
    const out = join(dir, "metrics.json");
    const heatDir = join(dir, "heat");
    const proc = spawnSync(
      "mise",
      ["exec", "-C", MISE_ROOT, "--", "python3", REGIONS_PY,
        "--golden", golden, "--current", golden, "--out", out, "--heatmap-dir", heatDir,
        "--golden-landmarks", lmsPath, "--current-landmarks", lmsPath,
        "--perturb-seed", "20261018", "--case", "test", "--view", "0"],
      { encoding: "utf8", timeout: SPAWN_TIMEOUT, maxBuffer: 64 * 1024 * 1024 },
    );
    expect(proc.status, `regions.py refused: ${(proc.stderr || proc.stdout || "").slice(-2000)}`).toBe(0);
    expect(existsSync(join(heatDir, "full.png")), "unmasked whole-frame heatmap written").toBe(true);
    const report = JSON.parse(readFileSync(out, "utf8")) as { metrics: RegionMetric[]; fullHeatmap: string; perturbSeed: number };
    expect(report.fullHeatmap).toBe("full.png");
    expect(report.perturbSeed).toBe(20261018);
    expect(report.metrics).toHaveLength(10);
    for (const m of report.metrics) {
      expect(m.dE, `${m.region} floor dE stays sub-threshold-scale`).toBeLessThan(2.0);
    }
  });

  it("the sheet starts with a full-frame row at native pixels", () => {
    const dir = fxDir("sheet");
    const w = 64;
    const h = 48;
    const golden = join(dir, "g.png");
    const current = join(dir, "c.png");
    const full = join(dir, "full.png");
    writeFileSync(golden, solidPng(w, h, [200, 160, 140]));
    writeFileSync(current, solidPng(w, h, [200, 160, 140]));
    writeFileSync(full, solidPng(w, h, [0, 0, 0]));
    const regionHeat = join(dir, "eye_L.png");
    writeFileSync(regionHeat, solidPng(w, h, [0, 0, 0]));
    const outPng = join(dir, "sheet.png");
    writeRegionSheet({
      goldenPng: golden, currentPng: current, outPng,
      regions: ["eye_L"],
      bounds: { eye_L: { x0: 10, y0: 10, x1: 18, y1: 18 } },
      heatmaps: { eye_L: regionHeat },
      fullHeatmap: full,
    });
    const decoded = decodePng(readFileSync(outPng));
    expect(decoded, "sheet decodes").not.toBeNull();
    // Full-frame row (h=48 + 4 gap) followed by one 8px region row (+ 4 gap).
    expect(decoded!.w).toBe(w * 3);
    expect(decoded!.h).toBe(h + 4 + 8 + 4);
  });
});
