/**
 * Supine extremity flex for seat clearance (#171).
 * Knee/hip flex lifts mesh through the seat without root translate (which reopens back gap).
 * Deltas persist on userData and re-apply after per-frame applySupinePose absolute eulers.
 *
 * claimScope: staging clearance only.
 * notEvidenceFor: clinical lying pose, multi-joint bed fidelity.
 */

import { resolvePoseBone } from "@openclinxr/asset-registry";
import type { Object3D } from "three";
import { measureSeatClearanceMeters } from "./hob-contact-metrics.js";
import { collectJointNames, sanitiseBoneName } from "./pose-bone-runtime.js";

/** Bone names: GLB has dots; three.js may sanitize to undotted. Match both. */
export function findSupineBone(humanoidRoot: Object3D, ...names: string[]): Object3D | null {
  // #306: the shin/thigh landmarks resolve to `lowerleg01L` / `upperleg01L` on MPFB2 rigs, so
  // add the resolved names to the wanted set instead of only the canonical/dotted spellings.
  const want = new Set(names);
  const jointNames = collectJointNames(humanoidRoot);
  for (const name of names) {
    const resolved = resolvePoseBone(sanitiseBoneName(name), jointNames);
    if (resolved !== null) want.add(resolved);
  }
  let found: Object3D | null = null;
  const consider = (object: Object3D) => {
    if (found) return;
    if (!want.has(object.name) && !want.has(sanitiseBoneName(object.name))) return;
    const isBone = (object as Object3D & { isBone?: boolean }).isBone === true
      || (object as Object3D & { type?: string }).type === "Bone";
    if (!isBone) return;
    found = object;
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
  return found;
}

/**
 * Raise extremities through the seat by joint flex — does not translate the root.
 * Probes local axes (on-back basis reorients); keeps only steps that improve skinned clearance.
 * Legs only — arm flex pulls wrists inside the rib cage and fails #153 lateral.
 */
export function raiseSupineFeetOntoSeat(humanoidRoot: Object3D, deckTopY: number): number {
  humanoidRoot.updateMatrixWorld?.(true);
  const bones = {
    shinL: findSupineBone(humanoidRoot, "shinL", "shin.L"),
    shinR: findSupineBone(humanoidRoot, "shinR", "shin.R"),
    thighL: findSupineBone(humanoidRoot, "thighL", "thigh.L"),
    thighR: findSupineBone(humanoidRoot, "thighR", "thigh.R"),
  };
  humanoidRoot.userData.openClinXrSupineFootBonesFound = Object.fromEntries(
    Object.entries(bones).map(([k, v]) => [k, Boolean(v)]),
  );

  const refresh = () => {
    humanoidRoot.updateMatrixWorld?.(true);
    humanoidRoot.traverse((object) => {
      const skinned = object as Object3D & {
        isSkinnedMesh?: boolean;
        skeleton?: { update?: () => void };
      };
      if (skinned.isSkinnedMesh) skinned.skeleton?.update?.();
    });
  };

  const applyDelta = (axis: "x" | "y" | "z", shinD: number, thighScale: number) => {
    if (bones.shinL) bones.shinL.rotation[axis] += shinD;
    if (bones.shinR) bones.shinR.rotation[axis] += shinD;
    if (bones.thighL) bones.thighL.rotation[axis] += shinD * thighScale;
    if (bones.thighR) bones.thighR.rotation[axis] += shinD * thighScale;
  };

  let totalFlex = 0;
  let bestAxis: "x" | "y" | "z" = "x";
  let bestSign = -1;
  let bestClear = measureSeatClearanceMeters(humanoidRoot, deckTopY);
  if (bestClear >= -0.04) {
    humanoidRoot.userData.openClinXrSupineFootFlexRad = 0;
    humanoidRoot.userData.openClinXrSupineFootFlexDeltas = {};
    return 0;
  }
  const probe = 0.2;
  for (const axis of ["x", "y", "z"] as const) {
    for (const sign of [-1, 1] as const) {
      applyDelta(axis, sign * probe, 0.45);
      refresh();
      const c = measureSeatClearanceMeters(humanoidRoot, deckTopY);
      applyDelta(axis, -sign * probe, 0.45);
      refresh();
      if (c > bestClear + 1e-4) {
        bestClear = c;
        bestAxis = axis;
        bestSign = sign;
      }
    }
  }

  let shinTotal = 0;
  let thighTotal = 0;
  for (let pass = 0; pass < 20; pass += 1) {
    const before = measureSeatClearanceMeters(humanoidRoot, deckTopY);
    if (before >= -0.04) break;
    const delta = bestSign * 0.12;
    const thighScale = 0.5;
    applyDelta(bestAxis, delta, thighScale);
    refresh();
    const after = measureSeatClearanceMeters(humanoidRoot, deckTopY);
    if (after < before - 1e-4) {
      applyDelta(bestAxis, -delta, thighScale);
      refresh();
      break;
    }
    shinTotal += delta;
    thighTotal += delta * thighScale;
    totalFlex += Math.abs(delta);
    if (after - before < 1e-4) break;
  }
  humanoidRoot.userData.openClinXrSupineFootFlexDeltas = {
    shinL: { axis: bestAxis, delta: shinTotal },
    shinR: { axis: bestAxis, delta: shinTotal },
    thighL: { axis: bestAxis, delta: thighTotal },
    thighR: { axis: bestAxis, delta: thighTotal },
  };
  humanoidRoot.userData.openClinXrSupineFootFlexRad = totalFlex;
  humanoidRoot.userData.openClinXrSupineFootFlexAxis = `${bestSign < 0 ? "-" : "+"}${bestAxis}`;
  return totalFlex;
}

/** Restore plant-time extremity flex after applySupinePose resets absolute eulers. */
export function reapplyStoredSupineFootFlex(humanoidRoot: Object3D): void {
  const stored = humanoidRoot.userData?.openClinXrSupineFootFlexDeltas as
    | Record<string, { axis: "x" | "y" | "z"; delta: number }>
    | undefined;
  if (!stored) return;
  for (const [name, spec] of Object.entries(stored)) {
    if (!spec || !Number.isFinite(spec.delta) || Math.abs(spec.delta) < 1e-5) continue;
    const bone = findSupineBone(humanoidRoot, name, name.replace("L", ".L").replace("R", ".R"));
    if (!bone) continue;
    bone.rotation[spec.axis] += spec.delta;
  }
}
