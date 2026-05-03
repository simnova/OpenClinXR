import { describe, expect, it } from "vitest";
import { completeTraceAction, createInitialRuntimeState, formatStationClock, summarizeTraceReadiness } from "./runtime-state.js";

describe("XR runtime state", () => {
  it("formats station time without viewport-dependent sizing", () => {
    expect(formatStationClock(0)).toBe("00:00");
    expect(formatStationClock(65)).toBe("01:05");
    expect(formatStationClock(960)).toBe("16:00");
  });

  it("tracks required trace actions for the ED station", () => {
    let state = createInitialRuntimeState();
    state = completeTraceAction(state, "ecg_request");
    state = completeTraceAction(state, "team_communication");

    expect(state.completedTraceTags).toEqual(["ecg_request", "team_communication"]);
    expect(summarizeTraceReadiness(state).observedCount).toBe(2);
    expect(summarizeTraceReadiness(state).missingCount).toBeGreaterThan(0);
  });
});

