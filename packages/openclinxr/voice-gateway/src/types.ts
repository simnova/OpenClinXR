import { type ProviderAuditRecord, type ProviderHealth, validateProviderHealth } from "@cellix/provider-contracts";

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

