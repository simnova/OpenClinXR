import { describe, expect, it } from "vitest";
import {
  assertLearnerSyncLag,
  assertPhaseAgreementAfterSyncStart,
  selectLearnerSyncStartWallMs,
} from "./rr1-run.mjs";

const disagree = { eyebrow: "Doorway", phaseRow: "Encounter" };
const agree = { eyebrow: "Doorway", phaseRow: "Doorway" };

describe("RR1 post-sync-render phase agreement", () => {
  it("ignores the 41 ms joined-before-render disagreement", () => {
    const joinWallMs = 1000;
    const syncStartWallMs = selectLearnerSyncStartWallMs([
      { wallMs: joinWallMs, station: "" },
      { wallMs: joinWallMs + 41, station: "Station 1 of 3" },
    ]);
    expect(assertLearnerSyncLag(syncStartWallMs, joinWallMs)).toEqual({ syncStartWallMs: 1041, syncLagMs: 41 });
    const result = assertPhaseAgreementAfterSyncStart([
      { atMs: joinWallMs, ...disagree },
      { atMs: syncStartWallMs, ...agree },
    ], syncStartWallMs, 1300);

    expect(result.maxDisagreementMs).toBe(0);
    expect(result.log).toEqual([
      { atMs: 1000, ...disagree, preSync: true },
      { atMs: 1041, ...agree, preSync: false },
    ]);
  });

  it("rejects and names a one-millisecond post-render disagreement", () => {
    expect(() => assertPhaseAgreementAfterSyncStart([
      { atMs: 0, ...disagree },
      { atMs: 41, ...agree },
      { atMs: 42, ...disagree },
      { atMs: 43, ...agree },
    ], 41, 300)).toThrow('"durationMs":1,"eyebrow":"Doorway","phaseRow":"Encounter"');
  });

  it("rejects a sync render more than 100 ms after join", () => {
    expect(() => assertLearnerSyncLag(1101, 1000))
      .toThrow("learner sync start 1101 ms exceeds join 1000 ms by 101 ms; limit 100 ms");
  });

  it("rejects a header log with no station-bearing entry", () => {
    expect(() => selectLearnerSyncStartWallMs([{ wallMs: 1041, station: "" }]))
      .toThrow("learner header log has no entry with a non-empty station line");
  });
});
