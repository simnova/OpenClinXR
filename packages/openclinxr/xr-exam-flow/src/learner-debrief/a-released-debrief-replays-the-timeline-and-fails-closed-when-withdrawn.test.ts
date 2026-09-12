import { describe, expect, it } from "vitest";
import { buildExamRunSummaryEvidence } from "../index.js";
// NOT TESTED: following a superseded release to its successor is not
// implemented because the caller passes one release.

const OUTCOMES = [
  {
    scenarioId: "peds_asthma_parent_anxiety_v1",
    scenarioIndex: 1,
    phase: "complete" as const,
    noteTextLength: 12,
    noteSubmitted: true,
    lastAdvanceReason: "patient_note_submitted_advancing",
    recordedAtIso: "2026-09-11T12:10:00.000Z",
    stationOrder: 2,
    startedAtFormSecond: 900,
    endedAtFormSecond: 1560,
  },
  {
    scenarioId: "ed_chest_pain_priority_v1",
    scenarioIndex: 0,
    phase: "complete" as const,
    noteTextLength: 20,
    noteSubmitted: true,
    lastAdvanceReason: "patient_note_submitted_advancing",
    recordedAtIso: "2026-09-11T12:00:00.000Z",
    stationOrder: 1,
    startedAtFormSecond: 0,
    endedAtFormSecond: 840,
  },
];

const OBSERVATIONS = [
  {
    observationId: "obs_ed_001",
    rubricItemId: "history_taking",
    scenarioId: "ed_chest_pain_priority_v1",
    scenarioIndex: 0,
    formativeText: "Next time, ask what makes the chest discomfort better or worse.",
    evidenceCites: [{ sequence: 4, eventType: "learner.observation", tag: "pain_character", atFormSecond: 320 }],
  },
  {
    observationId: "obs_peds_001",
    rubricItemId: "family_communication",
    scenarioId: "peds_asthma_parent_anxiety_v1",
    scenarioIndex: 1,
    formativeText: "You named the parent's worry before moving on; keep doing that.",
    evidenceCites: [{ sequence: 7, eventType: "actor_response", tag: "anxiety_acknowledged", atFormSecond: 1100 }],
  },
];

function debriefArgs(release: { releaseId: string; examRunId: string; releasedAt: string; status: "active" | "superseded" | "withdrawn" }) {
  return {
    examRunId: "exam_run_local_001",
    totalScenarios: 2,
    outcomes: OUTCOMES,
    formRunState: null,
    learnerDebrief: { release, observations: OBSERVATIONS },
  };
}

describe("a released debrief replays the timeline and fails closed when withdrawn", () => {
  it("projects stations in station order with each observation aligned to its evidence moment", () => {
    const evidence = buildExamRunSummaryEvidence(
      debriefArgs({ releaseId: "feedback_release:exam_run_local_001:1", examRunId: "exam_run_local_001", releasedAt: "2026-09-11T13:00:00.000Z", status: "active" }),
    );
    const debrief = evidence.learnerDebrief;
    expect(debrief).toBeDefined();
    expect(debrief?.stations.map((station) => station.stationOrder)).toEqual([1, 2]);
    expect(debrief?.stations[0]?.scenarioId).toBe("ed_chest_pain_priority_v1");
    expect(debrief?.stations[0]?.observations.map((item) => item.observationId)).toEqual(["obs_ed_001"]);
    expect(debrief?.stations[0]?.observations[0]?.evidenceMoments).toEqual([
      { sequence: 4, eventType: "learner.observation", tag: "pain_character", atFormSecond: 320 },
    ]);
    expect(debrief?.stations[1]?.observations.map((item) => item.observationId)).toEqual(["obs_peds_001"]);
    expect(debrief?.unalignedObservationIds).toEqual([]);
    expect(debrief?.scoringValidityClaimed).toBe(false);
    expect(debrief?.examEquivalenceGate).toBe(false);
  });

  it("carries formative wording only, never ratings or scores", () => {
    const evidence = buildExamRunSummaryEvidence(
      debriefArgs({ releaseId: "feedback_release:exam_run_local_001:1", examRunId: "exam_run_local_001", releasedAt: "2026-09-11T13:00:00.000Z", status: "active" }),
    );
    const serialized = JSON.stringify(evidence.learnerDebrief);
    for (const token of ["\"rating\"", "not_met", "partially_met", "facultyScoreDraft", "faculty_only_annotation\" :"]) {
      expect(serialized).not.toContain(token);
    }
    for (const station of evidence.learnerDebrief?.stations ?? []) {
      for (const observation of station.observations) {
        expect(Object.keys(observation).sort()).toEqual(["evidenceMoments", "formativeText", "observationId", "rubricItemId"]);
      }
    }
  });

  it("drops a cite outside the station window and names the unaligned observation", () => {
    const evidence = buildExamRunSummaryEvidence({
      examRunId: "exam_run_local_001",
      totalScenarios: 2,
      outcomes: OUTCOMES,
      formRunState: null,
      learnerDebrief: {
        release: { releaseId: "feedback_release:exam_run_local_001:1", examRunId: "exam_run_local_001", releasedAt: "2026-09-11T13:00:00.000Z", status: "active" },
        observations: [
          {
            observationId: "obs_ed_stray",
            rubricItemId: "history_taking",
            scenarioId: "ed_chest_pain_priority_v1",
            scenarioIndex: 0,
            formativeText: "This moment belongs to the later station.",
            evidenceCites: [{ sequence: 9, eventType: "learner.observation", tag: "late_cite", atFormSecond: 1200 }],
          },
        ],
      },
    });
    expect(evidence.learnerDebrief?.stations[0]?.observations.map((item) => item.observationId)).toEqual([]);
    expect(evidence.learnerDebrief?.stations[0]?.observations.find((item) => item.observationId === "obs_ed_stray")).toBeUndefined();
    expect(evidence.learnerDebrief?.unalignedObservationIds).toEqual(["obs_ed_stray"]);
  });

  it("refuses a superseded release instead of projecting it", () => {
    const evidence = buildExamRunSummaryEvidence(
      debriefArgs({ releaseId: "feedback_release:exam_run_local_001:1", examRunId: "exam_run_local_001", releasedAt: "2026-09-11T13:00:00.000Z", status: "superseded" }),
    );
    expect(evidence.learnerDebrief).toBeUndefined();
    expect(evidence.learnerDebriefRefusal).toEqual({
      reason: "feedback_release_not_active",
      status: "superseded",
      releaseId: "feedback_release:exam_run_local_001:1",
    });
  });

  it("refuses a withdrawn release instead of projecting it", () => {
    const evidence = buildExamRunSummaryEvidence(
      debriefArgs({ releaseId: "feedback_release:exam_run_local_001:1", examRunId: "exam_run_local_001", releasedAt: "2026-09-11T13:00:00.000Z", status: "withdrawn" }),
    );
    expect(evidence.learnerDebrief).toBeUndefined();
    expect(evidence.learnerDebriefRefusal).toEqual({
      reason: "feedback_release_not_active",
      status: "withdrawn",
      releaseId: "feedback_release:exam_run_local_001:1",
    });
  });

  it("refuses a release minted for a different exam run", () => {
    const evidence = buildExamRunSummaryEvidence(
      debriefArgs({ releaseId: "feedback_release:other_run:1", examRunId: "other_run", releasedAt: "2026-09-11T13:00:00.000Z", status: "active" }),
    );
    expect(evidence.learnerDebrief).toBeUndefined();
    expect(evidence.learnerDebriefRefusal?.reason).toBe("feedback_release_exam_run_mismatch");
  });

  it("returns the summary unchanged when no learner debrief is passed", () => {
    const evidence = buildExamRunSummaryEvidence({
      examRunId: "exam_run_local_001",
      totalScenarios: 2,
      outcomes: OUTCOMES,
      formRunState: null,
    });
    expect(evidence.learnerDebrief).toBeUndefined();
    expect(evidence.learnerDebriefRefusal).toBeUndefined();
    expect(evidence).toEqual({
      source: "local_exam_run_summary",
      examRunId: "exam_run_local_001",
      totalScenarios: 2,
      stationOutcomes: OUTCOMES,
      examEquivalenceGate: false,
    });
  });
});
