import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { assembledExamReviewNotEvidenceFor, buildAssembledExamReviewPacket } from "@openclinxr/review-workflow";
import { afterEach, describe, expect, it } from "vitest";
import {
  assembledExamReplayProjectionFromReviewPacket,
  FacultyAdjudicationWorkspace,
} from "./faculty-adjudication-workspace.js";

describe("FacultyAdjudicationWorkspace", () => {
  afterEach(() => {
    cleanup();
  });

  it("stays idle until an exam run id is supplied and maps packet stations into the known-good replay projection", () => {
    render(<FacultyAdjudicationWorkspace />);
    const workspace = screen.getByLabelText("Faculty adjudication workspace");
    expect(workspace).toHaveTextContent("Assembled exam run required");
    expect(screen.queryByLabelText("Assembled exam replay timeline")).not.toBeInTheDocument();

    const packet = buildAssembledExamReviewPacket({
      examRunId: "exam_run_map_001",
      stations: [
        {
          stationRunId: "run_map_001",
          scenarioId: "ed_chest_pain_priority_v1",
          stationOrder: 1,
          requiredTraceTags: [],
          traceEvents: [{ stationRunId: "run_map_001", sequence: 0, eventType: "station.started", source: "system", atSecond: 0 }],
          phaseTransitions: [],
          facultyScoreDraft: { reviewerId: "faculty_001", status: "draft", comments: "" },
        },
      ],
    });
    const projection = assembledExamReplayProjectionFromReviewPacket(packet);
    expect(projection.schemaVersion).toBe("openclinxr.assembled-exam-replay-projection.v1");
    expect(projection.examEquivalenceGate).toBe(false);
    expect(projection.rawPayloadDisplayed).toBe(false);
    expect(projection.stations[0]?.stationRunId).toBe("run_map_001");
    expect(projection.notEvidenceFor).toEqual([...assembledExamReviewNotEvidenceFor]);
  });
});
