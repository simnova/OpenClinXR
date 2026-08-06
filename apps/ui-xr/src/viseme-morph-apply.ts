/**
 * Apply named viseme morph weights by dictionary lookup (#62).
 *
 * WHY: `main.ts` `applyGeneratedDriveViseme` (~8496) writes
 * `object.morphTargetInfluences[0] = weight` — index zero, no name resolution — so every
 * phoneme drives whichever target sits at index 0. #45's `driveVisemeTimeline` already
 * resolves phonemes to real viseme target *names*; this is the missing downstream that can
 * apply those weights onto the correct morph indices.
 *
 * Decisions recorded here (not locked by the brief):
 * - **Not wired into `main.ts` this slice.** The live path still feeds a scalar weight with no
 *   viseme name (`applyGeneratedDriveViseme(root, weight)`). Connecting needs a follow-on that
 *   passes named weights from `driveVisemeTimeline` frames; main.ts is size-frozen at 10240.
 * - **Only write requested names.** Do not zero non-active viseme targets — callers that want
 *   exclusive activation (e.g. `driveVisemeTimeline`) already emit full maps with zeros.
 * - **Missing dictionary names are skipped** (partial GLBs / optional targets). No throw, no
 *   invent index.
 *
 * claimScope: mouth morph application only. notEvidenceFor anatomy / body proportions.
 */

export type MorphTargetLike = {
  morphTargetDictionary: Record<string, number>;
  morphTargetInfluences: number[];
};

/**
 * Write each named weight to the morph index its name maps to in `morphTargetDictionary`.
 * Index 0 is never privileged: only written when a requested name resolves to 0.
 */
export function applyVisemeWeights(
  target: MorphTargetLike,
  weights: Record<string, number>,
): void {
  const dict = target.morphTargetDictionary;
  const influences = target.morphTargetInfluences;
  if (!dict || !influences || influences.length === 0) {
    return;
  }

  for (const [name, weight] of Object.entries(weights)) {
    const index = dict[name];
    if (typeof index !== "number" || !Number.isInteger(index)) {
      continue;
    }
    if (index < 0 || index >= influences.length) {
      continue;
    }
    const numeric = Number(weight);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    influences[index] = Math.min(1, Math.max(0, numeric));
  }
}
