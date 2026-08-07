import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#115) — eleven of fourteen stations show a learner something that is not vitals
 * under a heading that says INITIAL VITALS.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT — the two stations that carry genuine numeric vitals
 * must keep them. It is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS SLICE DOES NOT AUTHOR ANY VITALS. READ THIS BEFORE ANYTHING ELSE.
 *
 * The obvious fix is to write vitals for the eleven stations that lack them. **Do not.** A peer round
 * was asked the safety question directly and the answer was unambiguous: an LLM or an engineer writing
 * `BP 168/104, HR 92` for a preeclampsia station produces something a learner reads as clinical truth,
 * in a tool whose stated purpose is clinical skills practice. Wrong numbers train wrong actions, and
 * this repo's own posture forbids clinical-validity and exam-equivalence claims.
 *
 * So the safer design, and the one these contracts encode:
 *   - stop putting non-vitals content in a field labelled vitals
 *   - default to an HONEST UNAUTHORED state with explicit copy, not a blank and not a plausible string
 *   - numeric vitals only where a named clinical author supplied them under review
 *
 * **The cheap fix here is DANGEROUS, not merely useless.** A contract asserting "matches a
 * vitals-looking pattern" would go green on invented numbers — it would actively reward the harm. That
 * is why contract (1) asserts a CLASS with provenance, not a shape.
 *
 * Authoring real vitals for the remaining stations is a separate slice with a clinician in the loop.
 * It is not this one, and a worker who fills them here has made the product less safe while turning
 * the tests green.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED — I ran this across every shipped bundle
 *
 *   3 stations carry actual vitals
 *       ed_chest_pain_priority_v1/v2   "BP 152/92, HR 104, RR 20, SpO2 96%"
 *       peds_asthma_parent_anxiety_v1  "HR 128, RR 32, SpO2 91% on room air"
 *
 *   6 carry placeholders, in two strings from two eras
 *       "Scenario-specific vitals pending authored station shell"
 *       "Generated environment evidence pending headset validation"
 *
 *   5 carry ENVIRONMENT PROSE under the vitals heading
 *       "Exam table and abdominal exam zone cues anchor the focused..."
 *       "Chairs and tissue-box cues support emotionally realistic..."
 *       "Post-op bed and abdominal dressing cues drive focused exam..."
 *       "Monitor and IV pump cues support escalation and closed-loop..."
 *
 * Cause: `generated-ed-station-runtime-bundle.ts:843-846` — `initialVitalsForScenario` is a two-entry
 * hardcoded table with a generic fallback, and the hand-authored `contexts` tables below it stuffed
 * station-cue prose into the same slot. `main.ts:1936` and `:2020` render whatever string is there
 * under "Initial vitals". `main.ts:1433-1533` holds a second copy of the same mistake.
 *
 * The scenario bank has NO vitals field — the same shape the opening utterance had before #113.
 *
 * A peer round checked whether anything CONSUMES the environment prose expecting it: nothing does.
 * This is slot reuse that drifted, not a second feature.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - What the unauthored state says to a learner. A blank row may read as broken; "obtain vitals during
 *    the encounter" is honest and clinically ordinary. You are writing learner-facing copy — keep it
 *    plain and do not imply the data exists elsewhere.
 *  - Whether the unauthored state hides the row or shows the copy. Hiding is cleaner; showing is more
 *    honest about the gap. I have no strong view.
 *  - Where the authorship flag lives, and what the two legacy numeric stations get marked as. They are
 *    historical hardcodes, not reviewed content, and marking them `authored_reviewed` would be a lie.
 *  - Whether the station-cue prose is deleted or moved somewhere it belongs. It may be useful text in
 *    the wrong field.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE THREE PULL APART
 *
 * (1) demands every station's vitals field be an honest class, and is satisfiable by marking every
 * station unauthored — including the two that have real numbers. (3) forbids that. (2) demands the
 * runtime not present unauthored content as charted data, and is satisfiable while the strings
 * themselves stay wrong. Together they force honest content AND honest display.
 *
 * SIGNATURE IS THE IMPLEMENTER'S CHOICE. These read `inspectStationVitalsHonesty()`. What must not
 * change: stations are enumerated from what ships, and the values are read from the shipped bundle the
 * runtime actually loads.
 *
 * REQUIRED, the observable half: re-capture two stations — one that had environment prose and one that
 * had a placeholder — and state what the EHR panel reads.
 *
 * IN-SCOPE VISUAL, as separate slots you must fill:
 *     IN-SCOPE VISUAL: vitals row ___ ; rest of the EHR panel ___ ; anything that now reads as broken ___
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: whether the vitals field is honest about what it contains. Says NOTHING about whether any
 * numeric vitals are clinically correct — that needs a clinician and is explicitly out of scope.
 */

const load = async () => import("./station-vitals-honesty.js") as Promise<Record<string, unknown>>;

type VitalsClass = "unauthored" | "authored_numeric" | "environment_prose" | "unclassified";

type StationVitals = {
  scenarioId: string;
  /** Raw string in sceneManifest.stationContext.initialVitals. */
  rawValue: string;
  /** What the value actually is. */
  valueClass: VitalsClass;
  /** Provenance flag: only "authored_numeric" may carry numbers, and only when this says so. */
  authorshipStatus: string;
  /** True when the runtime renders this as a charted vitals row rather than unauthored copy. */
  presentedAsChartedVitals: boolean;
};
type Inspect = () => Promise<{ stations: StationVitals[] }>;

/** The two historical hardcodes. They are legacy, not reviewed — but they are real vitals. */
const LEGACY_NUMERIC = ["ed_chest_pain_priority_v1", "peds_asthma_parent_anxiety_v1"];

describe("the vitals field is honest about what it contains (#115)", () => {
  it.fails("no station shows environment prose or a placeholder as vitals", async () => {
    // Eleven of fourteen do today. The assertion is on the CLASS, not on a vitals-looking pattern —
    // a pattern check would go green on invented numbers, which is the outcome this slice exists to
    // prevent.
    const mod = await load();
    const inspect = mod["inspectStationVitalsHonesty"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.stations.length, `only ${report.stations.length} stations enumerated`).toBeGreaterThan(8);

    const dishonest: string[] = [];
    for (const s of report.stations) {
      if (s.valueClass === "environment_prose" || s.valueClass === "unclassified") {
        dishonest.push(`${s.scenarioId} [${s.valueClass}]: "${s.rawValue.slice(0, 60)}"`);
      }
      if (s.valueClass === "authored_numeric" && s.authorshipStatus === "unauthored") {
        dishonest.push(`${s.scenarioId}: carries numbers with no authorship recorded`);
      }
    }
    expect(dishonest, `stations misrepresenting their vitals field:\n${dishonest.join("\n")}`).toHaveLength(0);
  }, 600_000);

  it.fails("unauthored stations are not presented as charted vitals", async () => {
    // Kills the cheap satisfaction of the first contract: reclassifying the strings while the runtime
    // still renders them in a row headed "Initial vitals" leaves the learner in the same place.
    const mod = await load();
    const inspect = mod["inspectStationVitalsHonesty"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const mispresented = report.stations
      .filter((s) => s.valueClass !== "authored_numeric" && s.presentedAsChartedVitals)
      .map((s) => `${s.scenarioId} [${s.valueClass}] still rendered as charted vitals`);
    expect(mispresented, `unauthored content shown as chart data:\n${mispresented.join("\n")}`).toHaveLength(0);
  }, 600_000);

  it.fails("the two stations with real vitals keep them (COUNTERWEIGHT)", async () => {
    // The cheapest way to make everything honest is to mark every station unauthored and delete the
    // numbers. That would remove the only genuine clinical content in the field.
    const mod = await load();
    const inspect = mod["inspectStationVitalsHonesty"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    for (const scenarioId of LEGACY_NUMERIC) {
      const s = report.stations.find((x) => x.scenarioId === scenarioId);
      expect(s, `${scenarioId} was not enumerated`).toBeDefined();
      expect(s!.valueClass, `${scenarioId} lost its numeric vitals`).toBe("authored_numeric");
      expect(s!.rawValue, `${scenarioId} lost its vitals content`).toMatch(/\d/u);
    }
  }, 600_000);
});
