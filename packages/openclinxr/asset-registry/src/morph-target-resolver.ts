/**
 * Facial morph-target name resolution (#308).
 *
 * The runtime drives facial morphs by canonical names (`openclinxr_mouth_open`,
 * `openclinxr_brow_concern`, `openclinxr_cheek_tension`) plus the ARKit-style `viseme_*` set. The
 * 7 Anny humanoids carry the three `openclinxr_*` canonical names directly, but the MPFB-topology
 * library bodies (`body-param-adult_lean_female-library.glb`, `body-param-adult_heavy_male-library.glb`)
 * carry 32 MPFB FACS names instead (`mouth-open`, `mouth-pursing`, `eye-left-closure`,
 * `eyebrows-*-inner-up`, ...). A missing dictionary name is a SILENT SKIP in both consumers
 * (`applyVisemeWeights` and the `main.ts` morph cue), so the only real graded facial morphs in the
 * repo were unreachable by the runtime.
 *
 * Resolution strategy (measured 2026-08-11, contract `mouth-morph-resolves-on-mpfb-bodies.test.ts`):
 *
 *   1. IDENTITY first — a body that already carries the canonical name resolves to itself. This
 *      covers the Anny rail and any MPFB body that happens to use the canonical spelling, unchanged.
 *   2. FACS ALIAS MAP second — canonical runtime name → MPFB FACS morph name, wired from the FACS
 *      target names actually shipped on the library bodies (verified present on both), not invented.
 *
 * WHY THE MAP IS ONLY THESE TWO ENTRIES: the runtime drives exactly three `openclinxr_*` canonical
 * expression names plus the `viseme_*` speech names. The MPFB library bodies carry no `viseme_*`
 * targets at all (that is #224's bake fix, not a resolution fix), so no viseme alias can exist.
 * `openclinxr_cheek_tension` has no honest FACS equivalent in the shipped 32-target set (no cheek
 * target ships), so it resolves to null on those bodies — same silent-skip as today, but now a
 * deliberate null rather than an accidental miss.
 *
 * THE COUNTERWEIGHT IS ANATOMICAL ORDERING, not gradedness. All 32 library morphs are graded
 * (sd>0, >1 direction), so "the resolved morph must be graded" refuses nothing once any present
 * name resolves (§7t). The ordering check — resolved brow sits above resolved mouth on the same
 * body — is what rejects the cheap fixes: returning one name for every request, or swapping mouth
 * and brow. Measured: `mouth-open` centroid Y 0.8839, `eyebrows-left-inner-up` centroid Y 0.9365
 * on `adult_lean_female`; 0.884 / 0.9358 on `adult_heavy_male`.
 *
 * claimScope: morph-target NAME resolution only. notEvidenceFor anatomical correctness of the FACS
 * morphs, runtime rendering, or viseme timing.
 */

/**
 * MPFB FACS morph names (library rail) for the canonical runtime expression names.
 *
 * Brow maps to the LEFT inner-up target only. The FACS library splits left/right; the canonical
 * runtime name drives a single index, and the 1:1 resolver returns one name. Driving both brows
 * would need a multi-target map — a residual, not a stub.
 */
export const MPFB_FACS_MORPH_NAMES: Readonly<Record<string, string>> = {
  openclinxr_mouth_open: "mouth-open",
  openclinxr_brow_concern: "eyebrows-left-inner-up",
};

/**
 * Resolve a canonical runtime morph name to the name present on a given body.
 *
 * Identity-first (covers the Anny rail and any canonical-spelling body), then the MPFB FACS alias
 * map. Returns null when no honest target exists — never a fabricated name, never a fallback that
 * changes which region deforms.
 *
 * @param canonicalName  Canonical runtime morph name (e.g. `openclinxr_mouth_open`).
 * @param availableNames  Morph target names present on the body (`morphTargetDictionary` keys).
 * @returns the target name to drive on this body, or null when the canonical cannot be resolved.
 */
export function resolveMorphTarget(
  canonicalName: string,
  availableNames: ReadonlySet<string>,
): string | null {
  if (availableNames.has(canonicalName)) return canonicalName;
  const alias = MPFB_FACS_MORPH_NAMES[canonicalName];
  if (alias !== undefined && availableNames.has(alias)) return alias;
  return null;
}
