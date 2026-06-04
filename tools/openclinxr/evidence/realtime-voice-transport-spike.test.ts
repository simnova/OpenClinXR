import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRealtimeVoiceTransportSpikeReport,
  main,
  validateRealtimeVoiceTransportSpikeReport,
} from "./realtime-voice-transport-spike.js";

describe("realtime voice transport spike report", () => {
  it("exposes generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["local:voice:realtime-spike"]).toBe(
      "tsx tools/openclinxr/evidence/realtime-voice-transport-spike.ts",
    );
    expect(rootPackage.scripts["local:voice:realtime-spike:validate"]).toBe(
      "tsx tools/openclinxr/evidence/realtime-voice-transport-spike.ts --validate-latest",
    );
    expect(rootPackage.scripts["agent:verify"]).toContain("pnpm local:voice:realtime-spike:validate");
  });

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
        verifiedLocalFallback: "apps/arena/mock-realtime-voice-server node+hono+ws",
      },
      pythonBackend: {
        appPath: "apps/arena/api-python-backend",
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
      command: "python3 apps/arena/api-python-backend/scripts/verify_backend.py",
    });
    expect(report.questClientSourceContract).toEqual({
      status: "source_contract_observed",
      appPath: "apps/arena/ui-quest-voice-godot",
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
        "No real Moshi or Qwen voice inference was observed by this transport spike.",
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

  it("uses local Qwen TTS smoke evidence to retire only the generic real-inference blocker", async () => {
    const report = await buildRealtimeVoiceTransportSpikeReport({
      generatedAt: "2026-05-06T13:40:00.000Z",
      targetLatencyMs: 250,
      bunAvailable: false,
      godotAvailable: false,
      localQwenTtsRuntimeSmoke: {
        kind: "local_qwen_tts_runtime_smoke",
        claim_scope: "local_tts_inference_only",
        generatedAt: "2026-05-06T13:24:08Z",
        status: "passed_with_caveats",
        runtime: {
          modelId: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
          modelLicense: "Apache-2.0",
          sourceRecordIds: [
            "src-qwen3-tts-mlx-4bit-2026",
            "src-mlx-audio-pypi-2026",
          ],
          tool: "mlx-audio",
          toolVersion: "0.3.0",
          toolLicense: "MIT",
          pythonVersion: "3.11.4",
          exitStatus: 0,
          command: "/Users/patrick/.cache/openclinxr/realtime-voice/api-python-backend-venv/bin/python -m mlx_audio.tts.generate",
        },
        input: {
          text: "The patient reports chest pressure and needs help now.",
          textLength: 54,
          referenceAudioUsed: false,
        },
        audio: {
          outputPath: "/Users/patrick/.cache/openclinxr/realtime-voice/qwen-tts-smoke-2026-05-06-run2/openclinxr-qwen-smoke_000.wav",
          sha256: "eac24ecd365e266f71a960fe445d124f4a856db996694134f00e06d6b742bb1f",
          codec: "pcm_s16le",
          sampleRateHz: 24000,
          channels: 1,
          durationMs: 3360,
          sizeBytes: 161324,
          bitRate: 384000,
        },
        metrics: {
          wallClockMs: 6600,
          audioDurationMs: 3360,
          realTimeFactor: 1.96,
          maxResidentSetBytes: 1976532992,
          approxFirstAudiblePlaybackLatencyMs: null,
        },
        policy: {
          cloudApisUsed: false,
          paidApisUsed: false,
          productionUseAllowed: false,
          generatedAudioCommitted: false,
          fullDuplexClaimAllowed: false,
          clinicalValidityClaimAllowed: false,
          runtimeExecutionObserved: true,
          downloadAttemptedByThisTool: false,
          networkAccessObservedByThisTool: false,
        },
        modelCache: {
          evidenceKind: "local_voice_evidence_check",
          evidenceGeneratedAt: "2026-05-06T13:09:06.623Z",
          cacheDir: "/Users/patrick/.cache/openclinxr/realtime-voice",
          ready: true,
          readyModelObserved: true,
          readyModelIds: ["mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit"],
          blockers: [],
        },
        verdict: {
          passed: true,
          readyForLiveDialog: false,
          blockers: [],
          caveats: [
            "This is local outbound TTS file-generation evidence only; it is not full-duplex ASR/dialog evidence.",
          ],
        },
      },
    });

    expect(report.localQwenTtsRuntimeSmoke).toMatchObject({
      status: "passed",
      modelId: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
      realTimeFactor: 1.96,
      blockers: [],
    });
    expect(report.architecture.inferenceCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "qwen3-tts",
        executionObserved: true,
      }),
      expect.objectContaining({
        id: "moshi-mlx",
        executionObserved: false,
      }),
    ]));
    expect(report.verdict.blockers).not.toContain("real_moshi_or_qwen3_inference_not_observed");
    expect(report.verdict.blockers).toEqual(expect.arrayContaining([
      "qwen3_tts_not_full_duplex_dialog",
      "full_duplex_asr_dialog_model_not_observed",
      "quest_microphone_and_playback_latency_not_measured",
      "clinical_voice_safety_controls_not_exercised_with_real_model",
    ]));
    expect(report.verdict.caveats.join("\n")).toContain("Qwen3-TTS local inference was observed for outbound file generation only");
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

  it("keeps generated realtime transport evidence bounded to local WebSocket proof", async () => {
    const report = await buildRealtimeVoiceTransportSpikeReport({
      generatedAt: "2026-05-06T18:00:00.000Z",
      targetLatencyMs: 1_000,
      bunAvailable: false,
      godotAvailable: false,
    });

    expect(report).toMatchObject({
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        modelDownloadsPerformed: false,
        productionUseAllowed: false,
      },
      protocolEvidence: {
        websocketLocalHarnessObserved: true,
        bunHonoRuntimeObserved: false,
        webTransportObserved: false,
        quicObserved: false,
        web3SignalingObserved: false,
      },
      verdict: {
        transportContractPassed: true,
        readyForLiveDialog: false,
        blockers: expect.arrayContaining([
          "quest_godot_client_not_executed",
          "native_opus_codec_not_integrated_in_godot",
          "real_moshi_or_qwen3_inference_not_observed",
          "quest_microphone_and_playback_latency_not_measured",
          "clinical_voice_safety_controls_not_exercised_with_real_model",
        ]),
      },
    });
  });

  it("validates generated realtime transport evidence safety and protocol boundary", async () => {
    const report = await buildRealtimeVoiceTransportSpikeReport({
      generatedAt: "2026-05-06T18:00:00.000Z",
      targetLatencyMs: 1_000,
      bunAvailable: false,
      godotAvailable: false,
    });

    expect(validateRealtimeVoiceTransportSpikeReport(report)).toEqual({ ok: true });

    const invalid = structuredClone(report) as {
      policy: Partial<{ productionUseAllowed: boolean }>;
      protocolEvidence: { webTransportObserved: boolean };
      verdict: { readyForLiveDialog: boolean };
    };
    delete invalid.policy.productionUseAllowed;
    invalid.protocolEvidence.webTransportObserved = true;
    invalid.verdict.readyForLiveDialog = true;

    expect(validateRealtimeVoiceTransportSpikeReport(invalid)).toEqual({
      ok: false,
      errors: [
        "/policy/productionUseAllowed must be false",
        "/protocolEvidence/webTransportObserved must be false",
        "/verdict/readyForLiveDialog must be false",
      ],
    });
  });

  it("requires status and expected blockers to match generated evidence", async () => {
    const report = await buildRealtimeVoiceTransportSpikeReport({
      generatedAt: "2026-05-06T18:00:00.000Z",
      targetLatencyMs: 1_000,
      bunAvailable: false,
      godotAvailable: false,
    });
    const invalid = structuredClone(report) as {
      status: string;
      verdict: { blockers: string[] };
    };
    invalid.status = "blocked";
    invalid.verdict.blockers = invalid.verdict.blockers.filter(
      (blocker) => blocker !== "real_moshi_or_qwen3_inference_not_observed",
    );

    expect(validateRealtimeVoiceTransportSpikeReport(invalid)).toEqual({
      ok: false,
      errors: [
        "/status must be transport_spike_passed when /verdict/transportContractPassed is true",
        "/verdict/blockers missing expected blocker real_moshi_or_qwen3_inference_not_observed",
      ],
    });
  });

  it("validates CLI reports by explicit path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-realtime-transport-validate-"));
    try {
      const report = await buildRealtimeVoiceTransportSpikeReport({
        generatedAt: "2026-05-06T18:00:00.000Z",
        targetLatencyMs: 1_000,
        bunAvailable: false,
        godotAvailable: false,
      });
      const output = path.join(dir, "report.json");
      await writeFile(output, JSON.stringify(report, null, 2));

      await expect(main(["--validate", output])).resolves.toBeUndefined();

      const invalid = structuredClone(report) as {
        protocolEvidence: { webTransportObserved: boolean };
      };
      invalid.protocolEvidence.webTransportObserved = true;
      const invalidOutput = path.join(dir, "invalid-report.json");
      await writeFile(invalidOutput, JSON.stringify(invalid, null, 2));
      process.exitCode = undefined;

      await expect(main(["--validate", invalidOutput])).resolves.toBeUndefined();

      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = undefined;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
