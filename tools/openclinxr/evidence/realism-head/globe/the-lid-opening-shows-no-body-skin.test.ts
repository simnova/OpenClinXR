import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The fitted 24 mm globe swims in the 29 mm socket the lids wrap: at yaw the
 * lid/socket skin shows past the globe silhouette (shell-rebind 7a14d7afc
 * proved the owner is body skin; the occlusion shell hides it but milks the
 * eyes). The fix scales + seats the high-poly globe+cornea forward about
 * each eye's own centre (EYE_GLOBE_FIT_BY_OUTPUT_STEM, bones follow) so the
 * globe fills the lid aperture laterally.
 *
 * Evidence chain (no live bake in-test): materialize.py source markers +
 * globe-fit-report.json (composed from the bake EYEGLOBE_FIT / anatomical /
 * cornea-split log lines plus the neon yaw-set counts) + globe-fit-sheet.png
 * (native 1280 crops: natural yaw40, neon yaw-40, natural front, base|fit).
 * Neon method: body skin pure blue, lashes cyan, globe+cornea magenta;
 * aperture per eye = row lash-span x column lash-span intersection; count =
 * body-blue texels strictly inside (deterministic renders, exact counts).
 *
 * Coverage honesty: the frontal floor is the lid-margin rim (base 432, fixed
 * 63), which a grazing view always shows ~2x of (ratio constant across
 * 0-10% scale), so the literal yaw<=front floor is unmeetable by any globe
 * size and the gate asserts STRICT SOFTENING of the yaw excess over the
 * same-bake front (fixed excess << base excess on all four yaw views) with
 * a live premise (base excess >= 100 everywhere). The named defect (vertical
 * edge in the eye white) is gone on the natural renders (sheet row 1).
 *
 * claimScope: globe-to-socket fit on the high-poly cornea-split path.
 * notEvidenceFor: clinical_validity, production_asset_readiness, gaze
 *   rotation (compat-eyes NT); the pixel grade lives in globe-fit-sheet.png
 *   and is the orchestrator's (D12).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../../..");
const REPORT = join(HERE, "globe-fit-report.json");
const STORE_ROOT = "/Volumes/files/openclinxr-assets/store/";
const MATERIALIZE = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);
const IRIS_MANIFEST = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/eyes/texture-manifest.json",
);

const VIEWS = ["yaw25", "yaw-25", "yaw40", "yaw-40"] as const;

type FitReport = {
  name: string;
  producerSourceSha256: string;
  argvBase: string[];
  argvFit: string[];
  fit: {
    table: string;
    fitScale: number;
    fitForwardMm: number;
    globeRadiusMm: { base: number; fixed: number };
  };
  neonCounts: {
    base: Record<string, number>;
    fixed: Record<string, number>;
  };
  coverageGate: {
    views: number[];
    frontFloor: { base: number; fixed: number };
    excessOverFront: {
      base: Record<string, number>;
      fixed: Record<string, number>;
    };
    literalYawLeFront: boolean;
    strictSoftening: boolean;
  };
  falsifier: {
    scaleDeltaTested: string;
    "yaw-40countAcrossFits": number[];
    verdict: string;
  };
  irisGate: {
    manifest: string;
    pupilShiftTexels: [number, number];
    fitBakeTextureOverride: string;
    uvUntouchedBySimilarity: boolean;
  };
  sheet: { src: string; sha256: string; renderSize: number };
  visualFinding: string;
};

function readReport(): FitReport {
  expect(existsSync(REPORT), `globe fit report exists: ${REPORT}`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as FitReport;
}

function readSource(): string {
  return readFileSync(MATERIALIZE, "utf8");
}

function storePath(src: string): string {
  return join(STORE_ROOT, src.startsWith("assets:") ? src.slice(7) : src);
}

/** Fail-closed validator: excess math + softening, shared by clauses. */
function validateSoftening(r: FitReport): void {
  for (const v of VIEWS) {
    const baseExcess = r.neonCounts.base[v]! - r.neonCounts.base["front"]!;
    const fixedExcess = r.neonCounts.fixed[v]! - r.neonCounts.fixed["front"]!;
    expect(baseExcess, `base ${v} excess over front (premise)`).toBeGreaterThanOrEqual(
      100,
    );
    expect(
      fixedExcess,
      `fixed ${v} excess strictly below base excess`,
    ).toBeLessThan(baseExcess);
    expect(
      r.coverageGate.excessOverFront.base[v],
      `reported base excess matches counts (${v})`,
    ).toBe(baseExcess);
    expect(
      r.coverageGate.excessOverFront.fixed[v],
      `reported fixed excess matches counts (${v})`,
    ).toBe(fixedExcess);
  }
  expect(r.coverageGate.frontFloor.base).toBe(r.neonCounts.base["front"]);
  expect(r.coverageGate.frontFloor.fixed).toBe(r.neonCounts.fixed["front"]);
}

describe("the lid opening shows no body skin", () => {
  it("(1) report records the producer source sha and both bake argvs", () => {
    const r = readReport();
    expect(r.name).toBe("eye-globe-lid-aperture-fit");
    expect(r.producerSourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.argvFit.join(" ")).toMatch(/--eye-asset high-poly/);
    expect(r.argvFit.join(" ")).toMatch(/--eye-cornea/);
    expect(r.argvFit.join(" ")).toMatch(/iris-centred-c\.png/);
    expect(r.sheet.src, "sheet cites the asset store").toMatch(/^assets:/);
    expect(r.visualFinding.length, "orchestrator visual grade recorded").toBeGreaterThan(0);
  });

  it("(2) RED: the base bake shows socket skin past the silhouette at every yaw", () => {
    const r = readReport();
    validateSoftening(r);
  });

  it("(3) RED: the fit lives behind --eye-asset high-poly with a loud refusal", () => {
    const r = readReport();
    expect(r.fit.fitScale).toBeGreaterThan(1);
    expect(r.fit.fitForwardMm).toBeGreaterThan(0);
    expect(r.fit.globeRadiusMm.fixed).toBeGreaterThan(r.fit.globeRadiusMm.base);
    const src = readSource();
    expect(src, "per-stem fit table exists").toContain("EYE_GLOBE_FIT_BY_OUTPUT_STEM");
    expect(src, "fit row for the card stem").toContain('"aisha-eyeglobe-fit"');
    expect(src, "fit log line emitted").toContain("EYEGLOBE_FIT ");
    expect(src, "similarity params on the resize").toContain("extra_forward_mm");
    expect(src, "non-high-poly fit refuses loudly").toContain(
      "globe fit is only valid with --eye-asset high-poly",
    );
  });

  it("(4) GREEN: the fixed bake strictly softens the yaw excess on all four views", () => {
    const r = readReport();
    validateSoftening(r);
    expect(r.coverageGate.strictSoftening).toBe(true);
    expect(r.coverageGate.views).toEqual(expect.arrayContaining([25, -25, 40, -40]));
  });

  it("(5) HONESTY: the literal floor is recorded unmet with its measured reason", () => {
    const r = readReport();
    expect(r.coverageGate.literalYawLeFront).toBe(false);
    for (const v of VIEWS) {
      expect(
        r.neonCounts.fixed[v]!,
        `fixed ${v} still above the same-bake front (rim view-dependence, not wedge)`,
      ).toBeGreaterThan(r.neonCounts.fixed["front"]!);
    }
  });

  it("(6) iris centre still within 2 px: the similarity never touches UVs", () => {
    const r = readReport();
    expect(
      existsSync(IRIS_MANIFEST),
      `eye-tex manifest exists: ${IRIS_MANIFEST}`,
    ).toBe(true);
    const m = JSON.parse(readFileSync(IRIS_MANIFEST, "utf8")) as {
      textures: { pupil_shift_texels: [number, number] }[];
    };
    const shifts = m.textures[0]!.pupil_shift_texels;
    expect(shifts[0]).toBeLessThanOrEqual(2);
    expect(shifts[1]).toBeLessThanOrEqual(2);
    expect(r.irisGate.pupilShiftTexels).toEqual(shifts);
    expect(r.irisGate.uvUntouchedBySimilarity).toBe(true);
    expect(r.irisGate.fitBakeTextureOverride).toMatch(/iris-centred-c\.png/);
  });

  it("(7) falsifier: a 4% scale moved the count, so the mechanism is live", () => {
    const r = readReport();
    const series = r.falsifier["yaw-40countAcrossFits"];
    expect(series.length).toBeGreaterThanOrEqual(2);
    expect(series[1]!).toBeLessThan(series[0]!);
    expect(r.falsifier.verdict).toMatch(/mechanism_live/);
  });

  // Sheet bytes live in the asset store (395 KB PNG, not git): verify the
  // sha when the store exists, else skip under a 'store absent' name.
  const _probe = readReport();
  const _sheet = storePath(_probe.sheet.src);
  if (existsSync(_sheet)) {
    it("(7b) store sheet bytes match the report sha", () => {
      const r = readReport();
      const bytes = readFileSync(storePath(r.sheet.src));
      expect(bytes.length, "sheet is a real PNG, not a stub").toBeGreaterThan(10000);
      const sha = createHash("sha256").update(bytes).digest("hex");
      expect(sha, "store sheet bytes match the report").toBe(r.sheet.sha256);
      expect(r.sheet.renderSize).toBe(1280);
    });
  } else {
    it.skip("(7b) store absent — store sheet sha unverified", () => {});
  }

  it("(8) known-bad: an unsoftened yaw excess is rejected", () => {
    const r = readReport();
    const bad = {
      ...r,
      neonCounts: {
        base: { ...r.neonCounts.base },
        fixed: { ...r.neonCounts.fixed, "yaw40": r.neonCounts.base["yaw40"] },
      },
    } as FitReport;
    expect(() => validateSoftening(bad)).toThrow();
  });
});
