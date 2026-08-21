/**
 * Procedural supine (recumbent) pose, authored on the 23-bone runtime subset (#150/#153/#159).
 * Each key resolves through `resolvePoseBone` (#306), so the recast MPFB2 MakeHuman rig (#491)
 * is posed too — `pelvis→root`, `spine→spine03`, `chest→spine01`, limbs to their first segments —
 * rather than silently skipped.
 *
 * ED chest-pain patient lies on the procedural stretcher deck — not a standing figure
 * tipped with one root euler (that clips rails and reads as a rigid plank).
 *
 * Deck plant / HOB incline live in `supine-deck-plant.ts` (file-size split #171).
 *
 * claimScope: runtime recumbent pose + deck plant + staging incline follow for ED patient.
 * notEvidenceFor: clinical lying realism, Quest readiness, multi-joint bed fidelity.
 */

import { Euler, Quaternion, type Object3D } from "three";
import {
  SUPINE_CLIP_NAME,
  type ActorPosture,
  clipBindingForPosture,
  resolvePoseBone,
} from "@openclinxr/asset-registry";
import { collectJointNames, resolveRotationMap, sanitiseBoneName } from "./pose-bone-runtime.js";

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

/**
 * #495 ablation — opt-in control over the pose's two mechanisms. Existing callers
 * omit the options object and are unchanged.
 */
export type ApplySupinePoseOptions = {
  /**
   * When false, apply only the on-back root basis and skip the 17 joint eulers.
   * Default true preserves today's behaviour.
   */
  applyJointEulers?: boolean;
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
export function applySupinePose(humanoidRoot: Object3D, options: ApplySupinePoseOptions = {}): ApplySupinePoseResult {
  const applyJointEulers = options.applyJointEulers !== false;
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

  if (applyJointEulers) {
    // #306: resolve canonical landmarks against the bones actually on this rig so MPFB2 actors
    // (upperarm01.L / upperleg01.L / spine03 ...) get posed instead of silently skipped.
    const resolvedEulers = resolveRotationMap(SUPINE_BONE_EULERS, collectJointNames(humanoidRoot));

    humanoidRoot.traverse((object) => {
      const rotation = resolvedEulers.get(sanitiseBoneName(object.name));
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
        const rotation = resolvedEulers.get(sanitiseBoneName(bone.name));
        if (!rotation) continue;
        applyEuler(bone, rotation, bonesTouched);
      }
      skinned.skeleton.update?.();
    });
  }

  humanoidRoot.userData.openClinXrSupinePoseBones = bonesTouched;
  // Staging marker for #153 contracts: neck last written by the supine map.
  // #306: the neck landmark may resolve to `neck01` on the MPFB2 rig, so compare resolved names.
  const resolvedNeck = resolvePoseBone("neck", collectJointNames(humanoidRoot));
  humanoidRoot.userData.openClinXrNeckPoseSource = resolvedNeck !== null && bonesTouched.includes(resolvedNeck)
    ? "supine_map"
    : "supine_map_missing_neck";
  humanoidRoot.traverse((object) => {
    if (object.name === "neck" || object.name === "Neck"
      || (resolvedNeck !== null && sanitiseBoneName(object.name) === resolvedNeck)) {
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
