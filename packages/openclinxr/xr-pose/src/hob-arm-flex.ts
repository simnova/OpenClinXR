/**
 * #621 — supine arm flex: lower the wrists to the deck on rails that skip the joint eulers.
 *
 * The MPFB2 rail skips the 17 SUPINE_BONE_EULERS (#496) because the Anny-tuned table crumples the
 * recast (#495), so the recumbent body's bind arms stay raised — measured live at 0.748 m above the
 * deck, 2.1× the #153 bound, on both wrists. This closes that residual with a distributed
 * upper-arm sweep, closed-loop against the LIVE wrist world Y, modelled on
 * flexSupineHeadOntoPillow (#181). The root is untouched, so the #150 plant, #620 float settle and
 * #171 seat/back trades survive.
 *
 * Calibration (#621 sim on mpfb-gown-adult-patient.glb, harness plant + live-like root):
 * - upper_arm local −X is the strong lowering axis (~0.38 m/rad at the bind pose).
 * - A pure sweep to deck+0.24 lands the wrist lateral ≈0.18 from the torso axis — inside the
 *   #153 rails (0.048 ribs floor, 0.45 rail) with margin.
 * - The sweep self-terminates at the bottom of the arm's arc (no-lower guard), so the wrist stops
 *   just above the target band instead of being driven through the mattress.
 *
 * claimScope: staging wrist height/lateral on the recumbent rail that skips joint eulers.
 * notEvidenceFor: clinical lying validity, anatomical joint angles, garment quality, Quest readiness.
 */

import type { Object3D } from "three";
import { findSupineBone } from "./hob-extremity-flex.js";

/** Register target: stop sweeping once the wrist sits at or below deck + 0.24. */
const WRIST_TARGET_ABOVE_DECK = 0.24;
/** Overshoot floor: never drive the wrist below deck + 0.10 (protects #150 deck penetration). */
const WRIST_FLOOR_ABOVE_DECK = 0.1;
/** Step size per pass; the probe picks the axis/sign that lowers the wrist most. */
const STEP_RAD = 0.12;
/** Keep the wrist visibly outside the torso axis while remaining well inside the 0.45 m rail. */
const WRIST_LATERAL_TARGET = 0.1;
const WRIST_LATERAL_STEP_RAD = 0.06;
type Vec3 = { x: number; y: number; z: number };

function readBoneWorld(bone: Object3D | null): Vec3 | null {
  if (!bone) return null;
  bone.updateWorldMatrix?.(true, false);
  const e = bone.matrixWorld?.elements;
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

export type SupineArmFlexResult = {
  appliedRad: number;
  wristsAboveDeck: { L: number | null; R: number | null };
};

type StoredArmBone = {
  name: string;
  quaternion: { x: number; y: number; z: number; w: number };
};

function signedDeckLateral(point: Vec3, pelvis: Vec3, head: Vec3): number {
  const longX = head.x - pelvis.x;
  const longZ = head.z - pelvis.z;
  const longLength = Math.hypot(longX, longZ) || 1;
  return (longX * (point.z - pelvis.z) - longZ * (point.x - pelvis.x)) / longLength;
}

/** Move a low wrist away from the torso axis without changing its longitudinal placement. */
function spreadWristBesideTorso(input: {
  humanoidRoot: Object3D;
  upper: Object3D;
  forearm: Object3D | null;
  hand: Object3D;
  pelvis: Vec3;
  head: Vec3;
  deckTopWorldY: number;
}): void {
  let wrist = readBoneWorld(input.hand);
  if (!wrist) return;
  const initialSigned = signedDeckLateral(wrist, input.pelvis, input.head);
  const direction = initialSigned < 0 ? -1 : 1;
  let outward = Math.abs(initialSigned);
  for (let pass = 0; pass < 40 && outward < WRIST_LATERAL_TARGET; pass += 1) {
    let best: { bone: Object3D; axis: "x" | "y" | "z"; sign: -1 | 1; outward: number } | null = null;
    for (const bone of [input.upper, input.forearm].filter((value): value is Object3D => Boolean(value))) {
      for (const axis of ["x", "y", "z"] as const) {
        for (const sign of [-1, 1] as const) {
          bone.rotation[axis] += sign * WRIST_LATERAL_STEP_RAD;
          refreshSupineSkeleton(input.humanoidRoot);
          const probe = readBoneWorld(input.hand);
          bone.rotation[axis] -= sign * WRIST_LATERAL_STEP_RAD;
          refreshSupineSkeleton(input.humanoidRoot);
          if (!probe || probe.y < input.deckTopWorldY + WRIST_FLOOR_ABOVE_DECK) continue;
          const probeOutward = signedDeckLateral(probe, input.pelvis, input.head) * direction;
          if (probeOutward > 0.4 || probeOutward <= outward + 1e-5) continue;
          if (!best || probeOutward > best.outward) best = { bone, axis, sign, outward: probeOutward };
        }
      }
    }
    if (!best) break;
    best.bone.rotation[best.axis] += best.sign * WRIST_LATERAL_STEP_RAD;
    refreshSupineSkeleton(input.humanoidRoot);
    wrist = readBoneWorld(input.hand) ?? wrist;
    outward = best.outward;
  }
}

/** Restore the exact plant-time arm solution after an animation frame rewrites the bind pose. */
export function reapplyStoredSupineArmFlex(humanoidRoot: Object3D): void {
  const stored = humanoidRoot.userData.openClinXrSupineArmFlexBones as StoredArmBone[] | undefined;
  if (!stored?.length) return;
  for (const entry of stored) {
    const bone = findSupineBone(humanoidRoot, entry.name, entry.name);
    if (!bone) continue;
    bone.quaternion.set(entry.quaternion.x, entry.quaternion.y, entry.quaternion.z, entry.quaternion.w);
    bone.rotation.setFromQuaternion(bone.quaternion, bone.rotation.order);
  }
  refreshSupineSkeleton(humanoidRoot);
}

/**
 * Sweep the recumbent arms down so the wrists rest near the deck, closed-loop against the live
 * wrist world Y. Each pass probes ±x/±y/±z on the upper arm and applies the step that lowers the
 * wrist most; the loop stops when the wrist enters the band, when a step would drive it below the
 * floor (overshoot — undo and stop), or when no step lowers it (bottom of the arm's arc). Deltas
 * persist on userData for evidence and the solved quaternions are restored after each animation-frame
 * pose reset.
 */
export function flexSupineArmsOntoDeck(
  humanoidRoot: Object3D,
  deckTopWorldY: number,
): SupineArmFlexResult {
  humanoidRoot.updateMatrixWorld?.(true);
  const headBone = findSupineBone(humanoidRoot, "head", "Head");
  const head = readBoneWorld(headBone);
  const headZ = head?.z ?? 0;
  const result: SupineArmFlexResult = { appliedRad: 0, wristsAboveDeck: { L: null, R: null } };
  const deltas: Record<string, { x: number; y: number; z: number }> = {};

  for (const side of ["L", "R"] as const) {
    const upper = findSupineBone(humanoidRoot, `upper_arm${side}`, `upper_arm.${side}`);
    const hand = findSupineBone(humanoidRoot, `hand${side}`, `hand.${side}`);
    if (!upper || !hand) {
      humanoidRoot.userData.openClinXrSupineArmFlexMissing = [
        ...(humanoidRoot.userData.openClinXrSupineArmFlexMissing ?? []),
        `${side}:upper=${Boolean(upper)} hand=${Boolean(hand)}`,
      ];
      continue;
    }
    let wrist = readBoneWorld(hand);
    if (!wrist) continue;
    const above0 = wrist.y - deckTopWorldY;
    if (above0 <= WRIST_TARGET_ABOVE_DECK) {
      result.wristsAboveDeck[side] = above0;
      continue;
    }

    let sideRad = 0;
    const sideDeltas: Record<string, { x: number; y: number; z: number }> = {};
    let axisApplied: "x" | "y" | "z" = "x";
    let signApplied = -1;
    for (let pass = 0; pass < 60; pass += 1) {
      const above = wrist.y - deckTopWorldY;
      if (above <= WRIST_TARGET_ABOVE_DECK && above >= WRIST_FLOOR_ABOVE_DECK) break;

      let best: { axis: "x" | "y" | "z"; sign: number; dY: number } | null = null;
      for (const axis of ["x", "y", "z"] as const) {
        for (const sign of [-1, 1] as const) {
          upper.rotation[axis] += sign * STEP_RAD;
          refreshSupineSkeleton(humanoidRoot);
          const probed = readBoneWorld(hand);
          upper.rotation[axis] -= sign * STEP_RAD;
          refreshSupineSkeleton(humanoidRoot);
          if (!probed) continue;
          const dY = probed.y - wrist.y;
          if (!best || dY < best.dY - 1e-6) best = { axis, sign, dY };
        }
      }
      if (!best || best.dY > -1e-4) break;

      upper.rotation[best.axis] += best.sign * STEP_RAD;
      refreshSupineSkeleton(humanoidRoot);
      const after = readBoneWorld(hand);
      if (after && after.y - deckTopWorldY < WRIST_FLOOR_ABOVE_DECK - 0.01) {
        // Overshoot: undo the step so the wrist stays above the deck (protects #150 penetration).
        upper.rotation[best.axis] -= best.sign * STEP_RAD;
        refreshSupineSkeleton(humanoidRoot);
        wrist = readBoneWorld(hand) ?? wrist;
        break;
      }
      wrist = after ?? wrist;
      sideRad += best.sign * STEP_RAD;
      axisApplied = best.axis;
      signApplied = best.sign;
      const key = `upper_arm${side}`;
      const prior = sideDeltas[key] ?? { x: 0, y: 0, z: 0 };
      sideDeltas[key] = {
        x: prior.x + (best.axis === "x" ? best.sign * STEP_RAD : 0),
        y: prior.y + (best.axis === "y" ? best.sign * STEP_RAD : 0),
        z: prior.z + (best.axis === "z" ? best.sign * STEP_RAD : 0),
      };
    }

    result.appliedRad += sideRad;
    result.wristsAboveDeck[side] = wrist.y - deckTopWorldY;
    for (const [name, spec] of Object.entries(sideDeltas)) {
      deltas[name] = spec;
    }
    humanoidRoot.userData.openClinXrSupineArmFlexDeltas = { ...deltas };
    humanoidRoot.userData.openClinXrSupineArmFlexRad = result.appliedRad;
    humanoidRoot.userData.openClinXrSupineArmFlexLastStep = { axis: axisApplied, sign: signApplied };
  }

  const pelvis = readBoneWorld(findSupineBone(humanoidRoot, "pelvis", "Pelvis"));
  if (head && pelvis) {
    for (const side of ["L", "R"] as const) {
      const upper = findSupineBone(humanoidRoot, `upper_arm${side}`, `upper_arm.${side}`);
      const forearm = findSupineBone(humanoidRoot, `forearm${side}`, `forearm.${side}`);
      const hand = findSupineBone(humanoidRoot, `hand${side}`, `hand.${side}`);
      if (!upper || !hand) continue;
      spreadWristBesideTorso({ humanoidRoot, upper, forearm, hand, pelvis, head, deckTopWorldY });
      const spreadWrist = readBoneWorld(hand);
      if (spreadWrist) result.wristsAboveDeck[side] = spreadWrist.y - deckTopWorldY;
    }
  }

  humanoidRoot.userData.openClinXrSupineArmHeadZRef = headZ;
  const stored: StoredArmBone[] = [];
  for (const side of ["L", "R"] as const) {
    for (const name of [`upper_arm${side}`, `forearm${side}`]) {
      const bone = findSupineBone(humanoidRoot, name, name.replace(/(L|R)$/u, ".$1"));
      if (!bone) continue;
      stored.push({
        name,
        quaternion: {
          x: bone.quaternion.x,
          y: bone.quaternion.y,
          z: bone.quaternion.z,
          w: bone.quaternion.w,
        },
      });
    }
  }
  humanoidRoot.userData.openClinXrSupineArmFlexBones = stored;
  humanoidRoot.updateMatrixWorld?.(true);
  return result;
}
