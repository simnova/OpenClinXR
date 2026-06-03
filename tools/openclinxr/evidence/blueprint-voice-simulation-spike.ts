import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createScenarioPlaceholderManifests, InMemoryAssetRegistry } from "../../../packages/openclinxr/asset-registry/src/index.js";
import { createStep2CsStyleSeedBlueprint, type ExamBlueprint } from "../../../packages/openclinxr/exam-assembly/src/index.js";
import { createDefaultModelGateway, MockModelProviderAdapter } from "../../../packages/openclinxr/model-gateway/src/index.js";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";
import { ScenarioRuntime } from "../../../packages/openclinxr/scenario-runtime/src/index.js";
import type { InteractionRoutingReason } from "../../../packages/openclinxr/session-state/src/index.js";
import type { Scenario, TraceEvent } from "../../../packages/openclinxr/shared-schemas/src/index.js";
import {
  createInMemoryTelemetryRecorder,
  openClinXrSpanNames,
  safeTelemetryAttributes,
  summarizeTelemetrySpans,
} from "../../../packages/openclinxr/telemetry/src/index.js";
import { InMemoryTraceLedger } from "../../../packages/openclinxr/trace-ledger/src/index.js";
import {
  collectVoiceStream,
  createDefaultVoiceGateway,
  MockVoiceProviderAdapter,
  type TranscriptEvent,
} from "../../../packages/openclinxr/voice-gateway/src/index.js";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";

type CliOptions = {
  outputPath?: string;
  scenarioId?: string;
  learnerUtterance?: string;
  atSecond?: number;
  validatePath?: string;
  validateLatest: boolean;
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
    cloudApisUsed: boolean;
    paidApisUsed: boolean;
    http3Enabled: boolean;
    webTransportUsed: boolean;
    quicUsed: boolean;
    web3Used: boolean;
    questHardwareClaimed: boolean;
    lowLatencyClaimed: boolean;
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
  multiCharacterInterruption: {
    exercised: boolean;
    source: "scenario_actor_roster_and_required_trace_tags";
    prerequisiteActorRoles: string[];
    agentDialogue: {
      participantActorIds: string[];
      startedByActorId: string | null;
      addressedActorId: string | null;
      atSecond: number | null;
      traceTag: string | null;
      rawDialogueStored: false;
      transcriptRedacted: true;
      runtimeDialogueClaimed: false;
    };
    learnerInterruption: {
      atSecond: number | null;
      routedActorId: string | null;
      routingReason: InteractionRoutingReason | null;
      traceContextTags: string[];
      sourceKind: "voice_transcript" | null;
      rawLearnerUtteranceStored: false;
      finalTranscriptTextRedacted: true;
    };
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
    hiddenFactsRedacted: true;
    limitations: string[];
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

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const defaultTransportEvidenceSourceFile = "docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json";

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestBlueprintVoiceSimulationSpikePath();
    if (!validatePath) {
      throw new Error("Missing blueprint voice simulation evidence report to validate.");
    }

    const validation = validateBlueprintVoiceSimulationSpikeReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }

    for (const error of validation.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

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
  const options: CliOptions = { validateLatest: false };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--validate") {
      options.validatePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate-latest") {
      options.validateLatest = true;
      continue;
    }
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

async function latestBlueprintVoiceSimulationSpikePath(): Promise<string | undefined> {
  const files = await globFiles("docs/openclinxr/blueprint-voice-simulation-spike-*.json");
  return files.sort().at(-1);
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
  transportEvidenceSourceFile?: string;
}): Promise<BlueprintVoiceSimulationSpikeReport> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const scenario = requireScenario(input.scenarios, input.scenarioId);
  const plan = buildBlueprintVoiceSimulationPlan(input);
  const triggerEvidence = buildTriggerEvidence(plan);
  const prewarmEvidence = buildPrewarmEvidence(plan);
  const transportEvidence = buildLinkedTransportEvidence(input.transportEvidenceSourceFile);
  const multiCharacterInterruption = await buildMultiCharacterInterruptionEvidence({
    scenario,
    plan,
  });
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
    multiCharacterInterruption,
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
        transportEvidence.blockers.includes("transport_policy_boundary_not_clean")
          ? "tier1_transport_policy_boundary_not_clean"
          : transportEvidence.bunPythonProxyPassed
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

async function buildMultiCharacterInterruptionEvidence(input: {
  scenario: Scenario;
  plan: BlueprintVoiceSimulationPlan;
}): Promise<BlueprintVoiceSimulationSpikeReport["multiCharacterInterruption"]> {
  const patient = input.scenario.actors.find((actor) => actor.role === "patient");
  const family = input.scenario.actors.find((actor) => actor.role === "family");
  const traceTag = input.plan.traceExpectations.requiredTraceTags.includes("family_communication")
    ? "family_communication"
    : input.plan.traceExpectations.requiredTraceTags[0] ?? null;
  const traceContextTags = [
    ...(traceTag ? [traceTag] : []),
    ...(input.plan.traceExpectations.requiredTraceTags.includes("empathy_statement") ? ["empathy_statement"] : []),
  ];

  if (!patient || !family || !traceTag) {
    return emptyMultiCharacterInterruptionEvidence({
      prerequisiteActorRoles: input.scenario.actors.map((actor) => actor.role),
      limitations: [
        "scenario_does_not_have_patient_family_and_family_communication_trace_tag",
        "multi_character_interruption_not_exercised",
      ],
    });
  }

  const runtime = createScenarioRuntime(input.scenario);
  const session = await runtime.startSession({
    learnerId: "blueprint_voice_simulation_interruption_learner",
    consentAccepted: true,
  });
  runtime.startEncounter(session.stationRunId, { atSecond: 60 });

  const atSecond = 255;
  const interruptionUtterance = `${family.displayName.split(" ")[0]}, I hear your concern. I need one focused question with him, and then I will come back to you.`;
  const streamId = "learner-mic-mock-interrupt-001";
  const transcriptSegmentId = "mock-interrupt-final-transcript-001";
  const routed = runtime.routeActorInteractionTurn(session.stationRunId, {
    atSecond,
    learnerUtterance: interruptionUtterance,
    traceContextTags,
    source: {
      kind: "voice_transcript",
      streamId,
      transcriptSegmentId,
      finalTranscriptText: interruptionUtterance,
      provider: "mock-voice",
      provenanceRefs: [`voice:${streamId}:${transcriptSegmentId}`],
      rawAudioStored: false,
    },
  });
  const agentDialogueEvent = {
    sequence: 0,
    eventType: "agent.dialogue.mock.started",
    source: "blueprint-voice-simulation-spike",
    actorId: family.actorId,
    tag: traceTag,
    payload: {
      participantActorIds: [family.actorId, patient.actorId],
      addressedActorId: patient.actorId,
      rawDialogueStored: false,
      transcriptRedacted: true,
      runtimeDialogueClaimed: false,
      traceContextTags,
    },
  };
  const projectedRuntimeEvents = runtime.traceEvents(session.stationRunId).map(projectRuntimeTraceEvent);
  const events = [
    agentDialogueEvent,
    ...projectedRuntimeEvents.map((event) => ({ ...event, sequence: event.sequence + 1 })),
  ];

  return {
    exercised: true,
    source: "scenario_actor_roster_and_required_trace_tags",
    prerequisiteActorRoles: input.scenario.actors.map((actor) => actor.role),
    agentDialogue: {
      participantActorIds: [family.actorId, patient.actorId],
      startedByActorId: family.actorId,
      addressedActorId: patient.actorId,
      atSecond: atSecond - 5,
      traceTag,
      rawDialogueStored: false,
      transcriptRedacted: true,
      runtimeDialogueClaimed: false,
    },
    learnerInterruption: {
      atSecond,
      routedActorId: routed.routedActorId,
      routingReason: routed.routingReason,
      traceContextTags,
      sourceKind: "voice_transcript",
      rawLearnerUtteranceStored: false,
      finalTranscriptTextRedacted: true,
    },
    traceProjection: {
      eventCount: events.length,
      eventTypes: events.map((event) => event.eventType),
      sensitiveFieldsDropped: projectionDropsSensitiveFields(events, interruptionUtterance)
        && hiddenFactsDropped(events, input.scenario),
      rawRuntimeTraceStoredInReport: false,
      events,
    },
    hiddenFactsRedacted: true,
    limitations: [
      "agent_dialogue_content_redacted_and_not_generated_by_llm",
      "runtime_dialogue_between_virtual_actors_not_implemented",
      "real_full_duplex_interruption_timing_not_measured",
      "quest_microphone_and_playback_not_measured",
    ],
  };
}

function emptyMultiCharacterInterruptionEvidence(input: {
  prerequisiteActorRoles: string[];
  limitations: string[];
}): BlueprintVoiceSimulationSpikeReport["multiCharacterInterruption"] {
  return {
    exercised: false,
    source: "scenario_actor_roster_and_required_trace_tags",
    prerequisiteActorRoles: input.prerequisiteActorRoles,
    agentDialogue: {
      participantActorIds: [],
      startedByActorId: null,
      addressedActorId: null,
      atSecond: null,
      traceTag: null,
      rawDialogueStored: false,
      transcriptRedacted: true,
      runtimeDialogueClaimed: false,
    },
    learnerInterruption: {
      atSecond: null,
      routedActorId: null,
      routingReason: null,
      traceContextTags: [],
      sourceKind: null,
      rawLearnerUtteranceStored: false,
      finalTranscriptTextRedacted: true,
    },
    traceProjection: {
      eventCount: 0,
      eventTypes: [],
      sensitiveFieldsDropped: true,
      rawRuntimeTraceStoredInReport: false,
      events: [],
    },
    hiddenFactsRedacted: true,
    limitations: input.limitations,
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

function hiddenFactsDropped(
  projectedEvents: BlueprintVoiceSimulationSpikeReport["runtimeRouting"]["traceProjection"]["events"],
  scenario: Scenario,
): boolean {
  const serialized = JSON.stringify(projectedEvents);
  return scenario.actors.every((actor) =>
    (actor.hiddenFacts ?? []).every((hiddenFact) => !serialized.includes(hiddenFact))
  );
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
    const transportPolicy = {
      cloudApisUsed: policy.cloudApisUsed === true,
      paidApisUsed: policy.paidApisUsed === true,
      http3Enabled: policy.http3Enabled === true,
      webTransportUsed: policy.webTransportUsed === true,
      quicUsed: policy.quicUsed === true,
      web3Used: policy.web3Used === true,
      questHardwareClaimed: policy.questHardwareClaimed === true,
      lowLatencyClaimed: policy.lowLatencyClaimed === true,
    };
    const policyBoundaryClean = Object.values(transportPolicy).every((value) => value === false);
    const sourceStatus = report.status === "passed" ? "passed" : "blocked";
    const bunPythonProxyPassed = sourceStatus === "passed"
      && websocket.connected === true
      && websocket.backendProtocolObserved === true
      && websocket.latencyFieldsObserved === true
      && websocket.binaryEchoObserved === true
      && policyBoundaryClean;

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
      policy: transportPolicy,
      blockers: [
        ...(policyBoundaryClean ? [] : ["transport_policy_boundary_not_clean"]),
        ...stringArray(verdict.blockers),
      ],
      caveats: [
        ...stringArray(verdict.caveats),
        ...(policyBoundaryClean ? [] : ["transport_policy_boundary_not_clean"]),
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

export function validateBlueprintVoiceSimulationSpikeReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  const report = requireRecordValue(value, "", errors);
  if (!report) {
    return { ok: false, errors };
  }

  requireStringValue(report.generatedAt, "/generatedAt", errors);
  requireOneOfValue(report.status, "/status", ["mock_facade_exercised", "blocked"], errors);

  const policy = requireRecordValue(report.policy, "/policy", errors);
  if (policy) {
    validateFalseLiterals(policy, "/policy", [
      "cloudApisUsed",
      "paidApisUsed",
      "modelDownloadsPerformed",
      "productionUseAllowed",
      "rawAudioStored",
      "hiddenFactsExposedToLearner",
    ], errors);
  }

  validatePlan(report.plan, errors);
  validateMockLoop(report.mockLoop, errors);
  validateRuntimeRouting(report.runtimeRouting, errors);
  validateMultiCharacterInterruption(report.multiCharacterInterruption, errors);
  validateTransportEvidence(report.transportEvidence, errors);
  validateTelemetry(report.telemetry, errors);
  validateTriggerEvidence(report.triggerEvidence, errors);
  validatePrewarmEvidence(report.prewarmEvidence, errors);
  validateVerdict(report.verdict, errors);
  validateVerdictConsistency(report.transportEvidence, report.verdict, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validatePlan(value: unknown, errors: string[]): void {
  const plan = requireRecordValue(value, "/plan", errors);
  if (!plan) {
    return;
  }

  requireStringValue(plan.blueprintId, "/plan/blueprintId", errors);
  const station = requireRecordValue(plan.station, "/plan/station", errors);
  if (station) {
    requireNumberValue(station.stationOrder, "/plan/station/stationOrder", errors);
    requireStringValue(station.slotId, "/plan/station/slotId", errors);
    requireStringValue(station.scenarioId, "/plan/station/scenarioId", errors);
    requireNumberValue(station.scenarioVersion, "/plan/station/scenarioVersion", errors);
    requireStringValue(station.title, "/plan/station/title", errors);
    requireNullableStringValue(station.environmentId, "/plan/station/environmentId", errors);
  }

  const policy = requireRecordValue(plan.policy, "/plan/policy", errors);
  if (policy) {
    validateFalseLiterals(policy, "/plan/policy", [
      "cloudApisUsed",
      "paidApisUsed",
      "modelDownloadsPerformed",
      "productionUseAllowed",
      "rawAudioStored",
      "hiddenFactsExposedToLearner",
    ], errors);
  }

  const actors = requireArrayValue(plan.actorRoster, "/plan/actorRoster", errors);
  actors?.forEach((actorValue, index) => {
    const actor = requireRecordValue(actorValue, `/plan/actorRoster/${index}`, errors);
    if (!actor) {
      return;
    }
    requireStringValue(actor.actorId, `/plan/actorRoster/${index}/actorId`, errors);
    requireStringValue(actor.role, `/plan/actorRoster/${index}/role`, errors);
    requireStringValue(actor.displayName, `/plan/actorRoster/${index}/displayName`, errors);
    requireStringValue(actor.demeanor, `/plan/actorRoster/${index}/demeanor`, errors);
    requireStringValue(actor.voiceId, `/plan/actorRoster/${index}/voiceId`, errors);
    requireStringArrayValue(actor.personalityTags, `/plan/actorRoster/${index}/personalityTags`, errors);
    requireStringArrayValue(actor.emotionTags, `/plan/actorRoster/${index}/emotionTags`, errors);
    requireNumberValue(actor.hiddenFactCount, `/plan/actorRoster/${index}/hiddenFactCount`, errors);
    requireTrueValue(actor.hiddenFactsRedacted, `/plan/actorRoster/${index}/hiddenFactsRedacted`, errors);
    if ("hiddenFacts" in actor) {
      errors.push(`/plan/actorRoster/${index}/hiddenFacts must be omitted`);
    }
  });

  const voiceSlots = requireArrayValue(plan.voiceSlots, "/plan/voiceSlots", errors);
  voiceSlots?.forEach((slotValue, index) => {
    const slot = requireRecordValue(slotValue, `/plan/voiceSlots/${index}`, errors);
    if (!slot) {
      return;
    }
    requireStringValue(slot.actorId, `/plan/voiceSlots/${index}/actorId`, errors);
    requireStringValue(slot.voiceId, `/plan/voiceSlots/${index}/voiceId`, errors);
    requireLiteralValue(slot.provider, `/plan/voiceSlots/${index}/provider`, "mock-voice", errors);
    requireLiteralValue(
      slot.providerTier,
      `/plan/voiceSlots/${index}/providerTier`,
      "deterministic_mock_first",
      errors,
    );
    requireLiteralValue(slot.localRuntimeStatus, `/plan/voiceSlots/${index}/localRuntimeStatus`, "not_executed", errors);
  });

  const triggerPlan = requireArrayValue(plan.triggerPlan, "/plan/triggerPlan", errors);
  triggerPlan?.forEach((triggerValue, index) => {
    const trigger = requireRecordValue(triggerValue, `/plan/triggerPlan/${index}`, errors);
    if (!trigger) {
      return;
    }
    requireStringValue(trigger.triggerId, `/plan/triggerPlan/${index}/triggerId`, errors);
    requireLiteralValue(trigger.triggerType, `/plan/triggerPlan/${index}/triggerType`, "timed_event", errors);
    requireNumberValue(trigger.atSecond, `/plan/triggerPlan/${index}/atSecond`, errors);
    requireStringValue(trigger.actorId, `/plan/triggerPlan/${index}/actorId`, errors);
    requireStringValue(trigger.traceTag, `/plan/triggerPlan/${index}/traceTag`, errors);
    requireTrueValue(trigger.learnerInterruptible, `/plan/triggerPlan/${index}/learnerInterruptible`, errors);
  });

  const privacyRules = requireRecordValue(plan.privacyRules, "/plan/privacyRules", errors);
  if (privacyRules) {
    requireLiteralValue(privacyRules.learnerView, "/plan/privacyRules/learnerView", "redact_hidden_facts", errors);
    requireBooleanValue(privacyRules.disclosureRequiresTrigger, "/plan/privacyRules/disclosureRequiresTrigger", errors);
    requireArrayValue(privacyRules.actorHiddenFactCounts, "/plan/privacyRules/actorHiddenFactCounts", errors);
  }

  const traceExpectations = requireRecordValue(plan.traceExpectations, "/plan/traceExpectations", errors);
  if (traceExpectations) {
    requireStringArrayValue(traceExpectations.requiredTraceTags, "/plan/traceExpectations/requiredTraceTags", errors);
    requireStringArrayValue(
      traceExpectations.safetyCriticalTraceTags,
      "/plan/traceExpectations/safetyCriticalTraceTags",
      errors,
    );
    requireArrayValue(traceExpectations.rubricTraceTags, "/plan/traceExpectations/rubricTraceTags", errors);
  }

  const prewarmPlan = requireRecordValue(plan.prewarmPlan, "/plan/prewarmPlan", errors);
  if (prewarmPlan) {
    requireTrueValue(prewarmPlan.allowed, "/plan/prewarmPlan/allowed", errors);
    requireStringArrayValue(prewarmPlan.steps, "/plan/prewarmPlan/steps", errors);
    requireArrayValue(prewarmPlan.artifacts, "/plan/prewarmPlan/artifacts", errors);
  }

  requireRecordValue(plan.telemetryAttributes, "/plan/telemetryAttributes", errors);
}

function validateMockLoop(value: unknown, errors: string[]): void {
  const mockLoop = requireRecordValue(value, "/mockLoop", errors);
  if (!mockLoop) {
    return;
  }

  requireFalseValue(mockLoop.learnerUtteranceStored, "/mockLoop/learnerUtteranceStored", errors);
  requireFalseValue(mockLoop.rawAudioStored, "/mockLoop/rawAudioStored", errors);
  requireStringValue(mockLoop.selectedActorId, "/mockLoop/selectedActorId", errors);
  requireStringValue(mockLoop.routingReason, "/mockLoop/routingReason", errors);
  requireLiteralValue(mockLoop.routingSource, "/mockLoop/routingSource", "scenario_runtime", errors);
  const transcript = requireRecordValue(mockLoop.transcript, "/mockLoop/transcript", errors);
  if (transcript) {
    requireNumberValue(transcript.eventCount, "/mockLoop/transcript/eventCount", errors);
    requireTrueValue(transcript.finalTextRedacted, "/mockLoop/transcript/finalTextRedacted", errors);
  }
  const synthesis = requireRecordValue(mockLoop.synthesis, "/mockLoop/synthesis", errors);
  if (synthesis) {
    requireNumberValue(synthesis.audioChunkCount, "/mockLoop/synthesis/audioChunkCount", errors);
    requireNullableNumberValue(
      synthesis.firstAudiblePlaybackLatencyMs,
      "/mockLoop/synthesis/firstAudiblePlaybackLatencyMs",
      errors,
    );
    requireNullableStringValue(synthesis.providerId, "/mockLoop/synthesis/providerId", errors);
  }
  requireArrayValue(mockLoop.traceEvents, "/mockLoop/traceEvents", errors);
}

function validateRuntimeRouting(value: unknown, errors: string[]): void {
  const runtimeRouting = requireRecordValue(value, "/runtimeRouting", errors);
  if (!runtimeRouting) {
    return;
  }

  requireBooleanValue(runtimeRouting.exercised, "/runtimeRouting/exercised", errors);
  requireLiteralValue(runtimeRouting.routeSource, "/runtimeRouting/routeSource", "scenario_runtime", errors);
  requireTrueValue(runtimeRouting.stationRunScoped, "/runtimeRouting/stationRunScoped", errors);
  requireStringValue(runtimeRouting.selectedActorId, "/runtimeRouting/selectedActorId", errors);
  requireStringValue(runtimeRouting.routingReason, "/runtimeRouting/routingReason", errors);
  requireNumberValue(runtimeRouting.conversationTurn, "/runtimeRouting/conversationTurn", errors);
  requireLiteralValue(runtimeRouting.sourceKind, "/runtimeRouting/sourceKind", "voice_transcript", errors);
  validateTraceProjection(runtimeRouting.traceProjection, "/runtimeRouting/traceProjection", errors);
}

function validateMultiCharacterInterruption(value: unknown, errors: string[]): void {
  const interruption = requireRecordValue(value, "/multiCharacterInterruption", errors);
  if (!interruption) {
    return;
  }

  requireBooleanValue(interruption.exercised, "/multiCharacterInterruption/exercised", errors);
  requireLiteralValue(
    interruption.source,
    "/multiCharacterInterruption/source",
    "scenario_actor_roster_and_required_trace_tags",
    errors,
  );
  requireStringArrayValue(
    interruption.prerequisiteActorRoles,
    "/multiCharacterInterruption/prerequisiteActorRoles",
    errors,
  );
  const agentDialogue = requireRecordValue(interruption.agentDialogue, "/multiCharacterInterruption/agentDialogue", errors);
  if (agentDialogue) {
    requireStringArrayValue(
      agentDialogue.participantActorIds,
      "/multiCharacterInterruption/agentDialogue/participantActorIds",
      errors,
    );
    requireNullableStringValue(
      agentDialogue.startedByActorId,
      "/multiCharacterInterruption/agentDialogue/startedByActorId",
      errors,
    );
    requireNullableStringValue(
      agentDialogue.addressedActorId,
      "/multiCharacterInterruption/agentDialogue/addressedActorId",
      errors,
    );
    requireNullableNumberValue(agentDialogue.atSecond, "/multiCharacterInterruption/agentDialogue/atSecond", errors);
    requireNullableStringValue(agentDialogue.traceTag, "/multiCharacterInterruption/agentDialogue/traceTag", errors);
    requireFalseValue(
      agentDialogue.rawDialogueStored,
      "/multiCharacterInterruption/agentDialogue/rawDialogueStored",
      errors,
    );
    requireTrueValue(
      agentDialogue.transcriptRedacted,
      "/multiCharacterInterruption/agentDialogue/transcriptRedacted",
      errors,
    );
    requireFalseValue(
      agentDialogue.runtimeDialogueClaimed,
      "/multiCharacterInterruption/agentDialogue/runtimeDialogueClaimed",
      errors,
    );
  }

  const learnerInterruption = requireRecordValue(
    interruption.learnerInterruption,
    "/multiCharacterInterruption/learnerInterruption",
    errors,
  );
  if (learnerInterruption) {
    requireNullableNumberValue(
      learnerInterruption.atSecond,
      "/multiCharacterInterruption/learnerInterruption/atSecond",
      errors,
    );
    requireNullableStringValue(
      learnerInterruption.routedActorId,
      "/multiCharacterInterruption/learnerInterruption/routedActorId",
      errors,
    );
    requireNullableStringValue(
      learnerInterruption.routingReason,
      "/multiCharacterInterruption/learnerInterruption/routingReason",
      errors,
    );
    requireStringArrayValue(
      learnerInterruption.traceContextTags,
      "/multiCharacterInterruption/learnerInterruption/traceContextTags",
      errors,
    );
    if (learnerInterruption.sourceKind !== "voice_transcript" && learnerInterruption.sourceKind !== null) {
      errors.push("/multiCharacterInterruption/learnerInterruption/sourceKind must be voice_transcript or null");
    }
    requireFalseValue(
      learnerInterruption.rawLearnerUtteranceStored,
      "/multiCharacterInterruption/learnerInterruption/rawLearnerUtteranceStored",
      errors,
    );
    requireTrueValue(
      learnerInterruption.finalTranscriptTextRedacted,
      "/multiCharacterInterruption/learnerInterruption/finalTranscriptTextRedacted",
      errors,
    );
  }

  validateTraceProjection(interruption.traceProjection, "/multiCharacterInterruption/traceProjection", errors);
  requireTrueValue(interruption.hiddenFactsRedacted, "/multiCharacterInterruption/hiddenFactsRedacted", errors);
  requireStringArrayValue(interruption.limitations, "/multiCharacterInterruption/limitations", errors);
}

function validateTraceProjection(value: unknown, path: string, errors: string[]): void {
  const traceProjection = requireRecordValue(value, path, errors);
  if (!traceProjection) {
    return;
  }
  requireNumberValue(traceProjection.eventCount, `${path}/eventCount`, errors);
  requireStringArrayValue(traceProjection.eventTypes, `${path}/eventTypes`, errors);
  requireTrueValue(traceProjection.sensitiveFieldsDropped, `${path}/sensitiveFieldsDropped`, errors);
  requireFalseValue(traceProjection.rawRuntimeTraceStoredInReport, `${path}/rawRuntimeTraceStoredInReport`, errors);
  requireArrayValue(traceProjection.events, `${path}/events`, errors);
}

function validateTransportEvidence(value: unknown, errors: string[]): void {
  const transportEvidence = requireRecordValue(value, "/transportEvidence", errors);
  if (!transportEvidence) {
    return;
  }

  requireBooleanValue(transportEvidence.linkedExistingEvidence, "/transportEvidence/linkedExistingEvidence", errors);
  requireFalseValue(transportEvidence.executedByThisReport, "/transportEvidence/executedByThisReport", errors);
  requireStringValue(transportEvidence.sourceFile, "/transportEvidence/sourceFile", errors);
  requireOneOfValue(
    transportEvidence.sourceStatus,
    "/transportEvidence/sourceStatus",
    ["passed", "blocked", "missing", "unreadable"],
    errors,
  );
  requireBooleanValue(transportEvidence.bunPythonProxyPassed, "/transportEvidence/bunPythonProxyPassed", errors);
  requireFalseValue(transportEvidence.readyForLiveDialog, "/transportEvidence/readyForLiveDialog", errors);

  const runtime = requireRecordValue(transportEvidence.runtime, "/transportEvidence/runtime", errors);
  if (runtime) {
    requireNullableStringValue(runtime.apiTarget, "/transportEvidence/runtime/apiTarget", errors);
    requireNullableStringValue(runtime.pythonBackendTarget, "/transportEvidence/runtime/pythonBackendTarget", errors);
    requireNullableStringValue(runtime.websocketPath, "/transportEvidence/runtime/websocketPath", errors);
    requireNullableStringValue(runtime.backendProtocol, "/transportEvidence/runtime/backendProtocol", errors);
  }

  const observed = requireRecordValue(transportEvidence.observed, "/transportEvidence/observed", errors);
  if (observed) {
    requireBooleanValue(observed.connected, "/transportEvidence/observed/connected", errors);
    requireBooleanValue(observed.backendProtocolObserved, "/transportEvidence/observed/backendProtocolObserved", errors);
    requireBooleanValue(observed.latencyFieldsObserved, "/transportEvidence/observed/latencyFieldsObserved", errors);
    requireBooleanValue(observed.binaryEchoObserved, "/transportEvidence/observed/binaryEchoObserved", errors);
    requireStringArrayValue(observed.eventTypesObserved, "/transportEvidence/observed/eventTypesObserved", errors);
  }

  const policy = requireRecordValue(transportEvidence.policy, "/transportEvidence/policy", errors);
  if (policy) {
    validateFalseLiterals(policy, "/transportEvidence/policy", [
      "cloudApisUsed",
      "paidApisUsed",
      "http3Enabled",
      "webTransportUsed",
      "quicUsed",
      "web3Used",
      "questHardwareClaimed",
      "lowLatencyClaimed",
    ], errors);
  }

  requireStringArrayValue(transportEvidence.blockers, "/transportEvidence/blockers", errors);
  requireStringArrayValue(transportEvidence.caveats, "/transportEvidence/caveats", errors);
}

function validateTelemetry(value: unknown, errors: string[]): void {
  const telemetry = requireRecordValue(value, "/telemetry", errors);
  if (!telemetry) {
    return;
  }
  requireNumberValue(telemetry.recorderSpanCount, "/telemetry/recorderSpanCount", errors);
  requireTrueValue(telemetry.sensitiveFieldsDropped, "/telemetry/sensitiveFieldsDropped", errors);
  requireRecordValue(telemetry.summary, "/telemetry/summary", errors);
}

function validateTriggerEvidence(value: unknown, errors: string[]): void {
  const triggerEvidence = requireRecordValue(value, "/triggerEvidence", errors);
  if (!triggerEvidence) {
    return;
  }
  requireLiteralValue(
    triggerEvidence.scheduler,
    "/triggerEvidence/scheduler",
    "deterministic_mock_trigger_scheduler",
    errors,
  );
  requireArrayValue(triggerEvidence.firedTriggers, "/triggerEvidence/firedTriggers", errors);
  requireNumberValue(triggerEvidence.pendingTriggerCount, "/triggerEvidence/pendingTriggerCount", errors);
  requireFalseValue(triggerEvidence.runtimeSchedulerClaimed, "/triggerEvidence/runtimeSchedulerClaimed", errors);
}

function validatePrewarmEvidence(value: unknown, errors: string[]): void {
  const prewarmEvidence = requireRecordValue(value, "/prewarmEvidence", errors);
  if (!prewarmEvidence) {
    return;
  }
  requireBooleanValue(prewarmEvidence.executed, "/prewarmEvidence/executed", errors);
  requireNumberValue(prewarmEvidence.preparedArtifactCount, "/prewarmEvidence/preparedArtifactCount", errors);
  requireStringArrayValue(prewarmEvidence.preparedArtifactTypes, "/prewarmEvidence/preparedArtifactTypes", errors);
  requireFalseValue(prewarmEvidence.modelWeightsLoaded, "/prewarmEvidence/modelWeightsLoaded", errors);
  requireFalseValue(prewarmEvidence.voiceRuntimeLoaded, "/prewarmEvidence/voiceRuntimeLoaded", errors);
  requireFalseValue(
    prewarmEvidence.firstResponseImprovementMeasured,
    "/prewarmEvidence/firstResponseImprovementMeasured",
    errors,
  );
  requireFalseValue(prewarmEvidence.cleanupRequired, "/prewarmEvidence/cleanupRequired", errors);
  requireStringArrayValue(prewarmEvidence.blockers, "/prewarmEvidence/blockers", errors);
}

function validateVerdict(value: unknown, errors: string[]): void {
  const verdict = requireRecordValue(value, "/verdict", errors);
  if (!verdict) {
    return;
  }
  requireBooleanValue(verdict.tier0BlueprintCompilerPassed, "/verdict/tier0BlueprintCompilerPassed", errors);
  requireBooleanValue(verdict.mockVoiceFacadeExercised, "/verdict/mockVoiceFacadeExercised", errors);
  requireBooleanValue(verdict.tier1TransportLoopPassed, "/verdict/tier1TransportLoopPassed", errors);
  requireFalseValue(verdict.tier2LocalInferenceObserved, "/verdict/tier2LocalInferenceObserved", errors);
  requireFalseValue(verdict.tier3WebXrObserved, "/verdict/tier3WebXrObserved", errors);
  requireFalseValue(verdict.readyForProduction, "/verdict/readyForProduction", errors);
  requireStringArrayValue(verdict.blockers, "/verdict/blockers", errors);
}

function validateVerdictConsistency(transportValue: unknown, verdictValue: unknown, errors: string[]): void {
  const transportEvidence = asRecord(transportValue);
  const verdict = asRecord(verdictValue);
  const bunPythonProxyPassed = transportEvidence.bunPythonProxyPassed === true;
  if (verdict.tier1TransportLoopPassed !== bunPythonProxyPassed) {
    errors.push("/verdict/tier1TransportLoopPassed must match /transportEvidence/bunPythonProxyPassed");
  }

  const transportBlockers = stringArray(transportEvidence.blockers);
  const expectedTransportBlocker = transportBlockers.includes("transport_policy_boundary_not_clean")
    ? "tier1_transport_policy_boundary_not_clean"
    : bunPythonProxyPassed
    ? "tier1_transport_linked_but_not_executed_by_blueprint_report"
    : "tier1_bun_python_transport_loop_not_executed";
  const expectedBlockers = [
    expectedTransportBlocker,
    "real_local_full_duplex_model_not_executed",
    "python_backend_runtime_not_executed_for_this_report",
    "webxr_iwsdk_client_not_executed_for_this_report",
    "quest_microphone_and_playback_not_measured",
    "clinical_voice_safety_controls_not_validated_with_real_model",
  ];
  const verdictBlockers = stringArray(verdict.blockers);
  for (const blocker of expectedBlockers) {
    if (!verdictBlockers.includes(blocker)) {
      errors.push(`/verdict/blockers missing expected blocker ${blocker}`);
    }
  }
}

function requireRecordValue(value: unknown, path: string, errors: string[]): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  errors.push(`${path || "/"} must be an object`);
  return undefined;
}

function requireArrayValue(value: unknown, path: string, errors: string[]): unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }
  errors.push(`${path} must be an array`);
  return undefined;
}

function requireStringArrayValue(value: unknown, path: string, errors: string[]): string[] | undefined {
  const values = requireArrayValue(value, path, errors);
  if (!values) {
    return undefined;
  }
  if (!values.every((entry) => typeof entry === "string")) {
    errors.push(`${path} must contain only strings`);
    return undefined;
  }
  return values;
}

function requireStringValue(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string") {
    errors.push(`${path} must be a string`);
  }
}

function requireNullableStringValue(value: unknown, path: string, errors: string[]): void {
  if (value !== null && typeof value !== "string") {
    errors.push(`${path} must be a string or null`);
  }
}

function requireNumberValue(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${path} must be a number`);
  }
}

function requireNullableNumberValue(value: unknown, path: string, errors: string[]): void {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    errors.push(`${path} must be a number or null`);
  }
}

function requireBooleanValue(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "boolean") {
    errors.push(`${path} must be a boolean`);
  }
}

function requireFalseValue(value: unknown, path: string, errors: string[]): void {
  if (value !== false) {
    errors.push(`${path} must be false`);
  }
}

function requireTrueValue(value: unknown, path: string, errors: string[]): void {
  if (value !== true) {
    errors.push(`${path} must be true`);
  }
}

function requireLiteralValue(value: unknown, path: string, expected: string, errors: string[]): void {
  if (value !== expected) {
    errors.push(`${path} must be ${expected}`);
  }
}

function requireOneOfValue(value: unknown, path: string, expected: readonly string[], errors: string[]): void {
  if (typeof value !== "string" || !expected.includes(value)) {
    errors.push(`${path} must be one of ${expected.join(", ")}`);
  }
}

function validateFalseLiterals(
  record: Record<string, unknown>,
  path: string,
  keys: readonly string[],
  errors: string[],
): void {
  for (const key of keys) {
    requireFalseValue(record[key], `${path}/${key}`, errors);
  }
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
