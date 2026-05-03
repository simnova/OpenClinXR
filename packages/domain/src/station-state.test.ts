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

  it("blocks submitting a note before the encounter ends", () => {
    const run = createStationRun("ed_chest_pain_priority_v1", "learner_001");

    expect(() => transitionStation(run, { type: "SUBMIT_NOTE", atSecond: 10, noteText: "Too early" })).toThrow(
      "Cannot submit note during doorway",
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
});

