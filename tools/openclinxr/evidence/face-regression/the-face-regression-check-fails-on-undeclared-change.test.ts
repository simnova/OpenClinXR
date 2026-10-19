import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REGION_LANDMARKS,
  buildRegionPolygons,
  evaluateFaceRegression,
  measureRegions,
  promoteGolden,
  verifyInputShas,
  type Landmark,
} from "./src/index.js";
import { encodePngRgb } from "./src/png.js";

/**
 * Whole-face regression RED (card tsk_0e618fa5e9ac3e15 STEP 2).
 *
 * Every prior card graded only its own region in its own render path, so a
 * stale GLB's pink eyes, double brows, a dropped detail_bands pass and an
 * olive lip band each passed their own gate while the whole face regressed.
 * This contract proves the check that re-renders the station's actual face
 * output and compares it with the last accepted state.
 *
 * Synthetic fixtures only: PNGs generated in a temp dir, a fake landmark set,
 * and fake station-record files carrying their real sha256. The check that
 * must exist lives in tools/openclinxr/evidence/face-regression/src/.
 *
 * This test is RED because that module does not exist yet.
 */

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
  forehead: [120, 58],
  cheek_L: [70, 130],
  cheek_R: [170, 130],
  nose: [120, 120],
  chin: [120, 178],
};

function fakeLandmarks(): Landmark[] {
  const lms: Landmark[] = Array.from({ length: 478 }, () => [120, 120] as Landmark);
  for (const [region, idxs] of Object.entries(REGION_LANDMARKS)) {
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
  landmarks: Landmark[];
  thresholds: Record<string, { dE: number; ssimL: number }>;
};

function makeFixtures(): Fx {
  const dir = mkdtempSync(join(tmpdir(), "face-regression-red-"));
  const golden = join(dir, "golden-front.png");
  const unchanged = join(dir, "unchanged-front.png");
  const painted = join(dir, "painted-front.png");
  writeFileSync(golden, encodePngRgb(W, H, facePng()));
  writeFileSync(unchanged, encodePngRgb(W, H, facePng()));
  writeFileSync(painted, encodePngRgb(W, H, facePng(REGION_CENTRES.eye_L!)));
  const thresholds: Record<string, { dE: number; ssimL: number }> = {};
  for (const region of Object.keys(REGION_LANDMARKS)) thresholds[region] = { dE: 2.0, ssimL: 0.98 };
  return { dir, golden, unchanged, painted, landmarks: fakeLandmarks(), thresholds };
}

describe("the face-regression check fails on undeclared change", () => {
  it("(1) unchanged image vs golden passes and every region is within threshold", () => {
    const fx = makeFixtures();
    const metrics = measureRegions({
      goldenPng: fx.golden,
      currentPng: fx.unchanged,
      goldenLandmarks: fx.landmarks,
    });
    expect(Object.keys(REGION_LANDMARKS).every((r) => metrics.some((m) => m.region === r)), "every region measured").toBe(true);
    const verdict = evaluateFaceRegression({ metrics, thresholds: fx.thresholds });
    expect(verdict.failed, "unchanged render fails nothing").toEqual([]);
    expect(verdict.ok).toBe(true);
    for (const r of verdict.regions) {
      expect(r.dE, `${r.region} dE on an identical render`).toBeLessThanOrEqual(fx.thresholds[r.region]!.dE);
    }
  });

  it("(2) a change painted into eye_L but undeclared FAILS and names eye_L", () => {
    const fx = makeFixtures();
    const metrics = measureRegions({
      goldenPng: fx.golden,
      currentPng: fx.painted,
      goldenLandmarks: fx.landmarks,
    });
    const verdict = evaluateFaceRegression({ metrics, thresholds: fx.thresholds });
    expect(verdict.ok, "an undeclared regional change is a failure").toBe(false);
    expect(verdict.failed, "the failing region is named").toContain("eye_L");
  });

  it("(3) the same eye_L change with declare eye_L passes", () => {
    const fx = makeFixtures();
    const metrics = measureRegions({
      goldenPng: fx.golden,
      currentPng: fx.painted,
      goldenLandmarks: fx.landmarks,
    });
    const verdict = evaluateFaceRegression({ metrics, thresholds: fx.thresholds, declared: ["eye_L"] });
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
    const fx = makeFixtures();
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
});

describe("fixture sanity", () => {
  it("the region table covers the ten named face regions with real landmark indices", () => {
    expect(Object.keys(REGION_LANDMARKS).sort()).toEqual([
      "brow_L", "brow_R", "cheek_L", "cheek_R", "chin",
      "eye_L", "eye_R", "forehead", "lips", "nose",
    ]);
    const polys = buildRegionPolygons(fakeLandmarks());
    for (const region of Object.keys(REGION_LANDMARKS)) {
      expect(polys[region]!.length, `${region} polygon points`).toBeGreaterThanOrEqual(3);
    }
  });

  it("the temp fixture dir is outside the worktree", () => {
    const fx = makeFixtures();
    expect(existsSync(fx.dir)).toBe(true);
    expect(fx.dir.startsWith(tmpdir())).toBe(true);
  });
});
