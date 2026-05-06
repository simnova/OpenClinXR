import { pathToFileURL } from "node:url";
import { createDefaultClinicalSkillsBlueprint, type ExamBlueprint } from "../../packages/openclinxr/exam-assembly/src/index.js";
import { edChestPainScenario } from "../../packages/openclinxr/scenario-fixtures/src/index.js";
import type { Scenario, TraceEvent } from "../../packages/openclinxr/shared-schemas/src/index.js";
import {
  createInMemoryTelemetryRecorder,
  openClinXrSpanNames,
  safeTelemetryAttributes,
  summarizeTelemetrySpans,
} from "../../packages/openclinxr/telemetry/src/index.js";
import {
  collectVoiceStream,
  createDefaultVoiceGateway,
  MockVoiceProviderAdapter,
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
  status: "mock_loop_passed" | "blocked";
  policy: VoiceSimulationPolicy;
  plan: BlueprintVoiceSimulationPlan;
  mockLoop: {
    learnerUtteranceStored: false;
    rawAudioStored: false;
    selectedActorId: string;
    routingReason: "display_name_or_role_match" | "primary_patient_default";
    transcript: {
      finalText: string;
      eventCount: number;
    };
    synthesis: {
      audioChunkCount: number;
      firstAudiblePlaybackLatencyMs: number | null;
      providerId: string | null;
    };
    traceEvents: TraceEvent[];
  };
  telemetry: {
    recorderSpanCount: number;
    sensitiveFieldsDropped: boolean;
    summary: ReturnType<typeof summarizeTelemetrySpans>;
  };
  verdict: {
    tier0BlueprintCompilerPassed: boolean;
    tier1MockVoiceLoopPassed: boolean;
    tier2LocalInferenceObserved: false;
    tier3WebXrObserved: false;
    readyForProduction: false;
    blockers: string[];
  };
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildBlueprintVoiceSimulationSpikeReport({
    blueprint: createDefaultClinicalSkillsBlueprint(),
    scenarios: [edChestPainScenario],
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

  const stationSlot = input.blueprint.stationSlots[scenarioIndex];
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
  const plan = buildBlueprintVoiceSimulationPlan(input);
  const selectedActor = selectActor(plan, input.learnerUtterance);
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
    status: "mock_loop_passed",
    policy: simulationPolicy(),
    plan,
    mockLoop: {
      learnerUtteranceStored: false,
      rawAudioStored: false,
      selectedActorId: selectedActor.actorId,
      routingReason: selectedActor.routingReason,
      transcript: {
        finalText: finalTranscript?.text ?? "",
        eventCount: transcriptEvents.length,
      },
      synthesis: {
        audioChunkCount: audioEvents.length,
        firstAudiblePlaybackLatencyMs: firstAudio?.provenance.latencyMs ?? null,
        providerId: firstAudio?.provenance.providerId ?? null,
      },
      traceEvents,
    },
    telemetry: {
      recorderSpanCount: telemetry.spans().length,
      sensitiveFieldsDropped: sensitiveTelemetryFieldsDropped(input.learnerUtterance),
      summary: summarizeTelemetrySpans(telemetry.spans()),
    },
    verdict: {
      tier0BlueprintCompilerPassed: true,
      tier1MockVoiceLoopPassed: transcriptEvents.length > 0 && audioEvents.length > 0,
      tier2LocalInferenceObserved: false,
      tier3WebXrObserved: false,
      readyForProduction: false,
      blockers: [
        "real_local_full_duplex_model_not_executed",
        "python_backend_runtime_not_executed_for_this_report",
        "webxr_iwsdk_client_not_executed_for_this_report",
        "quest_microphone_and_playback_not_measured",
        "clinical_voice_safety_controls_not_validated_with_real_model",
      ],
    },
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

function selectActor(
  plan: BlueprintVoiceSimulationPlan,
  utterance: string,
): ActorVoicePlan & { routingReason: BlueprintVoiceSimulationSpikeReport["mockLoop"]["routingReason"] } {
  const normalized = utterance.toLowerCase();
  const matchedActor = plan.actorRoster.find((actor) => {
    const displayTokens = actor.displayName.toLowerCase().split(/\s+/).filter((token) => token.length > 2);
    return displayTokens.some((token) => normalized.includes(token)) || normalized.includes(actor.role.replaceAll("_", " "));
  });
  if (matchedActor) {
    return { ...matchedActor, routingReason: "display_name_or_role_match" };
  }

  return {
    ...(plan.actorRoster.find((actor) => actor.role === "patient") ?? plan.actorRoster[0]),
    routingReason: "primary_patient_default",
  };
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
