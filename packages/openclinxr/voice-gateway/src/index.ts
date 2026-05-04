import type { ProviderHealth } from "@openclinxr/shared-schemas";

export type VoiceCapability = "transcription" | "synthesis" | "viseme_cues";

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
      blockers: string[];
    };
    inferenceCandidates: Array<{
      id: "moshi-mlx" | "qwen3-tts";
      role: "full_duplex_speech_dialogue" | "streaming_tts_candidate";
      localExecutionClaimed: false;
    }>;
  };
  protocolLanes: Array<{
    id:
      | "websocket-media"
      | "webtransport-http3-media"
      | "direct-quic-media-gateway"
      | "web3-identity-signaling";
    protocol: "websocket" | "webtransport" | "direct-quic" | "web3-signaling";
    role: "media-transport" | "identity-signaling-audit";
    status: "working_spike_transport" | "proposal_required";
    mediaAllowed: boolean;
    blockers: string[];
    notes: string;
  }>;
};

export type VoiceRequestPolicy = {
  requestPolicyId: string;
  safetyPolicyVersion: string;
};

export type VoiceProvenance = {
  providerId: string;
  modelId: string;
  modelVersion: string;
  requestPolicyId: string;
  safetyPolicyVersion: string;
  latencyMs: number;
  costEstimateUsd: number;
};

export type SpeechInput = {
  stationRunId: string;
  streamId: string;
  language: string;
  audioFormat: string;
  policy: VoiceRequestPolicy;
};

export type SpeechSynthesisRequest = {
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
      if (health.status === "ready" && adapter.capabilities.includes(capability)) {
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
  bunAvailable: boolean;
  pythonBackendDependenciesInstalled: boolean;
  pythonInferenceRuntimeInstalled: boolean;
};

export function createRealtimeVoiceGatewayPosture(input: RealtimeVoiceGatewayPostureInput): RealtimeVoiceGatewayPosture {
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
        path: "/voice/realtime/ws",
        codec: "opus",
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
        websocketPath: "/voice/realtime/ws",
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
  };
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
    const provenance = this.provenance(input.policy);
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
      provenance: this.provenance(input.policy),
    };
  }

  private provenance(policy: VoiceRequestPolicy): VoiceProvenance {
    return {
      providerId: this.id,
      modelId: "deterministic-voice-mock",
      modelVersion: "1.0.0",
      requestPolicyId: policy.requestPolicyId,
      safetyPolicyVersion: policy.safetyPolicyVersion,
      latencyMs: 0,
      costEstimateUsd: 0,
    };
  }
}

export type LocalVoiceProviderOptions = {
  providerId: string;
  blockers?: string[];
};

export class LocalVoiceProviderAdapter implements VoiceProviderAdapter {
  readonly capabilities: VoiceCapability[] = ["transcription", "synthesis", "viseme_cues"];

  constructor(private readonly options: LocalVoiceProviderOptions) {}

  get id(): string {
    return this.options.providerId;
  }

  async health(): Promise<ProviderHealth> {
    return {
      providerId: this.id,
      status: "not_configured",
      blockers: this.options.blockers ?? ["local_voice_runtime_not_configured"],
    };
  }

  async *transcribe(): AsyncIterable<TranscriptEvent> {
    throw new Error(`Local voice provider ${this.id} is not configured`);
  }

  async *synthesize(): AsyncIterable<AudioEvent> {
    throw new Error(`Local voice provider ${this.id} is not configured`);
  }
}
