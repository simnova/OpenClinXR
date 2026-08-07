/**
 * Procedural supine (recumbent) pose on the existing 23-bone runtime subset (#150).
 *
 * ED chest-pain patient lies on the procedural stretcher deck — not a standing figure
 * tipped with one root euler (that clips rails and reads as a rigid plank).
 *
 * Decisions (#150):
 *  - Method: root reorientation (Z = +π/2 so head → −X pillow end) + limb bone map
 *    (legs extended, arms along torso). Rejected pure root.x=90 tip; rejected new clip
 *    authoring (no asset rebake; anny absent in worktrees).
 *  - Head end: stretcher geometry length axis = X, pillow at local −X (live pre-fix).
 *  - Height ownership: plantSupineBodyOnDeck measures live mesh minY vs deck top.
 *    NEVER call seatedVerticalOffsetForSeatHeight (hip-on-chair ≠ torso-on-deck).
 *  - Clip binding: SUPINE_CLIP_NAME procedural (not the lying standing-clip alias).
 *
 * claimScope: runtime recumbent pose + deck plant for ED primary_patient.
 * notEvidenceFor: clinical lying realism, Quest readiness, other stations' posture.
 */

import type { Object3D } from "three";
import {
  SUPINE_CLIP_NAME,
  type ActorPosture,
  clipBindingForPosture,
} from "@openclinxr/asset-registry";

const d2r = (deg: number) => (deg * Math.PI) / 180;

/**
 * Standing rest thigh on this armature is ≈ −π on X. Supine keeps legs nearly
 * extended (small knee flex so feet don't lock into rails).
 */
const THIGH_REST_X = -Math.PI;
const SUPINE_KNEE_FLEX = d2r(8);

/**
 * Bone eulers for a recumbent figure AFTER root.rotation.z = +π/2 maps head to −X.
 * Arms tucked along the torso so wrists stay inside deck width (rails at ±0.45 Z).
 */
const SUPINE_BONE_EULERS = new Map<string, { x?: number; y?: number; z?: number; absolute?: boolean }>([
  ["pelvis", { x: 0, y: 0, z: 0, absolute: true }],
  ["spine", { x: d2r(4), absolute: true }],
  ["chest", { x: d2r(2), absolute: true }],
  // Legs extended along the bed (toward +X after root Z rot).
  ["thighL", { x: THIGH_REST_X, y: 0.04, z: -0.04, absolute: true }],
  ["thighR", { x: THIGH_REST_X, y: -0.04, z: 0.04, absolute: true }],
  ["shinL", { x: -SUPINE_KNEE_FLEX, y: 0, z: 0, absolute: true }],
  ["shinR", { x: -SUPINE_KNEE_FLEX, y: 0, z: 0, absolute: true }],
  ["footL", { x: 0.4, y: 0.6, z: -1.2, absolute: true }],
  ["footR", { x: 0.4, y: -0.6, z: 1.2, absolute: true }],
  // Arms along sides — not T-pose plank that punches through rails.
  ["upper_armL", { x: d2r(-12), y: d2r(8), z: d2r(-70), absolute: true }],
  ["upper_armR", { x: d2r(-12), y: d2r(-8), z: d2r(70), absolute: true }],
  ["forearmL", { x: d2r(20), y: d2r(6), z: d2r(10), absolute: true }],
  ["forearmR", { x: d2r(20), y: d2r(-6), z: d2r(-10), absolute: true }],
  ["handL", { x: 0, y: 0, z: 0, absolute: true }],
  ["handR", { x: 0, y: 0, z: 0, absolute: true }],
  ["head", { x: d2r(-6), absolute: true }],
]);

/** Root Z rotation: standing +Y → world −X (pillow / head end). Live stretcher axis = X. */
export const SUPINE_ROOT_ROTATION_Z = Math.PI / 2;

export type ApplySupinePoseResult = {
  applied: boolean;
  clipName: string;
  bonesTouched: string[];
  posture: ActorPosture;
};

function applyEuler(
  object: Object3D,
  rotation: { x?: number; y?: number; z?: number; absolute?: boolean },
  bonesTouched: string[],
): void {
  const x = rotation.x !== undefined ? rotation.x : object.rotation.x;
  const y = rotation.y !== undefined ? rotation.y : (rotation.absolute ? 0 : object.rotation.y);
  const z = rotation.z !== undefined ? rotation.z : (rotation.absolute ? 0 : object.rotation.z);
  object.rotation.set(x, y, z, object.rotation.order);
  object.quaternion.setFromEuler(object.rotation);
  object.userData.openClinXrSupinePose = SUPINE_CLIP_NAME;
  if (!bonesTouched.includes(object.name)) bonesTouched.push(object.name);
}

/**
 * Apply procedural recumbent rotations + root Z reorientation.
 * Call plantSupineBodyOnDeck after this to rest the back on the deck top.
 */
export function applySupinePose(humanoidRoot: Object3D): ApplySupinePoseResult {
  const binding = clipBindingForPosture("supine");
  humanoidRoot.userData.openClinXrActorPosture = "supine";
  humanoidRoot.userData.openClinXrPostureClipName = binding.clipName;
  humanoidRoot.userData.openClinXrPostureClipSource = binding.source;
  humanoidRoot.userData.openClinXrSupineHeightOwner = "plantSupineBodyOnDeck_and_deckTopYMeters";
  humanoidRoot.userData.openClinXrClipRootTranslation = "stripped_not_applied";
  humanoidRoot.userData.openClinXrSupineHeadEnd = "negative_x";
  humanoidRoot.userData.openClinXrSupineLengthAxis = "x";

  // Root reorientation: head toward pillow (−X). Keep Y plant for plantSupineBodyOnDeck.
  humanoidRoot.rotation.x = 0;
  humanoidRoot.rotation.y = 0;
  humanoidRoot.rotation.z = SUPINE_ROOT_ROTATION_Z;
  humanoidRoot.quaternion.setFromEuler(humanoidRoot.rotation);

  const bonesTouched: string[] = [];

  humanoidRoot.traverse((object) => {
    const rotation = SUPINE_BONE_EULERS.get(object.name);
    if (!rotation) return;
    applyEuler(object, rotation, bonesTouched);
  });

  humanoidRoot.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: Object3D[]; update?: () => void };
    };
    if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
    for (const bone of skinned.skeleton.bones) {
      const rotation = SUPINE_BONE_EULERS.get(bone.name);
      if (!rotation) continue;
      applyEuler(bone, rotation, bonesTouched);
    }
    skinned.skeleton.update?.();
  });

  humanoidRoot.userData.openClinXrSupinePoseBones = bonesTouched;
  humanoidRoot.userData.openClinXrActiveRoleAnimationClipName = SUPINE_CLIP_NAME;
  humanoidRoot.updateMatrixWorld?.(true);

  return {
    applied: bonesTouched.length > 0,
    clipName: SUPINE_CLIP_NAME,
    bonesTouched,
    posture: "supine",
  };
}

/**
 * Shift the humanoid root so the torso rests on the deck top.
 *
 * After root.rotation.z = +π/2, the back lies along world Y ≈ bone world-Y of
 * pelvis/spine/chest. Plant those bones onto deckTop + torso half-thickness.
 * Unskinned mesh matrixWorld alone under-reads minY and left the figure floating
 * ~0.14 m (post-fix smoke). Does NOT use seatedVerticalOffsetForSeatHeight.
 *
 * deckTopWorldY — mattress top in world space (procedural stretcher: 0.55).
 * torsoHalfThickness — contact-bone height above deck. Calibrated on ed cast:
 * skinned minY sits ~0.25 m below pelvis/spine after Z reorientation, so the
 * bone plant target must be high enough that skinned clearanceAboveDeck ≥ 0.
 */
export function plantSupineBodyOnDeck(
  humanoidRoot: Object3D,
  deckTopWorldY: number,
  /**
   * Target: contact bones sit this far above deck top.
   * Default 0.26 → skinned minY near deck top on ed_chest_pain adult cast (smoke).
   */
  torsoHalfThickness = 0.26,
): { deltaY: number; bodyMinYBefore: number | null } {
  const CONTACT_BONE = /^(pelvis|hips|spine|chest|spine\d*|thigh)/i;

  const readContactY = (): number | null => {
    humanoidRoot.updateMatrixWorld?.(true);
    // Refresh skinned skeletons so bone matrixWorld is current.
    humanoidRoot.traverse((object) => {
      const skinned = object as Object3D & {
        isSkinnedMesh?: boolean;
        skeleton?: { update?: () => void };
      };
      if (skinned.isSkinnedMesh) skinned.skeleton?.update?.();
    });

    let minContact: number | null = null;
    const consider = (object: Object3D) => {
      const name = object.name ?? "";
      if (!CONTACT_BONE.test(name)) return;
      const isBone = (object as Object3D & { isBone?: boolean }).isBone === true
        || (object as Object3D & { type?: string }).type === "Bone";
      if (!isBone) return;
      object.updateWorldMatrix?.(true, false);
      const wy = object.matrixWorld.elements[13] ?? 0;
      if (minContact === null || wy < minContact) minContact = wy;
    };

    humanoidRoot.traverse(consider);
    humanoidRoot.traverse((object) => {
      const skinned = object as Object3D & {
        isSkinnedMesh?: boolean;
        skeleton?: { bones: Object3D[] };
      };
      if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
      for (const bone of skinned.skeleton.bones) consider(bone);
    });
    return minContact;
  };

  const bodyMinYBefore = readContactY();
  if (bodyMinYBefore === null) return { deltaY: 0, bodyMinYBefore: null };

  const targetContactY = deckTopWorldY + torsoHalfThickness;
  let totalDelta = 0;
  for (let pass = 0; pass < 3; pass += 1) {
    const current = readContactY();
    if (current === null) break;
    const deltaY = targetContactY - current;
    if (Math.abs(deltaY) < 1e-4) break;
    humanoidRoot.position.y += deltaY;
    totalDelta += deltaY;
    humanoidRoot.updateMatrixWorld?.(true);
  }
  return { deltaY: totalDelta, bodyMinYBefore };
}

/**
 * One-shot: pose + plant Y + center XZ + re-plant (used at humanoid register).
 * Keeps main.ts under the shrink-only freeze ceiling.
 */
export function applyAndPlantSupineOnDeck(
  humanoidRoot: Object3D,
  input: {
    deckTopWorldY: number;
    deckCenter: { x: number; z: number };
    torsoHalfThickness?: number;
  },
): {
  plantDeltaY: number;
  bodyMinYBefore: number | null;
  center: { deltaX: number; deltaZ: number };
} {
  const thickness = input.torsoHalfThickness ?? 0.26;
  applySupinePose(humanoidRoot);
  const plant = plantSupineBodyOnDeck(humanoidRoot, input.deckTopWorldY, thickness);
  const center = centerSupineBodyOnDeck(humanoidRoot, input.deckCenter);
  const plant2 = plantSupineBodyOnDeck(humanoidRoot, input.deckTopWorldY, thickness);
  humanoidRoot.userData.openClinXrSupinePlantDeltaY = plant.deltaY + plant2.deltaY;
  humanoidRoot.userData.openClinXrSupinePlantBodyMinBefore = plant.bodyMinYBefore;
  humanoidRoot.userData.openClinXrSupineCenterDelta = center;
  humanoidRoot.updateMatrixWorld?.(true);
  return {
    plantDeltaY: plant.deltaY + plant2.deltaY,
    bodyMinYBefore: plant.bodyMinYBefore,
    center,
  };
}

/**
 * Per-frame plant hold: restore base XZ/Y with mild breathing; root Z owned by applySupinePose.
 */
export function holdSupinePlantFrame(
  root: Object3D,
  base: { x: number; y: number; z: number; scaleX: number; scaleY: number; scaleZ: number },
  breathing: number,
): void {
  root.position.y = base.y + breathing * 0.006;
  root.position.x = base.x;
  root.position.z = base.z;
  root.scale.x = base.scaleX;
  root.scale.y = base.scaleY + breathing * 0.006;
  root.scale.z = base.scaleZ;
}

/**
 * Center the recumbent body on the stretcher XZ and nudge so the head end sits
 * toward the pillow (−X). Call after applySupinePose + plant Y.
 */
export function centerSupineBodyOnDeck(
  humanoidRoot: Object3D,
  deckCenter: { x: number; z: number },
): { deltaX: number; deltaZ: number } {
  humanoidRoot.updateMatrixWorld?.(true);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let any = false;
  humanoidRoot.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      geometry?: {
        attributes?: {
          position?: { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number };
        };
      };
      matrixWorld?: { elements: number[] };
    };
    if (!skinned.isSkinnedMesh || !skinned.geometry?.attributes?.position) return;
    const pos = skinned.geometry.attributes.position;
    const e = skinned.matrixWorld?.elements;
    if (!e) return;
    any = true;
    const stride = Math.max(1, Math.floor(pos.count / 2000));
    for (let i = 0; i < pos.count; i += stride) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const w = 1 / (e[3] * vx + e[7] * vy + e[11] * vz + e[15] || 1);
      const wx = (e[0] * vx + e[4] * vy + e[8] * vz + e[12]) * w;
      const wz = (e[2] * vx + e[6] * vy + e[10] * vz + e[14]) * w;
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
    }
  });
  if (!any) return { deltaX: 0, deltaZ: 0 };
  const bodyCx = (minX + maxX) / 2;
  const bodyCz = (minZ + maxZ) / 2;
  const deltaX = deckCenter.x - bodyCx;
  const deltaZ = deckCenter.z - bodyCz;
  humanoidRoot.position.x += deltaX;
  humanoidRoot.position.z += deltaZ;
  humanoidRoot.updateMatrixWorld?.(true);
  return { deltaX, deltaZ };
}
