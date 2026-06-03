import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createStep2CsStyleSeedBlueprint } from "../../../packages/openclinxr/exam-assembly/src/index.js";
import { edChestPainScenario, scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";
import {
  buildBlueprintVoiceSimulationPlan,
  buildBlueprintVoiceSimulationSpikeReport,
  main,
  validateBlueprintVoiceSimulationSpikeReport,
} from "./blueprint-voice-simulation-spike.js";

describe("blueprint-driven voice simulation spike", () => {
  it("exposes generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["local:voice:blueprint-simulation"]).toBe(
      "tsx tools/openclinxr/blueprint-voice-simulation-spike.ts",
    );
    expect(rootPackage.scripts["local:voice:blueprint-simulation:validate"]).toBe(
      "tsx tools/openclinxr/blueprint-voice-simulation-spike.ts --validate-latest",
    );
    expect(rootPackage.scripts["agent:verify"]).toContain("pnpm local:voice:blueprint-simulation:validate");
  });

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
    expect(report.multiCharacterInterruption).toMatchObject({
      exercised: true,
      source: "scenario_actor_roster_and_required_trace_tags",
      prerequisiteActorRoles: ["patient", "family", "nurse"],
      agentDialogue: {
        participantActorIds: ["spouse_anna_hayes_v1", "patient_robert_hayes_v1"],
        startedByActorId: "spouse_anna_hayes_v1",
        addressedActorId: "patient_robert_hayes_v1",
        atSecond: 250,
        traceTag: "family_communication",
        rawDialogueStored: false,
        transcriptRedacted: true,
        runtimeDialogueClaimed: false,
      },
      learnerInterruption: {
        atSecond: 255,
        routedActorId: "spouse_anna_hayes_v1",
        routingReason: "addressed_actor_name",
        traceContextTags: ["family_communication", "empathy_statement"],
        sourceKind: "voice_transcript",
        rawLearnerUtteranceStored: false,
        finalTranscriptTextRedacted: true,
      },
      traceProjection: {
        eventCount: 5,
        eventTypes: [
          "agent.dialogue.mock.started",
          "station.started",
          "consent.accepted",
          "encounter.started",
          "actor.interaction.routed",
        ],
        sensitiveFieldsDropped: true,
        rawRuntimeTraceStoredInReport: false,
      },
      hiddenFactsRedacted: true,
      limitations: [
        "agent_dialogue_content_redacted_and_not_generated_by_llm",
        "runtime_dialogue_between_virtual_actors_not_implemented",
        "real_full_duplex_interruption_timing_not_measured",
        "quest_microphone_and_playback_not_measured",
      ],
    });
    expect(report.multiCharacterInterruption.traceProjection.events.at(-1)).toMatchObject({
      eventType: "actor.interaction.routed",
      source: "session-state",
      actorId: "spouse_anna_hayes_v1",
      tag: "family_communication",
      payload: {
        learnerUtteranceRedacted: true,
        finalTranscriptTextRedacted: true,
        routingReason: "addressed_actor_name",
        traceContextTags: ["family_communication", "empathy_statement"],
        sourceKind: "voice_transcript",
        streamId: "learner-mic-mock-interrupt-001",
        transcriptSegmentId: "mock-interrupt-final-transcript-001",
        provider: "mock-voice",
        provenanceRefs: ["voice:learner-mic-mock-interrupt-001:mock-interrupt-final-transcript-001"],
        rawAudioStored: false,
      },
    });
    expect(report.transportEvidence).toMatchObject({
      linkedExistingEvidence: true,
      executedByThisReport: false,
      sourceFile: "docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json",
      sourceStatus: "blocked",
      bunPythonProxyPassed: false,
      readyForLiveDialog: false,
      runtime: {
        apiTarget: "apps/api bun+hono",
        pythonBackendTarget: "apps/api-python-backend fastapi",
        websocketPath: "/voice/realtime/ws",
        backendProtocol: "python-fastapi-compatible-websocket",
      },
      observed: {
        connected: false,
        backendProtocolObserved: false,
        latencyFieldsObserved: false,
        binaryEchoObserved: false,
        eventTypesObserved: [],
      },
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        http3Enabled: false,
        webTransportUsed: false,
        quicUsed: false,
        web3Used: false,
        questHardwareClaimed: false,
        lowLatencyClaimed: false,
      },
      caveats: expect.arrayContaining([
        "This smoke proves only the local Bun-to-FastAPI WebSocket proxy path.",
      ]),
      blockers: expect.arrayContaining([
        "real_model_inference_not_observed",
        "quest_browser_audio_capture_not_observed",
      ]),
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
    expect(serializedReport).not.toContain("I hear your concern");
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

  it("blocks linked transport evidence when its local-only policy boundary is dirty", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openclinxr-blueprint-voice-transport-"));
    const dirtyTransportEvidenceFile = path.join(tempDir, "api-bun-python-proxy-runtime-smoke-dirty.json");
    await writeFile(dirtyTransportEvidenceFile, `${JSON.stringify({
      status: "passed",
      runtime: {
        apiTarget: "apps/api bun+hono",
        pythonBackendTarget: "apps/api-python-backend fastapi",
        websocketPath: "/voice/realtime/ws",
        backendProtocol: "python-fastapi-compatible-websocket",
      },
      websocket: {
        connected: true,
        backendProtocolObserved: true,
        latencyFieldsObserved: true,
        binaryEchoObserved: true,
        eventTypesObserved: [
          "gateway.ready",
          "backend.ready",
          "voice.started",
          "audio.chunk",
          "transcript.partial",
          "transcript.final",
          "voice.stopped",
        ],
      },
      policy: {
        cloudApisUsed: true,
        paidApisUsed: true,
        http3Enabled: true,
        webTransportUsed: true,
        quicUsed: false,
        web3Used: false,
        questHardwareClaimed: false,
        lowLatencyClaimed: true,
      },
      verdict: {
        blockers: [],
        caveats: [],
      },
    }, null, 2)}\n`);

    const report = await buildBlueprintVoiceSimulationSpikeReport({
      generatedAt: "2026-05-05T21:05:00.000Z",
      blueprint: createStep2CsStyleSeedBlueprint(scenarioBank),
      scenarios: scenarioBank,
      scenarioId: "ed_chest_pain_priority_v1",
      learnerUtterance: "Maria, please get an ECG and repeat the vitals.",
      atSecond: 135,
      transportEvidenceSourceFile: dirtyTransportEvidenceFile,
    });

    expect(report.transportEvidence).toMatchObject({
      sourceFile: dirtyTransportEvidenceFile,
      sourceStatus: "passed",
      bunPythonProxyPassed: false,
      policy: {
        cloudApisUsed: true,
        paidApisUsed: true,
        http3Enabled: true,
        webTransportUsed: true,
        quicUsed: false,
        web3Used: false,
        questHardwareClaimed: false,
        lowLatencyClaimed: true,
      },
      blockers: ["transport_policy_boundary_not_clean"],
      caveats: ["transport_policy_boundary_not_clean"],
    });
    expect(report.verdict).toMatchObject({
      tier1TransportLoopPassed: false,
      readyForProduction: false,
    });
    expect(report.verdict.blockers).toContain("tier1_transport_policy_boundary_not_clean");
  });

  it("validates the latest blueprint voice simulation evidence privacy and claim boundaries", async () => {
    const report = JSON.parse(
      await readFile("docs/openclinxr/blueprint-voice-simulation-spike-2026-05-05.json", "utf8"),
    );

    expect(validateBlueprintVoiceSimulationSpikeReport(report)).toEqual({ ok: true });

    const invalid = structuredClone(report) as {
      policy: Partial<{ productionUseAllowed: boolean }>;
      transportEvidence: { readyForLiveDialog: boolean };
      verdict: { readyForProduction: boolean };
    };
    delete invalid.policy.productionUseAllowed;
    invalid.transportEvidence.readyForLiveDialog = true;
    invalid.verdict.readyForProduction = true;

    expect(validateBlueprintVoiceSimulationSpikeReport(invalid)).toEqual({
      ok: false,
      errors: [
        "/policy/productionUseAllowed must be false",
        "/transportEvidence/readyForLiveDialog must be false",
        "/verdict/readyForProduction must be false",
      ],
    });
  });

  it("requires verdict transport blockers to match linked transport evidence posture", async () => {
    const report = JSON.parse(
      await readFile("docs/openclinxr/blueprint-voice-simulation-spike-2026-05-05.json", "utf8"),
    );
    const requiredTransportBlocker = report.verdict.blockers.find(
      (blocker: string) => blocker.startsWith("tier1_"),
    );
    const invalid = structuredClone(report) as {
      verdict: { blockers: string[]; tier1TransportLoopPassed: boolean };
    };
    invalid.verdict.blockers = invalid.verdict.blockers.filter(
      (blocker) => blocker !== requiredTransportBlocker,
    );
    invalid.verdict.tier1TransportLoopPassed = false;

    expect(validateBlueprintVoiceSimulationSpikeReport(invalid)).toEqual({
      ok: false,
      errors: [
        "/verdict/tier1TransportLoopPassed must match /transportEvidence/bunPythonProxyPassed",
        `/verdict/blockers missing expected blocker ${requiredTransportBlocker}`,
      ],
    });
  });

  it("validates CLI reports by explicit path and latest evidence path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-blueprint-voice-validate-"));
    try {
      const report = JSON.parse(
        await readFile("docs/openclinxr/blueprint-voice-simulation-spike-2026-05-05.json", "utf8"),
      );
      const output = path.join(dir, "report.json");
      await writeFile(output, JSON.stringify(report, null, 2));

      await expect(main(["--validate", output])).resolves.toBeUndefined();
      await expect(main(["--validate-latest"])).resolves.toBeUndefined();

      const invalid = structuredClone(report) as {
        mockLoop: { rawAudioStored: boolean };
      };
      invalid.mockLoop.rawAudioStored = true;
      const invalidOutput = path.join(dir, "invalid-report.json");
      await writeFile(invalidOutput, JSON.stringify(invalid, null, 2));
      process.exitCode = undefined;

      await expect(main(["--validate", invalidOutput])).resolves.toBeUndefined();

      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = undefined;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
