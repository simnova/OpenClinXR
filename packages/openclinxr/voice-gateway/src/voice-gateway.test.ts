import { describe, expect, it } from "vitest";
import {
  collectVoiceStream,
  createDefaultVoiceGateway,
  createRealtimeVoiceGatewayPosture,
  LocalVoiceProviderAdapter,
  MockVoiceProviderAdapter,
  realtimeVoiceProtocol,
  selectRealtimeVoiceProtocol,
} from "./index.js";

describe("voice gateway", () => {
  it("exports a canonical realtime voice frame taxonomy for gateway, Python, and Godot clients", () => {
    expect(realtimeVoiceProtocol).toEqual({
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
    });
  });

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

  it("reports local VibeVoice benchmark evidence as blocked for live Quest dialog", async () => {
    const gateway = createDefaultVoiceGateway({
      adapters: [
        new LocalVoiceProviderAdapter({
          providerId: "local-vibevoice",
          runtimeEvidence: {
            evidenceId: "local_voice_runtime_benchmark",
            sourceFile: "docs/openclinxr/local-voice-runtime-benchmark-2026-05-04.json",
            generatedAt: "2026-05-04T15:01:12Z",
            policy: {
              productionUseAllowed: false,
              generatedAudioCommitted: false,
            },
            runtime: {
              modelId: "microsoft/VibeVoice-Realtime-0.5B",
              device: "mps",
            },
            audio: {
              durationMs: 3466.667,
              sampleRateHz: 24000,
            },
            metrics: {
              wallClockMs: 118920,
              modelGenerationMs: 18170,
              realTimeFactor: 5.24,
              approxFirstSpeechTokenLatencyMs: 9000,
            },
            verdict: {
              caveats: [
                "This measured file-based local generation, not WebXR playback or a live streaming websocket turn.",
                "Real-time factor was 5.24x on this Apple M1 Max, so current local VibeVoice is not yet Quest-ready for live dialog.",
              ],
            },
          },
        }),
      ],
      routeId: "voice-local-v1",
    });

    expect(await gateway.health()).toEqual([
      {
        providerId: "local-vibevoice",
        status: "blocked",
        blockers: [
          "runtime_file_generation_only",
          "real_time_factor_above_1",
          "real_local_voice_stream_benchmark_missing",
          "webxr_playback_not_observed",
        ],
        evidence: {
          evidenceId: "local_voice_runtime_benchmark",
          sourceFile: "docs/openclinxr/local-voice-runtime-benchmark-2026-05-04.json",
          generatedAt: "2026-05-04T15:01:12Z",
          summary: {
            modelId: "microsoft/VibeVoice-Realtime-0.5B",
            device: "mps",
            realTimeFactor: 5.24,
            approximateFirstSpeechTokenLatencyMs: 9000,
            wallClockMs: 118920,
            modelGenerationMs: 18170,
            audioDurationMs: 3466.667,
            sampleRateHz: 24000,
            productionUseAllowed: false,
            generatedAudioCommitted: false,
            caveatCount: 2,
          },
        },
      },
    ]);
  });
});
