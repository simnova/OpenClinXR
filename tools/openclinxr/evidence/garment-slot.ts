import { classifyGarmentMeshName, isUpperMeshName } from "./lib/garment-mesh-class.js";

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
 *
 * Slot vocabulary now comes from the one shared classifier
 * (`lib/garment-mesh-class.js`): upper-slot = the classifier's upper class, plus fitted
 * library hair, which the original exclusion list let through (it is neither lower, foot
 * nor eye) and which waistband-ring's traversal-order hem pick depends on. The
 * makeclothes_library rail gate is unchanged: legacy `openclinxr_*` shells are a
 * different rail with their own consumers. Population identical to the old regex on
 * every shipped GLB (verified by the waistband same-instrument check).
 */
export function isUpperGarmentName(materialName: string): boolean {
  const n = materialName.toLowerCase();
  if (!n.includes("makeclothes_library")) return false;
  if (isUpperMeshName(materialName)) return true;
  return classifyGarmentMeshName(materialName) === "hair";
}

/**
 * #391 — fitted garments of ANY slot and fitted hair are NOT body geometry.
 *
 * The body-strip RED measures the BODY only, so it must exclude everything the factory fit
 * onto it. `isUpperGarmentName` above filters the makeclothes rail to the UPPER slot; the
 * body-strip measurement needs every fitted part excluded, so a new garment of
 * any slot (upper, lower, foot, eye) or a new fitted face part (brow, lash,
 * teeth, tongue — #542 landed all four on every actor 2026-08-21) matches with
 * no list edit. Keyed on the one shared classifier: `unknown` stays body, so
 * helper shells (`mpfb_helper_shell_mat`) and painted body regions still count
 * as body and the destructive probe keeps its discriminator.
 */
export function isMakeClothesGarmentName(materialName: string): boolean {
  return materialName.toLowerCase().includes("makeclothes_library");
}

/** A fitted garment, fitted hair, or fitted face part — non-body geometry on an MPFB cast. */
export function isFittedNonBodyName(materialName: string): boolean {
  const cls = classifyGarmentMeshName(materialName);
  return (
    cls === "upper"
    || cls === "lower"
    || cls === "footwear"
    || cls === "hair"
    || cls === "eyes"
    || cls === "brow"
    || cls === "lash"
    || cls === "teeth"
    || cls === "tongue"
  );
}
