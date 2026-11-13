/**
 * R1c nurse chest-stage split (E9 rehide-poking-skin.py): the SINGLE shared
 * predicate for the E9 downstream change. Both the R3 lash allowance
 * (makeclothes-evidence shipped-lash-follow-nurse-chest-split.ts
 * chestSplitBodyEqual, via shipped-lash-follow-geometry.ts) and the T3 protected-row exception (humanoid-bake-evidence
 * the-shipped-teeth-carry-their-texture.test.ts) call {@link isNurseChestStageSplit};
 * no second copy of this rule exists.
 *
 * Owning gate: packages/openclinxr/stations/humanoid-vetting-evidence/src/humanoid-vetting/the-adult-nurse-chest-shows-no-skin-through-the-scrub.test.ts.
 * This pin moves only on a new chest rehide stage (a new rehide-poking-skin.py run changes the split).
 *
 * Source: shipped GLB sha256 8957543dfc9f0fcacafd942c432f12947dd00d8f370ba3c519f6cb8ff9b1be86
 * (e9-r1 rehide-poking-skin.py output, installed by ceo/e9-install); the tool moves the
 * 92 posed-converged SAFE'' body-skin tris poking through the scrub shirt back under
 * the hide mask, patch-prim-in-place: prim0 shrinks 24966 -> 24690 indices
 * (8322 -> 8230 tris) and the moved 92 land in a new hidden prim8 (276 indices).
 * Union verified in-run: sorted(live prim0 + live prim8) == sorted(baseline prim0)
 * exactly (no triangle lost or added); prims 1-7 indices byte-identical;
 * attributes/morphs shared (C4 of the owning gate pins non-index accessors
 * and image payloads byte-equal to the pre-image).
 *
 * The 2 hashes below are the full sha256 of the 2 new INDICES accessor byte buffers
 * (accessor 1985: moved skin prim0; accessor 2857: new hidden prim8).
 * Roles are bound: the kept prim MUST carry the kept pin and the hidden prim
 * the hidden pin (a swapped pair is refused even though both shas are in the
 * set). No caller keeps its own copy of this rule.
 *
 * Exact bindings (e9-r2d M2): the hidden prim references the SAME attribute
 * accessor indices (POSITION 2018, NORMAL 2019, TEXCOORD_0 2020,
 * JOINTS_0 2021, WEIGHTS_0 2022) and the SAME morph-target accessor indices
 * as the baseline prim0 — compared by accessor index identity, not by byte
 * signature, so a prim8 repointed at a byte-identical duplicate accessor is
 * refused. The hidden prim carries the exact hide material the E9 stage
 * writes (material index 5,
 * openclinxr_hidden_upper_mpfb_ed_chest_pain_nurse_adult_body_mesh: the first
 * openclinxr_hidden_* primitive's material in the pre-image, reused by
 * rehide-poking-skin.py); any other openclinxr_hidden_* material is refused.
 * The kept prim keeps the baseline prim's material (index 4, mpfb_skin).
 *
 * Pure (no `node:` or glTF imports): kept/hidden/baseline are caller-decoded
 * index arrays plus their precomputed sha256 hex digests, accessor-index maps,
 * and material names/indices; the chain is the caller-walked newest-first
 * derivationArgv list. Fits the asset-registry browser-safe pattern
 * (cf humanoid-body-mesh.ts: self-contained predicate).
 */

export const NURSE_CHEST_STAGE_ACTOR = "mpfb-clinical-nurse-adult";
export const NURSE_CHEST_STAGE_KEPT_INDICES_SHA256 =
  "f424cfc43bf97e716c776ef8dba10b5a953601c27fbbf7e6835716ac99220523"; // 1985 moved skin prim0 (24690 idx = 8230 tris; was 24966)
const NURSE_CHEST_STAGE_HIDDEN_INDICES_SHA256 =
  "554f04f8f4dcbebcbcea2c859aa48fa476dff1cbc3ea462b1c6be47dac666d8b"; // 2857 new hidden prim8 (276 idx = 92 tris)
export const NURSE_CHEST_STAGE_INDICES_SHA256: readonly string[] = [
  NURSE_CHEST_STAGE_KEPT_INDICES_SHA256,
  NURSE_CHEST_STAGE_HIDDEN_INDICES_SHA256,
];

/** Exact hide material the E9 stage writes (not exported: surface stays 4). */
const NURSE_CHEST_STAGE_HIDDEN_MATERIAL =
  "openclinxr_hidden_upper_mpfb_ed_chest_pain_nurse_adult_body_mesh";
/** Material index of the exact hide material in the pre-image and the live GLB. */
const NURSE_CHEST_STAGE_HIDDEN_MATERIAL_INDEX = 5;
/** argv fragment identifying the E9 rehide level in a byteLineage chain. */
const NURSE_CHEST_STAGE_REHIDE_MARKER = "rehide-poking-skin.py";
/** argv fragment identifying the teeth-swap level the rehide must be newer than. */
const NURSE_CHEST_STAGE_SWAP_MARKER = "swap_teeth.py";

type NurseChestSplitWitness = {
  /**
   * sha256 hex of the kept skin prim's raw INDICES bytes.
   * Role-bound: MUST equal the kept pin below (M1).
   */
  keptIndicesSha256: string;
  /**
   * sha256 hex of the new hidden prim's raw INDICES bytes.
   * Role-bound: MUST equal the hidden pin below (M1).
   */
  hiddenIndicesSha256: string;
  /** kept prim's vertex indices, sorted ascending. */
  keptSortedIndices: readonly number[];
  /** hidden prim's vertex indices, sorted ascending. */
  hiddenSortedIndices: readonly number[];
  /** pre-E9 prim's vertex indices, sorted ascending. */
  baselineSortedIndices: readonly number[];
  /** kept prim's attribute accessor indices by semantic (must equal the baseline prim's). */
  keptAttrAccessors: Record<string, number>;
  /** hidden prim's attribute accessor indices by semantic (must equal the baseline prim's). */
  hiddenAttrAccessors: Record<string, number>;
  /** pre-E9 prim's attribute accessor indices by semantic. */
  baselineAttrAccessors: Record<string, number>;
  /** kept prim's morph-target accessor indices by target then semantic (must equal the baseline prim's). */
  keptTargetAccessors: ReadonlyArray<Record<string, number>>;
  /** hidden prim's morph-target accessor indices by target then semantic (must equal the baseline prim's). */
  hiddenTargetAccessors: ReadonlyArray<Record<string, number>>;
  /** pre-E9 prim's morph-target accessor indices by target then semantic. */
  baselineTargetAccessors: ReadonlyArray<Record<string, number>>;
  /** material index of the kept prim (must equal the baseline prim's). */
  keptMaterialIndex: number;
  /** material index of the hidden prim (must be the exact E9 hide material index). */
  hiddenMaterialIndex: number;
  /** material index of the pre-E9 prim. */
  baselineMaterialIndex: number;
  /** material name of the kept prim (must equal the baseline prim's). */
  keptMaterial: string;
  /** material name of the hidden prim (must be the exact E9 hide material). */
  hiddenMaterial: string;
  /** material name of the pre-E9 prim. */
  baselineMaterial: string;
  /**
   * Newest-first derivationArgv chain (e.g. sidecar byteLineage walked newest
   * first). Omit where no sidecar is available (lash geometry): the pin +
   * union checks still apply. Where given, the chain must contain an E9
   * rehide level newer than the teeth-swap level.
   */
  derivationArgvs?: readonly (readonly string[] | undefined)[] | undefined;
}

function attrAccessorsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key, i) => key === keysB[i] && a[key] === b[keysB[i]!]);
}

function targetAccessorsEqual(
  a: ReadonlyArray<Record<string, number>>,
  b: ReadonlyArray<Record<string, number>>,
): boolean {
  if (a.length !== b.length) return false;
  return a.every((target, i) => attrAccessorsEqual(target, b[i]!));
}

/**
 * True iff the kept/hidden pair is exactly the pinned E9 split: the kept prim
 * carries the KEPT pin and the hidden prim the hidden pin (M1 role binding: a
 * swapped pair is refused even though both shas are in the pin set), the
 * sorted index union equals the pre-E9 prim (no triangle lost or added), both
 * prims reference the SAME attribute/morph-target accessor indices as the
 * baseline prim (M2 index identity: a prim8 repointed at a byte-identical
 * duplicate accessor is refused), the kept prim keeps the baseline material
 * (index + name) and the hidden prim carries the exact E9 hide material
 * (index + name; any other openclinxr_hidden_* material is refused),
 * and — where a chain is given — an E9 rehide level is newer than the swap level.
 */
export function isNurseChestStageSplit(witness: NurseChestSplitWitness): boolean {
  // M1 role binding: kept must equal the KEPT pin, hidden the hidden pin.
  if (witness.keptIndicesSha256 !== NURSE_CHEST_STAGE_KEPT_INDICES_SHA256) return false;
  if (witness.hiddenIndicesSha256 !== NURSE_CHEST_STAGE_HIDDEN_INDICES_SHA256) return false;
  if (
    witness.keptSortedIndices.length + witness.hiddenSortedIndices.length !==
    witness.baselineSortedIndices.length
  ) {
    return false;
  }
  const merged = [...witness.keptSortedIndices, ...witness.hiddenSortedIndices].sort((a, b) => a - b);
  for (let i = 0; i < merged.length; i += 1) {
    if (merged[i] !== witness.baselineSortedIndices[i]) return false;
  }
  // The E9 split is patch-prim-in-place: both new prims share the baseline
  // prim's attribute/morph accessors exactly — compared by accessor INDEX
  // identity, not byte signatures. A prim8 whose attributes/targets point at
  // another existing accessor (same bytes elsewhere, wrong binding here)
  // must refuse.
  if (!attrAccessorsEqual(witness.keptAttrAccessors, witness.baselineAttrAccessors)) return false;
  if (!attrAccessorsEqual(witness.hiddenAttrAccessors, witness.baselineAttrAccessors)) return false;
  if (!targetAccessorsEqual(witness.keptTargetAccessors, witness.baselineTargetAccessors)) return false;
  if (!targetAccessorsEqual(witness.hiddenTargetAccessors, witness.baselineTargetAccessors)) return false;
  if (witness.keptMaterialIndex !== witness.baselineMaterialIndex) return false;
  if (witness.keptMaterial !== witness.baselineMaterial) return false;
  if (witness.hiddenMaterialIndex !== NURSE_CHEST_STAGE_HIDDEN_MATERIAL_INDEX) return false;
  if (witness.hiddenMaterial !== NURSE_CHEST_STAGE_HIDDEN_MATERIAL) return false;
  if (witness.derivationArgvs !== undefined) {
    const joined = witness.derivationArgvs.map((argv) => (argv ?? []).join(" "));
    const rehide = joined.findIndex((text) => text.includes(NURSE_CHEST_STAGE_REHIDE_MARKER));
    const swap = joined.findIndex((text) => text.includes(NURSE_CHEST_STAGE_SWAP_MARKER));
    if (rehide < 0 || swap < 0 || !(rehide < swap)) return false;
  }
  return true;
}
