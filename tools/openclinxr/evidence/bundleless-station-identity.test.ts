import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#114) — three stations ship no bundle, so the runtime keeps the ED chest-pain
 * bundle and every surface keyed on bundle identity becomes ED's. A paediatric fever encounter
 * offers an ECG button.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the eleven stations that DO ship a bundle must come
 * through untouched. It is `it.fails` only because the module is absent. It exists because the
 * likeliest way to satisfy (2) is a mass regeneration that overwrites the authored opening
 * utterances #113 just landed.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WRITE THE PRE-FIX ARTIFACT BEFORE ANY PRODUCT EDIT
 *
 * `.openclinxr/evidence/bundleless-station-identity/pre-fix.json` — every station, whether it ships a
 * bundle, which scenarioId the runtime ends up keyed on, and its resolved trace tags. This is a
 * `done_when` proof.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED — verified against the tree, do not re-derive
 *
 * Exactly three of the fourteen bank stations have no directory under
 * `apps/ui-xr/public/xr-assets/generated/`:
 *
 *     primary_care_dyslipidemia_joint_pain_v1
 *     adult_abdominal_pain_v1
 *     peds_fever_v1
 *
 * The chain, each link checked:
 *   `main.ts:589`        boot default is `createEdChestPainLocalLearnerRuntimeAssetBundle()`
 *   `main.ts:1079-1083`  the static bundle URL is keyed on `selectedScenarioId()`
 *   404                  leaves the ED bundle in place
 *   `scenario-conversation-surface.ts:122-126`
 *                        `deriveRuntimeTraceActionTagsFromBundle` keys on **`bundle.scenarioId`**
 *   `main.ts:755-760`    mismatch hides the fallback's geometry and shows a "3D Pending" placard
 *
 * PIXELS, MY OWN GRADE, `peds_fever_v1`: no actors render; the placard reads "Peds Fever 3D Pending
 * — Fallback bundle hidden: ed_chest_pain_priority_v1"; the Trace Actions are History Opqrst, Risk
 * Factor Question, Associated Symptom Question, Vitals Review, **Ecg Request**, Urgent Escalation,
 * Team Communication, Family Communication, Empathy Statement, Patient Note Submitted — `Trace 0/10`.
 * A #113 worker independently reported the same shape for `primary_care_dyslipidemia_joint_pain_v1`.
 *
 * **This is not a hole in #106.** #106 made the action set derive from the bank correctly. The
 * fallback replaces the whole bundle including the id that derivation keys on, so the station asks
 * as ED and is answered as ED. #113 landed the opening utterance bank-first — keyed on
 * `selectedScenarioId()` rather than the bundle — and `peds_fever_v1` DID get its authored line. That
 * isolates the defect precisely to surfaces that key on bundle identity.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A PEER ROUND KILLED MY PREFERRED FIX AS INCOMPLETE — read (1) and (2) as a pair
 *
 * I proposed only making the fallback partial, reasoning that shared-path fixes have generalised in
 * this repo while per-station fixes have not. That reasoning is right about the identity poison and
 * wrong as a whole answer:
 *
 *   - identity fix WITHOUT the files → correct actions, still no station bundle, placard stays
 *   - files WITHOUT the identity fix → these three work, and the next station added without a bundle
 *     silently becomes ED again
 *
 * So both, in one slice. (1) is the identity half and does not need any new file. (2) is the ship
 * half.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DO NOT MASS-REGENERATE. This is the main risk and contract (3) exists for it.
 *
 * `pnpm asset:generated-station-bundle` defaults to `--scenario-id` ED and writes a docs report, not
 * the public tree (`generated-ed-station-runtime-bundle.ts:1271`, `:104-126`). Publishing into
 * `apps/ui-xr/public/xr-assets/generated/<id>/` is a separate path
 * (`encounter-publication-payloads.ts:420-424`). Generate the THREE by explicit id. A script that
 * walks every station and rewrites every `learner-runtime-bundle.v1.json` would overwrite the
 * authored `initialDialogueText` values #113 landed hours ago.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - How the identity half is implemented: build a bank-derived in-memory bundle when the static one
 *    is missing, or leave the fallback object in place and make the derivations key on
 *    `selectedScenarioId()` while only asset paths use `bundle.scenarioId`. The peer round sketched
 *    both and preferred neither. I have not evaluated them.
 *  - Whether the "3D Pending" placard still appears once a station has its own bundle, and what it
 *    should say when a station legitimately has no geometry yet. It is currently the only signal
 *    that anything is wrong; removing it silently would be worse than leaving it.
 *  - Whether the mismatch path still hides the fallback's geometry. Hiding is why no actors render;
 *    showing ED's room in a paediatric bay may be worse. Say which you chose and why.
 *  - What the three generated bundles contain for scene props and equipment when the station has no
 *    authored geometry — minimal and honest, or borrowed. Do not invent clinical equipment.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands the runtime speak as the station the learner selected, and is satisfiable with no new
 * files at all. (2) demands the three actually ship a bundle, and is satisfiable by stub directories
 * or by copying ED's JSON and renaming its `scenarioId` — so (2) asserts the bundle's cast matches
 * that station's own bank cast, which a rename cannot fake. (3) is green today and forbids buying
 * either with a mass regeneration.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectBundlelessStationIdentity()`. What must
 * not change: stations are enumerated from what ships, and the trace tags are read through the same
 * derivation the running app uses rather than a reimplementation written for the test.
 *
 * REQUIRED, the observable half: re-capture `peds_fever_v1` and state what the Trace Actions panel
 * reads and whether actors render.
 *
 * IF ANY PROOF IN THIS BRIEF CANNOT PASS AS WRITTEN, SAY SO IN YOUR REPORT. Do not silently run a
 * corrected version.
 *
 * IN-SCOPE VISUAL VERDICT required, naming the station. Separately name any out-of-scope wrongness —
 * the object and what it looks like, not "deformed". If satisfying these contracts makes the product
 * visibly worse, say so and then satisfy them anyway.
 *
 * SCOPE: whether a station the learner selected is the station the runtime presents. Says NOTHING
 * about whether the three stations' geometry is good — they have none authored — nor about wardrobe.
 */

const load = async () => import("./bundleless-station-identity.js") as Promise<Record<string, unknown>>;

type StationIdentity = {
  scenarioId: string;
  /** Does apps/ui-xr/public/xr-assets/generated/<id>/learner-runtime-bundle.v1.json exist? */
  shipsBundle: boolean;
  /** scenarioId recorded inside that bundle, or "" when absent. */
  bundleScenarioId: string;
  /** Humanoid actor ids in the shipped bundle. */
  bundleHumanoidActorIds: string[];
  /** Humanoid actor ids the bank declares. */
  bankHumanoidActorIds: string[];
  /** Trace action tags the running app resolves for this station. */
  resolvedTraceTags: string[];
  /** Tags the bank declares. */
  bankTraceTags: string[];
  /** initialDialogueText inside the shipped bundle, or "" when absent. */
  bundleInitialDialogueText: string;
};
type Inspect = () => Promise<{ stations: StationIdentity[] }>;

const BUNDLELESS_TODAY = [
  "primary_care_dyslipidemia_joint_pain_v1",
  "adult_abdominal_pain_v1",
  "peds_fever_v1",
];

/** #113 authored these into the shipped bundles. A mass regeneration would erase them. */
const AUTHORED_LINES_TODAY: Record<string, string> = {
  ward_delirium_med_rec_v1: "Margaret Ellis: I need to go home. Where is my daughter? I cannot hear you well.",
  psych_suicidal_ideation_safety_v1: "Jordan Reed: I do not feel safe being alone right now.",
};

const sorted = (v: readonly string[]) => [...new Set(v)].sort();

describe("the station a learner selected is the station the runtime presents (#114)", () => {
  // ## FIXED (#114)
  // Identity: deriveRuntimeTraceActionTagsFromBundle(bundle, selectedScenarioId) — bank tags win
  // even when the static fetch 404s and the ED fixture stays loaded for assets.
  // Ship: three learner-runtime-bundle.v1.json under public/xr-assets/generated/<id>/ with each
  // station's own bank cast (not a renamed ED copy). Counterweight lines for #113 preserved.
  it("every station's trace actions are its own, bundle or no bundle", async () => {
    // The identity half. peds_fever offers an ECG button because the ED fallback supplies the
    // scenarioId that deriveRuntimeTraceActionTagsFromBundle keys on. Needs no new files.
    const mod = await load();
    const inspect = mod["inspectBundlelessStationIdentity"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.stations.length, `only ${report.stations.length} stations enumerated`).toBeGreaterThan(8);

    const offenders: string[] = [];
    for (const s of report.stations) {
      const got = sorted(s.resolvedTraceTags);
      const want = sorted(s.bankTraceTags);
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        offenders.push(`${s.scenarioId}\n    resolved: ${got.join(", ")}\n    bank:     ${want.join(", ")}`);
      }
      if (!s.bankTraceTags.includes("ecg_request") && s.resolvedTraceTags.includes("ecg_request")) {
        offenders.push(`${s.scenarioId} offers an ECG button and its bank does not ask for one`);
      }
    }
    expect(offenders, `stations presenting another station's actions:\n${offenders.join("\n")}`).toHaveLength(0);
  }, 900_000);

  it("the three bundle-less stations ship a bundle that is genuinely theirs", async () => {
    // The ship half. Kills stub directories and the copy-ED-and-rename cheat: the cast has to be
    // that station's own bank cast, which a renamed scenarioId cannot fake.
    const mod = await load();
    const inspect = mod["inspectBundlelessStationIdentity"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const byId = new Map(report.stations.map((s) => [s.scenarioId, s]));
    for (const scenarioId of BUNDLELESS_TODAY) {
      const s = byId.get(scenarioId);
      expect(s, `${scenarioId} was not enumerated`).toBeDefined();
      expect(s!.shipsBundle, `${scenarioId} still ships no bundle`).toBe(true);
      expect(s!.bundleScenarioId, `${scenarioId}'s bundle claims another id`).toBe(scenarioId);
      expect(
        sorted(s!.bundleHumanoidActorIds),
        `${scenarioId}'s bundle carries a cast that is not its own`,
      ).toEqual(sorted(s!.bankHumanoidActorIds));
    }
  }, 900_000);

  it("the eleven stations that already ship a bundle are untouched (COUNTERWEIGHT)", async () => {
    // The likeliest way to satisfy (2) is a script that walks every station and rewrites every
    // bundle. That would erase the authored opening utterances #113 landed.
    const mod = await load();
    const inspect = mod["inspectBundlelessStationIdentity"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const byId = new Map(report.stations.map((s) => [s.scenarioId, s]));
    for (const [scenarioId, line] of Object.entries(AUTHORED_LINES_TODAY)) {
      const s = byId.get(scenarioId);
      expect(s, `${scenarioId} was not enumerated`).toBeDefined();
      expect(s!.shipsBundle, `${scenarioId} lost its bundle`).toBe(true);
      expect(
        s!.bundleInitialDialogueText.trim(),
        `${scenarioId}'s authored opening line was overwritten`,
      ).toBe(line);
    }
  }, 900_000);
});
