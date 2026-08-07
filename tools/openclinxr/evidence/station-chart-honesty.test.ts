import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#127) — the Simulated EHR panel prints the scoring goal in the chief-concern row,
 * and the interruption row prints an event-schedule tag. A learner reads what they are being tested on
 * before they speak to anyone.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — #115's vitals classes and the ED bay's chart must both
 * survive. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS IS #115 ONE FIELD OVER, AND THE SAFETY REASONING IS DIFFERENT
 *
 * #115 stopped eleven stations showing environment prose under a heading reading INITIAL VITALS. The
 * danger there was that a learner reads invented numbers as measured truth.
 *
 * The danger HERE is exam security. A peer round corrected my framing:
 *
 *   fake `BP 168/104`                 looks measured, learner absorbs false data, does not spoil the exam
 *   objective as chief concern        does not look measured, but PRINTS THE TEST IN THE CHART
 *   authored patient-voice complaint  neither, unless it is over-specific
 *
 * So #115's answer — stop showing it, default to an honest unauthored state — is right again, for a
 * different reason. But **writing a chief concern is NOT the same act as inventing vitals.** A chief
 * concern is patient voice, and #113 already put authored patient voice in the bank as
 * `openingUtterance`. Deriving from authored patient content is not invention. Deriving from
 * `clinicalObjectives[0]` is the bug.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED — verified against the tree, do not re-derive
 *
 * `generated-ed-station-runtime-bundle.ts:758`
 *     chiefConcern: scenario.clinicalObjectives[0] ?? scenario.title
 *
 *     ward       -> "Distinguish delirium from baseline cognitive impairment"
 *     oncology   -> "Reviewing difficult scan results with family present"
 *
 * `:761-763`  interruption is synthesized from the event schedule:
 *     `${actorDisplayName(...)} cue at ${firstEvent.atSecond}s: ${firstEvent.tag.replaceAll("_"," ")}`
 *
 *     ward       -> "cue at 240s: fall risk action"   (a debug string; the actor name resolved empty)
 *
 * Both read off my own captures, not inferred.
 *
 * FOUR RENDER PATHS, all verified. Whatever lands must reach all of them:
 *     main.ts:1795-1797   DOM panel
 *     main.ts:1879-1881   text update
 *     main.ts:4875-4877
 *     main.ts:5092-5096   clinicalPanelLinesForSelectedStation — the IN-SCENE WALL PLACARD
 *
 * Neither field is authorable: the scenario bank has no `chiefConcern` field (zero grep hits) and
 * `apps/ui-admin/src` has zero references to chiefConcern / initialVitals / stationContext.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * §6p — WHAT REPLACES IT. #73 deleted painted clothing where a real garment existed and left a figure
 * topless. Deleting the objective and leaving the row blank makes the panel worse.
 *
 * **The unauthored copy is NOT the implementer's decision.** In the #115 retro the worker had to invent
 * learner-facing copy mid-slice; that is a product voice decision and it should not be delegated. Use
 * #115's voice and shape. If you believe a different string is right, say so in your report and use the
 * specified one anyway.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - Where the provenance field lives and what its values are. #115 shipped `initialVitalsAuthorship`
 *    with `legacy_hardcoded_unreviewed`; matching that shape is obvious but not mandatory.
 *  - Whether a chief concern may be DERIVED from the patient's authored `openingUtterance` (#113)
 *    rather than left unauthored. I lean yes and I am not certain — an opening line is not a
 *    presenting complaint.
 *  - What the interruption row shows when the only source is an event-schedule tag. The tag is
 *    authoring metadata; a learner should probably not see the schedule at all.
 *  - Whether the ED bay's hand-authored `contexts` table at `:771-806` survives as a fast path or is
 *    deleted, as #106/#107/#114/#122 each deleted the same hardcoded-ED pattern from a different
 *    surface.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (2) is satisfiable by marking every field authored while still deriving from objectives. (1) forbids
 * that with a derivation check that does not care what the provenance says. (3) is green today and
 * forbids buying either by blanking the fields or by breaking #115.
 *
 * **CONTRACT (1) IS A NEAR-MATCH CHECK AND IT IS NOT A PROOF.** A synonym rewrite defeats byte
 * equality, which is why it uses normalized token overlap. No machine check can prove a string is a
 * patient complaint rather than a reworded objective — the peer round said so plainly and I am
 * recording it rather than pretending otherwise. **The pixel grade closes this and it is mine.** If you
 * satisfy both contracts and the panel still reads like an exam brief, SAY SO. That is the most useful
 * report available.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectStationChartHonesty()`. What must not
 * change: stations are enumerated from what ships, and values are read from the shipped bundle the
 * runtime actually loads.
 *
 * REQUIRED, the observable half: re-capture ward and oncology and state what the EHR panel and the
 * in-scene wall placard read.
 *
 * IN-SCOPE VISUAL, as separate slots you must fill:
 *     IN-SCOPE VISUAL: chief concern row ___ ; interruption row ___ ; wall placard ___ ;
 *                      anything that now reads as broken ___
 *
 * Also report any out-of-scope wrongness you see. The garment defects are known (#124, #103); report
 * anything else on the same figures anyway and do not compress it because it seems related.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * If satisfying a contract here will make the product visibly worse than before, say so in your report
 * — and then satisfy it anyway. Naming it is not disobedience and will not be read as refusing work.
 *
 * SCOPE: what the learner-visible chart says and where it came from. Says NOTHING about whether any
 * authored clinical text is clinically correct — that needs a clinician — nor about vitals, which #115
 * settled.
 */

const load = async () => import("./station-chart-honesty.js") as Promise<Record<string, unknown>>;

type ChartFieldSource =
  | "authored_patient_voice"
  | "authored_reviewed"
  | "legacy_hardcoded_unreviewed"
  | "unauthored"
  | "derived_from_objective"
  | "derived_from_event_schedule";

type StationChartField = {
  /** Which learner-visible row this is: "chiefConcern" | "interruption". */
  fieldName: string;
  /** The string the runtime renders. */
  rawValue: string;
  /** Where it came from. Only the first four are honest for a learner-visible chart. */
  source: ChartFieldSource;
  /**
   * Highest normalized token-set overlap between rawValue and any of the station's own
   * clinicalObjectives, 0..1. A reworded objective still scores high; an unrelated string does not.
   */
  maxObjectiveOverlap: number;
  /** True when the value carries an event-schedule synthesis shape (a cue marker, a tag, a timestamp). */
  looksLikeScheduleSynthesis: boolean;
};

type StationChart = {
  scenarioId: string;
  fields: StationChartField[];
  /** #115's classes, for the counterweight. */
  initialVitalsAuthorship: string;
  initialVitalsValueClass: string;
};

type Inspect = () => Promise<{ stations: StationChart[] }>;

/**
 * A reworded objective still shares most of its content words. Unrelated patient voice does not.
 * This bounds the cheap satisfaction of contract (2); it does not prove the string is patient voice.
 */
const MAX_OBJECTIVE_OVERLAP = 0.5;

const HONEST_SOURCES: ChartFieldSource[] = [
  "authored_patient_voice",
  "authored_reviewed",
  "legacy_hardcoded_unreviewed",
  "unauthored",
];

const ED = "ed_chest_pain_priority_v1";

describe("the learner-visible chart does not print the test (#127)", () => {
  /**
   * ## FIXED (#127)
   * Producer no longer uses clinicalObjectives[0] or event-schedule synthesis.
   * chiefConcern ← patient.openingUtterance (authored_patient_voice) or unauthored copy;
   * interruption ← unauthored copy only. Runtime stationContextForScenario always
   * re-resolves (SSOT), so stale shipped bundles cannot re-print the test.
   * Pre-fix measure: .openclinxr/evidence/station-chart-honesty/pre-fix.json
   * (MAX_OBJECTIVE_OVERLAP 0.5; ward/oncology were 100% objective overlap).
   */
  it("no learner-visible chart field is derived from a scoring objective or an event-schedule tag", async () => {
    // ward renders "Distinguish delirium from baseline cognitive impairment" under CHIEF CONCERN and
    // "cue at 240s: fall risk action" under INTERRUPTION. The overlap bound is what stops a synonym
    // rewrite satisfying this; it is not a proof that the replacement is patient voice.
    const mod = await load();
    const inspect = mod["inspectStationChartHonesty"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.stations.length, `only ${report.stations.length} stations enumerated`).toBeGreaterThan(8);

    const spoiled: string[] = [];
    for (const s of report.stations) {
      expect(s.fields.length, `${s.scenarioId} exposed no chart fields`).toBeGreaterThan(0);
      for (const f of s.fields) {
        if (f.maxObjectiveOverlap > MAX_OBJECTIVE_OVERLAP) {
          spoiled.push(
            `${s.scenarioId}.${f.fieldName}: ${(f.maxObjectiveOverlap * 100).toFixed(0)}% overlap with a `
            + `clinical objective — "${f.rawValue.slice(0, 60)}"`,
          );
        }
        if (f.looksLikeScheduleSynthesis) {
          spoiled.push(`${s.scenarioId}.${f.fieldName}: event-schedule synthesis — "${f.rawValue.slice(0, 60)}"`);
        }
      }
    }
    expect(spoiled, `chart rows that print the test:\n${spoiled.join("\n")}`).toHaveLength(0);
  }, 900_000);

  /** ## FIXED (#127) — chiefConcernAuthorship / interruptionAuthorship on resolve + view. */
  it("every chart field carries a source with recorded provenance", async () => {
    // Kills the cheap satisfaction of the first contract in the other direction: paraphrasing the
    // objective enough to slip under the overlap bound leaves the field still undeclared. An honest
    // source is one of four; "derived_from_objective" and "derived_from_event_schedule" are the two
    // this slice exists to eliminate from learner-visible rows.
    const mod = await load();
    const inspect = mod["inspectStationChartHonesty"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const undeclared: string[] = [];
    for (const s of report.stations) {
      for (const f of s.fields) {
        if (!HONEST_SOURCES.includes(f.source)) {
          undeclared.push(`${s.scenarioId}.${f.fieldName}: source "${f.source}"`);
        }
        if (f.source !== "unauthored" && f.rawValue.trim().length === 0) {
          undeclared.push(`${s.scenarioId}.${f.fieldName}: claims a source but renders nothing`);
        }
      }
    }
    expect(undeclared, `chart rows with no honest provenance:\n${undeclared.join("\n")}`).toHaveLength(0);
  }, 900_000);

  /** ## FIXED (#127) — module present; vitals untouched; ED chief concern still matches /chest/. */
  it("#115's vitals classes and the ED bay's chart survive (COUNTERWEIGHT)", async () => {
    // Two ways to buy the first two contracts cheaply: blank every chart row, or regress #115 while
    // reworking the same producer. The ED bay is the one station whose chart is hand-authored and
    // clinically shaped today; a rewrite must not cost it.
    const mod = await load();
    const inspect = mod["inspectStationChartHonesty"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    for (const s of report.stations) {
      expect(
        s.initialVitalsValueClass,
        `${s.scenarioId} lost #115's vitals classification`,
      ).toMatch(/^(unauthored|authored_numeric)$/u);
      expect(
        s.initialVitalsAuthorship.trim().length,
        `${s.scenarioId} lost #115's vitals authorship`,
      ).toBeGreaterThan(0);
      for (const f of s.fields) {
        expect(f.rawValue.trim().length, `${s.scenarioId}.${f.fieldName} was blanked`).toBeGreaterThan(0);
      }
    }

    const ed = report.stations.find((s) => s.scenarioId === ED);
    expect(ed, "the ED bay was not enumerated").toBeDefined();
    const edConcern = ed!.fields.find((f) => f.fieldName === "chiefConcern");
    expect(edConcern, "the ED bay lost its chief concern row").toBeDefined();
    expect(edConcern!.rawValue, "the ED bay lost its hand-authored chief concern").toMatch(/chest/iu);
  }, 900_000);
});
