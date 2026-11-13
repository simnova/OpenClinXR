import { describe, expect, it } from "vitest";
import { stationPhaseOrder } from "./index.js";

// run-14: the station-0 encounter wait first polled a state that had already
// rotated on (station 1 doorway at mark-ch1 end, station 2 closed at timeout).

describe("stationPhaseOrder (runner wait on a passed phase fails fast)", () => {
  it("marks the run-14 snapshot (0,encounter) vs (1,doorway) as passed", () => {
    expect(stationPhaseOrder({ stationIndex: 1, phase: "doorway" }, { stationIndex: 0, phase: "encounter" })).toBe("passed");
  });

  it("marks the run-14 snapshot (0,encounter) vs (2,closed) as passed", () => {
    expect(stationPhaseOrder({ stationIndex: 2, phase: "closed" }, { stationIndex: 0, phase: "encounter" })).toBe("passed");
  });

  it("waits when the target is ahead", () => {
    expect(stationPhaseOrder({ stationIndex: 0, phase: "note" }, { stationIndex: 1, phase: "doorway" })).toBe("wait");
  });

  it("matches the exact state", () => {
    expect(stationPhaseOrder({ stationIndex: 0, phase: "encounter" }, { stationIndex: 0, phase: "encounter" })).toBe("match");
  });

  it("waits on the same-station earlier phase and passes on a later one", () => {
    expect(stationPhaseOrder({ stationIndex: 0, phase: "doorway" }, { stationIndex: 0, phase: "encounter" })).toBe("wait");
    expect(stationPhaseOrder({ stationIndex: 0, phase: "encounter" }, { stationIndex: 0, phase: "doorway" })).toBe("passed");
  });

  it("orders closed before break", () => {
    expect(stationPhaseOrder({ stationIndex: 0, phase: "break" }, { stationIndex: 0, phase: "closed" })).toBe("passed");
    expect(stationPhaseOrder({ stationIndex: 0, phase: "closed" }, { stationIndex: 0, phase: "break" })).toBe("wait");
  });

  it("waits on an unknown observed phase even at a higher station", () => {
    expect(stationPhaseOrder({ stationIndex: 1, phase: "unknown" }, { stationIndex: 0, phase: "encounter" })).toBe("wait");
  });

  it("waits on an unknown target phase even at a higher observed station", () => {
    expect(stationPhaseOrder({ stationIndex: 1, phase: "doorway" }, { stationIndex: 0, phase: "unknown" })).toBe("wait");
  });
});
