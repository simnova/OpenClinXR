import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Card tsk_56c4fed983304ea6: lid-conform takes its subject from the case.
 *
 * Body/globe/cornea meshes resolve BY ROLE (lid_conform_core
 * resolve_*_mesh_name over the materializer's own tags: mpfb_skin_*
 * body prims, the node-referenced eye-material globe,
 * openclinxr_eye_cornea_mat corneas) — no subject mesh/stem literal
 * anywhere in lid_conform*.py. The ring source is the subject's OWN
 * pre-conform bake, keyed by case id (not output stem). body2's fissure
 * target converts its any-subject eye-corner landmarks to mm with its
 * own pre-conform bake head scale (temple ruler + aisha ear-bias
 * calibration, corroborated by the Farkas inner-canthal ruler).
 *
 * Measured outcome (recorded, not wished): G1 holds (aisha rebake
 * body POSITION sha identical); body2 runs micron-coincident
 * (matchMax 0.0044), width 25.798 within 1mm of the 25.9 goal, globe
 * byte-identical, blink seals geometrically; G2 is RECORDED-FAIL on two
 * clauses — canthal flesh stands 2.524 off-globe (the same sphere-cap
 * necessity the aisha verdict proves) and 12 grazing canthus slivers
 * flip under 2.775mm seat travel (vs 1.863 aisha).
 *
 * claimScope: any-subject lid-conform wiring and its measured gates.
 * notEvidenceFor: clinical_validity, production_asset_readiness, gaze
 *   rotation (compat-eyes NT).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../../..");
const REPORT = join(HERE, "any-subject-report.json");
const STORE_ROOT = "/Volumes/files/openclinxr-assets/store/";
const MEASURE = join(STORE_ROOT, "lid-conform-any/any-conform-measure.json");
const MATERIALIZE = join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);
const LID_CONFORM = join(HERE, "lid_conform.py");
const LID_CORE = join(HERE, "lid_conform_core.py");
const LID_MEASURE = join(HERE, "measure_conform.py");

/** Subject mesh/stem literals for BOTH subjects: a hand-added body2 row
 *  (or constant) trips this list exactly like an Aisha one (the CW). */
const FORBIDDEN = [
  "mpfb_ob_patient_aisha",
  "mpfb_adult_male_street_casual",
  "aisha-lidconform",
  "aisha-eyeglobe",
  "body2-lidconform",
  "body2-eyeglobe",
  "high_poly_globe_mpfb",
  "cornea_high_poly",
];

type Report = {
  card: string;
  target: {
    source: string;
    method: string;
    goalEyeCornerPx: { mean: number };
    goalMm: number;
    bakeParamMm: number;
  };
  roleResolution: {
    resolvedAisha: Record<string, unknown>;
    resolvedBody2: Record<string, unknown>;
  };
  g1: { pass: boolean; storeBodyPositionSha256: string; rebakeBodyPositionSha256: string };
  g2: {
    pass: boolean;
    ring1GapsMm: Record<string, { n: number; min: number; med: number; max: number }>;
    c3Flips: number;
    fissureNewMm: Record<string, number>;
    fissureTargetMm: number;
  };
  g3: { pass: boolean };
  g4: { pass: boolean; closed10FrontGlobePx: number };
  sheet: { root: string; files: Record<string, string> };
  falsifier: { failingClauses: string[] };
};

function readReport(): Report {
  expect(existsSync(REPORT), `any-subject report exists: ${REPORT}`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

function pngWidth(p: string): number {
  const b = readFileSync(p);
  expect(b.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return b.readUInt32BE(16);
}

describe("lid-conform takes its subject from the case", () => {
  it("(1) report records the card, the case target and the head-scale method", () => {
    const r = readReport();
    expect(r.card).toBe("tsk_56c4fed983304ea6");
    expect(r.target.source).toMatch(/any-subject-targets\.json/);
    expect(r.target.method).toMatch(/temple ruler/);
    expect(r.target.method).toMatch(/OWN pre-conform/);
    expect(r.target.goalEyeCornerPx.mean).toBeCloseTo(100.58, 1);
    expect(r.target.goalMm).toBe(25.9);
    expect(r.target.bakeParamMm).toBe(25.0);
  });

  it("(2) G3: no subject mesh/stem literal in lid_conform*.py (either subject trips it)", () => {
    const r = readReport();
    expect(r.g3.pass).toBe(true);
    for (const f of [LID_CONFORM, LID_CORE, LID_MEASURE]) {
      const src = readFileSync(f, "utf8");
      for (const lit of FORBIDDEN) {
        expect(src, `${f} must not name ${lit}`).not.toContain(lit);
      }
    }
    const core = readFileSync(LID_CORE, "utf8");
    expect(core).toContain("def resolve_body_mesh_name");
    expect(core).toContain("def resolve_globe_mesh_name");
    expect(core).toContain("def resolve_cornea_mesh_names");
    expect(core).toContain("openclinxr_eye_cornea_mat");
    const mod = readFileSync(LID_CONFORM, "utf8");
    expect(mod).toContain("LID_CONFORM_BY_CASE_ID");
    expect(mod).not.toContain("LID_CONFORM_BY_OUTPUT_STEM");
    expect(mod).toContain("def base_glb_for_case");
    expect(mod).toContain("ring_source_glb");
  });

  it("(3) the call site keys by case id with its own ring source", () => {
    const src = readFileSync(MATERIALIZE, "utf8");
    expect(src).toContain("lid_conform_case_for_subject");
    expect(src).toContain("LID_CONFORM_CASE_BY_SUBJECT_ID");
    expect(src).toContain("--no-lid-conform");
    expect(src).toContain("no_lid_conform");
    expect(src).toContain("ring_source_glb");
    expect(src).toContain("LIDCONFORM_SKIPPED");
    expect(src).toContain("LIDCONFORM_BAKED ");
  });

  it("(4) G1: aisha rebake body byte-identical to main", () => {
    const r = readReport();
    expect(r.g1.pass).toBe(true);
    for (const h of [r.g1.storeBodyPositionSha256, r.g1.rebakeBodyPositionSha256]) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(r.g1.rebakeBodyPositionSha256).toBe(r.g1.storeBodyPositionSha256);
  });

  it("(5) G2 pass clauses: runs, globe identical, width within 1mm, blink seals", () => {
    const r = readReport();
    expect(existsSync(MEASURE), `measure json exists: ${MEASURE}`).toBe(true);
    const m = JSON.parse(readFileSync(MEASURE, "utf8")) as {
      c1: { pass: boolean };
      g4: { closed10FrontGlobePx: number };
    };
    expect(m.c1.pass).toBe(true);
    for (const key of ["L.ring1", "R.ring1"]) {
      const g = r.g2.ring1GapsMm[key]!;
      expect(g.n).toBe(56);
      expect(g.min).toBe(0.5);
    }
    for (const t of ["L", "R"]) {
      expect(
        Math.abs(r.g2.fissureNewMm[t]! - r.g2.fissureTargetMm),
        `${t} width within 1mm of target`,
      ).toBeLessThanOrEqual(1.0);
    }
    expect(r.g2.fissureNewMm["L"]).toBeCloseTo(25.798, 2);
    expect(r.g4.pass).toBe(true);
    expect(r.g4.closed10FrontGlobePx).toBe(0);
    expect(m.g4.closed10FrontGlobePx).toBe(0);
  });

  it("(6) RECORDED-FAIL: flesh gap + flips keep exact measured values", () => {
    const r = readReport();
    expect(r.g2.pass).toBe(false);
    for (const key of ["L.ring1", "R.ring1"]) {
      expect(r.g2.ring1GapsMm[key]!.max).toBe(2.524);
    }
    expect(r.g2.c3Flips).toBe(12);
    expect(r.falsifier.failingClauses.length).toBeGreaterThanOrEqual(2);
    expect(r.falsifier.failingClauses.join(" ")).toMatch(/sphere-cap/);
  });

  it("(7) body2 sheets exist in the store with the report shas, crops >= 300px", () => {
    const r = readReport();
    const names = Object.keys(r.sheet.files);
    expect(names.length).toBe(12);
    for (const key of [
      "sheet-body2-base-front-full.png",
      "sheet-body2-new-front-full.png",
      "sheet-body2-base-front-eyeL-crop.png",
      "sheet-body2-new-front-eyeL-crop.png",
      "sheet-body2-base-yaw25-eyeR-crop.png",
      "sheet-body2-new-yaw25-eyeR-crop.png",
    ]) {
      const p = join(r.sheet.root, key);
      expect(existsSync(p), `sheet exists: ${key}`).toBe(true);
      const bytes = readFileSync(p);
      expect(bytes.length).toBeGreaterThan(10000);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(r.sheet.files[key]);
      if (key.includes("-crop")) {
        expect(pngWidth(p), `${key} crop width`).toBeGreaterThanOrEqual(300);
      }
    }
  });

  it("(8) known-bad: gating logic bites on injected values", () => {
    const r = readReport();
    const w = r.g2.fissureNewMm["L"]!;
    expect(Math.abs(w - 25.9) <= 1.0, "recorded width passes").toBe(true);
    expect(Math.abs(21.0 - 25.9) <= 1.0, "narrow width would fail").toBe(false);
    expect(r.g2.c3Flips === 0, "recorded flips correctly fail the 0 bar").toBe(false);
    const g = r.g2.ring1GapsMm["L.ring1"]!;
    expect(
      g.min >= 0.3 && g.max <= 1.0,
      "recorded ring1 correctly fails the strict band",
    ).toBe(false);
  });
});
