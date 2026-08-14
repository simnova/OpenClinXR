import { isFittedHairMeshName } from "../../../apps/ui-xr/src/head-box-from-geometry.js";

/**
 * #389 — shared upper-garment slot classifier for MPFB cast GLBs.
 *
 * The garment-smoothness contracts each carried their own /t_shirt|scrub_shirt/ regex
 * to locate the upper garment's hem (the denominator of their ratios). #199 swapped the
 * nurse's upper for `toigo_fisherman_sweater` and all three went blind at once — the
 * matcher keyed on garment NAMES and the list went stale in three copies. This keys on
 * the SLOT instead of the name: a makeclothes library garment that is not the lower slot
 * (pants/trousers), not the foot slot (footwear/shoes/boots) and not the eye slot is the
 * UPPER slot, whatever it is called. A new upper garment (sweater, cardigan, gown, top)
 * matches with no list edit; only a new NON-upper library slot would need its marker
 * added to the exclusions below.
 */
export function isUpperGarmentName(materialName: string): boolean {
  const n = materialName.toLowerCase();
  if (!n.includes("makeclothes_library")) return false;
  if (/cargo_pants|trousers?|pants/.test(n)) return false;
  if (/footwear|shoe|boots?/.test(n)) return false;
  if (/eye/.test(n)) return false;
  return true;
}

/**
 * #391 — fitted garments of ANY slot and fitted hair are NOT body geometry.
 *
 * The body-strip RED measures the BODY only, so it must exclude everything the factory fit
 * onto it. `isUpperGarmentName` above filters the makeclothes rail to the UPPER slot; the
 * body-strip measurement needs the rail gate without the slot filter, so a new garment of
 * any slot (upper, lower, foot, eye) matches with no list edit. Fitted hair is not body
 * either: the MakeClothes embed names hair materials with "hair", and this is the same
 * `isFittedHairMeshName` rule the head-box framing uses (#394) — imported, not a third
 * vocabulary, so the two consumers cannot drift apart.
 */
export function isMakeClothesGarmentName(materialName: string): boolean {
  return materialName.toLowerCase().includes("makeclothes_library");
}

/** A fitted makeclothes garment of any slot, or fitted hair — non-body geometry on an MPFB cast. */
export function isFittedNonBodyName(materialName: string): boolean {
  return isMakeClothesGarmentName(materialName) || isFittedHairMeshName(materialName);
}
