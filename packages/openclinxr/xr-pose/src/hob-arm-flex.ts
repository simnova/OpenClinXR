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

/**
 * Sweep the recumbent arms down so the wrists rest near the deck, closed-loop against the live
 * wrist world Y. Each pass probes ±x/±y/±z on the upper arm and applies the step that lowers the
 * wrist most; the loop stops when the wrist enters the band, when a step would drive it below the
 * floor (overshoot — undo and stop), or when no step lowers it (bottom of the arm's arc). Only the
 * upper arm rotates — the forearm and hand follow rigidly, so the wrist stays outside the ribs
 * while the lateral settles inside the rails. Deltas persist on userData for evidence; on this
 * rail applySupinePose re-applies only the root quat per frame, so the flex holds in the room.
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

  humanoidRoot.userData.openClinXrSupineArmHeadZRef = headZ;
  humanoidRoot.updateMatrixWorld?.(true);
  return result;
}
