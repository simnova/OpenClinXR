/**
 * #181 — head-to-pillow flex for the inclined supine plant.
 * Split from supine-deck-plant.ts for the zone line budget.
 */

import type { Object3D } from "three";
import { findSupineBone } from "./hob-extremity-flex.js";

/** World position of the head bone (base of skull) — same discriminator the plant contract reads. */
export function readSupineHeadWorld(humanoidRoot: Object3D): { x: number; y: number; z: number } | null {
  const head = findSupineBone(humanoidRoot, "head", "Head");
  if (!head) return null;
  humanoidRoot.updateMatrixWorld?.(true);
  head.updateWorldMatrix?.(true, false);
  const e = head.matrixWorld?.elements;
  if (!e) return null;
  return { x: e[12] ?? 0, y: e[13] ?? 0, z: e[14] ?? 0 };
}

function refreshSupineSkeleton(humanoidRoot: Object3D): void {
  humanoidRoot.updateMatrixWorld?.(true);
  humanoidRoot.traverse((object) => {
    const skinned = object as Object3D & {
      isSkinnedMesh?: boolean;
      skeleton?: { update?: () => void };
    };
    if (skinned.isSkinnedMesh) skinned.skeleton?.update?.();
  });
}

/**
 * Upper-spine + neck chain between the head and the lumbar, nearest the head first,
 * then reversed so the upper-spine joints (deepest lever) are rotated first.
 */
function collectSupineHeadFlexChain(humanoidRoot: Object3D): Object3D[] {
  const head = findSupineBone(humanoidRoot, "head", "Head");
  if (!head) return [];
  const chain: Object3D[] = [];
  let node: Object3D | null = head.parent ?? null;
  while (node && node !== humanoidRoot && chain.length < 6) {
    const isBone = (node as Object3D & { isBone?: boolean }).isBone === true
      || (node as Object3D & { type?: string }).type === "Bone";
    if (isBone && node.name) chain.push(node);
    node = node.parent ?? null;
  }
  return chain.reverse();
}

/**
 * Distributed upper-spine/neck flex that lowers the head onto the pillow.
 *
 * The inclined path leaves the body as a rigid plank: on the MPFB rail (#496 skips the joint
 * eulers) the head floats ~0.3 m above the pillow while the back already penetrates the raised
 * deck. A single-joint neck rotation cannot close that — the head is nearly horizontal from every
 * neck pivot, so rotating any one joint swings it in X rather than down. The flex is distributed
 * across the upper-spine + neck chain, each joint nodding about its local X (the world ±Z axis)
 * by a share of the needed angle, closed-loop against the live head-to-pillow Y gap. The root is
 * untouched, so the #620 seat plant and #150 penetration guarantee survive. On the MPFB rail the
 * joint rotations persist across the per-frame hold (applySupinePose re-applies only the root
 * quat), so the flex holds in the room.
 *
 * claimScope: staging head-to-pillow contact on the inclined deck.
 * notEvidenceFor: clinical cervical/thoracic posture validity, multi-joint bed fidelity.
 */
export function flexSupineHeadOntoPillow(
  humanoidRoot: Object3D,
  pillowWorld: { x: number; y: number; z: number } | null,
  options?: { targetGapMeters?: number },
): { appliedRad: number; headGapMeters: number | null } {
  if (!pillowWorld || typeof pillowWorld.y !== "number" || !Number.isFinite(pillowWorld.y)) {
    return { appliedRad: 0, headGapMeters: null };
  }
  const chain = collectSupineHeadFlexChain(humanoidRoot);
  if (chain.length < 2) return { appliedRad: 0, headGapMeters: null };
  // Pillow mesh centre + half-thickness = pillow top; the head bone (base of skull) rests there.
  // #181 calibration: the live room reading runs ~0.06 m ABOVE the register-time plant (#171
  // register-vs-live tip quat quirk, measured before AND after this flex), so the register target
  // sits slightly INTO the pillow top so the live reading lands inside the 0.05 contact band.
  const target = pillowWorld.y + 0.04 + (options?.targetGapMeters ?? -0.03);
  let appliedRad = 0;
  let lastGap: number | null = null;
  let prevGap: number | null = null;
  let prevStep = 0;
  let gain = 0; // measured descent per radian (self-calibrating)
  for (let pass = 0; pass < 10; pass += 1) {
    const head = readSupineHeadWorld(humanoidRoot);
    if (!head) break;
    const gap = head.y - target;
    if (!Number.isFinite(gap)) break;
    lastGap = gap;
    if (gap <= 0.012 && gap >= -0.005) break; // in band, tight
    if (gap < -0.005 && prevStep > 0) {
      // Overshot into the pillow — undo the last step and stop.
      for (const joint of chain) joint.rotation.x += prevStep;
      refreshSupineSkeleton(humanoidRoot);
      lastGap = readSupineHeadWorld(humanoidRoot)?.y ?? lastGap;
      lastGap = lastGap !== null ? lastGap - target : null;
      break;
    }
    if (pass > 0 && prevStep > 0 && prevGap !== null) {
      const measured = (prevGap - gap) / prevStep;
      if (Number.isFinite(measured) && measured > 0) gain = measured;
    }
    if (gain <= 0) {
      // First-order lever estimate: sum of the head's horizontal offset from each joint.
      let leverTotal = 0;
      for (const joint of chain) {
        joint.updateWorldMatrix?.(true, false);
        const e = joint.matrixWorld?.elements;
        if (!e) continue;
        leverTotal += Math.abs(head.x - (e[12] ?? head.x));
      }
      gain = Math.max(leverTotal, 0.3);
    }
    const step = Math.max(0.02, Math.min(0.15, (gap * 0.8) / gain));
    for (const joint of chain) {
      joint.rotation.x -= step; // chin-to-chest: +Y toward −Z in the body frame, head descends
    }
    prevStep = step;
    prevGap = gap;
    appliedRad += step;
    refreshSupineSkeleton(humanoidRoot);
  }
  humanoidRoot.userData.openClinXrSupineHeadFlexRad = appliedRad;
  humanoidRoot.userData.openClinXrSupineHeadFlexJoints = chain.map((j) => j.name ?? "");
  humanoidRoot.userData.openClinXrSupineHeadGapMeters = lastGap;
  // #621: on the MPFB2 rail the supine joint map is skipped (#496), so applySupinePose's marker
  // reads "supine_map_missing_neck" even though this flex DID write the neck chain joints. Mark
  // them truthfully when they were rotated — the inspector reads this marker to verify the neck
  // was not left to the standing idle.
  if (appliedRad > 0) {
    const neckJoints = chain.filter((joint) => /neck/i.test(joint.name ?? ""));
    for (const joint of neckJoints) {
      joint.userData.openClinXrNeckPoseSource = "supine_map";
      joint.userData.openClinXrNeckPoseSourceDetail = "supine_map_head_flex";
    }
    if (neckJoints.length > 0) {
      humanoidRoot.userData.openClinXrNeckPoseSource = "supine_map";
      humanoidRoot.userData.openClinXrNeckPoseSourceDetail = "supine_map_head_flex";
    }
  }
  return { appliedRad, headGapMeters: lastGap };
}
