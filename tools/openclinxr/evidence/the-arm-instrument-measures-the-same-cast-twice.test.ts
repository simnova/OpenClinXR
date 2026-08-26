import { describe, expect, it } from "vitest";
import { inspectIdleArmHang } from "./idle-arm-hang.js";
import { listLiveCastActors } from "./live-scenario-actor-cast.js";

/**
 * OBSERVABLE: two runs of the arm instrument on an unchanged tree measure the same actors.
 *
 * MEASURED 2026-08-26, do not re-derive. `idle-arm-hang.ts` and `arm-abduction-ceiling.ts` each
 * inline a `page.waitForFunction` that returns as soon as ONE skinned mesh and ONE posture tag
 * exist, then dump after a fixed 900 ms settle. Any actor whose GLB load and posture tagging
 * finish after that instant is absent from the run — no error, no warning, no count.
 *
 * Three independent observers, unchanged trees. The cast declares 14 actors across the 5 scenarios
 * this instrument walks (ward_delirium 4, psych 3, peds_fever 3, telehealth 2, oncology 2), so a
 * complete run is 28 rows:
 *   #642's worker   idle-arm-hang  28 rows then 20 rows   (run B dropped ward_nurse_patel,
 *                                  daughter_lena_ellis, senior_resident_ward, parent_mei_chen)
 *                   arm-abduction  22 rows then 24 rows
 *   OpenClinXR-Lead idle-arm-hang  22 / 22 / 24 rows, missing by name:
 *                                  run1 ward_nurse_patel, luis_martinez, partner_sam_reed
 *                                  run2 ward_nurse_patel, margaret_ellis, senior_resident_ward
 *                                  run3 ward_nurse_patel, daughter_elena_martinez
 *   this file        idle-arm-hang  18 rows on its first verification run
 *
 * THE OMISSION IS ORDERED, NOT RANDOM. `ward_nurse_patel_v1` is absent from all three of the Lead's
 * runs and present in #642's worker's. He is not systematically excluded — he is load-dependent,
 * and the ordering is stable per machine. Whoever loads slowest on that host loses.
 *
 * 28 HAS BEEN REACHED. One observation in seven measured the whole cast, so the target in clause (2)
 * is demonstrated achievable rather than aspirational. The worst, 18, is 9 of 14 actors.
 *
 * A contract that silently drops actors CAN PASS BY OMISSION. A green from either arm contract is
 * not evidence the assertion holds across the cast; it is evidence it held for whoever had loaded.
 *
 * THE REMEDY EXISTS AND IS UNCONSUMED HERE. `declared-actors-rendered.ts:393` exports
 * `waitForSceneAssetsSettled(page, timeoutMs)`, which has eleven adopters, and
 * `actor-garment-presence-in-scene.ts:426-432` documents this exact race against #259 — including
 * the property that makes it safe: "a failed asset counts as settled, so a genuinely-broken load
 * is still reported, not masked." Both arm instruments call it zero times.
 *
 * FAILED TREATMENT, do not retry: raising the 900 ms settle. That is the same defect with a better
 * hit rate, it stays wrong, and it degrades as the cast grows.
 *
 * COUNT EQUALITY IS A WEAK ORACLE AND CLAUSE (1) MEASURES MEMBERSHIP BECAUSE OF IT. The Lead measured membership
 * swapping while the count held at 20 standing arms — psych/partner_sam_reed_v1 entered and
 * telehealth/daughter_elena_martinez_v1 left between runs. Identical counts over different actors
 * is the cheap way to satisfy a count-only clause without fixing anything.
 *
 * claimScope: whether repeated measures of the arm instrument observe the same actor set.
 * notEvidenceFor: whether the VALUES are stable (they are not — see #678, 211% run-to-run variance
 *   on wristLateralOffsetMeters for an actor present in every run); whether any posture is correct;
 *   whether the arm contracts' thresholds are right.
 */

/** Three forced measures. `force: true` bypasses both the in-process and disk caches. */
async function measureThrice(): Promise<Array<{ count: number; ids: string[] }>> {
  const runs: Array<{ count: number; ids: string[] }> = [];
  for (let i = 0; i < 3; i += 1) {
    const report = await inspectIdleArmHang({ force: true, label: `determinism-run-${i + 1}` });
    runs.push({
      count: report.arms.length,
      ids: report.arms.map((a) => `${a.scenarioId}/${a.actorId}.${a.shoulderBoneName}`).sort(),
    });
  }
  return runs;
}

/**
 * MY OWN FIRST FLOOR WAS WRONG AND THE PROBE CAUGHT IT — recorded because it is the finding.
 *
 * I first wrote `MIN_PLAUSIBLE_ARM_ROWS = 20`, derived as "the smallest count either observer has
 * recorded". That is a derivation from ambient, which is the right shape, taken from a sample of
 * two observers. On the first verification run this file measured **18** — a new low, from a third
 * observer, on the same unchanged tree.
 *
 * So the floor was fitted to an incomplete sample of the very quantity under test, which is the
 * circularity this repo keeps throwing thresholds out for. The non-circular reference is the INPUT:
 * the arms the CAST DECLARES, which is a fact about the scenario bank and cannot move when the
 * instrument gets better or worse.
 *
 * Clause (2) is therefore an `it.fails` and not a counterweight — "the instrument does not measure
 * the cast it was given" is a second face of the same defect, not a guard against a cheap fix.
 * Clause (3) is the guard: measured ids must be ids the bank actually declares, so the cheap way to
 * satisfy (1)-(2) — emit a fixed synthetic row set — fails.
 */
const OBSERVED_ARM_ROW_COUNTS = [28, 24, 22, 22, 20, 20, 18] as const;

/** `scenarioId/actorId` for every cast slot in the scenarios this run walked — read from the
 *  casting SSOT via `listLiveCastActors`, never from a run's own output. */
function declaredActorIdsForScenarios(scenarios: string[]): Set<string> {
  const walked = new Set(scenarios);
  return new Set(
    listLiveCastActors()
      .filter((a) => walked.has(a.scenarioId))
      .map((a) => `${a.scenarioId}/${a.actorId}`),
  );
}

/** Two arms per declared actor. The instrument emits one row per side. */
function declaredArmCountForScenarios(scenarios: string[]): number {
  return declaredActorIdsForScenarios(scenarios).size * 2;
}

/**
 * A COUNT CLAUSE WAS PLANTED HERE AND WITHDRAWN — recorded because it is the second thing this
 * probe caught about its own author.
 *
 * The original clause (1) asserted that three forced measures return the same ROW COUNT. On the
 * first verification run it failed as designed; on the second it PASSED — the three runs happened
 * to agree — which under `it.fails` reports as a broken contract.
 *
 * A RED that is only red when the defect happens to bite inside three runs is worse than no RED:
 * a worker can clear it by luck and nobody can tell that from a fix. Membership equality implies
 * count equality, so clause (1) below subsumes it and is the stable oracle — it failed on both
 * runs, because the cast changes membership even when the total holds (the Lead measured 20/20
 * with psych/partner_sam_reed_v1 in and telehealth/daughter_elena_martinez_v1 out).
 *
 * Do not re-add a count-only clause. If you want the counts in the report, put them in the pre-fix
 * artifact where a number that varies is data rather than a verdict.
 */
describe("the arm instrument measures the same cast twice (#675)", () => {
  it.fails(
    "(1) three forced measures of an unchanged tree observe the same ACTORS",
    async () => {
      const runs = await measureThrice();
      const [first, ...rest] = runs;
      const missing: string[] = [];
      for (const [i, run] of rest.entries()) {
        for (const id of first!.ids) if (!run.ids.includes(id)) missing.push(`run${i + 2} lost ${id}`);
        for (const id of run.ids) if (!first!.ids.includes(id)) missing.push(`run${i + 2} gained ${id}`);
      }
      expect(
        missing,
        "membership changed between runs of an unchanged tree. Equal counts are not enough — "
          + "a swap that preserves the count satisfies clause (1) while measuring a different cast.",
      ).toEqual([]);
    },
    1_800_000,
  );

  it.fails(
    "(2) the instrument measures every arm the cast declares",
    async () => {
      // The floor is the INPUT, not a quantile of the output: two arms for every actor the bank
      // declares in the scenarios this instrument walks. Implementer derives the declared count
      // from the bank rather than from any observed run — see the header for why a floor taken
      // from observations is circular here.
      const report = await inspectIdleArmHang({ force: true, label: "determinism-cast-coverage" });
      const declaredArms = declaredArmCountForScenarios(report.scenarios);
      expect(
        report.arms.length,
        `measured ${report.arms.length} arms against ${declaredArms} declared by the cast. `
          + `Counts observed so far on unchanged trees: ${OBSERVED_ARM_ROW_COUNTS.join(", ")}. `
          + "28 is the complete cast (14 declared actors x 2 arms) and has been reached once in "
          + "seven, so this target is DEMONSTRATED ACHIEVABLE, not aspirational. The worst "
          + "observation, 18, is 9 of 14 actors — 36% of the cast unmeasured while every contract "
          + "over it reported a verdict as if it had seen everyone.",
      ).toBe(declaredArms);
    },
    1_800_000,
  );

  it(
    "(3) COUNTERWEIGHT: every measured actor is one the bank actually declares",
    async () => {
      // Refuses the cheap way to satisfy (1)-(2): emit a fixed synthetic row set, which is
      // perfectly deterministic, hits any count, and measures no one real.
      const report = await inspectIdleArmHang({ force: true, label: "determinism-no-fabrication" });
      expect(report.arms.length, "no arms measured at all").toBeGreaterThan(0);
      const declared = declaredActorIdsForScenarios(report.scenarios);
      const invented = report.arms
        .map((a) => `${a.scenarioId}/${a.actorId}`)
        .filter((id) => !declared.has(id));
      expect(
        [...new Set(invented)],
        "the instrument reported actors the scenario bank does not declare",
      ).toEqual([]);
    },
    1_800_000,
  );
});
