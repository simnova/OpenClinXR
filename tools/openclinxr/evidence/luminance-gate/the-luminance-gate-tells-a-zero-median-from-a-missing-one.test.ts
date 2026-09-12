import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the luminance gate reads a recorded median of 0 as a missing station,
 * because 0 is falsy.
 *
 * MEASURED 2026-09-12, do not re-derive. `primary-care-zero-median-2026-09-12.md` names the
 * same station at median 23 with sd 60.3, so a real value and a missing one are
 * distinguishable in the data. The gate's own clause (2) does not distinguish them:
 *
 *   the-luminance-gate-only-claims-what-it-can-see.test.ts:92
 *     expect(dark, "primary_care missing from the sweep").toBeTruthy();
 *
 * JavaScript treats median 0 as missing, and the tracked sweep row for
 * `primary_care_dyslipidemia_joint_pain_v1` IS 0 (`station-luminance-sweep.json`,
 * stamp ec5cbd42). So a sampling zero is indistinguishable from an absent row — the same
 * instrument class the note names: median-only, truthy check, no sd.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED (#N)` block. Do not
 * rewrite the measured table.
 *
 * claimScope: that the gate distinguishes a recorded median of 0 from no recorded median.
 * notEvidenceFor: floors, ceilings or bands; how any frame looks; the sweep's storage shape;
 *   whether any other gate makes the same truthiness mistake.
 */

const SWEEP = "tools/openclinxr/evidence/station-luminance-sweep.json";
const GATE = "tools/openclinxr/evidence/the-luminance-gate-only-claims-what-it-can-see.test.ts";
const NOTE = "tools/openclinxr/evidence/primary-care-zero-median-2026-09-12.md";
const STATION = "primary_care_dyslipidemia_joint_pain_v1";

/** Mirrors the gate's clause (2) read: optional chain off the sweep table. */
const readDark = (stations: Record<string, { median: number }>): number | undefined =>
  stations[STATION]?.median;

const sweepStations = (): Record<string, { median: number }> => {
  if (!existsSync(SWEEP)) throw new Error(`${SWEEP} missing — TRACKED path required (#396)`);
  return (JSON.parse(readFileSync(SWEEP, "utf8")) as { stations: Record<string, { median: number }> })
    .stations;
};

describe("the luminance gate tells a zero median from a missing one", () => {
  it("(0) VACUITY GUARD: the instrument fixtures really are a 0 and an absence", () => {
    const s = sweepStations();
    expect(
      STATION in s,
      `${STATION} is absent from ${SWEEP} — the 0-vs-absent distinction needs a recorded 0`,
    ).toBe(true);
    expect(s[STATION]?.median, "the tracked sweep row is no longer 0 — the premise moved").toBe(0);
    expect(
      readDark({}),
      "the absent-row fixture does not read as absent — the probe is miswired",
    ).toBeUndefined();
  });

  it.fails("(1) RED: a recorded median of 0 is present, not missing", () => {
    // The gate's clause (2) shape: toBeTruthy on the optional-chained median. Median 0 is
    // falsy, so this fails exactly the way the gate fails — a sampling zero reads as absent.
    const dark = readDark(sweepStations());
    expect(dark, `${STATION} missing from the sweep`).toBeTruthy();
  });

  it("(2) KNOWN-GOOD COLUMN: the note measures the same station at median 23 with sd 60.3", () => {
    // A real value and a missing one are distinguishable in the data — the fix is a presence
    // check (key present / typeof number / !== undefined), never a truthiness check.
    expect(existsSync(NOTE), `${NOTE} is the known-good reference for this station`).toBe(true);
    const note = readFileSync(NOTE, "utf8");
    expect(note, "the note no longer pins the real median 23").toContain("**23**");
    expect(note, "the note no longer pins sd 60.3").toContain("60.3");
    const darkAbsent = readDark({});
    expect(
      darkAbsent === undefined,
      "an absent row must still read as absent under the replacement check",
    ).toBe(true);
    const darkZero = readDark({ [STATION]: { median: 0 } });
    expect(
      darkZero !== undefined && typeof darkZero === "number",
      "a recorded 0 must read as present under the replacement check",
    ).toBe(true);
  });

  it("(3) COUNTERWEIGHT: the fix lives in the gate, not in this file", () => {
    // Refuses the cheap fix of redefining the RED away: this file must keep asserting the
    // gate's truthy shape until the gate itself changes. Pins the exact line so a silent
    // rewording of the gate does not retire the marker.
    expect(existsSync(GATE), `${GATE} moved — the marker points at nothing`).toBe(true);
    const gate = readFileSync(GATE, "utf8");
    expect(
      gate.includes('expect(dark, "primary_care missing from the sweep").toBeTruthy();'),
      "the gate no longer carries the truthy clause this RED pins — flip (1), do not delete this file",
    ).toBe(true);
  });
});
