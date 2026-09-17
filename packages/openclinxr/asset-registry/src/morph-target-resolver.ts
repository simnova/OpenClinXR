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
 *   2. CASE-VARIANT second (#463) — the wire emits upper-cased tokens (`viseme_AA`); the visemes02
 *      pack bakes mixed case (`viseme_aa`, `viseme_kk`, `viseme_nn`, `viseme_sil`). A genuine
 *      case-only variant wins here, so a real baked viseme beats the FACS alias. Renaming the pack
 *      to suit the resolver would diverge a proven upstream asset (D1).
 *   3. FACS ALIAS MAP last — canonical runtime name → MPFB FACS morph name, wired from the FACS
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
  // Eye rows (#354): canonical eye expression names → shipped MPFB FACS eye targets
  // (eye-left-closure / -opened-up / -slit and the right-side mirrors, present on all
  // three shipped MPFB actors). The eye-inspection station (#354) checks these resolve
  // so a blink/expression drive can reach the eye morphs the bodies already carry.
  openclinxr_eye_left_closure: "eye-left-closure",
  openclinxr_eye_left_slit: "eye-left-slit",
  openclinxr_eye_left_opened_up: "eye-left-opened-up",
  openclinxr_eye_right_closure: "eye-right-closure",
  openclinxr_eye_right_slit: "eye-right-slit",
  openclinxr_eye_right_opened_up: "eye-right-opened-up",
};

/**
 * The case-only variant of `canonicalName` present in `availableNames`, or null. The caller has
 * already taken the exact-identity match, so only genuine case differences reach this pass.
 */
function resolveCaseVariant(
  canonicalName: string,
  availableNames: ReadonlySet<string>,
): string | null {
  const lower = canonicalName.toLowerCase();
  for (const name of availableNames) {
    if (name.toLowerCase() === lower) return name;
  }
  return null;
}

/**
 * Resolve a canonical runtime morph name to the name present on a given body.
 *
 * Identity-first (covers the Anny rail and any canonical-spelling body), then a case-insensitive
 * variant match (#463 — the wire upper-cases tokens but the visemes02 pack bakes mixed case), then
 * the MPFB FACS alias map. Returns null when no honest target exists — never a fabricated name,
 * never a fallback that changes which region deforms.
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
  const caseVariant = resolveCaseVariant(canonicalName, availableNames);
  if (caseVariant !== null) return caseVariant;
  const alias = MPFB_FACS_MORPH_NAMES[canonicalName];
  if (alias !== undefined && availableNames.has(alias)) return alias;
  return null;
}

/** One FACS target and the share of the canonical weight it carries. */
export type FacsTargetWeight = { readonly target: string; readonly scale: number };

/**
 * MULTI-TARGET expression groups (the residual named at MPFB_FACS_MORPH_NAMES).
 *
 * The 1:1 map drives `openclinxr_brow_concern` onto the LEFT inner brow alone, so an authored
 * emotion moved half a face; `openclinxr_cheek_tension` resolved to null because no cheek target
 * ships, so the third emotion channel drove nothing at all. Both are recorded above as deliberate
 * limits of a one-name resolver. This map is that resolver's multi-target counterpart.
 *
 * Every target below is verified present on the shipped MPFB bodies (47-target set on
 * mpfb-gown-adult-patient; the 32-name FACS intersection on the library bodies). Nothing is
 * invented: a target absent from a given body is filtered out at resolve time.
 *
 * ANATOMY, not convenience:
 * - concern/distress brow is FACS AU1 (inner brow raiser) plus AU4 (brow lowerer), bilaterally.
 *   AU4 carries less weight than AU1 so the shape reads as worry rather than anger.
 * - "cheek tension" has no cheek target on this topology. The honest carriers of facial tension
 *   in the shipped set are AU7 (lid tightener = `eye-*-slit`) and the nose compressor. Naming it
 *   cheek and driving the lid tightener is the closest true mapping; it is NOT a cheek raiser.
 */
export const MPFB_FACS_EXPRESSION_GROUPS: Readonly<Record<string, readonly FacsTargetWeight[]>> = {
  openclinxr_brow_concern: [
    { target: "eyebrows-left-inner-up", scale: 1 },
    { target: "eyebrows-right-inner-up", scale: 1 },
    { target: "eyebrows-left-down", scale: 0.45 },
    { target: "eyebrows-right-down", scale: 0.45 },
  ],
  openclinxr_cheek_tension: [
    { target: "eye-left-slit", scale: 0.85 },
    { target: "eye-right-slit", scale: 0.85 },
    { target: "nose-compression-uncompress", scale: 0.4 },
  ],
  openclinxr_mouth_open: [{ target: "mouth-open", scale: 1 }],
};

/**
 * Resolve a canonical runtime morph name to EVERY target it should drive on a given body.
 *
 * Identity and case-variant win first, so the Anny rail (which carries the canonical spellings)
 * is untouched and still drives exactly one target. Only when the canonical name is absent does
 * the multi-target FACS group apply, filtered to the targets this body actually carries. Falls
 * back to the 1:1 alias so no existing resolution is lost.
 *
 * Returns an empty array when nothing honest resolves — never a fabricated name.
 */
export function resolveMorphTargetGroup(
  canonicalName: string,
  availableNames: ReadonlySet<string>,
): readonly FacsTargetWeight[] {
  if (availableNames.has(canonicalName)) return [{ target: canonicalName, scale: 1 }];
  const caseVariant = resolveCaseVariant(canonicalName, availableNames);
  if (caseVariant !== null) return [{ target: caseVariant, scale: 1 }];
  const group = MPFB_FACS_EXPRESSION_GROUPS[canonicalName];
  if (group !== undefined) {
    const present = group.filter((entry) => availableNames.has(entry.target));
    if (present.length > 0) return present;
  }
  const alias = MPFB_FACS_MORPH_NAMES[canonicalName];
  if (alias !== undefined && availableNames.has(alias)) return [{ target: alias, scale: 1 }];
  return [];
}
