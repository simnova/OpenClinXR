import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The corner is derived from the lid loop (tsk_c259331546dd74df).
 *
 * The fill mesh (caruncle-side medial hems + lateral notch tents over a
 * full-funnel curtain) is built from the resampled lid-margin vertex loop
 * of the morphed mesh — no hand-modelled geometry, no .mhclo — skinned
 * 100% to the head bone with the six lid keys transferred lash-A3-style.
 * Material is wet pinkish conjunctiva, not skin.
 *
 * The test verifies the report: derivation record, lid-key bind, pink
 * material, and every gate number recomputed from the embedded counts
 * (G2 both instruments, CW1, CW2 union, CW3, G1 tissue consistency plus
 * outer-corner no-regression). G1-literal (grazing outer corner >=
 * frontal white) is recorded NOT_MET with mechanism in the report; the
 * assertions below pin the parts that hold so a regression fails loudly.
 *
 * claimScope: derive-report.json numbers + store bytes (GLB + sheet PNGs).
 * notEvidenceFor: clinical_validity, production_asset_readiness; pixel
 *   grade lives in store/eye-corner/. Never opens the gitignored GLB
 *   except through the store path with sha256 check.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../../..");
const REPORT = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eye-corner/derive-report.json",
);
const DERIVE_TOOL = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eye-corner/derive_eye_corner.py",
);
const MEASURE_TOOL = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eye-corner/measure_eye_corner.py",
);
const SHEET_TOOL = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eye-corner/eye-corner-sheet.ts",
);
const G1_TOOL = join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/eye-corner/g1_canthus.py",
);
const BAKE_CALL_SITE = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);
const STORE_ROOT = "/Volumes/files/openclinxr-assets/store";
const storeExists = existsSync(STORE_ROOT);

const VIEWS5 = ["front", "yaw25", "yaw-25", "yaw40", "yaw-40"] as const;
const YAW40 = ["yaw40", "yaw-40"] as const;

function report(): Record<string, unknown> {
  return JSON.parse(readFileSync(REPORT, "utf8")) as Record<string, unknown>;
}

describe("the corner is derived from the lid loop", () => {
  it("(1) report exists with the derivation record and no hand geometry", () => {
    expect(existsSync(REPORT), REPORT).toBe(true);
    const r = report();
    expect(r.schemaVersion).toBe("openclinxr.eye-corner-derive-report.v1");
    expect(r.mesh).toBe("openclinxr_eye_corner_fill_mesh");
    expect(r.handAuthored).toBe(false);
    expect(r.mhcloPath).toBeNull();
    const loop = r.lidLoop as Record<string, { L: number; R: number }>;
    expect((r.lidLoop as { loopBandVerts: { L: number; R: number } }).loopBandVerts.L).toBeGreaterThan(0);
    expect((r.lidLoop as { loopBandVerts: { L: number; R: number } }).loopBandVerts.R).toBeGreaterThan(0);
    expect(loop).toBeTruthy();
    const spheres = (r.lidLoop as {
      spheres: { L: { radiusMm: number }; R: { radiusMm: number } };
    }).spheres;
    for (const s of ["L", "R"] as const) {
      expect(spheres[s].radiusMm).toBeGreaterThan(10);
      expect(spheres[s].radiusMm).toBeLessThan(14);
    }
    expect(r.deriveTool).toBe(
      "tools/openclinxr/asset-pipeline/makeclothes/eye-corner/derive_eye_corner.py",
    );
    for (const f of [DERIVE_TOOL, MEASURE_TOOL, SHEET_TOOL, G1_TOOL]) {
      expect(existsSync(f), f).toBe(true);
    }
  });

  it("(2) fill inherits the six lid keys on a head bind", () => {
    const r = report();
    const keys = r.lidKeys as {
      keys: string[];
      donorPool: { L: { moving: number }; R: { moving: number } };
      lidKeyMaxDeltaMm: Record<string, number>;
      bind: string;
    };
    expect(keys.keys).toEqual([
      "eye-left-closure",
      "eye-left-slit",
      "eye-left-opened-up",
      "eye-right-closure",
      "eye-right-slit",
      "eye-right-opened-up",
    ]);
    expect(keys.donorPool.L.moving).toBeGreaterThanOrEqual(100);
    expect(keys.donorPool.R.moving).toBeGreaterThanOrEqual(100);
    expect(keys.lidKeyMaxDeltaMm["eye-left-closure"]).toBeGreaterThan(1.0);
    expect(keys.lidKeyMaxDeltaMm["eye-right-closure"]).toBeGreaterThan(1.0);
    expect(keys.bind).toMatch(/head/);
  });

  it("(3) material is wet pinkish conjunctiva, not skin", () => {
    const r = report();
    const mat = r.material as {
      name: string;
      baseColorFactor: number[];
      roughnessFactor: number;
    };
    expect(mat.name).toBe("openclinxr_eye_corner_fill_mat");
    expect(mat.name).not.toMatch(/skin/i);
    expect(mat.baseColorFactor).toEqual([0.82, 0.5, 0.5, 1.0]);
    expect(mat.roughnessFactor).toBe(0.35);
  });

  it("(4) G2: neon aperture edge below base in all 10 eye-views", () => {
    const r = report();
    const g2 = r.G2 as {
      base: Record<string, Record<string, number>>;
      fill: Record<string, Record<string, number>>;
      verdict: string;
    };
    expect(g2.verdict).toBe("PASS");
    for (const v of VIEWS5) {
      for (const s of ["L", "R"] as const) {
        expect(
          g2.fill[v][s],
          `G2 ${v} ${s}: fill ${g2.fill[v][s]} < base ${g2.base[v][s]}`,
        ).toBeLessThan(g2.base[v][s]);
      }
    }
    const geo = (r.G2 as {
      geometricCrossCheck: {
        base: Record<string, number>;
        fill: Record<string, number>;
        verdict: string;
      };
    }).geometricCrossCheck;
    expect(geo.verdict).toBe("PASS");
    for (const v of VIEWS5) {
      expect(geo.fill[v], `geometric G2 ${v}`).toBeLessThan(geo.base[v]);
    }
  });

  it("(5) CW1: globe inside the opening >= 0.95x base per view", () => {
    const r = report();
    const cw1 = r.CW1 as {
      base: Record<string, number>;
      fill: Record<string, { count: number; ratio: number }>;
      verdict: string;
    };
    expect(cw1.verdict).toBe("PASS");
    for (const v of VIEWS5) {
      const recomputed = cw1.fill[v].count / cw1.base[v];
      expect(Math.abs(recomputed - cw1.fill[v].ratio)).toBeLessThan(0.0001);
      expect(cw1.fill[v].ratio, `CW1 ${v}`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("(6) CW2: no fill outside the closed lid line (union 0)", () => {
    const r = report();
    const cw2 = r.CW2 as { unionOutside: number; verdict: string };
    expect(cw2.verdict).toBe("PASS");
    expect(cw2.unionOutside).toBe(0);
  });

  it("(7) CW3: fill never anterior of the visible surface", () => {
    const r = report();
    const cw3 = r.CW3 as { cw3maxMm: number; verdict: string };
    expect(cw3.verdict).toBe("PASS");
    expect(cw3.cw3maxMm).toBeLessThanOrEqual(0);
  });

  it("(8) G1: added tissue presents at yaw; outer corners do not regress", () => {
    const r = report();
    const g1 = r.G1 as {
      fillFrontal: Record<string, Record<string, number>>;
      tissueConsistency: {
        fill: Record<string, { visiblePx: number; brightFrac: number }>;
        verdict: string;
      };
      baseOuterYawForReference: Record<string, Record<string, number>>;
      fillYaw: Record<string, Record<string, { inner: number; outer: number }>>;
      verdict: string;
    };
    expect(g1.verdict).toBe("NOT_MET");
    const tc = g1.tissueConsistency;
    expect(tc.verdict).toBe("PASS");
    for (const v of YAW40) {
      expect(tc.fill[v].visiblePx, `tissue visible ${v}`).toBeGreaterThanOrEqual(25);
      expect(tc.fill[v].brightFrac, `tissue bright ${v}`).toBeGreaterThanOrEqual(0.5);
      expect(
        tc.fill[v].brightFrac,
        `tissue ${v} >= frontal ${tc.fill.front.brightFrac}`,
      ).toBeGreaterThanOrEqual(tc.fill.front.brightFrac);
    }
    for (const v of YAW40) {
      for (const s of ["L", "R"] as const) {
        expect(
          g1.fillYaw[v][s].outer,
          `outer no-regression ${v} ${s}`,
        ).toBeGreaterThanOrEqual(g1.baseOuterYawForReference[v][s]);
      }
    }
  });

  it("(9) bake call site documented; factory owns the transfer already", () => {
    const r = report();
    const cs = r.bakeCallSite as { file: string };
    expect(cs.file).toContain("materialize_mpfb_humanoid_candidate.py");
    expect(existsSync(BAKE_CALL_SITE), BAKE_CALL_SITE).toBe(true);
    const src = readFileSync(BAKE_CALL_SITE, "utf8");
    expect(src).toContain("_eyshell_transfer_lid_keys");
  });

  it.skipIf(!storeExists)(
    storeExists
      ? "(10) store bytes match the report sha256"
      : "(10) store bytes check [store absent]",
    () => {
      const r = report();
      const fill = r.fill as { storePath: string; sha256: string };
      expect(existsSync(fill.storePath), fill.storePath).toBe(true);
      const bytes = readFileSync(fill.storePath);
      expect(bytes.length).toBeGreaterThan(150 * 1024);
      const sha = createHash("sha256").update(bytes).digest("hex");
      expect(sha, "fill GLB bytes match report").toBe(fill.sha256);
      expect(bytes.subarray(0, 4).toString()).toBe("glTF");
    },
  );
});
