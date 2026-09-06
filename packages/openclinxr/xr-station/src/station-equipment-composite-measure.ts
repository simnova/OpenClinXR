/**
 * #260 — parametric composite measurement bridge.
 *
 * The evidence harness (tools/) must not import `three` directly (it does not
 * resolve outside apps/), yet the #260 contracts need the parametric composite's
 * AABB — the "vertical envelope" the floor placement descriptor was authored
 * against — to verify a gltf-sourced mount preserves the composite's working
 * height. This module builds the composite via the runtime's own builders and
 * returns a plain-JSON measurement any consumer can read.
 *
 * claimScope: geometry emitted by the parametric builders for an equipment id.
 * notEvidenceFor: clinical realism, Quest readiness, pixel grading.
 */

import { Box3, type Group, Mesh } from "three";
import { buildDeclaredEquipmentGeometry } from "./station-equipment-builders.js";

export type Vec3 = { x: number; y: number; z: number };
export type ParametricMeshMeasure = {
  name: string;
  aabbMin: Vec3;
  aabbMax: Vec3;
  triangles: number;
};
export type ParametricCompositeMeasure = {
  equipmentId: string;
  /**
   * The composite's own source tag: "parametric" when the id has a DEDICATED
   * builder arm (buildDeclaredEquipmentGeometry case), "fallback" for ids that
   * only get the generic cart. #260's vertical-envelope rule applies to
   * composite parametric kinds, not fallback-only ids.
   */
  source: "parametric" | "fallback" | "gltf";
  meshCount: number;
  triangleCount: number;
  totalAabbMin: Vec3;
  totalAabbMax: Vec3;
  meshes: ParametricMeshMeasure[];
};

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function triangleCountOf(mesh: Mesh): number {
  const geometry = mesh.geometry;
  if (!geometry) return 0;
  const index = geometry.index;
  const position = geometry.getAttribute("position");
  if (index && typeof index.count === "number") return Math.floor(index.count / 3);
  if (position && typeof position.count === "number") return Math.floor(position.count / 3);
  return 0;
}

/**
 * Build the parametric composite for `equipmentId` exactly as the runtime mounts
 * it (buildDeclaredEquipmentGeometry) and measure its local AABB: total bounds,
 * per-mesh bounds (after updateMatrixWorld, so builder-applied transforms count),
 * and triangle counts. Plain JSON — no three objects escape this module.
 */
export function measureParametricComposite(equipmentId: string): ParametricCompositeMeasure {
  const root = buildDeclaredEquipmentGeometry(equipmentId) as Group;
  root.updateMatrixWorld(true);
  const total = new Box3().setFromObject(root);
  const meshes: ParametricMeshMeasure[] = [];
  let triangleCount = 0;
  root.traverse((object) => {
    if (!(object instanceof Mesh) || !object.geometry) return;
    const box = new Box3().setFromObject(object);
    const triangles = triangleCountOf(object);
    triangleCount += triangles;
    meshes.push({
      name: object.name || "unnamed",
      aabbMin: { x: round3(box.min.x), y: round3(box.min.y), z: round3(box.min.z) },
      aabbMax: { x: round3(box.max.x), y: round3(box.max.y), z: round3(box.max.z) },
      triangles,
    });
  });
  return {
    equipmentId,
    source:
      root.userData.openClinXrEquipmentSource === "parametric"
        ? "parametric"
        : root.userData.openClinXrEquipmentSource === "gltf"
          ? "gltf"
          : "fallback",
    meshCount: meshes.length,
    triangleCount,
    totalAabbMin: { x: round3(total.min.x), y: round3(total.min.y), z: round3(total.min.z) },
    totalAabbMax: { x: round3(total.max.x), y: round3(total.max.y), z: round3(total.max.z) },
    meshes,
  };
}
