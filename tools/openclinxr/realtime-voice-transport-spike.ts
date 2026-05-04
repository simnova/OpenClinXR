import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  runRealtimeVoiceProxyHarness,
  startPythonCompatibleVoiceBackendFixture,
  startRealtimeVoiceGatewayServer,
} from "../../apps/mock-realtime-voice-server/src/index.js";
import { createOpenClinXrApiProtocolPosture, type OpenClinXrApiProtocolPosture } from "../../apps/api/src/index.js";
import { readJson, writeJson } from "../agent-factory/lib.js";

const execFileAsync = promisify(execFile);

type CliOptions = {
  outputPath?: string;
  apiPythonBackendRuntimeSmokePath?: string;
};

type ApiPythonBackendRuntimeSmokeEvidence = {
  status: string;
  health: {
    ok: boolean;
    latencyMs: number | null;
  };
  websocket: {
    connected: boolean;
    controlAckObserved: boolean;
    audioMetadataObserved: boolean;
    transcriptDeltaObserved: boolean;
    binaryEchoObserved: boolean;
    latencyMs: number | null;
  };
  verdict: {
    passed: boolean;
    blockers: string[];
  };
};

export type RealtimeVoiceTransportSpikeReport = {
  generatedAt: string;
  status: "transport_spike_passed" | "blocked";
  policy: {
    cloudApisUsed: false;
    paidApisUsed: false;
    modelDownloadsPerformed: false;
    productionUseAllowed: false;
  };
  architecture: {
    questClient: {
      target: "quest3-godot";
      transport: "websocket-binary-frames";
      codecContract: "opus-frame-contract";
      note: string;
    };
    gateway: {
      target: "apps/api bun+hono";
      verifiedLocalFallback: "apps/mock-realtime-voice-server node+hono+ws";
      websocketPath: "/voice/realtime/ws";
    };
    pythonBackend: {
      appPath: "apps/api-python-backend";
      target: "fastapi-uvicorn-websocket";
      websocketPath: "/voice/realtime/ws";
    };
    inferenceCandidates: Array<{
      id: "moshi-mlx" | "qwen3-tts";
      fit: string;
      executionObserved: false;
    }>;
  };
  apiProtocolPosture: OpenClinXrApiProtocolPosture;
  protocolEvidence: {
    websocketLocalHarnessObserved: boolean;
    bunHonoRuntimeObserved: boolean;
    webTransportObserved: boolean;
    quicObserved: boolean;
    web3SignalingObserved: boolean;
    notes: string[];
  };
  pythonBackendVerifier: {
    status: "passed" | "blocked";
    command: "python3 apps/api-python-backend/scripts/verify_backend.py";
    stdout: string;
    blockers: string[];
  };
  pythonBackendRuntimeSmoke?: {
    status: "passed" | "blocked";
    blockers: string[];
    healthOk: boolean;
    websocketConnected: boolean;
    websocketLatencyMs: number | null;
  };
  harness: Awaited<ReturnType<typeof runRealtimeVoiceProxyHarness>>;
  verdict: {
    transportContractPassed: boolean;
    readyForLiveDialog: false;
    blockers: string[];
    caveats: string[];
  };
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const apiPythonBackendRuntimeSmoke = options.apiPythonBackendRuntimeSmokePath
    ? await readJson<ApiPythonBackendRuntimeSmokeEvidence>(options.apiPythonBackendRuntimeSmokePath)
    : undefined;
  const report = await buildRealtimeVoiceTransportSpikeReport({ apiPythonBackendRuntimeSmoke });

  if (options.outputPath) {
    await writeJson(options.outputPath, report);
    console.log(`Wrote ${options.outputPath}`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {};

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--api-python-backend-runtime-smoke") {
      options.apiPythonBackendRuntimeSmokePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export async function buildRealtimeVoiceTransportSpikeReport(input: {
  generatedAt?: string;
  targetLatencyMs?: number;
  bunAvailable?: boolean;
  apiPythonBackendRuntimeSmoke?: ApiPythonBackendRuntimeSmokeEvidence;
} = {}): Promise<RealtimeVoiceTransportSpikeReport> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const targetLatencyMs = input.targetLatencyMs ?? 250;
  const bunAvailable = input.bunAvailable ?? await commandAvailable("bun");
  const [pythonBackendVerifier, harness] = await Promise.all([
    verifyPythonBackendSource(),
    runHarness(targetLatencyMs),
  ]);
  const pythonBackendRuntimeSmoke = input.apiPythonBackendRuntimeSmoke
    ? summarizePythonBackendRuntimeSmoke(input.apiPythonBackendRuntimeSmoke)
    : undefined;
  const transportContractPassed = pythonBackendVerifier.status === "passed" && harness.latencyBudget.passed;
  const blockers = [
    "quest_godot_client_not_executed",
    "native_opus_codec_not_integrated_in_godot",
    bunAvailable ? undefined : "bun_runtime_not_installed_on_this_machine",
    pythonBackendRuntimeSmoke?.status === "passed" ? undefined : "fastapi_backend_not_runtime_executed",
    "real_moshi_or_qwen3_inference_not_observed",
    "quest_microphone_and_playback_latency_not_measured",
    "clinical_voice_safety_controls_not_exercised_with_real_model",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    generatedAt,
    status: transportContractPassed ? "transport_spike_passed" : "blocked",
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      modelDownloadsPerformed: false,
      productionUseAllowed: false,
    },
    architecture: {
      questClient: {
        target: "quest3-godot",
        transport: "websocket-binary-frames",
        codecContract: "opus-frame-contract",
        note: "Godot client work remains source-planned; this harness sends opaque Opus-like binary chunks and does not prove Quest audio capture or playback.",
      },
      gateway: {
        target: "apps/api bun+hono",
        verifiedLocalFallback: "apps/mock-realtime-voice-server node+hono+ws",
        websocketPath: "/voice/realtime/ws",
      },
      pythonBackend: {
        appPath: "apps/api-python-backend",
        target: "fastapi-uvicorn-websocket",
        websocketPath: "/voice/realtime/ws",
      },
      inferenceCandidates: [
        {
          id: "moshi-mlx",
          fit: "best architectural fit for future full-duplex speech dialogue on Apple Silicon, benchmark-gated",
          executionObserved: false,
        },
        {
          id: "qwen3-tts",
          fit: "strong future streaming TTS candidate, but not standalone full-duplex dialogue",
          executionObserved: false,
        },
      ],
    },
    apiProtocolPosture: createOpenClinXrApiProtocolPosture(),
    protocolEvidence: {
      websocketLocalHarnessObserved: true,
      bunHonoRuntimeObserved: bunAvailable,
      webTransportObserved: false,
      quicObserved: false,
      web3SignalingObserved: false,
      notes: [
        "Only the local WebSocket transport harness has execution evidence in this report.",
        "WebTransport, direct QUIC, and Web3 signaling remain proposal- and evidence-gated.",
      ],
    },
    pythonBackendVerifier,
    ...(pythonBackendRuntimeSmoke ? { pythonBackendRuntimeSmoke } : {}),
    harness,
    verdict: {
      transportContractPassed,
      readyForLiveDialog: false,
      blockers,
      caveats: [
        "The measured harness uses a Python-compatible local fixture behind a Node/Hono/WebSocket fallback; it validates streaming shape and latency plumbing only.",
        pythonBackendRuntimeSmoke?.status === "passed"
          ? "FastAPI runtime smoke passed for health and WebSocket frame handling, but MLX/Moshi/Qwen inference is still not installed or executed by this spike."
          : "The committed FastAPI backend is source-verified with stdlib checks, but FastAPI/Uvicorn/MLX/Moshi/Qwen dependencies are not installed or executed by this spike.",
      ],
    },
  };
}

function summarizePythonBackendRuntimeSmoke(
  report: ApiPythonBackendRuntimeSmokeEvidence,
): RealtimeVoiceTransportSpikeReport["pythonBackendRuntimeSmoke"] {
  const blockers = [
    ...report.verdict.blockers,
    report.health.ok ? undefined : "runtime_smoke_health_not_ok",
    report.websocket.connected ? undefined : "runtime_smoke_websocket_not_connected",
    report.websocket.controlAckObserved ? undefined : "runtime_smoke_control_ack_missing",
    report.websocket.audioMetadataObserved ? undefined : "runtime_smoke_audio_metadata_missing",
    report.websocket.transcriptDeltaObserved ? undefined : "runtime_smoke_transcript_delta_missing",
    report.websocket.binaryEchoObserved ? undefined : "runtime_smoke_binary_echo_missing",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    status: report.verdict.passed && blockers.length === 0 ? "passed" : "blocked",
    blockers,
    healthOk: report.health.ok,
    websocketConnected: report.websocket.connected,
    websocketLatencyMs: report.websocket.latencyMs,
  };
}

async function runHarness(targetLatencyMs: number): Promise<Awaited<ReturnType<typeof runRealtimeVoiceProxyHarness>>> {
  const backend = await startPythonCompatibleVoiceBackendFixture({ port: 0, artificialDelayMs: 1 });
  const gateway = await startRealtimeVoiceGatewayServer({ port: 0, backendUrl: backend.wsUrl });
  try {
    return await runRealtimeVoiceProxyHarness({
      gatewayUrl: gateway.wsUrl,
      targetLatencyMs,
      audioChunks: [
        Buffer.from([0x4f, 0x70, 0x75, 0x73, 0x10, 0x01]),
        Buffer.from([0x4f, 0x70, 0x75, 0x73, 0x10, 0x02]),
      ],
    });
  } finally {
    await gateway.stop();
    await backend.stop();
  }
}

async function verifyPythonBackendSource(): Promise<RealtimeVoiceTransportSpikeReport["pythonBackendVerifier"]> {
  const command = "python3 apps/api-python-backend/scripts/verify_backend.py";
  try {
    const { stdout } = await execFileAsync("python3", ["apps/api-python-backend/scripts/verify_backend.py"]);
    return {
      status: "passed",
      command,
      stdout: stdout.trim(),
      blockers: [],
    };
  } catch (error) {
    return {
      status: "blocked",
      command,
      stdout: "",
      blockers: [error instanceof Error ? error.message : "python_backend_verifier_failed"],
    };
  }
}

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("/usr/bin/which", [command]);
    return true;
  } catch {
    return false;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
