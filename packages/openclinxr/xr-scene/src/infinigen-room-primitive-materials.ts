/**
 * #534 — loader-side dielectric for glTF primitives that ship with no material.
 *
 * GLTFLoader maps a missing material to metalness=1/roughness=1/white (black under IBL,
 * FrontSide-culled from inside). Assign a DoubleSide dielectric derived from the room's
 * own plaster (or another authored dielectric). No geometry change; GLB bytes untouched.
 *
 * claimScope: material presence on Infinigen room primitives after load.
 * notEvidenceFor: lighting defaults; AO; Quest readiness; clinical validity.
 */
import {
  Box3,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Object3D,
} from "three";

export type AssignedRoomPrimitiveMaterial = {
  meshName: string;
  materialSource: string;
  worldExtent: [number, number, number];
};

/** glTF default material signature from three.js `createDefaultMaterial` (metal 1 / rough 1). */
export function isGltfMissingAuthoredMaterial(material: Material | Material[] | null | undefined): boolean {
  if (material == null) return true;
  const mats = Array.isArray(material) ? material : [material];
  if (mats.length === 0) return true;
  return mats.every((m) => {
    if (!m) return true;
    if (!(m instanceof MeshStandardMaterial)) return false;
    const unnamed = !m.name || m.name.length === 0;
    const noMaps = m.map == null && m.normalMap == null && m.aoMap == null && m.emissiveMap == null;
    return unnamed && noMaps && m.metalness === 1 && m.roughness === 1 && m.color.getHex() === 0xffffff;
  });
}

function materialName(mat: Material | null | undefined): string {
  return mat && typeof mat.name === "string" ? mat.name : "";
}

/**
 * Prefer plaster; else any authored dielectric whose name matches the contract source pattern.
 */
export function findRoomDielectricDonor(roomRoot: Object3D): MeshStandardMaterial | null {
  let plaster: MeshStandardMaterial | null = null;
  let anyDielectric: MeshStandardMaterial | null = null;
  roomRoot.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!(mat instanceof MeshStandardMaterial)) continue;
      if (isGltfMissingAuthoredMaterial(mat)) continue;
      const name = materialName(mat);
      if (!name) continue;
      if (mat.metalness > 0.45) continue;
      if (/plaster/i.test(name) && plaster == null) plaster = mat;
      if (/shader_|plaster|marble/i.test(name) && anyDielectric == null) anyDielectric = mat;
    }
  });
  return plaster ?? anyDielectric;
}

function worldExtentOf(mesh: Mesh): [number, number, number] {
  mesh.updateWorldMatrix(true, false);
  const box = new Box3().setFromObject(mesh);
  return [
    Math.max(0, box.max.x - box.min.x),
    Math.max(0, box.max.y - box.min.y),
    Math.max(0, box.max.z - box.min.z),
  ];
}

/**
 * Named falsifier (#534): material-less prim must be walls (tall + footprint-spanning),
 * not a floor slab / cutaway / gizmo. Throws so the load path refuses the wrong remedy.
 */
export function assertMaterialLessPrimitiveLooksLikeWalls(mesh: Mesh): void {
  const extent = worldExtentOf(mesh);
  const [ex, ey, ez] = extent;
  const maxHorizontal = Math.max(ex, ez);
  // Floors: near-zero height, large XZ. Walls: height ≥ ~1.5 m and footprint-scale X/Z.
  if (ey < 1.0) {
    throw new Error(
      `DEAD PREMISE (#534): material-less mesh ${mesh.name || "(unnamed)"} height=${ey.toFixed(3)}m `
        + `< 1.0 — not walls; refuse plaster assignment. extent=${JSON.stringify(extent)}`,
    );
  }
  if (maxHorizontal < 1.0) {
    throw new Error(
      `DEAD PREMISE (#534): material-less mesh ${mesh.name || "(unnamed)"} maxXZ=${maxHorizontal.toFixed(3)}m `
        + `< 1.0 — not room walls; refuse plaster assignment. extent=${JSON.stringify(extent)}`,
    );
  }
}

/**
 * After GLTFLoader: find meshes with no authored material and assign a DoubleSide dielectric
 * derived from this room's plaster (color + roughness; maps omitted — wall UVs differ).
 */
export function assignMissingRoomPrimitiveMaterials(roomRoot: Object3D): AssignedRoomPrimitiveMaterial[] {
  const bare: Mesh[] = [];
  roomRoot.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    if (isGltfMissingAuthoredMaterial(obj.material)) bare.push(obj);
  });
  if (bare.length === 0) {
    roomRoot.userData.openClinXrAssignedRoomPrimitiveMaterials = [];
    return [];
  }

  const donor = findRoomDielectricDonor(roomRoot);
  if (donor == null) {
    throw new Error(
      "assignMissingRoomPrimitiveMaterials: no plaster/marble dielectric donor in room — cannot invent albedo",
    );
  }
  const sourceName = materialName(donor) || "shader_plaster";
  const assigned: AssignedRoomPrimitiveMaterial[] = [];

  for (const obj of bare) {
    assertMaterialLessPrimitiveLooksLikeWalls(obj);

    const derived = new MeshStandardMaterial({
      name: `${sourceName}__load_fill`,
      color: donor.color.clone(),
      roughness: typeof donor.roughness === "number" ? donor.roughness : 0.77,
      metalness: 0,
      side: DoubleSide,
      // Derived dielectric only — do not copy maps (wall mesh UV layout ≠ plaster donor).
    });
    derived.userData.openClinXrMaterialSource = sourceName;
    derived.userData.openClinXrAssignedAtLoad = true;

    obj.material = derived;
    obj.visible = true;
    obj.userData.openClinXrAssignedMaterialAtLoad = true;
    obj.userData.openClinXrMaterialSource = sourceName;

    const extent = worldExtentOf(obj);
    assigned.push({ meshName: obj.name || "(unnamed)", materialSource: sourceName, worldExtent: extent });
  }

  roomRoot.userData.openClinXrAssignedRoomPrimitiveMaterials = assigned;
  return assigned;
}
