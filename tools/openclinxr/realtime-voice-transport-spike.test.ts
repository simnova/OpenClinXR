import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildRealtimeVoiceTransportSpikeReport } from "./realtime-voice-transport-spike.js";

describe("realtime voice transport spike report", () => {
  it("measures a local bidirectional websocket proxy harness without claiming real inference readiness", async () => {
    const report = await buildRealtimeVoiceTransportSpikeReport({
      generatedAt: "2026-05-04T22:00:00.000Z",
      targetLatencyMs: 1_000,
      bunAvailable: false,
      godotAvailable: false,
    });

    expect(report.policy).toEqual({
      cloudApisUsed: false,
      paidApisUsed: false,
      modelDownloadsPerformed: false,
      productionUseAllowed: false,
    });
    expect(report.architecture).toMatchObject({
      questClient: {
        target: "quest3-godot",
        transport: "websocket-binary-frames",
        codecContract: "opus-frame-contract",
      },
      gateway: {
        target: "apps/api bun+hono",
        verifiedLocalFallback: "apps/mock-realtime-voice-server node+hono+ws",
      },
      pythonBackend: {
        appPath: "apps/api-python-backend",
        target: "fastapi-uvicorn-websocket",
      },
    });
    expect(report.apiProtocolPosture.protocols).toEqual(expect.arrayContaining([
      expect.objectContaining({
        protocolId: "websocket",
        status: "contract_ready",
        blockers: expect.arrayContaining(["api_bun_websocket_runtime_not_verified"]),
      }),
      expect.objectContaining({ protocolId: "webtransport", status: "blocked" }),
      expect.objectContaining({ protocolId: "quic", status: "planned" }),
      expect.objectContaining({ protocolId: "web3-signaling", status: "planned" }),
    ]));
    expect(report.protocolEvidence).toEqual({
      websocketLocalHarnessObserved: true,
      bunHonoRuntimeObserved: false,
      webTransportObserved: false,
      quicObserved: false,
      web3SignalingObserved: false,
      notes: [
        "Only the local WebSocket transport harness has execution evidence in this report.",
        "WebTransport, direct QUIC, and Web3 signaling remain proposal- and evidence-gated.",
      ],
    });
    expect(report.harness).toMatchObject({
      controlFramesSent: 2,
      binaryAudioChunksSent: 2,
      transcriptEventsReceived: 2,
      binaryAudioChunksReceived: 2,
      latencyBudget: { targetMs: 1_000, passed: true },
    });
    expect(report.pythonBackendVerifier).toMatchObject({
      status: "passed",
      command: "python3 apps/api-python-backend/scripts/verify_backend.py",
    });
    expect(report.questClientSourceContract).toEqual({
      status: "source_contract_observed",
      appPath: "apps/ui-quest-voice-godot",
      sourceContractObserved: true,
      godotRuntimeAvailable: false,
      dependencyFreeSidecar: true,
      websocketPeerObserved: true,
      audioMetadataObserved: true,
      opaqueBinaryPacketProbeObserved: true,
      productionAudioClaims: false,
      blockers: [
        "godot_runtime_not_installed_on_this_machine",
        "quest_device_execution_not_observed",
        "native_opus_codec_not_integrated_in_godot",
        "quest_microphone_capture_not_observed",
        "quest_audio_playback_not_observed",
      ],
    });
    expect(report.verdict).toEqual({
      transportContractPassed: true,
      readyForLiveDialog: false,
      blockers: [
        "quest_godot_client_not_executed",
        "native_opus_codec_not_integrated_in_godot",
        "bun_runtime_not_installed_on_this_machine",
        "bun_to_fastapi_proxy_runtime_not_verified",
        "fastapi_backend_not_runtime_executed",
        "real_moshi_or_qwen3_inference_not_observed",
        "quest_microphone_and_playback_latency_not_measured",
        "clinical_voice_safety_controls_not_exercised_with_real_model",
      ],
      caveats: [
        "The measured harness uses a Python-compatible local fixture behind a Node/Hono/WebSocket fallback; it validates streaming shape and latency plumbing only.",
        "The committed FastAPI backend is source-verified with stdlib checks, but FastAPI/Uvicorn/MLX/Moshi/Qwen dependencies are not installed or executed by this spike.",
        "Bun/Hono to FastAPI runtime proxy evidence is still required before claiming the target gateway-to-backend transport path.",
      ],
    });
  });

  it("uses a passed FastAPI runtime smoke to retire the stale backend-not-executed blocker only", async () => {
    const report = await buildRealtimeVoiceTransportSpikeReport({
      generatedAt: "2026-05-04T22:30:00.000Z",
      targetLatencyMs: 250,
      bunAvailable: false,
      godotAvailable: true,
      apiPythonBackendRuntimeSmoke: {
        status: "passed",
        health: { ok: true, latencyMs: 40 },
        websocket: {
          connected: true,
          controlAckObserved: true,
          audioMetadataObserved: true,
          transcriptDeltaObserved: true,
          binaryEchoObserved: true,
          latencyMs: 12,
          protocol: {
            backendProtocolObserved: true,
            latencyFieldsObserved: true,
            canonicalProtocolObserved: true,
          },
        },
        verdict: {
          passed: true,
          blockers: [],
        },
      },
    });

    expect(report.pythonBackendRuntimeSmoke).toEqual({
      status: "passed",
      blockers: [],
      healthOk: true,
      websocketConnected: true,
      websocketLatencyMs: 12,
      protocolObserved: {
        backendProtocolObserved: true,
        latencyFieldsObserved: true,
        canonicalProtocolObserved: true,
      },
    });
    expect(report.verdict.blockers).not.toContain("fastapi_backend_not_runtime_executed");
    expect(report.verdict.blockers).toEqual(expect.arrayContaining([
      "bun_to_fastapi_proxy_runtime_not_verified",
      "real_moshi_or_qwen3_inference_not_observed",
      "quest_microphone_and_playback_latency_not_measured",
      "clinical_voice_safety_controls_not_exercised_with_real_model",
    ]));
    expect(report.verdict.caveats.join("\n")).toContain("FastAPI runtime smoke passed");
    expect(report.verdict.readyForLiveDialog).toBe(false);
    expect(report.questClientSourceContract.blockers).not.toContain("godot_runtime_not_installed_on_this_machine");
  });

  it("uses passed Bun runtime smoke evidence to retire only the Bun blocker and mark websocket runtime ready", async () => {
    const report = await buildRealtimeVoiceTransportSpikeReport({
      generatedAt: "2026-05-04T22:35:00.000Z",
      targetLatencyMs: 250,
      bunAvailable: false,
      godotAvailable: false,
      apiBunWebSocketRuntimeSmoke: {
        status: "passed",
        policy: {
          http3Enabled: false,
        },
        bun: {
          executable: "/Users/patrick/.bun/bin/bun",
          version: "1.3.13",
          revision: "1.3.13+bf2e2cecf",
        },
        runtime: {
          h3: {
            enabled: false,
            h3TrueEnabled: false,
            optionPresentInServerSource: false,
            outOfScopeForThisSmoke: true,
          },
        },
        runtimeEvidenceBlockers: [],
        websocket: {
          connected: true,
          controlAckObserved: true,
          audioMetadataObserved: true,
          transcriptDeltaObserved: true,
          binaryEchoObserved: true,
        },
        verdict: {
          smokePassed: true,
        },
      },
    });

    expect(report).toMatchObject({
      apiBunRuntimeEvidence: {
        sources: ["api-bun-websocket-runtime-smoke"],
        executable: "/Users/patrick/.bun/bin/bun",
        version: "1.3.13",
        revision: "1.3.13+bf2e2cecf",
        http3Enabled: false,
        h3TrueEnabled: false,
        optionPresentInServerSource: false,
        outOfScopeForThisSmoke: true,
      },
    });
    expect(report.apiBunWebSocketRuntimeSmoke).toEqual({
      status: "passed",
      blockers: [],
      websocketConnected: true,
      controlAckObserved: true,
      audioMetadataObserved: true,
      transcriptDeltaObserved: true,
      binaryEchoObserved: true,
    });
    expect(report.protocolEvidence.bunHonoRuntimeObserved).toBe(true);
    expect(report.apiProtocolPosture.protocols).toEqual(expect.arrayContaining([
      expect.objectContaining({
        protocolId: "websocket",
        status: "ready",
        blockers: [],
      }),
    ]));
    expect(report.verdict.blockers).not.toContain("bun_runtime_not_installed_on_this_machine");
    expect(report.verdict.blockers).toEqual(expect.arrayContaining([
      "bun_to_fastapi_proxy_runtime_not_verified",
      "fastapi_backend_not_runtime_executed",
      "real_moshi_or_qwen3_inference_not_observed",
      "quest_microphone_and_playback_latency_not_measured",
      "clinical_voice_safety_controls_not_exercised_with_real_model",
    ]));
    expect(report.verdict.readyForLiveDialog).toBe(false);
  });

  it("keeps Bun runtime evidence blocked when supplied smoke has runtime blockers", async () => {
    const report = await buildRealtimeVoiceTransportSpikeReport({
      generatedAt: "2026-05-04T22:36:00.000Z",
      targetLatencyMs: 250,
      bunAvailable: false,
      apiBunWebSocketRuntimeSmoke: {
        status: "blocked",
        runtimeEvidenceBlockers: ["websocket_binary_echo_missing"],
        websocket: {
          connected: true,
          controlAckObserved: true,
          audioMetadataObserved: true,
          transcriptDeltaObserved: true,
          binaryEchoObserved: false,
        },
        verdict: {
          smokePassed: false,
        },
      },
    });

    expect(report.apiBunWebSocketRuntimeSmoke).toEqual({
      status: "blocked",
      blockers: ["websocket_binary_echo_missing", "runtime_smoke_binary_echo_missing"],
      websocketConnected: true,
      controlAckObserved: true,
      audioMetadataObserved: true,
      transcriptDeltaObserved: true,
      binaryEchoObserved: false,
    });
    expect(report.protocolEvidence.bunHonoRuntimeObserved).toBe(false);
    expect(report.verdict.blockers).toContain("bun_runtime_not_installed_on_this_machine");
  });

  it("uses passed Bun-to-FastAPI proxy evidence to retire gateway and backend runtime blockers", async () => {
    const report = await buildRealtimeVoiceTransportSpikeReport({
      generatedAt: "2026-05-05T18:30:00.000Z",
      targetLatencyMs: 250,
      bunAvailable: false,
      godotAvailable: false,
      apiBunPythonProxyRuntimeSmoke: {
        status: "passed",
        policy: {
          http3Enabled: false,
        },
        bun: {
          executable: "/Users/patrick/.bun/bin/bun",
          version: "1.3.13",
          revision: "1.3.13+bf2e2cecf",
        },
        runtimeEvidenceBlockers: [],
        pythonBackend: {
          healthOk: true,
        },
        bunGateway: {
          healthOk: true,
          backendUrlConfigured: true,
        },
        websocket: {
          connected: true,
          eventTypesObserved: [
            "gateway.ready",
            "backend.ready",
            "voice.started",
            "audio.chunk",
            "transcript.partial",
            "transcript.final",
            "voice.stopped",
          ],
          backendProtocolObserved: true,
          latencyFieldsObserved: true,
          binaryEchoObserved: true,
        },
        verdict: {
          smokePassed: true,
          blockers: [
            "real_model_inference_not_observed",
            "quest_browser_audio_capture_not_observed",
          ],
        },
      },
    });

    expect(report).toMatchObject({
      apiBunRuntimeEvidence: {
        sources: ["api-bun-python-proxy-runtime-smoke"],
        executable: "/Users/patrick/.bun/bin/bun",
        version: "1.3.13",
        revision: "1.3.13+bf2e2cecf",
        http3Enabled: false,
        h3TrueEnabled: false,
        optionPresentInServerSource: false,
        outOfScopeForThisSmoke: true,
      },
    });
    expect(report.apiBunPythonProxyRuntimeSmoke).toEqual({
      status: "passed",
      blockers: [],
      pythonBackendHealthOk: true,
      bunGatewayHealthOk: true,
      backendUrlConfigured: true,
      websocketConnected: true,
      backendReadyObserved: true,
      backendProtocolObserved: true,
      latencyFieldsObserved: true,
      binaryEchoObserved: true,
      eventTypesObserved: [
        "gateway.ready",
        "backend.ready",
        "voice.started",
        "audio.chunk",
        "transcript.partial",
        "transcript.final",
        "voice.stopped",
      ],
    });
    expect(report.protocolEvidence.bunHonoRuntimeObserved).toBe(true);
    expect(report.apiProtocolPosture.protocols).toEqual(expect.arrayContaining([
      expect.objectContaining({
        protocolId: "websocket",
        status: "ready",
        blockers: [],
      }),
    ]));
    expect(report.verdict.blockers).not.toContain("bun_runtime_not_installed_on_this_machine");
    expect(report.verdict.blockers).not.toContain("bun_to_fastapi_proxy_runtime_not_verified");
    expect(report.verdict.blockers).not.toContain("fastapi_backend_not_runtime_executed");
    expect(report.verdict.blockers).toEqual(expect.arrayContaining([
      "real_moshi_or_qwen3_inference_not_observed",
      "quest_microphone_and_playback_latency_not_measured",
      "clinical_voice_safety_controls_not_exercised_with_real_model",
    ]));
    expect(report.verdict.caveats.join("\n")).toContain("Bun/Hono to FastAPI runtime proxy smoke passed");
    expect(report.verdict.readyForLiveDialog).toBe(false);
  });

  it("keeps FastAPI runtime smoke blocked when websocket protocol evidence is stale", async () => {
    const report = await buildRealtimeVoiceTransportSpikeReport({
      generatedAt: "2026-05-04T22:40:00.000Z",
      targetLatencyMs: 250,
      bunAvailable: true,
      apiPythonBackendRuntimeSmoke: {
        status: "passed",
        health: { ok: true, latencyMs: 40 },
        websocket: {
          connected: true,
          controlAckObserved: true,
          audioMetadataObserved: true,
          transcriptDeltaObserved: true,
          binaryEchoObserved: true,
          latencyMs: 12,
          protocol: {
            backendProtocolObserved: false,
            latencyFieldsObserved: false,
            canonicalProtocolObserved: false,
          },
        },
        verdict: {
          passed: true,
          blockers: [],
        },
      },
    });

    expect(report.pythonBackendRuntimeSmoke).toEqual({
      status: "blocked",
      blockers: [
        "runtime_smoke_backend_protocol_missing",
        "runtime_smoke_latency_fields_missing",
        "runtime_smoke_canonical_protocol_missing",
      ],
      healthOk: true,
      websocketConnected: true,
      websocketLatencyMs: 12,
      protocolObserved: {
        backendProtocolObserved: false,
        latencyFieldsObserved: false,
        canonicalProtocolObserved: false,
      },
    });
    expect(report.verdict.transportContractPassed).toBe(false);
    expect(report.verdict.blockers).toContain("fastapi_backend_not_runtime_executed");
    expect(report.verdict.blockers).toContain("bun_to_fastapi_proxy_runtime_not_verified");
  });

  it("blocks the transport contract when supplied FastAPI runtime smoke is blocked", async () => {
    const report = await buildRealtimeVoiceTransportSpikeReport({
      generatedAt: "2026-05-04T22:45:00.000Z",
      targetLatencyMs: 250,
      bunAvailable: true,
      apiPythonBackendRuntimeSmoke: {
        status: "blocked",
        health: { ok: true, latencyMs: 38 },
        websocket: {
          connected: false,
          controlAckObserved: false,
          audioMetadataObserved: false,
          transcriptDeltaObserved: false,
          binaryEchoObserved: false,
          latencyMs: null,
        },
        verdict: {
          passed: false,
          blockers: ["server_not_started"],
        },
      },
    });

    expect(report.status).toBe("blocked");
    expect(report.pythonBackendRuntimeSmoke).toEqual({
      status: "blocked",
      blockers: [
        "server_not_started",
        "runtime_smoke_websocket_not_connected",
        "runtime_smoke_control_ack_missing",
        "runtime_smoke_audio_metadata_missing",
        "runtime_smoke_transcript_delta_missing",
        "runtime_smoke_binary_echo_missing",
        "runtime_smoke_backend_protocol_missing",
        "runtime_smoke_latency_fields_missing",
        "runtime_smoke_canonical_protocol_missing",
      ],
      healthOk: true,
      websocketConnected: false,
      websocketLatencyMs: null,
      protocolObserved: {
        backendProtocolObserved: false,
        latencyFieldsObserved: false,
        canonicalProtocolObserved: false,
      },
    });
    expect(report.verdict.transportContractPassed).toBe(false);
    expect(report.verdict.blockers).toContain("fastapi_backend_not_runtime_executed");
    expect(report.verdict.blockers).not.toContain("bun_runtime_not_installed_on_this_machine");
    expect(report.verdict.blockers).toContain("bun_to_fastapi_proxy_runtime_not_verified");
  });

  it("keeps the committed 2026-05-06 realtime transport evidence bounded to local WebSocket proof", async () => {
    const report = JSON.parse(
      await readFile("docs/openclinxr/realtime-voice-transport-spike-2026-05-06.json", "utf8"),
    );

    expect(report).toMatchObject({
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        modelDownloadsPerformed: false,
        productionUseAllowed: false,
      },
      protocolEvidence: {
        websocketLocalHarnessObserved: true,
        bunHonoRuntimeObserved: true,
        webTransportObserved: false,
        quicObserved: false,
        web3SignalingObserved: false,
      },
      apiBunRuntimeEvidence: {
        sources: ["api-bun-websocket-runtime-smoke", "api-bun-python-proxy-runtime-smoke"],
        executable: "/Users/patrick/.bun/bin/bun",
        version: "1.3.13",
        revision: "1.3.13+bf2e2cecf",
        http3Enabled: false,
        h3TrueEnabled: false,
        optionPresentInServerSource: false,
        outOfScopeForThisSmoke: true,
      },
      pythonBackendRuntimeSmoke: { status: "passed", blockers: [] },
      apiBunWebSocketRuntimeSmoke: {
        status: "passed",
        blockers: [],
        websocketConnected: true,
        binaryEchoObserved: true,
      },
      apiBunPythonProxyRuntimeSmoke: {
        status: "passed",
        blockers: [],
        backendReadyObserved: true,
        backendProtocolObserved: true,
        latencyFieldsObserved: true,
        binaryEchoObserved: true,
      },
      verdict: {
        transportContractPassed: true,
        readyForLiveDialog: false,
        blockers: [
          "quest_godot_client_not_executed",
          "native_opus_codec_not_integrated_in_godot",
          "real_moshi_or_qwen3_inference_not_observed",
          "quest_microphone_and_playback_latency_not_measured",
          "clinical_voice_safety_controls_not_exercised_with_real_model",
        ],
      },
    });
  });
});
