import { describe, expect, it } from "vitest";
import {
  assertLearnerSyncLag,
  assertPhaseAgreementAfterSyncStart,
  rr1DoorwayStartPlan,
  selectLearnerSyncStartWallMs,
} from "./rr1-run.mjs";

const disagree = { eyebrow: "Doorway", phaseRow: "Encounter" };
const agree = { eyebrow: "Doorway", phaseRow: "Doorway" };

describe("RR1 post-sync-render phase agreement", () => {
  it("refuses the run-11 ch1 panel ending 94 ms after the doorway window", () => {
    expect(rr1DoorwayStartPlan({
      learnerLatchWallMs: 1794552965302,
      evidenceLatchWallMs: 1794552965768,
      ch2MarkWallMs: 1794552966597,
      frameCaptureEndedWallMs: 1794552965754,
      panelCaptureEndedWallMs: 1794552966691,
    })).toMatchObject({
      ch1WindowMargin: { frameMs: 843, panelMs: -94 },
      accepted: false,
    });
  });

  it("accepts 400/300 ms ch1 margins", () => {
    expect(rr1DoorwayStartPlan({
      learnerLatchWallMs: 1000,
      evidenceLatchWallMs: 1100,
      ch2MarkWallMs: 2000,
      frameCaptureEndedWallMs: 1600,
      panelCaptureEndedWallMs: 1700,
    })).toMatchObject({ ch1WindowMargin: { frameMs: 400, panelMs: 300 }, accepted: true });
  });

  it("accepts the exact 250 ms ch1 margin boundary", () => {
    expect(rr1DoorwayStartPlan({
      learnerLatchWallMs: 1000,
      evidenceLatchWallMs: 1100,
      ch2MarkWallMs: 2000,
      frameCaptureEndedWallMs: 1750,
      panelCaptureEndedWallMs: 1750,
    })).toMatchObject({ ch1WindowMargin: { frameMs: 250, panelMs: 250 }, accepted: true });
  });

  it("refuses a 249 ms ch1 margin", () => {
    expect(rr1DoorwayStartPlan({
      learnerLatchWallMs: 1000,
      evidenceLatchWallMs: 1100,
      ch2MarkWallMs: 2000,
      frameCaptureEndedWallMs: 1751,
      panelCaptureEndedWallMs: 1750,
    })).toMatchObject({ ch1WindowMargin: { frameMs: 249, panelMs: 250 }, accepted: false });
  });

  it("refuses to plan the station start without both finite latch stamps", () => {
    for (const [learnerLatchWallMs, evidenceLatchWallMs] of [[undefined, 1100], [1000, undefined], [Number.NaN, 1100], [1000, Number.POSITIVE_INFINITY]]) {
      expect(() => rr1DoorwayStartPlan({ learnerLatchWallMs, evidenceLatchWallMs }))
        .toThrow("RR1 station start requires finite learner and evidence interior latch wall clocks");
    }
  });

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
