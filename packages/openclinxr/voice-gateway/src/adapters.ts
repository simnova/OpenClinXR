import { type ProviderAuditRecord, type ProviderHealth, validateProviderHealth } from "@cellix/provider-contracts";
import type {
  VoiceCapability,
  RealtimeVoiceProtocolLaneId,
  RealtimeVoiceProtocolLane,
  RealtimeVoiceProtocolSelection,
  RealtimeVoiceClientControlFrameType,
  RealtimeVoiceServerEventType,
  RealtimeVoiceGatewayPosture,
  VoiceSpeechProviderGate,
  VoiceRequestPolicy,
  VoiceSafetyStatus,
  VoiceProvenance,
  SpeechInput,
  SpeechSynthesisRequest,
  TranscriptEvent,
  AudioEvent,
  VoiceProviderAdapter,
  VoiceGatewayOptions,
  RealtimeVoiceGatewayPostureInput,
  RealtimeVoicePythonBackendProxyReachabilityEvidence,
} from "./types.js";
import {
  realtimeVoiceProtocol,
} from "./types.js";

export async function collectVoiceStream<TEvent>(events: AsyncIterable<TEvent>): Promise<TEvent[]> {
  const collected: TEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

export type MockVoiceProviderOptions = {
  /**
   * Optional deterministic transcript fixture. When omitted the adapter emits its original two
   * events byte for byte (partial "When did" @ 0.75/120ms, final "When did the chest pressure
   * start?" @ 0.99/420ms), so the eleven no-argument construction sites keep their behaviour.
   */
  transcript?: {
    partialText?: string;
    finalText: string;
  };
};

export class MockVoiceProviderAdapter implements VoiceProviderAdapter {
  readonly id = "mock-voice";
  readonly capabilities: VoiceCapability[] = ["transcription", "synthesis", "viseme_cues"];

  constructor(private readonly options: MockVoiceProviderOptions = {}) {}

  async health(): Promise<ProviderHealth> {
    return { providerId: this.id, status: "ready" };
  }

  async *transcribe(input: SpeechInput): AsyncIterable<TranscriptEvent> {
    const provenance = this.provenance(input);
    yield {
      eventType: "partial_transcript",
      text: this.options.transcript?.partialText ?? "When did",
      confidence: 0.75,
      atMs: 120,
      provenance,
    };
    yield {
      eventType: "final_transcript",
      text: this.options.transcript?.finalText ?? "When did the chest pressure start?",
      confidence: 0.99,
      atMs: 420,
      provenance,
    };
  }

  async *synthesize(input: SpeechSynthesisRequest): AsyncIterable<AudioEvent> {
    yield {
      eventType: "audio_chunk",
      audioFormat: "audio/mock",
      chunkIndex: 0,
      durationMs: 1100,
      visemeCue: "neutral-pain",
      provenance: this.provenance(input),
    };
  }

  private provenance(input: SpeechInput | SpeechSynthesisRequest): VoiceProvenance {
    return {
      requestId: voiceRequestId(input),
      providerId: this.id,
      modelId: "deterministic-voice-mock",
      modelVersion: "1.0.0",
      modelRuntimeName: "deterministic-voice-mock-runtime",
      requestPolicyId: input.policy.requestPolicyId,
      safetyPolicyVersion: input.policy.safetyPolicyVersion,
      latencyMs: 0,
      costEstimateUsd: 0,
      safetyStatus: "not_exercised",
    };
  }
}

function voiceRequestId(input: SpeechInput | SpeechSynthesisRequest): string {
  if (input.requestId && input.requestId.trim().length > 0) {
    return input.requestId;
  }

  if ("streamId" in input) {
    return `${input.stationRunId}:${input.streamId}:transcription`;
  }

  return `${input.stationRunId}:${input.actorId}:${input.voiceId}:synthesis`;
}

export type LocalVoiceProviderOptions = {
  providerId: string;
  blockers?: string[];
  runtimeEvidence?: LocalVoiceRuntimeBenchmarkEvidence;
};

export type LocalVoiceProviderStubOptions = {
  blockers?: string[];
  runtimeEvidence?: LocalVoiceRuntimeBenchmarkEvidence;
};

export type LocalVoiceRuntimeBenchmarkEvidence = {
  evidenceId: string;
  sourceFile: string;
  generatedAt: string;
  policy?: {
    cloudApisUsed?: boolean;
    paidApisUsed?: boolean;
    productionUseAllowed?: boolean;
    generatedAudioCommitted?: boolean;
  };
  runtime?: {
    modelId?: string;
    device?: string;
  };
  audio?: {
    durationMs?: number;
    sampleRateHz?: number;
  };
  metrics?: {
    wallClockMs?: number;
    modelGenerationMs?: number;
    realTimeFactor?: number;
    approxFirstSpeechTokenLatencyMs?: number;
  };
  verdict?: {
    blockers?: string[];
    caveats?: string[];
  };
};

export class LocalVoiceProviderAdapter implements VoiceProviderAdapter {
  readonly capabilities: VoiceCapability[] = ["transcription", "synthesis", "viseme_cues"];

  constructor(private readonly options: LocalVoiceProviderOptions) {}

  get id(): string {
    return this.options.providerId;
  }

  async health(): Promise<ProviderHealth> {
    if (this.options.runtimeEvidence) {
      return localVoiceRuntimeEvidenceHealth(this.id, this.options.runtimeEvidence, [...(this.options.blockers ?? [])]);
    }

    return {
      providerId: this.id,
      status: "not_configured",
      blockers: [...(this.options.blockers ?? ["local_voice_runtime_not_configured"])],
    };
  }

  transcribe(): AsyncIterable<TranscriptEvent> {
    throw new Error(`Local voice provider ${this.id} is not configured`);
  }

  synthesize(): AsyncIterable<AudioEvent> {
    throw new Error(`Local voice provider ${this.id} is not configured`);
  }
}

export function createVibeVoiceProviderAdapter(options: LocalVoiceProviderStubOptions = {}): LocalVoiceProviderAdapter {
  const adapterOptions: LocalVoiceProviderOptions = {
    providerId: "local-vibevoice",
  };

  if (options.blockers) {
    adapterOptions.blockers = options.blockers;
  }
  if (options.runtimeEvidence) {
    adapterOptions.runtimeEvidence = options.runtimeEvidence;
  }

  return new LocalVoiceProviderAdapter(adapterOptions);
}

function localVoiceRuntimeEvidenceHealth(
  providerId: string,
  evidence: LocalVoiceRuntimeBenchmarkEvidence,
  configuredBlockers: string[],
): ProviderHealth {
  return {
    providerId,
    status: "blocked",
    blockers: localVoiceRuntimeEvidenceBlockers(evidence, configuredBlockers),
    evidence: {
      evidenceId: evidence.evidenceId,
      sourceFile: evidence.sourceFile,
      generatedAt: evidence.generatedAt,
      summary: localVoiceRuntimeEvidenceSummary(evidence),
    },
  };
}

function localVoiceRuntimeEvidenceBlockers(
  evidence: LocalVoiceRuntimeBenchmarkEvidence,
  configuredBlockers: string[],
): string[] {
  const caveats = (evidence.verdict?.caveats ?? []).map((caveat) => caveat.toLowerCase());
  const realTimeFactor = finiteNumber(evidence.metrics?.realTimeFactor);
  return unique([
    ...configuredBlockers,
    ...(evidence.verdict?.blockers ?? []),
    caveats.some((caveat) => caveat.includes("file-based") || caveat.includes("file generation"))
      ? "runtime_file_generation_only"
      : undefined,
    realTimeFactor === null || realTimeFactor > 1 ? "real_time_factor_above_1" : undefined,
    "real_local_voice_stream_benchmark_missing",
    "webxr_playback_not_observed",
    evidence.policy?.cloudApisUsed ? "cloud_apis_used_in_source_runtime_benchmark" : undefined,
    evidence.policy?.paidApisUsed ? "paid_apis_used_in_source_runtime_benchmark" : undefined,
    evidence.policy?.productionUseAllowed ? "production_use_allowed_before_live_dialog_approval" : undefined,
    evidence.policy?.generatedAudioCommitted ? "generated_audio_committed" : undefined,
  ]);
}

function localVoiceRuntimeEvidenceSummary(evidence: LocalVoiceRuntimeBenchmarkEvidence): Record<string, unknown> {
  return compactSummary({
    modelId: evidence.runtime?.modelId,
    device: evidence.runtime?.device,
    realTimeFactor: finiteNumber(evidence.metrics?.realTimeFactor),
    approximateFirstSpeechTokenLatencyMs: finiteNumber(evidence.metrics?.approxFirstSpeechTokenLatencyMs),
    wallClockMs: finiteNumber(evidence.metrics?.wallClockMs),
    modelGenerationMs: finiteNumber(evidence.metrics?.modelGenerationMs),
    audioDurationMs: finiteNumber(evidence.audio?.durationMs),
    sampleRateHz: finiteNumber(evidence.audio?.sampleRateHz),
    cloudApisUsed: evidence.policy?.cloudApisUsed,
    paidApisUsed: evidence.policy?.paidApisUsed,
    productionUseAllowed: evidence.policy?.productionUseAllowed,
    generatedAudioCommitted: evidence.policy?.generatedAudioCommitted,
    caveatCount: evidence.verdict?.caveats?.length,
  });
}

function compactSummary(summary: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined && value !== null));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))];
}

// ── Frozen-plan speech render + barge-in execution record (DVA-8) ───────────
//
// The streaming TTS/STT render path is driven by a FROZEN ActorTurnPlan (the
// runtime freezes nested containers first, then the root — freezeActorTurnPlan
// order). This package has no shared-schemas dependency, so the plan/execution
// shapes below are local structural seams: the freeze gate covers the exact
// freezeActorTurnPlan container set and the gate wording matches
// scenario-runtime.ts:379. A barge-in mid-render appends a NEW frozen
// ActorTurnExecution (interruption.kind "truncated") and never mutates the
// plan: no field write, no aliasing of plan arrays, no hidden freeze.

export type ActorTurnPlanSpeech = {
  planId: string;
  turnId: string;
  spokenTextForTts: string;
  prosody: {
    wrapTags: readonly string[];
    inlineTags: readonly string[];
    speed: number;
    droppedTags: readonly string[];
  };
  gestureClipIds: readonly string[];
  languageProvenance: {
    fallbackUsed: boolean;
    providerId?: string;
  };
  notEvidenceFor: readonly string[];
};

export type ActorTurnExecutionRecord = {
  planId: string;
  turnId: string;
  interruption: {
    kind: "none" | "truncated";
  };
  renderedProsodyTags: string[];
  droppedProsodyTags: string[];
  fallback: {
    language: boolean;
    tts: false;
  };
};

const FROZEN_PLAN_RENDER_GATE_MESSAGE = "ActorTurnPlan must be frozen before speech render";

/**
 * Barge-in on a frozen plan: deterministic chunked speech render from
 * plan.spokenTextForTts (one audio chunk per whitespace token), appending a
 * frozen ActorTurnExecution as a NEW record. The plan is never mutated.
 *
 * @param options.plan deep-frozen ActorTurnPlan (frozen in freezeActorTurnPlan
 *   order: nested containers first, root last). An unfrozen or shallow-frozen
 *   plan rejects with the shared gate wording and the caller's plan is left
 *   exactly as it was — no freeze, no write.
 * @param options.bargeInAtChunkIndex first chunk NOT delivered. Omitted means
 *   a full render (interruption.kind "none"). A value below the chunk count
 *   truncates delivery to chunks 0..k-1 and records "truncated"; a value at or
 *   beyond the chunk count delivers the full render (nothing withheld) and
 *   records "none".
 */
export async function synthesizeActorSpeechFromFrozenPlan(options: {
  plan: ActorTurnPlanSpeech;
  bargeInAtChunkIndex?: number;
}): Promise<{
  audioEvents: AudioEvent[];
  actorTurnExecution: ActorTurnExecutionRecord;
}> {
  const { plan } = options;
  assertPlanFrozenForSpeechRender(plan);

  const tokens = plan.spokenTextForTts.trim().split(/\s+/).filter((token) => token.length > 0);
  const bargeInRequested = options.bargeInAtChunkIndex !== undefined;
  const bargeInAtChunkIndex = bargeInRequested ? Math.max(0, options.bargeInAtChunkIndex as number) : tokens.length;
  const truncated = bargeInRequested && bargeInAtChunkIndex < tokens.length;
  const deliveredTokens = tokens.slice(0, truncated ? bargeInAtChunkIndex : tokens.length);

  const audioEvents = deliveredTokens.map((token, index) => ({
    eventType: "audio_chunk" as const,
    audioFormat: "audio/mock",
    chunkIndex: index,
    durationMs: deterministicChunkDurationMs(token, plan.prosody.speed),
    visemeCue: "neutral",
    provenance: planRenderProvenance(plan),
  }));

  const actorTurnExecution = freezeActorTurnExecution({
    planId: plan.planId,
    turnId: plan.turnId,
    interruption: { kind: truncated ? "truncated" : "none" },
    renderedProsodyTags: [...plan.prosody.wrapTags, ...plan.prosody.inlineTags],
    droppedProsodyTags: [...plan.prosody.droppedTags],
    fallback: {
      language: plan.languageProvenance.fallbackUsed,
      tts: false,
    },
  });

  return { audioEvents, actorTurnExecution };
}

function assertPlanFrozenForSpeechRender(plan: ActorTurnPlanSpeech): void {
  const nestedFrozen =
    Object.isFrozen(plan.gestureClipIds)
    && Object.isFrozen(plan.prosody.wrapTags)
    && Object.isFrozen(plan.prosody.inlineTags)
    && Object.isFrozen(plan.prosody.droppedTags)
    && Object.isFrozen(plan.prosody)
    && Object.isFrozen(plan.languageProvenance)
    && Object.isFrozen(plan.notEvidenceFor);
  if (!nestedFrozen || !Object.isFrozen(plan)) {
    throw new Error(FROZEN_PLAN_RENDER_GATE_MESSAGE);
  }
}

function freezeActorTurnExecution(execution: ActorTurnExecutionRecord): ActorTurnExecutionRecord {
  Object.freeze(execution.interruption);
  Object.freeze(execution.renderedProsodyTags);
  Object.freeze(execution.droppedProsodyTags);
  Object.freeze(execution.fallback);
  return Object.freeze(execution);
}

/** Pure function of (token, prosody.speed) so identical plans render identical chunks. */
function deterministicChunkDurationMs(token: string, prosodySpeed: number): number {
  const base = token.length * 80;
  const speedScale = Number.isFinite(prosodySpeed) && prosodySpeed > 0 ? prosodySpeed : 1;
  return Math.max(60, Math.round(base / speedScale));
}

function planRenderProvenance(plan: ActorTurnPlanSpeech): VoiceProvenance {
  return {
    requestId: `${plan.planId}:${plan.turnId}:synthesis`,
    providerId: "voice-gateway-plan-render",
    modelId: "deterministic-whitespace-chunk-render",
    modelVersion: "1.0.0",
    modelRuntimeName: "deterministic-plan-render-runtime",
    requestPolicyId: "voice-offline-v1",
    safetyPolicyVersion: "clinical-simulation-safety-v1",
    latencyMs: 0,
    costEstimateUsd: 0,
    safetyStatus: "not_exercised",
  };
}

