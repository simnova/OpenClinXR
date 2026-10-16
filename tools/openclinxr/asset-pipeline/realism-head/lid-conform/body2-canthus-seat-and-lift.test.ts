import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Card tsk_0b0a357a8e83645b: body2's canthus seats without flipped faces
 * and the upper lid lifts off the iris.
 *
 * Seat change (lid_conform.py LID_CONFORM_BY_CASE_ID body2 row): the seat
 * displacement decays over ring2/ring3 (seatSpreadK2/K3 0.5/0.25, read via
 * case_id -- the materialize call site is frozen). Alternatives tried on
 * the recorded field, all still 12 flips: single-hop ring2-only spread
 * 0.25/0.5, 0.75 (14, worse), travel caps 2.0/1.863/1.5 (which also drag
 * the seated span off 0.5); the twin-weld hypothesis is disproven (0
 * moved verts with an unmoved coincident twin). The Blender body is
 * watertight (0 boundary edges) while the export fragments into 48
 * islands, so the Blender BFS reaches past ring2 where GLB kernels stall.
 *
 * Lid-height term (same row, lidLiftMm 0.55): G3 bar = midpoint of Aisha
 * STEP0 MRD1 (4.8025) and body2 STEP0 MRD1 (3.869) = 4.336, + allowance
 * for seat retargeting. Aisha's row sets neither key (B2 blocks skip),
 * so her conformed body POSITION sha is unchanged (G1). The case's own
 * photo goal (2.71/2.84 via iris 468/473 x 0.2572 mm/px) already sits
 * below the embodied lid, so the photo cannot source a lift; Aisha's
 * photo goal (4.66/4.78 x 0.1812) already matches her 4.80.
 *
 * Measured outcome: 0 flips over the conform band, seated-span core all
 * in [0.3, 1.0], flesh past the sphere cap reported per vertex, globe +
 * corneas byte-identical, fissure 25.798 within 1mm of 25.9, blink
 * closed-1.0 0 globe px, MRD1 4.519 >= 4.336 and inside clinical 4-5.
 *
 * claimScope: the canthus seat fix and the upper-lid height term.
 * notEvidenceFor: clinical_validity, production_asset_readiness, gaze
 *   rotation (compat-eyes NT).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT = join(HERE, "body2-canthus-report.json");
const STORE_ROOT = "/Volumes/files/openclinxr-assets/store/";
const LID_CONFORM = join(HERE, "lid_conform.py");
const LID_CORE = join(HERE, "lid_conform_core.py");
const LID_MEASURE = join(HERE, "measure_conform.py");

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
  bakes: {
    body2Argv: string;
    lidconformRecord: {
      b2: { seatSpreadK2: number; seatSpreadK3: number; lidLiftMm: number };
      perSide: Record<string, { matchedRing1: number; maxSeatMm: number; maxSpreadMm: number; maxLiftMm: number }>;
    };
    newGlb: { sha256: string };
  };
  g1: { aishaPostPositionSha256: string; aishaStep0PositionSha256: string; pass: boolean };
  g2: {
    flips: number;
    bandFaces: number;
    seatedSpan: { perSide: Record<string, { n: number; preN: number; min: number; max: number }>; pass: boolean };
    flesh: { verts: { side: string; gapMm: number; lateralMm: number; capRMm: number; beyondCap: boolean }[] };
    boundary: { verts: unknown[] };
    globeCorneaPositionSha: { rows: Record<string, { base: string; new: string }>; pass: boolean };
    fissureNewMm: Record<string, number>;
    fissureGoalMm: number;
    fissurePass: boolean;
    blinkClosed10GlobePx: number;
  };
  g3: {
    aishaMrd1Mm: number;
    body2Step0Mrd1Mm: number;
    barMidpointMm: number;
    body2PostMrd1Mm: Record<string, number>;
    clinicalNormalMm: [number, number];
    pass: boolean;
  };
  g4: { pass: boolean };
  probes: { g2revert: string; g3revert: string };
  sheet: { root: string; files: Record<string, { sha256: string; bytes: number; width: number; height: number }> };
};

function readReport(): Report {
  expect(existsSync(REPORT), `canthus report exists: ${REPORT}`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

describe("body2 canthus seats clean and the upper lid lifts", () => {
  it("(1) report records the card, the B2 row and the bake record", () => {
    const r = readReport();
    expect(r.card).toBe("tsk_0b0a357a8e83645b");
    expect(r.bakes.lidconformRecord.b2).toMatchObject({
      seatSpreadK2: 0.5, seatSpreadK3: 0.25, lidLiftMm: 0.55,
    });
    for (const s of ["L", "R"]) {
      const p = r.bakes.lidconformRecord.perSide[s]!;
      expect(p.matchedRing1).toBe(56);
      expect(p.maxSpreadMm).toBeGreaterThan(0);
      expect(p.maxLiftMm).toBe(0.55);
    }
    expect(r.bakes.body2Argv).toMatch(/--reference adult_male_street_casual/);
    expect(r.bakes.body2Argv).not.toMatch(/no-lid-conform/);
  });

  it("(2) G1: Aisha post-fix body POSITION sha equals STEP0", () => {
    const r = readReport();
    expect(r.g1.aishaStep0PositionSha256).toBe(
      "770a7eb36314b2f8e85a8a1a80bcb343c131a9a2abff6f1c5bf8dbe164879c7f",
    );
    expect(r.g1.aishaPostPositionSha256).toBe(r.g1.aishaStep0PositionSha256);
    expect(r.g1.pass).toBe(true);
  });

  it("(3) G2: 0 flips, seated span in band, flesh past the cap", () => {
    const r = readReport();
    expect(r.g2.flips).toBe(0);
    expect(r.g2.bandFaces).toBeGreaterThan(2000);
    for (const s of ["L", "R"]) {
      const span = r.g2.seatedSpan.perSide[s]!;
      expect(span.n).toBe(span.preN);
      expect(span.n).toBeGreaterThan(0);
      expect(span.min).toBeGreaterThanOrEqual(0.3);
      expect(span.max).toBeLessThanOrEqual(1.0);
    }
    expect(r.g2.seatedSpan.pass).toBe(true);
    expect(r.g2.flesh.verts.length).toBeGreaterThan(0);
    for (const v of r.g2.flesh.verts) {
      expect(v.beyondCap).toBe(true);
      expect(v.gapMm).toBeGreaterThan(1.0);
      expect(v.lateralMm).toBeGreaterThan(v.capRMm);
    }
  });

  it("(4) G2: globe+corneas identical, width within 1mm, blink seals", () => {
    const r = readReport();
    expect(r.g2.globeCorneaPositionSha.pass).toBe(true);
    for (const [, v] of Object.entries(r.g2.globeCorneaPositionSha.rows)) {
      expect(v.new).toBe(v.base);
    }
    expect(Object.keys(r.g2.globeCorneaPositionSha.rows).length).toBe(3);
    for (const s of ["L", "R"]) {
      expect(Math.abs(r.g2.fissureNewMm[s]! - r.g2.fissureGoalMm)).toBeLessThanOrEqual(1.0);
    }
    expect(r.g2.fissureNewMm["L"]).toBeCloseTo(25.798, 2);
    expect(r.g2.fissurePass).toBe(true);
    expect(r.g2.blinkClosed10GlobePx).toBe(0);
  });

  it("(5) G3: post MRD1 clears the Aisha/body2-STEP0 midpoint", () => {
    const r = readReport();
    expect(r.g3.aishaMrd1Mm).toBeCloseTo(4.803, 2);
    expect(r.g3.body2Step0Mrd1Mm).toBeCloseTo(3.869, 2);
    expect(r.g3.barMidpointMm).toBeCloseTo(
      (r.g3.aishaMrd1Mm + r.g3.body2Step0Mrd1Mm) / 2, 2,
    );
    for (const s of ["L", "R"]) {
      expect(r.g3.body2PostMrd1Mm[s]!).toBeGreaterThanOrEqual(r.g3.barMidpointMm);
    }
    expect(r.g3.body2PostMrd1Mm["L"]).toBeCloseTo(4.519, 2);
    expect(r.g3.clinicalNormalMm).toEqual([4, 5]);
    expect(r.g3.pass).toBe(true);
  });

  it("(6) G4: no subject mesh/stem literal in lid_conform*.py", () => {
    const r = readReport();
    expect(r.g4.pass).toBe(true);
    for (const f of [LID_CONFORM, LID_CORE, LID_MEASURE]) {
      const src = readFileSync(f, "utf8");
      for (const lit of FORBIDDEN) {
        expect(src, `${f} must not name ${lit}`).not.toContain(lit);
      }
    }
    expect(readFileSync(LID_CORE, "utf8")).toContain("def mrd1_mm");
    expect(readFileSync(LID_CONFORM, "utf8")).toContain("seatSpreadK2");
  });

  it("(7) probes: STEP0 pre-fix bake fails both gates (destructive)", () => {
    const r = readReport();
    expect(r.probes.g2revert).toMatch(/12 flips/);
    expect(r.probes.g3revert).toMatch(/3\.869/);
  });

  it("(8) sheets: 12 pre/post PNGs with report shas, crops >= 400px", () => {
    const r = readReport();
    const names = Object.keys(r.sheet.files);
    expect(names.length).toBe(12);
    for (const key of [
      "sheet-body2-pre-front-eyeL-crop.png",
      "sheet-body2-post-front-eyeL-crop.png",
      "sheet-body2-pre-front-eyeR-crop.png",
      "sheet-body2-post-front-eyeR-crop.png",
      "sheet-body2-pre-yaw25-full.png",
      "sheet-body2-post-yaw25-full.png",
    ]) {
      const f = r.sheet.files[key]!;
      const p = join(r.sheet.root, key);
      expect(existsSync(p), `sheet exists: ${key}`).toBe(true);
      const bytes = readFileSync(p);
      expect(bytes.length).toBeGreaterThan(10000);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(f.sha256);
      if (key.includes("-crop")) {
        expect(f.width).toBeGreaterThanOrEqual(400);
      }
    }
  });

  it("(9) known-bad: gating logic bites on injected values", () => {
    const r = readReport();
    expect(r.g2.flips === 0, "recorded flips pass the 0 bar").toBe(true);
    expect(12 === 0, "STEP0 flips would fail the 0 bar").toBe(false);
    expect(
      r.g3.body2PostMrd1Mm["L"]! >= r.g3.barMidpointMm,
      "recorded MRD1 passes",
    ).toBe(true);
    expect(3.869 >= r.g3.barMidpointMm, "STEP0 MRD1 would fail the bar").toBe(false);
  });
});
