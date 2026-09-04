import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AdminAssembledExamReplayProjection, AdminAssembledExamStationReplaySlice } from "./AssembledExamReplayTimeline.js";
import { assembledExamStationReplayPosture } from "./AssembledExamReplayTimeline.js";
import type { AdminReviewPacketReplay } from "./api-client.js";
import { ReviewReplayReadinessSummaryPanel } from "./ReviewReplayReadinessSummaryPanel.js";

type ReviewReplayReadinessSummary = NonNullable<AdminReviewPacketReplay["reviewReplayReadinessSummary"]>;

describe("the faculty replay shows assembled station transitions", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders assembled-order encounter-to-note timelines, durable refs, advance reasons, and missing/out-of-order blockers", () => {
    render(
      <ReviewReplayReadinessSummaryPanel
        summary={summaryWithAssembledExam({
          stations: [incompleteStationStartedOnly(), completeEdStation(), completePedsStation()],
        })}
      />,
    );

    const timeline = screen.getByLabelText("Assembled exam replay timeline");
    expect(timeline).toHaveTextContent("exam_run_faculty_001");
    expect(timeline).toHaveTextContent("summary_only_assembled_exam_phase_timeline_not_score_use_or_clinical_validity");
    expect(timeline).toHaveTextContent("Private payload not displayed");
    expect(timeline).toHaveTextContent("examEquivalenceGate false; scoring false; clinical false");
    expect(timeline).toHaveTextContent("clinical_validity");
    expect(timeline).toHaveTextContent("scoring_validity");
    expect(timeline).toHaveTextContent("exam_equivalence");
    expect(timeline).toHaveTextContent("does not approve score use, clinical validity, exam equivalence, or Quest readiness");
    expect(timeline.textContent).not.toContain("Concern for ACS");
    expect(timeline.textContent).not.toContain("It feels tight when I breathe");
    expect(timeline.textContent).not.toContain("Quest ready");
    expect(timeline.textContent).not.toContain("score ready");
    expect(timeline.textContent).not.toContain("clinically valid");

    const stationLabels = within(timeline).getAllByLabelText(/Assembled station \d /);
    expect(stationLabels.map((node) => node.getAttribute("aria-label"))).toEqual([
      "Assembled station 1 ed_chest_pain_priority_v1",
      "Assembled station 2 peds_asthma_parent_anxiety_v1",
      "Assembled station 3 incomplete_station_started_only_v1",
    ]);

    const completeEd = within(timeline).getByLabelText("Assembled station 1 ed_chest_pain_priority_v1");
    expect(completeEd).toHaveTextContent("Complete replayable station");
    expect(completeEd).toHaveTextContent("complete_encounter_to_note_timeline");
    expect(completeEd).toHaveTextContent("encounter.started at 60s (form 60s)");
    expect(completeEd).toHaveTextContent("encounter.ended at 900s (form 900s)");
    expect(completeEd).toHaveTextContent("note.started at 900s (form 900s)");
    expect(completeEd).toHaveTextContent("note.submitted at 1260s (form 1260s)");
    expect(completeEd).toHaveTextContent("station.advanced at 1260s (form 1260s)");
    expect(completeEd).toHaveTextContent("durable://station-runs/run_ed_001/events/10");
    expect(completeEd).toHaveTextContent("durable://station-runs/run_ed_001/events/14");
    expect(completeEd).toHaveTextContent("patient_note_submitted_advancing");
    expect(completeEd).toHaveTextContent("no_missing_or_out_of_order_blockers");
    expect(assembledExamStationReplayPosture(completeEdStation())).toBe("complete_encounter_to_note_timeline");

    const completePeds = within(timeline).getByLabelText("Assembled station 2 peds_asthma_parent_anxiety_v1");
    expect(completePeds).toHaveTextContent("Complete replayable station");
    expect(completePeds).toHaveTextContent("last_station_note_submitted_exam_complete");
    expect(completePeds).toHaveTextContent("durable://station-runs/run_peds_001/events/14");

    const incomplete = within(timeline).getByLabelText("Assembled station 3 incomplete_station_started_only_v1");
    expect(incomplete).toHaveTextContent("Summary-only station.started");
    expect(incomplete).toHaveTextContent("summary_only_station_started");
    expect(incomplete).toHaveTextContent("this is not a complete replayable encounter-to-note timeline");
    expect(incomplete).toHaveTextContent("no_phase_transitions; station.started summary only");
    expect(incomplete).toHaveTextContent("missing_phase_transition:encounter.started");
    expect(incomplete).toHaveTextContent("missing_phase_transition:note.submitted");
    expect(incomplete).toHaveTextContent("out_of_order_phase_transition");
    expect(incomplete).toHaveTextContent("missing_advance_reason");
    expect(assembledExamStationReplayPosture(incompleteStationStartedOnly())).toBe("summary_only_station_started");
  });
});

function summaryWithAssembledExam(
  projection: Pick<AdminAssembledExamReplayProjection, "stations">,
): ReviewReplayReadinessSummary {
  return {
    stationRunId: "run_ed_001",
    replayEvidenceReady: false,
    facultyReviewSafe: true,
    timelineEntryCount: 2,
    traceEventCount: 2,
    durableEventCount: 2,
    redactedDurableEventCount: 2,
    missingRequiredBehaviorCount: 0,
    lateBehaviorCount: 0,
    safetySignalCount: 0,
    blockers: [],
    recommendedNextAction: "review_assembled_exam_phase_timeline",
    replayBoundary: "summary_only_faculty_review_not_score_use",
    assembledExamReplayProjection: {
      schemaVersion: "openclinxr.assembled-exam-replay-projection.v1",
      examRunId: "exam_run_faculty_001",
      stations: projection.stations,
      claimBoundary: "summary_only_assembled_exam_phase_timeline_not_score_use_or_clinical_validity",
      examEquivalenceGate: false,
      scoringValidityClaimed: false,
      clinicalValidityClaimed: false,
      rawPayloadDisplayed: false,
      notEvidenceFor: [
        "exam_equivalence",
        "clinical_validity",
        "scoring_validity",
        "quest_readiness",
        "learner_launch_readiness",
      ],
    },
  };
}

function completeEdStation(): AdminAssembledExamStationReplaySlice {
  return stationSlice({
    stationRunId: "run_ed_001",
    scenarioId: "ed_chest_pain_priority_v1",
    stationOrder: 1,
    advanceReason: "patient_note_submitted_advancing",
    patientNoteSubmitted: true,
    startSequence: 10,
  });
}

function completePedsStation(): AdminAssembledExamStationReplaySlice {
  return stationSlice({
    stationRunId: "run_peds_001",
    scenarioId: "peds_asthma_parent_anxiety_v1",
    stationOrder: 2,
    advanceReason: "last_station_note_submitted_exam_complete",
    patientNoteSubmitted: true,
    startSequence: 10,
  });
}

function incompleteStationStartedOnly(): AdminAssembledExamStationReplaySlice {
  return {
    examRunId: "exam_run_faculty_001",
    stationRunId: "run_incomplete_001",
    scenarioId: "incomplete_station_started_only_v1",
    stationOrder: 3,
    advanceReason: null,
    blockers: ["out_of_order_phase_transition"],
    omissions: [
      "missing_phase_transition:encounter.started",
      "missing_phase_transition:encounter.ended",
      "missing_phase_transition:note.started",
      "missing_phase_transition:note.submitted",
      "missing_phase_transition:station.advanced",
      "missing_advance_reason",
    ],
    patientNoteSubmitted: false,
    phaseTransitions: [],
  };
}

function stationSlice(input: {
  stationRunId: string;
  scenarioId: string;
  stationOrder: number;
  advanceReason: string;
  patientNoteSubmitted: boolean;
  startSequence: number;
}): AdminAssembledExamStationReplaySlice {
  const specs: Array<{
    eventType: AdminAssembledExamStationReplaySlice["phaseTransitions"][number]["eventType"];
    atSecond: number;
    phase: "encounter" | "note" | "complete";
    advanceReason?: string;
  }> = [
    { eventType: "encounter.started", atSecond: 60, phase: "encounter" },
    { eventType: "encounter.ended", atSecond: 900, phase: "encounter" },
    { eventType: "note.started", atSecond: 900, phase: "note" },
    { eventType: "note.submitted", atSecond: 1260, phase: "note" },
    { eventType: "station.advanced", atSecond: 1260, phase: "complete", advanceReason: input.advanceReason },
  ];
  return {
    examRunId: "exam_run_faculty_001",
    stationRunId: input.stationRunId,
    scenarioId: input.scenarioId,
    stationOrder: input.stationOrder,
    advanceReason: input.advanceReason,
    blockers: [],
    omissions: [],
    patientNoteSubmitted: input.patientNoteSubmitted,
    phaseTransitions: specs.map((spec, index) => ({
      eventType: spec.eventType,
      sequence: input.startSequence + index,
      atSecond: spec.atSecond,
      formAtSecond: spec.atSecond,
      phase: spec.phase,
      advanceReason: spec.advanceReason ?? null,
      durableEventRef: `durable://station-runs/${input.stationRunId}/events/${input.startSequence + index}`,
    })),
  };
}
