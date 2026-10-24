/**
 * Isolated-subject lab debug evidence (extracted from isolated-subject-lab.ts).
 *
 * Live renderer/lights/material readouts, portrait pixel-box projection, and
 * the supine joint dump. Additive recording only — values are read from the
 * scene, never source-read.
 */

import {
  type Box3,
  type Color,
  Light,
  Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type PerspectiveCamera,
  REVISION,
  type Scene,
  Vector3,
  type WebGLRenderer,
} from "three";
import { computeMeshBounds } from "./camera-fit-to-bounds.js";
import { resolvePoseBone } from "@openclinxr/asset-registry";
import { collectJointNames, findBonesBySanitisedName } from "@openclinxr/xr-pose";
import {
  type MaterialOverrideApplied,
  type SkinOverrideApplied,
  collectMaterialInventory,
} from "./isolated-subject-material-variants.js";
import type { ProductRigApplied } from "./isolated-subject-rig-variants.js";

/**
 * #493: world-space joint dump after the real supine pose call. Additive recording
 * only — the pose path and the subject root are untouched. Consumed by
 * `supine-pose-two-subject-dump.ts` to answer "which quantity differs, by how much".
 */
export type SupineJointDump = {
  subjectKind: "runtime_posture" | "posture_on_furniture";
  bodyGlb: string;
  obtainedBy: string;
  worldJoints: Record<string, { x: number; y: number; z: number }>;
  /** Canonical landmark -> bone name actually present on this rig (via #306 resolver). */
  resolvedBones: Record<string, string | null>;
  posedMeshAabb: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  meshCount: number;
  /** #496: sanitised joint-name set size (collectJointNames) — 23 on Anny, >100 on MPFB2. */
  jointCount: number;
  /** #495 ablation: true — this dump is only written after applyAndPlantSupineOnDeck ran. */
  ranSupineCall: boolean;
  /** #495 ablation: false when applySupinePose was called with applyJointEulers=false (root basis only). */
  appliedJointEulers: boolean;
};

/**
 * Canonical landmarks this measurement records, keyed by a stable dump name and
 * resolved per-rig through the #306 pose-bone resolver (same path the supine map
 * uses), so control (Anny) and treatment (MPFB recast) are comparable.
 */
const SUPINE_DUMP_LANDMARKS: ReadonlyArray<readonly [string, string]> = [
  ["root", "pelvis"],
  ["thighL", "thighL"],
  ["thighR", "thighR"],
  ["spine01", "chest"],
  ["wristL", "handL"],
  ["wristR", "handR"],
  ["head", "head"],
];

export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function dumpSupineJointState(
  humanoid: Object3D,
  bodyGlb: string,
  subjectKind: "runtime_posture" | "posture_on_furniture",
): SupineJointDump {
  humanoid.updateMatrixWorld(true);
  const jointNames = collectJointNames(humanoid);
  const worldJoints: Record<string, { x: number; y: number; z: number }> = {};
  const resolvedBones: Record<string, string | null> = {};
  for (const [key, landmark] of SUPINE_DUMP_LANDMARKS) {
    const resolved = resolvePoseBone(landmark, jointNames);
    resolvedBones[key] = resolved;
    if (resolved === null) continue;
    const bone = findBonesBySanitisedName(humanoid, resolved)[0];
    if (!bone) continue;
    const p = new Vector3().setFromMatrixPosition(bone.matrixWorld);
    worldJoints[key] = { x: round3(p.x), y: round3(p.y), z: round3(p.z) };
  }
  let meshCount = 0;
  humanoid.traverse((o) => {
    if (o instanceof Mesh) meshCount += 1;
  });
  const aabb = computeMeshBounds(humanoid);
  return {
    subjectKind,
    bodyGlb,
    obtainedBy:
      "isolated-subject-lab runtime_posture path: applyAndPlantSupineOnDeck (product pose call) "
      + "then updateMatrixWorld(true); world joints read from Bone matrixWorld via #306 resolvePoseBone, "
      + "posed mesh AABB from computeMeshBounds over live Mesh geometry",
    worldJoints,
    resolvedBones,
    posedMeshAabb: {
      min: { x: round3(aabb.min.x), y: round3(aabb.min.y), z: round3(aabb.min.z) },
      max: { x: round3(aabb.max.x), y: round3(aabb.max.y), z: round3(aabb.max.z) },
    },
    meshCount,
    jointCount: jointNames.size,
    ranSupineCall: true,
    appliedJointEulers: ((humanoid.userData["openClinXrSupinePoseBones"] as string[] | undefined) ?? []).length > 0,
  };
}

/** Project an AABB through the camera to a pixel box (portrait headBoxPx/headHeightPx, no render needed). */
export function projectBoxPx(
  camera: PerspectiveCamera,
  box: Box3,
  canvasWidthPx: number,
  canvasHeightPx: number,
): { x0: number; y0: number; x1: number; y1: number; heightPx: number } {
  camera.updateMatrixWorld(true);
  const corners = [
    new Vector3(box.min.x, box.min.y, box.min.z),
    new Vector3(box.min.x, box.min.y, box.max.z),
    new Vector3(box.min.x, box.max.y, box.min.z),
    new Vector3(box.min.x, box.max.y, box.max.z),
    new Vector3(box.max.x, box.min.y, box.min.z),
    new Vector3(box.max.x, box.min.y, box.max.z),
    new Vector3(box.max.x, box.max.y, box.min.z),
    new Vector3(box.max.x, box.max.y, box.max.z),
  ];
  let loX = Infinity, hiX = -Infinity, loY = Infinity, hiY = -Infinity;
  for (const c of corners) {
    c.applyMatrix4(camera.matrixWorldInverse);
    c.applyMatrix4(camera.projectionMatrix);
    if (c.x < loX) loX = c.x;
    if (c.x > hiX) hiX = c.x;
    if (c.y < loY) loY = c.y;
    if (c.y > hiY) hiY = c.y;
  }
  const x0 = (loX * 0.5 + 0.5) * canvasWidthPx;
  const x1 = (hiX * 0.5 + 0.5) * canvasWidthPx;
  const y1 = (0.5 - loY * 0.5) * canvasHeightPx;
  const y0 = (0.5 - hiY * 0.5) * canvasHeightPx;
  return { x0, y0, x1, y1, heightPx: y1 - y0 };
}

/** Skin-realism portrait: live renderer/lights/material values read from the scene, never source-read. */
export function collectRuntimeDebug(input: { renderer: WebGLRenderer; scene: Scene; root: Object3D; hairHidden: boolean; hiddenHairMeshes: string[]; skinOverrideApplied: SkinOverrideApplied | null; materialOverridesApplied: MaterialOverrideApplied[] | null; productRig: ProductRigApplied | null; portrait: { fovDeg: number; fillTarget: number; distanceM: number; headHeightPx: number; headBoxPx: { x0: number; y0: number; x1: number; y1: number }; yawDegrees: number } | null }): unknown {
  const { renderer, scene, root, hairHidden, hiddenHairMeshes, skinOverrideApplied, materialOverridesApplied, productRig, portrait } = input;
  const lights: Array<{ type: string; color: string; groundColor?: string; role?: string; intensity: number; position: { x: number; y: number; z: number } }> = [];
  scene.traverse((o) => {
    if (o instanceof Light) {
      const color = `#${o.color.getHexString()}`;
      const entry: (typeof lights)[number] = { type: o.type, color, intensity: o.intensity, position: { x: o.position.x, y: o.position.y, z: o.position.z } };
      if (o.type === "HemisphereLight") {
        entry.groundColor = `#${(o as unknown as { groundColor: Color }).groundColor.getHexString()}`;
      }
      const role = (o.userData as { openClinXrLightingRigRole?: unknown; openClinXrStationInteriorLightingRole?: unknown }).openClinXrLightingRigRole
        ?? (o.userData as { openClinXrStationInteriorLightingRole?: unknown }).openClinXrStationInteriorLightingRole;
      if (typeof role === "string") entry.role = role;
      lights.push(entry);
    }
  });
  let skin: { name: string; type: string; roughness: number; metalness: number; hasNormalMap: boolean; baseColorTextureSize: number[] | null } | null = null;
  root.traverse((o) => {
    if (skin || !(o instanceof Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m && /skin/i.test(m.name)) {
        const std = m as MeshStandardMaterial;
        const map = (std as unknown as { map?: { image?: { width?: number; height?: number } } }).map;
        skin = {
          name: m.name,
          type: m.type,
          roughness: typeof std.roughness === "number" ? std.roughness : -1,
          metalness: typeof std.metalness === "number" ? std.metalness : -1,
          hasNormalMap: (std as unknown as { normalMap?: unknown }).normalMap != null,
          baseColorTextureSize: map?.image?.width ? [map.image.width, map.image.height ?? map.image.width] : null,
        };
        return;
      }
    }
  });
  if (!skin) {
    root.traverse((o) => {
      if (skin || !(o instanceof Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const m = mats[0];
      if (!m) return;
      const std = m as MeshStandardMaterial;
      const map = (std as unknown as { map?: { image?: { width?: number; height?: number } } }).map;
      skin = {
        name: m.name,
        type: m.type,
        roughness: typeof std.roughness === "number" ? std.roughness : -1,
        metalness: typeof std.metalness === "number" ? std.metalness : -1,
        hasNormalMap: (std as unknown as { normalMap?: unknown }).normalMap != null,
        baseColorTextureSize: map?.image?.width ? [map.image.width, map.image.height ?? map.image.width] : null,
      };
    });
  }
  return {
    threeRevision: REVISION,
    toneMapping: renderer.toneMapping,
    toneMappingExposure: renderer.toneMappingExposure,
    outputColorSpace: renderer.outputColorSpace,
    environmentMap: scene.environment != null,
    environmentIntensity: (scene as unknown as { environmentIntensity?: number }).environmentIntensity ?? null,
    lights,
    skinMaterial: skin,
    skinOverrideApplied,
    materialInventory: collectMaterialInventory(root),
    materialOverridesApplied,
    productRig,
    portrait,
    hairHidden,
    hiddenHairMeshes,
  };
}
