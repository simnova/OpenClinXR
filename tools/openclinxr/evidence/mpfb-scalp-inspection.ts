/**
 * MPFB scalp region inspection (#359) — the first-measurement instrument for "port the scalp
 * material region to the MPFB rail".
 *
 * factory_step: instrument. Measures, per shipped actor (Anny known-good + the three MPFB cast
 * actors), the scalp/hair material region's file-side identity on the body mesh:
 *
 *   - scalp material name (on the body mesh) and whether the region is a material assignment
 *     within the body mesh (a second primitive) or a separate hand-authored mesh,
 *   - triangle count, height band (min/max height fraction of body stature), centroid fraction,
 *     face-band vertex count (the #282 direct face-exclusion counterweight),
 *   - base colour (baseColorFactor of the scalp material, when present).
 *
 * It also records what the Anny generator keys off — read from
 * `tools/openclinxr/asset-pipeline/anny/automate_blender.py` `apply_mesh_native_scalp_hair_material_region`
 * (a height-fraction + depth-fraction rule over polygon centers in LOCAL mesh space, auto-detected
 * dominant height axis; no vertex groups, no UV islands) — the column that decides whether the
 * rule ports to MPFB topology.
 *
 * The measurement reuses the same predicate as `mpfb-scalp-hair-region.test.ts` (same
 * body-identification, same face-band geometry) so the pre-fix column and the contract speak the
 * same instrument.
 *
 * claimScope: deterministic file-side region identity + placement properties of the SHIPPED bytes,
 * and the generator-mechanism record read from the tracked Anny source. notEvidenceFor: how hair
 * renders in a crop (pixel grade), clinical realism, which hairline "looks right".
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Accessor, NodeIO } from "@gltf-transform/core";

export const MPFB_SCALP_EVIDENCE_ROOT = ".openclinxr/evidence/mpfb-scalp";

const ANNY_KNOWN_GOOD = "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb";

const MPFB_ACTORS = [
  {
    id: "aisha",
    role: "adult_female",
    actorRole: "parent",
    glb: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
  },
  {
    id: "kevin",
    role: "adult_male",
    actorRole: "nurse",
    glb: "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb",
  },
  {
    id: "child",
    role: "child",
    actorRole: "patient",
    glb: "apps/ui-xr/public/generated-humanoids/mpfb-peds-patient-child.glb",
  },
] as const;

const SCALP_HAIR_MATERIAL = /scalp_hair/i;
const FITTED_LIBRARY_HAIR_MESH = /^makeclothes_library_hair/i;

/**
 * The face-band geometry is the contract's own (#282): a scalp vertex is inside the front mid-face
 * band when heightFraction in [0.82, 0.93] of body height AND z >= the body's front-32% depth line.
 * GLB Y-up, face at +Z on every shipped rail (verified in the #279 orientation determination).
 */
const SCALP_FACE_BAND_HEIGHT_LO = 0.82;
const SCALP_FACE_BAND_HEIGHT_HI = 0.93;
const SCALP_FACE_FRONT_DEPTH_FRACTION = 0.18;

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

type ScalpReport = {
  actorId: string;
  rail: "anny_known_good" | "mpfb";
  glb: string;
  /** Material assignment within the body mesh vs a separate hand-authored mesh vs absent. */
  regionKind: "body_mesh_material_primitive" | "separate_mesh" | "none";
  scalpMaterialName: string | null;
  bodyMeshName: string | null;
  bodyPrimitiveCount: number | null;
  triangles: number | null;
  minHeightFraction: number | null;
  maxHeightFraction: number | null;
  centroidHeightFraction: number | null;
  faceBandVertexCount: number | null;
  baseColorFactor: [number, number, number] | null;
  separateHairMeshes: string[];
};

async function measureActor(actorId: string, rail: "anny_known_good" | "mpfb", glb: string): Promise<ScalpReport> {
  const document = await new NodeIO().read(glb);
  const meshes = document.getRoot().listMeshes();

  const triangleCount = (mesh: (typeof meshes)[number]): number =>
    mesh.listPrimitives().reduce((total, prim) => total + (prim.getIndices()?.getCount() ?? 0) / 3, 0);

  // The contract's own body identification (#330): the mesh that carries the scalp hair material
  // region is the body by definition; fall back to the largest basemesh/body-named mesh.
  const body =
    meshes.filter((m) =>
      m.listPrimitives().some((p) => SCALP_HAIR_MATERIAL.test(p.getMaterial()?.getName() ?? "")),
    )[0] ??
    [...meshes]
      .filter((m) => /basemesh|body/i.test(m.getName() ?? ""))
      .sort((a, b) => triangleCount(b) - triangleCount(a))[0] ??
    [...meshes].sort((a, b) => triangleCount(b) - triangleCount(a))[0];

  if (!body) {
    return {
      actorId, rail, glb,
      regionKind: "none",
      scalpMaterialName: null,
      bodyMeshName: null,
      bodyPrimitiveCount: null,
      triangles: null,
      minHeightFraction: null,
      maxHeightFraction: null,
      centroidHeightFraction: null,
      faceBandVertexCount: null,
      baseColorFactor: null,
      separateHairMeshes: [],
    };
  }

  const separateHairMeshes = meshes
    .filter((mesh) => mesh !== body)
    .filter((mesh) => !FITTED_LIBRARY_HAIR_MESH.test(mesh.getName() ?? ""))
    .filter((mesh) =>
      mesh.listPrimitives().some((prim) => /hair/i.test(prim.getMaterial()?.getName() ?? "")),
    )
    .map((mesh) => mesh.getName() || "<unnamed>");

  const primitives = body.listPrimitives();

  const bodyMin = [Infinity, Infinity, Infinity];
  const bodyMax = [-Infinity, -Infinity, -Infinity];
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

  const scalpPrimitive = primitives.find((prim) =>
    SCALP_HAIR_MATERIAL.test(prim.getMaterial()?.getName() ?? ""),
  );

  if (!scalpPrimitive) {
    return {
      actorId, rail, glb,
      regionKind: "none",
      scalpMaterialName: null,
      bodyMeshName: body.getName() || "<unnamed>",
      bodyPrimitiveCount: primitives.length,
      triangles: null,
      minHeightFraction: null,
      maxHeightFraction: null,
      centroidHeightFraction: null,
      faceBandVertexCount: null,
      baseColorFactor: null,
      separateHairMeshes,
    };
  }

  const position = scalpPrimitive.getAttribute("POSITION");
  if (!position) throw new Error(`${glb}: scalp primitive has no POSITION`);
  let minY = Infinity;
  let maxY = -Infinity;
  let sumY = 0;
  for (let i = 0; i < position.getCount(); i += 1) {
    const v = [0, 0, 0];
    position.getElement(i, v);
    minY = Math.min(minY, v[1]);
    maxY = Math.max(maxY, v[1]);
    sumY += v[1];
  }

  const material = scalpPrimitive.getMaterial();
  const baseColorFactor = material
    ? ([...material.getBaseColorFactor()].slice(0, 3) as [number, number, number])
    : null;

  return {
    actorId, rail, glb,
    regionKind: "body_mesh_material_primitive",
    scalpMaterialName: material?.getName() ?? null,
    bodyMeshName: body.getName() || "<unnamed>",
    bodyPrimitiveCount: primitives.length,
    triangles: Math.round((scalpPrimitive.getIndices()?.getCount() ?? 0) / 3),
    minHeightFraction: (minY - bodyMin[1]) / height,
    maxHeightFraction: (maxY - bodyMin[1]) / height,
    centroidHeightFraction: (sumY / position.getCount() - bodyMin[1]) / height,
    faceBandVertexCount: faceBandVertexCountFor(position, bodyMin, height, faceBandFrontZ),
    baseColorFactor,
    separateHairMeshes,
  };
}

/**
 * What the Anny generator keys off — read from
 * tools/openclinxr/asset-pipeline/anny/automate_blender.py:4246
 * `apply_mesh_native_scalp_hair_material_region` (and the #73 Z-height branch at :4289-4318).
 * Recorded here so the pre-fix column decides the port: the rule is fully mesh-bounds-relative,
 * so it transfers to MPFB topology unchanged (already proven by the hm08 rail, #279).
 */
const ANNY_GENERATOR_MECHANISM = {
  function: "tools/openclinxr/asset-pipeline/anny/automate_blender.py:4246 apply_mesh_native_scalp_hair_material_region",
  keysOff: {
    meshBounds: "local-space vertex bounds (min/max per axis) of the body mesh — the region is defined by fractions of the body's own height/width/depth, not by vertex indices",
    heightAxis: "auto-detected dominant height axis (Y when maxY-minY >= 0.9*(maxZ-minZ), else Z) — #73: OBJ import can rotate the object, world-space height is untrustworthy",
    polygonCenters: "each polygon's local-space center classifies the polygon (material assignment is per-polygon)",
    scalpMinH: "min_h + height * (0.905 - hair_density * 0.008) — hairline sits on the crown",
    crownMinH: "min_h + height * 0.935",
    maxScalpHalfWidth: "width * (0.16 + hair_density * 0.018)",
    faceBand: "heightFraction in [0.82, 0.93] AND face-front depth >= center_d - depth*0.18 (Z-height branch) — hard exclude, never hair on the nose/mouth/forehead band",
    depthFaceDetection: "face-front vs back by depth-relative line (center_d +/- depth*0.02/0.18), not by UV or vertex groups",
    vertexGroups: "none — no Anny-specific vertex groups are consulted",
    uvRegions: "none — no UV island selection",
    phenotype: "hair_color (-> base colour table) and hair_density (0..1, scales the crown/width fractions) only",
  },
  conclusion: "selects polygons by body-relative height/geometry rules over polygon centers in local mesh space; no Anny-specific vertex groups or UV islands — ports to MPFB topology directly (D1: port the rule; the code is already shared, not re-authored)",
};

export async function writeMpfbScalpPreFix(cwd = process.cwd(), outName = "pre-fix.json"): Promise<unknown> {
  const knownGood = await measureActor("peds_nurse_kevin", "anny_known_good", ANNY_KNOWN_GOOD);
  const mpfbActors: ScalpReport[] = [];
  for (const actor of MPFB_ACTORS) {
    mpfbActors.push(await measureActor(actor.id, "mpfb", actor.glb));
  }

  const preFix = {
    issue: 359,
    measuredAt: new Date().toISOString(),
    instrument: "tools/openclinxr/evidence/mpfb-scalp-inspection.ts",
    knownGoodAnny: knownGood,
    mpfbActors,
    annyGeneratorMechanism: ANNY_GENERATOR_MECHANISM,
    claimScope: [
      "deterministic_file_side_scalp_region_identity_and_placement_on_the_shipped_bytes",
      "generator_mechanism_record_read_from_the_tracked_anny_source",
    ],
    notEvidenceFor: ["how hair renders in a crop (pixel grade)", "clinical realism", "which hairline looks right"],
  };

  const outDir = path.join(cwd, MPFB_SCALP_EVIDENCE_ROOT);
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, outName);
  writeFileSync(outPath, `${JSON.stringify(preFix, null, 2)}\n`, "utf8");
  return preFix;
}

const isMain = Boolean(
  process.argv[1]
  && (import.meta.url === `file://${path.resolve(process.argv[1])}`
    || import.meta.url.endsWith(process.argv[1]!.replaceAll("\\", "/"))),
);

if (isMain) {
  const outName = process.argv.includes("--post") ? "post-fix.json" : "pre-fix.json";
  writeMpfbScalpPreFix(process.cwd(), outName)
    .then((preFix: any) => {
      const summary = {
        path: path.join(MPFB_SCALP_EVIDENCE_ROOT, "pre-fix.json"),
        rows: [preFix.knownGoodAnny, ...preFix.mpfbActors].map((r: ScalpReport) => ({
          actorId: r.actorId,
          rail: r.rail,
          regionKind: r.regionKind,
          scalpMaterialName: r.scalpMaterialName,
          triangles: r.triangles,
          heightBand: r.minHeightFraction === null || r.maxHeightFraction === null
            ? null
            : [Number(r.minHeightFraction.toFixed(4)), Number(r.maxHeightFraction.toFixed(4))],
          faceBandVertexCount: r.faceBandVertexCount,
          baseColorFactor: r.baseColorFactor,
          separateHairMeshes: r.separateHairMeshes,
        })),
        generatorConclusion: preFix.annyGeneratorMechanism.conclusion,
      };
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
