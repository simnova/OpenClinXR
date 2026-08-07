import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#107) — psych renders one cast and reads its clinical content from another.
 *
 * ALL THREE ARE `it.fails` AND ALL THREE FLIP. They are not all REDs:
 *   (1) and (2) are REDs — behaviour that does not exist.
 *   (3) is a COUNTERWEIGHT — it asserts the scenario bank's psych content is UNCHANGED. It is
 *       `it.fails` only because the module is absent. It exists because the cheapest way to make
 *       (1) pass is to edit the bank to say "Morgan Lee", which is backwards: the bank holds every
 *       authored emotion profile, Satir style, escalation trigger, dialogue seed and rubric.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * MEASURE EVERY STATION FIRST, THEN FIX THE ONE THAT IS BROKEN
 *
 * Build `inspectCastIdentityAgreement()`, enumerate every shipped station, and write the artifact
 * BEFORE changing anything. Psych is the motivation and — this time — I believe it is also the only
 * genuine offender. I could be wrong about that, which is why the measurement is first and why
 * contract (1) is scoped by what the artifact finds rather than to psych alone.
 *
 * MY FIRST MEASUREMENT WAS WRONG AND A PEER ROUND CAUGHT IT. I reported four stations with foreign
 * actor ids. Three were noise from my own regex, which read only `actorId: "…"` object-form
 * declarations and missed the `actor("id", …)` builder form used by other fixtures:
 *   - `stroke_nurse_chen_v1` IS in the bank (`stroke-alert.ts:43`)
 *   - `remote_interpreter_tablet_v1` IS in the bank (`abdominal-pain-interpreter.ts:43`)
 *   - `ed_chest_pain_priority_v2` has no bank row; `actor-casting.ts:191-213` aliases v2 to the ED
 *     cast deliberately. Not a defect.
 * Enumerate from the typed `scenario.actors` field, never from a text search.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED — verified against the tree, do not re-derive
 *
 * `psychiatric-safety.ts:25,43,61`  bank cast: patient_jordan_reed_v1, partner_sam_reed_v1,
 *                                   behavioral_health_nurse_owens_v1
 * `generated-ed-station-runtime-bundle.ts:575-582`
 *                                   factory preset hardcodes patient_morgan_lee_v1 +
 *                                   nurse_observer_jamie_v1 — a stale parallel cast
 * shipped `public/xr-assets/generated/psych_suicidal_ideation_safety_v1/learner-runtime-bundle.v1.json:36`
 *                                   carries the Morgan pair
 * `main.ts:1347-1348`               hardcodes "Morgan Lee: I do not feel safe being alone right now."
 *
 * ZERO of the three bank names appear in what renders. Every authored Satir profile, baseline mood,
 * escalation trigger, de-escalation trigger and dialogue seed in psych is written for Jordan Reed and
 * Sam Reed. The partner, Sam, does not exist in the rendered scene at all.
 *
 * A SECOND DRIFT, same table, lower severity: `main.ts:1344-1345` returns
 * "Jordan Williams: My chest feels tight…" for peds asthma, whose bank patient is **Maya Johnson**
 * (`pediatric-asthma.ts:27`). Whether you fix that here is your call — say which you did.
 *
 * WHY THIS IS NOW VISIBLE ON ONE SCREEN. #106 landed and made the Trace Actions panel and the actor
 * turns bank-derived. The Mock Dialogue line still comes from the old path. So psych now displays
 * bank-derived clinical actions beside a hardcoded line naming someone who is not in the bank.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE BANK IS THE SSOT, AND THIS IS DECIDED — a peer round established it, do not relitigate
 *
 * `actor-casting.ts:148,239` — `resolveScenarioActorCast` uses explicit ED/peds tables and otherwise
 * falls through to `castFromScenarioBank`. The bank is already the designed runtime source; the
 * factory's psych preset is a stale parallel that predates it.
 *
 * THE FIX DOES NOT ORPHAN ASSETS. I worried it would and I was wrong. Casting maps bank ids onto
 * SHARED GLB POOLS; there is no `morgan_lee.glb` under `public/generated-humanoids/`. You are
 * re-pointing metadata, not renaming meshes. If you find an asset genuinely keyed to a Morgan id,
 * STOP and report it — that would contradict this paragraph and change the slice.
 *
 * If you believe the bank is the wrong SSOT after looking, say why in your report and implement the
 * decided design anyway. Disagreement is a report slot, not a redesign.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ALL FOUR PLACES MUST CONVERGE OR THE SCREEN STAYS TWO-CAST. Each alone is inert:
 *   - `main.ts` line alone      → humanoids and #106's turns still use the bundle's cast
 *   - factory preset alone      → the learner keeps loading the already-shipped JSON
 *   - regenerating JSON alone   → the next factory run re-emits Morgan
 * So this slice is factory preset + regenerated shipped bundle + the dialogue line, together.
 * REQUIRED, not optional: re-capture psych and state what the Mock Dialogue panel reads afterwards.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message.
 *   - Whether the factory preset's psych branch is corrected to bank ids or DELETED so the branch
 *     falls through to bank-driven casting. Deleting is less code and less to drift; correcting is
 *     smaller and keeps the room props that branch also carries. I have not evaluated which.
 *   - Whether `initialDialogueTextForSelectedScenario`'s ~10 hardcoded branches are replaced by a
 *     lookup of the bank patient's `displayName`, or left alone with only psych corrected. The
 *     factory has a parallel copy in `runtimeStationContextForScenario` — both drift independently.
 *   - Whether the peds "Jordan Williams" / Maya Johnson drift is fixed in this slice.
 *   - How the shipped bundle is regenerated, and whether other stations' bundles change as a side
 *     effect. If regenerating touches stations beyond psych, say which and why.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SCOPE BOUNDARY — #108 IS RUNNING CONCURRENTLY.
 * Do NOT edit `packages/openclinxr/exam-assembly/**` or `apps/api/**`. Do NOT rewrite the scenario
 * bank under `packages/openclinxr/scenario-fixtures/**` — contract (3) forbids it and both slices
 * read it.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectCastIdentityAgreement()`. What must not
 * change: stations are enumerated from what ships, actor identity is read from the typed
 * `scenario.actors` field rather than a text search, and the bundle side is read from the shipped
 * JSON the runtime actually loads.
 *
 * IN-SCOPE VISUAL VERDICT required: "in psych the Mock Dialogue panel now reads ___ and the rendered
 * figures are ___". Separately name any out-of-scope wrongness — the object and what it looks like,
 * not the word "deformed". If satisfying these contracts makes the product visibly worse, say so and
 * then satisfy them anyway.
 *
 * SCOPE: whether the people named in a station's clinical content are the people in the room. Says
 * NOTHING about whether the humanoids look right — psych's figures wear the same shared ED wardrobe
 * meshes either way, and the open-gown defect is #73/#76/#82.
 */

const load = async () => import("./cast-identity-ssot.js") as Promise<Record<string, unknown>>;

type StationCastAgreement = {
  scenarioId: string;
  /** Humanoid actor ids the scenario bank declares, from the typed actors field. */
  bankHumanoidActorIds: string[];
  /** Humanoid actor ids in the shipped learner-runtime-bundle.v1.json. */
  bundleHumanoidActorIds: string[];
  /** What resolveScenarioActorCast returns for this scenario. */
  resolvedCastActorIds: string[];
  /** The Mock Dialogue line the runtime would show. */
  initialDialogueText: string;
  /** displayName of the bank's patient actor. */
  bankPatientDisplayName: string;
};
type Inspect = () => Promise<{ stations: StationCastAgreement[] }>;

const PSYCH = "psych_suicidal_ideation_safety_v1";
const sorted = (v: readonly string[]) => [...new Set(v)].sort();

describe("the people in the room are the people in the clinical content (#107)", () => {
  // ## FIXED (#107) — factory psych branch + shipped bundles + dialogue converge on bank cast.
  it("every station's shipped cast is its bank cast", async () => {
    // Set equality, not subset — a subset is satisfiable by deleting the partner from the bundle,
    // and psych's authored content gives Sam Reed a speaking role.
    const mod = await load();
    const inspect = mod["inspectCastIdentityAgreement"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.stations.length, `only ${report.stations.length} stations enumerated`).toBeGreaterThan(8);

    const offenders: string[] = [];
    for (const s of report.stations) {
      const bank = sorted(s.bankHumanoidActorIds);
      const bundle = sorted(s.bundleHumanoidActorIds);
      if (bundle.length === 0) continue; // no shipped bundle is a different problem
      if (JSON.stringify(bank) !== JSON.stringify(bundle)) {
        offenders.push(`${s.scenarioId}\n    bank:   ${bank.join(", ")}\n    bundle: ${bundle.join(", ")}`);
      }
      expect(
        sorted(s.resolvedCastActorIds),
        `${s.scenarioId}: resolveScenarioActorCast disagrees with the bank`,
      ).toEqual(bank);
    }
    expect(offenders, `stations rendering a cast that is not their own:\n${offenders.join("\n")}`).toHaveLength(0);
  }, 600_000);

  // ## FIXED (#107) — Mock Dialogue uses bank patient displayName (Morgan/Jordan Williams drift closed).
  it("the dialogue line names someone who is actually in the station", async () => {
    // Kills the cheap satisfaction of the first contract: converging the ids while the panel still
    // reads "Morgan Lee". Also catches the peds "Jordan Williams" / Maya Johnson drift.
    const mod = await load();
    const inspect = mod["inspectCastIdentityAgreement"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const wrong: string[] = [];
    for (const s of report.stations) {
      if (!s.initialDialogueText || !s.bankPatientDisplayName) continue;
      if (!s.initialDialogueText.includes(s.bankPatientDisplayName)) {
        wrong.push(`${s.scenarioId}: "${s.initialDialogueText}" but the bank patient is ${s.bankPatientDisplayName}`);
      }
    }
    expect(wrong, `dialogue lines naming someone not in the station:\n${wrong.join("\n")}`).toHaveLength(0);
  }, 600_000);

  // ## FIXED (#107) — module present; bank psych cast unchanged (Jordan/Sam/Owens).
  it("psych's authored clinical content is untouched (COUNTERWEIGHT)", async () => {
    // The cheapest way to make (1) pass is to rewrite the bank to say Morgan Lee. That would throw
    // away every authored Satir profile, escalation trigger, dialogue seed and rubric — all written
    // for Jordan Reed and Sam Reed — to preserve a stale factory literal.
    const mod = await load();
    const inspect = mod["inspectCastIdentityAgreement"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const psych = report.stations.find((s) => s.scenarioId === PSYCH);
    expect(psych, "psych was not enumerated").toBeDefined();

    expect(sorted(psych!.bankHumanoidActorIds)).toEqual([
      "behavioral_health_nurse_owens_v1",
      "partner_sam_reed_v1",
      "patient_jordan_reed_v1",
    ]);
    expect(psych!.bankPatientDisplayName).toBe("Jordan Reed");
  }, 600_000);
});
