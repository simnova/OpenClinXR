import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Card tsk_083b92e9c7ca5d7b: the child's eyelids conform to an age-sized globe.
 *
 * The child (case peds_asthma_parent_anxiety_v1, phenotype age 8) conforms
 * against its OWN pre-conform base bake with its OWN target: mediapipe
 * eye-corner landmarks read off the child's own eye-band render
 * (222.04 px x the render's exact 0.097656 mm/px = 21.683 mm), corroborated
 * by the child's own margin loop (21.919 mm). No adult value is borrowed;
 * the Aisha prototype's 0.9 mm seat-pullback is not applied. The station's
 * default stage-4 stem is case-derived (<caseId>-lidconform), not a shared
 * stem that would size every unknown actor alike.
 *
 * Measured outcome (recorded, not wished): seated span lands exactly at the
 * 0.5 mm tear offset, fissure width 22.174 mm (0.491 from the child goal),
 * 0 band flips, blink seals, globe 22.77/22.752 mm = the 22.723 mm Rauscher
 * age-8 axial length; the two adult conformed bodies are POSITION-identical
 * pre vs post this change; run1 == run2; an unregistered stem still raises
 * #377. Recorded-not-claimed: canthal flesh to 1.693 mm (worst carrier past
 * R+1, the sphere-cap necessity) and aperture height 12.667 mm
 * (base + 1.917; family measure: aisha +1.306, body2 +1.795).
 *
 * claimScope: the childlid stem/target/ring wiring and its measured gates.
 * notEvidenceFor: clinical_validity, production_asset_readiness, gaze
 *   rotation (compat-eyes NT), pediatric eye-seat calibration (follow-on).
 */

const HERE = join(repoRoot(), "tools/openclinxr/asset-pipeline/realism-head/lid-conform");
const REPO_ROOT = repoRoot();
const REPORT = join(HERE, "child-conform-report.json");
const STORE_ROOT = "/Volumes/files/openclinxr-assets/store/";
const CHILD_STORE = join(STORE_ROOT, "lid-conform-child/");
const SHEET_DIR = join(CHILD_STORE, "sheet/");
const LID_CONFORM_PY = join(HERE, "lid_conform.py");
const STAGES_B = join(
  REPO_ROOT,
  "packages/openclinxr/stations/face-realism/src/stages-b.ts",
);
const RUN_TS = join(
  REPO_ROOT,
  "packages/openclinxr/stations/face-realism/src/run.ts",
);
const PLAN_TS = join(
  REPO_ROOT,
  "packages/openclinxr/stations/face-realism/src/plan.ts",
);

type FleshVert = {
  gapMm: number;
  preGapMm: number;
  lateralMm: number;
  capRMm: number;
  beyondCap: boolean;
};

type Report = {
  card: string;
  round: string;
  verdict: string;
  target: { widthMm: number; source: string; bakeParamWidthMm: number };
  globeVsAnatomy: {
    targetDiameterMm: number;
    beforeDiameterMm: number;
    scale: number;
    seatShiftForwardMm: number;
    fittedDiameterMm: { L: number; R: number };
  };
  bake: {
    argv: string;
    lidconformRecord: {
      offsetMm: number;
      h1: { targetWidthMm: number };
      b2: Record<string, number>;
      displacedVerts: number;
      perSide: Record<
        string,
        {
          baseRing1: number;
          matchedRing1: number;
          matchMedMm: number;
          matchMaxMm: number;
          seatedVerts: number;
          fleshVerts: number;
        }
      >;
    };
    baseGlb: { path: string; sha256: string };
    newGlb: { path: string; sha256: string };
  };
  gates: {
    g1: {
      targetWidthMm: number;
      flips: number;
      bandFaces: number;
      seatedSpanGapMm: Record<string, [number, number, number]>;
      canthalFlesh: Record<string, {
        n: number;
        gapMm: [number, number, number];
        verts: FleshVert[];
        sphereCap: {
          thresholdMm: number;
          worstGapMm: number;
          worstGapLateralMm: number;
          worstPastCap: boolean;
          overBandN: number;
          overBandPastCapN: number;
        };
      }>;
      fissureWidthMm: number;
      fissureWidthDeltaMm: number;
      closedLidGlobePxOutside: number;
      globeDiameterMm: [number, number];
      pass: boolean;
    };
    g2: {
      cases: Record<string, {
        pre: { path: string; sha256: string; positionSha256: string };
        post: { path: string; sha256: string; positionSha256: string };
        positionEqual: boolean;
      }>;
      pass: boolean;
    };
    g3: {
      run1PositionSha256: string;
      run2PositionSha256: string;
      basePositionSha256: string;
      pass: boolean;
    };
    g4: {
      unregisteredStem: string;
      refused: boolean;
      detail: string;
      registeredStems: Record<string, { stem: string; targetDiameterMm: number }>;
      pass: boolean;
    };
  };
  counterweights: {
    c1: { pass: boolean };
    c3: { flips: number; bandFaces: number; pass: boolean };
    iris: { base: { sha256: string; bytes: number }; conformed: { sha256: string; bytes: number } };
  };
  falsifier: { triggered: boolean };
  sheets: Record<string, { sha256: string; bytes: number }>;
  handback1: {
    rebake: {
      log: string;
      glb: { path: string; sha256: string };
      eyesAnatomical: { targetDiameterMm: number };
      positionSha256: string;
      globeEqualRun1: boolean;
      positionEqualRun1Run2: boolean;
    };
    pass: boolean;
  };
};

function readReport(): Report {
  expect(existsSync(REPORT), `child conform report exists: ${REPORT}`).toBe(true);
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

function pngDims(abs: string): [number, number] {
  const raw = readFileSync(abs);
  expect(raw.subarray(0, 8).toString("binary")).toBe("\x89PNG\r\n\x1a\n");
  return [raw.readUInt32BE(16), raw.readUInt32BE(20)];
}

describe("the child lid conforms to its age-sized globe", () => {
  it("(1) report records the card, the child row and the bake record", () => {
    const r = readReport();
    expect(r.card).toBe("tsk_083b92e9c7ca5d7b");
    expect(r.round).toBe("h1-child");
    expect(r.target.widthMm).toBeCloseTo(21.683, 2);
    expect(r.target.source).toMatch(/OWN base-bake render/);
    expect(r.target.bakeParamWidthMm).toBe(21.68);
    const lid = r.bake.lidconformRecord;
    expect(lid.offsetMm).toBe(0.5);
    expect(lid.h1.targetWidthMm).toBe(21.68);
    expect(lid.displacedVerts).toBe(624);
    expect(lid.b2).toMatchObject({
      seatSpreadK2: 0, seatSpreadK3: 0, seatSpreadK4: 0,
      seatSpreadPasses: 0, seatSpreadRate: 0,
    });
    for (const s of ["L", "R"]) {
      const p = lid.perSide[s]!;
      expect(p.baseRing1).toBe(56);
      expect(p.matchedRing1).toBe(56);
      expect(p.matchMaxMm).toBeLessThan(0.5);
      expect(p.seatedVerts + p.fleshVerts).toBe(56);
    }
    expect(r.bake.argv).toMatch(/--reference peds_patient_child/);
    expect(r.bake.argv).not.toMatch(/no-lid-conform/);
    expect(r.bake.argv).not.toMatch(/--eye-texture/);
    const row = (r.bake as { stemTableRowChange: {
      stem: string; oldValueMm: number; newValueMm: number;
      affectsOnNextBake: string[];
    } }).stemTableRowChange;
    expect(row.stem).toBe("mpfb-peds-patient-child");
    expect(row.oldValueMm).toBe(22.5);
    expect(row.newValueMm).toBe(r.globeVsAnatomy.targetDiameterMm);
    expect(row.affectsOnNextBake).toEqual([
      "mpfb-peds-patient-child",
      "peds_asthma_parent_anxiety_v1-eyeglobe-base",
      "peds_asthma_parent_anxiety_v1-lidconform",
    ]);
  });

  it("(2) the stage-4 default stem is case-derived, not shared", () => {
    // The stem-derivation unit test lives in the face-realism evidence sidecar
    // @openclinxr/station-face-realism-evidence (this repo refuses
    // cross-package relative src imports, so it cannot live here). This
    // clause pins the call-site wiring: runStage4 names no case literal and
    // the stage-4 stem function is the one the report's run used.
    const stages = readFileSync(STAGES_B, "utf8");
    expect(stages).toContain("stage4OutputStem(caseRec, caseId");
    for (const f of [RUN_TS, PLAN_TS]) {
      const src = readFileSync(f, "utf8");
      for (const lit of ["aisha", "body2", "adult_male_street_casual", "ob_patient_aisha"]) {
        expect(src, `${f} must not name case ${lit}`).not.toContain(lit);
      }
    }
    expect(readReport().bake.lidconformRecord.perSide["L"]!.baseRing1).toBe(56);
  });

  it("(3) G1: baked, 0 flips, seated span in band, globe = cited child value", () => {
    const r = readReport();
    const g1 = r.gates.g1;
    expect(g1.targetWidthMm).toBe(21.68);
    expect(g1.flips).toBe(0);
    expect(g1.bandFaces).toBeGreaterThan(2000);
    expect(r.counterweights.c3.flips).toBe(0);
    for (const s of ["L", "R"]) {
      const [mn, med, mx] = g1.seatedSpanGapMm[s]!;
      expect(mn).toBeGreaterThanOrEqual(0.3);
      expect(mx).toBeLessThanOrEqual(1.0);
      expect(med).toBe(0.5);
    }
    expect(Math.abs(g1.fissureWidthMm - r.target.widthMm)).toBeLessThanOrEqual(1.0);
    expect(g1.fissureWidthDeltaMm).toBeLessThanOrEqual(1.0);
    expect(g1.fissureWidthMm).toBeCloseTo(22.174, 2);
    expect(g1.closedLidGlobePxOutside).toBe(0);
    for (const d of g1.globeDiameterMm) {
      expect(Math.abs(d - r.globeVsAnatomy.targetDiameterMm)).toBeLessThan(0.1);
    }
    expect(r.globeVsAnatomy.targetDiameterMm).toBe(22.723);
    expect(r.globeVsAnatomy.fittedDiameterMm["L"]).toBeCloseTo(22.77, 2);
    expect(g1.pass).toBe(true);
  });

  it("(4) G1 flesh: recorded per vert, the worst carrier past the cap", () => {
    const r = readReport();
    for (const s of ["L", "R"]) {
      const flesh = r.gates.g1.canthalFlesh[s]!;
      expect(flesh.n).toBeGreaterThan(0);
      expect(flesh.verts.length).toBe(flesh.n);
      // The sphere-cap necessity is scoped to the carrier: the worst flesh
      // gap cannot sit at <=1.0 because its vertex is past R+1, where no
      // point lies within 1 mm of the sphere.
      expect(flesh.sphereCap.worstPastCap).toBe(true);
      expect(flesh.sphereCap.worstGapLateralMm).toBeGreaterThanOrEqual(
        flesh.sphereCap.thresholdMm,
      );
      expect(flesh.sphereCap.overBandN).toBe(11);
      expect(flesh.sphereCap.overBandPastCapN).toBe(7);
      // The ≤4 remaining over-band verts are the widen transition zone:
      // each sits within half a millimetre laterally of the cap edge, and
      // every over-band vert past the cap edge is flagged past it.
      for (const v of flesh.verts) {
        if (v.gapMm > 1.0) {
          expect(v.lateralMm).toBeGreaterThanOrEqual(v.capRMm - 0.5);
          if (v.lateralMm >= v.capRMm) {
            expect(v.beyondCap).toBe(true);
          }
        }
      }
    }
  });

  it("(5) G2: the two adult conformed bodies are unchanged by this slice", () => {
    const r = readReport();
    expect(r.gates.g2.cases["aisha"]!.positionEqual).toBe(true);
    expect(r.gates.g2.cases["body2"]!.positionEqual).toBe(true);
    expect(r.gates.g2.cases["aisha"]!.post.positionSha256).toBe(
      "b26b40ca9ffb8de6c7baf88edb46666a6ba7206c69a4e53237850fd6b4ddb7dd",
    );
    expect(r.gates.g2.cases["body2"]!.post.positionSha256).toBe(
      "323088678be401a2c661583e7c857f7382a54316ec24a25ede9f8efa896575e9",
    );
    for (const key of ["aisha", "body2"]) {
      const c = r.gates.g2.cases[key]!;
      for (const side of ["pre", "post"] as const) {
        const disk = createHash("sha256")
          .update(readFileSync(c[side].path))
          .digest("hex");
        expect(disk, `${key} ${side} store bytes pinned`).toBe(c[side].sha256);
      }
    }
    expect(r.gates.g2.pass).toBe(true);
  });

  it("(6) G3: child run1 == run2 and both differ from the base", () => {
    const r = readReport();
    expect(r.gates.g3.run1PositionSha256).toBe(r.gates.g3.run2PositionSha256);
    expect(r.gates.g3.run1PositionSha256).toBe(
      "a47c3ebd5944b4f11d38283334a474f33e262ca10c493523bdd22d711d23dec5",
    );
    expect(r.gates.g3.basePositionSha256).toBe(
      "6091d6f5ea3bb8d4557ebb97238a35c0e8bb377b804c3b129b197604a0d92799",
    );
    expect(r.gates.g3.run1PositionSha256).not.toBe(r.gates.g3.basePositionSha256);
    const baseDisk = createHash("sha256")
      .update(readFileSync(r.bake.baseGlb.path))
      .digest("hex");
    expect(baseDisk, "base ring source pinned").toBe(r.bake.baseGlb.sha256);
    expect(r.gates.g3.pass).toBe(true);
  });

  it("(7) G4: the unregistered stem still refuses; the child stems resolve", () => {
    const r = readReport();
    expect(r.gates.g4.unregisteredStem).toBe("stage4-lidconform");
    expect(r.gates.g4.refused).toBe(true);
    expect(r.gates.g4.detail).toContain("#377");
    for (const stem of [
      "peds_asthma_parent_anxiety_v1-eyeglobe-base",
      "peds_asthma_parent_anxiety_v1-lidconform",
      "mpfb-peds-patient-child",
    ]) {
      expect(r.gates.g4.registeredStems[stem]!.targetDiameterMm).toBe(22.723);
    }
    expect(r.gates.g4.pass).toBe(true);
  });

  it("(8) the case iris reaches the conformed bake (no texture override)", () => {
    const r = readReport();
    expect(r.counterweights.iris.base.sha256).toBe(
      r.counterweights.iris.conformed.sha256,
    );
    expect(r.counterweights.iris.base.bytes).toBe(662241);
    const materialize = readFileSync(
      join(REPO_ROOT, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py"),
      "utf8",
    );
    expect(materialize).toContain("LID_CONFORM_CASE_BY_SUBJECT_ID");
    expect(materialize).toContain('"peds_patient_child"');
    expect(readFileSync(LID_CONFORM_PY, "utf8")).toContain(
      '"peds_asthma_parent_anxiety_v1": {"offsetMm": 0.5',
    );
  });

  it("(9) sheets: 12 native PNGs with report shas, crops 420x420", () => {
    const r = readReport();
    const names = Object.keys(r.sheets);
    expect(names.length).toBe(12);
    for (const key of [
      "sheet-child-base-front-eyeL-crop.png",
      "sheet-child-new-front-eyeL-crop.png",
      "sheet-child-base-front-eyeR-crop.png",
      "sheet-child-new-front-eyeR-crop.png",
      "base-front-full.png",
      "new-front-full.png",
      "base-yaw25-full.png",
      "new-yaw25-full.png",
      "sheet-child-base-yaw25-eyeL-crop.png",
      "sheet-child-new-yaw25-eyeR-crop.png",
    ]) {
      const f = r.sheets[key]!;
      const p = join(SHEET_DIR, key);
      expect(existsSync(p), `sheet exists: ${key}`).toBe(true);
      const bytes = readFileSync(p);
      expect(bytes.length).toBeGreaterThan(10000);
      expect(createHash("sha256").update(bytes).digest("hex"), `${key} sha pinned`).toBe(
        f.sha256,
      );
      expect(bytes.length, `${key} bytes recorded`).toBe(f.bytes);
      const [w, h] = pngDims(p);
      if (key.includes("-crop")) {
        expect([w, h], `${key} native crop size`).toEqual([420, 420]);
      } else {
        expect([w, h], `${key} native full size`).toEqual([2048, 2048]);
      }
    }
  });

  it("(10) falsifier quiet and the target is case-owned, not borrowed", () => {
    const r = readReport();
    expect(r.falsifier.triggered).toBe(false);
    expect(r.target.source).toMatch(/mediapipe/);
    expect(r.target.source).toMatch(/mmPerPx 0\.097656/);
    expect(r.target.source).toMatch(/21\.919 mm/);
    expect(r.target.source).not.toMatch(/26\.8|25\.0|27\.7/);
    for (const key of ["card", "round", "verdict"] as const) {
      expect(typeof r[key]).toBe("string");
    }
  });

  it("(11) handback 1: one rebake logs the same globe and body", () => {
    const r = readReport();
    expect(r.handback1.pass).toBe(true);
    expect(r.handback1.rebake.globeEqualRun1).toBe(true);
    expect(r.handback1.rebake.positionEqualRun1Run2).toBe(true);
    expect(r.handback1.rebake.eyesAnatomical.targetDiameterMm).toBe(
      r.globeVsAnatomy.targetDiameterMm,
    );
    expect(r.handback1.rebake.positionSha256).toBe(r.gates.g3.run1PositionSha256);
    expect(existsSync(r.handback1.rebake.log), "confirm bake log exists").toBe(true);
    expect(existsSync(r.handback1.rebake.glb.path), "confirm bake GLB exists").toBe(true);
  });
});
