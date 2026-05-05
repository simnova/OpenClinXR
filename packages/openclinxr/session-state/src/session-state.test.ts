import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { describe, expect, it } from "vitest";
import {
  buildActorModelContext,
  createMultiActorClinicalSession,
  createPersistenceSpikeStores,
  evaluateMultiActorPersistencePhase2Strategy,
  persistLatestInteractionTurn,
  projectDurableClinicalEventForReview,
  rehydrateRealtimeCacheFromDurableState,
  recordClinicalAction,
  routeActorInteraction,
  updateActorSpatialState,
  writeRealtimeCacheSnapshot,
  type DurableClinicalEventKind,
  type DurableClinicalEventRecord,
} from "./index.js";

describe("session state", () => {
  it("creates actor state from scenario actors without claiming realtime sync or clinical validity", () => {
    const session = createMultiActorClinicalSession({
      scenario: edChestPainScenario,
      stationRunId: "station_run_session_state_001",
    });

    expect(session.actors.map((actor) => [actor.actorId, actor.role, actor.memory.privateFacts.length])).toEqual([
      ["patient_robert_hayes_v1", "patient", 2],
      ["spouse_anna_hayes_v1", "family", 1],
      ["nurse_maria_alvarez_v1", "nurse", 1],
    ]);
    expect(session.evidence).toEqual({
      architecture: "custom-domain-state-baseline",
      dependencyPosture: "no_new_runtime_dependencies",
      readyForProductionAdoption: false,
      notEvidenceFor: [
        "production_realtime_state_sync",
        "production_persistence",
        "llm_actor_quality",
        "quest_spatial_sync",
        "clinical_assessment_validity",
      ],
    });
  });

  it("routes addressed learner utterances to the intended actor and preserves private memory boundaries", () => {
    const session = createMultiActorClinicalSession({
      scenario: edChestPainScenario,
      stationRunId: "station_run_session_state_002",
    });

    const routed = routeActorInteraction(session, {
      atSecond: 120,
      learnerUtterance: "Nurse, can you repeat the blood pressure and get an ECG?",
      traceContextTags: ["vitals_review", "ecg_request"],
    });
    const nurseContext = buildActorModelContext(routed.updatedSession, routed.routedActorId);
    const patientContext = buildActorModelContext(routed.updatedSession, "patient_robert_hayes_v1");

    expect(routed.routedActorId).toBe("nurse_maria_alvarez_v1");
    expect(routed.routingReason).toBe("addressed_role_keyword");
    expect(nurseContext.conversationTurn).toBe(1);
    expect(nurseContext.privateMemory.factRefs).toEqual(["fact:nurse_maria_alvarez_v1:0"]);
    expect(nurseContext.privateMemory.factsForServerModelOnly).toContain(
      "Repeat blood pressure is falling and patient looks worse at minute seven",
    );
    expect(patientContext.conversationTurn).toBe(0);
    expect(patientContext.privateMemory.factsForServerModelOnly.join(" ")).not.toContain("Repeat blood pressure");
  });

  it("records final voice transcript provenance without storing raw audio", () => {
    const session = createMultiActorClinicalSession({
      scenario: edChestPainScenario,
      stationRunId: "station_run_session_state_voice_001",
    });

    const routed = routeActorInteraction(session, {
      atSecond: 142,
      learnerUtterance: "Anna, can you tell me exactly when his pain started?",
      traceContextTags: ["history_onset", "family_collateral"],
      source: {
        kind: "voice_transcript",
        streamId: "voice_stream_station_001",
        transcriptSegmentId: "segment_0007_final",
        finalTranscriptText: "Anna, can you tell me exactly when his pain started?",
        provider: "local_fastapi_transport_echo",
        provenanceRefs: ["trace:voice_stream_station_001:segment_0007_final"],
      },
    });

    expect(routed.routedActorId).toBe("spouse_anna_hayes_v1");
    expect(routed.updatedSession.interactionLog.at(-1)).toEqual({
      atSecond: 142,
      learnerUtterance: "Anna, can you tell me exactly when his pain started?",
      routedActorId: "spouse_anna_hayes_v1",
      routingReason: "addressed_actor_name",
      traceContextTags: ["history_onset", "family_collateral"],
      source: {
        kind: "voice_transcript",
        streamId: "voice_stream_station_001",
        transcriptSegmentId: "segment_0007_final",
        finalTranscriptText: "Anna, can you tell me exactly when his pain started?",
        provider: "local_fastapi_transport_echo",
        provenanceRefs: ["trace:voice_stream_station_001:segment_0007_final"],
        rawAudioStored: false,
      },
    });
  });

  it("tracks clinical actions and spatial transforms as session state only", () => {
    let session = createMultiActorClinicalSession({
      scenario: edChestPainScenario,
      stationRunId: "station_run_session_state_003",
    });

    session = recordClinicalAction(session, {
      atSecond: 185,
      actorId: "nurse_maria_alvarez_v1",
      traceTag: "ecg_request",
      actionType: "order_requested",
      label: "12-lead ECG requested",
    });
    session = updateActorSpatialState(session, {
      atSecond: 190,
      actorId: "nurse_maria_alvarez_v1",
      position: { x: 1.2, y: 0, z: -0.6 },
      rotationYRadians: -0.4,
      interactionState: "holding_equipment",
    });

    expect(session.clinicalState.completedTraceTags).toContain("ecg_request");
    expect(session.clinicalState.orders).toEqual([
      {
        actorId: "nurse_maria_alvarez_v1",
        atSecond: 185,
        label: "12-lead ECG requested",
        orderId: "order_1_ecg_request",
        status: "requested",
        traceTag: "ecg_request",
      },
    ]);
    expect(session.spatialState.actorTransforms["nurse_maria_alvarez_v1"]).toMatchObject({
      position: { x: 1.2, y: 0, z: -0.6 },
      rotationYRadians: -0.4,
      interactionState: "holding_equipment",
      lastUpdatedAtSecond: 190,
    });
  });

  it("keeps Phase 2 durable actor history authoritative while realtime cache remains disposable", () => {
    const stores = createPersistenceSpikeStores();
    let session = createMultiActorClinicalSession({
      scenario: edChestPainScenario,
      stationRunId: "station_run_session_state_persistence_001",
    });
    const routed = routeActorInteraction(session, {
      atSecond: 142,
      learnerUtterance: "Anna, what happened right before he came in?",
      traceContextTags: ["history_onset", "family_collateral"],
      source: {
        kind: "voice_transcript",
        streamId: "voice_stream_station_001",
        transcriptSegmentId: "segment_0008_final",
        finalTranscriptText: "Anna, what happened right before he came in?",
        provider: "local_fastapi_transport_echo",
        provenanceRefs: ["trace:voice_stream_station_001:segment_0008_final"],
      },
    });
    session = updateActorSpatialState(routed.updatedSession, {
      atSecond: 145,
      actorId: routed.routedActorId,
      position: { x: -0.75, y: 0, z: -0.7 },
      rotationYRadians: 0.35,
      interactionState: "speaking",
    });

    const durableRecord = persistLatestInteractionTurn(stores, session);
    writeRealtimeCacheSnapshot(stores, session, {
      currentSecond: 146,
      ttlSeconds: 20,
      recentTurnLimit: 2,
    });

    expect(durableRecord).toMatchObject({
      stationRunId: "station_run_session_state_persistence_001",
      actorId: "spouse_anna_hayes_v1",
      sourceKind: "voice_transcript",
      text: "Anna, what happened right before he came in?",
      traceContextTags: ["history_onset", "family_collateral"],
      emotionalState: "anxious",
      rawAudioStored: false,
      durableStore: "database_source_of_truth",
    });
    expect(stores.durable.listConversationTurns(session.stationRunId)).toHaveLength(1);
    expect(stores.durable.listEmotionalStateTimeline(session.stationRunId, "spouse_anna_hayes_v1")).toEqual([
      {
        stationRunId: "station_run_session_state_persistence_001",
        actorId: "spouse_anna_hayes_v1",
        atSecond: 142,
        emotionalState: "anxious",
        sourceTurnId: durableRecord.turnId,
        durableStore: "database_source_of_truth",
      },
    ]);
    expect(stores.realtime.read(session.stationRunId)).toMatchObject({
      stationRunId: "station_run_session_state_persistence_001",
      cacheStore: "redis_redka_ephemeral_cache",
      expiresAtSecond: 166,
      recentTurns: [{ turnId: durableRecord.turnId, actorId: "spouse_anna_hayes_v1" }],
      actorTransforms: {
        spouse_anna_hayes_v1: {
          position: { x: -0.75, y: 0, z: -0.7 },
          interactionState: "speaking",
        },
      },
    });

    stores.realtime.clear();
    expect(stores.realtime.read(session.stationRunId)).toBeNull();

    const rehydrated = rehydrateRealtimeCacheFromDurableState(stores, session, {
      currentSecond: 200,
      ttlSeconds: 30,
      recentTurnLimit: 3,
    });

    expect(rehydrated).toMatchObject({
      stationRunId: "station_run_session_state_persistence_001",
      cacheStore: "redis_redka_ephemeral_cache",
      expiresAtSecond: 230,
      recentTurns: [{ turnId: durableRecord.turnId, actorId: "spouse_anna_hayes_v1" }],
      rehydratedFromDurableStore: true,
    });
    expect(stores.durable.listConversationTurns(session.stationRunId)).toHaveLength(1);
  });

  it("persists durable clinical events separately from actor turns and redacts private payload", () => {
    const stores = createPersistenceSpikeStores();
    const stationRunId = "station_run_durable_clinical_event_001";

    stores.durable.saveClinicalEvent(clinicalEvent({
      clinicalEventId: "event_003_checklist_airway",
      stationRunId,
      atSecond: 210,
      eventKind: "checklist_item_updated",
      label: "Airway and breathing assessed",
      status: "completed",
      payload: {
        public: {
          checklistItemId: "primary_survey_airway_breathing",
          checked: true,
        },
      },
    }));
    stores.durable.saveClinicalEvent(clinicalEvent({
      clinicalEventId: "event_001_ecg_order",
      stationRunId,
      actorId: "nurse_maria_alvarez_v1",
      atSecond: 180,
      eventKind: "order_status_changed",
      traceTag: "ecg_request",
      label: "12-lead ECG",
      status: "requested",
      payload: {
        public: {
          orderId: "order_1_ecg_request",
          requestedOrder: "12-lead ECG",
        },
        private: {
          hiddenFactRefs: ["fact:patient_robert_hayes_v1:1"],
          serverOnlyNotes: ["Recent cocaine use remains hidden until elicited."],
        },
      },
    }));
    stores.durable.saveClinicalEvent(clinicalEvent({
      clinicalEventId: "event_001_ecg_order",
      stationRunId,
      actorId: "nurse_maria_alvarez_v1",
      atSecond: 180,
      eventKind: "order_status_changed",
      traceTag: "ecg_request",
      label: "12-lead ECG",
      status: "completed",
      payload: {
        public: {
          orderId: "order_1_ecg_request",
          requestedOrder: "12-lead ECG",
          resultSummary: "ST elevation present.",
          hiddenFactRefs: ["fact:patient_robert_hayes_v1:1"],
          nested: {
            hiddenClinicalTruth: "Recent cocaine use remains hidden until elicited.",
            displayHint: "show ECG result after completion",
          },
        },
        private: {
          hiddenFactRefs: ["fact:patient_robert_hayes_v1:1"],
          serverOnlyNotes: ["Recent cocaine use remains hidden until elicited."],
        },
      },
      provenanceRefs: [
        "trace:station_run_durable_clinical_event_001:180",
        "review:cardiology:ecg-overread",
      ],
    }));
    stores.durable.saveClinicalEvent(clinicalEvent({
      clinicalEventId: "event_002_finding_diaphoresis",
      stationRunId,
      actorId: "patient_robert_hayes_v1",
      atSecond: 190,
      eventKind: "finding_recorded",
      traceTag: "physical_exam_general",
      label: "Patient appears diaphoretic",
      payload: {
        public: {
          findingId: "finding_1_diaphoretic",
          observed: true,
        },
      },
    }));
    stores.durable.saveClinicalEvent(clinicalEvent({
      clinicalEventId: "event_004_rubric_acs",
      stationRunId,
      atSecond: 240,
      eventKind: "rubric_progress_updated",
      traceTag: "diagnostic_reasoning_acs",
      label: "ACS considered",
      status: "met",
      payload: {
        public: {
          rubricItemId: "diagnostic_reasoning_acs",
          scoreDraft: "met",
        },
      },
    }));
    stores.durable.saveClinicalEvent(clinicalEvent({
      clinicalEventId: "event_005_case_escalation",
      stationRunId,
      atSecond: 300,
      eventKind: "case_status_changed",
      traceTag: "escalation_to_attending",
      label: "Case escalated to attending",
      status: "escalated",
      payload: {
        public: {
          casePhase: "escalated_care",
        },
      },
    }));
    stores.durable.saveClinicalEvent(clinicalEvent({
      clinicalEventId: "event_006_clinical_action",
      stationRunId,
      actorId: "nurse_maria_alvarez_v1",
      atSecond: 320,
      eventKind: "clinical_action_recorded",
      traceTag: "team_communication",
      label: "Nurse repeats closed-loop instruction",
      status: "observed",
      payload: {
        public: {
          actionId: "closed_loop_communication_001",
          communicationPattern: "closed_loop",
        },
      },
    }));

    const replay = stores.durable.listClinicalEvents(stationRunId);

    expect(replay.map((event) => [event.clinicalEventId, event.eventKind, event.status])).toEqual([
      ["event_001_ecg_order", "order_status_changed", "completed"],
      ["event_002_finding_diaphoresis", "finding_recorded", undefined],
      ["event_003_checklist_airway", "checklist_item_updated", "completed"],
      ["event_004_rubric_acs", "rubric_progress_updated", "met"],
      ["event_005_case_escalation", "case_status_changed", "escalated"],
      ["event_006_clinical_action", "clinical_action_recorded", "observed"],
    ]);
    expect(new Set(replay.map((event) => event.eventKind))).toEqual(new Set<DurableClinicalEventKind>([
      "clinical_action_recorded",
      "order_status_changed",
      "finding_recorded",
      "checklist_item_updated",
      "rubric_progress_updated",
      "case_status_changed",
    ]));
    expect(stores.durable.listConversationTurns(stationRunId)).toEqual([]);

    const firstEvent = replay[0];
    if (!firstEvent) {
      throw new Error("Expected a first clinical event for projection");
    }
    const projection = projectDurableClinicalEventForReview(firstEvent);

    expect(projection).toMatchObject({
      clinicalEventId: "event_001_ecg_order",
      stationRunId,
      eventKind: "order_status_changed",
      payload: {
        orderId: "order_1_ecg_request",
        requestedOrder: "12-lead ECG",
        resultSummary: "ST elevation present.",
      },
      privatePayloadRedacted: true,
      durableStore: "database_source_of_truth",
    });
    expect(JSON.stringify(projection)).not.toContain("Recent cocaine use");
    expect(JSON.stringify(projection)).not.toContain("serverOnlyNotes");
    expect(JSON.stringify(projection)).not.toContain("hiddenFactRefs");
    expect(JSON.stringify(projection)).not.toContain("hiddenClinicalTruth");
    expect(projection.payload).toMatchObject({
      nested: {
        displayHint: "show ECG result after completion",
      },
    });
  });

  it("documents Phase 2 Redis/Redka versus database responsibilities without adding runtime dependencies", () => {
    const strategy = evaluateMultiActorPersistencePhase2Strategy();

    expect(strategy.approvedProposal).toBe(
      "proposals/approved/proposal-server-side-multi-actor-state-context-persistence-phase2.md",
    );
    expect(strategy.recommendation).toBe("custom_domain_state_with_durable_database_and_ephemeral_redis_cache");
    expect(strategy.localProfile).toMatchObject({
      realtimeCache: "redka_or_adapter_test_double",
      durableStore: "mongodb_memory_server_or_local_mongodb",
    });
    expect(strategy.productionProfile).toMatchObject({
      realtimeCache: "redis",
      durableStore: "mongodb_or_documentdb_compatible",
    });
    expect(strategy.responsibilitySplit.realtimeCache).toEqual(expect.arrayContaining([
      "spatial_actor_transforms",
      "presence",
      "recent_context_window",
      "pubsub_notifications",
    ]));
    expect(strategy.responsibilitySplit.durableDatabase).toEqual(expect.arrayContaining([
      "conversation_history",
      "emotional_state_timeline",
      "clinical_trace_events",
      "orders_and_findings",
      "audit_relevant_interaction_records",
    ]));
    expect(strategy.guardrails).toEqual(expect.arrayContaining([
      "redis_redka_is_not_the_clinical_source_of_truth",
      "cache_entries_must_be_rehydratable_from_durable_database",
      "raw_voice_audio_is_not_persisted_in_actor_state",
    ]));
    expect(strategy.notEvidenceFor).toContain("production_persistence_architecture");
  });
});

function clinicalEvent(input: {
  clinicalEventId: string;
  stationRunId: string;
  atSecond: number;
  eventKind: DurableClinicalEventKind;
  label: string;
  actorId?: string;
  traceTag?: string;
  status?: string;
  payload?: DurableClinicalEventRecord["payload"];
  provenanceRefs?: string[];
}): DurableClinicalEventRecord {
  return {
    clinicalEventId: input.clinicalEventId,
    stationRunId: input.stationRunId,
    atSecond: input.atSecond,
    eventKind: input.eventKind,
    label: input.label,
    payload: input.payload ?? { public: {} },
    provenanceRefs: input.provenanceRefs ?? [`trace:${input.stationRunId}:${input.atSecond}`],
    durableStore: "database_source_of_truth",
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.traceTag ? { traceTag: input.traceTag } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
}
