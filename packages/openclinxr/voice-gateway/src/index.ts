import { type ProviderAuditRecord, type ProviderHealth, validateProviderHealth } from "@openclinxr/shared-schemas";

export type VoiceCapability = "transcription" | "synthesis" | "viseme_cues" | "emotional_prosody" | "lip_sync_timing";

export type RealtimeVoiceProtocolLaneId =
  | "websocket-media"
  | "webtransport-http3-media"
  | "direct-quic-media-gateway"
  | "web3-identity-signaling";

export type RealtimeVoiceProtocolLane = {
  id: RealtimeVoiceProtocolLaneId;
  protocol: "websocket" | "webtransport" | "direct-quic" | "web3-signaling";
  role: "media-transport" | "identity-signaling-audit";
  status: "working_spike_transport" | "proposal_required";
  mediaAllowed: boolean;
  blockers: string[];
  notes: string;
};

export type RealtimeVoiceProtocolSelection = {
  selectedLane?: RealtimeVoiceProtocolLane;
  rejectedLaneReasons: Array<{
    id: RealtimeVoiceProtocolLaneId;
    reason: "media_not_allowed" | "proposal_required";
    blockers: string[];
  }>;
};

export const realtimeVoiceProtocol = {
  websocketPath: "/voice/realtime/ws",
  codec: "opus",
  sampleRateHz: 48_000,
  backendProtocol: "python-fastapi-compatible-websocket",
  clientControlFrames: {
    start: "voice.start",
    stop: "voice.stop",
    audioMetadata: "voice.audio_metadata",
  },
  serverEvents: {
    backendReady: "backend.ready",
    backendError: "backend.error",
    voiceStarted: "voice.started",
    voiceStopped: "voice.stopped",
    audioChunk: "audio.chunk",
    transcriptPartial: "transcript.partial",
    transcriptFinal: "transcript.final",
  },
  latencyFields: {
    clientSentAtMs: "clientSentAtMs",
    backendObservedAtMs: "backendObservedAtMs",
  },
} as const;

export type RealtimeVoiceClientControlFrameType =
  (typeof realtimeVoiceProtocol.clientControlFrames)[keyof typeof realtimeVoiceProtocol.clientControlFrames];

export type RealtimeVoiceServerEventType =
  (typeof realtimeVoiceProtocol.serverEvents)[keyof typeof realtimeVoiceProtocol.serverEvents];

export type RealtimeVoiceGatewayPosture = {
  policy: {
    cloudApisUsed: false;
    paidApisUsed: false;
    modelDownloadsPerformed: false;
    productionUseAllowed: false;
  };
  transports: {
    websocket: {
      status: "working_spike_transport";
      path: "/voice/realtime/ws";
      codec: "opus";
    };
    webTransport: {
      status: "blocked_pending_runtime_support";
      blockers: string[];
    };
  };
  gatewayRuntime: {
    target: "bun-hono-http3";
    localVerifiedFallback: "node-hono-ws";
    blockers: string[];
  };
  backends: {
    pythonFastApi: {
      status: "source_present_not_executed" | "available_for_local_run";
      websocketPath: "/voice/realtime/ws";
      transportProxy: {
        status: "not_configured" | "configured_not_verified" | "configured_reachability_verified";
        backendUrlConfigured: boolean;
        readyForLiveDialog: false;
        blockers: string[];
        reachabilityEvidence?: RealtimeVoicePythonBackendProxyReachabilityEvidence;
      };
      blockers: string[];
    };
    inferenceCandidates: Array<{
      id: "moshi-mlx" | "qwen3-tts";
      role: "full_duplex_speech_dialogue" | "streaming_tts_candidate";
      localExecutionClaimed: false;
    }>;
  };
  protocolLanes: RealtimeVoiceProtocolLane[];
  providerGates: VoiceSpeechProviderGate[];
};

export type VoiceSpeechProviderGate = {
  gateId: "stt" | "tts" | "emotional_prosody" | "lip_sync_timing";
  capability: VoiceCapability;
  providerPath: "deterministic-replay" | "local-runtime" | "cloud-approved" | "blocked";
  state: "ready_for_deterministic_replay" | "planned_pending_evidence" | "blocked";
  liveProviderReady: false;
  credentialEvidencePresent: false;
  runtimeEvidencePresent: false;
  blockers: string[];
  recommendedNextAction: string;
  claimBoundary: "voice_provider_gate_metadata_not_live_dialog_readiness";
};

export type VoiceRequestPolicy = {
  requestPolicyId: string;
  safetyPolicyVersion: string;
};

export type VoiceSafetyStatus = ProviderAuditRecord["safetyStatus"];

export type VoiceProvenance = ProviderAuditRecord;

export type SpeechInput = {
  requestId?: string;
  stationRunId: string;
  streamId: string;
  language: string;
  audioFormat: string;
  policy: VoiceRequestPolicy;
};

export type SpeechSynthesisRequest = {
  requestId?: string;
  stationRunId: string;
  actorId: string;
  voiceId: string;
  text: string;
  policy: VoiceRequestPolicy;
};

export type TranscriptEvent = {
  eventType: "partial_transcript" | "final_transcript";
  text: string;
  confidence: number;
  atMs: number;
  provenance: VoiceProvenance;
};

export type AudioEvent = {
  eventType: "audio_chunk";
  audioFormat: string;
  chunkIndex: number;
  durationMs: number;
  visemeCue: string;
  provenance: VoiceProvenance;
};

export interface VoiceProviderAdapter {
  readonly id: string;
  readonly capabilities: VoiceCapability[];
  health(): Promise<ProviderHealth>;
  transcribe(input: SpeechInput): AsyncIterable<TranscriptEvent>;
  synthesize(input: SpeechSynthesisRequest): AsyncIterable<AudioEvent>;
}

export type VoiceGatewayOptions = {
  adapters: VoiceProviderAdapter[];
  routeId: string;
};

export class VoiceGateway {
  constructor(private readonly options: VoiceGatewayOptions) {}

  async health(): Promise<ProviderHealth[]> {
    return Promise.all(this.options.adapters.map((adapter) => adapter.health()));
  }

  async *transcribe(input: SpeechInput): AsyncIterable<TranscriptEvent> {
    const adapter = await this.firstReadyAdapter("transcription");
    yield* adapter.transcribe(input);
  }

  async *synthesize(input: SpeechSynthesisRequest): AsyncIterable<AudioEvent> {
    const adapter = await this.firstReadyAdapter("synthesis");
    yield* adapter.synthesize(input);
  }

  private async firstReadyAdapter(capability: VoiceCapability): Promise<VoiceProviderAdapter> {
    for (const adapter of this.options.adapters) {
      const health = await adapter.health();
      if (validateProviderHealth(health).ok && health.status === "ready" && adapter.capabilities.includes(capability)) {
        return adapter;
      }
    }

    throw new Error(`No ready voice provider for route ${this.options.routeId}`);
  }
}

export function createDefaultVoiceGateway(options: VoiceGatewayOptions): VoiceGateway {
  return new VoiceGateway(options);
}

export type RealtimeVoiceGatewayPostureInput = {
  providerProfile?: "local-development" | "local-production" | "production";
  bunAvailable: boolean;
  pythonBackendWebSocketUrlConfigured?: boolean;
  pythonBackendDependenciesInstalled: boolean;
  pythonInferenceRuntimeInstalled: boolean;
  pythonBackendProxyReachabilityEvidence?: RealtimeVoicePythonBackendProxyReachabilityEvidence;
};

export type RealtimeVoicePythonBackendProxyReachabilityEvidence = {
  sourceFile: string;
  generatedAt?: string;
  status: "passed" | "blocked";
  eventTypesObserved: string[];
  binaryMessages: number;
  backendProtocolObserved: boolean;
  latencyFieldsObserved: boolean;
  binaryEchoObserved: boolean;
};

export function createRealtimeVoiceGatewayPosture(input: RealtimeVoiceGatewayPostureInput): RealtimeVoiceGatewayPosture {
  const pythonBackendProxyReachabilityEvidence = input.pythonBackendWebSocketUrlConfigured
    ? verifiedPythonBackendProxyReachabilityEvidence(input.pythonBackendProxyReachabilityEvidence)
    : undefined;
  return {
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      modelDownloadsPerformed: false,
      productionUseAllowed: false,
    },
    transports: {
      websocket: {
        status: "working_spike_transport",
        path: realtimeVoiceProtocol.websocketPath,
        codec: realtimeVoiceProtocol.codec,
      },
      webTransport: {
        status: "blocked_pending_runtime_support",
        blockers: [
          "quest_godot_webtransport_client_not_implemented",
          "bun_http3_webtransport_not_verified",
          "azure_http3_gateway_path_not_verified",
        ],
      },
    },
    gatewayRuntime: {
      target: "bun-hono-http3",
      localVerifiedFallback: "node-hono-ws",
      blockers: [
        ...(input.bunAvailable ? [] : ["bun_not_installed"]),
        "http3_webtransport_not_verified",
      ],
    },
    backends: {
      pythonFastApi: {
        status: input.pythonBackendDependenciesInstalled ? "available_for_local_run" : "source_present_not_executed",
        websocketPath: realtimeVoiceProtocol.websocketPath,
        transportProxy: {
          status: realtimeVoiceTransportProxyStatus(input, pythonBackendProxyReachabilityEvidence),
          backendUrlConfigured: input.pythonBackendWebSocketUrlConfigured === true,
          readyForLiveDialog: false,
          blockers: [
            ...(input.pythonBackendWebSocketUrlConfigured ? [] : ["python_backend_websocket_url_not_configured"]),
            ...(input.pythonBackendWebSocketUrlConfigured && !pythonBackendProxyReachabilityEvidence
              ? ["python_backend_proxy_reachability_not_claimed_by_posture_endpoint"]
              : []),
            ...(input.pythonBackendProxyReachabilityEvidence && !pythonBackendProxyReachabilityEvidence
              ? ["python_backend_proxy_reachability_evidence_invalid"]
              : []),
            ...liveDialogReadinessBlockers,
          ],
          ...(pythonBackendProxyReachabilityEvidence ? { reachabilityEvidence: pythonBackendProxyReachabilityEvidence } : {}),
        },
        blockers: [
          ...(input.pythonBackendDependenciesInstalled ? [] : ["fastapi_uvicorn_websockets_not_installed"]),
          ...(input.pythonInferenceRuntimeInstalled ? [] : ["mlx_moshi_or_qwen3_tts_not_installed"]),
        ],
      },
      inferenceCandidates: [
        {
          id: "moshi-mlx",
          role: "full_duplex_speech_dialogue",
          localExecutionClaimed: false,
        },
        {
          id: "qwen3-tts",
          role: "streaming_tts_candidate",
          localExecutionClaimed: false,
        },
      ],
    },
    protocolLanes: [
      {
        id: "websocket-media",
        protocol: "websocket",
        role: "media-transport",
        status: "working_spike_transport",
        mediaAllowed: true,
        blockers: [],
        notes: "Only WebSocket binary-frame media has local transport evidence today.",
      },
      {
        id: "webtransport-http3-media",
        protocol: "webtransport",
        role: "media-transport",
        status: "proposal_required",
        mediaAllowed: false,
        blockers: [
          "bun_http3_webtransport_not_verified",
          "quest_webtransport_path_not_verified",
          "azure_http3_gateway_path_not_verified",
        ],
        notes: "HTTP/3 WebTransport remains a future media lane until server, headset, and ingress evidence are captured.",
      },
      {
        id: "direct-quic-media-gateway",
        protocol: "direct-quic",
        role: "media-transport",
        status: "proposal_required",
        mediaAllowed: false,
        blockers: [
          "operator_quic_gateway_proposal_missing",
          "quic_gateway_not_implemented",
          "azure_quic_ingress_not_verified",
        ],
        notes: "Direct QUIC may become a low-latency gateway lane only after architecture/security approval and local evidence.",
      },
      {
        id: "web3-identity-signaling",
        protocol: "web3-signaling",
        role: "identity-signaling-audit",
        status: "proposal_required",
        mediaAllowed: false,
        blockers: [
          "operator_web3_signaling_proposal_missing",
          "web3_identity_and_signaling_protocol_not_selected",
          "web3_media_transport_disallowed",
        ],
        notes: "Web3 is scoped to identity, signaling, consent, or audit experiments; it is not a clinical audio media path.",
      },
    ],
    providerGates: buildVoiceSpeechProviderGates(input, pythonBackendProxyReachabilityEvidence),
  };
}

const liveDialogReadinessBlockers = [
  "real_model_inference_not_observed",
  "quest_browser_audio_capture_not_observed",
  "quest_playback_not_observed",
  "opus_codec_not_verified",
  "clinical_voice_safety_not_exercised",
] as const;

function buildVoiceSpeechProviderGates(
  input: RealtimeVoiceGatewayPostureInput,
  reachabilityEvidence: RealtimeVoicePythonBackendProxyReachabilityEvidence | undefined,
): VoiceSpeechProviderGate[] {
  const sttTtsProviderPath = input.providerProfile === "production" ? "cloud-approved" : "local-runtime";
  const localRuntimeBlockers = [
    ...(input.pythonBackendDependenciesInstalled ? [] : ["fastapi_uvicorn_websockets_not_installed"]),
    ...(input.pythonInferenceRuntimeInstalled ? [] : ["mlx_moshi_or_qwen3_tts_not_installed"]),
    ...(reachabilityEvidence ? [] : ["python_backend_proxy_reachability_evidence_missing"]),
    ...liveDialogReadinessBlockers,
  ];

  return [
    voiceSpeechProviderGate({
      gateId: "stt",
      capability: "transcription",
      providerPath: sttTtsProviderPath,
      state: "planned_pending_evidence",
      blockers: [...localRuntimeBlockers, ...(input.providerProfile === "production" ? ["cloud_voice_provider_approval_missing", "voice_provider_credentials_missing"] : []), "stt_medical_vocabulary_wer_evidence_missing"],
      recommendedNextAction: "attach_stt_medical_vocabulary_and_latency_evidence",
    }),
    voiceSpeechProviderGate({
      gateId: "tts",
      capability: "synthesis",
      providerPath: sttTtsProviderPath,
      state: "planned_pending_evidence",
      blockers: [...localRuntimeBlockers, ...(input.providerProfile === "production" ? ["cloud_voice_provider_approval_missing", "voice_provider_credentials_missing"] : []), "tts_first_audio_latency_evidence_missing", "voice_safety_review_missing"],
      recommendedNextAction: "attach_tts_latency_and_voice_safety_evidence",
    }),
    voiceSpeechProviderGate({
      gateId: "emotional_prosody",
      capability: "emotional_prosody",
      providerPath: "blocked",
      state: "blocked",
      blockers: ["emotional_prosody_policy_review_missing", "affect_safety_review_missing"],
      recommendedNextAction: "complete_emotional_prosody_policy_review_before_enabling",
    }),
    voiceSpeechProviderGate({
      gateId: "lip_sync_timing",
      capability: "lip_sync_timing",
      providerPath: "blocked",
      state: "blocked",
      blockers: ["lip_sync_timing_evidence_missing", "viseme_phoneme_alignment_review_missing"],
      recommendedNextAction: "attach_lip_sync_timing_and_viseme_alignment_evidence",
    }),
  ];
}

function voiceSpeechProviderGate(
  input: Omit<VoiceSpeechProviderGate, "liveProviderReady" | "credentialEvidencePresent" | "runtimeEvidencePresent" | "claimBoundary">,
): VoiceSpeechProviderGate {
  return {
    ...input,
    liveProviderReady: false,
    credentialEvidencePresent: false,
    runtimeEvidencePresent: false,
    claimBoundary: "voice_provider_gate_metadata_not_live_dialog_readiness",
  };
}

function realtimeVoiceTransportProxyStatus(
  input: RealtimeVoiceGatewayPostureInput,
  reachabilityEvidence: RealtimeVoicePythonBackendProxyReachabilityEvidence | undefined,
): RealtimeVoiceGatewayPosture["backends"]["pythonFastApi"]["transportProxy"]["status"] {
  if (!input.pythonBackendWebSocketUrlConfigured) {
    return "not_configured";
  }
  return reachabilityEvidence ? "configured_reachability_verified" : "configured_not_verified";
}

function verifiedPythonBackendProxyReachabilityEvidence(
  evidence: RealtimeVoiceGatewayPostureInput["pythonBackendProxyReachabilityEvidence"],
): RealtimeVoicePythonBackendProxyReachabilityEvidence | undefined {
  if (!evidence) {
    return undefined;
  }
  const requiredEvents = [
    "backend.ready",
    "voice.started",
    "audio.chunk",
    "transcript.partial",
    "transcript.final",
    "voice.stopped",
  ];
  const eventTypes = new Set(evidence.eventTypesObserved);
  const provenanceComplete = evidence.sourceFile.trim().length > 0
    && typeof evidence.generatedAt === "string"
    && !Number.isNaN(Date.parse(evidence.generatedAt));
  const complete = evidence.status === "passed"
    && provenanceComplete
    && evidence.binaryMessages > 0
    && evidence.backendProtocolObserved
    && evidence.latencyFieldsObserved
    && evidence.binaryEchoObserved
    && requiredEvents.every((eventType) => eventTypes.has(eventType));

  return complete ? evidence : undefined;
}

export function selectRealtimeVoiceProtocol(
  posture: RealtimeVoiceGatewayPosture,
  options: {
    preferredProtocolLaneIds?: RealtimeVoiceProtocolLaneId[];
    requireMedia?: boolean;
  } = {},
): RealtimeVoiceProtocolSelection {
  const requireMedia = options.requireMedia ?? true;
  const preference = options.preferredProtocolLaneIds ?? posture.protocolLanes.map((lane) => lane.id);
  const lanesById = new Map(posture.protocolLanes.map((lane) => [lane.id, lane]));
  const rejectedLaneReasons: RealtimeVoiceProtocolSelection["rejectedLaneReasons"] = [];

  for (const laneId of preference) {
    const lane = lanesById.get(laneId);
    if (!lane) {
      continue;
    }

    if (requireMedia && lane.role !== "media-transport") {
      rejectedLaneReasons.push({
        id: lane.id,
        reason: "media_not_allowed",
        blockers: lane.blockers,
      });
      continue;
    }

    if (lane.status !== "working_spike_transport") {
      rejectedLaneReasons.push({
        id: lane.id,
        reason: "proposal_required",
        blockers: lane.blockers,
      });
      continue;
    }

    if (requireMedia && !lane.mediaAllowed) {
      rejectedLaneReasons.push({
        id: lane.id,
        reason: "media_not_allowed",
        blockers: lane.blockers,
      });
      continue;
    }

    return { selectedLane: lane, rejectedLaneReasons };
  }

  return { rejectedLaneReasons };
}

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
