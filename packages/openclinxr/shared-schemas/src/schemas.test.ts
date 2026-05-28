import { describe, expect, it } from "vitest";
import {
  validateActorCard,
  validateAssetManifest,
  validateCommunicationProfile,
  validateDynamicEncounterFactoryPlanningProjection,
  validateDynamicEncounterFactoryProjectionArtifact,
  validateEnvironmentManifest,
  validateExamBlueprint,
  validateModelProviderAudit,
  validatePatientNote,
  validateProviderAuditRecord,
  validateProviderHealth,
  validateReviewPacket,
  validateScenario,
  validateSharedAssetLibraryReuse,
  validateStationRun,
  validateTraceEvent,
  validateVoiceProviderAudit,
} from "./index.js";

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

  it("validates clinical skills exam blueprints with timing and station slots", () => {
    expect(
      validateExamBlueprint({
        blueprintId: "blueprint_openclinxr_clinical_skills_pilot_v1",
        title: "OpenClinXR Clinical Skills Pilot",
        stationSlots: [
          {
            slotId: "station_001_ed_urgent_recognition",
            order: 1,
            label: "Emergency department urgent recognition and communication",
            requiredEnvironmentIds: ["ed_exam_bay_v1"],
            requiredTraceTags: ["ecg_request"],
          },
        ],
        timing: {
          doorwaySeconds: 60,
          encounterSeconds: 900,
          noteSeconds: 600,
          breakAfterStationOrders: [3, 6, 9],
        },
        requiredTraceTags: ["ecg_request"],
        requiredSafetyCriticalTraceTags: ["ecg_request"],
      }).ok,
    ).toBe(true);

    expect(
      validateExamBlueprint({
        blueprintId: "blueprint_openclinxr_clinical_skills_pilot_v1",
        title: "OpenClinXR Clinical Skills Pilot",
        stationSlots: [],
        timing: {
          doorwaySeconds: 60,
          encounterSeconds: 900,
          noteSeconds: 600,
          breakAfterStationOrders: [0],
        },
        requiredTraceTags: ["ecg_request"],
        requiredSafetyCriticalTraceTags: ["ecg_request"],
      }).ok,
    ).toBe(false);
  });

  it("validates environment manifests from scenario environment, equipment, and asset needs", () => {
    expect(
      validateEnvironmentManifest({
        environment: {
          environmentId: "ed_exam_bay_v1",
          name: "ED exam bay",
          description: "Emergency department exam bay with stretcher, monitor, ECG cart, and IV stand.",
        },
        equipment: ["stretcher", "bedside monitor", "ECG cart", "IV stand"],
        assetNeeds: [
          {
            assetId: "ed_exam_bay_environment",
            assetType: "environment",
            description: "Quest-budgeted ED bay placeholder.",
            licenseStatus: "approved",
          },
        ],
      }).ok,
    ).toBe(true);

    expect(
      validateEnvironmentManifest({
        environment: {
          environmentId: "ed_exam_bay_v1",
          name: "ED exam bay",
          description: "Emergency department exam bay.",
        },
        equipment: [],
        assetNeeds: [],
      }).ok,
    ).toBe(false);

    expect(
      validateEnvironmentManifest({
        environment: {
          environmentId: "ed_exam_bay_v1",
          name: "ED exam bay",
          description: "Emergency department exam bay.",
        },
        equipment: ["stretcher"],
        assetNeeds: [
          {
            assetId: "unbounded_asset_need",
            assetType: "spreadsheet",
            description: "Invalid asset kind.",
            licenseStatus: "approved",
          },
        ],
      }).ok,
    ).toBe(false);
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

  it("rejects blank scenario trace-governance tags", () => {
    const result = validateScenario({
      scenarioId: "blank_trace_tag_station",
      version: 1,
      title: "Blank Trace Tag Station",
      status: "approved",
      review: {
        clinical: "approved",
        psychometric: "approved",
        legal: "approved",
        simulationQa: "approved",
      },
      clinicalObjectives: ["Assess something"],
      actors: [{ actorId: "patient_001", role: "patient", displayName: "Patient" }],
      requiredTraceTags: ["safety_plan", " "],
      eventSchedule: [],
      reviewRubric: [{ rubricId: "safety", label: "Safety", requiredTraceTags: ["safety_plan"] }],
      governance: {
        scoreUseLabel: "formative_local_only",
        syntheticCaseDisclosure: "Synthetic case.",
        validationStage: "stage_1_expert_reviewed",
        validationLimitations: ["No generalizability or consequence evidence yet."],
        requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
        sourceIds: ["src-example"],
        safetyCriticalTraceTags: [" "],
        hiddenFactPolicy: {
          learnerView: "redact_hidden_facts",
          disclosureRequiresTrigger: true,
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        "scenario requiredTraceTags cannot contain blank tags",
        "scenario safetyCriticalTraceTags cannot contain blank tags",
      ],
    });
  });

  it("validates asset manifests with license, Quest QA, and optimization targets", () => {
    expect(
      validateAssetManifest({
        assetId: "patient_robert_hayes_character",
        scenarioId: "ed_chest_pain_priority_v1",
        kind: "character",
        displayName: "Robert Hayes patient character",
        description: "Placeholder patient character.",
        requiredForScenario: true,
        targetRuntime: "quest3_webxr",
        provenance: {
          generationMethod: "procedural_placeholder",
          sourceRefs: ["openclinxr-placeholder-mesh"],
          licenseStatus: "approved",
        },
        questQaStatus: {
          status: "placeholder_dev_ready",
          reviewedAt: "2026-05-03T16:15:00.000Z",
          limitations: ["Placeholder asset only."],
        },
        geometryBudget: {
          maxTriangles: 18000,
          maxTextureMegabytes: 24,
          maxDrawCalls: 8,
        },
        pipelineStages: [
          {
            stage: "qa_ready",
            completedAt: "2026-05-03T16:15:00.000Z",
            notes: "Ready for deterministic runtime tests.",
          },
        ],
        tags: ["patient"],
      }).ok,
    ).toBe(true);
  });

  it("rejects asset manifests without license status or optimization targets", () => {
    expect(
      validateAssetManifest({
        assetId: "patient_robert_hayes_character",
        scenarioId: "ed_chest_pain_priority_v1",
        kind: "character",
        displayName: "Robert Hayes patient character",
        description: "Placeholder patient character.",
        requiredForScenario: true,
        targetRuntime: "quest3_webxr",
        provenance: {
          generationMethod: "procedural_placeholder",
          sourceRefs: ["openclinxr-placeholder-mesh"],
        },
        questQaStatus: {
          status: "placeholder_dev_ready",
          reviewedAt: "2026-05-03T16:15:00.000Z",
          limitations: ["Placeholder asset only."],
        },
        pipelineStages: [
          {
            stage: "qa_ready",
            completedAt: "2026-05-03T16:15:00.000Z",
            notes: "Ready for deterministic runtime tests.",
          },
        ],
        tags: ["patient"],
      }).ok,
    ).toBe(false);
  });

  it("rejects asset manifests with whitespace-only provenance and evidence fields", () => {
    const result = validateAssetManifest({
      assetId: " ",
      scenarioId: "ed_chest_pain_priority_v1",
      kind: "character",
      displayName: "Robert Hayes patient character",
      description: "Placeholder patient character.",
      requiredForScenario: true,
      targetRuntime: "quest3_webxr",
      provenance: {
        generationMethod: "procedural_placeholder",
        sourceRefs: ["openclinxr-placeholder-mesh", " "],
        licenseStatus: "approved",
      },
      generationEvidence: {
        generatedHumanRiggingReportId: " ",
      },
      optimizationEvidence: {
        lodTiers: ["lod0", " "],
        textureCompressionFormat: " ",
      },
      questQaStatus: {
        status: "placeholder_dev_ready",
        reviewedAt: "2026-05-03T16:15:00.000Z",
        limitations: ["Placeholder asset only.", " "],
      },
      geometryBudget: {
        maxTriangles: 18000,
        maxTextureMegabytes: 24,
        maxDrawCalls: 8,
      },
      pipelineStages: [
        {
          stage: "qa_ready",
          completedAt: "2026-05-03T16:15:00.000Z",
          notes: " ",
        },
      ],
      tags: ["patient", " "],
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        "asset manifest assetId is required",
        "asset manifest provenance sourceRefs cannot contain blank refs",
        "asset manifest Quest QA limitations cannot contain blank entries",
        "asset manifest pipeline stage notes cannot be blank",
        "asset manifest tags cannot contain blank tags",
        "asset manifest generation evidence fields must be nonblank: generatedHumanRiggingReportId",
        "asset manifest optimization evidence lodTiers cannot contain blank tiers",
        "asset manifest optimization evidence fields must be nonblank: textureCompressionFormat",
      ],
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

  it("rejects trace events with whitespace-only identity fields", () => {
    expect(validateTraceEvent({
      stationRunId: " ",
      sequence: 0,
      eventType: " ",
      occurredAt: "2026-05-03T00:00:00.000Z",
      atSecond: 0,
      source: " ",
      actorId: " ",
      tag: " ",
      payload: {},
    })).toEqual({
      ok: false,
      errors: [
        "trace event stationRunId is required",
        "trace event eventType is required",
        "trace event source is required",
        "trace event actorId cannot be blank",
        "trace event tag cannot be blank",
      ],
    });
  });

  it("validates durable trace event refs against station run and sequence", () => {
    expect(validateTraceEvent({
      stationRunId: "run_001",
      sequence: 4,
      eventType: "actor.response.generated",
      occurredAt: "2026-05-03T00:00:00.000Z",
      atSecond: 120,
      source: "model-gateway",
      payload: {
        durableEventRef: "durable://station-runs/run_001/events/4",
      },
    })).toEqual({ ok: true });

    expect(validateTraceEvent({
      stationRunId: "run_001",
      sequence: 4,
      eventType: "actor.response.generated",
      occurredAt: "2026-05-03T00:00:00.000Z",
      atSecond: 120,
      source: "model-gateway",
      payload: {
        durableEventRef: "durable://station-runs/other_run/events/4",
      },
    })).toEqual({
      ok: false,
      errors: ["trace event payload durableEventRef must match durable://station-runs/run_001/events/4"],
    });
  });

  it("validates station runs through doorway, encounter, note, and review phases", () => {
    expect(
      validateStationRun({
        stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
        scenarioId: "ed_chest_pain_priority_v1",
        learnerId: "learner_001",
        phase: "review",
        startedAtSecond: 0,
        encounterStartedAtSecond: 60,
        encounterEndedAtSecond: 960,
        note: {
          stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
          submittedAtSecond: 1260,
          text: "Concern for ACS. ECG requested.",
        },
      }).ok,
    ).toBe(true);

    expect(
      validateStationRun({
        stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
        scenarioId: "ed_chest_pain_priority_v1",
        learnerId: "learner_001",
        phase: "scoring",
        startedAtSecond: 0,
      }).ok,
    ).toBe(false);

    expect(
      validateStationRun({
        stationRunId: "run_ed_chest_pain_priority_v1_learner_001",
        scenarioId: "ed_chest_pain_priority_v1",
        learnerId: "learner_001",
        phase: "review",
        startedAtSecond: 0,
        note: {
          stationRunId: "run_other_station",
          submittedAtSecond: 1260,
          text: "Concern for ACS. ECG requested.",
        },
      }).ok,
    ).toBe(false);
  });

  it("validates actor cards, patient notes, and review packets", () => {
    const communicationProfile = {
      styleFamily: "satir",
      style: "accuser",
      intensity: 0.65,
      baselineMood: ["frustrated", "wary", "vulnerable"],
      communicativeness: "Open about physical symptoms; guarded about emotional stress.",
      topicsToAvoid: ["dismissal_of_pain"],
      adverseResponse: "Raises voice slightly when feeling dismissed.",
      deescalationTriggers: ["emotion_acknowledged", "clear_next_step"],
      escalationTriggers: ["ignored_emotion", "premature_reassurance"],
      culturalLanguageNotes: ["plain English", "avoid caricature"],
    };

    expect(validateCommunicationProfile(communicationProfile).ok).toBe(true);
    expect(validateCommunicationProfile({ ...communicationProfile, intensity: 1.5 }).ok).toBe(false);
    expect(validateActorCard({
      actorId: "nurse_maria_alvarez_v1",
      role: "nurse",
      displayName: "Maria Alvarez",
      communicationProfile,
    }).ok).toBe(true);
    expect(validateActorCard({ actorId: "neurology_consultant_phone_v1", role: "consultant", displayName: "Neurology Consultant" }).ok).toBe(true);
    expect(validateActorCard({ actorId: "remote_interpreter_tablet_v1", role: "interpreter", displayName: "Remote Interpreter" }).ok).toBe(true);
    expect(validateActorCard({ actorId: "medical_assistant_jones_v1", role: "medical_assistant", displayName: "Medical Assistant Jones" }).ok).toBe(true);
    expect(validateActorCard({ actorId: "respiratory_therapist_ng_v1", role: "respiratory_therapist", displayName: "Respiratory Therapist Ng" }).ok).toBe(true);
    expect(validatePatientNote({ stationRunId: "run_001", submittedAtSecond: 1260, text: "Concern for ACS. ECG requested." }).ok).toBe(true);
    expect(validatePatientNote({ stationRunId: " ", submittedAtSecond: 1260, text: " " })).toEqual({
      ok: false,
      errors: ["patient note stationRunId is required", "patient note text is required"],
    });
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
          modelFailedEventCount: 0,
          voiceAudioEventCount: 0,
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

  it("requires review-packet patient notes and faculty drafts to match review identity", () => {
    const packet = {
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
        modelFailedEventCount: 0,
        voiceAudioEventCount: 0,
        blockedGuardrailCount: 0,
        unsafeEventCount: 0,
        missingRequiredTraceTagCount: 0,
        hasPatientNote: true,
        hasModelProvenance: false,
      },
      patientNote: {
        stationRunId: "run_002",
        submittedAtSecond: 1260,
        text: "Concern for ACS.",
      },
      facultyScoreDraft: { reviewerId: "faculty_001", status: "draft", comments: "Review patient note." },
    };

    expect(validateReviewPacket(packet)).toEqual({
      ok: false,
      errors: ["review packet patient note must belong to the same stationRunId"],
    });
    expect(validateReviewPacket({
      ...packet,
      patientNote: { ...packet.patientNote, stationRunId: "run_001" },
      facultyScoreDraft: { ...packet.facultyScoreDraft, reviewerId: "   " },
    })).toEqual({
      ok: false,
      errors: ["review packet faculty score draft requires reviewer identity"],
    });
    expect(validateReviewPacket({
      ...packet,
      patientNote: { ...packet.patientNote, stationRunId: "run_001", text: " " },
    })).toEqual({
      ok: false,
      errors: ["patient note text is required"],
    });
  });

  it("requires review-packet trace-quality counters to match packet evidence", () => {
    const packet = {
      stationRunId: "run_001",
      scenarioId: "ed_chest_pain_priority_v1",
      observedTraceTags: ["ecg_request"],
      missingRequiredTraceTags: [],
      lateTraceTags: [],
      unsafeEvents: ["unsafe.timeout"],
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
        eventCount: 2,
        modelGeneratedEventCount: 0,
        modelFailedEventCount: 0,
        voiceAudioEventCount: 0,
        blockedGuardrailCount: 0,
        unsafeEventCount: 0,
        missingRequiredTraceTagCount: 1,
        hasPatientNote: true,
        hasModelProvenance: false,
      },
      facultyScoreDraft: { reviewerId: "faculty_001", status: "draft", comments: "Review trace quality." },
    };

    expect(validateReviewPacket(packet)).toEqual({
      ok: false,
      errors: [
        "review packet traceQuality.eventCount must match timeline length",
        "review packet traceQuality.unsafeEventCount must match unsafeEvents length",
        "review packet traceQuality.missingRequiredTraceTagCount must match missingRequiredTraceTags length",
        "review packet traceQuality.hasPatientNote must match patientNote presence",
      ],
    });
  });

  it("requires review-packet replay timeline sequence values to be unique", () => {
    expect(validateReviewPacket({
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
        {
          sequence: 0,
          atSecond: 5,
          eventType: "learner.order",
          source: "learner",
          tag: "ecg_request",
          summary: "learner order recorded",
        },
      ],
      traceQuality: {
        eventCount: 2,
        modelGeneratedEventCount: 0,
        modelFailedEventCount: 0,
        voiceAudioEventCount: 0,
        blockedGuardrailCount: 0,
        unsafeEventCount: 0,
        missingRequiredTraceTagCount: 0,
        hasPatientNote: false,
        hasModelProvenance: false,
      },
      facultyScoreDraft: { reviewerId: "faculty_001", status: "draft", comments: "Review duplicate sequence." },
    })).toEqual({
      ok: false,
      errors: ["review packet timeline sequence values must be unique for deterministic replay"],
    });
  });

  it("requires review-packet provider trace-quality counters to match timeline events", () => {
    const packet = {
      stationRunId: "run_001",
      scenarioId: "ed_chest_pain_priority_v1",
      observedTraceTags: [],
      missingRequiredTraceTags: [],
      lateTraceTags: [],
      unsafeEvents: [],
      timeline: [
        {
          sequence: 0,
          atSecond: 120,
          eventType: "actor.response.generated",
          source: "model-gateway",
          summary: "patient response generated",
        },
        {
          sequence: 1,
          atSecond: 121,
          eventType: "actor.response.failed",
          source: "model-gateway",
          summary: "patient response failed",
        },
        {
          sequence: 2,
          atSecond: 122,
          eventType: "voice.audio.generated",
          source: "voice-gateway",
          summary: "patient voice generated",
        },
      ],
      traceQuality: {
        eventCount: 3,
        modelGeneratedEventCount: 0,
        modelFailedEventCount: 0,
        voiceAudioEventCount: 0,
        blockedGuardrailCount: 0,
        unsafeEventCount: 0,
        missingRequiredTraceTagCount: 0,
        hasPatientNote: false,
        hasModelProvenance: false,
      },
      facultyScoreDraft: { reviewerId: "faculty_001", status: "draft", comments: "Review provider evidence." },
    };

    expect(validateReviewPacket(packet)).toEqual({
      ok: false,
      errors: [
        "review packet traceQuality.modelGeneratedEventCount must match actor.response.generated timeline events",
        "review packet traceQuality.modelFailedEventCount must match actor.response.failed timeline events",
        "review packet traceQuality.voiceAudioEventCount must match voice.audio.generated timeline events",
      ],
    });
  });

  it("validates shared asset library reuse envelope", () => {
    expect(
      validateSharedAssetLibraryReuse({
        lookupKey: "semantic::environment::ed_chest_pain_priority_v1",
        lookupKeySource: "encounter_definition_semantic_requirements",
        cacheDisposition: "lookup_before_generate",
        sharedLibraryRefs: {
          blobPrefix: "shared-assets/envs",
          mongooseCollectionName: "shared_encounter_asset_library",
        },
        lruCache: {
          enabled: true,
          maxEntries: 16,
          evictionPolicy: "least_recently_used",
          reuseRequiresEvidenceGateCompatibility: true,
          updateRecencyOnHit: true,
        },
      }).ok,
    ).toBe(true);

    expect(
      validateSharedAssetLibraryReuse({
        lookupKey: "semantic::environment::ed_chest_pain_priority_v1",
        lookupKeySource: "invalid_source",
        cacheDisposition: "lookup_before_generate",
        sharedLibraryRefs: {
          blobPrefix: "shared-assets/envs",
          mongooseCollectionName: "shared_encounter_asset_library",
        },
        lruCache: {
          enabled: true,
          maxEntries: 16,
          evictionPolicy: "least_recently_used",
          reuseRequiresEvidenceGateCompatibility: true,
          updateRecencyOnHit: true,
        },
      }).ok,
    ).toBe(false);
  });

  it("validates dynamic encounter factory planning projection envelopes", () => {
    expect(
      validateDynamicEncounterFactoryPlanningProjection({
        source: "scenario_bank_dynamic_encounter_factory_planning",
        claimBoundary: "review_gated_factory_metadata_only",
        anchorScenarioId: "ed_chest_pain_priority_v1",
        nextFactoryPlanningScenarioId: "clinic_abdominal_pain_interpreter_v1",
        nextFactoryPlanningScenarioSelectionMode: "approved_encounter_variant",
        learnerUseBoundary: "activation_ready_only",
        scenarios: [
          {
            factoryPlanningOrder: 2,
            scenarioId: "peds_asthma_parent_anxiety_v1",
            title: "Pediatric Asthma With Parent Anxiety",
            status: "draft",
            validationStage: "stage_0_synthetic_draft",
            actorRoles: ["family", "nurse", "patient"],
            actorCount: 3,
            multiActorReady: true,
            dialogueSeedCount: 4,
            dialogueSeedReady: true,
            traceabilityReady: true,
            requiredTraceTagCount: 9,
            eventScheduleCount: 1,
            environmentId: "pediatric_urgent_care_bay_v1",
            equipmentCount: 6,
            assetNeedTypes: ["character", "environment", "equipment"],
            factoryPlanningMetadataComplete: true,
            factoryPlanningMetadataBlockers: [],
            encounterFactoryInputSummary: {
              source: "scenario_definition_and_dialogue_seed_bank",
              scenarioBankOrder: 2,
              factorySelectionRole: "next_factory_planning_scenario",
              factorySelectionMode: "approved_encounter_variant",
              factorySelectionClaimBoundary: "review_gated_factory_metadata_only",
              actorAssetWorkOrderCount: 3,
              environmentAssetWorkOrderCount: 1,
              equipmentAssetWorkOrderCount: 6,
              sharedAssetLookupKeys: [
                "semantic::actor::family::parent_tara_johnson_v1",
                "semantic::actor::nurse::nurse_kevin_lee_v1",
                "semantic::actor::patient::patient_maya_johnson_v1",
                "semantic::environment::pediatric_urgent_care_bay_v1",
                "semantic::equipment::nebulizer_mask",
              ],
              dynamicBehaviorTraceTags: ["oxygen_request", "parent_communication", "urgent_escalation"],
            },
            safetyCriticalTraceTagCount: 2,
            rubricCount: 4,
            requiredReviewerRoleCount: 4,
            activationEligible: false,
            learnerUseBoundary: "draft_review_required",
            reviewBlockers: ["scenario_status:draft"],
            recommendedNextAction: "complete_required_review_gates",
          },
        ],
      }).ok,
    ).toBe(true);

    expect(
      validateDynamicEncounterFactoryPlanningProjection({
        source: "scenario_bank_dynamic_encounter_factory_planning",
        claimBoundary: "review_gated_factory_metadata_only",
        anchorScenarioId: "ed_chest_pain_priority_v1",
        nextFactoryPlanningScenarioId: "clinic_abdominal_pain_interpreter_v1",
        nextFactoryPlanningScenarioSelectionMode: "approved_encounter_variant",
        learnerUseBoundary: "activation_ready_only",
      }).ok,
    ).toBe(false);
  });

  it("validates dynamic encounter factory projection artifact slices", () => {
    expect(
      validateDynamicEncounterFactoryProjectionArtifact({
        schemaVersion: "openclinxr.dynamic-encounter-factory-projection-artifact.v1",
        source: "scenario_bank_dynamic_encounter_factory_projection_artifact",
        claimBoundary: "review_gated_factory_metadata_only",
        anchorScenarioId: "ed_chest_pain_priority_v1",
        nextFactoryPlanningScenarioId: "ed_chest_pain_priority_v2",
        nextFactoryPlanningScenarioSelectionMode: "approved_encounter_variant",
        learnerUseBoundary: "activation_ready_only",
        scenarioBankSlice: [
          {
            scenarioId: "ed_chest_pain_priority_v1",
            version: 1,
            title: "ED Chest Pain",
            status: "approved",
            review: {
              clinical: "approved",
              psychometric: "approved",
              legal: "approved",
              simulationQa: "approved",
            },
            clinicalObjectives: ["Recognize chest pain"],
            actors: [{
              actorId: "patient_robert_hayes_v1",
              role: "patient",
              displayName: "Robert Hayes",
              communicationProfile: {
                styleFamily: "satir",
                style: "withdrawn_guarded",
                intensity: 0.55,
                baselineMood: ["anxious"],
                communicativeness: "Anxious, short responses",
                topicsToAvoid: ["premature_reassurance"],
                adverseResponse: "Withdraws",
                deescalationTriggers: ["validation"],
                escalationTriggers: ["silence"],
                culturalLanguageNotes: ["plain language"],
              },
            }],
            requiredTraceTags: ["ecg_request"],
            eventSchedule: [
              {
                eventId: "vitals_change",
                atSecond: 420,
                actorId: "patient_robert_hayes_v1",
                tag: "vitals_review",
              },
            ],
            reviewRubric: [{
              rubricId: "urgent_recognition",
              label: "Urgent recognition",
              requiredTraceTags: ["ecg_request"],
            }],
            governance: {
              scoreUseLabel: "formative_local_only",
              syntheticCaseDisclosure: "Synthetic sample",
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
            environment: {
              environmentId: "ed_exam_bay_v1",
              name: "Exam Bay",
              description: "A sample emergency department exam bay setup.",
            },
            equipment: ["ecg machine"],
            assetNeeds: [{
              assetId: "asset_v1",
              assetType: "environment",
              description: "Exam bay environment",
              licenseStatus: "approved",
            }],
          },
        ],
      }).ok,
    ).toBe(true);

    expect(
      validateDynamicEncounterFactoryProjectionArtifact({
        schemaVersion: "openclinxr.dynamic-encounter-factory-projection-artifact.v1",
        source: "scenario_bank_dynamic_encounter_factory_projection_artifact",
        claimBoundary: "review_gated_factory_metadata_only",
        anchorScenarioId: "ed_chest_pain_priority_v1",
        nextFactoryPlanningScenarioSelectionMode: "approved_encounter_variant",
        learnerUseBoundary: "activation_ready_only",
        nextFactoryPlanningScenarioId: "ed_chest_pain_priority_v2",
      }).ok,
    ).toBe(false);
  });

  it("does not allow model provenance to be claimed without model-generated events", () => {
    expect(validateReviewPacket({
      stationRunId: "run_001",
      scenarioId: "ed_chest_pain_priority_v1",
      observedTraceTags: [],
      missingRequiredTraceTags: [],
      lateTraceTags: [],
      unsafeEvents: [],
      timeline: [],
      traceQuality: {
        eventCount: 0,
        modelGeneratedEventCount: 0,
        modelFailedEventCount: 0,
        voiceAudioEventCount: 0,
        blockedGuardrailCount: 0,
        unsafeEventCount: 0,
        missingRequiredTraceTagCount: 0,
        hasPatientNote: false,
        hasModelProvenance: true,
      },
      facultyScoreDraft: { reviewerId: "faculty_001", status: "draft", comments: "Review provenance evidence." },
    })).toEqual({
      ok: false,
      errors: ["review packet traceQuality.hasModelProvenance cannot be true without model-generated events"],
    });
  });

  it("accepts provider health with indexed local runtime evidence", () => {
    expect(
      validateProviderHealth({
        providerId: "local-vibevoice",
        status: "blocked",
        blockers: ["runtime_file_generation_only", "real_time_factor_above_1"],
        evidence: {
          evidenceId: "local_voice_runtime_benchmark",
          sourceFile: "docs/openclinxr/local-voice-runtime-benchmark-2026-05-04.json",
          generatedAt: "2026-05-04T15:01:12Z",
          summary: {
            modelId: "microsoft/VibeVoice-Realtime-0.5B",
            realTimeFactor: 5.24,
            approximateFirstSpeechTokenLatencyMs: 9000,
            productionUseAllowed: false,
          },
        },
      }).ok,
    ).toBe(true);

    expect(
      validateProviderHealth({
        providerId: "mock-model",
        status: "ready",
        blockers: ["should_not_ship_with_ready_status"],
      }).ok,
    ).toBe(false);
    expect(
      validateProviderHealth({
        providerId: "   ",
        status: "blocked",
        blockers: ["runtime_not_available"],
      }).ok,
    ).toBe(false);
  });

  it("accepts provider audit records with request identity, runtime, latency, and safety status", () => {
    expect(
      validateProviderAuditRecord({
        requestId: "model-request-001",
        providerId: "mock-model",
        modelId: "deterministic-mock",
        modelVersion: "1.0.0",
        modelRuntimeName: "deterministic-mock-runtime",
        requestPolicyId: "actor-dialogue-offline-v1",
        safetyPolicyVersion: "clinical-simulation-safety-v1",
        latencyMs: 0,
        costEstimateUsd: 0,
        safetyStatus: "pass",
      }).ok,
    ).toBe(true);
  });

  it("rejects provider audit records without request identity or safety status", () => {
    expect(
      validateProviderAuditRecord({
        providerId: "mock-model",
        modelId: "deterministic-mock",
        modelVersion: "1.0.0",
        modelRuntimeName: "deterministic-mock-runtime",
        requestPolicyId: "actor-dialogue-offline-v1",
        safetyPolicyVersion: "clinical-simulation-safety-v1",
        latencyMs: 0,
        costEstimateUsd: 0,
      }).ok,
    ).toBe(false);

    expect(
      validateProviderAuditRecord({
        requestId: "   ",
        providerId: "mock-model",
        modelId: "deterministic-mock",
        modelVersion: "1.0.0",
        modelRuntimeName: "deterministic-mock-runtime",
        requestPolicyId: "actor-dialogue-offline-v1",
        safetyPolicyVersion: "clinical-simulation-safety-v1",
        latencyMs: 0,
        costEstimateUsd: 0,
        safetyStatus: "pass",
      }).ok,
    ).toBe(false);
  });

  it("validates named model and voice provider audits and rejects missing provider identity", () => {
    const audit = {
      requestId: "voice-synthesis-request-001",
      providerId: "mock-voice",
      modelId: "deterministic-voice-mock",
      modelVersion: "1.0.0",
      modelRuntimeName: "deterministic-voice-mock-runtime",
      requestPolicyId: "voice-offline-v1",
      safetyPolicyVersion: "clinical-simulation-safety-v1",
      latencyMs: 0,
      costEstimateUsd: 0,
      safetyStatus: "not_exercised",
    };

    expect(validateModelProviderAudit({ ...audit, providerId: "mock-model" }).ok).toBe(true);
    expect(validateVoiceProviderAudit(audit).ok).toBe(true);
    expect(validateVoiceProviderAudit({ ...audit, providerId: "" }).ok).toBe(false);
  });
});
