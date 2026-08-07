/**
 * Procedural seated pose on the existing 23-bone runtime subset (#81).
 *
 * Rotation-only (matches automate_blender clinical clips). Seated height is owned by
 * verticalOffsetMeters + chair seatHeightMeters — not by clip root translation.
 *
 * Why procedural, not Mesh2Motion 66→23 retarget as the shipping path:
 * Sitting_Idle carries 198 channels including pelvis/root translation; rest/axis
 * alignment against Anny/canonical is non-mechanical. This module lands a visible sit
 * for data-flow + room capture. Mesh2Motion library evaluation is recorded separately
 * in the slice report (cagematch residual).
 *
 * claimScope: runtime pose apply for seated posture binding.
 * notEvidenceFor: clinical sitting realism, mocap quality, Mesh2Motion retarget success.
 */

import type { Object3D } from "three";
import {
  SEATED_CLIP_NAME,
  STANDING_CLIP_NAME,
  type ActorPosture,
  clipBindingForPosture,
} from "@openclinxr/asset-registry";

/** Degrees → radians helper. */
const d2r = (deg: number) => (deg * Math.PI) / 180;

/**
 * Runtime GLBs use undotted bone names (thighL) after three.js sanitizeNodeName.
 *
 * #83 calibration on neutral-generated-human standing REST (measured live):
 *   thighL.x ≈ -π (−3.139), shinL.x ≈ 0, footL ≈ (0.557, 0.93, −1.478), foot world Y ≈ 0.12
 * Absolute ±80° from identity raised feet above the pelvis. Seated eulers are REST + delta:
 *   hip flex ≈ +90° on thigh (toward −π/2), knee flex ≈ +95° on shin, feet keep rest pose.
 */
const THIGH_REST_X = -Math.PI;
/**
 * #87: ordinary seated hip flexion (ceiling 95°). #83 deepened this to 105° + trunk stack
 * to clear a mesh-height threshold; that put the chin on the chest. Height shortening vs
 * standing comes from leg fold within the ceiling + pelvis on the seat (not chin-to-chest).
 * Hip flexion is measured as thigh→shin vs world-down. Pelvis absolute tilt adds into that
 * world angle, so keep pelvis near rest and author hip under 95° of true world fold.
 * #83's pelvis18/spine12/chest4 stack is forbidden — it cleared height by chin-on-chest.
 */
const HIP_FLEX = d2r(93);
const KNEE_FLEX = d2r(95);
const SEATED_BONE_EULERS = new Map<string, { x?: number; y?: number; z?: number; absolute?: boolean }>([
  // Near-rest trunk so the head stays upright; height comes from leg fold + seat plant.
  ["pelvis", { x: d2r(0), absolute: true }],
  ["spine", { x: d2r(0), absolute: true }],
  ["chest", { x: d2r(0), absolute: true }],
  // REST thigh x≈-π; +hip flex → thighs more horizontal, knees forward.
  ["thighL", { x: THIGH_REST_X + HIP_FLEX, y: 0.053, z: -0.053, absolute: true }],
  ["thighR", { x: THIGH_REST_X + HIP_FLEX, y: -0.053, z: 0.053, absolute: true }],
  // Knee flex sign opposite hip delta so the shin drops toward the floor after hip fold.
  ["shinL", { x: -KNEE_FLEX, y: -0.023, z: 0.023, absolute: true }],
  ["shinR", { x: -KNEE_FLEX, y: 0.023, z: -0.023, absolute: true }],
  // Keep standing foot rest so ankles are not re-authored into a twist.
  ["footL", { x: 0.557, y: 0.93, z: -1.478, absolute: true }],
  ["footR", { x: 0.557, y: -0.93, z: 1.478, absolute: true }],
  ["upper_armL", { x: d2r(-30), z: d2r(12), absolute: true }],
  ["upper_armR", { x: d2r(-30), z: d2r(-12), absolute: true }],
  ["forearmL", { x: d2r(35), absolute: true }],
  ["forearmR", { x: d2r(35), absolute: true }],
  ["thigh.L", { x: THIGH_REST_X + HIP_FLEX, y: 0.053, z: -0.053, absolute: true }],
  ["thigh.R", { x: THIGH_REST_X + HIP_FLEX, y: -0.053, z: 0.053, absolute: true }],
  ["shin.L", { x: -KNEE_FLEX, y: -0.023, z: 0.023, absolute: true }],
  ["shin.R", { x: -KNEE_FLEX, y: 0.023, z: -0.023, absolute: true }],
]);

export type ApplySeatedPoseResult = {
  applied: boolean;
  clipName: string;
  bonesTouched: string[];
  posture: ActorPosture;
  /** World-Y of the lowest foot/shin bone after apply (for planting). */
  lowestSupportBoneWorldY: number | null;
};

/**
 * After a seated pose is applied, shift the humanoid root so the pelvis rests on the
 * chair seat (not hovering, not buried). #87: mesh height vs standing must come from
 * this descent onto the seat — not from deepening hip/knee beyond ordinary sit range.
 *
 * seatWorldY is the seat TOP surface in world space (procedural chair: 0.45 m).
 * targetPelvisAboveSeat is a small sit-into-cushion clearance (positive = pelvis above seat).
 */
export function plantSeatedPelvisOnSeat(
  humanoidRoot: Object3D,
  seatWorldY: number,
  /**
   * Target pelvis world-Y minus seat top. Positive = slightly above seat.
   * Default 0.02 (sit-on-cushion). Per-frame root scale breathing can open the gap
   * by ~0.05–0.08 m after plant; callers may aim near 0 for a stable post-loop gap.
   */
  targetPelvisAboveSeat = 0.02,
): { deltaY: number; pelvisBefore: number | null } {
  const readPelvisWorldY = (): number | null => {
    humanoidRoot.updateMatrixWorld?.(true);
    let pelvisY: number | null = null;
    humanoidRoot.traverse((object) => {
      if (pelvisY !== null) return;
      const name = (object.name ?? "").toLowerCase();
      if (name !== "pelvis" && name !== "hips") return;
      const isBone = (object as Object3D & { isBone?: boolean }).isBone === true
        || (object as Object3D & { type?: string }).type === "Bone";
      if (!isBone) return;
      object.updateWorldMatrix?.(true, false);
      pelvisY = object.matrixWorld.elements[13] ?? 0;
    });
    return pelvisY;
  };

  const pelvisBefore = readPelvisWorldY();
  if (pelvisBefore === null) return { deltaY: 0, pelvisBefore: null };

  const targetY = seatWorldY + targetPelvisAboveSeat;
  // Two passes: first moves root; second corrects residual after matrix rebuild
  // (parent scales / bind hierarchy mean one local += worldDelta is not always exact).
  let totalDelta = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    const current = readPelvisWorldY();
    if (current === null) break;
    const deltaY = targetY - current;
    if (Math.abs(deltaY) < 1e-4) break;
    humanoidRoot.position.y += deltaY;
    totalDelta += deltaY;
    humanoidRoot.updateMatrixWorld?.(true);
  }
  return { deltaY: totalDelta, pelvisBefore };
}

/**
 * Legacy foot plant kept for any caller that still needs lowest-support floor contact.
 * Prefer plantSeatedPelvisOnSeat for seated figures (#87).
 */
export function plantSeatedFeetNearFloor(
  humanoidRoot: Object3D,
  targetLowestY = 0.04,
): { deltaY: number; lowestBefore: number | null } {
  humanoidRoot.updateMatrixWorld?.(true);
  let lowest: number | null = null;
  humanoidRoot.traverse((object) => {
    const name = object.name ?? "";
    if (!/foot|shin/i.test(name)) return;
    const isBone = (object as Object3D & { isBone?: boolean }).isBone === true
      || (object as Object3D & { type?: string }).type === "Bone";
    if (!isBone) return;
    object.updateWorldMatrix?.(true, false);
    const wy = object.matrixWorld.elements[13] ?? 0;
    if (lowest === null || wy < lowest) lowest = wy;
  });
  if (lowest === null) return { deltaY: 0, lowestBefore: null };
  const deltaY = targetLowestY - lowest;
  humanoidRoot.position.y += deltaY;
  humanoidRoot.updateMatrixWorld?.(true);
  return { deltaY, lowestBefore: lowest };
}

/**
 * Apply procedural sit rotations to skinned bones under a loaded humanoid root.
 * Same Euler write path as applyGeneratedHumanoidClinicalIdlePosture (main.ts).
 * Records clip binding userData for evidence.
 */
export function applyPosturePose(
  humanoidRoot: Object3D,
  posture: ActorPosture,
): ApplySeatedPoseResult {
  const binding = clipBindingForPosture(posture);
  humanoidRoot.userData.openClinXrActorPosture = posture;
  humanoidRoot.userData.openClinXrPostureClipName = binding.clipName;
  humanoidRoot.userData.openClinXrPostureClipSource = binding.source;
  humanoidRoot.userData.openClinXrSeatedHeightOwner = "verticalOffsetMeters_and_chair_seatHeightMeters";
  humanoidRoot.userData.openClinXrClipRootTranslation = "stripped_not_applied";

  if (posture !== "seated") {
    return {
      applied: false,
      clipName: binding.clipName,
      bonesTouched: [],
      posture,
      lowestSupportBoneWorldY: null,
    };
  }

  const bonesTouched: string[] = [];
  /**
   * #83: AnimationMixer writes bone.quaternion directly. Setting only Euler .x/.y/.z can leave a
   * stale quaternion if onChange is suppressed or a later matrix update recomposes from quaternion.
   * Write Euler then force quaternion.setFromEuler so the sit survives the frame after mixer.update.
   */
  const applyEuler = (
    object: Object3D,
    rotation: { x?: number; y?: number; z?: number; absolute?: boolean },
  ) => {
    // absolute: replace full XYZ (needed for legs whose bind is ~−π on thigh X).
    // non-absolute: only overwrite provided axes (legacy arm path).
    const x = rotation.x !== undefined ? rotation.x : object.rotation.x;
    const y = rotation.y !== undefined ? rotation.y : (rotation.absolute ? 0 : object.rotation.y);
    const z = rotation.z !== undefined ? rotation.z : (rotation.absolute ? 0 : object.rotation.z);
    object.rotation.set(x, y, z, object.rotation.order);
    object.quaternion.setFromEuler(object.rotation);
    object.userData.openClinXrSeatedPose = SEATED_CLIP_NAME;
    if (!bonesTouched.includes(object.name)) bonesTouched.push(object.name);
  };

  // Scene-graph bones (isBone nodes) — match dotted (file) and undotted (runtime) names.
  humanoidRoot.traverse((object) => {
    const rotation = SEATED_BONE_EULERS.get(object.name);
    if (!rotation) return;
    applyEuler(object, rotation);
  });

  // Also write skeleton.bones in case the skinned mesh holds the authoritative list.
  humanoidRoot.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: Object3D[]; update?: () => void };
    };
    if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
    for (const bone of skinned.skeleton.bones) {
      const rotation = SEATED_BONE_EULERS.get(bone.name);
      if (!rotation) continue;
      applyEuler(bone, rotation);
    }
    skinned.skeleton.update?.();
  });

  humanoidRoot.userData.openClinXrSeatedPoseBones = bonesTouched;
  humanoidRoot.userData.openClinXrActiveRoleAnimationClipName = SEATED_CLIP_NAME;
  humanoidRoot.updateMatrixWorld?.(true);

  let lowestSupportBoneWorldY: number | null = null;
  humanoidRoot.traverse((object) => {
    const name = object.name ?? "";
    if (!/foot|shin/i.test(name)) return;
    const isBone = (object as Object3D & { isBone?: boolean }).isBone === true
      || (object as Object3D & { type?: string }).type === "Bone";
    if (!isBone) return;
    object.updateWorldMatrix?.(true, false);
    const wy = object.matrixWorld.elements[13] ?? 0;
    if (lowestSupportBoneWorldY === null || wy < lowestSupportBoneWorldY) {
      lowestSupportBoneWorldY = wy;
    }
  });

  return {
    applied: bonesTouched.length > 0,
    clipName: SEATED_CLIP_NAME,
    bonesTouched,
    posture,
    lowestSupportBoneWorldY,
  };
}

export { SEATED_CLIP_NAME, STANDING_CLIP_NAME };
