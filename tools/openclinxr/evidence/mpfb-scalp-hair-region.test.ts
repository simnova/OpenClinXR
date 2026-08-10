/**
 * #222 — the MPFB rail wears a hand-authored UV sphere for hair; the Anny rail paints a
 * scalp region onto the body surface with a proven geometric function.
 *
 * THE DEFECT, MEASURED (orchestrator, 2026-08-10, against apps/ui-xr/public/generated-humanoids/).
 * This block is IMMUTABLE. Flip the assertion and append a `## FIXED (#222)` block below;
 * do not rewrite these paths or numbers.
 *
 *   mpfb-ob-patient-aisha.glb
 *     mesh "Sphere"                     tris=960    mats=[mpfb_patient_hair_dark]   <-- hand-authored
 *     mesh "mpfb_ob_patient_aisha_body" tris=36972  prims=1  mats=[mpfb_skin_warm_ob_patient]
 *
 *   peds_nurse_kevin.glb  (KNOWN-GOOD COLUMN — the Anny rail)
 *     mesh "peds_nurse_kevin.anny_base" prims=4, one of which is
 *          openclinxr_mesh_native_scalp_hair_surface  tris=3480
 *          yRel=[0.897..1.000]  centroidYRel=0.929  zRange=[0.007..0.225]  (body zMax 0.415)
 *
 * `Sphere` is Blender's default primitive name. It is created at
 * tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py:40-45 by
 * `bpy.ops.mesh.primitive_uv_sphere_add(...)` parented to the body — hand-authored geometry,
 * which D1 forbids ("do not have workers hand-author bespoke geometry").
 *
 * The proven alternative already exists and is NOT topology-bound:
 * `apply_mesh_native_scalp_hair_material_region` at
 * tools/openclinxr/asset-pipeline/anny/automate_blender.py:4201 derives its region from mesh
 * BOUNDS and auto-detects the dominant height axis (:4231-4237). No vertex indices. It therefore
 * transfers to MPFB topology unchanged.
 *
 * WHY THE SAME PREDICATE RUNS OVER BOTH RAILS: the Anny cases below pass on main today and the
 * MPFB cases fail. A contract that is green on the known-good rail and red on the defect rail
 * cannot be vacuous, and it cannot be satisfied by weakening the predicate.
 */
/**
 * ## FIXED (#222)
 *
 * `materialize_mpfb_humanoid_candidate.py` no longer hand-authors a UV sphere. It imports the
 * proven `apply_mesh_native_scalp_hair_material_region` from the Anny rail
 * (`tools/openclinxr/asset-pipeline/anny/automate_blender.py:4201`) and paints the bounds-derived
 * scalp region onto the MPFB body. MPFB's Blender-local orientation is Z-up with the face at +Y,
 * while the function's Z-height branch expects the face at -Y, so the materializer feeds it a
 * temporary 180-deg Z flip of the mesh data (rigid rotation; geometry/rig/shape keys untouched)
 * and flips back after painting. Measured on the regenerated, re-promoted candidate: the body
 * carries a second primitive `openclinxr_mesh_native_scalp_hair_surface` (2612 tris), no separate
 * hair mesh remains, and the region passes both bounds below.
 */
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

const ANNY_KNOWN_GOOD = "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb";
const MPFB_SUBJECT = "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb";

const SCALP_HAIR_MATERIAL = /scalp_hair/i;
const ANY_HAIR_MATERIAL = /hair/i;

/**
 * A scalp sits on the crown. The head is roughly the top eighth of a standing body, so every
 * vertex of a scalp region belongs above 80% of body height. Derived from anatomy, not fitted:
 * the Anny region's LOWEST vertex is at 0.897, clearing this by 0.097 of body height (~17 cm).
 */
const SCALP_MIN_HEIGHT_FRACTION = 0.8;

/**
 * A scalp must stop behind the face. Expressed against the body's own anterior extent so it is
 * scale- and rail-independent. Anny measures 0.225/0.415 = 0.542 and clears with margin; a naive
 * "paint a cap over the whole head" reaches the face plane (~1.0) and fails. This is the
 * counterweight: it refuses the cheap re-implementation, not just the absence of a region.
 */
const SCALP_MAX_ANTERIOR_FRACTION = 0.75;

type Region = {
  triangles: number;
  minHeightFraction: number;
  maxHeightFraction: number;
  centroidHeightFraction: number;
  maxAnteriorFraction: number;
};

type Subject = {
  /** Meshes that are NOT the body but carry a hair material — the hand-authored-hair failure. */
  separateHairMeshes: string[];
  bodyMeshName: string;
  bodyPrimitiveCount: number;
  scalpRegion: Region | null;
};

async function readSubject(path: string): Promise<Subject> {
  const document = await new NodeIO().read(path);
  const meshes = document.getRoot().listMeshes();

  const triangleCount = (mesh: (typeof meshes)[number]): number =>
    mesh.listPrimitives().reduce((total, prim) => total + (prim.getIndices()?.getCount() ?? 0) / 3, 0);

  // The body is the largest mesh by triangle count — true on both rails and on any future rail.
  const body = [...meshes].sort((a, b) => triangleCount(b) - triangleCount(a))[0];
  if (!body) throw new Error(`${path}: no meshes`);

  const separateHairMeshes = meshes
    .filter((mesh) => mesh !== body)
    .filter((mesh) =>
      mesh.listPrimitives().some((prim) => ANY_HAIR_MATERIAL.test(prim.getMaterial()?.getName() ?? "")),
    )
    .map((mesh) => mesh.getName() || "<unnamed>");

  const primitives = body.listPrimitives();

  let bodyMin = [Infinity, Infinity, Infinity];
  let bodyMax = [-Infinity, -Infinity, -Infinity];
  for (const prim of primitives) {
    const position = prim.getAttribute("POSITION");
    if (!position) continue;
    for (let i = 0; i < position.getCount(); i += 1) {
      const v = [0, 0, 0];
      position.getElement(i, v);
      for (let axis = 0; axis < 3; axis += 1) {
        bodyMin[axis] = Math.min(bodyMin[axis], v[axis]);
        bodyMax[axis] = Math.max(bodyMax[axis], v[axis]);
      }
    }
  }
  const height = Math.max(bodyMax[1] - bodyMin[1], 1e-6);
  const anterior = Math.max(Math.abs(bodyMax[2]), 1e-6);

  const scalpPrimitive = primitives.find((prim) =>
    SCALP_HAIR_MATERIAL.test(prim.getMaterial()?.getName() ?? ""),
  );

  let scalpRegion: Region | null = null;
  if (scalpPrimitive) {
    const position = scalpPrimitive.getAttribute("POSITION");
    if (!position) throw new Error(`${path}: scalp primitive has no POSITION`);
    let minY = Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let sumY = 0;
    for (let i = 0; i < position.getCount(); i += 1) {
      const v = [0, 0, 0];
      position.getElement(i, v);
      minY = Math.min(minY, v[1]);
      maxY = Math.max(maxY, v[1]);
      maxZ = Math.max(maxZ, v[2]);
      sumY += v[1];
    }
    scalpRegion = {
      triangles: Math.round((scalpPrimitive.getIndices()?.getCount() ?? 0) / 3),
      minHeightFraction: (minY - bodyMin[1]) / height,
      maxHeightFraction: (maxY - bodyMin[1]) / height,
      centroidHeightFraction: (sumY / position.getCount() - bodyMin[1]) / height,
      maxAnteriorFraction: maxZ / anterior,
    };
  }

  return {
    separateHairMeshes,
    bodyMeshName: body.getName() || "<unnamed>",
    bodyPrimitiveCount: primitives.length,
    scalpRegion,
  };
}

describe("#222 scalp hair is a material region on the body, never a separate authored mesh", () => {
  it("Anny rail (KNOWN-GOOD) carries its scalp region on the body mesh", async () => {
    const subject = await readSubject(ANNY_KNOWN_GOOD);
    expect(subject.separateHairMeshes).toEqual([]);
    expect(subject.scalpRegion).not.toBeNull();
  });

  it("Anny rail (KNOWN-GOOD) scalp region sits on the crown and stops behind the face", async () => {
    const { scalpRegion } = await readSubject(ANNY_KNOWN_GOOD);
    expect(scalpRegion).not.toBeNull();
    expect(scalpRegion!.minHeightFraction).toBeGreaterThan(SCALP_MIN_HEIGHT_FRACTION);
    expect(scalpRegion!.maxAnteriorFraction).toBeLessThan(SCALP_MAX_ANTERIOR_FRACTION);
  });

  it("MPFB rail carries no separate hand-authored hair mesh", async () => {
    const subject = await readSubject(MPFB_SUBJECT);
    // Today: ["Sphere"] — a 960-triangle UV sphere from primitive_uv_sphere_add.
    expect(subject.separateHairMeshes).toEqual([]);
  });

  it("MPFB rail body mesh carries a scalp hair material region", async () => {
    const subject = await readSubject(MPFB_SUBJECT);
    // Today: prims=1 (skin only), scalpRegion=null.
    expect(subject.scalpRegion).not.toBeNull();
  });

  it("MPFB rail scalp region sits on the crown and stops behind the face", async () => {
    const { scalpRegion } = await readSubject(MPFB_SUBJECT);
    expect(scalpRegion).not.toBeNull();
    expect(scalpRegion!.minHeightFraction).toBeGreaterThan(SCALP_MIN_HEIGHT_FRACTION);
    expect(scalpRegion!.maxAnteriorFraction).toBeLessThan(SCALP_MAX_ANTERIOR_FRACTION);
  });
});
