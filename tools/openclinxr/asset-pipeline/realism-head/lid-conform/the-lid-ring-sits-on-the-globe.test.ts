import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The lid margin loop floats on a recessed larger sphere than the globe
 * (lidcurve: lid centre 6.9 mm behind the globe centre, centre-third lid
 * verts up to 1.30 mm INSIDE the 24 mm globe, corners up to +2.7 mm
 * outside) while the socket wall stands past the globe silhouette at yaw
 * (eyeglobe grid: socket_geometry -- no globe scale/seat fixes it). This
 * card seats the margin ring on the globe mesh (+0.5 mm tear film) and
 * reports what seating does and does not fix.
 *
 * Evidence chain (no live bake in-test): lid_conform.py Blender pass +
 * materialize call-site markers + conform-report.json (gate primaries
 * from measure_conform.py on the baked bytes: G1 mesh-gap, C1 globe
 * POSITION identity, C2 fissure, C3 flips, G2 neon aperture, G3
 * cw1-protrusion frozen-ring, G4 closed-1.0 geometry + darkDef) + store
 * sheets (1280 renders + native eye zooms).
 *
 * Measured outcome (recorded, not wished): the rim seats (G1), the globe
 * is untouched (C1), no faces flip (C3), blink seals (G4); the yaw wall
 * wedge is unchanged (G2 ties at yaw, +5 px rim floor at front), the
 * reshaped aperture exposes sub-percent more globe at yaw (G3), and
 * seating entails a narrower/taller fissure (C2) -- G1 and C2-width
 * cannot both hold on this anatomy, recorded in the report verdict.
 *
 * claimScope: the lid-ring seating and its measured gates.
 * notEvidenceFor: clinical_validity, production_asset_readiness, gaze
 *   rotation (compat-eyes NT).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../../..");
const REPORT = join(HERE, "conform-report.json");
const STORE_ROOT = "/Volumes/files/openclinxr-assets/store/";
const MATERIALIZE = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);
const LID_CONFORM = join(HERE, "lid_conform.py");
const LID_CORE = join(HERE, "lid_conform_core.py");

type Gate = { pass: boolean | null };
type Report = {
  name: string;
  card: string;
  verdict: string;
  bake: {
    argv: string;
    lidconformRecord: {
      offsetMm: number;
      weights: number[];
      ringSource: string;
      displacedVerts: number;
      perSide: Record<
        string,
        {
          baseRing1: number;
          matchedRing1: number;
          matchMedMm: number;
          matchMaxMm: number;
          movedVerts: number;
        }
      >;
    };
    baseGlb: { path: string; sha256: string };
    newGlb: { path: string; sha256: string };
  };
  gates: {
    g1: { gapsMm: Record<string, { n: number; min: number; med: number; max: number }>; pass: boolean };
    g2: { edgePx: Record<string, { base: number; new: number }>; pass: boolean };
    g3: {
      cw1Base: { cw1: Record<string, number>; cw3maxMm: number };
      cw1New: { cw1: Record<string, number>; cw3maxMm: number };
      pass: boolean;
      resMm: number;
    };
    g4: {
      closed10FrontGlobePx: number;
      geometricPass: boolean;
      darkBase: { darkPx: number };
      darkNew: { darkPx: number };
      darkPass: boolean;
      pass: boolean;
    };
  };
  counterweights: {
    c1: { positionSha256: Record<string, Record<string, string>>; pass: boolean };
    c2: {
      fissureMm: Record<string, Record<string, { widthMm: number; heightMm: number }>>;
      within1mmOfBase: boolean;
      withinAnatomicalRange: boolean;
    };
    c3: { flips: number; bandFaces: number; pass: boolean };
  };
  falsifier: { triggered: boolean; note: string };
  sheets: Record<string, { sha256: string; bytes: number }>;
};

function readReport(): Report {
  expect(existsSync(REPORT), `conform report exists: ${REPORT}`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

function storePath(src: string): string {
  return join(STORE_ROOT, src.startsWith("assets:") ? src.slice(7) : src);
}

/** Recompute the G1 verdict from the gap table: what measure_conform did. */
function recomputeG1(r: Report): boolean {
  for (const t of ["L", "R"]) {
    const g = r.gates.g1.gapsMm[`${t}.ring1`]!;
    for (const k of ["min", "med", "max"] as const) {
      if (!(g[k] >= 0.3 && g[k] <= 1.0)) return false;
    }
  }
  return true;
}

describe("the lid ring sits on the globe", () => {
  it("(1) report records the card, the verdict and the bake argv", () => {
    const r = readReport();
    expect(r.name).toBe("lid-ring-conform");
    expect(r.card).toBe("tsk_83147b9cfdf9ab03");
    expect(r.verdict.length).toBeGreaterThan(0);
    expect(r.bake.argv).toMatch(/--eye-asset high-poly/);
    expect(r.bake.argv).toMatch(/--eye-cornea/);
    expect(r.bake.lidconformRecord.offsetMm).toBe(0.5);
    expect(r.bake.lidconformRecord.weights).toEqual([1.0, 0.0]);
    expect(r.bake.lidconformRecord.ringSource).toBe("base-glb-topological");
    expect(r.bake.lidconformRecord.displacedVerts).toBe(112);
    for (const s of ["L", "R"]) {
      const p = r.bake.lidconformRecord.perSide[s]!;
      expect(p.baseRing1).toBe(56);
      expect(p.matchedRing1).toBe(56);
      expect(p.matchMaxMm).toBeLessThan(0.5);
      expect(p.movedVerts).toBe(56);
    }
  });

  it("(2) RED: the base bake shows the lid/globe mismatch at every gate", () => {
    const r = readReport();
    // Base yaw wedge over the front floor (the socket defect is live).
    const e = r.gates.g2.edgePx;
    for (const v of ["yaw25", "yaw-25", "yaw40", "yaw-40"]) {
      expect(e[v]!.base - e["front"]!.base, `base ${v} excess`).toBeGreaterThanOrEqual(100);
    }
    // Base CW1 reproduces the published eyeglobe grid exactly.
    expect(r.gates.g3.cw1Base.cw1).toMatchObject({
      front: 0, yaw25: 914, "yaw-25": 912, yaw40: 2958, "yaw-40": 2963, "blink0.5": 386,
    });
    expect(r.gates.g3.cw1Base.cw3maxMm).toBeCloseTo(1.878, 2);
  });

  it("(3) the conform lives at the materialize call site behind the new stem", () => {
    const src = readFileSync(MATERIALIZE, "utf8");
    expect(src, "stem row for the bake").toContain('"aisha-lidconform": 24.0');
    expect(src, "lower row for the bake").toContain('"aisha-lidconform": FEMALE_COVERING_LOWER');
    expect(src, "conform hook").toContain("LIDCONFORM_BAKED ");
    expect(src, "conform table").toContain("LID_CONFORM_BY_OUTPUT_STEM");
    const mod = readFileSync(LID_CONFORM, "utf8");
    expect(mod, "topological derivation").toContain("derive_eye_rings");
    expect(mod, "fail-closed transfer").toContain("MATCH_REFUSE_MM");
    expect(mod, "shape-key carry").toContain("keyBlocksCarried");
    const core = readFileSync(LID_CORE, "utf8");
    expect(core, "boundary loops").toContain("def boundary_loops");
    expect(core, "mesh gaps not sphere").toContain("def signed_gap_to_mesh");
  });

  it("(4) G1: every ring1 vertex gap is within [0.3, 1.0] mm", () => {
    const r = readReport();
    expect(recomputeG1(r), "recomputed G1").toBe(true);
    expect(r.gates.g1.pass).toBe(true);
    for (const t of ["L", "R"]) {
      expect(r.gates.g1.gapsMm[`${t}.ring1`]).toMatchObject({ n: 56, min: 0.5, med: 0.5, max: 0.5 });
    }
    expect(r.gates.g1.gapsMm["L.ring2"]!.n).toBe(56);
  });

  it("(5) C1: globe vertex positions are byte-identical to base", () => {
    const r = readReport();
    expect(r.counterweights.c1.pass).toBe(true);
    for (const [, v] of Object.entries(r.counterweights.c1.positionSha256)) {
      expect(v["base"]).toMatch(/^[0-9a-f]{64}$/);
      expect(v["new"]).toBe(v["base"]);
    }
  });

  it("(6) C3: no face normal flips in the lid band", () => {
    const r = readReport();
    expect(r.counterweights.c3.flips).toBe(0);
    expect(r.counterweights.c3.bandFaces).toBeGreaterThan(0);
    expect(r.counterweights.c3.pass).toBe(true);
    expect(r.falsifier.triggered).toBe(false);
  });

  it("(7) G4: full closure shows 0 globe px and no new dark gap", () => {
    const r = readReport();
    expect(r.gates.g4.closed10FrontGlobePx).toBe(0);
    expect(r.gates.g4.geometricPass).toBe(true);
    expect(r.gates.g4.darkNew.darkPx).toBeLessThanOrEqual(r.gates.g4.darkBase.darkPx);
    expect(r.gates.g4.pass).toBe(true);
  });

  it("(8) RECORDED: G2/G3/C2 keep their measured values and the conflict rationale", () => {
    const r = readReport();
    // G2: yaw ties (wall wedge untouched), front +5 rim floor.
    expect(r.gates.g2.edgePx["yaw25"]).toMatchObject({ base: 379, new: 379 });
    expect(r.gates.g2.edgePx["yaw-25"]).toMatchObject({ base: 446, new: 446 });
    expect(r.gates.g2.edgePx["front"]!.new).toBeGreaterThan(r.gates.g2.edgePx["front"]!.base);
    expect(r.gates.g2.pass).toBe(false);
    // G3: sub-percent yaw increase through the narrower ring, front holds.
    expect(r.gates.g3.cw1New.cw1["front"]).toBe(0);
    expect(r.gates.g3.cw1New.cw1["yaw40"]).toBeGreaterThan(r.gates.g3.cw1Base.cw1["yaw40"]);
    expect(r.gates.g3.cw1New.cw1["yaw40"] - r.gates.g3.cw1Base.cw1["yaw40"]).toBeLessThanOrEqual(20);
    expect(r.gates.g3.pass).toBe(false);
    // C2: seating entails narrower/taller; the report says why.
    const c2 = r.counterweights.c2;
    expect(c2.within1mmOfBase).toBe(false);
    expect(c2.fissureMm["L"]!.base.widthMm).toBeCloseTo(23.96, 1);
    expect(c2.fissureMm["L"]!.new.widthMm).toBeLessThan(c2.fissureMm["L"]!.base.widthMm - 1.0);
    expect(r.verdict).toMatch(/cannot both/);
  });

  it("(9) sheets exist in the store with the report shas", () => {
    const r = readReport();
    const names = Object.keys(r.sheets);
    expect(names.length).toBeGreaterThan(20);
    for (const key of [
      "natural/natural-base-front-full.png",
      "natural/natural-new-front-full.png",
      "natural/natural-base-blink-full.png",
      "natural/natural-new-blink-full.png",
      "natural/natural-base-front-eyeL-full.png",
      "natural/natural-new-front-eyeR-full.png",
      "neon/neon-base-front-full.png",
      "neon/neon-new-front-full.png",
    ]) {
      const p = storePath(`assets:lid-conform/${key}`);
      expect(existsSync(p), `sheet exists: ${key}`).toBe(true);
      const bytes = readFileSync(p);
      expect(bytes.length).toBeGreaterThan(10000);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(r.sheets[key]!.sha256);
    }
  });

  it("(10) known-bad: a gap outside [0.3, 1.0] fails the recompute", () => {
    const r = readReport();
    const bad = {
      ...r,
      gates: {
        ...r.gates,
        g1: {
          ...r.gates.g1,
          gapsMm: {
            ...r.gates.g1.gapsMm,
            "L.ring1": { n: 56, min: 0.5, med: 0.5, max: 2.0 },
          },
        },
      },
    } as Report;
    expect(recomputeG1(bad), "injected gap failure detected").toBe(false);
  });
});
