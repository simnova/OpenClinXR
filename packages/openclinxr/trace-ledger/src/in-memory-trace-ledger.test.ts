import { describe, expect, it } from "vitest";
import { InMemoryTraceLedger } from "./index.js";

describe("in-memory trace ledger", () => {
  it("appends and replays events in sequence order", () => {
    const ledger = new InMemoryTraceLedger();
    ledger.append({ stationRunId: "run_001", sequence: 0, eventType: "station.started", occurredAt: "2026-05-03T00:00:00.000Z", atSecond: 0, source: "system", payload: {} });
    ledger.append({ stationRunId: "run_001", sequence: 1, eventType: "learner.action", occurredAt: "2026-05-03T00:01:00.000Z", atSecond: 60, source: "learner", tag: "ecg_request", payload: {} });

    expect(ledger.replay("run_001").map((event) => event.sequence)).toEqual([0, 1]);
  });

  it("rejects sequence gaps", () => {
    const ledger = new InMemoryTraceLedger();

    expect(() =>
      ledger.append({ stationRunId: "run_001", sequence: 1, eventType: "station.started", occurredAt: "2026-05-03T00:00:00.000Z", atSecond: 0, source: "system", payload: {} }),
    ).toThrow("Expected sequence 0 for run_001, received 1");
  });
});

