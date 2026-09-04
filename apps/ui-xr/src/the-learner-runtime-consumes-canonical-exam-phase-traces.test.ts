import type { TraceEvent } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import {
  admitLearnerCanonicalPhaseEvent,
  applyLearnerExamFlowIntent,
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
 *
 * ## REVIEW CORRECTION
 * Local UI intents stay `local_exam_flow_fallback` even after localStorage restore.
 * Only externally supplied TraceEvent records become canonical after identity,
 * payload phase, sequence/time, and durableEventRef validation. Adapter does not
 * fabricate authoritative occurredAt or durable refs.
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

function payloadPhase(eventType: (typeof LEARNER_CANONICAL_PHASE_TYPES)[number]) {
  return eventType === "station.advanced" ? "complete" : eventType.startsWith("note.") ? "note" : "encounter";
}

/** Simulates a scenario-runtime persisted replayable event. Adapter must not mint these. */
function persistedEvent(
  sequence: number,
  eventType: (typeof LEARNER_CANONICAL_PHASE_TYPES)[number],
  extras: { atSecond?: number; examRunId?: string; stationRunId?: string; stationOrder?: number; scenarioId?: string; advanceReason?: string; durableEventRef?: string; occurredAt?: string; phase?: "encounter" | "note" | "complete" } = {},
): TraceEvent {
  const atSecond = extras.atSecond ?? sequence;
  const stationRunId = extras.stationRunId ?? identity.stationRunId;
  return {
    stationRunId,
    sequence,
    eventType,
    occurredAt: extras.occurredAt ?? new Date(Date.parse("2026-05-03T15:38:58.000Z") + atSecond * 1000).toISOString(),
    atSecond,
    source: "system",
    payload: {
      scenarioId: extras.scenarioId ?? identity.scenarioId,
      examRunId: extras.examRunId ?? identity.examRunId,
      stationOrder: extras.stationOrder ?? identity.stationOrder,
      phase: extras.phase ?? payloadPhase(eventType),
      formAtSecond: atSecond,
      durableEventRef: extras.durableEventRef ?? `durable://station-runs/${stationRunId}/events/${sequence}`,
      ...(extras.advanceReason ? { advanceReason: extras.advanceReason } : {}),
    },
  };
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

  it("admits a persisted same-run trace as canonical and surfaces its advance reason", () => {
    let store = emptyStore();
    for (const [sequence, eventType] of LEARNER_CANONICAL_PHASE_TYPES.entries()) {
      const admitted = admitLearnerCanonicalPhaseEvent(
        store,
        persistedEvent(sequence, eventType, {
          advanceReason: eventType === "station.advanced" ? "patient_note_submitted_advancing" : undefined,
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
    expect(store.persistedEvents.map((item) => item.eventType)).toEqual([...LEARNER_CANONICAL_PHASE_TYPES]);
    expect(store.persistedEvents[store.persistedEvents.length - 1]?.payload["durableEventRef"]).toBe(
      "durable://station-runs/station_run_learner_phase_001/events/4",
    );
  });

  it("refuses cross-run, out-of-order, and malformed identity or durable refs without mutating the store", () => {
    const first = admitLearnerCanonicalPhaseEvent(emptyStore(), persistedEvent(0, "encounter.started"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const snapshot = JSON.stringify(first.store.persistedEvents);

    const crossRun = admitLearnerCanonicalPhaseEvent(first.store, persistedEvent(1, "encounter.ended", { examRunId: "exam_run_other" }));
    expect(crossRun.ok).toBe(false);
    if (!crossRun.ok) expect(crossRun.reason).toBe("cross_run");
    expect(JSON.stringify(crossRun.store.persistedEvents)).toBe(snapshot);

    const outOfOrder = admitLearnerCanonicalPhaseEvent(first.store, persistedEvent(0, "encounter.ended"));
    expect(outOfOrder.ok).toBe(false);
    if (!outOfOrder.ok) expect(outOfOrder.reason).toBe("non_monotonic_sequence");

    const badRef = admitLearnerCanonicalPhaseEvent(first.store, persistedEvent(1, "encounter.ended", { durableEventRef: "durable://station-runs/other/events/1" }));
    expect(badRef.ok).toBe(false);
    if (!badRef.ok) expect(badRef.reason).toBe("malformed_durable_ref");
    expect(JSON.stringify(badRef.store.persistedEvents)).toBe(snapshot);

    const missingOccurredAt = admitLearnerCanonicalPhaseEvent(first.store, { ...persistedEvent(1, "encounter.ended"), occurredAt: "" });
    expect(missingOccurredAt.ok).toBe(false);
    if (!missingOccurredAt.ok) expect(missingOccurredAt.reason).toBe("missing_identity");
  });

  it("keeps UI-created intents as local fallback after reload and never relabels them canonical", () => {
    const ended = applyLearnerExamFlowIntent(emptyStore(), {
      kind: "end_encounter",
      atSecond: 12,
      formAtSecond: 12,
      noteTextLength: 0,
      nextScenarioId: "peds_asthma_parent_anxiety_v1",
    });
    expect(ended.admitted).toBe(true);
    expect(ended.view.source).toBe("local_exam_flow_fallback");
    expect(ended.view.fallbackActive).toBe(true);
    expect(ended.store.localEvents.some((event) => event.payload["durableEventRef"])).toBe(false);
    expect(ended.store.localEvents.some((event) => event.source === "system")).toBe(false);
    const restored = restoreLearnerCanonicalPhaseTraceFromJson(emptyStore(), JSON.stringify({
      persistedEvents: ended.store.persistedEvents,
      localEvents: ended.store.localEvents,
    }));
    expect(viewLearnerCanonicalExamPhase(restored).source).toBe("local_exam_flow_fallback");
    expect(viewLearnerCanonicalExamPhase(restored).phase).toBe("note");
    expect(restored.localEvents.map((item) => item.sequence)).toEqual(ended.store.localEvents.map((item) => item.sequence));
    const replay = restoreLearnerCanonicalPhaseTraceFromJson(restored, JSON.stringify({
      persistedEvents: restored.persistedEvents,
      localEvents: restored.localEvents,
    }));
    expect(viewLearnerCanonicalExamPhase(replay).lastAdmittedSequence).toBe(ended.view.lastAdmittedSequence);
    expect(viewLearnerCanonicalExamPhase(replay).source).toBe("local_exam_flow_fallback");
  });

  it("restores admitted persisted events without regressing sequence or dropping canonical source", () => {
    const admitted = admitLearnerCanonicalPhaseEvent(emptyStore(), persistedEvent(0, "encounter.started"));
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    const next = admitLearnerCanonicalPhaseEvent(admitted.store, persistedEvent(1, "encounter.ended"));
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    const restored = restoreLearnerCanonicalPhaseTraceFromJson(emptyStore(), JSON.stringify({
      persistedEvents: next.store.persistedEvents,
      localEvents: [],
    }));
    expect(viewLearnerCanonicalExamPhase(restored).source).toBe("canonical_assembled_exam_phase_trace");
    expect(restored.persistedEvents.map((item) => item.sequence)).toEqual([0, 1]);
    expect(viewLearnerCanonicalExamPhase(restored).lastAdmittedSequence).toBe(1);
  });

  it("preserves distinct manual-submit versus note-timeout advance reasons on the fallback lane", () => {
    const note = applyLearnerExamFlowIntent(emptyStore(), {
      kind: "end_encounter",
      atSecond: 20,
      formAtSecond: 20,
      noteTextLength: 0,
      nextScenarioId: null,
    });
    const submitted = applyLearnerExamFlowIntent(note.store, {
      kind: "submit_note",
      atSecond: 30,
      formAtSecond: 30,
      noteTextLength: 18,
      nextScenarioId: null,
    });
    expect(submitted.view.source).toBe("local_exam_flow_fallback");
    expect(submitted.view.lastAdvanceReason).toBe("last_station_note_submitted_exam_complete");

    const timed = applyLearnerExamFlowIntent(note.store, {
      kind: "note_timer_elapsed",
      atSecond: 30,
      formAtSecond: 30,
      noteTextLength: 18,
      nextScenarioId: "peds_asthma_parent_anxiety_v1",
      autoAdvanceOnNoteTimeout: true,
    });
    expect(timed.view.source).toBe("local_exam_flow_fallback");
    expect(timed.view.lastAdvanceReason).toBe("note_timer_elapsed_advancing");
    expect(timed.view.lastAdvanceReason).not.toBe(submitted.view.lastAdvanceReason);

    const timedLast = applyLearnerExamFlowIntent(note.store, {
      kind: "note_timer_elapsed",
      atSecond: 30,
      formAtSecond: 30,
      noteTextLength: 18,
      nextScenarioId: null,
      autoAdvanceOnNoteTimeout: true,
    });
    expect(timedLast.view.lastAdvanceReason).toBe("note_timer_elapsed_last_station_complete");
  });
});
