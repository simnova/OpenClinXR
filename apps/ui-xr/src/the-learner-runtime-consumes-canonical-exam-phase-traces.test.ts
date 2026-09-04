import { describe, expect, it } from "vitest";
import {
  admitLearnerCanonicalPhaseEvent,
  applyLearnerExamFlowIntent,
  createLearnerCanonicalPhaseEvent,
  createLearnerCanonicalPhaseTraceStore,
  LEARNER_CANONICAL_PHASE_TYPES,
  LEARNER_EXAM_PHASE_NOT_EVIDENCE_FOR,
  restoreLearnerCanonicalPhaseTraceFromJson,
  viewLearnerCanonicalExamPhase,
} from "./runtime-state.js";

/**
 * PLANTED CONTRACT — learner UI-XR consumes canonical assembled-exam phase traces.
 *
 * Diagnosis (immutable): ui-xr mutates examFlowPhase / examLastAdvanceReason in main.ts
 * and persists a separate local summary. scenario-runtime 73046d48 already emits
 * monotonic encounter→note→advance traces (REPLAYABLE_PHASE_TRANSITION_TYPES) with
 * canonical advance reasons. This file pins the adapter: admit same-run monotonic
 * events, refuse cross-run / out-of-order, restore on reload without regressing
 * sequence, and expose current phase + advance reason. Local-only empty store is
 * labeled fallback. Runtime evidence is never exam-equivalence.
 *
 * Event-type match with scenario-runtime/src/trace.ts REPLAYABLE_PHASE_TRANSITION_TYPES
 * must stay exact. Report mismatch immediately.
 */

const identity = {
  examRunId: "exam_run_learner_phase_001",
  stationRunId: "station_run_learner_phase_001",
  scenarioId: "ed_chest_pain_priority_v1",
  stationOrder: 1,
};

function emptyStore() {
  return createLearnerCanonicalPhaseTraceStore(identity);
}

function event(
  sequence: number,
  eventType: (typeof LEARNER_CANONICAL_PHASE_TYPES)[number],
  extras: { atSecond?: number; examRunId?: string; stationRunId?: string; advanceReason?: string; phase?: "encounter" | "note" | "complete" } = {},
) {
  return createLearnerCanonicalPhaseEvent({
    ...identity,
    examRunId: extras.examRunId ?? identity.examRunId,
    stationRunId: extras.stationRunId ?? identity.stationRunId,
    sequence,
    eventType,
    atSecond: extras.atSecond ?? sequence,
    formAtSecond: extras.atSecond ?? sequence,
    phase: extras.phase ?? (eventType === "station.advanced" ? "complete" : eventType.startsWith("note.") ? "note" : "encounter"),
    ...(extras.advanceReason ? { advanceReason: extras.advanceReason } : {}),
  });
}

describe("the learner runtime consumes canonical exam phase traces", () => {
  it("matches scenario-runtime replayable phase transition event types exactly", () => {
    expect([...LEARNER_CANONICAL_PHASE_TYPES]).toEqual([
      "encounter.started",
      "encounter.ended",
      "note.started",
      "note.submitted",
      "station.advanced",
    ]);
  });

  it("labels an empty store as local-only fallback and never claims exam equivalence", () => {
    const view = viewLearnerCanonicalExamPhase(emptyStore());
    expect(view.source).toBe("local_exam_flow_fallback");
    expect(view.fallbackActive).toBe(true);
    expect(view.fallbackLabel).toMatch(/local-only fallback/i);
    expect(view.phase).toBe("encounter");
    expect(view.examEquivalenceGate).toBe(false);
    expect(view.notEvidenceFor).toEqual(expect.arrayContaining(["exam_equivalence"]));
    expect([...LEARNER_EXAM_PHASE_NOT_EVIDENCE_FOR]).toEqual(expect.arrayContaining(["exam_equivalence"]));
  });

  it("admits monotonic same-run encounter→note→advance events and surfaces canonical reason", () => {
    let store = emptyStore();
    for (const [sequence, eventType] of LEARNER_CANONICAL_PHASE_TYPES.entries()) {
      const admitted = admitLearnerCanonicalPhaseEvent(
        store,
        event(sequence, eventType, {
          advanceReason: eventType === "station.advanced" ? "patient_note_submitted_advancing" : undefined,
          phase: eventType === "station.advanced" ? "complete" : eventType.startsWith("note.") ? "note" : "encounter",
        }),
      );
      expect(admitted.ok, eventType).toBe(true);
      if (admitted.ok) store = admitted.store;
    }
    const view = viewLearnerCanonicalExamPhase(store);
    expect(view.source).toBe("canonical_assembled_exam_phase_trace");
    expect(view.fallbackActive).toBe(false);
    expect(view.phase).toBe("complete");
    expect(view.lastAdvanceReason).toBe("patient_note_submitted_advancing");
    expect(view.lastAdmittedSequence).toBe(4);
    expect(view.noteSubmitted).toBe(true);
    expect(store.events.map((item) => item.eventType)).toEqual([...LEARNER_CANONICAL_PHASE_TYPES]);
    expect(store.events[store.events.length - 1]?.payload["durableEventRef"]).toBe(
      "durable://station-runs/station_run_learner_phase_001/events/4",
    );
  });

  it("refuses cross-run and out-of-order events without mutating the store", () => {
    const first = admitLearnerCanonicalPhaseEvent(emptyStore(), event(0, "encounter.started"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const snapshot = JSON.stringify(first.store.events);

    const crossRun = admitLearnerCanonicalPhaseEvent(first.store, event(1, "encounter.ended", { examRunId: "exam_run_other" }));
    expect(crossRun.ok).toBe(false);
    if (!crossRun.ok) expect(crossRun.reason).toBe("cross_run");
    expect(JSON.stringify(crossRun.store.events)).toBe(snapshot);

    const outOfOrder = admitLearnerCanonicalPhaseEvent(first.store, event(0, "encounter.ended"));
    expect(outOfOrder.ok).toBe(false);
    if (!outOfOrder.ok) expect(outOfOrder.reason).toBe("non_monotonic_sequence");
    expect(JSON.stringify(outOfOrder.store.events)).toBe(snapshot);

    const skippedPhase = admitLearnerCanonicalPhaseEvent(first.store, event(1, "station.advanced", { phase: "complete" }));
    expect(skippedPhase.ok).toBe(false);
    if (!skippedPhase.ok) expect(skippedPhase.reason).toBe("non_monotonic_sequence");
  });

  it("restores admitted events on reload without regressing sequence", () => {
    const ended = applyLearnerExamFlowIntent(emptyStore(), {
      kind: "end_encounter",
      atSecond: 12,
      formAtSecond: 12,
      noteTextLength: 0,
      nextScenarioId: "peds_asthma_parent_anxiety_v1",
    });
    expect(ended.admitted).toBe(true);
    expect(ended.view.phase).toBe("note");
    const persisted = JSON.stringify(ended.store.events);
    const restored = restoreLearnerCanonicalPhaseTraceFromJson(emptyStore(), persisted);
    expect(restored.events.map((item) => item.sequence)).toEqual(ended.store.events.map((item) => item.sequence));
    expect(viewLearnerCanonicalExamPhase(restored).phase).toBe("note");
    expect(viewLearnerCanonicalExamPhase(restored).lastAdmittedSequence).toBe(ended.view.lastAdmittedSequence);
    const replay = restoreLearnerCanonicalPhaseTraceFromJson(restored, persisted);
    expect(replay.events).toHaveLength(ended.store.events.length);
    expect(viewLearnerCanonicalExamPhase(replay).lastAdmittedSequence).toBe(ended.view.lastAdmittedSequence);
  });

  it("applies submit-note as canonical last-station advance and ignores locally invented reason strings", () => {
    const note = applyLearnerExamFlowIntent(emptyStore(), {
      kind: "end_encounter",
      atSecond: 20,
      formAtSecond: 20,
      noteTextLength: 0,
      nextScenarioId: null,
    });
    const complete = applyLearnerExamFlowIntent(note.store, {
      kind: "submit_note",
      atSecond: 30,
      formAtSecond: 30,
      noteTextLength: 18,
      nextScenarioId: null,
    });
    expect(complete.admitted).toBe(true);
    expect(complete.view.phase).toBe("complete");
    expect(complete.view.lastAdvanceReason).toBe("last_station_note_submitted_exam_complete");
    expect(complete.view.lastAdvanceReason).not.toContain("advancing_to_");
    expect(complete.navigateToScenarioId).toBeNull();
  });
});
