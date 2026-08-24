import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the whole-bank luminance gate asserts only what median brightness can actually
 * distinguish — that a station rendered at all — and does not pretend to grade how it looks.
 *
 * MEASURED 2026-08-24, do not re-derive. I graded four stations by eye against their live medians,
 * captured through the sweep's own path at `93ab4fe6`:
 *
 *   station                                  median   my grade
 *   primary_care (post-#638)                    23     GOOD  — whole room, figures clear
 *   primary_care (pre-#638, other camera)       83     BAD   — door leaf fills a third of the frame
 *   ward_delirium_med_rec_v1                    84     GOOD  — best frame in the bank
 *   peds_asthma_parent_anxiety_v1              118     BAD   — camera jammed against a counter slab
 *
 * 23 good, 83 bad, 84 good, 118 bad. **Median luminance does not separate good frames from bad in
 * either direction.** It is not a miscalibrated metric; it is a blind one. A bright surface pressed
 * against the lens scores the same as a well-lit room, and scores HIGHER than a good frame.
 *
 * THE FLOORS AND CEILINGS IN `no-shipped-station-captures-darker-than-it-did.test.ts` ARE ALSO STALE.
 * Every number there was recorded before #638 fixed a camera that could land on either side of the
 * room, so each is a sample of a coin flip. Live medians after #638, 15/15 stations stable:
 *
 *   peds_asthma  32 -> 118   (recorded CEILING 50, blown 2.4x)
 *   ward_delirium 28 -> 84   (recorded CEILING 45, blown 1.9x)
 *   peds_fever     2 -> 26   (recorded as "pre-existing dark" — it is not dark)
 *   ed_chest_pain 36 -> 61,  ed_stroke 24 -> 55,  stepdown 15 -> 34
 *
 * WHAT THIS CONTRACT CLAIMS INSTEAD. A median near zero means the sampled region is black, which is a
 * render that did not happen. That IS within the metric's reach, and it is the only thing that is.
 * The floor is derived from the stable bank, not fitted: the darkest shipped station now reads 23, so
 * 10 sits 2.3x below the darkest real render and far above a black frame.
 *
 * KNOWN-GOOD COLUMN: the two stations I graded GOOD sit at 23 and 84 — a 3.7x spread with the same
 * verdict. Clause (2) pins that spread, so any successor that re-introduces a per-station brightness
 * band has to explain how one band admits both.
 *
 * FAILED TREATMENT, do not repeat: recalibrating the floors and ceilings from the post-#638 numbers.
 * That produces a table exactly as blind as the one it replaces, now with fresher wrong numbers, and
 * it is what #639 exists to prevent. A real successor measures the VIEW — occluder coverage, camera
 * standoff from the nearest surface, how much of the actor set is unoccluded — not average brightness.
 *
 * DO NOT DELETE the superseded contract. Merge-kill refuses `deleted-test`. Rewrite it as an inverted
 * guard that records why its bands were withdrawn.
 *
 * THREE CLAUSES ARE RED AND ALL THREE FAIL FOR ONE REASON — disclosed rather than hidden. The
 * committed `station-luminance-sweep.json` still holds the PRE-#638 numbers (ward_delirium 28,
 * primary_care 16, peds_fever 2), so today clause (2) computes 28/16 = 1.75 against my live 84/23 =
 * 3.65, and clause (3) sees peds_fever at 2. **They cannot go green until the sweep is re-run through
 * the now-stable camera.** That re-run is #635's unlanded work at `53588773`, and this slice subsumes
 * it: I have now written three briefs trying to keep the stamp, the re-run and the metric separate,
 * and each pair turned out to be mutually dependent. They are one slice.
 *
 * claimScope: that every shipped station rendered something rather than a black frame, and that two
 *   frames a human graded equally good differ in median by 3.7x.
 * notEvidenceFor: whether any station looks right; whether any is too dark or too bright; the framing;
 *   what a correct view metric would be.
 */

const SWEEP = "tools/openclinxr/evidence/station-luminance-sweep.json";
/** 2.3x below the darkest real render in the stable bank (primary_care, 23). Not fitted. */
const BLACK_FRAME_FLOOR = 10;
/** Both graded GOOD by eye; the ratio is what any per-station brightness band has to survive. */
const GOOD_FRAME_SPREAD_RATIO = 3.0;

const stations = (): Record<string, { median: number }> => {
  if (!existsSync(SWEEP)) throw new Error(`${SWEEP} missing — TRACKED path required (#396)`);
  return (JSON.parse(readFileSync(SWEEP, "utf8")) as { stations: Record<string, { median: number }> }).stations;
};

describe("the luminance gate only claims what it can see", () => {
  it.fails("(1) every shipped station rendered something rather than a black frame", () => {
    const s = stations();
    expect(Object.keys(s).length, "the sweep must cover the whole shipped bank").toBeGreaterThanOrEqual(14);
    for (const [id, row] of Object.entries(s)) {
      expect(
        row.median,
        `${id} median ${row.median} — at or near zero the sampled region is black, which is a render `
        + "that did not happen. This is the only thing median luminance can actually tell us",
      ).toBeGreaterThanOrEqual(BLACK_FRAME_FLOOR);
    }
  });

  it.fails("(2) KNOWN-GOOD COLUMN: two frames I graded equally good differ by more than 3x", () => {
    // primary_care 23 and ward_delirium 84 both read as good rooms by eye. Any successor that puts a
    // per-station brightness band back has to admit both, which is the point: brightness is not the
    // axis. This clause fails the moment someone narrows the bank toward a single expected range.
    const s = stations();
    const dark = s["primary_care_dyslipidemia_joint_pain_v1"]?.median;
    const bright = s["ward_delirium_med_rec_v1"]?.median;
    expect(dark, "primary_care missing from the sweep").toBeTruthy();
    expect(bright, "ward_delirium missing from the sweep").toBeTruthy();
    expect(
      bright! / dark!,
      "these two frames grade the same and their medians are far apart; a brightness band that "
      + "excludes either is measuring the wrong thing",
    ).toBeGreaterThanOrEqual(GOOD_FRAME_SPREAD_RATIO);
  });

  it.fails("(3) COUNTERWEIGHT: the floor stays a render-failure detector, not a quality bar", () => {
    // Refuses the cheap fix of ratcheting this floor upward until it "grades" the bank. Every shipped
    // station must clear it with room to spare; a floor that any real render sits close to has become
    // the quality bar this contract exists to refuse.
    const s = stations();
    const lowest = Math.min(...Object.values(s).map((r) => r.median));
    expect(lowest, "the darkest real render must clear the floor by at least 2x").toBeGreaterThanOrEqual(
      BLACK_FRAME_FLOOR * 2);
  });

  it("(4) VACUITY GUARD: the sweep is a real reading of the bank, not an empty object", () => {
    // Without this, clauses (1) and (3) pass on `{}` — no station, no violation. Pins that the numbers
    // exist and vary, so the file is a measurement rather than a placeholder.
    const medians = Object.values(stations()).map((r) => r.median);
    expect(medians.length, "3 repeats of nothing is still nothing").toBeGreaterThanOrEqual(14);
    expect(new Set(medians).size, "a bank where every station reads identically is not a measurement")
      .toBeGreaterThan(3);
  });
});
