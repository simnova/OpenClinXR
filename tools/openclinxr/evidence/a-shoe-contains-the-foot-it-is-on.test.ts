import { readFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: a shipped humanoid's shoe contains the foot it is on.
 *
 * MEASURED 2026-08-25, do not re-derive. Fraction of body vertices below 6% of stature (the foot)
 * lying outside the footwear mesh's world AABB:
 *
 *   rail       asset                        foot verts  outside  frac    shoe tris
 *   GENERATED  peds_fever_patient_child           2166      818  0.378          56
 *   GENERATED  peds_nurse_kevin                   2162        0  0.000          56
 *   LIBRARY    mpfb-peds-patient-child            3132       80  0.026        1338
 *   LIBRARY    mpfb-peds-parent-aisha             3220      118  0.037        1338
 *
 * I graded the child's feet by eye as "faceted blue polyhedra with bare toes protruding", in both the
 * lit and structure passes, and again after a re-bake. **37.8% of its foot is outside its own shoe.**
 *
 * A CLAIM OF MINE DIES HERE, and it is why this contract is shaped the way it is. Seeing a 42-vertex
 * / 56-triangle generated shell against library footwear at 1004-57600 triangles, I inferred the blob
 * was too coarse to enclose a foot. **`peds_nurse_kevin` has the identical 56-triangle shell and
 * contains its foot completely - 0 vertices outside.** Mesh complexity is not the defect. Fit on this
 * actor is. Had I planted the inference, a worker would have been sent to subdivide a shell that works
 * fine elsewhere.
 *
 * KNOWN-GOOD COLUMN - clause (2): `peds_nurse_kevin`, same rail, same generator, same 56 triangles,
 * 0.000. It refuses "a generated shell cannot do this" and it refuses a fix that swaps the rail.
 *
 * COUNTERWEIGHT - clause (3): the shoe may not simply be inflated until it swallows the leg. Its own
 * bounding height must stay under a third of the foot-to-knee span, so "contains the foot" cannot be
 * bought by growing a boot up the shin.
 *
 * THRESHOLD IS DERIVED: the library rail measures 0.026 and 0.037, so 0.05 sits just above the worst
 * observed library value and 7.5x below the child. Not fitted to either side.
 *
 * FAILED TREATMENT, do not repeat: swapping this actor to a MakeClothes library shoe. It fixes one
 * asset and leaves the generator mis-fitting every future case - the same shape #656 refused for
 * garments. The GENERATOR must place and scale the shell correctly.
 *
 * claimScope: whether foot vertices fall outside the footwear AABB, on the four named assets.
 * notEvidenceFor: how any shoe looks; whether the shell is the right SHAPE for a shoe; the hands,
 *   hair and face defects graded on the same asset; any actor not named here.
 */

const HUMANOIDS = "apps/ui-xr/public/generated-humanoids";
/** Just above the worst library value (0.037); 7.5x below the child's measured 0.378. */
const MAX_FOOT_OUTSIDE_FRACTION = 0.05;
/** Below this fraction of stature counts as foot rather than ankle. */
const FOOT_BAND = 0.06;

interface FootFit { readonly footVertices: number; readonly outside: number; readonly fraction: number; readonly shoeHeight: number; readonly footToKnee: number }

async function footFit(basename: string): Promise<FootFit> {
  const doc = await new NodeIO().readBinary(readFileSync(`${HUMANOIDS}/${basename}`));
  const shoe: number[][] = []; const body: number[][] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName().toLowerCase();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION"); if (!pos) continue;
      const arr = pos.getArray() as ArrayLike<number>;
      const target = /footwear|shoe|boot|slipper/u.test(name) ? shoe
        : (prim.getAttribute("JOINTS_0") && /_body|anny_base|base/u.test(name) ? body : null);
      if (!target) continue;
      for (let i = 0; i < arr.length; i += 3) target.push([arr[i]!, arr[i + 1]!, arr[i + 2]!]);
    }
  }
  if (shoe.length === 0) throw new Error(`no footwear mesh in ${basename}`);
  if (body.length === 0) throw new Error(`no skinned body mesh in ${basename}`);
  const ys = body.map((v) => v[1]!);
  const lo = Math.min(...ys); const hi = Math.max(...ys);
  const foot = body.filter((v) => v[1]! < lo + FOOT_BAND * (hi - lo));
  const smin = [0, 1, 2].map((a) => Math.min(...shoe.map((v) => v[a]!)));
  const smax = [0, 1, 2].map((a) => Math.max(...shoe.map((v) => v[a]!)));
  const outside = foot.filter((v) => [0, 1, 2].some((a) => v[a]! < smin[a]! - 1e-4 || v[a]! > smax[a]! + 1e-4));
  return {
    footVertices: foot.length, outside: outside.length,
    fraction: foot.length === 0 ? 0 : outside.length / foot.length,
    shoeHeight: smax[1]! - smin[1]!,
    footToKnee: (hi - lo) * 0.28,
  };
}

describe("a shoe contains the foot it is on", () => {
  it.fails("(1) the child's foot is inside its own shoe", async () => {
    const f = await footFit("peds_fever_patient_child.glb");
    expect(
      f.fraction,
      `${f.outside} of ${f.footVertices} foot vertices sit outside the shoe volume. The toes protrude `
      + "clear of the shell in the lit pass, the structure pass, and after a re-bake",
    ).toBeLessThanOrEqual(MAX_FOOT_OUTSIDE_FRACTION);
  }, 120_000);

  it("(2) KNOWN-GOOD COLUMN: the same generator's shell contains a foot elsewhere", async () => {
    // Same rail, same generator, same 56 triangles, measured 0.000. This refuses both "a generated
    // shell is too coarse to do this" and any fix that reaches clause (1) by swapping to the library.
    const kevin = await footFit("peds_nurse_kevin.glb");
    expect(kevin.fraction, "peds_nurse_kevin measured 0.000 when this was planted")
      .toBeLessThanOrEqual(MAX_FOOT_OUTSIDE_FRACTION);
  }, 120_000);

  it("(3) COUNTERWEIGHT: the shoe is not inflated up the leg to swallow the foot", async () => {
    // "Contains the foot" is trivially bought by growing a boot to the knee. Bound the shell's own
    // height against the subject's own leg so the fix has to be placement and scale, not inflation.
    for (const asset of ["peds_fever_patient_child.glb", "peds_nurse_kevin.glb"]) {
      const f = await footFit(asset);
      expect(f.shoeHeight, `${asset} shoe is taller than a third of its own foot-to-knee span`)
        .toBeLessThan(f.footToKnee);
    }
  }, 120_000);

  it("(4) VACUITY GUARD: the reader finds real feet and separates the two assets today", async () => {
    // Without this, clause (1) passes on a reader that selects no foot vertices at all.
    const child = await footFit("peds_fever_patient_child.glb");
    const kevin = await footFit("peds_nurse_kevin.glb");
    expect(child.footVertices, "the foot band must select real geometry").toBeGreaterThan(500);
    expect(kevin.footVertices, "the foot band must select real geometry").toBeGreaterThan(500);
    expect(child.fraction - kevin.fraction, "the two assets measured 0.378 apart when this was planted")
      .toBeGreaterThan(0.1);
  }, 120_000);
});
