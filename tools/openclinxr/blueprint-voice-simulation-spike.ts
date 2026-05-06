import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createScenarioPlaceholderManifests, InMemoryAssetRegistry } from "../../packages/openclinxr/asset-registry/src/index.js";
import { createStep2CsStyleSeedBlueprint, type ExamBlueprint } from "../../packages/openclinxr/exam-assembly/src/index.js";
import { createDefaultModelGateway, MockModelProviderAdapter } from "../../packages/openclinxr/model-gateway/src/index.js";
import { scenarioBank } from "../../packages/openclinxr/scenario-fixtures/src/index.js";
import { ScenarioRuntime } from "../../packages/openclinxr/scenario-runtime/src/index.js";
import type { InteractionRoutingReason } from "../../packages/openclinxr/session-state/src/index.js";
import type { Scenario, TraceEvent } from "../../packages/openclinxr/shared-schemas/src/index.js";
import {
  createInMemoryTelemetryRecorder,
  openClinXrSpanNames,
  safeTelemetryAttributes,
  summarizeTelemetrySpans,
} from "../../packages/openclinxr/telemetry/src/index.js";
import { InMemoryTraceLedger } from "../../packages/openclinxr/trace-ledger/src/index.js";
import {
  collectVoiceStream,
  createDefaultVoiceGateway,
  MockVoiceProviderAdapter,
  type TranscriptEvent,
} from "../../packages/openclinxr/voice-gateway/src/index.js";
import { writeJson } from "../agent-factory/lib.js";

type CliOptions = {
  outputPath?: string;
  scenarioId?: string;
  learnerUtterance?: string;
  atSecond?: number;
};

type VoiceSimulationPolicy = {
  cloudApisUsed: false;
  paidApisUsed: false;
  modelDownloadsPerformed: false;
  productionUseAllowed: false;
  rawAudioStored: false;
  hiddenFactsExposedToLearner: false;
};

type LinkedTransportEvidence = {
  linkedExistingEvidence: boolean;
  executedByThisReport: false;
  sourceFile: string;
  sourceStatus: "passed" | "blocked" | "missing" | "unreadable";
  bunPythonProxyPassed: boolean;
  readyForLiveDialog: false;
  runtime: {
    apiTarget: string | null;
    pythonBackendTarget: string | null;
    websocketPath: string | null;
    backendProtocol: string | null;
  };
  observed: {
    connected: boolean;
    backendProtocolObserved: boolean;
    latencyFieldsObserved: boolean;
    binaryEchoObserved: boolean;
    eventTypesObserved: string[];
  };
  policy: {
    cloudApisUsed: false;
    paidApisUsed: false;
    http3Enabled: false;
    webTransportUsed: false;
    quicUsed: false;
    web3Used: false;
    questHardwareClaimed: false;
    lowLatencyClaimed: false;
  };
  blockers: string[];
  caveats: string[];
};

export type ActorVoicePlan = {
  actorId: string;
  role: Scenario["actors"][number]["role"];
  displayName: string;
  demeanor: string;
  voiceId: string;
  personalityTags: string[];
  emotionTags: string[];
  hiddenFactCount: number;
  hiddenFactsRedacted: true;
};

export type BlueprintVoiceSimulationPlan = {
  blueprintId: string;
  station: {
    stationOrder: number;
    slotId: string;
    scenarioId: string;
    scenarioVersion: number;
    title: string;
    timing: ExamBlueprint["timing"];
    environmentId: string | null;
  };
  policy: VoiceSimulationPolicy;
  actorRoster: ActorVoicePlan[];
  voiceSlots: Array<{
    actorId: string;
    voiceId: string;
    provider: "mock-voice";
    providerTier: "deterministic_mock_first";
    localRuntimeStatus: "not_executed";
  }>;
  triggerPlan: Array<{
    triggerId: string;
    triggerType: "timed_event";
    atSecond: number;
    actorId: string;
    traceTag: string;
    learnerInterruptible: true;
  }>;
  privacyRules: {
    learnerView: "redact_hidden_facts";
    disclosureRequiresTrigger: boolean;
    actorHiddenFactCounts: Array<{ actorId: string; hiddenFactCount: number }>;
  };
  traceExpectations: {
    requiredTraceTags: string[];
    safetyCriticalTraceTags: string[];
    rubricTraceTags: Array<{ rubricId: string; label: string; requiredTraceTags: string[] }>;
  };
  prewarmPlan: {
    allowed: true;
    steps: string[];
    artifacts: Array<{
      artifactType: "actor_context_card" | "voice_slot" | "trigger_rule" | "telemetry_labels";
      id: string;
    }>;
  };
  telemetryAttributes: ReturnType<typeof safeTelemetryAttributes>;
};

export type BlueprintVoiceSimulationSpikeReport = {
  generatedAt: string;
  status: "mock_facade_exercised" | "blocked";
  policy: VoiceSimulationPolicy;
  plan: BlueprintVoiceSimulationPlan;
  mockLoop: {
    learnerUtteranceStored: false;
    rawAudioStored: false;
    selectedActorId: string;
    routingReason: InteractionRoutingReason;
    routingSource: "scenario_runtime";
    transcript: {
      eventCount: number;
      finalTextRedacted: true;
    };
    synthesis: {
      audioChunkCount: number;
      firstAudiblePlaybackLatencyMs: number | null;
      providerId: string | null;
    };
    traceEvents: TraceEvent[];
  };
  runtimeRouting: {
    exercised: boolean;
    routeSource: "scenario_runtime";
    stationRunScoped: true;
    selectedActorId: string;
    routingReason: InteractionRoutingReason;
    conversationTurn: number;
    sourceKind: "voice_transcript";
    traceProjection: {
      eventCount: number;
      eventTypes: string[];
      sensitiveFieldsDropped: boolean;
      rawRuntimeTraceStoredInReport: false;
      events: Array<{
        sequence: number;
        eventType: string;
        source: string;
        actorId?: string;
        tag?: string;
        payload: Record<string, unknown>;
      }>;
    };
  };
  transportEvidence: LinkedTransportEvidence;
  telemetry: {
    recorderSpanCount: number;
    sensitiveFieldsDropped: boolean;
    summary: ReturnType<typeof summarizeTelemetrySpans>;
  };
  triggerEvidence: {
    scheduler: "deterministic_mock_trigger_scheduler";
    firedTriggers: Array<{
      triggerId: string;
      atSecond: number;
      actorId: string;
      traceTag: string;
      traceEventType: "scenario.trigger.fired";
    }>;
    pendingTriggerCount: number;
    runtimeSchedulerClaimed: false;
  };
  prewarmEvidence: {
    executed: boolean;
    preparedArtifactCount: number;
    preparedArtifactTypes: string[];
    modelWeightsLoaded: false;
    voiceRuntimeLoaded: false;
    firstResponseImprovementMeasured: false;
    cleanupRequired: false;
    blockers: string[];
  };
  verdict: {
    tier0BlueprintCompilerPassed: boolean;
    mockVoiceFacadeExercised: boolean;
    tier1TransportLoopPassed: boolean;
    tier2LocalInferenceObserved: false;
    tier3WebXrObserved: false;
    readyForProduction: false;
    blockers: string[];
  };
};

const defaultTransportEvidenceSourceFile = "docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildBlueprintVoiceSimulationSpikeReport({
    blueprint: createStep2CsStyleSeedBlueprint(scenarioBank),
    scenarios: scenarioBank,
    scenarioId: options.scenarioId ?? "ed_chest_pain_priority_v1",
    learnerUtterance: options.learnerUtterance ?? "Maria, please get an ECG and repeat the vitals.",
    atSecond: options.atSecond ?? 135,
  });

  if (options.outputPath) {
    await writeJson(options.outputPath, report);
    console.log(`Wrote ${options.outputPath}`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {};

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--scenario-id") {
      options.scenarioId = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--learner-utterance") {
      options.learnerUtterance = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--at-second") {
      options.atSecond = Number.parseInt(requireValue(normalizedArgs, index, arg), 10);
      if (!Number.isFinite(options.atSecond)) {
        throw new Error("--at-second requires an integer");
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function buildBlueprintVoiceSimulationPlan(input: {
  blueprint: ExamBlueprint;
  scenarios: readonly Scenario[];
  scenarioId: string;
}): BlueprintVoiceSimulationPlan {
  const scenarioIndex = input.scenarios.findIndex((candidate) => candidate.scenarioId === input.scenarioId);
  const scenario = input.scenarios[scenarioIndex];
  if (!scenario) {
    throw new Error(`Scenario not found for blueprint voice simulation: ${input.scenarioId}`);
  }

  const stationSlot = findStationSlotForScenario(input.blueprint, scenario, scenarioIndex);
  if (!stationSlot) {
    throw new Error(`Blueprint station slot not found for scenario: ${input.scenarioId}`);
  }

  const actorRoster = scenario.actors.map(actorVoicePlan);
  const voiceSlots = actorRoster.map((actor) => ({
    actorId: actor.actorId,
    voiceId: actor.voiceId,
    provider: "mock-voice" as const,
    providerTier: "deterministic_mock_first" as const,
    localRuntimeStatus: "not_executed" as const,
  }));

  return {
    blueprintId: input.blueprint.blueprintId,
    station: {
      stationOrder: stationSlot.order,
      slotId: stationSlot.slotId,
      scenarioId: scenario.scenarioId,
      scenarioVersion: scenario.version,
      title: scenario.title,
      timing: { ...input.blueprint.timing },
      environmentId: scenario.environment?.environmentId ?? null,
    },
    policy: simulationPolicy(),
    actorRoster,
    voiceSlots,
    triggerPlan: scenario.eventSchedule.map((event) => ({
      triggerId: event.eventId,
      triggerType: "timed_event" as const,
      atSecond: event.atSecond,
      actorId: event.actorId,
      traceTag: event.tag,
      learnerInterruptible: true as const,
    })),
    privacyRules: {
      learnerView: scenario.governance.hiddenFactPolicy.learnerView,
      disclosureRequiresTrigger: scenario.governance.hiddenFactPolicy.disclosureRequiresTrigger,
      actorHiddenFactCounts: scenario.actors.map((actor) => ({
        actorId: actor.actorId,
        hiddenFactCount: actor.hiddenFacts?.length ?? 0,
      })),
    },
    traceExpectations: {
      requiredTraceTags: [...scenario.requiredTraceTags],
      safetyCriticalTraceTags: [...scenario.governance.safetyCriticalTraceTags],
      rubricTraceTags: scenario.reviewRubric.map((item) => ({
        rubricId: item.rubricId,
        label: item.label,
        requiredTraceTags: [...item.requiredTraceTags],
      })),
    },
    prewarmPlan: {
      allowed: true,
      steps: [
        "compile_actor_context_cards",
        "prepare_mock_voice_slots",
        "prepare_trigger_scheduler",
        "prepare_safe_telemetry_labels",
      ],
      artifacts: [
        ...actorRoster.map((actor) => ({
          artifactType: "actor_context_card" as const,
          id: actor.actorId,
        })),
        ...voiceSlots.map((slot) => ({
          artifactType: "voice_slot" as const,
          id: slot.voiceId,
        })),
        ...scenario.eventSchedule.map((event) => ({
          artifactType: "trigger_rule" as const,
          id: event.eventId,
        })),
        {
          artifactType: "telemetry_labels",
          id: `${scenario.scenarioId}:safe-telemetry`,
        },
      ],
    },
    telemetryAttributes: safeTelemetryAttributes({
      scenarioId: scenario.scenarioId,
      scenarioVersion: scenario.version,
      routeId: "blueprint-voice-simulation-spike-v1",
      routeSurface: "local_tool_spike",
      stationRunScoped: false,
    }),
  };
}

export async function buildBlueprintVoiceSimulationSpikeReport(input: {
  generatedAt?: string;
  blueprint: ExamBlueprint;
  scenarios: readonly Scenario[];
  scenarioId: string;
  learnerUtterance: string;
  atSecond: number;
}): Promise<BlueprintVoiceSimulationSpikeReport> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const scenario = requireScenario(input.scenarios, input.scenarioId);
  const plan = buildBlueprintVoiceSimulationPlan(input);
  const triggerEvidence = buildTriggerEvidence(plan);
  const prewarmEvidence = buildPrewarmEvidence(plan);
  const transportEvidence = buildLinkedTransportEvidence();
  const primaryTraceTag = inferPrimaryTraceTag(input.learnerUtterance, plan.traceExpectations.requiredTraceTags);
  const gateway = createDefaultVoiceGateway({
    routeId: "blueprint-voice-simulation-spike-v1",
    adapters: [new MockVoiceProviderAdapter()],
  });
  const policy = {
    requestPolicyId: "blueprint-voice-simulation-spike-v1",
    safetyPolicyVersion: "clinical-simulation-safety-v1",
  };
  const transcriptEvents = await collectVoiceStream(gateway.transcribe({
    stationRunId: "blueprint_voice_simulation_mock_run_001",
    streamId: "learner-mic-mock-001",
    language: "en-US",
    audioFormat: "mock/pcm",
    policy,
  }));
  const finalTranscript = transcriptEvents.find((event) => event.eventType === "final_transcript");
  const runtimeRouting = await buildRuntimeRoutingEvidence({
    scenario,
    learnerUtterance: input.learnerUtterance,
    atSecond: input.atSecond,
    traceTag: primaryTraceTag,
    transcriptEvents,
  });
  const selectedActor = requireActorVoicePlan(plan, runtimeRouting.selectedActorId);
  const audioEvents = await collectVoiceStream(gateway.synthesize({
    stationRunId: "blueprint_voice_simulation_mock_run_001",
    actorId: selectedActor.actorId,
    voiceId: selectedActor.voiceId,
    text: mockActorSpeech(selectedActor, primaryTraceTag),
    policy,
  }));
  const firstAudio = audioEvents[0];
  const telemetry = createInMemoryTelemetryRecorder();
  telemetry.recordSpan({
    name: openClinXrSpanNames.voiceSynthesize,
    attributes: safeTelemetryAttributes({
      scenarioId: plan.station.scenarioId,
      scenarioVersion: plan.station.scenarioVersion,
      actorId: selectedActor.actorId,
      providerId: firstAudio?.provenance.providerId ?? "mock-voice",
      requestPolicyId: policy.requestPolicyId,
      routeId: "blueprint-voice-simulation-spike-v1",
      routeSurface: "local_tool_spike",
      stationRunScoped: false,
    }),
    durationMs: firstAudio?.provenance.latencyMs ?? 0,
  });
  const traceEvents: TraceEvent[] = [
    {
      stationRunId: "blueprint_voice_simulation_mock_run_001",
      sequence: 0,
      eventType: "voice.transcript.final",
      occurredAt: generatedAt,
      atSecond: input.atSecond,
      source: "mock-voice-gateway",
      actorId: selectedActor.actorId,
      tag: primaryTraceTag,
      payload: {
        transcriptEventCount: transcriptEvents.length,
        confidence: finalTranscript?.confidence ?? null,
        rawTranscriptRedacted: true,
      },
    },
    {
      stationRunId: "blueprint_voice_simulation_mock_run_001",
      sequence: 1,
      eventType: "voice.audio.generated",
      occurredAt: generatedAt,
      atSecond: input.atSecond,
      source: "mock-voice-gateway",
      actorId: selectedActor.actorId,
      tag: primaryTraceTag,
      payload: {
        audioFormat: firstAudio?.audioFormat ?? null,
        audioChunkCount: audioEvents.length,
        rawAudioStored: false,
        visemeCuesPresent: audioEvents.every((event) => Boolean(event.visemeCue)),
      },
    },
  ];

  return {
    generatedAt,
    status: "mock_facade_exercised",
    policy: simulationPolicy(),
    plan,
    mockLoop: {
      learnerUtteranceStored: false,
      rawAudioStored: false,
      selectedActorId: selectedActor.actorId,
      routingReason: runtimeRouting.routingReason,
      routingSource: "scenario_runtime",
      transcript: {
        eventCount: transcriptEvents.length,
        finalTextRedacted: true,
      },
      synthesis: {
        audioChunkCount: audioEvents.length,
        firstAudiblePlaybackLatencyMs: firstAudio?.provenance.latencyMs ?? null,
        providerId: firstAudio?.provenance.providerId ?? null,
      },
      traceEvents,
    },
    runtimeRouting,
    transportEvidence,
    telemetry: {
      recorderSpanCount: telemetry.spans().length,
      sensitiveFieldsDropped: sensitiveTelemetryFieldsDropped(input.learnerUtterance),
      summary: summarizeTelemetrySpans(telemetry.spans()),
    },
    triggerEvidence,
    prewarmEvidence,
    verdict: {
      tier0BlueprintCompilerPassed: true,
      mockVoiceFacadeExercised: transcriptEvents.length > 0 && audioEvents.length > 0,
      tier1TransportLoopPassed: transportEvidence.bunPythonProxyPassed,
      tier2LocalInferenceObserved: false,
      tier3WebXrObserved: false,
      readyForProduction: false,
      blockers: [
        transportEvidence.bunPythonProxyPassed
          ? "tier1_transport_linked_but_not_executed_by_blueprint_report"
          : "tier1_bun_python_transport_loop_not_executed",
        "real_local_full_duplex_model_not_executed",
        "python_backend_runtime_not_executed_for_this_report",
        "webxr_iwsdk_client_not_executed_for_this_report",
        "quest_microphone_and_playback_not_measured",
        "clinical_voice_safety_controls_not_validated_with_real_model",
      ],
    },
  };
}

async function buildRuntimeRoutingEvidence(input: {
  scenario: Scenario;
  learnerUtterance: string;
  atSecond: number;
  traceTag: string;
  transcriptEvents: TranscriptEvent[];
}): Promise<BlueprintVoiceSimulationSpikeReport["runtimeRouting"]> {
  const runtime = createScenarioRuntime(input.scenario);
  const session = await runtime.startSession({
    learnerId: "blueprint_voice_simulation_mock_learner",
    consentAccepted: true,
  });
  runtime.startEncounter(session.stationRunId, { atSecond: Math.max(0, Math.min(60, input.atSecond)) });

  const streamId = "learner-mic-mock-001";
  const transcriptSegmentId = "mock-final-transcript-001";
  const finalTranscript = input.transcriptEvents.find((event) => event.eventType === "final_transcript");
  const routed = runtime.routeActorInteractionTurn(session.stationRunId, {
    atSecond: input.atSecond,
    learnerUtterance: input.learnerUtterance,
    traceContextTags: [input.traceTag],
    source: {
      kind: "voice_transcript",
      streamId,
      transcriptSegmentId,
      finalTranscriptText: input.learnerUtterance,
      provider: finalTranscript?.provenance.providerId ?? "mock-voice",
      provenanceRefs: [`voice:${streamId}:${transcriptSegmentId}`],
      rawAudioStored: false,
    },
  });

  const projectedEvents = runtime.traceEvents(session.stationRunId).map(projectRuntimeTraceEvent);
  return {
    exercised: true,
    routeSource: "scenario_runtime",
    stationRunScoped: true,
    selectedActorId: routed.routedActorId,
    routingReason: routed.routingReason,
    conversationTurn: routed.conversationTurn,
    sourceKind: "voice_transcript",
    traceProjection: {
      eventCount: projectedEvents.length,
      eventTypes: projectedEvents.map((event) => event.eventType),
      sensitiveFieldsDropped: projectionDropsSensitiveFields(projectedEvents, input.learnerUtterance),
      rawRuntimeTraceStoredInReport: false,
      events: projectedEvents,
    },
  };
}

function createScenarioRuntime(scenario: Scenario): ScenarioRuntime {
  const assetRegistry = new InMemoryAssetRegistry();
  for (const manifest of createScenarioPlaceholderManifests(scenario)) {
    assetRegistry.upsert(manifest);
  }

  return new ScenarioRuntime({
    scenario,
    ledger: new InMemoryTraceLedger(),
    assetRegistry,
    modelGateway: createDefaultModelGateway({
      routeId: "blueprint-voice-simulation-spike-v1",
      adapters: [new MockModelProviderAdapter()],
    }),
    voiceGateway: createDefaultVoiceGateway({
      routeId: "blueprint-voice-simulation-spike-v1",
      adapters: [new MockVoiceProviderAdapter()],
    }),
  });
}

function projectRuntimeTraceEvent(event: TraceEvent): BlueprintVoiceSimulationSpikeReport["runtimeRouting"]["traceProjection"]["events"][number] {
  return withOptionalTraceFields({
    sequence: event.sequence,
    eventType: event.eventType,
    source: event.source,
    payload: projectRuntimeTracePayload(event.payload ?? {}),
  }, event);
}

function withOptionalTraceFields(
  projected: {
    sequence: number;
    eventType: string;
    source: string;
    payload: Record<string, unknown>;
  },
  event: TraceEvent,
): BlueprintVoiceSimulationSpikeReport["runtimeRouting"]["traceProjection"]["events"][number] {
  return {
    ...projected,
    ...(event.actorId ? { actorId: event.actorId } : {}),
    ...(event.tag ? { tag: event.tag } : {}),
  };
}

function projectRuntimeTracePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "learnerUtterance") {
      projected.learnerUtteranceRedacted = true;
      continue;
    }
    if (key === "finalTranscriptText") {
      projected.finalTranscriptTextRedacted = true;
      continue;
    }
    if (key === "text") {
      projected.textRedacted = true;
      continue;
    }
    projected[key] = Array.isArray(value) ? [...value] : value;
  }

  if (projected.sourceKind === "voice_transcript") {
    projected.finalTranscriptTextRedacted = true;
  }

  return projected;
}

function projectionDropsSensitiveFields(
  projectedEvents: BlueprintVoiceSimulationSpikeReport["runtimeRouting"]["traceProjection"]["events"],
  learnerUtterance: string,
): boolean {
  const serialized = JSON.stringify(projectedEvents);
  return !serialized.includes(learnerUtterance)
    && !serialized.includes("\"learnerUtterance\":")
    && !serialized.includes("\"finalTranscriptText\":")
    && !serialized.includes("\"text\":")
    && !serialized.includes("rawAudioBytes")
    && !serialized.includes("rawAudioBase64")
    && !serialized.includes("audioData");
}

function buildLinkedTransportEvidence(sourceFile = defaultTransportEvidenceSourceFile): LinkedTransportEvidence {
  if (!existsSync(sourceFile)) {
    return emptyTransportEvidence(sourceFile, "missing");
  }

  try {
    const report = asRecord(JSON.parse(readFileSync(sourceFile, "utf8")));
    const runtime = asRecord(report.runtime);
    const websocket = asRecord(report.websocket);
    const policy = asRecord(report.policy);
    const verdict = asRecord(report.verdict);
    const sourceStatus = report.status === "passed" ? "passed" : "blocked";
    const bunPythonProxyPassed = sourceStatus === "passed"
      && websocket.connected === true
      && websocket.backendProtocolObserved === true
      && websocket.latencyFieldsObserved === true
      && websocket.binaryEchoObserved === true;

    return {
      linkedExistingEvidence: true,
      executedByThisReport: false,
      sourceFile,
      sourceStatus,
      bunPythonProxyPassed,
      readyForLiveDialog: false,
      runtime: {
        apiTarget: stringOrNull(runtime.apiTarget),
        pythonBackendTarget: stringOrNull(runtime.pythonBackendTarget),
        websocketPath: stringOrNull(runtime.websocketPath),
        backendProtocol: stringOrNull(runtime.backendProtocol),
      },
      observed: {
        connected: websocket.connected === true,
        backendProtocolObserved: websocket.backendProtocolObserved === true,
        latencyFieldsObserved: websocket.latencyFieldsObserved === true,
        binaryEchoObserved: websocket.binaryEchoObserved === true,
        eventTypesObserved: stringArray(websocket.eventTypesObserved),
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
      blockers: stringArray(verdict.blockers),
      caveats: [
        ...stringArray(verdict.caveats),
        ...(policy.cloudApisUsed === false
          && policy.paidApisUsed === false
          && policy.http3Enabled === false
          && policy.webTransportUsed === false
          && policy.quicUsed === false
          && policy.web3Used === false
          ? []
          : ["transport_policy_boundary_not_clean"]),
      ],
    };
  } catch {
    return emptyTransportEvidence(sourceFile, "unreadable");
  }
}

function emptyTransportEvidence(
  sourceFile: string,
  sourceStatus: LinkedTransportEvidence["sourceStatus"],
): LinkedTransportEvidence {
  return {
    linkedExistingEvidence: false,
    executedByThisReport: false,
    sourceFile,
    sourceStatus,
    bunPythonProxyPassed: false,
    readyForLiveDialog: false,
    runtime: {
      apiTarget: null,
      pythonBackendTarget: null,
      websocketPath: null,
      backendProtocol: null,
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
    blockers: [`transport_evidence_${sourceStatus}`],
    caveats: ["No linked Bun-to-FastAPI WebSocket evidence was available to this blueprint report."],
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function buildTriggerEvidence(plan: BlueprintVoiceSimulationPlan): BlueprintVoiceSimulationSpikeReport["triggerEvidence"] {
  return {
    scheduler: "deterministic_mock_trigger_scheduler",
    firedTriggers: plan.triggerPlan.map((trigger) => ({
      triggerId: trigger.triggerId,
      atSecond: trigger.atSecond,
      actorId: trigger.actorId,
      traceTag: trigger.traceTag,
      traceEventType: "scenario.trigger.fired",
    })),
    pendingTriggerCount: 0,
    runtimeSchedulerClaimed: false,
  };
}

function buildPrewarmEvidence(plan: BlueprintVoiceSimulationPlan): BlueprintVoiceSimulationSpikeReport["prewarmEvidence"] {
  return {
    executed: true,
    preparedArtifactCount: plan.prewarmPlan.artifacts.length,
    preparedArtifactTypes: uniqueSorted(plan.prewarmPlan.artifacts.map((artifact) => artifact.artifactType)),
    modelWeightsLoaded: false,
    voiceRuntimeLoaded: false,
    firstResponseImprovementMeasured: false,
    cleanupRequired: false,
    blockers: ["first_response_improvement_not_measured"],
  };
}

function sensitiveTelemetryFieldsDropped(learnerUtterance: string): boolean {
  return Object.keys(safeTelemetryAttributes({
    learnerUtterance,
    hiddenFacts: ["redacted hidden fact"],
    patientNoteText: "redacted patient note",
    promptText: "redacted prompt",
    rawAudioReference: "audio://redacted",
  })).length === 0;
}

function findStationSlotForScenario(
  blueprint: ExamBlueprint,
  scenario: Scenario,
  fallbackIndex: number,
): ExamBlueprint["stationSlots"][number] | undefined {
  const slotByScenarioId = blueprint.stationSlots.find((slot) => slot.slotId.includes(scenario.scenarioId));
  if (slotByScenarioId) {
    return slotByScenarioId;
  }

  const slotByTitle = blueprint.stationSlots.find((slot) => slot.label === scenario.title);
  if (slotByTitle) {
    return slotByTitle;
  }

  const scenarioEnvironmentId = scenario.environment?.environmentId;
  const slotByCoverage = blueprint.stationSlots.find((slot) =>
    (!scenarioEnvironmentId || slot.requiredEnvironmentIds.includes(scenarioEnvironmentId))
    && slot.requiredTraceTags.every((tag) => scenario.requiredTraceTags.includes(tag))
  );
  if (slotByCoverage) {
    return slotByCoverage;
  }

  return blueprint.stationSlots[fallbackIndex];
}

function simulationPolicy(): VoiceSimulationPolicy {
  return {
    cloudApisUsed: false,
    paidApisUsed: false,
    modelDownloadsPerformed: false,
    productionUseAllowed: false,
    rawAudioStored: false,
    hiddenFactsExposedToLearner: false,
  };
}

function actorVoicePlan(actor: Scenario["actors"][number]): ActorVoicePlan {
  const demeanor = actor.demeanor ?? "";
  return {
    actorId: actor.actorId,
    role: actor.role,
    displayName: actor.displayName,
    demeanor,
    voiceId: `mock-${actor.actorId.replaceAll("_", "-")}`,
    personalityTags: extractTags(demeanor, personalityLexicon),
    emotionTags: extractTags(demeanor, emotionLexicon),
    hiddenFactCount: actor.hiddenFacts?.length ?? 0,
    hiddenFactsRedacted: true,
  };
}

function extractTags(text: string, lexicon: readonly string[]): string[] {
  const normalized = text.toLowerCase();
  return lexicon.filter((tag) => normalized.includes(tag));
}

function requireActorVoicePlan(plan: BlueprintVoiceSimulationPlan, actorId: string): ActorVoicePlan {
  const actor = plan.actorRoster.find((candidate) => candidate.actorId === actorId);
  if (!actor) {
    throw new Error(`Actor voice plan not found for runtime route: ${actorId}`);
  }
  return actor;
}

function requireScenario(scenarios: readonly Scenario[], scenarioId: string): Scenario {
  const scenario = scenarios.find((candidate) => candidate.scenarioId === scenarioId);
  if (!scenario) {
    throw new Error(`Scenario not found for blueprint voice simulation: ${scenarioId}`);
  }
  return scenario;
}

function inferPrimaryTraceTag(utterance: string, requiredTraceTags: readonly string[]): string {
  const normalized = utterance.toLowerCase();
  const prioritizedMatches: Array<[string, string[]]> = [
    ["ecg_request", ["ecg", "12-lead", "twelve lead"]],
    ["urgent_escalation", ["urgent", "escalate", "attending", "cardiology"]],
    ["vitals_review", ["vitals", "blood pressure", "pulse", "repeat"]],
    ["team_communication", ["nurse", "team", "maria"]],
    ["family_communication", ["family", "spouse", "anna"]],
    ["empathy_statement", ["sorry", "scary", "worry", "understand"]],
  ];
  return prioritizedMatches.find(([tag, terms]) =>
    requiredTraceTags.includes(tag) && terms.some((term) => normalized.includes(term))
  )?.[0] ?? requiredTraceTags[0] ?? "unmapped_voice_turn";
}

function mockActorSpeech(actor: ActorVoicePlan, traceTag: string): string {
  if (traceTag === "ecg_request" && actor.role === "nurse") {
    return `${actor.displayName}: I will get the ECG and repeat the vitals now.`;
  }
  return `${actor.displayName}: I hear you. I will respond within the scenario role.`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

const emotionLexicon = [
  "angry",
  "anxious",
  "diaphoretic",
  "frightened",
  "happy",
  "scared",
  "tearful",
  "worried",
] as const;

const personalityLexicon = [
  "direct",
  "focused",
  "guarded",
  "interrupting",
  "outgoing",
  "protective",
  "snarky",
  "timid",
  "withdrawn",
] as const;

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
