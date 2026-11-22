/**
 * Runtime lip purse for O/U (lip-rounding-b1 slice).
 *
 * WHY: mouth-pursing and mouth-protusion exist on the body mesh of all 4
 * GLBs and are never driven at O/U, because viseme_O/viseme_U exist and win
 * resolution (targetNames, 47 targets). This module drives the purse morphs
 * at runtime, scaled by the already-enveloped O/U weights the wire computed,
 * so purse travel inherits the envelope per-frame bound. Weight 0 rows
 * (both protusion rows at the cap55 pick) are written as 0 explicitly, so a
 * previous O/U frame cannot stick through E or silence (applyVisemeWeights
 * only writes the keys it is given). The table is injectable per call so
 * the evidence sweep can grade purse amounts through this exact code path;
 * production passes no table.
 *
 * claimScope: purse morph weights for rounding only.
 * notEvidenceFor: anatomy / bind-pose / upper-teeth show.
 */

import { lipRoundingScales, type LipRoundingRootLike } from "./lip-bone-rounding.js";
import type { MorphTargetLike } from "./viseme-morph-apply.js";

export type LipPurseViseme = "O" | "U";

/** MPFB spelling (no second r) — the literal morph target name on the body mesh. */
export type LipPurseKey = "mouth-pursing" | "mouth-protusion";

export type LipPurseRow = {
  viseme: LipPurseViseme;
  key: LipPurseKey;
  /** Morph weight at enveloped drive 1. */
  weight: number;
  /** One-line pick citation for this amount. */
  source: string;
};

export type LipPurseTable = readonly LipPurseRow[];

/** Picked by cap55 (b1-pick-ruling.md 2026-11-22): pursing 0.5, protusion 0 (protusion drops the lower lip and never reaches G1 on all 4 alone). */
export const LIP_PURSE_TABLE: LipPurseTable = [
  { viseme: "O", key: "mouth-pursing", weight: 0.5, source: "cap55 b1-pick-ruling.md 2026-11-22; b1/sweep-split.json arm P w=0.5" },
  { viseme: "O", key: "mouth-protusion", weight: 0, source: "cap55 b1-pick-ruling.md 2026-11-22; b1/sweep-split.json arm P w=0.5" },
  { viseme: "U", key: "mouth-pursing", weight: 0.5, source: "cap55 b1-pick-ruling.md 2026-11-22; b1/sweep-split.json arm P w=0.5" },
  { viseme: "U", key: "mouth-protusion", weight: 0, source: "cap55 b1-pick-ruling.md 2026-11-22; b1/sweep-split.json arm P w=0.5" },
];

/** Per key, sum over rows of (enveloped O/U weight) x row weight, clamped to [0,1]; keys absent when 0. */
export function lipPurseWeights(
  visemeWeights: Record<string, number>,
  table: LipPurseTable = LIP_PURSE_TABLE,
): Record<string, number> {
  const scales = lipRoundingScales(visemeWeights);
  const acc = new Map<string, number>();
  for (const row of table) {
    const drive = row.viseme === "O" ? scales.O : scales.U;
    if (!drive) continue;
    const amount = Number(row.weight);
    if (!Number.isFinite(amount) || amount === 0) continue;
    acc.set(row.key, (acc.get(row.key) ?? 0) + drive * amount);
  }
  const out: Record<string, number> = {};
  for (const [key, value] of acc) {
    const clamped = Math.min(1, Math.max(0, value));
    if (clamped > 0) out[key] = clamped;
  }
  return out;
}

/**
 * Write the purse morphs for the given enveloped weights on every mesh under
 * root that carries BOTH viseme_O and viseme_U (the card premise: purse is
 * driven because baked O/U exist and win resolution). Every table key
 * present in such a mesh dictionary is written (0 when not driven), so a
 * previous O/U frame never sticks through E or silence. Meshes without both
 * baked O/U targets (FACS-only dicts where resolveMorphTarget aliases
 * viseme_OU to mouth-protusion) are untouched: no write, not counted.
 * Returns meshes touched. Pass `table` only from the evidence probe;
 * production uses the default.
 */
export function applyLipPurseToRoot(
  root: LipRoundingRootLike,
  weights: Record<string, number>,
  table: LipPurseTable = LIP_PURSE_TABLE,
): number {
  const amounts = lipPurseWeights(weights, table);
  const keys = [...new Set(table.map((row) => row.key))];
  let touched = 0;
  root.traverse((object) => {
    const mesh = object as MorphTargetLike | null;
    const dict = mesh?.morphTargetDictionary;
    const influences = mesh?.morphTargetInfluences;
    if (!dict || !influences || influences.length === 0) return;
    if (typeof dict["viseme_O"] !== "number" || typeof dict["viseme_U"] !== "number") return;
    let wrote = false;
    for (const key of keys) {
      const index = dict[key];
      if (typeof index !== "number" || !Number.isInteger(index)) continue;
      if (index < 0 || index >= influences.length) continue;
      influences[index] = Math.min(1, Math.max(0, amounts[key] ?? 0));
      wrote = true;
    }
    if (wrote) touched += 1;
  });
  return touched;
}
