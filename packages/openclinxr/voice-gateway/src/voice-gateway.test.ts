import { describe, expect, it } from "vitest";
import {
  collectVoiceStream,
  createDefaultVoiceGateway,
  createRealtimeVoiceGatewayPosture,
  createVibeVoiceProviderAdapter,
  LocalVoiceProviderAdapter,
  MockVoiceProviderAdapter,
  realtimeVoiceProtocol,
  selectRealtimeVoiceProtocol,
  type VoiceProviderAdapter,
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
      pythonBackendWebSocketUrlConfigured: true,
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
          transportProxy: {
            status: "configured_not_verified",
            backendUrlConfigured: true,
            readyForLiveDialog: false,
            blockers: expect.arrayContaining([
              "python_backend_proxy_reachability_not_claimed_by_posture_endpoint",
              "real_model_inference_not_observed",
            ]),
          },
          blockers: ["mlx_moshi_or_qwen3_tts_not_installed"],
        },
      },
      providerGates: expect.arrayContaining([
        expect.objectContaining({
          gateId: "stt",
          capability: "transcription",
          liveProviderReady: false,
          credentialEvidencePresent: false,
          runtimeEvidencePresent: false,
          blockers: expect.arrayContaining([
            "python_backend_proxy_reachability_evidence_missing",
            "real_model_inference_not_observed",
            "stt_medical_vocabulary_wer_evidence_missing",
          ]),
          claimBoundary: "voice_provider_gate_metadata_not_live_dialog_readiness",
        }),
        expect.objectContaining({
          gateId: "tts",
          capability: "synthesis",
          liveProviderReady: false,
          blockers: expect.arrayContaining([
            "tts_first_audio_latency_evidence_missing",
            "voice_safety_review_missing",
          ]),
        }),
        expect.objectContaining({
          gateId: "emotional_prosody",
          state: "blocked",
          blockers: ["emotional_prosody_policy_review_missing", "affect_safety_review_missing"],
        }),
        expect.objectContaining({
          gateId: "lip_sync_timing",
          state: "blocked",
          blockers: ["lip_sync_timing_evidence_missing", "viseme_phoneme_alignment_review_missing"],
        }),
      ]),
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

  it("promotes verified Python proxy reachability without claiming live dialog readiness", () => {
    const posture = createRealtimeVoiceGatewayPosture({
      bunAvailable: true,
      pythonBackendWebSocketUrlConfigured: true,
      pythonBackendDependenciesInstalled: true,
      pythonInferenceRuntimeInstalled: false,
      pythonBackendProxyReachabilityEvidence: {
        sourceFile: "docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json",
        generatedAt: "2026-05-06T01:52:40.346Z",
        status: "passed",
        eventTypesObserved: [
          "gateway.ready",
          "backend.ready",
          "voice.started",
          "audio.chunk",
          "transcript.partial",
          "transcript.final",
          "voice.stopped",
        ],
        binaryMessages: 1,
        backendProtocolObserved: true,
        latencyFieldsObserved: true,
        binaryEchoObserved: true,
      },
    });

    expect(posture.backends.pythonFastApi.transportProxy).toMatchObject({
      status: "configured_reachability_verified",
      backendUrlConfigured: true,
      readyForLiveDialog: false,
      reachabilityEvidence: {
        sourceFile: "docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json",
        status: "passed",
        eventTypesObserved: expect.arrayContaining(["backend.ready", "transcript.final"]),
        binaryMessages: 1,
        backendProtocolObserved: true,
        latencyFieldsObserved: true,
        binaryEchoObserved: true,
      },
    });
    expect(posture.backends.pythonFastApi.transportProxy.blockers).not.toContain(
      "python_backend_proxy_reachability_not_claimed_by_posture_endpoint",
    );
    expect(posture.backends.pythonFastApi.transportProxy.blockers).toEqual(expect.arrayContaining([
      "real_model_inference_not_observed",
      "quest_browser_audio_capture_not_observed",
      "quest_playback_not_observed",
      "opus_codec_not_verified",
      "clinical_voice_safety_not_exercised",
    ]));
    expect(posture.providerGates.every((gate) => gate.liveProviderReady === false)).toBe(true);
    expect(posture.providerGates.find((gate) => gate.gateId === "stt")?.blockers).toEqual(expect.arrayContaining([
      "real_model_inference_not_observed",
      "stt_medical_vocabulary_wer_evidence_missing",
    ]));
  });

  it("does not promote proxy reachability evidence when the backend URL is not configured", () => {
    const posture = createRealtimeVoiceGatewayPosture({
      bunAvailable: true,
      pythonBackendWebSocketUrlConfigured: false,
      pythonBackendDependenciesInstalled: true,
      pythonInferenceRuntimeInstalled: false,
      pythonBackendProxyReachabilityEvidence: {
        sourceFile: "docs/openclinxr/api-bun-python-proxy-runtime-smoke-2026-05-05.json",
        status: "passed",
        eventTypesObserved: ["backend.ready", "voice.started", "audio.chunk", "transcript.partial", "transcript.final", "voice.stopped"],
        binaryMessages: 1,
        backendProtocolObserved: true,
        latencyFieldsObserved: true,
        binaryEchoObserved: true,
      },
    });

    expect(posture.backends.pythonFastApi.transportProxy).toMatchObject({
      status: "not_configured",
      backendUrlConfigured: false,
      readyForLiveDialog: false,
    });
    expect(posture.backends.pythonFastApi.transportProxy).not.toHaveProperty("reachabilityEvidence");
    expect(posture.backends.pythonFastApi.transportProxy.blockers).toEqual(expect.arrayContaining([
      "python_backend_websocket_url_not_configured",
      "real_model_inference_not_observed",
    ]));
  });

  it("does not promote Python proxy reachability evidence without timestamped provenance", () => {
    const posture = createRealtimeVoiceGatewayPosture({
      bunAvailable: true,
      pythonBackendWebSocketUrlConfigured: true,
      pythonBackendDependenciesInstalled: true,
      pythonInferenceRuntimeInstalled: false,
      pythonBackendProxyReachabilityEvidence: {
        sourceFile: "",
        status: "passed",
        eventTypesObserved: ["backend.ready", "voice.started", "audio.chunk", "transcript.partial", "transcript.final", "voice.stopped"],
        binaryMessages: 1,
        backendProtocolObserved: true,
        latencyFieldsObserved: true,
        binaryEchoObserved: true,
      },
    });

    expect(posture.backends.pythonFastApi.transportProxy).toMatchObject({
      status: "configured_not_verified",
      backendUrlConfigured: true,
      readyForLiveDialog: false,
    });
    expect(posture.backends.pythonFastApi.transportProxy).not.toHaveProperty("reachabilityEvidence");
    expect(posture.backends.pythonFastApi.transportProxy.blockers).toEqual(expect.arrayContaining([
      "python_backend_proxy_reachability_evidence_invalid",
      "real_model_inference_not_observed",
    ]));
  });

  it("classifies production STT and TTS gates as cloud-approved without live readiness", () => {
    const posture = createRealtimeVoiceGatewayPosture({
      providerProfile: "production",
      bunAvailable: true,
      pythonBackendWebSocketUrlConfigured: true,
      pythonBackendDependenciesInstalled: true,
      pythonInferenceRuntimeInstalled: true,
    });

    expect(posture.providerGates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        gateId: "stt",
        providerPath: "cloud-approved",
        state: "planned_pending_evidence",
        liveProviderReady: false,
        credentialEvidencePresent: false,
        runtimeEvidencePresent: false,
        blockers: expect.arrayContaining([
          "cloud_voice_provider_approval_missing",
          "voice_provider_credentials_missing",
          "real_model_inference_not_observed",
          "stt_medical_vocabulary_wer_evidence_missing",
        ]),
      }),
      expect.objectContaining({
        gateId: "tts",
        providerPath: "cloud-approved",
        state: "planned_pending_evidence",
        liveProviderReady: false,
        credentialEvidencePresent: false,
        runtimeEvidencePresent: false,
        blockers: expect.arrayContaining([
          "cloud_voice_provider_approval_missing",
          "voice_provider_credentials_missing",
          "real_model_inference_not_observed",
          "tts_first_audio_latency_evidence_missing",
        ]),
      }),
    ]));
  });

  it("negotiates preferred realtime protocol lanes without allowing Web3 to carry media", () => {
    const posture = createRealtimeVoiceGatewayPosture({
      bunAvailable: true,
      pythonBackendWebSocketUrlConfigured: true,
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
        requestId: "voice-transcribe-request-001",
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
        provenance: expect.objectContaining({
          requestId: "voice-transcribe-request-001",
          providerId: "mock-voice",
          modelId: "deterministic-voice-mock",
          modelRuntimeName: "deterministic-voice-mock-runtime",
          safetyStatus: "not_exercised",
        }),
      },
      {
        eventType: "final_transcript",
        text: "When did the chest pressure start?",
        confidence: 0.99,
        atMs: 420,
        provenance: expect.objectContaining({
          requestId: "voice-transcribe-request-001",
          providerId: "mock-voice",
          modelId: "deterministic-voice-mock",
          modelRuntimeName: "deterministic-voice-mock-runtime",
          safetyStatus: "not_exercised",
        }),
      },
    ]);

    const audio = await collectVoiceStream(
      gateway.synthesize({
        requestId: "voice-synthesis-request-001",
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
        provenance: expect.objectContaining({
          requestId: "voice-synthesis-request-001",
          providerId: "mock-voice",
          modelId: "deterministic-voice-mock",
          modelRuntimeName: "deterministic-voice-mock-runtime",
          safetyStatus: "not_exercised",
        }),
      },
    ]);
  });

  it("skips adapters with contradictory ready health blockers", async () => {
    const contradictoryReadyAdapter: VoiceProviderAdapter = {
      id: "contradictory-ready-voice",
      capabilities: ["synthesis"],
      async health() {
        return {
          providerId: "contradictory-ready-voice",
          status: "ready",
          blockers: ["runtime_still_blocked"],
        };
      },
      transcribe() {
        throw new Error("Contradictory adapter should not be selected");
      },
      synthesize() {
        throw new Error("Contradictory adapter should not be selected");
      },
    };
    const gateway = createDefaultVoiceGateway({
      adapters: [contradictoryReadyAdapter, new MockVoiceProviderAdapter()],
      routeId: "voice-offline-v1",
    });

    const audio = await collectVoiceStream(
      gateway.synthesize({
        requestId: "voice-synthesis-request-guard",
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

    expect(audio[0]?.provenance.providerId).toBe("mock-voice");
  });

  it("falls back to deterministic voice request IDs when supplied request IDs are blank", async () => {
    const gateway = createDefaultVoiceGateway({
      adapters: [new MockVoiceProviderAdapter()],
      routeId: "voice-offline-v1",
    });

    const audio = await collectVoiceStream(
      gateway.synthesize({
        requestId: "   ",
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

    expect(audio[0]?.provenance.requestId).toBe("run_001:patient_robert_hayes_v1:mock-robert-hayes:synthesis");
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

  it("exposes the named VibeVoice local runtime stub as not configured by default", async () => {
    const gateway = createDefaultVoiceGateway({
      adapters: [createVibeVoiceProviderAdapter()],
      routeId: "voice-local-v1",
    });

    expect(await gateway.health()).toEqual([
      {
        providerId: "local-vibevoice",
        status: "not_configured",
        blockers: ["local_voice_runtime_not_configured"],
      },
    ]);
  });

  it("returns immutable local adapter health blockers", async () => {
    const adapter = new LocalVoiceProviderAdapter({
      providerId: "local-vibevoice",
      blockers: ["local_voice_runtime_not_configured"],
    });
    const firstHealth = await adapter.health();
    firstHealth.blockers?.push("mutated_by_caller");

    expect(await adapter.health()).toEqual({
      providerId: "local-vibevoice",
      status: "not_configured",
      blockers: ["local_voice_runtime_not_configured"],
    });
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

  it("propagates cloud and paid policy violations from local voice runtime evidence", async () => {
    const gateway = createDefaultVoiceGateway({
      adapters: [
        new LocalVoiceProviderAdapter({
          providerId: "local-vibevoice",
          runtimeEvidence: {
            evidenceId: "local_voice_runtime_benchmark",
            sourceFile: "docs/openclinxr/local-voice-runtime-benchmark-2026-05-04.json",
            generatedAt: "2026-05-04T15:01:12Z",
            policy: {
              cloudApisUsed: true,
              paidApisUsed: true,
              productionUseAllowed: false,
              generatedAudioCommitted: false,
            },
            metrics: {
              realTimeFactor: 0.7,
            },
            verdict: {
              caveats: [],
            },
          },
        }),
      ],
      routeId: "voice-local-v1",
    });

    expect(await gateway.health()).toEqual([
      expect.objectContaining({
        providerId: "local-vibevoice",
        status: "blocked",
        blockers: expect.arrayContaining([
          "cloud_apis_used_in_source_runtime_benchmark",
          "paid_apis_used_in_source_runtime_benchmark",
        ]),
        evidence: expect.objectContaining({
          summary: expect.objectContaining({
            cloudApisUsed: true,
            paidApisUsed: true,
          }),
        }),
      }),
    ]);
  });
});
