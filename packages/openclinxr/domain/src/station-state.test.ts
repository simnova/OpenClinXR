import { describe, expect, it } from "vitest";
import { createStationRun, evaluateRequiredTraceTags, getScheduledEventsDue, transitionStation } from "./index.js";

describe("station state domain", () => {
  it("moves from doorway to encounter to note to review", () => {
    let run = createStationRun("ed_chest_pain_priority_v1", "learner_001");
    run = transitionStation(run, { type: "START_ENCOUNTER", atSecond: 60 });
    run = transitionStation(run, { type: "END_ENCOUNTER", atSecond: 960 });
    run = transitionStation(run, { type: "SUBMIT_NOTE", atSecond: 1260, noteText: "Concern for ACS. ECG requested." });

    expect(run.phase).toBe("review");
    expect(run.note?.text).toContain("ECG");
  });

  it("requires scenario and learner identity before creating a station run", () => {
    expect(() => createStationRun("", "learner_001")).toThrow("scenarioId is required");
    expect(() => createStationRun("ed_chest_pain_priority_v1", "   ")).toThrow("learnerId is required");
  });

  it("blocks submitting a note before the encounter ends", () => {
    const run = createStationRun("ed_chest_pain_priority_v1", "learner_001");

    expect(() => transitionStation(run, { type: "SUBMIT_NOTE", atSecond: 10, noteText: "Too early" })).toThrow(
      "Cannot submit note during doorway",
    );
  });

  it("rejects impossible command timestamps and empty notes", () => {
    const doorway = createStationRun("ed_chest_pain_priority_v1", "learner_001");
    expect(() => transitionStation(doorway, { type: "START_ENCOUNTER", atSecond: -1 })).toThrow(
      "Cannot start encounter before station start",
    );

    const encounter = transitionStation(doorway, { type: "START_ENCOUNTER", atSecond: 60 });
    expect(() => transitionStation(encounter, { type: "END_ENCOUNTER", atSecond: 59 })).toThrow(
      "Cannot end encounter before it starts",
    );

    const note = transitionStation(encounter, { type: "END_ENCOUNTER", atSecond: 960 });
    expect(() => transitionStation(note, { type: "SUBMIT_NOTE", atSecond: 959, noteText: "Concern for ACS." })).toThrow(
      "Cannot submit note before encounter ends",
    );
    expect(() => transitionStation(note, { type: "SUBMIT_NOTE", atSecond: 1260, noteText: "   " })).toThrow(
      "Cannot submit an empty patient note",
    );
  });

  it("finds scheduled nurse events and missing required trace tags", () => {
    const scenario = {
      eventSchedule: [{ eventId: "nurse_vitals_change", atSecond: 420, actorId: "nurse_maria_alvarez_v1", tag: "vitals_review" }],
      requiredTraceTags: ["ecg_request", "team_communication"],
    };

    expect(getScheduledEventsDue(scenario, 420, new Set())).toHaveLength(1);
    expect(
      evaluateRequiredTraceTags(scenario.requiredTraceTags, [
        { tag: "ecg_request", atSecond: 500 },
      ]),
    ).toEqual({ observed: ["ecg_request"], missing: ["team_communication"] });
  });

  it("deduplicates required trace tag evaluation and ignores unmapped observed tags", () => {
    expect(
      evaluateRequiredTraceTags(["ecg_request", "ecg_request", "team_communication"], [
        { tag: "ecg_request", atSecond: 500 },
        { tag: "unmapped_runtime_probe", atSecond: 600 },
      ]),
    ).toEqual({ observed: ["ecg_request"], missing: ["team_communication"] });
  });

  it("returns due scheduled events in deterministic replay order", () => {
    const scenario = {
      eventSchedule: [
        { eventId: "nurse_repeat_vitals", atSecond: 420, actorId: "nurse_maria_alvarez_v1", tag: "vitals_review" },
        { eventId: "family_doorway_interrupt", atSecond: 300, actorId: "spouse_anna_hayes_v1", tag: "family_interruption" },
        { eventId: "nurse_call_ecg", atSecond: 420, actorId: "nurse_maria_alvarez_v1", tag: "ecg_request" },
      ],
    };

    expect(getScheduledEventsDue(scenario, 420, new Set(["family_doorway_interrupt"])).map((event) => event.eventId)).toEqual([
      "nurse_call_ecg",
      "nurse_repeat_vitals",
    ]);
  });
});
