import { describe, expect, it } from "vitest";
import * as runner from "../../../tools/openclinxr/dark-factory/multi-case-runner.js";

/**
 * OBSERVABLE: the instrument that defines D9 progress measures the code path the factory actually
 * uses, and does not disqualify a case for a station that correctly has nothing to do.
 *
 * MEASURED 2026-08-23, verified three ways, do not re-derive.
 *
 * THREE DEFECTS IN THE GAUGE ITSELF, not in the factory:
 *
 * (a) THE RUNNER CANNOT SEE THE RESOLVER. `dumpCasePresets` (multi-case-runner.ts:230-241) builds a
 *     Python snippet that does `from orchestrate_character import CASE_ACTOR_PRESETS` and iterates
 *     the hand-typed dict directly. `grep -c resolve_case_actor_params` over
 *     multi-case-runner.ts and export-actor-phenotype.ts returns 0 and 0. #601 built the resolver
 *     seam and #605 filled the table behind it; the gauge routes around both.
 *       caseIdsWithPresets()  -> 2   [ed_chest_pain_priority_v2, peds_asthma_parent_anxiety_v1]
 *       peds_fever_v1 present -> false
 *     yet resolve_case_actor_params("peds_fever_v1","patient_noah_chen_v1") returns
 *     age=8 height_cm=125 bmi=16.5.
 *
 * (b) THE ARTIFACT IS TWELVE DAYS OLD. multi-case-rollup.json generatedAt 2026-08-11T01:25:02Z;
 *     #601 and #605 both landed 2026-08-23.
 *
 * (c) `absent` DISQUALIFIES A CASE PERMANENTLY. multi-case-runner.ts:853-856:
 *       const firstNonDeterministic = table.stations.find(s => s.classification !== "deterministic");
 *       fullyDeterministic: firstNonDeterministic === undefined
 *     A case marked `absent` for equipment BECAUSE IT DECLARES NONE (:582-586) can never be fully
 *     deterministic. Ten of fourteen bank cases declare zero equipment, so the ceiling on
 *     casesFullyDeterministic is roughly five, forever, with perfect params, bodies and rigs.
 *
 * WHY THIS BLOCKS EVERYTHING ELSE: no product slice can be selected off a gauge that is stale, blind
 * to the last two landings, and capped below the population. That includes #603 Stage B and profile
 * expansion, both of which were sequenced against these numbers.
 *
 * DERIVATION, so nothing is invented (SS7r): clause (2) requires an exported pure predicate
 * `isCaseFullyDeterministic(stations)` extracted from the inline expression at :856. It must be a
 * function of the station classifications alone, so the rule is testable without running an
 * eight-station chain.
 *
 * KNOWN-GOOD COLUMN: the two cases the gauge already sees. Clause (3) pins them, so a fix cannot
 * pass by replacing the preset path with a resolver path that drops what worked.
 *
 * claimScope: what the multi-case runner's station-one view contains, and how it classifies a case
 * whose station is not applicable.
 * notEvidenceFor: whether re-running the chain produces better numbers; the correctness of #601 or
 * #605, which rest on their own contracts; any bake, appearance or clinical claim.
 */

/** Resolvable through #601's seam, absent from the gauge's view. Measured above. */
const RESOLVABLE_BUT_UNSEEN = "peds_fever_v1";

/** Measured 2026-08-23: exactly these two are visible to the gauge today. */
const GAUGE_SEES_TODAY = ["ed_chest_pain_priority_v2", "peds_asthma_parent_anxiety_v1"] as const;

type Classification = "deterministic" | "not_run" | "absent" | "error";
type StationLike = { stationId: string; classification: Classification };

function stations(...pairs: Array<[string, Classification]>): StationLike[] {
  return pairs.map(([stationId, classification]) => ({ stationId, classification }));
}

describe("the gauge sees what the resolver resolves", () => {
  it("(1) RED: a case resolvable through resolve_case_actor_params is visible to the gauge", async () => {
    // Today dumpCasePresets reads CASE_ACTOR_PRESETS directly, so a case that resolves via the
    // #601 seam is invisible and station one reports it blocked.
    const seen = await runner.caseIdsWithPresets();
    expect(seen, `${RESOLVABLE_BUT_UNSEEN} resolves via resolve_case_actor_params but the gauge cannot see it`)
      .toContain(RESOLVABLE_BUT_UNSEEN);
  }, 60000);

  it("(2) RED: a station that is not applicable does not disqualify the case", () => {
    // Requires the inline predicate at :856 to be extracted as an exported pure function.
    const fn = (runner as unknown as {
      isCaseFullyDeterministic?: (s: StationLike[]) => boolean;
    }).isCaseFullyDeterministic;
    expect(typeof fn, "extract the :856 predicate as isCaseFullyDeterministic(stations)").toBe("function");

    const cleanChainNoEquipment = stations(
      ["case_to_actor_params", "deterministic"], ["body", "deterministic"],
      ["clothing", "deterministic"], ["rigging", "deterministic"],
      ["room", "deterministic"], ["equipment", "absent"],
      ["staging_placement", "deterministic"], ["render", "deterministic"],
    );
    expect(fn?.(cleanChainNoEquipment),
      "a case that declares no equipment ran its whole chain clean and must not be barred by `absent`")
      .toBe(true);
  });

  it("(3) KNOWN-GOOD COLUMN: the two cases the gauge already sees are still seen", async () => {
    // Pins the reference. A fix that reroutes station one through the resolver and drops the
    // preset-backed cases fails here.
    const seen = await runner.caseIdsWithPresets();
    for (const id of GAUGE_SEES_TODAY) {
      expect(seen, `${id} was visible before this slice and must stay visible`).toContain(id);
    }
  }, 60000);

  it("(4) COUNTERWEIGHT: a genuinely failed station still disqualifies the case", () => {
    // Refuses the cheap fix for clause (2) — making fullyDeterministic ignore classification, or
    // treating every non-deterministic value as benign. `absent` means NOT APPLICABLE; `error` and
    // `not_run` mean the chain did not complete, and those must still bar the headline.
    const fn = (runner as unknown as {
      isCaseFullyDeterministic?: (s: StationLike[]) => boolean;
    }).isCaseFullyDeterministic;
    if (typeof fn !== "function") return; // clause (2) owns the missing-seam failure

    for (const bad of ["error", "not_run"] as const) {
      const broken = stations(
        ["case_to_actor_params", "deterministic"], ["body", bad],
        ["clothing", "deterministic"], ["rigging", "deterministic"],
        ["room", "deterministic"], ["equipment", "absent"],
        ["staging_placement", "deterministic"], ["render", "deterministic"],
      );
      expect(fn(broken), `a '${bad}' station means the chain did not complete — it must still disqualify`)
        .toBe(false);
    }
  });
});

/*
## FIXED (#607)

- `dumpCasePresets` / `listPresets` now resolve through the #601 seam
  (`allowed_case_actor_preset_ids` UNION `params_from_case_definition` /
  `resolve_case_actor_params`) instead of iterating `CASE_ACTOR_PRESETS`
  directly; `caseIdsWithPresets()` therefore includes every case the resolver
  can materialize (peds_fever_v1 and the rest of the authored-phenotype
  population), not just the two legacy preset cases.
- Extracted the inline roll-up predicate as exported pure
  `isCaseFullyDeterministic(stations)`: `absent` (NOT APPLICABLE) no longer
  disqualifies a case; `error` / `not_run` still do. The roll-up frontier now
  keys off the first `error`/`not_run` station, so a case whose only
  non-deterministic station is `absent` counts as fully deterministic.
- `multi-case-runner.ts` header/implementation/execution-command strings and
  the station-one note now name the resolver seam rather than the raw dict.
*/
