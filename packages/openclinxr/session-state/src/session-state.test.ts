import { edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { describe, expect, it } from "vitest";
import {
  buildActorModelContext,
  createActorInteractionRoutedMessage,
  createActorInteractionRouteMessage,
  createSessionStateClinicalEventMessage,
  createMultiActorClinicalSession,
  createPersistenceSpikeStores,
  createSessionStateSnapshotMessage,
  createSpatialActorTransformMessage,
  evaluateMultiActorPersistencePhase2Strategy,
  evaluateSessionStateWebSocketMessageDesign,
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

  it("rejects non-finite spatial coordinates before they can enter realtime snapshots", () => {
    const session = createMultiActorClinicalSession({
      scenario: edChestPainScenario,
      stationRunId: "station_run_session_state_bad_spatial_001",
    });

    expect(() =>
      updateActorSpatialState(session, {
        atSecond: 191,
        actorId: "nurse_maria_alvarez_v1",
        position: { x: Number.NaN, y: 0, z: Number.POSITIVE_INFINITY },
        rotationYRadians: Number.NEGATIVE_INFINITY,
        interactionState: "holding_equipment",
      })
    ).toThrow("Spatial transform contains non-finite numeric values for actor nurse_maria_alvarez_v1");

    expect(session.spatialState.actorTransforms.nurse_maria_alvarez_v1?.position).toEqual({ x: 0.9, y: 0, z: -0.8 });
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
      clinicalEventId: "event_001_ecg_order_requested",
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
      clinicalEventId: "event_001_ecg_order_requested",
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
      clinicalEventId: "event_001_ecg_order_requested",
      stationRunId,
      actorId: "nurse_maria_alvarez_v1",
      atSecond: 180,
      eventKind: "order_status_changed",
      traceTag: "ecg_request",
      label: "12-lead ECG",
      status: "conflicting_duplicate_should_not_replace",
      payload: {
        public: {
          orderId: "order_1_ecg_request",
          requestedOrder: "12-lead ECG",
          resultSummary: "This conflicting duplicate must not replace the original event.",
        },
        private: {
          hiddenFactRefs: ["fact:patient_robert_hayes_v1:1"],
          serverOnlyNotes: ["Recent cocaine use remains hidden until elicited."],
        },
      },
    }));
    stores.durable.saveClinicalEvent(clinicalEvent({
      clinicalEventId: "event_001_ecg_order_completed",
      stationRunId,
      actorId: "nurse_maria_alvarez_v1",
      atSecond: 205,
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
      ["event_001_ecg_order_requested", "order_status_changed", "requested"],
      ["event_002_finding_diaphoresis", "finding_recorded", undefined],
      ["event_001_ecg_order_completed", "order_status_changed", "completed"],
      ["event_003_checklist_airway", "checklist_item_updated", "completed"],
      ["event_004_rubric_acs", "rubric_progress_updated", "met"],
      ["event_005_case_escalation", "case_status_changed", "escalated"],
      ["event_006_clinical_action", "clinical_action_recorded", "observed"],
    ]);
    expect(replay.filter((event) => event.clinicalEventId === "event_001_ecg_order_requested")).toHaveLength(1);
    expect(new Set(replay.map((event) => event.eventKind))).toEqual(new Set<DurableClinicalEventKind>([
      "clinical_action_recorded",
      "order_status_changed",
      "finding_recorded",
      "checklist_item_updated",
      "rubric_progress_updated",
      "case_status_changed",
    ]));
    expect(stores.durable.listConversationTurns(stationRunId)).toEqual([]);

    const completedOrderEvent = replay.find((event) => event.clinicalEventId === "event_001_ecg_order_completed");
    if (!completedOrderEvent) {
      throw new Error("Expected completed order clinical event for projection");
    }
    const projection = projectDurableClinicalEventForReview(completedOrderEvent);

    expect(projection).toMatchObject({
      clinicalEventId: "event_001_ecg_order_completed",
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

    const reviewReplay = stores.durable.listClinicalEventReviewProjections(stationRunId);
    const reviewSummary = summarizeDurableClinicalEventReviewProjections(reviewReplay);
    expect(reviewSummary).toEqual({
      stationRunId,
      eventCount: 7,
      redactedEventCount: 2,
      clinicalEventKinds: {
        clinical_action_recorded: 1,
        order_status_changed: 2,
        finding_recorded: 1,
        checklist_item_updated: 1,
        rubric_progress_updated: 1,
        case_status_changed: 1,
      },
      traceTags: [
        "ecg_request",
        "physical_exam_general",
        "diagnostic_reasoning_acs",
        "escalation_to_attending",
        "team_communication",
      ],
      statusCounts: {
        requested: 1,
        completed: 2,
        met: 1,
        escalated: 1,
        observed: 1,
      },
      latestAtSecond: 320,
      durableStore: "database_source_of_truth",
      safeForFacultyReview: true,
    });
    expect(reviewReplay.map((event) => event.clinicalEventId)).toEqual([
      "event_001_ecg_order_requested",
      "event_002_finding_diaphoresis",
      "event_001_ecg_order_completed",
      "event_003_checklist_airway",
      "event_004_rubric_acs",
      "event_005_case_escalation",
      "event_006_clinical_action",
    ]);
    const completedOrderProjection = reviewReplay.find((event) => event.clinicalEventId === "event_001_ecg_order_completed");
    expect(completedOrderProjection).toMatchObject({
      payload: {
        orderId: "order_1_ecg_request",
        requestedOrder: "12-lead ECG",
        resultSummary: "ST elevation present.",
        nested: {
          displayHint: "show ECG result after completion",
        },
      },
      privatePayloadRedacted: true,
    });
    expect(JSON.stringify(reviewReplay)).not.toContain("Recent cocaine use");
    expect(JSON.stringify(reviewReplay)).not.toContain("hiddenFactRefs");
    expect(JSON.stringify(reviewReplay)).not.toContain("hiddenClinicalTruth");
  });

  it("keeps clinical-event idempotency insert-only while preserving same-second replay order", () => {
    const stores = createPersistenceSpikeStores();
    const stationRunId = "station_run_durable_clinical_event_same_second_001";

    stores.durable.saveClinicalEvent(clinicalEvent({
      clinicalEventId: "event_b_finding_recorded",
      stationRunId,
      atSecond: 200,
      eventKind: "finding_recorded",
      label: "Diaphoresis observed",
      payload: {
        public: {
          findingId: "finding_1_diaphoretic",
          observed: true,
        },
      },
    }));
    stores.durable.saveClinicalEvent(clinicalEvent({
      clinicalEventId: "event_a_order_requested",
      stationRunId,
      atSecond: 200,
      eventKind: "order_status_changed",
      traceTag: "ecg_request",
      label: "12-lead ECG",
      status: "requested",
      payload: {
        public: {
          orderId: "order_1_ecg_request",
          requestedOrder: "12-lead ECG",
        },
      },
    }));
    stores.durable.saveClinicalEvent(clinicalEvent({
      clinicalEventId: "event_a_order_requested",
      stationRunId,
      atSecond: 200,
      eventKind: "order_status_changed",
      traceTag: "ecg_request",
      label: "12-lead ECG",
      status: "conflicting_duplicate_should_not_replace",
      payload: {
        public: {
          orderId: "order_1_ecg_request",
          requestedOrder: "12-lead ECG",
          resultSummary: "This conflicting duplicate must not replace the original event.",
        },
      },
    }));

    const replay = stores.durable.listClinicalEvents(stationRunId);

    expect(replay.map((event) => [event.clinicalEventId, event.status])).toEqual([
      ["event_a_order_requested", "requested"],
      ["event_b_finding_recorded", undefined],
    ]);
    expect(replay[0]?.payload.public).toEqual({
      orderId: "order_1_ecg_request",
      requestedOrder: "12-lead ECG",
    });
  });

  it("clones nested clinical-event private payload before storing", () => {
    const stores = createPersistenceSpikeStores();
    const stationRunId = "station_run_durable_clinical_event_private_clone_001";
    const nestedPrivate = {
      serverOnlyDetail: "Recent cocaine use remains hidden until elicited.",
      reviewerSuppressionReasons: ["hidden_fact_not_elicited"],
    };
    const record = clinicalEvent({
      clinicalEventId: "event_private_clone_001",
      stationRunId,
      atSecond: 240,
      eventKind: "finding_recorded",
      label: "Risk factor documented",
      payload: {
        public: {
          findingId: "finding_1_risk_factor",
        },
        private: {
          hiddenFactRefs: ["fact:patient_robert_hayes_v1:1"],
          serverOnlyNotes: ["Keep hidden from learner-facing review until elicited."],
          nestedPrivate,
        },
      },
    });

    stores.durable.saveClinicalEvent(record);
    nestedPrivate.reviewerSuppressionReasons.push("mutated_by_caller");
    nestedPrivate.serverOnlyDetail = "mutated_by_caller";

    expect(stores.durable.listClinicalEvents(stationRunId)[0]?.payload.private?.nestedPrivate).toEqual({
      serverOnlyDetail: "Recent cocaine use remains hidden until elicited.",
      reviewerSuppressionReasons: ["hidden_fact_not_elicited"],
    });
  });

  it("rejects non-database durable-store posture for clinical events", () => {
    const stores = createPersistenceSpikeStores();
    const stationRunId = "station_run_durable_clinical_event_store_posture_001";
    const invalidRecord = {
      ...clinicalEvent({
        clinicalEventId: "event_invalid_store_posture_001",
        stationRunId,
        atSecond: 260,
        eventKind: "clinical_action_recorded",
        label: "Invalid cache-backed clinical event",
      }),
      durableStore: "redis_redka_ephemeral_cache" as never,
    };

    expect(() => stores.durable.saveClinicalEvent(invalidRecord))
      .toThrow("durable clinical-event records must use durableStore database_source_of_truth");
    expect(() => projectDurableClinicalEventForReview(invalidRecord))
      .toThrow("durable clinical-event records must use durableStore database_source_of_truth");
    expect(stores.durable.listClinicalEvents(stationRunId)).toEqual([]);
  });

  it("creates design-only WebSocket snapshot messages without leaking private actor memory", () => {
    const session = createMultiActorClinicalSession({
      scenario: edChestPainScenario,
      stationRunId: "station_run_websocket_design_001",
    });

    const message = createSessionStateSnapshotMessage(session, {
      messageId: "ws_msg_001_snapshot",
      sequence: 1,
      atSecond: 0,
      sentAt: "2026-05-05T23:30:00.000Z",
    });

    expect(message).toMatchObject({
      type: "session.snapshot",
      direction: "server_to_client",
      transport: "websocket_design_contract",
      schemaVersion: 1,
      stationRunId: "station_run_websocket_design_001",
      evidence: {
        runtimeSyncImplemented: false,
        readyForProductionAdoption: false,
        notEvidenceFor: [
          "apps_api_websocket_route",
          "production_realtime_state_sync",
          "redis_redka_adapter",
          "quest_network_performance",
          "clinical_assessment_validity",
        ],
      },
    });
    expect(message.actors.map((actor) => [actor.actorId, actor.role, actor.conversationTurn])).toEqual([
      ["patient_robert_hayes_v1", "patient", 0],
      ["spouse_anna_hayes_v1", "family", 0],
      ["nurse_maria_alvarez_v1", "nurse", 0],
    ]);
    expect(JSON.stringify(message)).not.toContain("Recent cocaine use");
    expect(JSON.stringify(message)).not.toContain("Repeat blood pressure is falling");
    expect(message.spatial.actorTransforms.patient_robert_hayes_v1?.position).toEqual({ x: 0, y: 0, z: -1.15 });
  });

  it("models route, routed, clinical-event, and spatial messages as design-only deltas", () => {
    let session = createMultiActorClinicalSession({
      scenario: edChestPainScenario,
      stationRunId: "station_run_websocket_design_002",
    });
    const routeMessage = createActorInteractionRouteMessage({
      messageId: "ws_msg_002_route",
      sequence: 2,
      stationRunId: session.stationRunId,
      atSecond: 142,
      sentAt: "2026-05-05T23:31:00.000Z",
      learnerUtterance: "Nurse, please repeat the blood pressure and start the ECG.",
      traceContextTags: ["vitals_review", "ecg_request"],
      source: {
        kind: "voice_transcript",
        streamId: "voice_stream_ws_design_001",
        transcriptSegmentId: "segment_001_final",
        finalTranscriptText: "Nurse, please repeat the blood pressure and start the ECG.",
        provider: "local_fastapi_transport_echo",
        provenanceRefs: ["trace:voice_stream_ws_design_001:segment_001_final"],
      },
    });
    const routed = routeActorInteraction(session, routeMessage.payload);
    session = routed.updatedSession;
    const routedMessage = createActorInteractionRoutedMessage(session, {
      messageId: "ws_msg_003_routed",
      sequence: 3,
      atSecond: 142,
      sentAt: "2026-05-05T23:31:01.000Z",
      routedActorId: routed.routedActorId,
      routingReason: routed.routingReason,
      traceContextTags: ["vitals_review", "ecg_request"],
    });
    const transformMessage = createSpatialActorTransformMessage(session.spatialState.actorTransforms.nurse_maria_alvarez_v1!, {
      messageId: "ws_msg_004_transform",
      sequence: 4,
      stationRunId: session.stationRunId,
      sentAt: "2026-05-05T23:31:02.000Z",
      direction: "server_to_client",
    });
    const clinicalMessage = createSessionStateClinicalEventMessage(clinicalEvent({
      clinicalEventId: "event_ws_design_001",
      stationRunId: session.stationRunId,
      actorId: "nurse_maria_alvarez_v1",
      atSecond: 180,
      eventKind: "order_status_changed",
      traceTag: "ecg_request",
      label: "12-lead ECG",
      status: "completed",
      payload: {
        public: {
          orderId: "order_1_ecg_request",
          resultSummary: "ST elevation present.",
          hiddenFactRefs: ["fact:patient_robert_hayes_v1:1"],
        },
        private: {
          hiddenFactRefs: ["fact:patient_robert_hayes_v1:1"],
          serverOnlyNotes: ["Recent cocaine use remains hidden until elicited."],
        },
      },
    }), {
      messageId: "ws_msg_005_clinical_event",
      sequence: 5,
      sentAt: "2026-05-05T23:31:03.000Z",
    });

    expect(routeMessage).toMatchObject({
      type: "actor.interaction.route",
      direction: "client_to_server",
      transport: "websocket_design_contract",
      payload: {
        source: {
          kind: "voice_transcript",
          rawAudioStored: false,
        },
      },
    });
    expect(routedMessage).toMatchObject({
      type: "actor.interaction.routed",
      direction: "server_to_client",
      routedActorId: "nurse_maria_alvarez_v1",
      conversationTurn: 1,
    });
    expect(transformMessage).toMatchObject({
      type: "spatial.actor.transform",
      direction: "server_to_client",
      actorId: "nurse_maria_alvarez_v1",
      transform: {
        interactionState: "addressed",
        lastUpdatedAtSecond: 142,
      },
    });
    expect(clinicalMessage).toMatchObject({
      type: "clinical.event.appended",
      direction: "server_to_client",
      event: {
        clinicalEventId: "event_ws_design_001",
        privatePayloadRedacted: true,
        payload: {
          orderId: "order_1_ecg_request",
          resultSummary: "ST elevation present.",
        },
      },
    });
    expect(JSON.stringify(clinicalMessage)).not.toContain("Recent cocaine use");
    expect(JSON.stringify(clinicalMessage)).not.toContain("hiddenFactRefs");
  });

  it("documents WebSocket message design posture without runtime adoption claims", () => {
    const design = evaluateSessionStateWebSocketMessageDesign();

    expect(design).toMatchObject({
      generatedAt: "2026-05-05",
      approvedProposal: "proposals/approved/proposal-multi-actor-runtime-promotion.md",
      transportPosture: "websocket_design_contract_only",
      runtimeImplemented: false,
      apiWiringIncluded: false,
      redisRedkaIncluded: false,
      databasePersistenceIncluded: false,
    });
    expect(design.messageFamilies).toEqual([
      "session.snapshot.request",
      "session.snapshot",
      "actor.interaction.route",
      "actor.interaction.routed",
      "clinical.event.appended",
      "spatial.actor.transform",
      "session.resync.required",
    ]);
    expect(design.notEvidenceFor).toEqual([
      "apps_api_websocket_route",
      "production_realtime_state_sync",
      "redis_redka_adapter",
      "quest_network_performance",
      "clinical_assessment_validity",
    ]);
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

it("rejects durable clinical events with blank identity fields before persistence or review projection", () => {
  const stores = createPersistenceSpikeStores();
  const stationRunId = "station_run_durable_clinical_event_identity_001";
  const validEvent = clinicalEvent({
    clinicalEventId: "event_identity_guard_001",
    stationRunId,
    atSecond: 1,
    eventKind: "clinical_action_recorded",
    label: "Identity guard action",
  });

  expect(() => stores.durable.saveClinicalEvent({ ...validEvent, clinicalEventId: " " }))
    .toThrow("durable clinical-event records require nonblank clinicalEventId");
  expect(() => stores.durable.saveClinicalEvent({ ...validEvent, stationRunId: " " }))
    .toThrow("durable clinical-event records require nonblank stationRunId");
  expect(() => stores.durable.saveClinicalEvent({ ...validEvent, label: " " }))
    .toThrow("durable clinical-event records require nonblank label");
  expect(() => stores.durable.saveClinicalEvent({ ...validEvent, atSecond: Number.NaN }))
    .toThrow("durable clinical-event records require a nonnegative finite atSecond");
  expect(() => projectDurableClinicalEventForReview({ ...validEvent, traceTag: " " }))
    .toThrow("durable clinical-event records require nonblank traceTag");
  expect(stores.durable.listClinicalEvents(stationRunId)).toEqual([]);
});

it("rejects durable clinical events whose trace provenance refs point at another station run", () => {
  const stores = createPersistenceSpikeStores();
  const stationRunId = "station_run_durable_clinical_event_provenance_001";
  const validEvent = clinicalEvent({
    clinicalEventId: "event_provenance_guard_001",
    stationRunId,
    atSecond: 1,
    eventKind: "clinical_action_recorded",
    label: "Provenance guard action",
    provenanceRefs: [
      `trace:${stationRunId}:1`,
      "review:faculty:manual-overread",
    ],
  });
  const invalidEvent = {
    ...validEvent,
    clinicalEventId: "event_provenance_guard_cross_run",
    provenanceRefs: [
      "trace:station_run_other:1",
      "review:faculty:manual-overread",
    ],
  };

  expect(() => stores.durable.saveClinicalEvent(validEvent)).not.toThrow();
  expect(() => stores.durable.saveClinicalEvent(invalidEvent))
    .toThrow("durable clinical-event provenanceRefs trace ref trace:station_run_other:1 must match stationRunId station_run_durable_clinical_event_provenance_001");
  expect(() => projectDurableClinicalEventForReview(invalidEvent))
    .toThrow("durable clinical-event provenanceRefs trace ref trace:station_run_other:1 must match stationRunId station_run_durable_clinical_event_provenance_001");
  expect(stores.durable.listClinicalEvents(stationRunId).map((event) => event.clinicalEventId))
    .toEqual(["event_provenance_guard_001"]);
});

it("rejects durable clinical events with malformed trace provenance refs", () => {
  const stores = createPersistenceSpikeStores();
  const stationRunId = "station_run_durable_clinical_event_malformed_provenance_001";
  const invalidEvent = clinicalEvent({
    clinicalEventId: "event_malformed_provenance_guard_001",
    stationRunId,
    atSecond: 1,
    eventKind: "clinical_action_recorded",
    label: "Malformed provenance guard action",
    provenanceRefs: [`trace:${stationRunId}`],
  });

  expect(() => stores.durable.saveClinicalEvent(invalidEvent))
    .toThrow(`durable clinical-event provenanceRefs trace ref trace:${stationRunId} must include stationRunId and sequence`);
  expect(() => projectDurableClinicalEventForReview(invalidEvent))
    .toThrow(`durable clinical-event provenanceRefs trace ref trace:${stationRunId} must include stationRunId and sequence`);
  expect(stores.durable.listClinicalEvents(stationRunId)).toEqual([]);
});

it("rejects durable actor-turn and emotional-state records with blank identity fields before in-memory persistence", () => {
  const stores = createPersistenceSpikeStores();
  const validTurn = {
    turnId: "turn_identity_guard_001",
    stationRunId: "station_run_actor_turn_identity_001",
    actorId: "spouse_anna_hayes_v1",
    atSecond: 10,
    sourceKind: "voice_transcript" as const,
    text: "He said the pain started while walking upstairs.",
    traceContextTags: ["history_onset"],
    emotionalState: "anxious",
    routingReason: "addressed_actor_name" as const,
    rawAudioStored: false as const,
    provenanceRefs: ["voice:segment_001"],
    durableStore: "database_source_of_truth" as const,
  };
  const validEmotionalState = {
    stationRunId: validTurn.stationRunId,
    actorId: validTurn.actorId,
    atSecond: 11,
    emotionalState: "anxious",
    sourceTurnId: validTurn.turnId,
    durableStore: "database_source_of_truth" as const,
  };

  expect(() => stores.durable.saveConversationTurn({ ...validTurn, turnId: " " }))
    .toThrow("durable actor-turn records require nonblank turnId");
  expect(() => stores.durable.saveConversationTurn({ ...validTurn, traceContextTags: [" "] }))
    .toThrow("durable actor-turn records require nonblank traceContextTags");
  expect(() => stores.durable.saveConversationTurn({ ...validTurn, rawAudioStored: true as false }))
    .toThrow("durable actor-turn records must not persist raw audio");
  expect(() => stores.durable.saveConversationTurn({ ...validTurn, atSecond: Number.NaN }))
    .toThrow("durable actor-turn records require a nonnegative finite atSecond");
  expect(() => stores.durable.saveEmotionalStateTimeline({ ...validEmotionalState, sourceTurnId: " " }))
    .toThrow("durable actor-turn records require nonblank sourceTurnId");
  expect(() => stores.durable.saveEmotionalStateTimeline({ ...validEmotionalState, atSecond: -1 }))
    .toThrow("durable actor-turn records require a nonnegative finite atSecond");
  expect(stores.durable.listConversationTurns(validTurn.stationRunId)).toEqual([]);
  expect(stores.durable.listEmotionalStateTimeline(validTurn.stationRunId, validTurn.actorId)).toEqual([]);
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
import { summarizeDurableClinicalEventReviewProjections } from "./index.js";
