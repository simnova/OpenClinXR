import { describe, expect, it } from "vitest";
import {
  collectVoiceStream,
  createDefaultVoiceGateway,
  createRealtimeVoiceGatewayPosture,
  LocalVoiceProviderAdapter,
  MockVoiceProviderAdapter,
  selectRealtimeVoiceProtocol,
} from "./index.js";

describe("voice gateway", () => {
  it("owns realtime gateway posture separately from the mock server harness", () => {
    const posture = createRealtimeVoiceGatewayPosture({
      bunAvailable: false,
      pythonBackendDependenciesInstalled: true,
      pythonInferenceRuntimeInstalled: false,
    });

    expect(posture).toMatchObject({
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
        },
      },
      gatewayRuntime: {
        target: "bun-hono-http3",
        localVerifiedFallback: "node-hono-ws",
        blockers: ["bun_not_installed", "http3_webtransport_not_verified"],
      },
      backends: {
        pythonFastApi: {
          status: "available_for_local_run",
          blockers: ["mlx_moshi_or_qwen3_tts_not_installed"],
        },
      },
    });
    expect(posture.protocolLanes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "websocket-media",
        protocol: "websocket",
        role: "media-transport",
        status: "working_spike_transport",
        mediaAllowed: true,
        blockers: [],
      }),
      expect.objectContaining({
        id: "direct-quic-media-gateway",
        protocol: "direct-quic",
        role: "media-transport",
        status: "proposal_required",
        mediaAllowed: false,
        blockers: expect.arrayContaining([
          "operator_quic_gateway_proposal_missing",
          "quic_gateway_not_implemented",
          "azure_quic_ingress_not_verified",
        ]),
      }),
      expect.objectContaining({
        id: "web3-identity-signaling",
        protocol: "web3-signaling",
        role: "identity-signaling-audit",
        status: "proposal_required",
        mediaAllowed: false,
        blockers: expect.arrayContaining([
          "operator_web3_signaling_proposal_missing",
          "web3_identity_and_signaling_protocol_not_selected",
          "web3_media_transport_disallowed",
        ]),
      }),
    ]));
  });

  it("negotiates preferred realtime protocol lanes without allowing Web3 to carry media", () => {
    const posture = createRealtimeVoiceGatewayPosture({
      bunAvailable: true,
      pythonBackendDependenciesInstalled: true,
      pythonInferenceRuntimeInstalled: false,
    });

    const selection = selectRealtimeVoiceProtocol(posture, {
      preferredProtocolLaneIds: [
        "web3-identity-signaling",
        "direct-quic-media-gateway",
        "webtransport-http3-media",
        "websocket-media",
      ],
      requireMedia: true,
    });

    expect(selection.selectedLane).toMatchObject({
      id: "websocket-media",
      protocol: "websocket",
      mediaAllowed: true,
      blockers: [],
    });
    expect(selection.rejectedLaneReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "web3-identity-signaling",
        reason: "media_not_allowed",
        blockers: expect.arrayContaining(["web3_media_transport_disallowed"]),
      }),
      expect.objectContaining({
        id: "direct-quic-media-gateway",
        reason: "proposal_required",
        blockers: expect.arrayContaining(["operator_quic_gateway_proposal_missing", "quic_gateway_not_implemented"]),
      }),
      expect.objectContaining({
        id: "webtransport-http3-media",
        reason: "proposal_required",
        blockers: expect.arrayContaining(["bun_http3_webtransport_not_verified", "quest_webtransport_path_not_verified"]),
      }),
    ]));
  });

  it("streams deterministic mock transcript and synthesis events with provenance", async () => {
    const gateway = createDefaultVoiceGateway({
      adapters: [new MockVoiceProviderAdapter()],
      routeId: "voice-offline-v1",
    });

    const transcript = await collectVoiceStream(
      gateway.transcribe({
        stationRunId: "run_001",
        streamId: "learner-mic-001",
        language: "en-US",
        audioFormat: "mock/pcm",
        policy: {
          requestPolicyId: "voice-offline-v1",
          safetyPolicyVersion: "clinical-simulation-safety-v1",
        },
      }),
    );

    expect(transcript).toEqual([
      {
        eventType: "partial_transcript",
        text: "When did",
        confidence: 0.75,
        atMs: 120,
        provenance: expect.objectContaining({ providerId: "mock-voice", modelId: "deterministic-voice-mock" }),
      },
      {
        eventType: "final_transcript",
        text: "When did the chest pressure start?",
        confidence: 0.99,
        atMs: 420,
        provenance: expect.objectContaining({ providerId: "mock-voice", modelId: "deterministic-voice-mock" }),
      },
    ]);

    const audio = await collectVoiceStream(
      gateway.synthesize({
        stationRunId: "run_001",
        actorId: "patient_robert_hayes_v1",
        voiceId: "mock-robert-hayes",
        text: "It started while I was walking upstairs.",
        policy: {
          requestPolicyId: "voice-offline-v1",
          safetyPolicyVersion: "clinical-simulation-safety-v1",
        },
      }),
    );

    expect(audio).toEqual([
      {
        eventType: "audio_chunk",
        audioFormat: "audio/mock",
        chunkIndex: 0,
        durationMs: 1100,
        visemeCue: "neutral-pain",
        provenance: expect.objectContaining({ providerId: "mock-voice", modelId: "deterministic-voice-mock" }),
      },
    ]);
  });

  it("keeps local voice adapters visible but unavailable until configured", async () => {
    const gateway = createDefaultVoiceGateway({
      adapters: [new LocalVoiceProviderAdapter({ providerId: "local-vibevoice" })],
      routeId: "voice-local-v1",
    });

    expect(await gateway.health()).toEqual([
      {
        providerId: "local-vibevoice",
        status: "not_configured",
        blockers: ["local_voice_runtime_not_configured"],
      },
    ]);
    await expect(
      collectVoiceStream(
        gateway.synthesize({
          stationRunId: "run_001",
          actorId: "patient_robert_hayes_v1",
          voiceId: "local-robert-hayes",
          text: "Hello.",
          policy: {
            requestPolicyId: "voice-local-v1",
            safetyPolicyVersion: "clinical-simulation-safety-v1",
          },
        }),
      ),
    ).rejects.toThrow("No ready voice provider");
  });
});
