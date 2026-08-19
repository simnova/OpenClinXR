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
  resolvePoseBone,
} from "@openclinxr/asset-registry";
import { collectJointNames, resolveRotationMap, sanitiseBoneName } from "./pose-bone-runtime.js";
// #447: the MPFB2 rail's baked rest is not Anny-frame — the leg fold lives in its own module.
import { applyMpfb2SeatedFold, isMpfb2Rig } from "./seated-pose-mpfb2.js";

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
 *
 * #138 pre-fix (telehealth, live): hip≈90.5° knee≈85° pelvis-on-seat gap≈0.02 — figure IS
 * folded; silhouette Δh sat at ~0.19–0.25 only because (a) min-standing peers included elevated
 * clinical_team slots (mesh h≈1.37, feet at y≈0.93) and (b) knee tuck left feet low so the
 * body mesh minY stayed ~0.12. Decision: keep hip under the 95° ceiling (no trunk stack);
 * deepen KNEE only so shins tuck and mesh minY rises (compresses silhouette height without
 * chin-on-chest). Rejected: deepen HIP past 95°, restore #83 trunk stack, lower the 0.25 floor.
 */
const HIP_FLEX = d2r(93);
/** Shin tuck under the seat — raises skinned minY / shortens silhouette without extra hip fold. */
const KNEE_FLEX = d2r(108);
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
  // #119: hands rest on thighs (chair has no armrests). #91's −55°/±10° + 45° forearm was
  // open-loop with no thigh target → wrists ~0.57 m from the thigh segment (ratio ~0.99 of
  // arm length) and lateral ~0.63–0.66 m. Standing #117 hang does NOT transfer: seated rest
  // is a CONTACT problem (hands forward on horizontal thighs), not a lateral hang.
  //
  // Seed eulers (probe-driven; clinical-idle L z− / R z+ sign on this undotted rig) land near
  // the lap, then restSeatedHandsOnThighs() closes the loop on the live thigh segment.
  // Decision: iterative thigh target over a third pure open-loop authoring pass (two open-loop
  // slices already failed). Dead dotted thigh.L/R shin.L/R keys removed (cleanup only).
  ["upper_armL", { x: d2r(-22), y: d2r(35), z: d2r(-88), absolute: true }],
  ["upper_armR", { x: d2r(-22), y: d2r(-35), z: d2r(88), absolute: true }],
  ["forearmL", { x: d2r(105), y: d2r(28), z: d2r(30), absolute: true }],
  ["forearmR", { x: d2r(105), y: d2r(-28), z: d2r(-30), absolute: true }],
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
    // #306: MPFB2 rigs name the pelvis `pelvis.L/R` and carry no `pelvis` — the landmark resolves
    // to `root` on that rig, so match the resolved name as well as the canonical spellings.
    const resolvedPelvis = resolvePoseBone("pelvis", collectJointNames(humanoidRoot));
    humanoidRoot.traverse((object) => {
      if (pelvisY !== null) return;
      const name = (object.name ?? "").toLowerCase();
      const sanitised = sanitiseBoneName(object.name ?? "");
      const isResolvedPelvis = resolvedPelvis !== null && sanitised === resolvedPelvis;
      if (name !== "pelvis" && name !== "hips" && !isResolvedPelvis) return;
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
 *
 * #447: the MPFB2 rail (upperleg01.L / lowerleg01.L rigs) has a baked non-identity
 * rest — the 23-bone Anny-frame absolute eulers warp it into a crushed mass (measured
 * 2026-08-19: skin 0.31..0.74 on mpfb-street-adult-male.glb). On that rail the GLB's
 * own rest renders the trunk upright, so the seated fold only aligns the leg bones'
 * world +Y to seated targets (thigh forward, shin down-tucked). Idempotent — no
 * rest capture needed, re-applies cleanly every frame.
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
  const jointNames = collectJointNames(humanoidRoot);
  // #447: MPFB2 rigs name the thigh/shin chains upperleg01/02.L, lowerleg01/02.L.
  const mpfb2Rig = isMpfb2Rig(jointNames);

  if (mpfb2Rig) {
    applyMpfb2SeatedFold(humanoidRoot, bonesTouched);
  } else {
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

    // #306: resolve canonical landmarks against the bones actually on this rig (MPFB2 names
    // upperarm01.L / upperleg01.L etc.) so seated pose applies instead of silently skipping.
    const resolvedEulers = resolveRotationMap(SEATED_BONE_EULERS, jointNames);

    // Scene-graph bones (isBone nodes) — match dotted (file) and undotted (runtime) names.
    humanoidRoot.traverse((object) => {
      const rotation = resolvedEulers.get(sanitiseBoneName(object.name));
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
        const rotation = resolvedEulers.get(sanitiseBoneName(bone.name));
        if (!rotation) continue;
        applyEuler(bone, rotation);
      }
      skinned.skeleton.update?.();
    });

    // #119: close the loop on the live thigh segment (the "seated world-anchor" #91 lacked).
    const handRest = restSeatedHandsOnThighs(humanoidRoot, applyEuler);
    for (const name of handRest.bonesTouched) {
      if (!bonesTouched.includes(name)) bonesTouched.push(name);
    }
    humanoidRoot.userData.openClinXrSeatedHandRest = {
      iterations: handRest.iterations,
      sides: handRest.sides,
      claimScope: "wrist_to_thigh_iterative_rest",
      notEvidenceFor: ["natural_sit_appearance", "clinical_posture_appropriateness"],
    };
  }

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

type BoneLike = Object3D & { isBone?: boolean; type?: string };

function isBoneNode(object: Object3D): boolean {
  return (object as BoneLike).isBone === true || (object as BoneLike).type === "Bone";
}

function collectBones(root: Object3D): Object3D[] {
  const bones: Object3D[] = [];
  root.traverse((object) => {
    if (isBoneNode(object)) bones.push(object);
  });
  root.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { bones: Object3D[]; update?: () => void };
    };
    if (!skinned.isSkinnedMesh || !skinned.skeleton?.bones) return;
    skinned.skeleton.update?.();
    for (const bone of skinned.skeleton.bones) {
      if (bone && isBoneNode(bone) && !bones.includes(bone)) bones.push(bone);
    }
  });
  return bones;
}

function matchSideBone(name: string, side: "L" | "R", part: "upper" | "fore" | "hand" | "thigh" | "shin"): boolean {
  const n = (name || "").toLowerCase().replace(/[^a-z0-9_]+/g, "");
  const hasSide =
    (side === "L" && (n.endsWith("l") || n.includes("left") || n.includes("_l")))
    || (side === "R" && (n.endsWith("r") || n.includes("right") || n.includes("_r")));
  if (!hasSide) return false;
  if (part === "upper") {
    return n.includes("upper_arm") || n.includes("upperarm")
      || (n.includes("arm") && !n.includes("fore") && !n.includes("hand") && !n.includes("lower")
        && !n.includes("thigh") && !n.includes("shin"));
  }
  if (part === "fore") return n.includes("forearm") || n.includes("lowerarm") || n.includes("lower_arm");
  if (part === "hand") return n.includes("hand") || n.includes("wrist");
  if (part === "thigh") {
    return n.includes("thigh") || n.includes("upleg") || n.includes("upperleg")
      || (n.includes("leg") && !n.includes("lower") && !n.includes("shin") && !n.includes("calf")
        && !n.includes("foot"));
  }
  if (part === "shin") {
    return n.includes("shin") || n.includes("lowerleg") || n.includes("calf")
      || (n.includes("leg") && (n.includes("lower") || n.includes("shin")));
  }
  return false;
}

function worldXYZ(object: Object3D): { x: number; y: number; z: number } {
  object.updateWorldMatrix?.(true, false);
  const e = object.matrixWorld.elements;
  return { x: e[12] ?? 0, y: e[13] ?? 0, z: e[14] ?? 0 };
}

function dist3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function pointToSegment(
  p: { x: number; y: number; z: number },
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const apz = p.z - a.z;
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 1e-12 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return dist3(p, { x: a.x + t * abx, y: a.y + t * aby, z: a.z + t * abz });
}

function elbowAngleDegrees(shoulder: Object3D, elbow: Object3D, wrist: Object3D): number {
  const s = worldXYZ(shoulder);
  const e = worldXYZ(elbow);
  const w = worldXYZ(wrist);
  const v1x = s.x - e.x;
  const v1y = s.y - e.y;
  const v1z = s.z - e.z;
  const v2x = w.x - e.x;
  const v2y = w.y - e.y;
  const v2z = w.z - e.z;
  const n1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z) || 1e-9;
  const n2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z) || 1e-9;
  let cos = (v1x * v2x + v1y * v2y + v1z * v2z) / (n1 * n2);
  if (cos > 1) cos = 1;
  if (cos < -1) cos = -1;
  return Math.acos(cos) * (180 / Math.PI);
}

/**
 * #119 — iterative wrist→thigh rest after the open-loop seed.
 *
 * Pure open-loop eulers failed twice (#91, early #119 probes) because the T-pose bind maps
 * local XYZ to world residual non-obviously. Coordinate-descent on upper_arm + forearm
 * local eulers, targeting mid-thigh, with an elbow ceiling so a straight stick cannot win.
 *
 * claimScope: procedural seated hand rest toward live thigh segment.
 * notEvidenceFor: natural sit appearance, clinical appropriateness.
 */
export function restSeatedHandsOnThighs(
  humanoidRoot: Object3D,
  applyEuler: (
    object: Object3D,
    rotation: { x?: number; y?: number; z?: number; absolute?: boolean },
  ) => void,
): {
  iterations: number;
  bonesTouched: string[];
  sides: Array<{ side: "L" | "R"; finalDistance: number; elbowDegrees: number }>;
} {
  const bones = collectBones(humanoidRoot);
  const bonesTouched: string[] = [];
  const sides: Array<{ side: "L" | "R"; finalDistance: number; elbowDegrees: number }> = [];
  /** Stay well under the 160° planted elbow ceiling; ~110° is a soft rest bend. */
  const MAX_ELBOW_DEGREES = 155;
  const TARGET_DISTANCE = 0.08;
  const MAX_ITERS = 28;
  const STEP = d2r(4);

  const refreshSkeletons = () => {
    humanoidRoot.updateMatrixWorld?.(true);
    humanoidRoot.traverse((object) => {
      const skinned = object as Object3D & {
        isSkinnedMesh?: boolean;
        skeleton?: { update?: () => void };
      };
      if (skinned.isSkinnedMesh) skinned.skeleton?.update?.();
    });
  };

  for (const side of ["L", "R"] as const) {
    const upper = bones.find((b) => matchSideBone(b.name, side, "upper"));
    const fore = bones.find((b) => matchSideBone(b.name, side, "fore"));
    const hand = bones.find((b) => matchSideBone(b.name, side, "hand"));
    const thigh = bones.find((b) => matchSideBone(b.name, side, "thigh"));
    const shin = bones.find((b) => matchSideBone(b.name, side, "shin"));
    if (!upper || !thigh) continue;
    const elbow = fore ?? upper;
    const wrist = hand ?? fore ?? upper;
    const thighHead = worldXYZ(thigh);
    const thighTail = shin
      ? worldXYZ(shin)
      : { x: thighHead.x, y: thighHead.y - 0.35, z: thighHead.z + 0.15 };
    // Prefer mid-thigh contact (hands on thighs / lap), not hip end.
    const target = {
      x: thighHead.x * 0.35 + thighTail.x * 0.65,
      y: thighHead.y * 0.35 + thighTail.y * 0.65 + 0.02,
      z: thighHead.z * 0.35 + thighTail.z * 0.65,
    };

    const distToTarget = () => {
      refreshSkeletons();
      // Prefer segment distance (matches the contract measure) with a soft pull to mid-thigh.
      const w = worldXYZ(wrist);
      return pointToSegment(w, thighHead, thighTail) * 0.65 + dist3(w, target) * 0.35;
    };

    let best = distToTarget();
    let iters = 0;
    const joints = fore ? [upper, fore] : [upper];

    while (best > TARGET_DISTANCE && iters < MAX_ITERS) {
      iters += 1;
      let improved = false;
      for (const joint of joints) {
        for (const axis of ["x", "y", "z"] as const) {
          for (const sign of [1, -1] as const) {
            const before = {
              x: joint.rotation.x,
              y: joint.rotation.y,
              z: joint.rotation.z,
            };
            const next = { ...before, [axis]: before[axis] + sign * STEP, absolute: true as const };
            applyEuler(joint, next);
            // Mirror write onto any skeleton twin with the same name.
            for (const twin of bones) {
              if (twin !== joint && twin.name === joint.name) applyEuler(twin, next);
            }
            refreshSkeletons();
            const elbowDeg = elbowAngleDegrees(upper, elbow, wrist);
            const d = distToTarget();
            if (elbowDeg <= MAX_ELBOW_DEGREES && d + 1e-4 < best) {
              best = d;
              improved = true;
              if (!bonesTouched.includes(joint.name)) bonesTouched.push(joint.name);
            } else {
              applyEuler(joint, { ...before, absolute: true });
              for (const twin of bones) {
                if (twin !== joint && twin.name === joint.name) {
                  applyEuler(twin, { ...before, absolute: true });
                }
              }
            }
          }
        }
      }
      if (!improved) {
        // Smaller step once large steps stall.
        if (STEP > d2r(1.5) && iters < MAX_ITERS - 4) {
          // fall through; fixed STEP is fine — break if no axis improved
        }
        break;
      }
    }

    refreshSkeletons();
    sides.push({
      side,
      finalDistance: pointToSegment(worldXYZ(wrist), thighHead, thighTail),
      elbowDegrees: elbowAngleDegrees(upper, elbow, wrist),
    });
  }

  return {
    iterations: sides.length > 0 ? MAX_ITERS : 0,
    bonesTouched,
    sides,
  };
}

export { SEATED_CLIP_NAME, STANDING_CLIP_NAME };
