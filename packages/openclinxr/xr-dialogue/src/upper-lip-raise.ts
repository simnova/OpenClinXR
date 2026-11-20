/**
 * Upper-lip raise for open-vowel speech (upper-incisor-show P2).
 *
 * WHY: at held aa the upper lip covers the upper incisors on all three MPFB
 * actors (pre-fix aa central display -2.8 Aisha / -5.5 Kevin / -3.8 physician
 * mm). The cap53 native grade of the E/sweep sheets (2026-11-20) pins the
 * fix: body mouth-elevation weight 1.0 at held aa 0.5 moves the lip above the
 * incisal edge on every actor (sweep w=1 central display +2.57 / +1.44 /
 * +2.06 mm, each within its crown). Floor 0 mm is the sign of every cited
 * speech mean (Rao 2021 PMC7848132 Table 1: maximum upper incisal exposure in
 * speech 7.76 +- 1.75 mm, all means positive = edge below the lip).
 *
 * MAPPING: mouth-elevation = clamp(2 * w_aa, 0, 1), where w_aa is the
 * viseme_aa weight the named drive applied THIS frame (after dynamics, the
 * same weights object applyLipBoneRoundingToRoot receives). aa ONLY: no
 * other viseme contributes. Written by name on EVERY mesh whose
 * morphTargetDictionary carries "mouth-elevation" (the browser load has 9
 * such meshes per actor, headless 1).
 */

export const UPPER_LIP_RAISE_GAIN = 2;

export type UpperLipRaiseRootLike = {
  traverse: (callback: (object: unknown) => void) => void;
};

/**
 * Write the aa-driven upper-lip raise on every "mouth-elevation" host.
 * Silence (w_aa 0) writes 0, so a sil frame after aa clears the raise.
 * Returns the host count.
 */
export function applyUpperLipRaiseToRoot(
  root: UpperLipRaiseRootLike,
  weights: Record<string, number>,
): number {
  const raw = weights["viseme_aa"] ?? 0;
  const numeric = Number(raw);
  const value = Math.min(1, Math.max(0, (Number.isFinite(numeric) ? numeric : 0) * UPPER_LIP_RAISE_GAIN));
  let hosts = 0;
  root.traverse((object) => {
    const mesh = object as {
      morphTargetDictionary?: Record<string, number>;
      morphTargetInfluences?: number[];
    } | null;
    const dict = mesh?.morphTargetDictionary;
    const influences = mesh?.morphTargetInfluences;
    if (!dict || !influences) return;
    const index = dict["mouth-elevation"];
    if (typeof index !== "number" || !Number.isInteger(index)) return;
    if (index < 0 || index >= influences.length) return;
    influences[index] = value;
    hosts += 1;
  });
  return hosts;
}
