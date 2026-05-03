import { describe, expect, it } from "vitest";
import { buildReviewPacket } from "./index.js";

describe("review packet workflow", () => {
  it("flags observed and missing required behaviors", () => {
    const packet = buildReviewPacket({
      scenarioId: "ed_chest_pain_priority_v1",
      requiredTraceTags: ["ecg_request", "team_communication"],
      traceEvents: [{ tag: "ecg_request", atSecond: 500 }],
      stationRunId: "run_001",
      facultyScoreDraft: { reviewerId: "faculty_001", status: "draft", comments: "Needs clearer teamwork." },
    });

    expect(packet.observedTraceTags).toEqual(["ecg_request"]);
    expect(packet.missingRequiredTraceTags).toEqual(["team_communication"]);
  });

  it("requires a reviewer identity for a faculty score draft", () => {
    expect(() =>
      buildReviewPacket({
        scenarioId: "ed_chest_pain_priority_v1",
        requiredTraceTags: [],
        traceEvents: [],
        stationRunId: "run_001",
        facultyScoreDraft: { reviewerId: "", status: "draft", comments: "" },
      }),
    ).toThrow("Faculty score draft requires reviewer identity");
  });
});

