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
/**
 * ## FIXED (#279)
 *
 * The hm08 body_param rail (the third consumer of the SAME predicate) shipped both library bodies
 * bald. `body_param_stage.py` now imports the same proven function from the Anny rail and paints
 * the bounds-derived scalp region onto each body class after the coverage gate, before the
 * armature bind. ORIENTATION (MEASURED, not assumed): the raw base.obj is MakeHuman Y-up with the
 * face at +Z; the stage's `wm.obj_import` path maps OBJ Y -> Blender Z and OBJ Z -> Blender -Y, so
 * the Blender-scene body is Z-up standing with the face at -Y — exactly what the function's
 * Z-height branch expects, so NO 180-deg Z flip is needed (unlike the MPFB create_human rail).
 * The exported Y-up GLBs confirm the face at +Z, matching the two known-good columns. The hm08
 * lean-female library body is added below as a third column with the UNCHANGED predicate; the
 * 0.80 height and 0.75 anterior thresholds are untouched.
 *
 * DEVIATION — hm08 heavy male, MEASURED 2026-08-10 (the orchestrator re-runs the proofs; this is
 * a dead-premise report per PROTO_VERIFY_DELEGATION §10s, not a narrowed contract):
 *
 *   body-param-adult_heavy_male-library.glb  scalp minHeightFraction=0.8974  (passes > 0.80)
 *                                            scalp maxAnteriorFraction=0.7827  (FAILS < 0.75)
 *
 * The scalp region is CORRECTLY PLACED: zero scalp vertices in the face band (0.82-0.93 height
 * at the front); the front-most scalp vertex is the forehead hairline at 0.943 of body height
 * (x≈0), exactly like the lean female. The bound fails because the contract's `anterior` is the
 * body's FRONT-MOST VERTEX — the hanging ARM at x≈±0.53, ~1 m height — and the heavy male's
 * weight-0.88 macro head is deep (nose z=0.318 m) while its arm front is only 0.396 m: the arm
 * protrudes just 1.24x past the nose, vs Anny 1.74x (0.541), MPFB 1.94x (0.516), hm08 lean 1.43x
 * (0.660). The proven function has no parameter that moves the crown-front depth, the threshold is
 * fixed by #279, and re-authoring the function is forbidden (D1). The heavy male's scalp is
 * therefore verified below on the three assertions it satisfies; the fourth (anterior) is left to
 * the orchestrator's decision (relax for the hm08 rail, adjust the heavy-male macro, or ship a
 * follow-up). NOT hidden: the numbers are in pre-fix.json and this header.
 */
/**
 * ## FIXED (#282)
 *
 * The 0.75 anterior bound (scalp.maxZ / body.maxZ) is REPLACED by a direct face-exclusion band,
 * not relaxed and not exempted per rail. The old ratio's denominator was the body's front-most
 * vertex — the hanging ARM on every shipped figure — so it moved with arm posture and body build
 * (heavy male 0.783 vs nose-relative correctness). The replacement asserts NO scalp vertex falls
 * inside the front mid-face band: heightFraction in [0.82, 0.93] of body height AND
 * z >= centerZ + 0.18 * bodyDepth (the Anny function's own face-band constants, Z-height branch:
 * automate_blender.py:4261-4273). Measured on the four shipped bodies: every scalp has ZERO band
 * vertices (heavy male included, previously 0.783 REFUSED); the unchanged 0.80 height bound still
 * refuses the three Anny decoy primitives under the full predicate (skin/arm/lower), and a
 * destructive-probe test below pins that counterweight. The 0.75 constant is removed; the 0.80
 * height bound and the 0.82/0.93 band range are untouched. Full measurements: pre-fix.json.
 */
/**
 * ## FIXED (#330)
 *
 * Two changes, both instrument-artifact repairs, neither weakening the predicate.
 * (a) The "body is the largest mesh" heuristic broke when #324's fitted footwear
 * (28,800 tris per shoe) exceeded the basemesh (26,756): the lean-female column then
 * picked a shoe as the body, reported the basemesh as a "separate hair mesh" (its
 * scalp primitive matches /hair/i) and the scalp region as "missing" — 3 pre-existing
 * reds on a correctly-painted body. The body is now the mesh that CARRIES the scalp
 * hair material region (the predicate's subject by definition), falling back to the
 * largest basemesh/body-named mesh. (b) The "no separate hair mesh" clause is scoped
 * to exclude the FITTED library hair mesh (`makeclothes_library_hair_*`): #330 fits a
 * real CC0 MakeClothes `.mhclo` through `ClothesService` — the OPPOSITE of the
 * hand-authored UV sphere D1 forbids — so it must not be counted as the old failure.
 * The painted scalp region and its crown/face-band bounds are unchanged and still
 * asserted on every column.
 */
import { Accessor, NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

const ANNY_KNOWN_GOOD = "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb";
const MPFB_SUBJECT = "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb";
/** #279 — third column: the two hm08 library bodies shipped by the body_param stage. */
const HM08_LEAN_SUBJECT =
  "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb";
const HM08_HEAVY_SUBJECT =
  "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_heavy_male-library.glb";

const SCALP_HAIR_MATERIAL = /scalp_hair/i;
const ANY_HAIR_MATERIAL = /hair/i;
/** #330 — the fitted library hair mesh is a D1-fitted .mhclo, the OPPOSITE of the
 * hand-authored sphere this contract refuses. Excluded by mesh-name prefix so the
 * "no separate hand-authored hair mesh" intent survives contact with real hair. */
const FITTED_LIBRARY_HAIR_MESH = /^makeclothes_library_hair/i;

/**
 * A scalp sits on the crown. The head is roughly the top eighth of a standing body, so every
 * vertex of a scalp region belongs above 80% of body height. Derived from anatomy, not fitted:
 * the Anny region's LOWEST vertex is at 0.897, clearing this by 0.097 of body height (~17 cm).
 */
const SCALP_MIN_HEIGHT_FRACTION = 0.8;

/**
 * A scalp must stop behind the face. Face-exclusion band, measured DIRECTLY (issue-282 replaces
 * the 0.75 anterior RATIO, whose denominator was the hanging arm). A scalp vertex is inside the
 * front mid-face band when its height fraction lies in [0.82, 0.93] AND its anterior (z) is at or
 * beyond the body's front-32% depth line. Both constants are the Anny function's own face band
 * (`apply_mesh_native_scalp_hair_material_region`, automate_blender.py:4261-4273): the height
 * range is face_band_lo/hi and the depth line is the Z-height branch's
 * `face_front_d = center_d - depth_d * 0.18`. A naive "paint a cap over the whole head" reaches
 * the face band and fails; every correctly-placed shipped scalp has ZERO vertices in it.
 */
const SCALP_FACE_BAND_HEIGHT_LO = 0.82;
const SCALP_FACE_BAND_HEIGHT_HI = 0.93;
const SCALP_FACE_FRONT_DEPTH_FRACTION = 0.18;

type Region = {
  triangles: number;
  minHeightFraction: number;
  maxHeightFraction: number;
  centroidHeightFraction: number;
  /** Diagnostic only, not asserted: scalp.maxZ / body.maxZ (the #279-era proxy, issue-282 replaced it). */
  maxAnteriorFraction: number;
  /** The direct face-exclusion counterweight: number of scalp vertices inside the front mid-face band. */
  faceBandVertexCount: number;
};

/**
 * Number of vertices inside the front mid-face band:
 * heightFraction in [0.82, 0.93] of body height AND z >= frontZ (the body's front-32% depth line).
 * GLB Y-up, face at +Z on every shipped rail (verified in #279 orientation determination).
 */
function faceBandVertexCountFor(
  position: Accessor,
  bodyMin: number[],
  height: number,
  frontZ: number,
): number {
  let count = 0;
  for (let i = 0; i < position.getCount(); i += 1) {
    const v = [0, 0, 0];
    position.getElement(i, v);
    const heightFraction = (v[1] - bodyMin[1]) / height;
    if (
      heightFraction >= SCALP_FACE_BAND_HEIGHT_LO &&
      heightFraction <= SCALP_FACE_BAND_HEIGHT_HI &&
      v[2] >= frontZ
    ) {
      count += 1;
    }
  }
  return count;
}

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

  // The body is the mesh that carries the scalp hair material region (the #222/#279
  // predicate's subject), else the largest basemesh/body-named mesh. NOT "largest by
  // triangle count" alone: #324's fitted footwear (28,800 tris per shoe) exceeds the
  // basemesh (26,756), so the old heuristic picked a shoe and reported the basemesh
  // as a "separate hair mesh" (its scalp primitive matches /hair/i) with the scalp
  // region then "missing" from the wrong body — an instrument artifact, not a
  // product regression (#330). The scalp-region-carrying mesh is the body by
  // definition; the name fallback covers rails without a scalp primitive yet.
  const body =
    meshes.filter((m) =>
      m.listPrimitives().some((p) => SCALP_HAIR_MATERIAL.test(p.getMaterial()?.getName() ?? "")),
    )[0] ??
    [...meshes]
      .filter((m) => /basemesh|body/i.test(m.getName() ?? ""))
      .sort((a, b) => triangleCount(b) - triangleCount(a))[0] ??
    [...meshes].sort((a, b) => triangleCount(b) - triangleCount(a))[0];
  if (!body) throw new Error(`${path}: no meshes`);

  const separateHairMeshes = meshes
    .filter((mesh) => mesh !== body)
    .filter((mesh) => !FITTED_LIBRARY_HAIR_MESH.test(mesh.getName() ?? ""))
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
  // Front mid-face band depth line: the body's front-32% of depth (function's Z-height branch).
  const depth = Math.max(bodyMax[2] - bodyMin[2], 1e-6);
  const faceBandFrontZ = (bodyMin[2] + bodyMax[2]) / 2 + SCALP_FACE_FRONT_DEPTH_FRACTION * depth;

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
      faceBandVertexCount: faceBandVertexCountFor(position, bodyMin, height, faceBandFrontZ),
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
    expect(scalpRegion!.faceBandVertexCount).toBe(0);
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
    expect(scalpRegion!.faceBandVertexCount).toBe(0);
  });

  // #279 — third column: the hm08 library bodies, same predicate, unchanged thresholds.
  function scalpContractFor(subject: string, label: string): void {
    it(`${label} carries no separate hair mesh`, async () => {
      const subject_ = await readSubject(subject);
      expect(subject_.separateHairMeshes).toEqual([]);
    });

    it(`${label} body mesh carries a scalp hair material region`, async () => {
      const subject_ = await readSubject(subject);
      expect(subject_.scalpRegion).not.toBeNull();
    });

    it(`${label} scalp region sits on the crown and stops behind the face`, async () => {
      const { scalpRegion } = await readSubject(subject);
      expect(scalpRegion).not.toBeNull();
      expect(scalpRegion!.minHeightFraction).toBeGreaterThan(SCALP_MIN_HEIGHT_FRACTION);
      expect(scalpRegion!.faceBandVertexCount).toBe(0);
    });
  }

  scalpContractFor(HM08_LEAN_SUBJECT, "hm08 rail body-param-adult_lean_female (library)");

  // #282: the heavy male now runs the SAME three assertions as every other column. Its scalp is
  // correctly placed (zero face-band vertices) and the direct face-exclusion bound no longer
  // divides by the hanging arm, so the previous 0.7827 anterior dead-premise is resolved.
  scalpContractFor(HM08_HEAVY_SUBJECT, "hm08 rail body-param-adult_heavy_male (library)");

  // Destructive probe (issue-282 counterweight): applying the full predicate — unchanged 0.80
  // height bound AND zero face-band vertices — to every primitive of peds_nurse_kevin.anny_base,
  // only the real scalp primitive may pass. The old 0.75 ratio refused these same three decoys;
  // the replacement must refuse them too, or it is weaker than what it replaces.
  it("Anny decoy probe: only the scalp primitive passes the full predicate (height + face band)", async () => {
    const document = await new NodeIO().read(ANNY_KNOWN_GOOD);
    const meshes = document.getRoot().listMeshes();
    const triangleCount = (mesh: (typeof meshes)[number]): number =>
      mesh.listPrimitives().reduce((total, prim) => total + (prim.getIndices()?.getCount() ?? 0) / 3, 0);
    const body = [...meshes].sort((a, b) => triangleCount(b) - triangleCount(a))[0];
    if (!body) throw new Error(`${ANNY_KNOWN_GOOD}: no meshes`);

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
    const depth = Math.max(bodyMax[2] - bodyMin[2], 1e-6);
    const faceBandFrontZ = (bodyMin[2] + bodyMax[2]) / 2 + SCALP_FACE_FRONT_DEPTH_FRACTION * depth;

    const verdicts = primitives
      .filter((prim) => prim.getAttribute("POSITION"))
      .map((prim) => {
        const position = prim.getAttribute("POSITION")!;
        let minY = Infinity;
        for (let i = 0; i < position.getCount(); i += 1) {
          const v = [0, 0, 0];
          position.getElement(i, v);
          minY = Math.min(minY, v[1]);
        }
        const minHeightFraction = (minY - bodyMin[1]) / height;
        const faceBandVertexCount = faceBandVertexCountFor(position, bodyMin, height, faceBandFrontZ);
        const passes = minHeightFraction > SCALP_MIN_HEIGHT_FRACTION && faceBandVertexCount === 0;
        return {
          material: prim.getMaterial()?.getName() ?? "<none>",
          isScalpHair: SCALP_HAIR_MATERIAL.test(prim.getMaterial()?.getName() ?? ""),
          minHeightFraction,
          faceBandVertexCount,
          passes,
        };
      });

    const passing = verdicts.filter((v) => v.passes);
    expect(passing).toHaveLength(1);
    expect(passing[0]!.isScalpHair).toBe(true);
    expect(passing[0]!.material).toMatch(/scalp_hair/i);
  });
});
