import { describe, expect, it } from "vitest";
import {
  learnerHeaderWindow,
  rr1DoorwayClockBoundFromServer,
  rr1DoorwayClockBoundMs,
  rr1DoorwayClockStarted,
  rr1HeaderShowsPhase,
  rr1PhaseEntryIndex,
  waitForRr1Phase,
} from "./rr1-run.mjs";

// CONSTRUCTED fixture (not a recording): run-14 stored no header log, so
// this entry is built from the producing code (learnerHeaderObserverInit
// appends only on TEXT CHANGE): since XS-READY the header reads
// "Doorway"/"Station 1 of 3" from join, before the server doorway clock
// starts. Offsets below are the run-14 RR1_AWAIT station0:copy-initial-header
// end (+5621 ms) and station0:wait-doorway end (+5669 ms) over base T0.
const T0 = 1_000_000;
const run14CopyInitialHeaderEnd = T0 + 5621;
const run14WaitDoorwayEnd = T0 + 5669;

describe("RR1 ch1 header phase predicate (run-14 15.5 s mark fix)", () => {
  it("accepts the pre-server header that already shows the phase (run-14 RED)", () => {
    const log = [{ eyebrow: "Doorway", station: "Station 1 of 3", wallMs: run14CopyInitialHeaderEnd }];
    expect(rr1HeaderShowsPhase(log, { phaseName: "doorway", station: "Station 1 of 3", phaseServerMs: run14WaitDoorwayEnd })).toBe(true);
  });

  it("rejects a stale station when the target station differs", () => {
    const log = [{ eyebrow: "Doorway", station: "Station 1 of 3", wallMs: run14CopyInitialHeaderEnd }];
    expect(rr1HeaderShowsPhase(log, { phaseName: "doorway", station: "Station 2 of 3", phaseServerMs: run14WaitDoorwayEnd })).toBe(false);
  });

  it("rejects a matching entry superseded before the server clock", () => {
    const log = [
      { eyebrow: "Doorway", station: "Station 1 of 3", wallMs: T0 + 1000 },
      { eyebrow: "Encounter", station: "Station 1 of 3", wallMs: T0 + 3000 },
    ];
    expect(rr1HeaderShowsPhase(log, { phaseName: "doorway", station: "Station 1 of 3", phaseServerMs: T0 + 5000 })).toBe(false);
  });

  it("rejects an empty log", () => {
    expect(rr1HeaderShowsPhase([], { phaseName: "doorway", station: "Station 1 of 3", phaseServerMs: run14WaitDoorwayEnd })).toBe(false);
  });

  it("keeps the known-good post-server match", () => {
    const log = [
      { eyebrow: "Encounter", station: "Station 1 of 3", wallMs: T0 + 1000 },
      { eyebrow: "Doorway", station: "Station 1 of 3", wallMs: T0 + 6000 },
    ];
    expect(rr1HeaderShowsPhase(log, { phaseName: "doorway", station: "Station 1 of 3", phaseServerMs: T0 + 5000 })).toBe(true);
  });
});

describe("RR1 phase wait wiring (stub order function)", () => {
  it("rejects the passed path in < 200 ms with the named error", async () => {
    const order = () => "passed";
    const read = () => ({ stationIndex: 1, phase: "doorway" });
    const startedAtMs = Date.now();
    await expect(waitForRr1Phase(read, { stationIndex: 0, phase: "encounter" }, order, 60000, "station 0 encounter"))
      .rejects.toThrow("phase passed: waiting for station 0 encounter, observed station 1 doorway");
    expect(Date.now() - startedAtMs).toBeLessThan(200);
  });

  it("resolves when the stub waits then matches", async () => {
    const statuses = ["wait", "match"];
    const order = () => statuses.shift() ?? "match";
    const read = () => ({ stationIndex: 0, phase: "encounter" });
    await expect(waitForRr1Phase(read, { stationIndex: 0, phase: "encounter" }, order, 60000, "station 0 encounter"))
      .resolves.toEqual({ stationIndex: 0, phase: "encounter" });
  });
});

// Real run-14 logs, inlined as literals (tests must not read the store):
// store/site-reimagine/rr1/run-14/diag/ch1-header-replay.json — both pages'
// header logs with the server doorway clock at 1794576217273. Both pages
// already showed Doorway/Station 1 of 3 from join (~2563 ms before the server
// clock started) because learnerHeaderObserverInit appends only on TEXT CHANGE
// and the header rendered at XS-READY join.
const run14DoorwayServerMs = 1794576217273;
const run14LearnerLog = [
  { eyebrow: "Doorway", station: "", wallMs: 1794576214478 },
  { eyebrow: "Doorway", station: "Station 1 of 3", wallMs: 1794576214710 },
];
const run14EvidenceLog = [
  { eyebrow: "Doorway", station: "", wallMs: 1794576214478 },
  { eyebrow: "Doorway", station: "Station 1 of 3", wallMs: 1794576214707 },
];

describe("RR1 ch1 window on the run-14 real logs (round-3 PRIMARY RED)", () => {
  it("starts the doorway window at the server clock on the learner log", () => {
    expect(learnerHeaderWindow(run14LearnerLog, "doorway", "Station 1 of 3", run14DoorwayServerMs).startWallMs).toBe(run14DoorwayServerMs);
  });

  it("starts the doorway window at the server clock on the evidence log", () => {
    expect(learnerHeaderWindow(run14EvidenceLog, "doorway", "Station 1 of 3", run14DoorwayServerMs).startWallMs).toBe(run14DoorwayServerMs);
  });

  it("agrees between predicate and window on both real logs", () => {
    for (const log of [run14LearnerLog, run14EvidenceLog]) {
      expect(rr1HeaderShowsPhase(log, { phaseName: "doorway", station: "Station 1 of 3", phaseServerMs: run14DoorwayServerMs })).toBe(true);
      expect(learnerHeaderWindow(log, "doorway", "Station 1 of 3", run14DoorwayServerMs).startWallMs).toBe(run14DoorwayServerMs);
    }
  });

  it("throws through the window fn on the wrong station", () => {
    expect(() => learnerHeaderWindow(run14LearnerLog, "doorway", "Station 2 of 3", run14DoorwayServerMs)).toThrow("no transition matching");
  });

  it("throws through the window fn when the match is superseded before the clock", () => {
    const log = [
      { eyebrow: "Doorway", station: "Station 1 of 3", wallMs: T0 + 1000 },
      { eyebrow: "Encounter", station: "Station 1 of 3", wallMs: T0 + 3000 },
    ];
    expect(() => learnerHeaderWindow(log, "doorway", "Station 1 of 3", T0 + 5000)).toThrow("no transition matching");
  });

  it("throws through the window fn on an empty log", () => {
    expect(() => learnerHeaderWindow([], "doorway", "Station 1 of 3", run14DoorwayServerMs)).toThrow("no transition matching");
  });

  it("keeps the entry wallMs for a post-clock match", () => {
    const log = [
      { eyebrow: "Encounter", station: "Station 1 of 3", wallMs: T0 + 1000 },
      { eyebrow: "Doorway", station: "Station 1 of 3", wallMs: T0 + 6000 },
    ];
    expect(learnerHeaderWindow(log, "doorway", "Station 1 of 3", T0 + 5000).startWallMs).toBe(T0 + 6000);
  });
});

describe("RR1 doorway clock-start gate (round-4)", () => {
  const doorwayTarget = { stationIndex: 1, phase: "doorway" };
  const matchExact = (observed, target) =>
    observed.stationIndex === target.stationIndex && observed.phase === target.phase ? "match" : "wait";

  it("RED: run-14 sequence resolves only once the doorway key exists", async () => {
    // Run-14: state preset (1,doorway); the doorway key appeared 62 ms later.
    // Bound from the production computation (test-chosen 30 s, not production's).
    const startedAtMs = Date.now();
    const getStats = () => (Date.now() - startedAtMs >= 62
      ? { phaseChangedAtMs: { doorway: startedAtMs + 62 } }
      : { phaseChangedAtMs: {} });
    const read = () => ({ stationIndex: 1, phase: "doorway" });
    const resolved = await waitForRr1Phase(read, doorwayTarget, matchExact, 60000, "station 1 doorway", {
      getStats,
      boundMs: rr1DoorwayClockBoundMs(30),
    });
    expect(resolved).toEqual({ stationIndex: 1, phase: "doorway" });
    expect(Date.now() - startedAtMs).toBeGreaterThanOrEqual(62);
  });

  it("computes the production bound as ready seconds plus one poll, without a copied literal", () => {
    // runCapture: rr1DoorwayClockBoundMs(serverReadyTimeoutSeconds) with the
    // constant from SERVER_DIST. Symbolic inputs pin the formula, not the value.
    expect(rr1DoorwayClockBoundMs(0)).toBe(25);
    expect(rr1DoorwayClockBoundMs(2)).toBe(2025);
  });

  it("rejects with the named error after the injected bound when the key never appears", async () => {
    const read = () => ({ stationIndex: 1, phase: "doorway" });
    const startedAtMs = Date.now();
    await expect(waitForRr1Phase(read, doorwayTarget, matchExact, 60000, "station 1 doorway", {
      getStats: () => ({ phaseChangedAtMs: {} }),
      boundMs: 50,
    })).rejects.toThrow("doorway clock not started: waiting for station 1 doorway, station 1");
    const elapsedMs = Date.now() - startedAtMs;
    expect(elapsedMs).toBeGreaterThanOrEqual(50);
    expect(elapsedMs).toBeLessThan(5000);
  });

  it("resolves a non-doorway target on match without reading stats", async () => {
    const getStats = () => { throw new Error("stats must not be read for non-doorway targets"); };
    const read = () => ({ stationIndex: 1, phase: "encounter" });
    await expect(waitForRr1Phase(read, { stationIndex: 1, phase: "encounter" }, matchExact, 60000, "station 1 encounter", {
      getStats,
      boundMs: 50,
    })).resolves.toEqual({ stationIndex: 1, phase: "encounter" });
  });

  it("resolves a doorway target on the first poll when the key is already present", async () => {
    let statsCalls = 0;
    const getStats = () => {
      statsCalls += 1;
      return { phaseChangedAtMs: { doorway: 1794576217273 } };
    };
    const read = () => ({ stationIndex: 0, phase: "doorway" });
    const startedAtMs = Date.now();
    await expect(waitForRr1Phase(read, { stationIndex: 0, phase: "doorway" }, matchExact, 60000, "station 0 doorway", {
      getStats,
      boundMs: 5000,
    })).resolves.toEqual({ stationIndex: 0, phase: "doorway" });
    expect(statsCalls).toBe(1);
    expect(Date.now() - startedAtMs).toBeLessThan(200);
  });

  it("still fails fast with phase-passed for a doorway target that is passed", async () => {
    const read = () => ({ stationIndex: 2, phase: "closed" });
    await expect(waitForRr1Phase(read, doorwayTarget, () => "passed", 60000, "station 1 doorway", {
      getStats: () => ({}),
      boundMs: 50,
    })).rejects.toThrow("phase passed: waiting for station 1 doorway, observed station 2 closed");
  });

  it("rr1DoorwayClockStarted is true when the room map carries the doorway key", () => {
    expect(rr1DoorwayClockStarted({ phaseChangedAtMs: { doorway: 1794576233400 } }, 1)).toBe(true);
  });

  it("rr1DoorwayClockStarted is false without a numeric doorway key", () => {
    expect(rr1DoorwayClockStarted({ phaseChangedAtMs: {} }, 1)).toBe(false);
    expect(rr1DoorwayClockStarted({ phaseChangedAtMs: { encounter: 1794576237423 } }, 1)).toBe(false);
    expect(rr1DoorwayClockStarted({ phaseChangedAtMs: { doorway: "soon" } }, 1)).toBe(false);
    expect(rr1DoorwayClockStarted(null, 1)).toBe(false);
  });

  it("rr1DoorwayClockStarted ignores prev-station-closed for the doorway check", () => {
    expect(rr1DoorwayClockStarted({ phaseChangedAtMs: { "prev-station-closed": 1794576233331 } }, 1)).toBe(false);
    expect(rr1DoorwayClockStarted({ phaseChangedAtMs: { "prev-station-closed": 1794576233331, doorway: 1794576233400 } }, 1)).toBe(true);
  });
});

describe("RR1 phase entry ties and wallMs order (round-5 RED)", () => {
  const doorwayMatches = (entry) => entry.eyebrow.toLowerCase() === "doorway" && entry.station.toLowerCase() === "station 1 of 3";
  const S = T0 + 5000;

  it("returns null when a same-wallMs non-match supersedes the match", () => {
    const log = [
      { eyebrow: "Doorway", station: "Station 1 of 3", wallMs: S },
      { eyebrow: "Encounter", station: "Station 1 of 3", wallMs: S },
    ];
    expect(rr1PhaseEntryIndex(log, doorwayMatches, S)).toBeNull();
    expect(rr1HeaderShowsPhase(log, { phaseName: "doorway", station: "Station 1 of 3", phaseServerMs: S })).toBe(false);
  });

  it("returns null when wallMs order disagrees with array order (stale match)", () => {
    const log = [
      { eyebrow: "Encounter", station: "Station 1 of 3", wallMs: T0 + 90 },
      { eyebrow: "Doorway", station: "Station 1 of 3", wallMs: T0 + 80 },
    ];
    expect(rr1PhaseEntryIndex(log, doorwayMatches, T0 + 100)).toBeNull();
  });

  it("starts at the least wallMs when array order disagrees (early match)", () => {
    const log = [
      { eyebrow: "Doorway", station: "Station 1 of 3", wallMs: T0 + 120 },
      { eyebrow: "Doorway", station: "Station 1 of 3", wallMs: T0 + 110 },
    ];
    expect(rr1PhaseEntryIndex(log, doorwayMatches, T0 + 100)).toEqual({ index: 1, startWallMs: T0 + 110 });
  });

  it("shows from S when a same-wallMs match supersedes the non-match", () => {
    const log = [
      { eyebrow: "Encounter", station: "Station 1 of 3", wallMs: S },
      { eyebrow: "Doorway", station: "Station 1 of 3", wallMs: S },
    ];
    expect(rr1PhaseEntryIndex(log, doorwayMatches, S)).toEqual({ index: 1, startWallMs: S });
    expect(rr1HeaderShowsPhase(log, { phaseName: "doorway", station: "Station 1 of 3", phaseServerMs: S })).toBe(true);
  });
});

describe("RR1 doorway bound from the server module (round-5 F3)", () => {
  it("derives 7025 from the stub server constant 7", () => {
    expect(rr1DoorwayClockBoundFromServer({ DEFAULT_READY_TIMEOUT_SECONDS: 7 })).toBe(7025);
  });

  it("scales a sentinel server constant without a copied literal", () => {
    expect(rr1DoorwayClockBoundFromServer({ DEFAULT_READY_TIMEOUT_SECONDS: 13 })).toBe(13025);
  });

  it("throws when the server module lacks a finite ready timeout", () => {
    expect(() => rr1DoorwayClockBoundFromServer({})).toThrow("finite DEFAULT_READY_TIMEOUT_SECONDS");
    expect(() => rr1DoorwayClockBoundFromServer({ DEFAULT_READY_TIMEOUT_SECONDS: Number.NaN })).toThrow("finite DEFAULT_READY_TIMEOUT_SECONDS");
    expect(() => rr1DoorwayClockBoundFromServer(null)).toThrow("finite DEFAULT_READY_TIMEOUT_SECONDS");
  });
});

// Second real-log file: store/site-reimagine/rr1/run-15/diag/ch1-header-replay.json
// (learnerHeaderLog and evidenceHeaderLog, ch1 phase/station/phaseServerMs).
// Baseline recorded on round-4 code (see RESULT ROUND4_BASELINE): entry
// {index:1,startWallMs:phaseServerMs}, window {start:phaseServerMs,end:null}.
const run15DoorwayServerMs = 1794578660508;
const run15LearnerLog = [
  { eyebrow: "Doorway", station: "", wallMs: 1794578657775 },
  { eyebrow: "Doorway", station: "Station 1 of 3", wallMs: 1794578657989 },
];
const run15EvidenceLog = [
  { eyebrow: "Doorway", station: "", wallMs: 1794578657775 },
  { eyebrow: "Doorway", station: "Station 1 of 3", wallMs: 1794578657988 },
];

describe("RR1 real-log regression net (run-14 + run-15 baselines)", () => {
  const doorwayMatches = (entry) => entry.eyebrow.toLowerCase() === "doorway" && entry.station.toLowerCase() === "station 1 of 3";

  it("replays the run-14 logs to the recorded baseline exactly", () => {
    for (const log of [run14LearnerLog, run14EvidenceLog]) {
      expect(rr1PhaseEntryIndex(log, doorwayMatches, run14DoorwayServerMs)).toEqual({ index: 1, startWallMs: run14DoorwayServerMs });
      expect(learnerHeaderWindow(log, "doorway", "Station 1 of 3", run14DoorwayServerMs)).toEqual({ startWallMs: run14DoorwayServerMs, endWallMs: null });
    }
  });

  it("replays the run-15 logs to the recorded baseline exactly", () => {
    for (const log of [run15LearnerLog, run15EvidenceLog]) {
      expect(rr1PhaseEntryIndex(log, doorwayMatches, run15DoorwayServerMs)).toEqual({ index: 1, startWallMs: run15DoorwayServerMs });
      expect(learnerHeaderWindow(log, "doorway", "Station 1 of 3", run15DoorwayServerMs)).toEqual({ startWallMs: run15DoorwayServerMs, endWallMs: null });
    }
  });
});
