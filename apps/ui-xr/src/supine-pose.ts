/**
 * Procedural supine (recumbent) pose on the existing 23-bone runtime subset (#150/#153).
 *
 * ED chest-pain patient lies on the procedural stretcher deck — not a standing figure
 * tipped with one root euler (that clips rails and reads as a rigid plank).
 *
 * Decisions (#150):
 *  - Method: root reorientation + limb bone map (legs extended, arms along torso).
 *    Rejected pure root.x=90 tip; rejected new clip authoring (no asset rebake).
 *  - Head end: stretcher geometry length axis = X, pillow at local −X (live pre-fix).
 *  - Height ownership: plantSupineBodyOnDeck measures live mesh minY vs deck top.
 *    NEVER call seatedVerticalOffsetForSeatHeight (hip-on-chair ≠ torso-on-deck).
 *  - Clip binding: SUPINE_CLIP_NAME procedural (not the lying standing-clip alias).
 *
 * Decisions (#153) — verified against live landmarks (issue-153/pre-fix.json):
 *  - #150's root.rotation.z = +π/2 alone maps standing left/right onto WORLD Y, so the
 *    figure is SIDE-LYING (one wrist up, one down). True supine needs face → +Y and
 *    left/right → ±Z. Root uses the basis map below (not a single Z euler).
 *  - Load-time clinical idle overwrote arms (main.ts guard). Map already had arms-along-
 *    sides intent; idle residual + missing `neck` left standing hang/neck on the figure.
 *  - `neck` is in the map so the standing idle alias cannot leave a residual angle.
 *
 * claimScope: runtime recumbent pose + deck plant for ED primary_patient.
 * notEvidenceFor: clinical lying realism, Quest readiness, other stations' posture.
 */

import { Euler, Quaternion, type Object3D } from "three";
import {
  DEFAULT_STRETCHER_POSITION,
  SUPINE_CLIP_NAME,
  type ActorPosture,
  clipBindingForPosture,
} from "@openclinxr/asset-registry";
import { STRETCHER_LENGTH_METERS } from "./station-stretcher.js";

const d2r = (deg: number) => (deg * Math.PI) / 180;

/**
 * Standing rest thigh on this armature is ≈ −π on X. Supine keeps legs nearly
 * extended (small knee flex so feet don't lock into rails).
 */
const THIGH_REST_X = -Math.PI;
const SUPINE_KNEE_FLEX = d2r(8);

/**
 * Bone eulers for a recumbent figure AFTER the on-back root basis map
 * (head → −X, left → +Z, face → +Y). Arms along torso sides so wrists sit near
 * the deck plane and outside the rib volume (rails at ±0.45 Z).
 */
const SUPINE_BONE_EULERS = new Map<string, { x?: number; y?: number; z?: number; absolute?: boolean }>([
  ["pelvis", { x: 0, y: 0, z: 0, absolute: true }],
  ["spine", { x: d2r(4), absolute: true }],
  ["chest", { x: d2r(2), absolute: true }],
  // Legs extended along the bed (toward +X after on-back root map).
  ["thighL", { x: THIGH_REST_X, y: 0.04, z: -0.04, absolute: true }],
  ["thighR", { x: THIGH_REST_X, y: -0.04, z: 0.04, absolute: true }],
  ["shinL", { x: -SUPINE_KNEE_FLEX, y: 0, z: 0, absolute: true }],
  ["shinR", { x: -SUPINE_KNEE_FLEX, y: 0, z: 0, absolute: true }],
  ["footL", { x: 0.4, y: 0.6, z: -1.2, absolute: true }],
  ["footR", { x: 0.4, y: -0.6, z: 1.2, absolute: true }],
  // Arms along sides — not T-pose plank that punches through rails.
  // Staging (#153, measured world): wrists near deck (above <0.35 m), lateral outside
  // ribs (~0.12 m half-width) and inside rails (±0.45). On-back root maps left→−Z;
  // mild upper-arm Y + Z keeps wrists beside the hips, not through the torso.
  // Asymmetric: live R wrist lat stayed ~0.06 inside ribs (need ≥ ~0.12); push R further out.
  ["upper_armL", { x: d2r(-16), y: d2r(32), z: d2r(-65), absolute: true }],
  ["upper_armR", { x: d2r(-16), y: d2r(-48), z: d2r(62), absolute: true }],
  ["forearmL", { x: d2r(18), y: d2r(10), z: d2r(2), absolute: true }],
  ["forearmR", { x: d2r(18), y: d2r(-22), z: d2r(-8), absolute: true }],
  ["handL", { x: 0, y: 0, z: 0, absolute: true }],
  ["handR", { x: 0, y: 0, z: 0, absolute: true }],
  // Neutral neck so standing clinical-idle residual cannot hang the head past the pillow.
  ["neck", { x: 0, y: 0, z: 0, absolute: true }],
  ["head", { x: d2r(-4), absolute: true }],
]);

/**
 * #150 exported a single Z euler (side-lying in practice). Kept for callers that still
 * read the constant; applySupinePose uses SUPINE_ROOT_EULER instead.
 */
export const SUPINE_ROOT_ROTATION_Z = Math.PI / 2;

/**
 * On-back root euler (order XYZ): Rx(−π/2)·Rz(+π/2) composition via makeRotationFromEuler.
 * Maps standing left=+X → world −Z, head=+Y → world −X (pillow), face=+Z → world +Y.
 * det=+1 (proper rotation). A prior basis matrix with left→+Z had det=−1 and was a reflection.
 * #150's Z-only map put left/right on world Y (side-lying); measured issue-153/pre-fix.
 */
const SUPINE_ROOT_EULER = new Euler(-Math.PI / 2, 0, Math.PI / 2, "XYZ");
const SUPINE_ROOT_QUAT = new Quaternion().setFromEuler(SUPINE_ROOT_EULER);

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
  humanoidRoot.userData.openClinXrSupineRootBasis = "head_neg_x_left_neg_z_face_pos_y";

  // On-back root (proper rotation, det=+1): head → −X, left → −Z, face → +Y.
  humanoidRoot.quaternion.copy(SUPINE_ROOT_QUAT);
  humanoidRoot.rotation.setFromQuaternion(humanoidRoot.quaternion, humanoidRoot.rotation.order);

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
  // Staging marker for #153 contracts: neck last written by the supine map.
  humanoidRoot.userData.openClinXrNeckPoseSource = bonesTouched.includes("neck")
    ? "supine_map"
    : "supine_map_missing_neck";
  humanoidRoot.traverse((object) => {
    if (object.name === "neck" || object.name === "Neck") {
      object.userData.openClinXrNeckPoseSource = "supine_map";
      object.userData.openClinXrSupinePose = SUPINE_CLIP_NAME;
    }
  });
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
 * After the on-back root basis, contact bones (pelvis/spine/chest) sit above the
 * deck plane. Plant those bones onto deckTop + torso half-thickness.
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
    /** World X of the pillow rest point (default: deck center X − 0.95 stretcher local). */
    pillowWorldX?: number;
    torsoHalfThickness?: number;
  },
): {
  plantDeltaY: number;
  bodyMinYBefore: number | null;
  center: { deltaX: number; deltaZ: number };
  headAlignDeltaX: number;
} {
  const thickness = input.torsoHalfThickness ?? 0.26;
  applySupinePose(humanoidRoot);
  const plant = plantSupineBodyOnDeck(humanoidRoot, input.deckTopWorldY, thickness);
  const center = centerSupineBodyOnDeck(humanoidRoot, input.deckCenter);
  // #153: bias so the head bone sits at the pillow mesh rest XZ (not body AABB center).
  // Procedural pillow is at stretcher local (−length*0.38, 0); default stretcher at
  // DEFAULT_STRETCHER_POSITION (−0.9, −0.1). Slot.x is stretcher center, not pillow.
  const pillowLocalX = -STRETCHER_LENGTH_METERS * 0.38;
  const pillowX =
    input.pillowWorldX
    ?? (DEFAULT_STRETCHER_POSITION.x + pillowLocalX);
  // Pillow local Z = 0 on the procedural stretcher → world Z = stretcher Z (not actorSlot drift).
  const pillowZ = DEFAULT_STRETCHER_POSITION.z;
  const headAlign = alignSupineHeadToPillow(humanoidRoot, { x: pillowX, z: pillowZ });
  const plant2 = plantSupineBodyOnDeck(humanoidRoot, input.deckTopWorldY, thickness);
  humanoidRoot.userData.openClinXrSupinePlantDeltaY = plant.deltaY + plant2.deltaY;
  humanoidRoot.userData.openClinXrSupinePlantBodyMinBefore = plant.bodyMinYBefore;
  humanoidRoot.userData.openClinXrSupineCenterDelta = center;
  humanoidRoot.userData.openClinXrSupineHeadAlignDelta = headAlign;
  humanoidRoot.updateMatrixWorld?.(true);
  return {
    plantDeltaY: plant.deltaY + plant2.deltaY,
    bodyMinYBefore: plant.bodyMinYBefore,
    center,
    headAlignDeltaX: headAlign.deltaX,
  };
}

/**
 * Shift root XZ so the head bone sits on the pillow rest point (staging, not anatomy).
 * Call after centerSupineBodyOnDeck; re-plant Y afterwards.
 */
export function alignSupineHeadToPillow(
  humanoidRoot: Object3D,
  pillowWorld: { x: number; z: number },
): { deltaX: number; deltaZ: number } {
  humanoidRoot.updateMatrixWorld?.(true);
  let headX: number | null = null;
  let headZ: number | null = null;
  const consider = (object: Object3D) => {
    if (object.name !== "head" && object.name !== "Head") return;
    const isBone = (object as Object3D & { isBone?: boolean }).isBone === true
      || (object as Object3D & { type?: string }).type === "Bone";
    if (!isBone && object.name !== "head") return;
    object.updateWorldMatrix?.(true, false);
    const e = object.matrixWorld?.elements;
    if (!e) return;
    headX = e[12] ?? null;
    headZ = e[14] ?? null;
  };
  humanoidRoot.traverse(consider);
  humanoidRoot.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: Object3D[]; update?: () => void };
    };
    if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
    skinned.skeleton.update?.();
    for (const bone of skinned.skeleton.bones) consider(bone);
  });
  if (headX === null || headZ === null) return { deltaX: 0, deltaZ: 0 };
  const deltaX = pillowWorld.x - headX;
  const deltaZ = pillowWorld.z - headZ;
  if (Math.abs(deltaX) < 1e-4 && Math.abs(deltaZ) < 1e-4) return { deltaX: 0, deltaZ: 0 };
  humanoidRoot.position.x += deltaX;
  humanoidRoot.position.z += deltaZ;
  humanoidRoot.updateMatrixWorld?.(true);
  return { deltaX, deltaZ };
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
