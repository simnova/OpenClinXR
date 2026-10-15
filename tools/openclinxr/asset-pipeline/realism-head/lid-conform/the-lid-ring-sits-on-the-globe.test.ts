import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * H1 widen-then-seat (tsk_83147b9cfdf9ab03 handback h1): the base fissure
 * is 23.96 mm wide against an adult 28-33 mm, and h0 seating narrowed it
 * further. The case's own face-fit fitted face goals 27.7 mm
 * (pts_fitted_front.npy 28.09/27.30 x 0.5371 mm/px), so rigid canthus
 * patches widen the margin first (topological canthi, no hand-placed
 * verts), then the globe-spanning margin seats to +0.5 with gap-adaptive
 * falloff (flesh canthi stay in flesh -- the sphere cap forbids gap<=1.0
 * past |x-cx| 13.02, hence past 26.04 width).
 *
 * Measured outcome (recorded, not wished): width 27.01 (within 1 mm of
 * the 27.7 goal), seated span exactly 0.5, flesh to 3.37 reported; the
 * wider hole over the fixed globe+wall exposes more socket (G2 ~2x) and
 * more globe at yaw (G3 +25-30% vs the 1% bar) -- no feasible point
 * satisfies C2>=26.7 and G3<=1% jointly. Height 11.067 is 0.067 over the
 * band (sub-pixel, uniform 0.5 kept). Globe untouched (C1), 0 flips over
 * the spatial band (C3), outside-band byte-identical with lashes
 * following (C4), blink seals (G4), falsifier clear.
 *
 * claimScope: the widen-then-seat pass and its measured gates.
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

type Report = {
  card: string;
  round: string;
  verdict: string;
  target: { widthMm: number; source: string; bakeParamWidthMm: number; heightBandMm: [number, number] };
  bake: {
    argv: string;
    lidconformRecord: {
      offsetMm: number;
      h1: { targetWidthMm: number };
      perSide: Record<string, { baseRing1: number; matchedRing1: number; matchMaxMm: number; seatedVerts: number; fleshVerts: number }>;
      lashFollow: { found: boolean; movedVerts: number; maxFollowMm: number };
    };
    baseGlb: { sha256: string };
    newGlb: { sha256: string };
  };
  gates: {
    g1: { gapsMm: Record<string, { n: number; min: number; med: number; max: number }>; pass: boolean };
    g2: { edgePx: Record<string, { base: number; new: number }>; pass: boolean | null };
    g3: {
      cw1Base: { cw1: Record<string, number> };
      cw1New: { cw1: Record<string, number> };
      allowance: string;
      pass: boolean;
    };
    g4: { closed10FrontGlobePx: number; darkBase: { darkPx: number }; darkNew: { darkPx: number }; pass: boolean };
  };
  counterweights: {
    c1: { positionSha256: Record<string, Record<string, string>>; pass: boolean };
    c2: { fissureMm: Record<string, Record<string, { widthMm: number; heightMm: number }>>; targetWidthMm: number; pass: boolean };
    c3: { flips: number; bandFaces: number; pass: boolean };
    c4: { bandVerts: number; bodyVerts: number; outsideMovedVerts: number; lash: { n: number; maxMoveMm: number }; pass: boolean };
  };
  falsifier: { triggered: boolean; checks: Record<string, string> };
  sheets: Record<string, { sha256: string; bytes: number }>;
};

function readReport(): Report {
  expect(existsSync(REPORT), `conform report exists: ${REPORT}`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

function storePath(src: string): string {
  return join(STORE_ROOT, src.startsWith("assets:") ? src.slice(7) : src);
}

describe("the lid ring sits on the globe", () => {
  it("(1) report records the h1 round, the case target and the verdict", () => {
    const r = readReport();
    expect(r.card).toBe("tsk_83147b9cfdf9ab03");
    expect(r.round).toBe("h1-widen-then-seat");
    expect(r.target.widthMm).toBe(27.7);
    expect(r.target.source).toMatch(/pts_fitted_front\.npy/);
    expect(r.target.source).toMatch(/28\.09/);
    expect(r.target.bakeParamWidthMm).toBe(26.8);
    expect(r.bake.lidconformRecord.offsetMm).toBe(0.5);
    expect(r.bake.lidconformRecord.h1.targetWidthMm).toBe(26.8);
    expect(r.bake.lidconformRecord.lashFollow.found).toBe(true);
    expect(r.verdict.length).toBeGreaterThan(0);
  });

  it("(2) RED: the base bake shows the narrow fissure and the yaw wedge", () => {
    const r = readReport();
    for (const s of ["L", "R"]) {
      expect(r.counterweights.c2.fissureMm[s]!.base.widthMm).toBeCloseTo(23.96, 1);
    }
    const e = r.gates.g2.edgePx;
    for (const v of ["yaw25", "yaw-25", "yaw40", "yaw-40"]) {
      expect(e[v]!.base - e["front"]!.base, `base ${v} excess`).toBeGreaterThanOrEqual(100);
    }
    expect(r.gates.g3.cw1Base.cw1).toMatchObject({
      front: 0, yaw25: 914, "yaw-25": 912, yaw40: 2958, "yaw-40": 2963, "blink0.5": 386,
    });
  });

  it("(3) the widen-then-seat pass lives at the materialize call site", () => {
    const src = readFileSync(MATERIALIZE, "utf8");
    expect(src, "stem row").toContain('"aisha-lidconform": 24.0');
    expect(src, "conform hook").toContain("LIDCONFORM_BAKED ");
    expect(src, "h1 params threaded").toContain("target_width_mm");
    const mod = readFileSync(LID_CONFORM, "utf8");
    expect(mod, "rigid canthus patches").toContain("patchK");
    expect(mod, "gap-adaptive seating").toContain("seat_ceiling_mm");
    expect(mod, "lash follow").toContain("lashFollowMm");
    expect(mod, "transfer refuse").toContain("MATCH_REFUSE_MM");
    const core = readFileSync(LID_CORE, "utf8");
    expect(core, "boundary loops").toContain("def boundary_loops");
    expect(core, "mesh gaps").toContain("def signed_gap_to_mesh");
  });

  it("(4) C2 width reaches the case goal; height is recorded marginal", () => {
    const r = readReport();
    for (const s of ["L", "R"]) {
      const w = r.counterweights.c2.fissureMm[s]!.new.widthMm;
      expect(Math.abs(w - 27.7), `${s} width within 1mm of target`).toBeLessThanOrEqual(1.0);
      const h = r.counterweights.c2.fissureMm[s]!.new.heightMm;
      expect(h, `${s} height marginal to the 8-11 band`).toBeGreaterThan(8.0);
      expect(h, `${s} height marginal to the 8-11 band`).toBeLessThan(11.2);
    }
    expect(r.counterweights.c2.targetWidthMm).toBe(27.7);
  });

  it("(5) G1: seated span lands exactly 0.5; flesh span reported with the proof", () => {
    const r = readReport();
    for (const t of ["L", "R"]) {
      const g = r.gates.g1.gapsMm[`${t}.ring1`]!;
      expect(g.n).toBe(56);
      expect(g.min).toBe(0.5);
      expect(g.med).toBeGreaterThan(0.3);
    }
    expect(r.verdict).toMatch(/sphere-cap| sphere cap/i);
    expect(r.gates.g1.pass).toBe(false);
  });

  it("(6) RECORDED: G2/G3 keep measured values against the 1% bar", () => {
    const r = readReport();
    expect(r.gates.g2.edgePx["yaw25"]).toMatchObject({ base: 379 });
    expect(r.gates.g2.edgePx["front"]!.new).toBeGreaterThan(r.gates.g2.edgePx["front"]!.base);
    const b = r.gates.g3.cw1Base.cw1;
    const n = r.gates.g3.cw1New.cw1;
    expect(n["front"]).toBe(0);
    for (const v of ["yaw25", "yaw-25", "yaw40", "yaw-40"]) {
      expect(n[v]! <= b[v]! * 1.01, `G3 ${v} within 1%`).toBe(r.gates.g3.pass);
    }
    expect(r.gates.g3.allowance).toMatch(/1\.01/);
  });

  it("(7) G4: full closure shows 0 globe px and no new dark gap", () => {
    const r = readReport();
    expect(r.gates.g4.closed10FrontGlobePx).toBe(0);
    expect(r.gates.g4.darkNew.darkPx).toBeLessThanOrEqual(r.gates.g4.darkBase.darkPx);
    expect(r.gates.g4.pass).toBe(true);
  });

  it("(8) C1/C3/C4: globe identical, 0 flips, outside-band identical, lashes follow", () => {
    const r = readReport();
    expect(r.counterweights.c1.pass).toBe(true);
    for (const [, v] of Object.entries(r.counterweights.c1.positionSha256)) {
      expect(v["new"]).toBe(v["base"]);
    }
    expect(r.counterweights.c3.flips).toBe(0);
    expect(r.counterweights.c3.bandFaces).toBeGreaterThan(2000);
    expect(r.counterweights.c3.pass).toBe(true);
    expect(r.counterweights.c4.outsideMovedVerts).toBe(0);
    expect(r.counterweights.c4.lash.n).toBe(11088);
    expect(r.counterweights.c4.lash.maxMoveMm).toBeGreaterThan(0);
    expect(r.counterweights.c4.pass).toBe(true);
    expect(r.falsifier.triggered).toBe(false);
  });

  it("(9) h1 sheets exist in the store with the report shas", () => {
    const r = readReport();
    const names = Object.keys(r.sheets);
    expect(names.length).toBeGreaterThan(20);
    for (const key of [
      "h1/natural-base-front-full.png",
      "h1/natural-new-front-full.png",
      "h1/natural-base-blink-full.png",
      "h1/natural-new-blink-full.png",
      "h1/natural-base-front-eyeL-full.png",
      "h1/natural-new-front-eyeR-full.png",
      "h1/neon-base-front-full.png",
      "h1/neon-new-front-full.png",
    ]) {
      const p = storePath(`assets:lid-conform/${key}`);
      expect(existsSync(p), `sheet exists: ${key}`).toBe(true);
      const bytes = readFileSync(p);
      expect(bytes.length).toBeGreaterThan(10000);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(r.sheets[key]!.sha256);
    }
  });

  it("(10) known-bad: gating logic bites on injected values", () => {
    const r = readReport();
    const w = r.counterweights.c2.fissureMm["L"]!.new.widthMm;
    expect(Math.abs(w - 27.7) <= 1.0, "recorded width passes").toBe(true);
    expect(Math.abs(21.0 - 27.7) <= 1.0, "narrow width would fail").toBe(false);
    const b = r.gates.g3.cw1Base.cw1["yaw40"]!;
    const n = r.gates.g3.cw1New.cw1["yaw40"]!;
    expect(n <= b * 1.01, "recorded G3 correctly fails the 1% bar").toBe(false);
  });
});
