import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * OBSERVABLE: every eye colour a case authors is one the iris selector can build.
 *
 * ## MEASURED 2026-08-26 — do not re-derive
 *
 * The scenario bank authors five `eye_color` values. Four are `brown`; one is `hazel`
 * (`pediatric-asthma.ts:122`). The iris pack has nine members and `hazel` is not among them, so
 * `eye_iris_colour('patient', {'eye_color': 'hazel'})` raises `ValueError: unbuildable iris colour`.
 *
 * THE REFUSAL IS CORRECT AND MUST NOT BE REMOVED. D13 says the authoring LLM between the UI
 * blueprint and the factory may choose values at random, and the factory's job is to refuse an
 * unbuildable one loudly so the choice is resolved UPSTREAM and recorded. #518 built that refusal
 * for exactly this case. The defect is that a case ships an unbuildable value, not that the
 * factory declines to guess.
 *
 * ## TWO CANDIDATE CAUSES ARE DEAD, AND SO IS THE THIRD I CARRIED INTO THIS CARD
 *
 * Dead: staleness between authoring (a880669f, 08-10) and the bake (076890cc, 08-21).
 * Dead: a swallowed exception — no `try`/`except` wraps any `eye_iris_colour` call site.
 * Dead, measured here: "the bake resolves the WRONG reference". The shipped child GLB carries
 *   `mpfb_peds_patient_child` throughout, so it used reference `peds_patient_child`, whose manifest
 *   declares `hazel`.
 *
 * WHAT IS ACTUALLY TRUE, executed rather than read:
 *
 *     phenotype_eye_colour("peds_patient_child")        -> 'hazel'    manifest FOUND
 *     phenotype_eye_colour("peds_fever_patient_child")  -> ''         manifest FOUND, field null
 *
 * The chain is intact on this tree. `_anny_manifest_for` landed at f3bf8d13 on 2026-08-25, four
 * days AFTER the child was last baked at 076890cc on 2026-08-21, so the reader that reaches the
 * manifest did not exist when the shipped iris was chosen. A re-bake today reaches `hazel` and
 * raises. The shipped `brown_eye` is a stale artifact of a bake that never saw the value.
 *
 * ## KNOWN-GOOD COLUMN
 *
 * The four `brown` authorings (ed-chest-pain.ts:132, pediatric-asthma.ts:169 and :216,
 * ward-delirium.ts:111) are pack members and build today. So clause (1)'s predicate is satisfied
 * by 4 of the 5 values in the bank, and `hazel` is the lone offender.
 *
 * ## THE FIX IS UPSTREAM AND THE CHEAPEST ONE IS BANNED
 *
 * Resolve `hazel` in the case definition to a value the pack can build, and record the choice so
 * the same blueprint bakes the same human every run (D13: random-once, not random-per-bake).
 * Adding `hazel` to `_EYE_IRIS_PACK` is forbidden — clause (2) refuses it, because it converts a
 * working refusal into a silent acceptance and removes the property D13 rests on.
 *
 * claimScope: whether every `eye_color` authored in the scenario bank is a member of the iris pack.
 * notEvidenceFor: whether any shipped asset's iris matches its case (the child's bake predates the
 *   reader — that is a re-bake, tracked separately); whether the pack's nine colours are the right
 *   set; whether hazel is clinically desirable.
 */

const REPO = join(import.meta.dirname, "../../..");
const FIXTURES = join(REPO, "packages/openclinxr/scenario-fixtures/src");
const PALETTE = join(REPO, "tools/openclinxr/asset-pipeline/anny/iris_palette.py");

/** The nine buildable iris colours, read from the palette module rather than restated here. */
function irisPack(): readonly string[] {
  const src = readFileSync(PALETTE, "utf8");
  const block = /_EYE_IRIS_PACK\s*=\s*\(([\s\S]*?)\)/.exec(src);
  if (!block) throw new Error(`_EYE_IRIS_PACK not found in ${PALETTE}`);
  return [...block[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

/** Every `eye_color: "..."` the bank authors, as `file:line -> value`. */
function authoredEyeColours(): ReadonlyArray<{ where: string; value: string }> {
  const found: Array<{ where: string; value: string }> = [];
  for (const f of readdirSync(FIXTURES).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
    const lines = readFileSync(join(FIXTURES, f), "utf8").split("\n");
    for (const [i, line] of lines.entries()) {
      const m = /\beye_color\s*:\s*"([^"]+)"/.exec(line);
      if (m) found.push({ where: `${f}:${i + 1}`, value: m[1]! });
    }
  }
  return found;
}

describe("an authored eye colour is one the factory can build (#681)", () => {
  it("(1) every eye_color the bank authors is a member of the iris pack", () => {
    const pack = new Set(irisPack());
    const authored = authoredEyeColours();
    expect(authored.length, "no authored eye_color found — the extractor is broken").toBeGreaterThan(0);
    const unbuildable = authored.filter((a) => !pack.has(a.value));
    expect(
      unbuildable.map((a) => `${a.where} = "${a.value}"`),
      `these authored values are outside the iris pack [${[...pack].join(", ")}] and make `
        + "`eye_iris_colour` raise. Resolve them IN THE CASE DEFINITION to a buildable value and "
        + "record the choice (D13: random-once, seeded, not random-per-bake). Do NOT add them to "
        + "the pack — clause (2) refuses that.",
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the iris pack still holds exactly the nine colours it shipped with", () => {
    // Refuses the cheapest fix. Widening the pack to admit `hazel` turns a working refusal into a
    // silent acceptance and destroys the property D13 depends on: that the factory declines an
    // unbuildable value LOUDLY so the authoring layer must resolve it. #518 built that refusal.
    // If a colour genuinely belongs in the pack, that is its own slice with its own evidence that
    // the material exists and bakes — not a side effect of clearing clause (1).
    expect(
      irisPack(),
      "the iris pack changed. Restore it to the nine members recorded here, and satisfy clause (1) "
        + "by resolving the authored value upstream instead. Widening or deleting this clause is wrong.",
    ).toEqual([
      "blue", "bluegreen", "brown", "brownlight", "deepblue", "green", "grey", "ice", "lightblue",
    ]);
  });

  it("(3) COUNTERWEIGHT: the role fallback is not the resolution path", () => {
    // Refuses the second-cheapest fix: deleting the authored value so `eye_iris_colour` falls back
    // to the role default. That ships the same brown the stale bake already ships while removing
    // the case's stated intent, and it would make clause (1) vacuous by emptying its population.
    // The floor is the count measured today, so dropping any authoring fails here.
    const authored = authoredEyeColours();
    expect(
      authored.length,
      `the bank authors ${authored.length} eye_color values; 5 were measured on 2026-08-26 `
        + "(ed-chest-pain.ts:132, pediatric-asthma.ts:122/:169/:216, ward-delirium.ts:111). "
        + "Deleting an authoring to clear clause (1) is not a fix — resolve it to a buildable value.",
    ).toBeGreaterThanOrEqual(5);
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ## FIXED (#681) — appended; the planted header above is immutable
 *
 * Clause (1) flipped `it.fails` -> `it`. `pediatric-asthma.ts:122` resolved "hazel" -> "green"
 * (the closest staged CC0 pack colour to the authored hazel intent among the pack members the
 * selector resolves to themselves — the compounds bluegreen/brownlight/deepblue/lightblue
 * collapse to their component under the `key in declared` substring match, measured in the
 * pre-fix artifact). D13: the pick is recorded in the case comment, frozen, not random-per-bake.
 * The anny manifest `peds_patient_child.anny_manifest.json` eye_color fields (input_params +
 * phenotype_summary) were updated to match — the MPFB materializer reads the tracked manifest
 * at bake time and does NOT rewrite it. Re-baked `mpfb-peds-patient-child.glb`; shipped iris is
 * now green (sha256[0:12] b9864ac4f4fa, 662,241 B) — observably the case's, not the patient role
 * default brown. Clause (2) (pack unchanged) and clause (3) (still 5 authorings) untouched.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
