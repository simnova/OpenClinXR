import type { Group, Object3D } from "three";

/**
 * Jaw-bone drive for viseme openness.
 *
 * DEFECT (CEO grade, native 200x180 mouth crops): fitted teeth carry no morphs
 * (~50% verts on `jaw`, ~50% on `head`) and viseme morphs live only on the body,
 * so morph-only drive leaves a static upper-teeth row (viseme_aa) and unsealed
 * lips (viseme_PP/sil). Rotating the `jaw` bone carries teeth + tongue (tongue
 * bones are jaw children) with the lips.
 */

// Calibrated to the viseme_aa crop; parent will re-grade.
const JAW_OPEN_RAD = -0.28;

const REST_KEY = "openClinXrJawRest";

function findJawBone(root: Group): Object3D | null {
  let found: Object3D | null = null;
  root.traverse((object) => {
    if (found === null && object.name === "jaw") found = object;
  });
  if (found !== null) return found;
  root.traverse((object) => {
    if (found === null && object.name.toLowerCase().includes("jaw")) found = object;
  });
  return found;
}

export function applyJawVisemeToRoot(root: Group, openness: number): void {
  const jaw = findJawBone(root);
  if (jaw === null) return;
  const bag = jaw.userData[REST_KEY] as
    | { quaternion: { x: number; y: number; z: number; w: number }; position: { x: number; y: number; z: number } }
    | undefined;
  if (bag === undefined) {
    jaw.userData[REST_KEY] = {
      quaternion: { x: jaw.quaternion.x, y: jaw.quaternion.y, z: jaw.quaternion.z, w: jaw.quaternion.w },
      position: { x: jaw.position.x, y: jaw.position.y, z: jaw.position.z },
    };
  } else {
    jaw.quaternion.set(bag.quaternion.x, bag.quaternion.y, bag.quaternion.z, bag.quaternion.w);
    jaw.position.set(bag.position.x, bag.position.y, bag.position.z);
  }
  const clamped = Number.isFinite(openness) ? Math.min(1, Math.max(0, openness)) : 0;
  jaw.rotation.x += JAW_OPEN_RAD * clamped;
}
