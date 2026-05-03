import { describe, expect, it } from "vitest";
import { validateActorCard, validatePatientNote, validateReviewPacket, validateScenario, validateTraceEvent } from "./index.js";

describe("OpenClinXR shared schemas", () => {
  it("accepts a reviewed ED chest pain scenario shape", () => {
    const result = validateScenario({
      scenarioId: "ed_chest_pain_priority_v1",
      version: 1,
      title: "ED Chest Pain With Nurse Interruption",
      status: "approved",
      review: {
        clinical: "approved",
        psychometric: "approved",
        legal: "approved",
        simulationQa: "approved",
      },
      clinicalObjectives: ["Recognize possible ACS", "Escalate care"],
      actors: [{ actorId: "patient_robert_hayes_v1", role: "patient", displayName: "Robert Hayes" }],
      requiredTraceTags: ["ecg_request"],
      eventSchedule: [{ eventId: "nurse_vitals_change", atSecond: 420, actorId: "nurse_maria_alvarez_v1", tag: "vitals_review" }],
      reviewRubric: [{ rubricId: "urgent_recognition", label: "Urgent recognition", requiredTraceTags: ["ecg_request"] }],
      governance: {
        scoreUseLabel: "formative_local_only",
        syntheticCaseDisclosure: "Synthetic training case for local formative review only.",
        validationStage: "stage_1_expert_reviewed",
        validationLimitations: ["No outcomes validity evidence yet."],
        requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
        sourceIds: ["src-step2cs-public-archive"],
        safetyCriticalTraceTags: ["ecg_request"],
        hiddenFactPolicy: {
          learnerView: "redact_hidden_facts",
          disclosureRequiresTrigger: true,
        },
      },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects summative score-use claims before validation evidence exists", () => {
    const result = validateScenario({
      scenarioId: "overclaimed_station",
      version: 1,
      title: "Overclaimed Station",
      status: "approved",
      review: {
        clinical: "approved",
        psychometric: "approved",
        legal: "approved",
        simulationQa: "approved",
      },
      clinicalObjectives: ["Assess something"],
      actors: [{ actorId: "patient_001", role: "patient", displayName: "Patient" }],
      requiredTraceTags: ["safety_plan"],
      eventSchedule: [],
      reviewRubric: [{ rubricId: "safety", label: "Safety", requiredTraceTags: ["safety_plan"] }],
      governance: {
        scoreUseLabel: "validated_summative",
        syntheticCaseDisclosure: "Synthetic case.",
        validationStage: "stage_1_expert_reviewed",
        validationLimitations: ["No generalizability or consequence evidence yet."],
        requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
        sourceIds: ["src-example"],
        safetyCriticalTraceTags: ["safety_plan"],
        hiddenFactPolicy: {
          learnerView: "redact_hidden_facts",
          disclosureRequiresTrigger: true,
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: ["validated summative score use requires stage_3_validated governance evidence"],
    });
  });

  it("rejects scenario publication without all approval gates", () => {
    const result = validateScenario({
      scenarioId: "draft_station",
      version: 1,
      title: "Draft Station",
      status: "approved",
      review: {
        clinical: "approved",
        psychometric: "draft",
        legal: "approved",
        simulationQa: "approved",
      },
      clinicalObjectives: [],
      actors: [],
      requiredTraceTags: [],
      eventSchedule: [],
      reviewRubric: [],
    });

    expect(result.ok).toBe(false);
  });

  it("rejects trace events without sequence numbers", () => {
    const result = validateTraceEvent({
      stationRunId: "run_001",
      eventType: "station.started",
      occurredAt: "2026-05-03T00:00:00.000Z",
      source: "system",
      payload: {},
    });

    expect(result.ok).toBe(false);
  });

  it("validates actor cards, patient notes, and review packets", () => {
    expect(validateActorCard({ actorId: "nurse_maria_alvarez_v1", role: "nurse", displayName: "Maria Alvarez" }).ok).toBe(true);
    expect(validatePatientNote({ stationRunId: "run_001", submittedAtSecond: 1260, text: "Concern for ACS. ECG requested." }).ok).toBe(true);
    expect(
      validateReviewPacket({
        stationRunId: "run_001",
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
          blockedGuardrailCount: 0,
          unsafeEventCount: 0,
          missingRequiredTraceTagCount: 0,
          hasPatientNote: false,
          hasModelProvenance: false,
        },
        facultyScoreDraft: { reviewerId: "faculty_001", status: "draft", comments: "Good escalation." },
      }).ok,
    ).toBe(true);
  });

  it("requires review packets to include replay timeline and trace quality evidence", () => {
    expect(
      validateReviewPacket({
        stationRunId: "run_001",
        scenarioId: "ed_chest_pain_priority_v1",
        observedTraceTags: ["ecg_request"],
        missingRequiredTraceTags: [],
        lateTraceTags: [],
        unsafeEvents: [],
        facultyScoreDraft: { reviewerId: "faculty_001", status: "draft", comments: "Missing replay evidence." },
      }).ok,
    ).toBe(false);
  });
});
