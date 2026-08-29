import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the D9 multi-case runner still prefers CASE_ACTOR_PRESETS.get before
 * the case-definition seam, so a fixture-only actor is a second-class hop.
 *
 * MEASURED 2026-08-29 in tools/openclinxr/dark-factory/multi-case-runner.ts:
 *   dumpCasePresets snippet (:258)  CASE_ACTOR_PRESETS.get(preset_id) FIRST
 *   else params_from_case_definition
 *   notes at :392 claim resolve_case_actor_params is the source of truth
 *
 * orchestrate_character.resolve_case_actor_params_with_source (:381) is fixture-first,
 * preset fallback, KeyError #276 if neither. The runner inverts that order.
 *
 * Diagnosis header IMMUTABLE. Flip it.fails → it and append ## FIXED. Do not rewrite
 * the measured line numbers.
 *
 * claimScope: the in-process Python snippet the gauge uses to resolve actors.
 * notEvidenceFor: that every case authors a phenotype; Quest; clinical validity.
 */

const RUNNER = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../dark-factory/multi-case-runner.ts"),
  "utf8",
);

describe("the D9 runner resolves actors through the case seam", () => {
  it("(1) dumpCasePresets calls resolve_case_actor_params_with_source", () => {
    expect(
      RUNNER.includes("resolve_case_actor_params_with_source"),
      "the runner still inlines CASE_ACTOR_PRESETS.get instead of the named seam",
    ).toBe(true);
  });

  it("(2) the snippet does not treat CASE_ACTOR_PRESETS.get as the first hop", () => {
    const dump = RUNNER.slice(RUNNER.indexOf("async function dumpCasePresets"), RUNNER.indexOf("async function listPresets"));
    expect(dump.includes("CASE_ACTOR_PRESETS.get"), "preset-first invert of the generator seam").toBe(false);
  });

  it("(3) COUNTERWEIGHT: CASE_ACTOR_PRESETS still exists as a named fallback in orchestrate_character", () => {
    expect(RUNNER.includes("CASE_ACTOR_PRESETS"), "do not delete the table; stop reading it first").toBe(true);
  });
});

/*
## FIXED (#0)

- `dumpCasePresets` now calls `resolve_case_actor_params_with_source`
  (orchestrate_character.py:381) as the first hop — the same fixture-first
  seam the generator uses: case-definition phenotype export when the case
  authors the actor (issue-650), else the legacy CASE_ACTOR_PRESETS row,
  KeyError (#276) when neither. The runner no longer inverts the seam with a
  preset-first `CASE_ACTOR_PRESETS.get`.
- `listPresets` resolves the same way for parity (caseIdsWithPresets keeps
  returning the full resolver union; issue #607). `CASE_ACTOR_PRESETS`
  remains in the file as the named fallback (counterweight clause 3), never
  the first hop.
- One recorded behavioral delta: `peds_asthma_parent_anxiety_v1:
  parent_tara_johnson_v1` now reports the fixture-authored role `family`
  (pediatric-asthma.ts:154) instead of the legacy preset's `parent`;
  `output_name` is identical so artifact paths are unchanged.
*/

