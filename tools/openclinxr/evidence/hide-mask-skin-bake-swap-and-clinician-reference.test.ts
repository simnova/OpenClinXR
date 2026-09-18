import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the skin COLOR bake covers hide-mask polys, and the clinician
 * branch fires on the reference id, not only on --actor-role.
 *
 * ## MEASURED 2026-09-18 at source — do not re-derive
 *
 * (1) The COLOR bake writes (0,0,0) for hide-mask polys (alpha-0 cover material
 * skipped, use_clear fills black). Hide-mask faces share basemesh UVs, so the
 * black texels render as a T-shaped hole. The fix mirrors the scalp-cover swap
 * in `bake_skin_material_to_texture`: swap `openclinxr_hidden_*` polys to skin
 * for the bake, restore in the same finally.
 *
 * (2) Default `--actor-role patient` plus `--reference ed_chest_pain_nurse_adult`
 * skipped the scrub branch: `_is_clinician` read only `args.actor_role`. The fix
 * also matches clinician tokens against `args.reference`.
 *
 * claimScope: whether the materializer source contains the hide-mask swap and
 * the reference-aware clinician predicate.
 * notEvidenceFor: whether any bake ran, whether the hole is gone in pixels, or
 * whether scrubs fit — no Blender runs here.
 */

const MATERIALIZER = join(
  import.meta.dirname,
  "blender/materialize_mpfb_humanoid_candidate.py",
);

const src = (): string => readFileSync(MATERIALIZER, "utf8");

describe("hide-mask bake swap and clinician-from-reference", () => {
  it("(1) bake_skin_material_to_texture swaps hide-mask polys to skin and restores them", () => {
    const s = src();
    expect(
      s.includes("SKIN_BAKE hide-mask swap"),
      "missing hide-mask swap print: hide-mask polys bake black and leave a T-hole",
    ).toBe(true);
    expect(
      s.includes("openclinxr_hidden_") && s.includes("_hidden_swapped"),
      "missing hide-mask swap/restore bookkeeping in bake_skin_material_to_texture",
    ).toBe(true);
  });

  it("(2) _is_clinician matches clinician tokens against args.reference", () => {
    const s = src();
    const m = /_is_clinician = any\(\n([\s\S]*?)\n {4}\)/.exec(s);
    expect(m, "_is_clinician predicate not found in the materializer").not.toBeNull();
    expect(
      m![1]!.includes("args.reference"),
      "_is_clinician reads only args.actor_role: --reference ed_chest_pain_nurse_adult with default role patient skips scrubs",
    ).toBe(true);
  });
});
