/**
 * Upper-lip raise for open-vowel speech (upper-incisor-show P2).
 *
 * WHY (aa): at held aa the upper lip covers the upper incisors on all three
 * MPFB actors (pre-fix aa central display -2.8 Aisha / -5.5 Kevin /
 * -3.8 physician mm). The cap53 native grade of the E/sweep sheets
 * (2026-11-20) pins the fix: body mouth-elevation weight 1.0 at held aa
 * 0.5 moves the lip above the incisal edge on every actor (sweep w=1
 * central display +2.57 / +1.44 / +2.06 mm, each within its crown).
 * Floor 0 mm is the sign of every cited speech mean (Rao 2021 PMC7848132
 * Table 1: maximum upper incisal exposure in speech 7.76 +- 1.75 mm, all
 * means positive = edge below the lip).
 *
 * MAPPING: mouth-elevation = clamp(max over the gain table of
 * gain_v * w_v, 0, 1), where w_v are the named-drive weights applied THIS
 * frame (after dynamics, the same weights object applyLipBoneRoundingToRoot
 * receives). MAX, not sum: an aa->E crossfade never exceeds either
 * viseme's own raise. I is excluded (A2 STOP, cap54 2026-11-22: at
 * mouth-elevation 1 held I stays -0.41/-1.55/-0.92 mm). Written by name
 * on EVERY mesh whose morphTargetDictionary carries "mouth-elevation"
 * (the browser load has 9 such meshes per actor, headless 1). Hosts
 * without a native "viseme_FF" are skipped: on FACS-only rigs the
 * resolver maps viseme_FV onto mouth-elevation and the raise must not
 * overwrite it.
 */

/** g_E=1: store upper-lip-spread/sweep/sweep.json sha256 3a89b094cc3cf372; MY GRADE cap54 2026-11-22 PASS (C5 E pair, Kevin weakest +0.39 mm) */
export const UPPER_LIP_RAISE_GAINS: Readonly<Record<string, number>> = { viseme_aa: 2, viseme_E: 1 };

/** Legacy scalar: the aa entry of the gain table (kept for the wire test (i)). */
export const UPPER_LIP_RAISE_GAIN = UPPER_LIP_RAISE_GAINS["viseme_aa"];

export type UpperLipRaiseRootLike = {
  traverse: (callback: (object: unknown) => void) => void;
};

/**
 * Write the table-driven upper-lip raise on every "mouth-elevation" host.
 * value = clamp(max over the table of gain_v * finite(w_v), 0, 1); a
 * viseme absent from the table contributes 0 and a non-finite weight
 * contributes 0. Silence (all weights 0) writes 0, so a sil frame after
 * aa or E clears the raise. Returns the host count.
 */
export function applyUpperLipRaiseToRoot(
  root: UpperLipRaiseRootLike,
  weights: Record<string, number>,
  gains: Readonly<Record<string, number>> = UPPER_LIP_RAISE_GAINS,
): number {
  let value = 0;
  // Iterate the closed table only: an override can change a listed gain (CW8 probe) but never add a viseme.
  for (const target of Object.keys(UPPER_LIP_RAISE_GAINS)) {
    const gain = Number(gains[target] ?? 0);
    const numeric = Number(weights[target] ?? 0);
    if (!Number.isFinite(numeric)) continue;
    const candidate = gain * numeric;
    if (candidate > value) value = candidate;
  }
  value = Math.min(1, Math.max(0, value));
  let hosts = 0;
  root.traverse((object) => {
    const mesh = object as {
      morphTargetDictionary?: Record<string, number>;
      morphTargetInfluences?: number[];
    } | null;
    const dict = mesh?.morphTargetDictionary;
    const influences = mesh?.morphTargetInfluences;
    if (!dict || !influences) return;
    if (!("viseme_FF" in dict)) return;
    const index = dict["mouth-elevation"];
    if (typeof index !== "number" || !Number.isInteger(index)) return;
    if (index < 0 || index >= influences.length) return;
    influences[index] = value;
    hosts += 1;
  });
  return hosts;
}
