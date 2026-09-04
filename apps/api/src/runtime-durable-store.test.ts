import { assembledExamReviewNotEvidenceFor, type AssembledExamReviewPacket } from "@openclinxr/review-workflow";
import type { ScenarioRuntimeActorTurn } from "@openclinxr/scenario-runtime";
import { describe, expect, it, vi } from "vitest";
import type { ApiPersistenceSink } from "./api-types.js";
import {
  assembledExamRunClaimBoundary,
  assembledExamRunNotEvidenceFor,
  createScenarioRuntimeDurableStoreFromApiPersistence,
  type ApiAssembledExamRunRecord,
} from "./runtime-durable-store.js";

describe("createScenarioRuntimeDurableStoreFromApiPersistence", () => {
  it("forwards saveReviewPacket and saveActorTurn to the API persistence sink", async () => {
    const saveReviewPacket = vi.fn();
    const saveActorTurn = vi.fn();
    const sink: ApiPersistenceSink = { saveReviewPacket, saveActorTurn };
    const store = createScenarioRuntimeDurableStoreFromApiPersistence(sink);

    const packet = {
      stationRunId: "run_001",
      scenarioId: "ed_chest_pain_priority_v1",
      traceQuality: { eventCount: 3 },
    } as Parameters<NonNullable<ApiPersistenceSink["saveReviewPacket"]>>[1];

    const turn: ScenarioRuntimeActorTurn = {
      turnId: "turn_1_patient_robert_hayes_v1_120",
      stationRunId: "run_001",
      actorId: "patient_robert_hayes_v1",
      atSecond: 120,
      conversationTurn: 1,
      learnerUtterance: "When did the pressure start?",
      responseText: "It started this morning.",
      responseKind: "direct_answer",
      traceContextTags: ["history_opqrst"],
      durableEventRef: "durable://station-runs/run_001/events/4",
      learnerEventSequence: 3,
      actorResponseEventSequence: 4,
    };

    await store.saveReviewPacket?.("run_001", packet);
    await store.saveActorTurn?.("run_001", turn);

    expect(saveReviewPacket).toHaveBeenCalledTimes(1);
    expect(saveReviewPacket).toHaveBeenCalledWith("run_001", packet);
    expect(saveActorTurn).toHaveBeenCalledTimes(1);
    expect(saveActorTurn).toHaveBeenCalledWith("run_001", turn);
  });

  it("no-ops when sink methods are unset", async () => {
    const store = createScenarioRuntimeDurableStoreFromApiPersistence({});
    // Sink methods optional → adapter returns void (undefined), not a Promise.
    await expect(Promise.resolve(store.saveReviewPacket?.("run_x", {} as never))).resolves.toBeUndefined();
    await expect(Promise.resolve(store.saveActorTurn?.("run_x", {} as never))).resolves.toBeUndefined();
    await expect(Promise.resolve(store.saveAssembledExamReviewPacket("exam_x", {} as never))).resolves.toBeUndefined();
    await expect(Promise.resolve(store.getAssembledExamReviewPacket("exam_x"))).resolves.toBeUndefined();
    await expect(Promise.resolve(store.saveAssembledExamRun("exam_x", {} as never))).resolves.toBeUndefined();
    await expect(Promise.resolve(store.getAssembledExamRun("exam_x"))).resolves.toBeUndefined();
  });

  it("forwards exam-run packet save and get without flattening stations", async () => {
    const saved: AssembledExamReviewPacket[] = [];
    const sink: ApiPersistenceSink = {
      saveAssembledExamReviewPacket: (examRunId, packet) => {
        expect(examRunId).toBe(packet.examRunId);
        saved.push(packet);
      },
      getAssembledExamReviewPacket: (examRunId) => saved.find((packet) => packet.examRunId === examRunId),
    };
    const store = createScenarioRuntimeDurableStoreFromApiPersistence(sink);
    const packet = {
      examRunId: "exam_run_learner_phase_001_ed_chest_pain_priority_v1__peds_asthma_parent_anxiety_v1",
      learnerId: "learner_phase_001",
      stations: [
        {
          identity: {
            examRunId: "exam_run_learner_phase_001_ed_chest_pain_priority_v1__peds_asthma_parent_anxiety_v1",
            stationRunId: "run_ed_001",
            scenarioId: "ed",
            stationOrder: 1,
          },
        },
        {
          identity: {
            examRunId: "exam_run_learner_phase_001_ed_chest_pain_priority_v1__peds_asthma_parent_anxiety_v1",
            stationRunId: "run_peds_001",
            scenarioId: "peds",
            stationOrder: 2,
          },
        },
      ],
      examTimeline: [],
      omissions: [],
      claimBoundary: "assembled_exam_review_packet_not_exam_equivalence",
      notEvidenceFor: assembledExamReviewNotEvidenceFor,
      examEquivalenceGate: false,
    } as unknown as AssembledExamReviewPacket;

    await store.saveAssembledExamReviewPacket(packet.examRunId, packet);
    const loaded = await store.getAssembledExamReviewPacket(packet.examRunId);
    expect(loaded).toBe(packet);
    expect(loaded?.stations).toHaveLength(2);
    expect(saved).toHaveLength(1);
  });

  it("forwards assembled-exam run aggregate save and get without flattening stations", async () => {
    const saved: ApiAssembledExamRunRecord[] = [];
    const sink: ApiPersistenceSink = {
      saveAssembledExamRun: (examRunId, record) => {
        expect(examRunId).toBe(record.examRunId);
        saved.push(record);
      },
      getAssembledExamRun: (examRunId) => saved.find((record) => record.examRunId === examRunId),
    };
    const store = createScenarioRuntimeDurableStoreFromApiPersistence(sink);
    const record = {
      examRunId: "exam_run_learner_phase_001",
      learnerId: "learner_phase_001",
      examFormId: "form_pilot_001",
      blueprintId: "blueprint_pilot_v1",
      form: { examFormId: "form_pilot_001", blueprintId: "blueprint_pilot_v1", stationRefs: [{}, {}] },
      timingPlan: { blueprintId: "blueprint_pilot_v1", stationWindows: [{}, {}] },
      orderedStations: [
        { stationOrder: 1, slotId: "slot_a", stationRunId: "run_a", scenarioId: "ed", scenarioVersion: 1 },
        { stationOrder: 2, slotId: "slot_b", stationRunId: "run_b", scenarioId: "peds", scenarioVersion: 1 },
      ],
      admittedPhaseEvents: [],
      claimBoundary: assembledExamRunClaimBoundary,
      notEvidenceFor: assembledExamRunNotEvidenceFor,
      examEquivalenceGate: false,
    } as unknown as ApiAssembledExamRunRecord;

    await store.saveAssembledExamRun(record.examRunId, record);
    const loaded = await store.getAssembledExamRun(record.examRunId);
    expect(loaded).toBe(record);
    expect(loaded?.orderedStations).toHaveLength(2);
    expect(saved).toHaveLength(1);
  });
});
