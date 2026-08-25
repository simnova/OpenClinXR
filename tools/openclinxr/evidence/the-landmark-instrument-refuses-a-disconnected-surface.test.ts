import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import {
  extractLandmarks,
  loadReferenceObj,
  parseObj,
  sharedVertexFraction,
  GENERATED_HUMANOIDS_DIR,
} from "./anny-mpfb-landmark-compare.js";

/**
 * OBSERVABLE: the MADR 0051 §4 landmark instrument measures girths by MESH-SURFACE
 * connectivity, and on a mesh whose surface connectivity has been destroyed it does not
 * fail — it returns near-zero girths that look exactly like measurements.
 *
 * MEASURED 2026-08-25, control/treatment on IDENTICAL geometry (every vertex position
 * bit-identical; only the shared-vertex connectivity destroyed, as a glTF exporter does
 * at a UV/normal seam):
 *
 *   ed_chest_pain_nurse_adult   intact          fragmented     |delta|
 *     stature                   1.7600          1.7600          0.0000   <- unaffected
 *     chestGirthMeters          0.8688          0.0737          0.7950
 *     waistGirthMeters          0.7347          0.0000          0.7347   <- EXACTLY zero
 *     hipGirthMeters            0.9262          0.0479          0.8783
 *
 *   peds_patient_child          intact          fragmented     |delta|
 *     chestGirthMeters          0.6917          0.0806          0.6111
 *     waistGirthMeters          0.6458          0.0000          0.6458
 *     hipGirthMeters            0.6949          0.0214          0.6734
 *
 * Stature is a bounding measure and survives; the girths are the connectivity-dependent
 * half and they collapse silently. A waist of exactly 0.0000 m is returned as a number,
 * not raised as an error — so a solve loop (MADR 0051 §6) built to drive girth error
 * toward zero against this instrument would read a destroyed mesh as a PERFECT match and
 * optimise toward it. That is the hazard: not a wrong number, an inverted one.
 *
 * WHY THE THRESHOLD IS 0.5, and it is not fitted. Shared-vertex fraction measured across
 * the population:
 *
 *   8 of 8 tracked .anny_base.obj references          1.0000  (13,348-13,718 verts)
 *   the same meshes, connectivity destroyed           0.0000
 *   REAL exported MPFB GLB round-trips                0.9821, 0.9884
 *
 * The gap between 0.0000 and 0.9821 is empty, so any threshold inside it separates the
 * classes; 0.5 is its midpoint. A real glTF export sits at the TOP of the gap, which is
 * the row that matters — this guard must not refuse the pipeline's own exported bodies.
 *
 * NOT the explanation for #297's exported-body girths. An earlier reading of mine blamed
 * glTF seam-splitting for implausible girths measured on shipped MPFB GLBs. That is
 * WITHDRAWN: real exports measure 0.982-0.988 connected, so fragmentation is not what
 * happens to them. Why an exported MPFB body still measures implausible girths is NOT
 * DETERMINED and is not claimed here.
 *
 * claimScope: the landmark instrument's silent-failure mode on connectivity-degraded input,
 *   and that it now refuses instead.
 * notEvidenceFor: the Anny->MPFB girth gap (unmeasured); the MADR 0051 §6 solve loop; that
 *   any shipped body's girths are right or wrong; clinical or anthropometric validity.
 */

const REFERENCE_IDS = readdirSync(GENERATED_HUMANOIDS_DIR)
  .filter((f) => f.endsWith(".anny_base.obj"))
  .map((f) => f.replace(".anny_base.obj", ""));

/** Put every face on its own private vertices. Geometry identical; connectivity gone. */
function fragmentSurface(objText: string): string {
  const { positions, faces } = parseObj(objText);
  const vs: string[] = [];
  const fs: string[] = [];
  let n = 0;
  for (const face of faces) {
    const idx: number[] = [];
    for (const vi of face) {
      const p = positions[vi];
      vs.push(`v ${p[0]} ${p[1]} ${p[2]}`);
      idx.push(++n);
    }
    fs.push(`f ${idx.join(" ")}`);
  }
  return vs.concat(fs).join("\n");
}

describe("the landmark instrument refuses a disconnected surface", () => {
  it("(1) refuses a mesh whose surface connectivity has been destroyed", () => {
    const intact = loadReferenceObj("ed_chest_pain_nurse_adult");
    expect(() =>
      extractLandmarks("ed_chest_pain_nurse_adult", fragmentSurface(intact)),
    ).toThrow(/connectivity|disconnected/i);
  });

  it("(2) VACUITY GUARD: the refused mesh carries identical geometry to the accepted one", () => {
    const intact = loadReferenceObj("ed_chest_pain_nurse_adult");
    const a = parseObj(intact).positions;
    const b = parseObj(fragmentSurface(intact)).positions;
    // Same point set, different vertex count (faces no longer share).
    expect(b.length).toBeGreaterThan(a.length);
    const key = (p: readonly number[]) => `${p[0]},${p[1]},${p[2]}`;
    const setA = new Set(a.map(key));
    const setB = new Set(b.map(key));
    expect(setB.size).toBe(setA.size);
    for (const k of setA) expect(setB.has(k)).toBe(true);
    // So the refusal cannot be about geometry: it is connectivity alone.
  });

  it("(3) COUNTERWEIGHT: every tracked Anny reference still measures", () => {
    expect(REFERENCE_IDS.length).toBeGreaterThanOrEqual(8);
    for (const id of REFERENCE_IDS) {
      const set = extractLandmarks(id, loadReferenceObj(id));
      expect(set.statureMeters).toBeGreaterThan(0.9);
      expect(set.chestGirthMeters).toBeGreaterThan(0.3);
    }
  });

  it("(4) COUNTERWEIGHT: the guard does not refuse a real glTF export's connectivity", () => {
    // Real exported MPFB bodies measured 0.9821 / 0.9884 shared. The guard must clear
    // them, or it refuses the pipeline's own output — the failure that would make this
    // change worse than the defect.
    const intact = loadReferenceObj("peds_patient_child");
    const { positions, faces } = parseObj(intact);
    expect(sharedVertexFraction(positions.length, faces)).toBe(1);
    expect(sharedVertexFraction(positions.length, faces)).toBeGreaterThan(0.9821);
  });

  it("(5) the shared-vertex classes stay separated by an empty gap", () => {
    const intact = loadReferenceObj("ed_chest_pain_nurse_adult");
    const i = parseObj(intact);
    const f = parseObj(fragmentSurface(intact));
    const intactFrac = sharedVertexFraction(i.positions.length, i.faces);
    const fragFrac = sharedVertexFraction(f.positions.length, f.faces);
    expect(intactFrac).toBe(1);
    expect(fragFrac).toBe(0);
    expect(intactFrac - fragFrac).toBeGreaterThan(0.9);
  });
});
