import { describe, expect, it } from "vitest";
import { buildFacultyReviewPath, buildReviewPacket } from "./index.js";

describe("faculty review path", () => {
  it("surfaces completed-station note evidence, late behavior, and reviewer posture from the replay packet", () => {
    const packet = buildReviewPacket({
      stationRunId: "run_001",
      scenarioId: "ed_chest_pain_priority_v1",
      requiredTraceTags: ["ecg_request", "patient_note_submitted"],
      timeCriticalTraceTagThresholds: {
        urgent_escalation: 500,
      },
      traceEvents: [
        { sequence: 0, eventType: "station.started", source: "system", atSecond: 0 },
        { sequence: 1, eventType: "learner.order", source: "learner", tag: "ecg_request", atSecond: 240 },
        { sequence: 2, eventType: "learner.escalation", source: "learner", tag: "urgent_escalation", atSecond: 620 },
        { sequence: 3, eventType: "note.submitted", source: "learner", tag: "patient_note_submitted", atSecond: 1260 },
      ],
      patientNote: {
        stationRunId: "run_001",
        submittedAtSecond: 1260,
        text: "Concern for ACS. ECG requested.",
      },
      facultyScoreDraft: {
        reviewerId: "faculty_001",
        status: "draft",
        comments: "Review late escalation timing.",
      },
    });

    const path = buildFacultyReviewPath({
      packet,
      hasDurableSummary: true,
      durableSummaryIsSafe: true,
      traceEventCount: packet.timeline.length,
      safetyFlagLabels: packet.unsafeEvents,
    });

    expect(path.decision).toMatchObject({
      title: "Needs scenario iteration",
      color: "gold",
    });
    expect(path.decision.blockers).toContain("late_behavior:urgent_escalation");
    expect(path.decision.reasons).toContain("1 late behavior should be reviewed for scenario timing.");
    expect(path.posture).toMatchObject({
      title: "Changes requested draft recommended",
      color: "gold",
    });
    expect(path.posture.checks).toContainEqual(expect.objectContaining({
      label: "Patient note evidence",
      status: "available",
    }));
    expect(path.actionChecklist).toContainEqual(expect.objectContaining({
      label: "Use patient note during debrief review",
      status: "available",
    }));
  });
});
