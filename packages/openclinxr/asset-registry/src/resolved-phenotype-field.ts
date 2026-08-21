/**
 * Resolved phenotype field shape (#522 half 2).
 *
 * D13 permits an authoring adapter to choose at random when a case field is unbuildable.
 * An unrecorded random choice re-rolls every bake and breaks D9 (exam with no further LLM).
 * A case field resolved by an adapter records what was chosen, by whom, from which list,
 * and under what seed — frozen upstream of the factory.
 *
 * CLAIM: typed carrier for value + source + seed + from.
 * NOT: the adapter itself; not hair/garment/body resolution; not Maya's colour pick.
 */

/** Who/what produced the resolved value. */
export type ResolvedPhenotypeFieldSource =
  | "case"
  | "adapter_random"
  | "adapter_default"
  | "role_fallback";

/**
 * A phenotype field after adapter resolution.
 * `from` is the capability list the value was chosen from (e.g. iris pack ids).
 * `seed` is required when `source` is random so the same blueprint bakes identically.
 */
export type ResolvedPhenotypeField = {
  value: string;
  source: ResolvedPhenotypeFieldSource | string;
  seed: number | string | null;
  from: readonly string[];
};
