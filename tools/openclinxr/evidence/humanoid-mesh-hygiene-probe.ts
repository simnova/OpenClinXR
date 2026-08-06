/**
 * Humanoid mesh hygiene probe (#60).
 *
 * Reads actual glTF mesh content (via @gltf-transform) — not Blender's import
 * view. That distinction matters: Blender's glTF importer creates a default
 * radius-1 Icosphere (42 verts) as a bone display shape in collection
 * `glTF_not_exported` (io_scene_gltf2/blender/imp/node.py armature_display).
 * That object is an import-side helper, not shipped geometry.
 *
 * These contracts still matter: if a scratch primitive ever *does* land in a
 * shipped GLB (export leak, incomplete clear_scene, bake cage left linked to
 * Scene Collection), both the Blender-default name denylist and the oversized-
 * vs-body size check must fire. Either alone is gameable.
 *
 * claimScope: local_mesh_hygiene_instrument_not_visual_realism
 * notEvidenceFor: production_readiness, clinical_validity, scoring, Quest
 */

import { NodeIO } from "@gltf-transform/core";

export type MeshInfo = {
  name: string;
  vertexCount: number;
  /** Max axis-aligned extent of POSITION attribute bounds (local mesh space). */
  extent: number;
  dims: [number, number, number];
};

export type InspectHumanoidMeshHygieneInput = {
  glbPath: string;
};

export type InspectHumanoidMeshHygieneResult = {
  glbPath: string;
  meshes: MeshInfo[];
  violations: string[];
};

/** Blender default mesh object names (with optional .001 suffix). */
const BLENDER_DEFAULT_MESH_NAME =
  /^(Icosphere|Sphere|Cube|Plane|Cylinder|Cone|Torus|Circle)(\.\d+)?$/u;

/**
 * Inspect a shipped humanoid GLB for scratch / default-primitive geometry.
 *
 * `violations` lists machine-readable codes; the #60 contracts assert on mesh
 * names and extents directly rather than this list.
 */
export async function inspectHumanoidMeshHygiene(
  input: InspectHumanoidMeshHygieneInput,
): Promise<InspectHumanoidMeshHygieneResult> {
  const { glbPath } = input;
  const document = await new NodeIO().read(glbPath);
  const root = document.getRoot();
  const meshes: MeshInfo[] = [];

  for (const mesh of root.listMeshes()) {
    let vertexCount = 0;
    let min: [number, number, number] = [Infinity, Infinity, Infinity];
    let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    let hasPos = false;

    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      if (!arr) continue;
      vertexCount += pos.getCount();
      for (let i = 0; i + 2 < arr.length; i += 3) {
        const px = Number(arr[i]);
        const py = Number(arr[i + 1]);
        const pz = Number(arr[i + 2]);
        hasPos = true;
        min[0] = Math.min(min[0], px);
        min[1] = Math.min(min[1], py);
        min[2] = Math.min(min[2], pz);
        max[0] = Math.max(max[0], px);
        max[1] = Math.max(max[1], py);
        max[2] = Math.max(max[2], pz);
      }
    }

    const dims: [number, number, number] = hasPos
      ? [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
      : [0, 0, 0];
    const extent = hasPos ? Math.max(dims[0], dims[1], dims[2]) : 0;
    meshes.push({
      name: mesh.getName() || `mesh_${meshes.length}`,
      vertexCount,
      extent,
      dims,
    });
  }

  const violations: string[] = [];
  for (const m of meshes) {
    if (BLENDER_DEFAULT_MESH_NAME.test(m.name)) {
      violations.push(`blender_default_primitive_name:${m.name}`);
    }
  }

  if (meshes.length > 0) {
    const body = meshes.reduce((a, b) => (b.vertexCount > a.vertexCount ? b : a), meshes[0]!);
    for (const m of meshes) {
      if (m.name === body.name) continue;
      if (m.extent >= body.extent * 1.5) {
        violations.push(
          `oversized_mesh_vs_body:${m.name}:extent=${m.extent.toFixed(3)}:body=${body.name}:bodyExtent=${body.extent.toFixed(3)}`,
        );
      }
    }
  }

  return { glbPath, meshes, violations };
}
