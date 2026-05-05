import { describe, expect, it } from "vitest";
import { buildRealtimeVoiceTransportSpikeReport } from "./realtime-voice-transport-spike.js";

describe("realtime voice transport spike report", () => {
  it("measures a local bidirectional websocket proxy harness without claiming real inference readiness", async () => {
    const report = await buildRealtimeVoiceTransportSpikeReport({
      generatedAt: "2026-05-04T22:00:00.000Z",
      targetLatencyMs: 250,
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
        blockers: expect.arrayContaining(["api_bun_websocket_upgrade_not_implemented"]),
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
      latencyBudget: { targetMs: 250, passed: true },
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
        "fastapi_backend_not_runtime_executed",
        "real_moshi_or_qwen3_inference_not_observed",
        "quest_microphone_and_playback_latency_not_measured",
        "clinical_voice_safety_controls_not_exercised_with_real_model",
      ],
      caveats: [
        "The measured harness uses a Python-compatible local fixture behind a Node/Hono/WebSocket fallback; it validates streaming shape and latency plumbing only.",
        "The committed FastAPI backend is source-verified with stdlib checks, but FastAPI/Uvicorn/MLX/Moshi/Qwen dependencies are not installed or executed by this spike.",
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
    });
    expect(report.verdict.blockers).not.toContain("fastapi_backend_not_runtime_executed");
    expect(report.verdict.blockers).toEqual(expect.arrayContaining([
      "real_moshi_or_qwen3_inference_not_observed",
      "quest_microphone_and_playback_latency_not_measured",
      "clinical_voice_safety_controls_not_exercised_with_real_model",
    ]));
    expect(report.verdict.caveats.join("\n")).toContain("FastAPI runtime smoke passed");
    expect(report.verdict.readyForLiveDialog).toBe(false);
    expect(report.questClientSourceContract.blockers).not.toContain("godot_runtime_not_installed_on_this_machine");
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
      ],
      healthOk: true,
      websocketConnected: false,
      websocketLatencyMs: null,
    });
    expect(report.verdict.transportContractPassed).toBe(false);
    expect(report.verdict.blockers).toContain("fastapi_backend_not_runtime_executed");
    expect(report.verdict.blockers).not.toContain("bun_runtime_not_installed_on_this_machine");
  });
});
