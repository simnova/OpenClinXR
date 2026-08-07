import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#106) — the learner's action set and the actors' speech are hardcoded to the ED
 * chest-pain station in every one of the fourteen shipped stations.
 *
 * ALL THREE ARE `it.fails` AND ALL THREE FLIP. They are not all REDs:
 *   (1) and (2) are REDs — behaviour that does not exist.
 *   (3) is a COUNTERWEIGHT — the ED bay works today and must still work. It is `it.fails` only
 *       because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * RUN THE MEASUREMENT OVER THE WHOLE BANK BEFORE DIAGNOSING ANYTHING
 *
 * Build `inspectScenarioConversationSurface()`, run it across every scenario `scenarioBank` declares,
 * write the artifact under `.openclinxr/evidence/`, and report every station whose action set differs
 * from its own authored `requiredTraceTags`. Psych and OB are below because they are what made me
 * open this issue. **They are the motivation, not the measured locus** — the defect is bank-wide and
 * the interesting cases may be stations I never mention. #105 lost its opening to exactly this: the
 * header named psych, psych measured clean, and the real defect was in a station the brief never
 * mentioned.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED — verified against the tree, do not re-derive
 *
 * `runtime-state.ts:1270`   stationTraceActionTags = [...edChestPainScenario.requiredTraceTags]
 * `runtime-state.ts:1392`   deriveRuntimeTraceActionTags(bundle) reads bundle.sceneManifest
 *                           .dialogueTurns[].traceTag and, when that is empty, RETURNS
 *                           edChestPainScenario.requiredTraceTags (`:1397`)
 * `runtime-state.ts:1807`   remoteActorTurnForTraceTag(tag) — a 9-entry table with NO scenarioId
 *                           parameter, whose actorIds are patient_robert_hayes_v1 /
 *                           nurse_maria_alvarez_v1 / spouse_anna_hayes_v1 and whose utterances are
 *                           chest-pain specific ("Please obtain a 12-lead ECG now")
 * `main.ts:2111-2117`       the Trace Actions buttons render from state.requiredTraceTags
 *
 * Overlap between that 9-entry table and each station's OWN authored required trace tags:
 *
 *     ED chest pain          9/10        psych safety           3/9
 *     peds fever             3/9         peds asthma            2/9
 *     stroke alert           1/8         telehealth diabetes    1/7      oncology   1/7
 *     OB preeclampsia        0/7         ward delirium          0/8      postop     0/7
 *     stepdown sepsis        0/7         dyslipidemia           0/6      interpreter 0/7
 *
 * PIXELS, MY OWN GRADE, `psych_suicidal_ideation_safety_v1`: the Trace Actions panel offers History
 * Opqrst, Risk Factor Question, Associated Symptom Question, Vitals Review, **Ecg Request**, Urgent
 * Escalation, Team Communication, Family Communication. A suicide-risk safety-planning encounter
 * whose learner affordances are an ECG order set. Its own authored tags — `direct_suicide_question`,
 * `intent_plan_means_assessment`, `protective_factors`, `confidentiality_explanation`,
 * `suicide_safety_plan` — appear nowhere in the running app.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE CONTENT ALREADY EXISTS AND IS FULLY AUTHORED
 *
 * `scenario-bank.ts` exports `scenarioDialogueSeedBank` — 14 entries, 4 `DialogueFixtureSeed` each,
 * carrying actorId, learnerUtterance, visibleFacts, hiddenFactCanaries and expectedTraceTags.
 * `model-gateway` and `exam-assembly` both consume it. **ui-xr does not import it at all.** Every
 * scenario also declares its own `requiredTraceTags` and `governance.safetyCriticalTraceTags`, and
 * `main.ts:2386` already reads `scenario.requiredTraceTags` for the history-coverage HUD — so the
 * scenario object is in hand at the call site and is simply not used for these two surfaces.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT A PEER ROUND CHANGED, because it matters to how you read (1)
 *
 * My first contract was "no station's action set equals ED's when the scenario is not ED". The peer
 * killed it as vacuous and it was right: renaming one tag, dropping one, or emitting a single stub
 * `generated_fallback_dialogue:*` all satisfy it while leaving the station unusable. (1) is therefore
 * SET EQUALITY against the station's own authored tags, which nothing accidental produces.
 *
 * The peer also checked the layer question and the answer is not what I assumed. The FACTORY is not
 * the offender: `runtimeDialogueTurnsForScenario`
 * (`tools/openclinxr/factory/generated-ed-station-runtime-bundle.ts:815-860`) already maps each
 * scenario's own `requiredTraceTags` correctly. The consumer's ED fallback is what poisons stations
 * whose shipped manifest has no turns. Filling factory manifests is a legitimate follow-on and is
 * NOT a prerequisite — the consumer can read the bank today.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message. I have NOT resolved them.
 *
 *  - SEEDS DO NOT COVER EVERY TAG, and this is the one that will bite. Oncology has 4 seeds against
 *    7 required tags; ward delirium 4 against 8. So the seed bank alone cannot furnish a
 *    learnerUtterance for every button. `scenarioDialogueText(...)` in the factory file above already
 *    synthesizes per-tag text from a scenario and may be reusable, extractable, or wrong for this —
 *    I have not evaluated it. Decide, and say what you rejected.
 *  - Where the resolver lives — a ui-xr module, or a shared package both ui-xr and the factory can
 *    call. `apps/ui-xr/src/main.ts` is under a shrink-only size ratchet: do NOT raise its ceiling.
 *  - Whether `stationTraceActionTags` and the 9-entry table are deleted, or demoted to ED-only data.
 *  - What happens for a scenarioId absent from the bank. Today that path silently becomes ED, which
 *    is how this defect stayed invisible; a visible failure may be better than a plausible wrong one.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * AN EXISTING TEST ENCODES THE DEFECT AS INTENDED BEHAVIOUR — change it, do not delete it
 *
 * `apps/ui-xr/src/runtime-state.test.ts:277` is titled "falls back to ED requiredTraceTags when
 * sceneManifest.dialogueTurns is absent (#69 telehealth shell boot)". Its ASSERTIONS are compatible
 * with the fix — it only checks `tags.length > 0` and the scenarioId — so it should keep passing once
 * the fallback becomes scenario-derived. The title and comment are what become false. Rename it to
 * describe scenario-derived recovery and record why in the commit message.
 *
 * No OTHER existing test may be edited to make these pass. If one genuinely encodes the old
 * behaviour, say which and why in the report rather than quietly rewriting it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands the right buttons and is satisfiable while every click still speaks in Robert Hayes's
 * voice about his chest pain. (2) demands the speech come from the station's own cast, and is
 * satisfiable by returning nothing at all for non-ED stations — which is why it requires coverage of
 * each station's SAFETY-CRITICAL tags specifically. (3) is green today and forbids buying either by
 * regressing the one station that works.
 *
 * I have deliberately not set a numeric coverage floor. A percentage would become the design target
 * (§7a — a 0.25 m height contract once produced a figure sitting chin-to-chest). "Every
 * safety-critical tag the scenario itself declares" is authored, small, and is the clinically right
 * requirement rather than a number I picked.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectScenarioConversationSurface()`. Change
 * the call sites and say why if a different shape is better. What must not change: stations are
 * enumerated from what ships rather than a list — that single property is why #102 and #105
 * generalised while #72, #94, #96 and #97 each stayed local — and the action set and turns are read
 * through the same resolver the running app uses, not a parallel copy built for the test.
 *
 * REQUIRED, and this is the observable half: the Trace Actions panel must visibly change in the
 * capture. Re-capture psych and OB with
 * `tsx tools/openclinxr/evidence/ui-xr-environment-room-capture.ts --scenario <id>` and state what
 * the panel reads afterwards. A resolver nothing renders is the correct-and-inert outcome this
 * project has hit three times; wiring it into the running app is REQUIRED, not optional.
 *
 * IN-SCOPE VISUAL VERDICT, naming the station: "in psych the Trace Actions panel now offers ___".
 * Separately name any out-of-scope wrongness — the object and what it looks like, not the word
 * "deformed". If satisfying these contracts makes the product visibly worse than before, say so in
 * your report and then satisfy them anyway; naming it will not be read as refusing the work.
 *
 * SCOPE: whether the learner's affordances and the actors' speech come from the station they are in.
 * Says NOTHING about whether the authored dialogue is clinically good — that needs a clinician — nor
 * about wardrobe, geometry, or the duplicate-slot fan-out seen in psych and telehealth.
 */

const load = async () =>
  import("./scenario-derived-conversation-surface.js") as Promise<Record<string, unknown>>;

type StationConversationSurface = {
  scenarioId: string;
  /** The tags the running app offers as learner Trace Actions, via the app's own resolver. */
  offeredTraceTags: string[];
  /** What the scenario itself declares. */
  authoredTraceTags: string[];
  authoredSafetyCriticalTraceTags: string[];
  /** Actor ids declared by this scenario. */
  scenarioActorIds: string[];
  /** One entry per offered tag that resolves to an actor turn. */
  turns: { traceTag: string; actorId: string; learnerUtterance: string }[];
};
type Inspect = () => Promise<{ stations: StationConversationSurface[] }>;

const ED = "ed_chest_pain_priority_v1";
/** The ED cast. Present in no other station's actor list. */
const ED_ACTOR_IDS = ["patient_robert_hayes_v1", "nurse_maria_alvarez_v1", "spouse_anna_hayes_v1"];

const sorted = (values: readonly string[]) => [...new Set(values)].sort();

describe("each station's conversation surface comes from that station (#106)", () => {
  it.fails("the learner's action set is the station's own authored trace tags", async () => {
    // Set equality, not "differs from ED" — the peer round killed that as vacuous. Psych currently
    // offers an ECG button in a suicide-risk safety-planning encounter.
    const mod = await load();
    const inspect = mod["inspectScenarioConversationSurface"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.stations.length, `only ${report.stations.length} stations were enumerated`).toBeGreaterThan(8);

    const offenders: string[] = [];
    for (const station of report.stations) {
      const offered = sorted(station.offeredTraceTags);
      const authored = sorted(station.authoredTraceTags);
      if (JSON.stringify(offered) !== JSON.stringify(authored)) {
        offenders.push(
          `${station.scenarioId}\n    offered:  ${offered.join(", ")}\n    authored: ${authored.join(", ")}`,
        );
      }
    }
    expect(offenders, `stations offering an action set that is not their own:\n${offenders.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it.fails("every safety-critical moment is spoken by the station's own cast", async () => {
    // Kills the cheap satisfaction of the first contract: correct buttons whose every click is still
    // answered by an ED patient about chest pain, or answered by nobody at all.
    const mod = await load();
    const inspect = mod["inspectScenarioConversationSurface"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();

    const foreignCast: string[] = [];
    const uncovered: string[] = [];
    for (const station of report.stations) {
      const cast = new Set(station.scenarioActorIds);
      for (const turn of station.turns) {
        if (!cast.has(turn.actorId)) {
          foreignCast.push(`${station.scenarioId}/${turn.traceTag} spoken by ${turn.actorId}`);
        }
        if (station.scenarioId !== ED && ED_ACTOR_IDS.includes(turn.actorId)) {
          foreignCast.push(`${station.scenarioId}/${turn.traceTag} spoken by the ED cast (${turn.actorId})`);
        }
      }
      const spoken = new Set(station.turns.map((t) => t.traceTag));
      for (const tag of station.authoredSafetyCriticalTraceTags) {
        if (!spoken.has(tag)) uncovered.push(`${station.scenarioId}/${tag}`);
      }
    }

    expect(foreignCast, "turns spoken by an actor who is not in that station").toHaveLength(0);
    expect(uncovered, "safety-critical trace tags with no actor turn at all").toHaveLength(0);
  }, 900_000);

  it.fails("the ED bay keeps its own surface (COUNTERWEIGHT — working today)", async () => {
    // A generalisation that breaks the one station that works has traded one defect for another.
    const mod = await load();
    const inspect = mod["inspectScenarioConversationSurface"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const ed = report.stations.find((s) => s.scenarioId === ED);
    expect(ed, "the ED bay was not enumerated").toBeDefined();

    expect(sorted(ed!.offeredTraceTags)).toEqual(sorted(ed!.authoredTraceTags));
    expect(ed!.turns.length, "the ED bay lost its actor turns").toBeGreaterThan(0);
    for (const turn of ed!.turns) {
      expect(ed!.scenarioActorIds, `ED turn ${turn.traceTag} left the ED cast`).toContain(turn.actorId);
    }
  }, 900_000);
});
