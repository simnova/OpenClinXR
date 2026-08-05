import { type ProviderAuditRecord, type ProviderHealth, validateProviderHealth } from "@openclinxr/shared-schemas";
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

export class MockVoiceProviderAdapter implements VoiceProviderAdapter {
  readonly id = "mock-voice";
  readonly capabilities: VoiceCapability[] = ["transcription", "synthesis", "viseme_cues"];

  async health(): Promise<ProviderHealth> {
    return { providerId: this.id, status: "ready" };
  }

  async *transcribe(input: SpeechInput): AsyncIterable<TranscriptEvent> {
    const provenance = this.provenance(input);
    yield {
      eventType: "partial_transcript",
      text: "When did",
      confidence: 0.75,
      atMs: 120,
      provenance,
    };
    yield {
      eventType: "final_transcript",
      text: "When did the chest pressure start?",
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

