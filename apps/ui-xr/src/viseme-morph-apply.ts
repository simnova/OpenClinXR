/**
 * Apply named viseme morph weights by dictionary lookup (#62).
 *
 * WHY: `main.ts` `applyGeneratedDriveViseme` (~8496) writes
 * `object.morphTargetInfluences[0] = weight` — index zero, no name resolution — so every
 * phoneme drives whichever target sits at index 0. #45's `driveVisemeTimeline` already
 * resolves phonemes to real viseme target *names*; this is the missing downstream that can
 * apply those weights onto the correct morph indices.
 *
 * #308 wiring: every requested name is resolved through `resolveMorphTarget` first —
 * identity-first (the Anny rail carries the canonical names), then the MPFB FACS alias map
 * for the library bodies, which carry `mouth-open` / `eyebrows-*-inner-up` instead of the
 * `openclinxr_*` / `viseme_*` spellings the runtime asks for. A miss stays a silent skip.
 *
 * Decisions recorded here (not locked by the brief):
 * - **Only write requested names.** Do not zero non-active viseme targets — callers that want
 *   exclusive activation (e.g. `driveVisemeTimeline`) already emit full maps with zeros.
 * - **Missing dictionary names are skipped** (partial GLBs / optional targets). No throw, no
 *   invent index.
 *
 * claimScope: mouth morph application only. notEvidenceFor anatomy / body proportions.
 */

import { resolveMorphTarget } from "@openclinxr/asset-registry";

export type MorphTargetLike = {
  morphTargetDictionary: Record<string, number>;
  morphTargetInfluences: number[];
};

/**
 * Resolve a canonical runtime morph name to a dictionary index on a given body, or undefined.
 * The single choke-point for morph-name resolution in the ui-xr runtime (#308).
 */
export function resolveMorphIndex(
  dict: Record<string, number>,
  canonicalName: string,
): number | undefined {
  const resolved = resolveMorphTarget(canonicalName, new Set(Object.keys(dict)));
  return resolved === null ? undefined : dict[resolved];
}

/**
 * #730: accumulate the first per-mesh resolution of each canonical name onto `acc` (null until a
 * mesh under the root resolves it). The viseme-drive capture records the result in
 * mouth-open-channel.json so the runtime's own alias resolution is attested, not re-derived.
 */
export function collectResolvedMorphTargets(
  dict: Record<string, number>,
  acc: Record<string, string | null>,
): void {
  for (const canonical of Object.keys(acc)) {
    if (acc[canonical] !== null) continue;
    const resolved = resolveMorphTarget(canonical, new Set(Object.keys(dict)));
    if (resolved !== null) acc[canonical] = resolved;
  }
}

/**
 * Write each named weight to the morph index its name maps to in `morphTargetDictionary`.
 * Index 0 is never privileged: only written when a requested name resolves to 0.
 */
/**
 * #460 — cap FACS `mouth-open` at 0.3: the last weight where the parent's face survives.
 * Graded from #459's sweep (`mouth-open-sweep-sheet.png`, graded twice): 0.3 ACCEPTABLE,
 * 0.6 DEGRADING, 1.0 UNACCEPTABLE. The shipped parent carries no `viseme_AA`, so the runtime's
 * AA maps onto `mouth-open`; without this cap a full-weight AA request renders the unacceptable
 * cell. Only the swept target is capped — capping unmeasured targets would be inventing
 * thresholds (#460 NOT TESTED). Applied on the RESOLVED name, so a direct `mouth-open` request
 * and the `viseme_AA` alias both land at the cap.
 */
export const MOUTH_OPEN_CAP = 0.3;
const CAPPED_FACS_TARGET = "mouth-open";

export function applyVisemeWeights(
  target: MorphTargetLike,
  weights: Record<string, number>,
): void {
  const dict = target.morphTargetDictionary;
  const influences = target.morphTargetInfluences;
  if (!dict || !influences || influences.length === 0) {
    return;
  }
  const availableNames = new Set(Object.keys(dict));

  for (const [name, weight] of Object.entries(weights)) {
    const resolved = resolveMorphTarget(name, availableNames);
    if (resolved === null) {
      continue;
    }
    const index = dict[resolved];
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
    const clamped = Math.min(1, Math.max(0, numeric));
    influences[index] = resolved === CAPPED_FACS_TARGET ? Math.min(MOUTH_OPEN_CAP, clamped) : clamped;
  }
}
