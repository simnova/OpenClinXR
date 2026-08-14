import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **Every MPFB actor's eyeballs are 25-34% larger than human anatomy.** This is the best-measured
 * candidate for the "doll-like" impression graded on every face capture, and a better explanation than
 * the convergent squint I previously suspected — an oversized globe in a normal socket presents more
 * iris and less sclera.
 *
 * Measured 2026-08-13 on the shipped bytes, least-squares sphere fit to each eye's 48 vertices:
 *
 *   actor   diameter   anatomical target   over    forward-most z   fit RMS
 *   ------  --------   -----------------   -----   --------------   -------
 *   aisha    29.91 mm        24.0 mm       +25%       139.20 mm      0.002 mm (0.01%)
 *   kevin    32.05 mm        24.0 mm       +34%       141.65 mm      0.166 mm (1.04%)
 *   child    29.72 mm        22.5 mm       +32%       110.41 mm      0.106 mm (0.71%)
 *
 * Left and right agree to 0.01 mm on all three, so this is systematic, not a per-eye accident.
 *
 * ## THE REFERENCE IS EXTERNAL ANATOMY, SOURCED — NOT A NUMBER I CHOSE (SS9s)
 *
 * Human ocular axial length is ~24 mm in adults, reaching adult size by about age 12-14. Age 4 is
 * 22.2 mm rising to 23.9 mm by 17; newborns are 16-17 mm.
 *   - pubmed.ncbi.nlm.nih.gov/34116120  (meta-analysis, newborns to 3 years)
 *   - onlinelibrary.wiley.com/doi/10.1111/opo.12814  (Rauscher 2021, ages 4-17)
 *
 * SS9s permits three sound reference classes and this is the second: **an external floor fixed by the
 * domain**. The treatment cannot move it, which is exactly why it is safe to bound against — unlike a
 * threshold expressed as a fraction of the thing being measured, which cancels to a tautology.
 *
 * **22.5 mm for the child assumes a school-age patient.** If the case definition says otherwise the
 * target moves; check `peds_patient_child`'s phenotype rather than taking this number on faith.
 *
 * ## THE CHEAP FIX WOULD MAKE THE PRODUCT WORSE — WHICH IS WHY CLAUSE (2) EXISTS
 *
 * Scaling the eye mesh down about its own centre moves the forward-most point BACK by 3.0 / 4.0 /
 * 3.6 mm. That is pure geometry and is reliable. Left uncompensated the eyes recede into the head and
 * the actors go hollow-eyed — the SS6p failure where a deletion needs a stated replacement. The fix is
 * **shrink AND re-seat**: reduce the radius and translate the centre forward so the corneal pole stays.
 *
 *   treatment                                       | (1) size | (2) seated | (3) spherical | result
 *   ------------------------------------------------|----------|------------|---------------|--------
 *   a) today                                        | **FAIL** |    pass    |     pass      | REFUSED
 *   b) scale down about the eye's own centre        |   pass   | **FAIL**   |     pass      | REFUSED
 *   c) squash one axis to hit the diameter          |   pass   |    pass    |  **FAIL**     | REFUSED
 *   d) shrink and translate forward to re-seat      |   pass   |    pass    |     pass      | ALL PASS
 *
 * (c) is worth naming: the fit reports a MEAN radius, so flattening the globe along z while widening
 * it in x/y can hit the target diameter while destroying the shape. Clause (3) floors the fit quality
 * against each actor's own measured residual, so the eye must stay a sphere.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails 3/3. (2) and (3) pass today and
 * are counterweights. Both are independent of what (1) measures — changing the diameter moves neither
 * where the corneal pole sits nor how spherical the surface is, so neither can be satisfied by the
 * same edit that greens the RED.
 *
 * NOT TESTED:
 *   - **That this is the cause of the doll-like grade.** It is the best-measured candidate; only a
 *     re-bake and a fresh head-framed grade settles it, and that grade is the orchestrator's.
 *   - **The lid and socket.** Shrinking the globe may expose socket interior or leave the lid aperture
 *     too large. Nothing here measures the lid, and clause (2) only pins the corneal pole.
 *   - **Whether anatomical is the right target at all** for a stylised clinical actor. Anatomy gives
 *     the number; whether these actors should be anatomical is a design call, not a measurement
 *     (SS8y). "Stylised is fine" is a legitimate close.
 *   - **Absolute protrusion past the skin.** I tried to measure it and got -7 to -10 mm, i.e. the eye
 *     apparently behind the face. That is contaminated — the skin sample catches the nose bridge and
 *     brow, which legitimately sit forward. Do not reuse it. Clause (2) uses the eye's own forward-most
 *     z, which depends on the sphere alone and is unaffected.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** Anatomical axial length in mm. Adults 24.0; the child is school-age, so 22.5. Sourced above. */
const ANATOMICAL_TARGET_MM: Record<string, number> = {
  "mpfb-ob-patient-aisha": 24.0,
  "mpfb-peds-nurse-kevin": 24.0,
  "mpfb-peds-patient-child": 22.5,
};

/** Generous: 15% over anatomy still passes. Today's 25-34% fails 3/3 with margin. */
const MAX_OVER_ANATOMY = 1.15;
/** The corneal pole may not recede more than this from where it sits today. */
const MAX_RECESSION_MM = 1.0;
/** The eye must stay spherical: fit residual may not exceed 3x each actor's own measured value. */
const MAX_RESIDUAL_GROWTH = 3;

/** MEASURED 2026-08-13 on the shipped bytes. */
const BASELINE: Record<string, { forwardZmm: number; fitRmsMm: number }> = {
  "mpfb-ob-patient-aisha": { forwardZmm: 139.2, fitRmsMm: 0.002 },
  "mpfb-peds-nurse-kevin": { forwardZmm: 141.65, fitRmsMm: 0.166 },
  "mpfb-peds-patient-child": { forwardZmm: 110.41, fitRmsMm: 0.106 },
};

const ACTORS = Object.keys(ANATOMICAL_TARGET_MM);

type Eye = { diameterMm: number; forwardZmm: number; fitRmsMm: number };

/** Least-squares sphere fit — linear in (centre, r^2), solved by 3x3 elimination. */
function fitSphere(P: number[][]): { c: number[]; r: number; rms: number } {
  const n = P.length;
  const m = [0, 1, 2].map((k) => P.reduce((s, p) => s + p[k]!, 0) / n);
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const b = [0, 0, 0];
  for (const p of P) {
    const d = [p[0]! - m[0]!, p[1]! - m[1]!, p[2]! - m[2]!];
    const dd = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2;
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) A[i]![j]! += 2 * d[i]! * d[j]!;
      b[i]! += d[i]! * dd;
    }
  }
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < 3; i += 1) {
    let piv = i;
    for (let r = i + 1; r < 3; r += 1) if (Math.abs(M[r]![i]!) > Math.abs(M[piv]![i]!)) piv = r;
    [M[i], M[piv]] = [M[piv]!, M[i]!];
    for (let r = 0; r < 3; r += 1) {
      if (r === i || Math.abs(M[i]![i]!) < 1e-12) continue;
      const f = M[r]![i]! / M[i]![i]!;
      for (let c = i; c < 4; c += 1) M[r]![c]! -= f * M[i]![c]!;
    }
  }
  const c = [0, 1, 2].map((i) => (Math.abs(M[i]![i]!) < 1e-12 ? 0 : M[i]![3]! / M[i]![i]! + m[i]!));
  const dists = P.map((p) => Math.hypot(p[0]! - c[0]!, p[1]! - c[1]!, p[2]! - c[2]!));
  const r = dists.reduce((s, d) => s + d, 0) / dists.length;
  const rms = Math.sqrt(dists.reduce((s, d) => s + (d - r) ** 2, 0) / dists.length);
  return { c, r, rms };
}

const io = new NodeIO();

async function measure(actor: string): Promise<Eye | null> {
  const doc = await io.read(join(REPO_ROOT, GENERATED, `${actor}.glb`));
  const pts: number[][] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (!/eyes/i.test(prim.getMaterial()?.getName() ?? "")) continue;
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, v);
        pts.push([...v]);
      }
    }
  }
  // Left eye only — L and R agree to 0.01mm, so one side is the measurement and the other is a check.
  const left = pts.filter((p) => p[0]! < 0);
  if (left.length < 12) return null;
  const f = fitSphere(left);
  return {
    diameterMm: f.r * 2000,
    forwardZmm: Math.max(...left.map((p) => p[2]!)) * 1000,
    fitRmsMm: f.rms * 1000,
  };
}

const rows = (await Promise.all(ACTORS.map(async (a) => ({ actor: a, eye: await measure(a) })))).filter(
  (r): r is { actor: string; eye: Eye } => r.eye !== null,
);

/**
 * An empty enumeration must FAIL, never pass vacuously (SS7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireMeasured(): void {
  expect(rows.length, `actors with a measurable eye sphere (of ${ACTORS.length})`).toBe(ACTORS.length);
}

describe("MPFB eyeballs are anatomically sized", () => {
  it.fails(`(1) RED: eyeball diameter is within ${MAX_OVER_ANATOMY}x the actor's anatomical axial length`, () => {
    requireMeasured();
    const oversized = rows
      .filter((r) => r.eye.diameterMm > (ANATOMICAL_TARGET_MM[r.actor] ?? 0) * MAX_OVER_ANATOMY)
      .map((r) => {
        const t = ANATOMICAL_TARGET_MM[r.actor]!;
        return `${r.actor}: ${r.eye.diameterMm.toFixed(2)}mm vs anatomical ${t}mm (+${(
          (r.eye.diameterMm / t - 1) *
          100
        ).toFixed(0)}%, bound ${(t * MAX_OVER_ANATOMY).toFixed(1)}mm)`;
      });
    expect(oversized, "eyeballs larger than human anatomy").toEqual([]);
  });

  it(`(2) COUNTERWEIGHT: the corneal pole does not recede more than ${MAX_RECESSION_MM}mm`, () => {
    // Refuses (b): scaling about the eye's own centre pulls the forward-most point back 3.0-4.0mm and
    // gives hollow-eyed actors. Shrinking is only correct if the eye is re-seated forward.
    requireMeasured();
    const sunken = rows
      .filter((r) => r.eye.forwardZmm < (BASELINE[r.actor]?.forwardZmm ?? 0) - MAX_RECESSION_MM)
      .map(
        (r) =>
          `${r.actor}: forward-most z ${r.eye.forwardZmm.toFixed(2)}mm, was ${BASELINE[r.actor]?.forwardZmm}mm — the eye sank into the head`,
      );
    expect(sunken, "eyes shrunk without re-seating").toEqual([]);
  });

  it(`(3) COUNTERWEIGHT: the eye stays spherical (fit residual within ${MAX_RESIDUAL_GROWTH}x its own)`, () => {
    // Refuses (c): the fit reports a MEAN radius, so flattening along z while widening in x/y hits the
    // target diameter while destroying the shape. Floored against each actor's own measured residual.
    requireMeasured();
    const squashed = rows
      .filter((r) => r.eye.fitRmsMm > Math.max((BASELINE[r.actor]?.fitRmsMm ?? 0) * MAX_RESIDUAL_GROWTH, 0.05))
      .map(
        (r) =>
          `${r.actor}: sphere-fit RMS ${r.eye.fitRmsMm.toFixed(3)}mm, was ${BASELINE[r.actor]?.fitRmsMm}mm — the globe is no longer spherical`,
      );
    expect(squashed, "eyes deformed to hit the diameter").toEqual([]);
  });
});
