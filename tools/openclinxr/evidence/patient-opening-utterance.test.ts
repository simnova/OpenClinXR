import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#113) — a patient's opening line is not authored anywhere durable. The good
 * lines live in a hardcoded table inside the RUNTIME, and the factory that regenerates bundles emits
 * the patient's clinical DEMEANOR as spoken words for every station in the bank.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the eleven authored lines that exist today are good
 * writing and must survive the move. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WRITE THE PRE-FIX ARTIFACT BEFORE ANY PRODUCT EDIT
 *
 * `.openclinxr/evidence/patient-opening-utterance/pre-fix.json`, listing every station and where its
 * line comes from today. This is a `done_when` proof. Three workers have told me prose "measure
 * first" does not bind and only a gate does.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED — verified against the tree, do not re-derive
 *
 * I ran this over every station in `scenarioBank`, reading the shipped bundle's
 * `sceneManifest.stationContext.initialDialogueText`:
 *
 *     authored line             10 stations
 *     DERIVED FROM DEMEANOR      1 station — ward_delirium_med_rec_v1
 *     NO LINE AT ALL             3 stations — primary_care_dyslipidemia_joint_pain_v1,
 *                                             adult_abdominal_pain_v1, peds_fever_v1
 *
 * Ward's line reads `"Margaret Ellis: fluctuating confusion, hard of hearing, frail, trying to leave
 * bed"` — a clinical description of the patient, presented as words she says. I have graded it in
 * the running app.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A PEER ROUND FOUND THE PART THAT MAKES THIS URGENT, AND CORRECTED MY FRAMING
 *
 * I said the opening line's only home was the generated bundle. **Wrong.**
 *
 * `apps/ui-xr/src/initial-dialogue-text.ts:12-35` — `BANK_FALLBACK_LINES`, an ELEVEN-ENTRY HARDCODED
 * TABLE inside the runtime. That is where the good lines actually live.
 *
 * `tools/openclinxr/factory/generated-ed-station-runtime-bundle.ts:676-691` — for ANY scenario found
 * in `scenarioBank`, the factory returns early with
 *
 *     initialDialogueText: `${patient.displayName}: ${patient.demeanor}`
 *
 * and never reaches the hand-authored `contexts` table at `:693+`, which is therefore dead for all
 * fourteen bank stations.
 *
 * **So the ten good lines in the shipped bundles are STALE ARTIFACTS.** Any real regeneration
 * replaces every one of them with demeanor-as-speech. Ward looks broken today only because ward's
 * bundle was regenerated recently; the other stations are carrying pre-regeneration text and are one
 * factory run away from the same defect. That is the reason this is worth a slice rather than a
 * one-line patch to ward.
 *
 * `demeanor` has a legitimate job elsewhere — `session-state/src/internal.ts:267-272` derives
 * emotional state from it. It is stage direction. Using it as dialogue is a category error. Keep the
 * field; stop speaking it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHERE IT GOES — decided by the peer round, do not relitigate
 *
 * A first-class field on the PATIENT ACTOR in the scenario bank, so speaker and line travel together
 * and a station with more than one patient stays well-defined. NOT on the scenario root. NOT in
 * `scenarioDialogueSeedBank` — those carry `learnerUtterance`, the learner's prompts, not the
 * patient's cold open (`ed-chest-pain.ts:3-9`).
 *
 * If you believe another home is right after looking, say why in your report and implement the
 * decided design anyway. Disagreement is a report slot, not a redesign.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - The field name, and whether it is optional in the schema or required for `role === "patient"`.
 *  - Whether the runtime keeps a fallback at all when the field is absent, and what it says. A loud
 *    absence may be better than a plausible wrong line — that is how this defect survived.
 *  - Whether `BANK_FALLBACK_LINES` is deleted once the bank carries the text, or kept as a
 *    regression net. Deleting is less to drift; keeping is safer. I have not evaluated which.
 *  - What the four stations without a good line actually say. You are writing clinical opening
 *    utterances — keep them plain, in the patient's voice, consistent with that scenario's chief
 *    concern and demeanor, and do NOT claim they are clinician-reviewed. Say in your report that
 *    they need clinical review.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SCOPE BOUNDARY — #111 IS RUNNING CONCURRENTLY IN `apps/ui-xr/src/main.ts`
 *
 * It owns `runtimeHumanoidVariantAssetPath` around `main.ts:7543` — the humanoid cast path. I checked
 * what the two share: `main.ts:46` imports `initialDialogueTextForScenario` and `:1342-1347` calls
 * it. That import glue is the ONLY contact, and #111 has no reason to touch it.
 *
 * Your scope: `packages/openclinxr/scenario-fixtures/**`, `packages/openclinxr/shared-schemas/**`,
 * `tools/openclinxr/factory/**`, `apps/ui-xr/src/initial-dialogue-text.ts`, and the shipped bundles.
 * Do NOT edit `apps/ui-xr/src/main.ts`. If you believe you must, STOP and say so — that is a real
 * finding, not a failure.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands a real authored utterance per patient, and is satisfiable by copying the demeanor
 * string into the new field — same words, new home. So (1) itself asserts the two differ. (2) demands
 * the producer and the runtime both read it, and is satisfiable while the four broken stations get
 * the generic "I am ready to begin this encounter." — so it forbids that string for those four
 * specifically. (3) is green today and forbids buying either by discarding the eleven lines someone
 * already wrote well.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectPatientOpeningUtterance()`. What must not
 * change: stations are enumerated from what ships, the producer value is read from the factory
 * function the build actually calls, and the runtime value from the function the app actually calls.
 *
 * REQUIRED, the observable half: re-capture `ward_delirium_med_rec_v1` and one of the three stations
 * that has no line today, and state what the Mock Dialogue panel reads in each.
 *
 * IF ANY PROOF IN THIS BRIEF CANNOT PASS AS WRITTEN, SAY SO IN YOUR REPORT. Do not silently run a
 * corrected version.
 *
 * IN-SCOPE VERDICT required, naming the station. Separately name any out-of-scope wrongness — the
 * object and what it looks like, not "deformed". If satisfying these contracts makes the product
 * visibly worse, say so and then satisfy them anyway.
 *
 * SCOPE: whether a patient's first words are authored. Says NOTHING about whether they are
 * clinically appropriate — that needs a clinician — nor about any later turn in the conversation.
 */

const load = async () => import("./patient-opening-utterance.js") as Promise<Record<string, unknown>>;

type StationOpening = {
  scenarioId: string;
  patientActorId: string;
  patientDisplayName: string;
  /** The authored opening utterance from the scenario bank, or "" when absent. */
  bankOpeningUtterance: string;
  /** The patient's demeanor field — stage direction, never speech. */
  patientDemeanor: string;
  /** What the factory would emit into sceneManifest.stationContext.initialDialogueText. */
  producedInitialDialogueText: string;
  /** What the running app resolves for this station. */
  runtimeInitialDialogueText: string;
};
type Inspect = () => Promise<{ stations: StationOpening[] }>;

/** The four with no good line today. They must not end up on a generic string. */
const BROKEN_TODAY = [
  "ward_delirium_med_rec_v1",
  "primary_care_dyslipidemia_joint_pain_v1",
  "adult_abdominal_pain_v1",
  "peds_fever_v1",
];
const GENERIC = "I am ready to begin this encounter.";

const norm = (s: string) => s.trim().toLowerCase();

describe("a patient's first words are authored, not their demeanor (#113)", () => {
  it("every patient has an opening utterance that is not their demeanor", async () => {
    // Copying the demeanor string into a new field is the cheapest way to satisfy a presence check,
    // and it is exactly the defect wearing a new name.
    const mod = await load();
    const inspect = mod["inspectPatientOpeningUtterance"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.stations.length, `only ${report.stations.length} stations enumerated`).toBeGreaterThan(8);

    const bad: string[] = [];
    for (const s of report.stations) {
      const utterance = s.bankOpeningUtterance.trim();
      if (!utterance) { bad.push(`${s.scenarioId}: no opening utterance`); continue; }
      if (norm(utterance) === norm(s.patientDemeanor)) bad.push(`${s.scenarioId}: utterance IS the demeanor`);
      else if (s.patientDemeanor.trim() && norm(utterance).includes(norm(s.patientDemeanor).slice(0, 24))) {
        bad.push(`${s.scenarioId}: utterance contains the demeanor verbatim`);
      }
      if (!utterance.includes(" ")) bad.push(`${s.scenarioId}: single-token utterance "${utterance}"`);
      if (!/[.?!]$/u.test(utterance)) bad.push(`${s.scenarioId}: utterance does not end as a sentence`);
    }
    expect(bad, `patients without a real authored opening line:\n${bad.join("\n")}`).toHaveLength(0);
  }, 600_000);

  it("the producer and the runtime both speak the authored line", async () => {
    // Kills the cheap satisfaction of the first contract: authoring the field and leaving the factory
    // emitting demeanor, or leaving the four broken stations on the generic ready-to-begin string.
    const mod = await load();
    const inspect = mod["inspectPatientOpeningUtterance"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const bad: string[] = [];
    for (const s of report.stations) {
      const expected = `${s.patientDisplayName}: ${s.bankOpeningUtterance.trim()}`;
      if (s.producedInitialDialogueText.trim() !== expected) {
        bad.push(`${s.scenarioId} producer: "${s.producedInitialDialogueText}" expected "${expected}"`);
      }
      if (s.runtimeInitialDialogueText.trim() !== expected) {
        bad.push(`${s.scenarioId} runtime: "${s.runtimeInitialDialogueText}" expected "${expected}"`);
      }
      if (BROKEN_TODAY.includes(s.scenarioId) && s.runtimeInitialDialogueText.includes(GENERIC)) {
        bad.push(`${s.scenarioId} still falls back to the generic line`);
      }
    }
    expect(bad, `producer/runtime disagreeing with the authored line:\n${bad.join("\n")}`).toHaveLength(0);
  }, 600_000);

  it("the eleven lines someone already wrote survive (COUNTERWEIGHT)", async () => {
    // These are good writing, currently stranded in a hardcoded runtime table. Moving their home must
    // not become an excuse to regenerate everything into blandness.
    const mod = await load();
    const inspect = mod["inspectPatientOpeningUtterance"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const byId = new Map(report.stations.map((s) => [s.scenarioId, s]));
    const keep: Record<string, string> = {
      psych_suicidal_ideation_safety_v1: "I do not feel safe being alone right now.",
      ed_chest_pain_priority_v1: "It feels heavy, like someone is sitting on my chest.",
      oncology_bad_news_family_v1: "I want my sister here before we talk about the scan results.",
      ob_headache_preeclampsia_triage_v1: "My headache is getting worse, and the lights are bothering my eyes.",
    };
    for (const [scenarioId, line] of Object.entries(keep)) {
      const station = byId.get(scenarioId);
      expect(station, `${scenarioId} was not enumerated`).toBeDefined();
      expect(
        station!.bankOpeningUtterance.trim(),
        `${scenarioId} lost its authored line`,
      ).toBe(line);
    }
  }, 600_000);
});
