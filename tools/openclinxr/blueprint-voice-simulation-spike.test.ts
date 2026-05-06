import { createStep2CsStyleSeedBlueprint } from "../../packages/openclinxr/exam-assembly/src/index.js";
import { edChestPainScenario, scenarioBank } from "../../packages/openclinxr/scenario-fixtures/src/index.js";
import { describe, expect, it } from "vitest";
import {
  buildBlueprintVoiceSimulationPlan,
  buildBlueprintVoiceSimulationSpikeReport,
} from "./blueprint-voice-simulation-spike.js";

describe("blueprint-driven voice simulation spike", () => {
  it("compiles the Step 2 CS-style seed blueprint into privacy-safe actor voice plans without depending on scenario order", () => {
    const blueprint = createStep2CsStyleSeedBlueprint(scenarioBank);
    const plan = buildBlueprintVoiceSimulationPlan({
      blueprint,
      scenarios: [...scenarioBank].reverse(),
      scenarioId: "ed_chest_pain_priority_v1",
    });

    expect(plan).toMatchObject({
      blueprintId: "blueprint_openclinxr_step2cs_style_seed_v1",
      station: {
        stationOrder: 1,
        slotId: "station_001_ed_chest_pain_priority_v1",
        scenarioId: "ed_chest_pain_priority_v1",
        title: "ED Chest Pain With Nurse Interruption And Family Pressure",
      },
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        modelDownloadsPerformed: false,
        productionUseAllowed: false,
        rawAudioStored: false,
        hiddenFactsExposedToLearner: false,
      },
    });
    expect(plan.actorRoster).toHaveLength(3);
    expect(plan.actorRoster[0]).toEqual({
      actorId: "patient_robert_hayes_v1",
      role: "patient",
      displayName: "Robert Hayes",
      demeanor: "anxious, diaphoretic, protective of chest",
      voiceId: "mock-patient-robert-hayes-v1",
      personalityTags: ["protective"],
      emotionTags: ["anxious", "diaphoretic"],
      hiddenFactCount: 2,
      hiddenFactsRedacted: true,
    });
    expect(plan.actorRoster[0]).not.toHaveProperty("hiddenFacts");
    expect(plan.triggerPlan).toEqual([
      {
        triggerId: "nurse_vitals_change",
        triggerType: "timed_event",
        atSecond: 420,
        actorId: "nurse_maria_alvarez_v1",
        traceTag: "vitals_review",
        learnerInterruptible: true,
      },
    ]);
    expect(plan.traceExpectations).toMatchObject({
      requiredTraceTags: expect.arrayContaining(["ecg_request", "urgent_escalation", "patient_note_submitted"]),
      safetyCriticalTraceTags: ["vitals_review", "ecg_request", "urgent_escalation", "team_communication"],
    });
    expect(plan.prewarmPlan.steps).toEqual([
      "compile_actor_context_cards",
      "prepare_mock_voice_slots",
      "prepare_trigger_scheduler",
      "prepare_safe_telemetry_labels",
    ]);
    expect(plan.telemetryAttributes).toEqual({
      "openclinxr.scenario_id": "ed_chest_pain_priority_v1",
      "openclinxr.scenario_version": 1,
      "openclinxr.route_id": "blueprint-voice-simulation-spike-v1",
      "openclinxr.route_surface": "local_tool_spike",
      "openclinxr.station_run_scoped": false,
    });
  });

  it("runs a deterministic mock voice loop without claiming local model or Quest readiness", async () => {
    const report = await buildBlueprintVoiceSimulationSpikeReport({
      generatedAt: "2026-05-05T21:05:00.000Z",
      blueprint: createStep2CsStyleSeedBlueprint(scenarioBank),
      scenarios: scenarioBank,
      scenarioId: "ed_chest_pain_priority_v1",
      learnerUtterance: "Maria, please get an ECG and repeat the vitals.",
      atSecond: 135,
    });

    expect(report.status).toBe("mock_facade_exercised");
    expect(report.plan.actorRoster.map((actor) => actor.actorId)).toEqual([
      "patient_robert_hayes_v1",
      "spouse_anna_hayes_v1",
      "nurse_maria_alvarez_v1",
    ]);
    expect(report.mockLoop).toMatchObject({
      learnerUtteranceStored: false,
      rawAudioStored: false,
      selectedActorId: "nurse_maria_alvarez_v1",
      routingReason: "addressed_actor_name",
      routingSource: "scenario_runtime",
      transcript: {
        eventCount: 2,
        finalTextRedacted: true,
      },
      synthesis: {
        audioChunkCount: 1,
        firstAudiblePlaybackLatencyMs: 0,
        providerId: "mock-voice",
      },
      traceEvents: [
        {
          eventType: "voice.transcript.final",
          source: "mock-voice-gateway",
          actorId: "nurse_maria_alvarez_v1",
          tag: "ecg_request",
        },
        {
          eventType: "voice.audio.generated",
          source: "mock-voice-gateway",
          actorId: "nurse_maria_alvarez_v1",
          tag: "ecg_request",
        },
      ],
    });
    expect(report.mockLoop.traceEvents.map((event) => event.payload)).toEqual([
      {
        transcriptEventCount: 2,
        confidence: 0.99,
        rawTranscriptRedacted: true,
      },
      {
        audioFormat: "audio/mock",
        audioChunkCount: 1,
        rawAudioStored: false,
        visemeCuesPresent: true,
      },
    ]);
    expect(report.runtimeRouting).toEqual({
      exercised: true,
      routeSource: "scenario_runtime",
      stationRunScoped: true,
      selectedActorId: "nurse_maria_alvarez_v1",
      routingReason: "addressed_actor_name",
      conversationTurn: 1,
      sourceKind: "voice_transcript",
      traceProjection: {
        eventCount: 4,
        eventTypes: ["station.started", "consent.accepted", "encounter.started", "actor.interaction.routed"],
        sensitiveFieldsDropped: true,
        rawRuntimeTraceStoredInReport: false,
        events: [
          {
            sequence: 0,
            eventType: "station.started",
            source: "system",
            payload: {},
          },
          {
            sequence: 1,
            eventType: "consent.accepted",
            source: "learner",
            payload: {},
          },
          {
            sequence: 2,
            eventType: "encounter.started",
            source: "system",
            payload: {},
          },
          {
            sequence: 3,
            eventType: "actor.interaction.routed",
            source: "session-state",
            actorId: "nurse_maria_alvarez_v1",
            tag: "ecg_request",
            payload: {
              learnerUtteranceRedacted: true,
              finalTranscriptTextRedacted: true,
              routingReason: "addressed_actor_name",
              traceContextTags: ["ecg_request"],
              sourceKind: "voice_transcript",
              streamId: "learner-mic-mock-001",
              transcriptSegmentId: "mock-final-transcript-001",
              provider: "mock-voice",
              provenanceRefs: ["voice:learner-mic-mock-001:mock-final-transcript-001"],
              rawAudioStored: false,
            },
          },
        ],
      },
    });
    expect(report.triggerEvidence).toEqual({
      scheduler: "deterministic_mock_trigger_scheduler",
      firedTriggers: [
        {
          triggerId: "nurse_vitals_change",
          atSecond: 420,
          actorId: "nurse_maria_alvarez_v1",
          traceTag: "vitals_review",
          traceEventType: "scenario.trigger.fired",
        },
      ],
      pendingTriggerCount: 0,
      runtimeSchedulerClaimed: false,
    });
    expect(report.prewarmEvidence).toEqual({
      executed: true,
      preparedArtifactCount: 8,
      preparedArtifactTypes: ["actor_context_card", "telemetry_labels", "trigger_rule", "voice_slot"],
      modelWeightsLoaded: false,
      voiceRuntimeLoaded: false,
      firstResponseImprovementMeasured: false,
      cleanupRequired: false,
      blockers: ["first_response_improvement_not_measured"],
    });
    const serializedReport = JSON.stringify(report);
    expect(serializedReport).not.toContain("Maria, please get an ECG");
    expect(serializedReport).not.toContain("When did the chest pressure start?");
    for (const actor of edChestPainScenario.actors) {
      for (const hiddenFact of actor.hiddenFacts ?? []) {
        expect(serializedReport).not.toContain(hiddenFact);
      }
    }
    expect(report.telemetry).toEqual({
      recorderSpanCount: 1,
      sensitiveFieldsDropped: true,
      summary: {
        buckets: [
          {
            name: "openclinxr.voice.synthesize",
            labels: {
              "openclinxr.provider_id": "mock-voice",
              "openclinxr.request_policy_id": "blueprint-voice-simulation-spike-v1",
              "openclinxr.route_id": "blueprint-voice-simulation-spike-v1",
              "openclinxr.route_surface": "local_tool_spike",
              "openclinxr.station_run_scoped": false,
            },
            count: 1,
            errorCount: 0,
            statusCodes: [],
            durationMs: {
              avg: 0,
              max: 0,
              min: 0,
              p95: 0,
            },
          },
        ],
      },
    });
    expect(report.verdict).toEqual({
      tier0BlueprintCompilerPassed: true,
      mockVoiceFacadeExercised: true,
      tier1TransportLoopPassed: false,
      tier2LocalInferenceObserved: false,
      tier3WebXrObserved: false,
      readyForProduction: false,
      blockers: [
        "tier1_bun_python_transport_loop_not_executed",
        "real_local_full_duplex_model_not_executed",
        "python_backend_runtime_not_executed_for_this_report",
        "webxr_iwsdk_client_not_executed_for_this_report",
        "quest_microphone_and_playback_not_measured",
        "clinical_voice_safety_controls_not_validated_with_real_model",
      ],
    });
  });
});
