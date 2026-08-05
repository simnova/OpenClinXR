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

