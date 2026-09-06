/**
 * Runtime wire: computeHumanoidEyeMotionMetrics' blinkIntensity → eye-*-closure FACS morphs (#379).
 *
 * WHY: the blink signal is a deterministic clock (4300 ms period, 200 ms window) and the MPFB
 * actors carry real eye-left/right-closure morphs that seal the lids, but nothing connected
 * them — intensity was consumed only by four hand-authored proxy objects the MPFB actors do
 * not have. This module drives the morph that is already in the bytes; nothing is authored
 * per actor, and a fourth actor blinks the day it ships (D9).
 *
 * Decisions (recorded, not locked by brief):
 * - Intensity→influence curve: linear (identity on [0,1]). Monotone and spans the range.
 * - The proxy-object path in main.ts stays for the Anny rail; this drives the morph path.
 * - eye-*-slit targets do not participate.
 *
 * claimScope: eyelid closure morph application only. notEvidenceFor blink timing realism,
 * anatomy / bind-pose, or clinical affect scoring.
 */

import {
  type MorphRootLike,
  resolveMorphIndex,
} from "./viseme-runtime-wire.js";

/** Canonical names the shared resolver maps onto MPFB FACS targets (#354). */
const LEFT_CLOSURE = "openclinxr_eye_left_closure";
const RIGHT_CLOSURE = "openclinxr_eye_right_closure";

export type BlinkClosureDriveResult = {
  /** The clamped influence actually written (equals blinkIntensity on [0,1]). */
  influence: number;
  /** Number of closure targets written across all meshes under root. */
  appliedTargetCount: number;
  /** Canonical closure names that resolved on at least one mesh. */
  targetNames: string[];
};

/**
 * Drive both lid-closure morphs on every mesh under root that carries them, from a blink
 * intensity in [0,1]. Missing dictionary names are skipped — a no-op for actors without the
 * targets (duck-typed, same shape as the viseme wire).
 */
export function applyBlinkClosureToRoot(
  root: MorphRootLike,
  blinkIntensity: number,
): BlinkClosureDriveResult {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(blinkIntensity) ? blinkIntensity : 0));
  const found = new Set<string>();
  let appliedTargetCount = 0;

  root.traverse((object) => {
    const mesh = object as {
      morphTargetDictionary?: Record<string, number>;
      morphTargetInfluences?: number[];
    } | null;
    if (!mesh?.morphTargetDictionary || !mesh.morphTargetInfluences?.length) {
      return;
    }
    const left = resolveMorphIndex(mesh.morphTargetDictionary, LEFT_CLOSURE);
    const right = resolveMorphIndex(mesh.morphTargetDictionary, RIGHT_CLOSURE);
    if (typeof left === "number") {
      mesh.morphTargetInfluences[left] = clamped;
      appliedTargetCount += 1;
      found.add(LEFT_CLOSURE);
    }
    if (typeof right === "number") {
      mesh.morphTargetInfluences[right] = clamped;
      appliedTargetCount += 1;
      found.add(RIGHT_CLOSURE);
    }
  });

  const targetNames = [...found].sort();
  if (root.userData) {
    root.userData.openClinXrBlinkClosureRuntimeCue = {
      blinkIntensity: Number(clamped.toFixed(3)),
      influence: Number(clamped.toFixed(3)),
      appliedTargetCount,
      targetNames,
      cueIds: ["named_blink_closure_morph_drive"],
      notEvidenceFor: "blink timing realism, production facial animation quality, or clinical affect scoring",
    };
  }

  return { influence: clamped, appliedTargetCount, targetNames };
}
