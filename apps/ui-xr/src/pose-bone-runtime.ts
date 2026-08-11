/**
 * Runtime bridge between canonical pose landmarks and the bone names actually present on a loaded
 * humanoid (#306).
 *
 * The pose consumers in this app address bones by canonical landmarks (`upper_armL`, `thighL`,
 * `spine`, ...). The 23-bone Anny and body-param/library rails carry those names directly, but the
 * MPFB2 rig (`mpfb-ob-patient-aisha.glb`) names them `upperarm01.L`, `upperleg01.L`, `spine03`, ...
 * — a missing lookup is a SILENT SKIP and the actor ships unposable. This module collects the
 * sanitised bone-name set of a loaded humanoid and resolves landmarks against it via
 * `@openclinxr/asset-registry`'s `resolvePoseBone`.
 *
 * Naming: GLBs store dotted names (`upper_arm.L`); three.js strips dots for animation binding
 * (`PropertyBinding.sanitizeNodeName`), so scene-graph names are compared in sanitised form.
 */

import { resolvePoseBone } from "@openclinxr/asset-registry";
import type { Object3D } from "three";

/** Strip dots like three.js `PropertyBinding.sanitizeNodeName` (§6v). */
export function sanitiseBoneName(name: string): string {
  return name.replaceAll(".", "");
}

type SkinnedLike = Object3D & {
  isSkinnedMesh?: boolean;
  skeleton?: { bones: Object3D[] };
};

function isBoneNode(object: Object3D): boolean {
  return (object as Object3D & { isBone?: boolean }).isBone === true
    || (object as Object3D & { type?: string }).type === "Bone";
}

/**
 * Collect the sanitised bone-name set actually present on a loaded humanoid — scene-graph Bone
 * nodes plus `SkinnedMesh.skeleton.bones` (both are used as authoritative lists by pose code).
 */
export function collectJointNames(root: Object3D): Set<string> {
  const names = new Set<string>();
  const consider = (object: Object3D) => {
    if (!object.name) return;
    names.add(sanitiseBoneName(object.name));
  };
  root.traverse((object) => {
    if (isBoneNode(object)) consider(object);
  });
  root.traverse((object) => {
    const skinned = object as SkinnedLike;
    if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
    for (const bone of skinned.skeleton.bones) consider(bone);
  });
  return names;
}

export type PoseRotation = { x?: number; y?: number; z?: number; absolute?: boolean };

/**
 * Resolve a canonical-landmark-keyed rotation map against the bones present on a rig. Returns a map
 * keyed by RESOLVED sanitised bone name. Dotted input keys (`upper_arm.L`) are sanitised before
 * resolving, so both dotted and undotted spellings reach the same resolved entry.
 */
export function resolveRotationMap(
  rotations: ReadonlyMap<string, PoseRotation>,
  jointNames: ReadonlySet<string>,
): Map<string, PoseRotation> {
  const out = new Map<string, PoseRotation>();
  for (const [key, rotation] of rotations) {
    const resolved = resolvePoseBone(sanitiseBoneName(key), jointNames);
    if (resolved !== null && !out.has(resolved)) out.set(resolved, rotation);
  }
  return out;
}

/**
 * Find every object (Bone nodes + skeleton.bones) whose sanitised name matches a target.
 * Used to turn a resolved bone name back into live objects when names are dotted in the scene graph.
 */
export function findBonesBySanitisedName(root: Object3D, sanitisedTarget: string): Object3D[] {
  const found: Object3D[] = [];
  const consider = (object: Object3D) => {
    if (object.name && sanitiseBoneName(object.name) === sanitisedTarget) found.push(object);
  };
  root.traverse(consider);
  root.traverse((object) => {
    const skinned = object as SkinnedLike;
    if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
    for (const bone of skinned.skeleton.bones) consider(bone);
  });
  return found;
}
