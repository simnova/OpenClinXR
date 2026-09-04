import type { ReviewPacket } from "@openclinxr/shared-schemas";
import { describe, expect, it } from "vitest";
import {
  createExamRunLedger,
  createMongoExamPersistence,
  examRunLedgerClaimBoundary,
  examRunLedgerNotEvidenceFor,
  MemoryExamRunLedger,
  type OpenExamRunInput,
} from "./index.js";

const examRunId = "exam_run_ledger_001";
const stationA = "run_station_a";
const stationB = "run_station_b";

function openInput(overrides: Partial<OpenExamRunInput> = {}): OpenExamRunInput {
  return {
    examRunId,
    examFormId: "form_ledger_001",
    blueprintId: "blueprint_step2cs_style_seed_v1",
    stations: [
      {
        stationOrder: 0,
        slotId: "slot_a",
        stationRunId: stationA,
        scenarioId: "ed_chest_pain_priority_v1",
        scenarioVersion: 1,
      },
      {
        stationOrder: 1,
        slotId: "slot_b",
        stationRunId: stationB,
        scenarioId: "peds_asthma_parent_anxiety_v1",
        scenarioVersion: 1,
      },
    ],
    ...overrides,
  };
}

function reviewPacket(stationRunId: string): ReviewPacket {
  return {
    stationRunId,
    scenarioId: "ed_chest_pain_priority_v1",
    observedTraceTags: ["ecg_request"],
    missingRequiredTraceTags: [],
    lateTraceTags: [],
    unsafeEvents: [],
    timeline: [
      {
        sequence: 0,
        atSecond: 0,
        eventType: "station.started",
        source: "system",
        summary: "system station.started",
      },
    ],
    traceQuality: {
      eventCount: 1,
      modelGeneratedEventCount: 0,
      modelFailedEventCount: 0,
      voiceAudioEventCount: 0,
      blockedGuardrailCount: 0,
      unsafeEventCount: 0,
      missingRequiredTraceTagCount: 0,
      hasPatientNote: true,
      hasModelProvenance: false,
    },
    patientNote: {
      stationRunId,
      submittedAtSecond: 1260,
      text: "Concern for ACS. ECG requested.",
    },
    facultyScoreDraft: {
      reviewerId: "faculty_001",
      status: "draft",
      comments: "Local review only.",
    },
  };
}

async function openFreshLedger() {
  const ledger = createExamRunLedger();
  await ledger.openExamRun(openInput());
  return ledger;
}

describe("exam-run ledger", () => {
  it("uses an honest in-memory backend when no Mongo db is provided", async () => {
    const ledger = createExamRunLedger();
    expect(ledger.backend).toBe("memory");
    expect(ledger).toBeInstanceOf(MemoryExamRunLedger);
    await ledger.ensureIndexes();
    await ledger.openExamRun(openInput());
    const resume = await ledger.resume(examRunId);
    expect(resume.backend).toBe("memory");
    expect(resume.examEquivalenceGate).toBe(false);
    expect(resume.claimBoundary).toBe(examRunLedgerClaimBoundary);
    expect(resume.notEvidenceFor).toEqual(examRunLedgerNotEvidenceFor);
  });

  it("wires the ledger through exam persistence without replacing station repositories", () => {
    expect(createMongoExamPersistence).toBeTypeOf("function");
  });

  it("persists immutable form identity and ordered station queue idempotently", async () => {
    const ledger = createExamRunLedger();
    const first = await ledger.openExamRun(openInput());
    const second = await ledger.openExamRun(openInput());
    expect(first).toEqual(second);
    const resume = await ledger.resume(examRunId);
    expect(resume.formIdentity).toEqual({
      examRunId,
      examFormId: "form_ledger_001",
      blueprintId: "blueprint_step2cs_style_seed_v1",
    });
    expect(resume.orderedStations.map((station) => station.stationRunId)).toEqual([stationA, stationB]);
  });

  it("rejects identity or queue mutation on the same examRunId", async () => {
    const ledger = await openFreshLedger();
    await expect(
      ledger.openExamRun(openInput({ examFormId: "form_other" })),
    ).rejects.toThrow(/identity is immutable/);
    await expect(
      ledger.openExamRun(
        openInput({
          stations: [
            {
              stationOrder: 0,
              slotId: "slot_a",
              stationRunId: "run_station_hijack",
              scenarioId: "ed_chest_pain_priority_v1",
              scenarioVersion: 1,
            },
          ],
        }),
      ),
    ).rejects.toThrow(/station queue is immutable/);
  });

  it("admits canonical phase events idempotently and rejects stale-sequence plus cross-run writes", async () => {
    const ledger = await openFreshLedger();
    const admission = {
      examRunId,
      stationRunId: stationA,
      sequence: 0,
      eventType: "station.phase.doorway",
      atSecond: 0,
      source: "system",
      phase: "doorway" as const,
    };
    const first = await ledger.admitCanonicalPhaseEvent(admission);
    const second = await ledger.admitCanonicalPhaseEvent(admission);
    expect(first).toEqual(second);
    expect(first.durableEventRef).toBe(`durable://station-runs/${stationA}/events/0`);

    await expect(
      ledger.admitCanonicalPhaseEvent({ ...admission, eventType: "station.phase.encounter", phase: "encounter" }),
    ).rejects.toThrow(/stale-sequence contamination/);

    await ledger.openExamRun(
      openInput({
        examRunId: "exam_run_other",
        examFormId: "form_other",
        stations: [
          {
            stationOrder: 0,
            slotId: "slot_other",
            stationRunId: "run_station_other",
            scenarioId: "ed_chest_pain_priority_v1",
            scenarioVersion: 1,
          },
        ],
      }),
    );
    await expect(
      ledger.admitCanonicalPhaseEvent({ ...admission, examRunId: "exam_run_other", stationRunId: stationA }),
    ).rejects.toThrow(/cross-run contamination/);

    await expect(
      ledger.admitCanonicalPhaseEvent({ ...admission, stationRunId: "run_unbound" }),
    ).rejects.toThrow(/cross-run contamination/);
  });

  it("submits patient notes idempotently and rejects empty or contaminated notes", async () => {
    const ledger = await openFreshLedger();
    const note = {
      examRunId,
      stationRunId: stationA,
      submittedAtSecond: 1260,
      text: "Concern for ACS. ECG requested.",
    };
    expect(await ledger.submitPatientNote(note)).toEqual(await ledger.submitPatientNote(note));
    await expect(ledger.submitPatientNote({ ...note, text: "Different note" })).rejects.toThrow(
      /stale-sequence contamination/,
    );
    await expect(ledger.submitPatientNote({ ...note, text: "" })).rejects.toThrow(/Invalid patient note/);
    await ledger.openExamRun(
      openInput({
        examRunId: "exam_run_other",
        examFormId: "form_other",
        stations: [
          {
            stationOrder: 0,
            slotId: "slot_other",
            stationRunId: "run_station_other",
            scenarioId: "ed_chest_pain_priority_v1",
            scenarioVersion: 1,
          },
        ],
      }),
    );
    await expect(
      ledger.submitPatientNote({ ...note, examRunId: "exam_run_other" }),
    ).rejects.toThrow(/cross-run contamination/);
  });

  it("records actor plan/execution provenance under durable refs and rejects rewrites", async () => {
    const ledger = await openFreshLedger();
    const provenance = {
      examRunId,
      stationRunId: stationA,
      turnId: "turn_1_patient_120",
      actorId: "patient_robert_hayes_v1",
      planId: "plan_1",
      sequence: 4,
      hasPlan: true,
      hasExecution: true,
    };
    const first = await ledger.recordActorPlanExecutionProvenance(provenance);
    expect(first.durableEventRef).toBe(`durable://station-runs/${stationA}/events/4`);
    expect(await ledger.recordActorPlanExecutionProvenance(provenance)).toEqual(first);
    await expect(
      ledger.recordActorPlanExecutionProvenance({ ...provenance, planId: "plan_other" }),
    ).rejects.toThrow(/stale-sequence contamination/);
    await expect(
      ledger.recordActorPlanExecutionProvenance({ ...provenance, hasPlan: false, hasExecution: false }),
    ).rejects.toThrow(/hasPlan or hasExecution/);
  });

  it("attaches assembled review packet references after validating the packet", async () => {
    const ledger = await openFreshLedger();
    const packet = reviewPacket(stationA);
    const first = await ledger.attachReviewPacketReference(examRunId, packet);
    const second = await ledger.attachReviewPacketReference(examRunId, packet);
    expect(first).toEqual({ examRunId, stationRunId: stationA });
    expect(second).toEqual(first);
    await expect(
      ledger.attachReviewPacketReference(examRunId, reviewPacket("run_unbound")),
    ).rejects.toThrow(/cross-run contamination/);
  });

  it("restores a deterministic resume projection with explicit omissions", async () => {
    const ledger = await openFreshLedger();
    await ledger.admitCanonicalPhaseEvent({
      examRunId,
      stationRunId: stationA,
      sequence: 0,
      eventType: "station.phase.doorway",
      atSecond: 0,
      source: "system",
      phase: "doorway",
    });
    await ledger.admitCanonicalPhaseEvent({
      examRunId,
      stationRunId: stationA,
      sequence: 2,
      eventType: "station.phase.note",
      atSecond: 900,
      source: "system",
      phase: "note",
    });
    await ledger.submitPatientNote({
      examRunId,
      stationRunId: stationA,
      submittedAtSecond: 1260,
      text: "Concern for ACS. ECG requested.",
    });
    await ledger.recordActorPlanExecutionProvenance({
      examRunId,
      stationRunId: stationA,
      turnId: "turn_1_patient_120",
      actorId: "patient_robert_hayes_v1",
      planId: "plan_1",
      sequence: 4,
      hasPlan: true,
      hasExecution: false,
    });
    await ledger.attachReviewPacketReference(examRunId, reviewPacket(stationA));

    const resume = await ledger.resume(examRunId);
    expect(resume.orderedStations.map((station) => station.stationOrder)).toEqual([0, 1]);
    expect(resume.admittedPhaseEvents.map((event) => event.sequence)).toEqual([0, 2]);
    expect(resume.omissions).toEqual([
      {
        kind: "phase_sequence_gap",
        stationRunId: stationA,
        stationOrder: 0,
        reason: "missing sequences 1",
      },
      {
        kind: "missing_phase_events",
        stationRunId: stationB,
        stationOrder: 1,
        reason: "no canonical phase events admitted",
      },
      {
        kind: "missing_patient_note",
        stationRunId: stationB,
        stationOrder: 1,
        reason: "no patient-note submission admitted",
      },
      {
        kind: "missing_actor_provenance",
        stationRunId: stationB,
        stationOrder: 1,
        reason: "no actor plan/execution provenance admitted",
      },
      {
        kind: "missing_review_packet_ref",
        stationRunId: stationB,
        stationOrder: 1,
        reason: "no assembled review packet reference attached",
      },
    ]);
    expect(resume.omissions.some((omission) => omission.stationRunId === stationA && omission.kind === "missing_patient_note")).toBe(
      false,
    );
  });

  it("does not invent a resume for an unknown examRunId", async () => {
    const ledger = createExamRunLedger();
    await expect(ledger.resume("exam_run_missing")).rejects.toThrow(/exam run not found/);
  });
});
