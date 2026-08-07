import { describe, expect, it } from "vitest";

/**
 * PLANTED CONTRACTS (#171). The articulating head of bed works and NOTHING REACHES IT.
 *
 * `station-stretcher.ts:201` does `setStretcherInclineDegrees(stretcher, input.inclineDegrees ?? 0)`.
 * `station-environment.ts:216` constructs every stretcher as
 * `buildPatientStretcher({ slotId, purpose, position, trimColor })` — no incline, ever. #159 measured
 * the deck hitting four requested angles exactly with the torso tracking within 2.7°, and every
 * patient in the running app still lies flat.
 *
 * This is the sixth slice in this project to land correct and inert. The fix is the wiring.
 *
 * TWO REDs FLIP. The third is a COUNTERWEIGHT and is `it.fails` only because the module is absent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE ANGLE IS 30° AND THE CONTRACT ASSERTS THE BAND, NOT THE NUMBER
 *
 * Graded by me from `.openclinxr/evidence/issue-159/articulating-hob-contact-sheet.png`: 15° is not
 * visibly different from flat, 30° reads as head-of-bed up, 45° reads as sitting up. A consulted
 * clinical opinion — a working proxy, NOT a clinician sign-off — put semi-Fowler at 30–45°, high
 * confidence on *not flat*, MEDIUM between 30 and 45.
 *
 * So the assertion is **non-zero and within 30–45**, never `=== 30`. A number in a contract becomes a
 * design target for the thing being measured, and 30 is a graded judgement inside a consulted band
 * rather than a measurement. The band is what is defensible.
 *
 * `claimScope` stays **staging**. This is not a clinical positioning claim.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * READ THE INCLINE THROUGH THE RUNTIME'S OWN SSOT
 *
 * `readStretcherInclineDegrees(stretcher)` reads `userData.openClinXrStretcherInclineDegrees`, which
 * `setStretcherInclineDegrees` writes and which `supine-pose.ts` consumes. **Read that.** Reading back
 * the descriptor field you just edited proves the field exists, not that the deck moved — and #6v
 * records what it costs to measure with the wrong instrument for the layer in question.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ENUMERATE THE OTHER STATIONS, DO NOT LIST THEM
 *
 * The counterweight covers "every station that is not ED chest pain". Whenever a check names its
 * subjects explicitly, that list is the thing that will be wrong later — #102 generalised only
 * because its contract enumerated from what ships. 15 scenarios, 14 environments, and exactly one
 * environment is shared (`ed_exam_bay_v1` serves `ed_chest_pain_priority_v1` and `_v2`, both chest
 * pain, both wanting the same angle). Whether `_v2` inherits 30 is YOUR decision — the counterweight
 * must be written so that either answer can satisfy it, and must say which happened.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE ADJACENT CONDITION — MEASURE IT, THE CAUSE IS NOT KNOWN TO ME
 *
 * In the shipped ED capture the patient IS supine on the stretcher, and **the head appears to hang
 * past the head end of the deck, beyond the pillow, with the neck bent over the edge.**
 *
 * THAT IS A PIXEL OBSERVATION. I have NOT measured it and the mechanism is NOT known to me. Head
 * placement, pillow placement, body length versus deck length, or my misreading of a foreshortened
 * view are all possible; **they may all be wrong** and I have not distinguished between them. Do not
 * open by trying to prove one of them.
 *
 * It belongs in this contract because **inclining pivots exactly the region where the head already
 * sits.** If the head is over the edge at flat, raising the head end swings it into the air. So
 * contract (3) requires the head-to-deck relationship to be RECORDED at flat and at the shipped
 * angle. Assert only what you can defend from the numbers — the record is the point, and a threshold
 * I invented here would be exactly the design target the band above exists to avoid.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE BUILD TRAP — this bit main once and will again
 *
 * `packages/openclinxr/asset-registry` is BUILD-EMITTING and its `dist/` is gitignored. `integrate`
 * never rebuilds it, so an `environment-descriptors.ts` change that is green in your tree can leave
 * main red with a missing-export `SyntaxError` (#152). Run
 * `pnpm --filter @openclinxr/asset-registry build` after editing it and re-run the consumers against
 * the rebuilt output.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * DECISIONS THAT ARE YOURS. Name each in the commit message with what you rejected.
 *  - **Where `inclineDegrees` lives** — the fixture slot (which already carries position) or the
 *    descriptor root (a room-level property). Both are arguable.
 *  - **What `ed_chest_pain_priority_v2` gets.** It shares the environment. Inheriting is the obvious
 *    answer and I am not mandating it.
 *  - **Whether the pillow moves with the deck.** #159's worker and I both recorded
 *    `pillow_position: not_visible`, so this is genuinely unknown rather than fine.
 *
 * CALIBRATION — `.openclinxr/evidence/issue-171/pre-fix.json` BEFORE any product edit: every shipped
 * station's stretcher incline as the runtime reports it (expected: 0 everywhere, which is the defect),
 * plus the ED head-to-deck geometry at flat. That is the known-good column the after-state is read
 * against, and a later change to any measure or tolerance must cite which rows flipped.
 *
 * SIGNATURE IS YOURS. These read `inspectShippedHeadOfBedIncline()`. What must not change: the incline
 * is read through `readStretcherInclineDegrees` off the live scene graph, and stations are enumerated
 * from what ships.
 *
 * REQUIRED, the observable half: re-capture the ED chest-pain room, and after the first success re-run
 * it TWICE MORE with `FORCE_COLOR=1`, both regenerating the artifacts. One green under ambient harness
 * conditions is one sample, not reproducibility (#69 lost a session to exactly this).
 *
 * IN-SCOPE VISUAL — answer EVERY line. Do not replace with a sentence:
 *     deck_inclined:        yes | no | not_visible
 *     reads_as_head_up:     yes | flat | sitting_up
 *     head_on_deck:         on_pillow | on_deck | past_the_end | not_visible
 *     body_tracks_deck:     yes | no | not_visible
 *     other_stations_flat:  yes | no | not_checked
 *
 * IF SATISFYING A CONTRACT HERE WILL MAKE THE PRODUCT VISIBLY WORSE, SAY SO — AND THEN SATISFY IT
 * ANYWAY. Naming it is not disobedience and will not be read as refusing the work.
 *
 * IF ANY PROOF CANNOT PASS AS WRITTEN, OR PASSES TRIVIALLY AGAINST THE OBSERVED RANGE, OR ASSERTS THE
 * OPPOSITE DIRECTION FROM THE DEFECT, SAY SO IN YOUR REPORT.
 *
 * SCOPE: the shipped ED chest-pain stretcher carries a staging incline and the mechanism is reachable
 * from a descriptor. Says NOTHING about clinical positioning correctness, about other stations, or
 * about the ward bed those stations are actually blocked behind.
 */

const load = async () =>
  import("./shipped-head-of-bed-incline.js") as Promise<Record<string, unknown>>;

type StationIncline = {
  scenarioId: string;
  environmentId: string;
  /** As the runtime reports it, via readStretcherInclineDegrees off the live scene graph. */
  inclineDegrees: number;
  hasStretcher: boolean;
};

type HeadDeckGeometry = {
  /** Which pass this row is: the flat baseline or the shipped angle. */
  label: string;
  inclineDegrees: number;
  headCenterY: number;
  headCenterZ: number;
  deckTopY: number;
  deckHeadEndZ: number;
  /** Signed: positive when the head is inboard of the head end, negative when past it. */
  headInboardOfDeckEndMeters: number;
  pillowTopY: number | null;
};

type Report = {
  stations: StationIncline[];
  inclinedScenarioIds: string[];
  headDeck: HeadDeckGeometry[];
  claimScope: string;
  notEvidenceFor: string[];
};

type Inspect = () => Promise<Report>;

const ED_CHEST_PAIN = "ed_chest_pain_priority_v1";
/** The consulted semi-Fowler band. NOT a clinician sign-off — staging only. */
const BAND_MIN = 30;
const BAND_MAX = 45;

describe("the shipped ED stretcher actually carries a staging incline (#171)", () => {
  it.fails("the ED chest-pain deck is inclined in the running app", async () => {
    // The mechanism has worked since #159 and no caller has ever passed it a non-zero value. This is
    // the wiring, read back through the runtime's own SSOT rather than through the descriptor field.
    const mod = await load();
    const inspect = mod["inspectShippedHeadOfBedIncline"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    const ed = report.stations.find((s) => s.scenarioId === ED_CHEST_PAIN);
    expect(ed, `${ED_CHEST_PAIN} was not measured at all`).toBeTruthy();
    expect(ed!.hasStretcher, "the ED chest-pain station has no stretcher to incline").toBe(true);
    expect(
      ed!.inclineDegrees,
      `ED chest pain still reads ${ed!.inclineDegrees}° — the deck is flat in the running app`,
    ).toBeGreaterThanOrEqual(BAND_MIN);
    expect(
      ed!.inclineDegrees,
      `${ed!.inclineDegrees}° is above the consulted semi-Fowler band and reads as sitting up`,
    ).toBeLessThanOrEqual(BAND_MAX);

    expect(report.claimScope.toLowerCase()).toContain("staging");
  }, 900_000);

  it.fails("head-to-deck geometry is recorded at flat AND at the shipped angle", async () => {
    // Inclining pivots exactly the region where the head sits, and the head may already be past the
    // deck end at flat. The cause of that is NOT known — this contract requires the measurement to
    // exist on both sides of the change so the next person argues from numbers instead of pixels.
    const mod = await load();
    const inspect = mod["inspectShippedHeadOfBedIncline"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.headDeck.length, "head-to-deck geometry was measured on fewer than two passes")
      .toBeGreaterThanOrEqual(2);

    const flat = report.headDeck.find((r) => Math.abs(r.inclineDegrees) < 1e-6);
    const raised = report.headDeck.find((r) => r.inclineDegrees >= BAND_MIN);
    expect(flat, "no flat baseline pass was recorded").toBeTruthy();
    expect(raised, "no raised pass was recorded").toBeTruthy();

    for (const row of [flat!, raised!]) {
      expect(Number.isFinite(row.headCenterY), `${row.label}: headCenterY not measured`).toBe(true);
      expect(Number.isFinite(row.deckHeadEndZ), `${row.label}: deckHeadEndZ not measured`).toBe(true);
      expect(
        Number.isFinite(row.headInboardOfDeckEndMeters),
        `${row.label}: head-vs-deck-end not measured — this is the number the whole row exists for`,
      ).toBe(true);
    }

    // The head must not go BACKWARD relative to the deck end when the deck is raised. This is the one
    // directional claim I will make: whatever the flat state turns out to be, inclining must not make
    // the head hang further past the end than it already does.
    expect(
      raised!.headInboardOfDeckEndMeters,
      `raising the deck moved the head further past its head end `
      + `(${flat!.headInboardOfDeckEndMeters.toFixed(3)} -> ${raised!.headInboardOfDeckEndMeters.toFixed(3)})`,
    ).toBeGreaterThanOrEqual(flat!.headInboardOfDeckEndMeters - 0.01);
  }, 900_000);

  it.fails("every other station is still flat (COUNTERWEIGHT)", async () => {
    // The cheap way to satisfy contract (1) is to raise the DEFAULT, which would tip fourteen decks
    // nobody graded. Stations are enumerated from what ships, never listed — whenever a check names
    // its subjects, that list is what goes stale.
    const mod = await load();
    const inspect = mod["inspectShippedHeadOfBedIncline"] as Inspect | undefined;
    expect(inspect).toBeTypeOf("function");

    const report = await inspect!();
    expect(report.stations.length, "fewer than the shipped station count was enumerated")
      .toBeGreaterThanOrEqual(14);

    // ed_exam_bay_v1 is shared by _v1 and _v2, so _v2 inheriting the angle is a legitimate outcome.
    // Anything NOT declared inclined must read exactly 0.
    const declared = new Set(report.inclinedScenarioIds);
    expect(declared.has(ED_CHEST_PAIN), "the ED chest-pain station is not in the declared list")
      .toBe(true);
    expect(
      declared.size,
      `${declared.size} stations declared inclined — this slice ships the ED bay (and at most its `
      + `shared _v2 twin), not a bank-wide posture change`,
    ).toBeLessThanOrEqual(2);

    for (const station of report.stations) {
      if (declared.has(station.scenarioId)) continue;
      expect(
        station.inclineDegrees,
        `${station.scenarioId} reads ${station.inclineDegrees}° but was never declared inclined — `
        + `the default was raised instead of the ED bay being wired`,
      ).toBe(0);
    }

    expect(report.notEvidenceFor.join(" ").toLowerCase()).toContain("clinical");
  }, 900_000);
});
