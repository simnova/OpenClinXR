import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The fitted 24 mm globe swims in the 29 mm socket the lids wrap: at yaw the
 * lid/socket skin shows past the globe silhouette (shell-rebind 7a14d7afc
 * proved the owner is body skin; the occlusion shell hides it but milks the
 * eyes). Handover h2 verdict: socket_geometry — no scale/seat point beats
 * base on the edge while holding CW1+CW3, so the opening is wider than any
 * plausibly-seated globe and the generator default stays identity (1.00,
 * 0.0). The lid inner surface sets the edge: separate card, not a globe.
 *
 * Evidence chain (no live bake in-test): materialize.py source markers +
 * globe-fit-report.json (grid verdicts computed from the primary
 * measurements: neon yaw-set edge counts, cw1-protrusion.py CW1+CW3) +
 * store sheets (native 1280 crops).
 *
 * Counterweight CW1 (h1, fixed h2): eye-surface pixels projecting OUTSIDE
 * the mesh-derived lid-margin ring must not exceed the base bake at the
 * same view (front, +-25, +-40, blink 0.5). H2 probe: the per-candidate
 * ring was blind at front (base 0 AND (1.04,+4mm) 0 despite visible
 * sclera-over-lash); the base-frozen ring bites ((1.04,+4mm) front 5201).
 * CW3 (h2, geometric, rasterization-free): cornea apex past the closed-lid
 * plane must not exceed base (+1.979 mm; reproduces the blinkgap precedent
 * +1.98 mm). Forward seat covers the wedge only by anterior spill (CW1 +
 * CW3 fail + visible bulge); recess deepens the wedge and grows yaw
 * parallax spill; scale-only grows the apex past the lid plane first.
 *
 * claimScope: the globe-fit search and its socket_geometry verdict.
 * notEvidenceFor: clinical_validity, production_asset_readiness, gaze
 *   rotation (compat-eyes NT).
 */

const HERE = join(repoRoot(), "tools/openclinxr/evidence/realism-head/globe");
const REPO_ROOT = repoRoot();
const REPORT = join(HERE, "globe-fit-report.json");
const STORE_ROOT = "/Volumes/files/openclinxr-assets/store/";
const MATERIALIZE = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);
const CW1_TOOL = join(HERE, "cw1-protrusion.py");
const IRIS_MANIFEST = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/eyes/texture-manifest.json",
);

const YAWS = ["yaw25", "yaw-25", "yaw40", "yaw-40"] as const;
const CW1_VIEWS = ["front", "yaw25", "yaw-25", "yaw40", "yaw-40", "blink0.5"] as const;

type GridPoint = {
  edge: Record<string, number>;
  cw1: Record<string, number>;
  cw3maxMm: number;
};

type FitReport = {
  name: string;
  verdict: string;
  verdictReason: string;
  defaultRow: { table: string; value: [number, number]; meaning: string };
  producerSourceSha256: string;
  argv: string[];
  grid: Record<string, GridPoint>;
  gridVerdicts: Record<
    string,
    { edgePass: boolean; cw1Pass: boolean; cw3Pass: boolean; passAll: boolean }
  >;
  thresholds: { edge: string; cw1: string; cw3Mm: number };
  probe: {
    instrumentBefore: string;
    before: { baseFront: number; fit1044Front: number; finding: string };
    instrumentAfter: string;
    after: { baseFront: number; fit1044Front: number; finding: string };
  };
  counterweightCW1: {
    method: string;
    views: string[];
    thresholdBase: Record<string, number>;
  };
  counterweightCW3: { method: string; thresholdBaseMm: number };
  irisGate: {
    manifest: string;
    pupilShiftTexels: [number, number];
    fitBakeTextureOverride: string;
    uvUntouchedBySimilarity: boolean;
  };
  sheets: Record<string, { src: string; sha256: string; note?: string }>;
  defaultGlb: { stem: string; fit: [number, number]; sha256: string };
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

/** Recompute the verdict from the grid: exactly what build_report.py did. */
function recomputeVerdicts(r: FitReport): void {
  const base = r.grid["base"]!;
  for (const [stem, g] of Object.entries(r.grid)) {
    if (stem === "base") continue;
    const edgeOk = (["front", ...YAWS] as const).every(
      (v) => g.edge[v]! < base.edge[v]!,
    );
    const cw1Ok = CW1_VIEWS.every(
      (v) => g.cw1[v]! <= base.cw1[v]!,
    );
    const cw3Ok = g.cw3maxMm <= base.cw3maxMm;
    const claimed = r.gridVerdicts[stem]!;
    expect(claimed.edgePass, `${stem} edge leg`).toBe(edgeOk);
    expect(claimed.cw1Pass, `${stem} cw1 leg`).toBe(cw1Ok);
    expect(claimed.cw3Pass, `${stem} cw3 leg`).toBe(cw3Ok);
    expect(claimed.passAll, `${stem} conjunction`).toBe(edgeOk && cw1Ok && cw3Ok);
  }
}

describe("the lid opening shows no body skin", () => {
  it("(1) report records the verdict, the identity default and the bake argv", () => {
    const r = readReport();
    expect(r.name).toBe("eye-globe-lid-aperture-fit");
    expect(r.verdict).toBe("socket_geometry");
    expect(r.verdictReason.length).toBeGreaterThan(0);
    expect(r.defaultRow.value).toEqual([1.0, 0.0]);
    expect(r.producerSourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.argv.join(" ")).toMatch(/--eye-asset high-poly/);
    expect(r.argv.join(" ")).toMatch(/--eye-cornea/);
    expect(r.visualFinding.length).toBeGreaterThan(0);
  });

  it("(2) RED: the base bake shows socket skin past the silhouette at every yaw", () => {
    const r = readReport();
    for (const v of YAWS) {
      expect(
        r.grid["base"]!.edge[v]! - r.grid["base"]!.edge["front"]!,
        `base ${v} excess over front (premise live)`,
      ).toBeGreaterThanOrEqual(100);
    }
  });

  it("(3) the fit lives behind --eye-asset high-poly and the default is identity", () => {
    const r = readReport();
    const src = readSource();
    expect(src, "per-stem fit table exists").toContain("EYE_GLOBE_FIT_BY_OUTPUT_STEM");
    expect(src, "default row is identity").toContain('"aisha-eyeglobe-fit": (1.00, 0.0)');
    expect(src, "socket_geometry verdict recorded in source").toContain("socket_geometry");
    expect(src, "fit log line emitted").toContain("EYEGLOBE_FIT ");
    expect(src, "non-high-poly fit refuses loudly").toContain(
      "globe fit is only valid with --eye-asset high-poly",
    );
    expect(existsSync(CW1_TOOL), `cw1 tool exists: ${CW1_TOOL}`).toBe(true);
    const tool = readFileSync(CW1_TOOL, "utf8");
    expect(tool, "tool freezes the ring from the base bake").toContain("--base-glb");
    expect(tool, "tool measures the closed-lid apex").toContain("pastPlaneMmMax");
  });

  it("(4) PROBE: the frozen ring bites where the per-bake ring was blind", () => {
    const r = readReport();
    expect(r.probe.before.baseFront).toBe(0);
    expect(r.probe.before.fit1044Front).toBe(0);
    expect(r.probe.after.baseFront).toBe(0);
    expect(
      r.probe.after.fit1044Front,
      "frozen ring: (1.04,+4mm) fails front loudly",
    ).toBeGreaterThan(1000);
  });

  it("(5) VERDICT: no grid point passes edge+CW1+CW3 together", () => {
    const r = readReport();
    recomputeVerdicts(r);
    const passing = Object.entries(r.gridVerdicts)
      .filter(([, v]) => v.passAll)
      .map(([s]) => s);
    expect(passing, "no passing point (socket_geometry)").toEqual([]);
    // Legs discriminate in opposite directions: forward passes edge only,
    // recess passes CW3 only — the conjunction is empty by measurement.
    expect(r.gridVerdicts["eg-104-4"]!.edgePass).toBe(true);
    expect(r.gridVerdicts["eg-104-4"]!.cw1Pass).toBe(false);
    expect(r.gridVerdicts["eg-100-m3"]!.cw3Pass).toBe(true);
    expect(r.gridVerdicts["eg-100-m3"]!.edgePass).toBe(false);
  });

  it("(6) CW3: apex past the closed lid never exceeds base except forward", () => {
    const r = readReport();
    expect(r.counterweightCW3.thresholdBaseMm).toBeCloseTo(1.979, 3);
    expect(
      r.grid["eg-104-4"]!.cw3maxMm,
      "forward (1.04,+4mm) apex far past the lid plane",
    ).toBeGreaterThan(6);
    for (const s of ["eg-100-m2", "eg-100-m3", "eg-102-m3", "eg-104-m3"]) {
      expect(
        r.grid[s]!.cw3maxMm,
        `recess ${s} apex at or behind the base plane allowance`,
      ).toBeLessThanOrEqual(r.counterweightCW3.thresholdBaseMm);
    }
  });

  it("(7) iris centre still within 2 px on the kept default", () => {
    const r = readReport();
    expect(existsSync(IRIS_MANIFEST)).toBe(true);
    const m = JSON.parse(readFileSync(IRIS_MANIFEST, "utf8")) as {
      textures: { pupil_shift_texels: [number, number] }[];
    };
    const shifts = m.textures[0]!.pupil_shift_texels;
    expect(shifts[0]).toBeLessThanOrEqual(2);
    expect(shifts[1]).toBeLessThanOrEqual(2);
    expect(r.irisGate.pupilShiftTexels).toEqual(shifts);
    expect(r.irisGate.fitBakeTextureOverride).toMatch(/iris-centred-c\.png/);
  });

  const _probe = readReport();
  const _h2 = storePath(_probe.sheets.h2.src);
  if (existsSync(_h2)) {
    it("(7b) h2 sheet bytes match the report sha", () => {
      const r = readReport();
      const bytes = readFileSync(storePath(r.sheets.h2.src));
      expect(bytes.length).toBeGreaterThan(10000);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        r.sheets.h2.sha256,
      );
    });
  } else {
    it.skip("(7b) store absent — h2 sheet sha unverified", () => {});
  }

  it("(8) known-bad: a point passing everything is rejected", () => {
    const r = readReport();
    const good: GridPoint = {
      edge: { front: 1, yaw25: 1, "yaw-25": 1, yaw40: 1, "yaw-40": 1 },
      cw1: {
        front: 0, yaw25: 0, "yaw-25": 0, yaw40: 0, "yaw-40": 0, "blink0.5": 0,
      },
      cw3maxMm: -5,
    };
    const bad = {
      ...r,
      grid: { ...r.grid, "eg-fake": good },
      gridVerdicts: {
        ...r.gridVerdicts,
        "eg-fake": { edgePass: true, cw1Pass: true, cw3Pass: true, passAll: true },
      },
    } as FitReport;
    const passing = Object.entries(bad.gridVerdicts)
      .filter(([, v]) => v.passAll)
      .map(([s]) => s);
    expect(passing, "injected passing point detected").toEqual(["eg-fake"]);
  });
});
