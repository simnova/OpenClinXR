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
 * WHY THE MAP HAS VISEME ROWS (#353): a `viseme_*` TARGET is not required for a viseme to be
 * drivable — MADR 0052's capability table says "face action units ship and visemes must be COMPOSED
 * from them — FACS-style". Measured 2026-08-12 (`.openclinxr/evidence/mpfb-visemes/pre-fix.json`):
 * all five MPFB bodies (aisha / nurse Kevin / child + both hm08 library bodies) ship 13 mouth/lip/jaw
 * action units, every one a graded deformation, and 0 of 9 visemes resolved before this change. The
 * rows below map each ARKit-style viseme the runtime asks for (`viseme_sil AA E IH OH OU FV TH L`) to
 * the single best-fitting mouth action unit, chosen from the 12-name intersection present on every
 * MPFB body (the actors carry a `.001` dedup duplicate of `mouth-depression-retraction` where the
 * library bodies carry `mouth-depression`; neither is used). This is a 1:1 map — the whole of what a
 * one-name resolver can deliver; true per-phoneme FACS composition (several units blended per
 * viseme) is the named residual, and a `viseme_*` name a body already carries still wins via IDENTITY
 * first (the Anny rail is untouched).
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
  // Speech rows (#353): ARKit-style runtime names → best-fitting shipped mouth action unit.
  // Assigned from the pre-fix measurement (gradedness + mean displacement direction) and FACS
  // family; every target below is in the 12-name intersection present on all five MPFB bodies.
  // IH and TH share mouth-part-later: the lips-part (AU25) family has three runtime visemes
  // (IH/TH/L) and two shipped targets, and the near-closed lingual L fits the subtle variant.
  viseme_sil: "mouth-compression", // AU24 lip presser — the only closed-lips shape
  viseme_AA: "mouth-open", // AU26 jaw drop — the open vowel; strongest target, moves down
  viseme_E: "mouth-retraction", // AU20 lip stretcher — the spread vowel
  viseme_IH: "mouth-part-later", // AU25 lips part — the slight-open vowel
  viseme_OH: "mouth-eversion", // lips roll outward — the rounded open vowel
  viseme_OU: "mouth-protusion", // AU18 lip pucker — the tight rounded vowel
  viseme_FV: "mouth-elevation", // lip raise — the labiodental (f/v) is the lip-raise phoneme
  viseme_TH: "mouth-part-later", // AU25 lips part — tongue-gap consonant (shares with IH)
  viseme_L: "mouth-parling", // subtle lip part — near-closed lingual (t/d/n/l/r)
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
