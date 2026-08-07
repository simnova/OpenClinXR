import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#108) — the default exam blueprint has ONE station slot, and the endpoint that
 * assembles an exam form hardcodes the ED chest-pain scenario. A Step 2 CS-style multi-station exam
 * cannot be assembled at all.
 *
 * ALL THREE ARE `it.fails` AND ALL THREE FLIP. They are not all REDs:
 *   (1) and (2) are REDs — behaviour that does not exist.
 *   (3) is a COUNTERWEIGHT — `assembleExamForm` refuses unapproved scenarios today
 *       (`assembly.ts:234-238`) and must still refuse them. It is `it.fails` only because the module
 *       is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURE THE WHOLE ASSEMBLY PATH BEFORE CHANGING ANYTHING
 *
 * Build `inspectExamAssembly()`, run it over the real pool, and write the artifact. Report the slot
 * count, which scenarios reach a slot, and which pool members are unreachable. ED is named below
 * because it is what is hardcoded; it is the MOTIVATION, not necessarily the whole defect.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED — verified against the tree, do not re-derive
 *
 * `exam-assembly/src/assembly.ts:45-62`  createDefaultClinicalSkillsBlueprint() returns exactly ONE
 *                                        stationSlot, `station_001_ed_urgent_recognition`, whose
 *                                        requiredTraceTags are edChestPainScenario's. The blueprint's
 *                                        own requiredTraceTags (`:59`) and
 *                                        requiredSafetyCriticalTraceTags (`:60`) are also ED's.
 * `exam-assembly/src/assembly.ts:38-43`  ...while its OWN timing declares
 *                                        `breakAfterStationOrders: [3, 6, 9]`. A break after station
 *                                        nine, in a one-station exam. The data structure contradicts
 *                                        itself, and that contradiction is where contract (1) gets
 *                                        its number — I did not pick it.
 * `exam-assembly/src/assembly.ts:240-249` assembleExamForm zips `input.scenarios[index]` against
 *                                        `sortedSlots[index]`, so with one slot every scenario past
 *                                        the first gets `order: index+1` and no slot at all.
 * `exam-assembly/src/assembly.ts:260-264` stationCount.ok is
 *                                        `stationSlots.length === scenarios.length`, so today's
 *                                        one-slot / one-scenario exam reports ok:true. The structure
 *                                        is self-consistent and still wrong, which is why contract
 *                                        (1) reads the timing rather than this flag.
 *
 * NOTE ON THE REPORT SHAPE BELOW: `assembleExamForm`'s station refs are
 * `{ order, scenarioId, scenarioVersion, title }` — there is NO slotId on them. To fill `slotId` you
 * must correlate against the same `sortedSlots` array by position, which is precisely what makes the
 * defect visible: every index past the slot count correlates to nothing. Report `null` there rather
 * than inventing an id.
 * `apps/api/src/routes/exam-routes.ts:56-61` create-exam-form passes `scenarios: [edChestPainScenario]`
 *                                        — a literal, ignoring the pool.
 *
 * THE POOL IS ALREADY CORRECT. `apps/api/src/exam-assembly-pool.ts:13-30`
 * `buildExamAssemblyScenarioPool` merges approved authored scenarios over the 14-station fixture bank
 * and appends authored-only ids. **Do not rebuild it.** Every other route in `exam-routes.ts`
 * (`:17,22,27,32,37,48`) already calls it. `create-exam-form` at `:56` is the sole outlier.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT A PEER ROUND CORRECTED — I had this wrong and the correction is load-bearing
 *
 * I claimed an authored scenario could never reach a learner and that the API could not serve any
 * non-ED station. **Both false.** `apps/ui-xr/src/learner-exam-scenario-source.ts:94-133` fetches the
 * station-run-queue and then `GET /scenarios/:id` per queue id, tagging results `bodySource:
 * "api_authored"` and falling back to `bank_residual`. I had grepped only `api-client.ts` and missed
 * a second client. The authored-content path exists and works.
 *
 * What survives is narrower and is what this issue covers: the BLUEPRINT is single-station and the
 * exam-form endpoint is ED-hardcoded, so nothing assembles a multi-station exam from the pool.
 *
 * `learner-scenario` (`rest/src/index.ts:54`, path `/scenarios/ed-chest-pain`,
 * `scenario-scene-generation-routes.ts:15` returning `edChestPainScenario` unconditionally) is a dead
 * ED-hardcoded control-plane route. Parameterising it is NOT the fix and would create a second
 * scenario SSOT. Leave it alone or delete it, and say which you did.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message. I have NOT resolved them.
 *
 *  - How station slots are produced. A longer literal list, or derived from the pool, or a blueprint
 *    factory taking a station count. Deriving from the pool couples the blueprint to fixture order;
 *    a literal list goes stale as the bank grows. I do not know which is right here.
 *  - What a slot's `requiredEnvironmentIds` and `requiredTraceTags` should be once it is not ED's
 *    copy — the slot's own, the assigned scenario's, or a union.
 *  - Whether `create-exam-form` takes a station count / blueprint id from the request body, and what
 *    it does when the pool has fewer approved scenarios than the blueprint has slots. Failing loudly
 *    may be better than silently assembling a short exam.
 *  - Whether the blueprint's top-level `requiredTraceTags` becomes the union across slots or is
 *    dropped. Today it is a copy of ED's and is therefore wrong for every other station.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SCOPE BOUNDARY — #106 IS RUNNING CONCURRENTLY IN apps/ui-xr/src
 *
 * Do NOT edit `apps/ui-xr/src/runtime-state.ts` or `apps/ui-xr/src/main.ts`. Another worker owns
 * those this cycle. If you believe this slice genuinely requires a ui-xr change, STOP and say so in
 * your report rather than making it — that is a real finding, not a failure.
 *
 * Your write scope is `packages/openclinxr/exam-assembly/src/**` and `apps/api/src/**`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands a blueprint whose station count is consistent with its own declared breaks, and is
 * satisfiable by padding it with nine copies of the ED slot. (2) demands the assembled form's
 * stations be DISTINCT scenarios drawn from the pool, which padding cannot satisfy. (3) is green
 * today and forbids buying either by dropping the approval gate — the cheapest way to fill ten slots
 * is to stop checking `status === "approved"`, and that would let an unreviewed scenario into an
 * exam.
 *
 * I have deliberately not invented a station count. `breakAfterStationOrders: [3, 6, 9]` is authored
 * in this repo and already implies more than nine stations; contract (1) reads it rather than
 * hardcoding a number, because a threshold I pick becomes a design target (§7a).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectExamAssembly()`. Change the call sites
 * and say why if a different shape is better. What must not change: the pool comes from
 * `buildExamAssemblyScenarioPool` rather than a list, and the assembled form is read back from
 * `assembleExamForm`'s real output rather than a fixture built for the test.
 *
 * IN-SCOPE VERDICT required: state the assembled station count, and name every pool scenario that
 * still cannot reach a slot. Separately name any out-of-scope wrongness you saw. If satisfying these
 * contracts makes the product visibly worse, say so in your report and then satisfy them anyway —
 * naming it will not be read as refusing the work.
 *
 * SCOPE: whether a multi-station exam can be assembled from the approved pool. Says NOTHING about
 * whether the station ORDER is psychometrically sound — that needs a psychometrician — nor about
 * what the learner runtime does with the form.
 */

const load = async () => import("./multi-station-exam-assembly.js") as Promise<Record<string, unknown>>;

type AssemblyReport = {
  /** From createDefaultClinicalSkillsBlueprint(), read live. */
  blueprintStationSlotCount: number;
  blueprintBreakAfterStationOrders: number[];
  /** scenarioIds in buildExamAssemblyScenarioPool order. */
  poolScenarioIds: string[];
  /** One entry per station in the form assembled from the pool. */
  assembledStations: { order: number; slotId: string | null; scenarioId: string }[];
  /** Pool members that reached no slot. */
  unreachableScenarioIds: string[];
  /** Result of attempting to assemble with an unapproved scenario present. */
  refusedUnapproved: boolean;
};
type Inspect = () => Promise<AssemblyReport>;

describe("a multi-station exam assembles from the approved pool (#108)", () => {
  it.fails("the blueprint has enough stations for its own declared breaks", async () => {
    // assembly.ts:38-43 declares breaks after stations 3, 6 and 9 while :49-57 declares one slot.
    // The number here is read from the repo's own timing, not chosen by me.
    const mod = await load();
    const inspect = mod["inspectExamAssembly"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const latestBreak = Math.max(...report.blueprintBreakAfterStationOrders);
    expect(
      report.blueprintStationSlotCount,
      `blueprint declares a break after station ${latestBreak} but has ${report.blueprintStationSlotCount} slot(s)`,
    ).toBeGreaterThan(latestBreak);
  }, 300_000);

  it.fails("every assembled station is a distinct scenario drawn from the pool", async () => {
    // Kills the cheap satisfaction of the first contract: padding the blueprint with copies of the ED
    // slot makes the count pass while the exam is still one station repeated.
    const mod = await load();
    const inspect = mod["inspectExamAssembly"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.assembledStations.length, "no stations were assembled").toBeGreaterThan(0);

    const ids = report.assembledStations.map((s) => s.scenarioId);
    expect(new Set(ids).size, `assembled stations repeat a scenario: ${ids.join(", ")}`).toBe(ids.length);

    const pool = new Set(report.poolScenarioIds);
    for (const station of report.assembledStations) {
      expect(pool.has(station.scenarioId), `${station.scenarioId} is not in the pool`).toBe(true);
      expect(station.slotId, `station ${station.order} (${station.scenarioId}) has no slot`).not.toBeNull();
    }
  }, 300_000);

  it.fails("an unapproved scenario is still refused (COUNTERWEIGHT — true today)", async () => {
    // The cheapest way to fill ten slots is to stop checking status === "approved"
    // (assembly.ts:234-238). That would put an unreviewed scenario in front of a learner.
    const mod = await load();
    const inspect = mod["inspectExamAssembly"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.refusedUnapproved, "assembly accepted an unapproved scenario").toBe(true);
  }, 300_000);
});
