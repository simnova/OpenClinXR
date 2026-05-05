import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  runRealtimeVoiceProxyHarness,
  startPythonCompatibleVoiceBackendFixture,
  startRealtimeVoiceGatewayServer,
} from "../../apps/mock-realtime-voice-server/src/index.js";
import { createOpenClinXrApiProtocolPosture, type OpenClinXrApiProtocolPosture } from "../../apps/api/src/index.js";
import { realtimeVoiceProtocol } from "../../packages/openclinxr/voice-gateway/src/index.js";
import { readJson, writeJson } from "../agent-factory/lib.js";

const execFileAsync = promisify(execFile);

type CliOptions = {
  outputPath?: string;
  apiPythonBackendRuntimeSmokePath?: string;
  apiBunWebSocketRuntimeSmokePath?: string;
  apiBunPythonProxyRuntimeSmokePath?: string;
};

type ApiBunWebSocketRuntimeSmokeEvidence = {
  status: string;
  runtimeEvidenceBlockers: string[];
  websocket: {
    connected: boolean;
    controlAckObserved: boolean;
    audioMetadataObserved: boolean;
    transcriptDeltaObserved: boolean;
    binaryEchoObserved: boolean;
  };
  verdict: {
    smokePassed: boolean;
  };
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
    protocol?: {
      backendProtocolObserved?: boolean;
      latencyFieldsObserved?: boolean;
      canonicalProtocolObserved?: boolean;
    };
  };
  verdict: {
    passed: boolean;
    blockers: string[];
  };
};

type ApiBunPythonProxyRuntimeSmokeEvidence = {
  status: string;
  runtimeEvidenceBlockers: string[];
  pythonBackend: {
    healthOk: boolean;
  };
  bunGateway: {
    healthOk: boolean;
    backendUrlConfigured: boolean;
  };
  websocket: {
    connected: boolean;
    eventTypesObserved: string[];
    backendProtocolObserved: boolean;
    latencyFieldsObserved: boolean;
    binaryEchoObserved: boolean;
  };
  verdict: {
    smokePassed: boolean;
    blockers: string[];
  };
};

type QuestClientSourceContractEvidence = {
  status: "source_contract_observed" | "blocked";
  appPath: "apps/ui-quest-voice-godot";
  sourceContractObserved: boolean;
  godotRuntimeAvailable: boolean;
  dependencyFreeSidecar: boolean;
  websocketPeerObserved: boolean;
  audioMetadataObserved: boolean;
  opaqueBinaryPacketProbeObserved: boolean;
  productionAudioClaims: boolean;
  blockers: string[];
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
    protocolObserved: {
      backendProtocolObserved: boolean;
      latencyFieldsObserved: boolean;
      canonicalProtocolObserved: boolean;
    };
  };
  apiBunWebSocketRuntimeSmoke?: {
    status: "passed" | "blocked";
    blockers: string[];
    websocketConnected: boolean;
    controlAckObserved: boolean;
    audioMetadataObserved: boolean;
    transcriptDeltaObserved: boolean;
    binaryEchoObserved: boolean;
  };
  apiBunPythonProxyRuntimeSmoke?: {
    status: "passed" | "blocked";
    blockers: string[];
    pythonBackendHealthOk: boolean;
    bunGatewayHealthOk: boolean;
    backendUrlConfigured: boolean;
    websocketConnected: boolean;
    backendReadyObserved: boolean;
    backendProtocolObserved: boolean;
    latencyFieldsObserved: boolean;
    binaryEchoObserved: boolean;
    eventTypesObserved: string[];
  };
  questClientSourceContract: QuestClientSourceContractEvidence;
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
  const apiBunWebSocketRuntimeSmoke = options.apiBunWebSocketRuntimeSmokePath
    ? await readJson<ApiBunWebSocketRuntimeSmokeEvidence>(options.apiBunWebSocketRuntimeSmokePath)
    : undefined;
  const apiBunPythonProxyRuntimeSmoke = options.apiBunPythonProxyRuntimeSmokePath
    ? await readJson<ApiBunPythonProxyRuntimeSmokeEvidence>(options.apiBunPythonProxyRuntimeSmokePath)
    : undefined;
  const report = await buildRealtimeVoiceTransportSpikeReport({
    apiPythonBackendRuntimeSmoke,
    apiBunWebSocketRuntimeSmoke,
    apiBunPythonProxyRuntimeSmoke,
  });

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
    if (arg === "--api-bun-websocket-runtime-smoke") {
      options.apiBunWebSocketRuntimeSmokePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--api-bun-python-proxy-runtime-smoke") {
      options.apiBunPythonProxyRuntimeSmokePath = requireValue(normalizedArgs, index, arg);
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
  godotAvailable?: boolean;
  apiPythonBackendRuntimeSmoke?: ApiPythonBackendRuntimeSmokeEvidence;
  apiBunWebSocketRuntimeSmoke?: ApiBunWebSocketRuntimeSmokeEvidence;
  apiBunPythonProxyRuntimeSmoke?: ApiBunPythonProxyRuntimeSmokeEvidence;
} = {}): Promise<RealtimeVoiceTransportSpikeReport> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const targetLatencyMs = input.targetLatencyMs ?? 250;
  const [bunAvailable, godotAvailable, pythonBackendVerifier, harness] = await Promise.all([
    input.bunAvailable === undefined ? commandAvailable("bun") : Promise.resolve(input.bunAvailable),
    input.godotAvailable === undefined ? anyCommandAvailable(["godot", "godot4", "Godot"]) : Promise.resolve(input.godotAvailable),
    verifyPythonBackendSource(),
    runHarness(targetLatencyMs),
  ]);
  const questClientSourceContract = buildQuestClientSourceContract({ godotRuntimeAvailable: godotAvailable });
  const pythonBackendRuntimeSmoke = input.apiPythonBackendRuntimeSmoke
    ? summarizePythonBackendRuntimeSmoke(input.apiPythonBackendRuntimeSmoke)
    : undefined;
  const apiBunWebSocketRuntimeSmoke = input.apiBunWebSocketRuntimeSmoke
    ? summarizeApiBunWebSocketRuntimeSmoke(input.apiBunWebSocketRuntimeSmoke)
    : undefined;
  const apiBunPythonProxyRuntimeSmoke = input.apiBunPythonProxyRuntimeSmoke
    ? summarizeApiBunPythonProxyRuntimeSmoke(input.apiBunPythonProxyRuntimeSmoke)
    : undefined;
  const suppliedRuntimeSmokePassed = pythonBackendRuntimeSmoke ? pythonBackendRuntimeSmoke.status === "passed" : true;
  const suppliedBunRuntimeSmokePassed = apiBunWebSocketRuntimeSmoke ? apiBunWebSocketRuntimeSmoke.status === "passed" : false;
  const suppliedBunPythonProxySmokePassed = apiBunPythonProxyRuntimeSmoke ? apiBunPythonProxyRuntimeSmoke.status === "passed" : false;
  const bunRuntimeObserved = bunAvailable || suppliedBunRuntimeSmokePassed || suppliedBunPythonProxySmokePassed;
  const backendRuntimeObserved = pythonBackendRuntimeSmoke?.status === "passed" || suppliedBunPythonProxySmokePassed;
  const suppliedBunPythonProxySmokeHealthy = apiBunPythonProxyRuntimeSmoke ? suppliedBunPythonProxySmokePassed : true;
  const transportContractPassed = pythonBackendVerifier.status === "passed"
    && harness.latencyBudget.passed
    && suppliedRuntimeSmokePassed
    && suppliedBunPythonProxySmokeHealthy;
  const blockers = [
    "quest_godot_client_not_executed",
    "native_opus_codec_not_integrated_in_godot",
    bunRuntimeObserved ? undefined : "bun_runtime_not_installed_on_this_machine",
    suppliedBunPythonProxySmokePassed ? undefined : "bun_to_fastapi_proxy_runtime_not_verified",
    backendRuntimeObserved ? undefined : "fastapi_backend_not_runtime_executed",
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
    apiProtocolPosture: createOpenClinXrApiProtocolPosture({
      apiBunWebSocketRuntimeVerified: bunRuntimeObserved,
    }),
    protocolEvidence: {
      websocketLocalHarnessObserved: true,
      bunHonoRuntimeObserved: bunRuntimeObserved,
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
    ...(apiBunWebSocketRuntimeSmoke ? { apiBunWebSocketRuntimeSmoke } : {}),
    ...(apiBunPythonProxyRuntimeSmoke ? { apiBunPythonProxyRuntimeSmoke } : {}),
    questClientSourceContract,
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
        apiBunPythonProxyRuntimeSmoke?.status === "passed"
          ? "Bun/Hono to FastAPI runtime proxy smoke passed for control frames, opaque binary audio frames, backend-ready events, canonical protocol events, and latency-field plumbing."
          : "Bun/Hono to FastAPI runtime proxy evidence is still required before claiming the target gateway-to-backend transport path.",
      ],
    },
  };
}

function buildQuestClientSourceContract(input: {
  godotRuntimeAvailable: boolean;
}): QuestClientSourceContractEvidence {
  const appPath = "apps/ui-quest-voice-godot" as const;
  const project = readWorkspaceText(join(appPath, "project.godot"));
  const client = readWorkspaceText(join(appPath, "src/RealtimeVoiceClient.gd"));
  const readme = readWorkspaceText(join(appPath, "README.md"));
  const scene = readWorkspaceText(join(appPath, "scenes/realtime_voice_spike.tscn"));
  const main = readWorkspaceText(join(appPath, "src/Main.gd"));
  const allSidecarText = [readme, project, scene, main, client].join("\n");

  const dependencyFreeSidecar = !existsSync(join(process.cwd(), appPath, "package.json"));
  const websocketPeerObserved = client.includes("WebSocketPeer.new()")
    && client.includes("connect_to_url")
    && client.includes(realtimeVoiceProtocol.websocketPath);
  const canonicalFrameConstantsObserved = client.includes(`const FRAME_VOICE_START := "${realtimeVoiceProtocol.clientControlFrames.start}"`)
    && client.includes(`const FRAME_VOICE_STOP := "${realtimeVoiceProtocol.clientControlFrames.stop}"`)
    && client.includes(`const FRAME_AUDIO_METADATA := "${realtimeVoiceProtocol.clientControlFrames.audioMetadata}"`)
    && client.includes(`"${realtimeVoiceProtocol.serverEvents.backendReady}"`)
    && client.includes(`"${realtimeVoiceProtocol.serverEvents.voiceStarted}"`)
    && client.includes(`"${realtimeVoiceProtocol.serverEvents.audioChunk}"`)
    && client.includes(`"${realtimeVoiceProtocol.serverEvents.transcriptPartial}"`)
    && client.includes(`"${realtimeVoiceProtocol.serverEvents.transcriptFinal}"`);
  const audioMetadataObserved = canonicalFrameConstantsObserved
    && client.includes('"type": FRAME_AUDIO_METADATA')
    && client.includes('"chunkIndex": next_chunk_index')
    && client.includes('"clientSentAtMs": Time.get_ticks_msec()');
  const opaqueBinaryPacketProbeObserved = client.includes("socket.put_packet(packet)")
    && client.includes("send_transport_probe");
  const productionAudioClaims = /production[- ]ready|live dialog ready|latency proven/i.test(allSidecarText);
  const sourceContractObserved = project.includes("config_version=5")
    && project.includes('run/main_scene="res://scenes/realtime_voice_spike.tscn"')
    && dependencyFreeSidecar
    && websocketPeerObserved
    && canonicalFrameConstantsObserved
    && audioMetadataObserved
    && opaqueBinaryPacketProbeObserved
    && !productionAudioClaims;
  const blockers = [
    sourceContractObserved ? undefined : "quest_godot_source_contract_not_observed",
    input.godotRuntimeAvailable ? undefined : "godot_runtime_not_installed_on_this_machine",
    "quest_device_execution_not_observed",
    "native_opus_codec_not_integrated_in_godot",
    "quest_microphone_capture_not_observed",
    "quest_audio_playback_not_observed",
    productionAudioClaims ? "quest_godot_sidecar_contains_production_audio_claims" : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    status: sourceContractObserved ? "source_contract_observed" : "blocked",
    appPath,
    sourceContractObserved,
    godotRuntimeAvailable: input.godotRuntimeAvailable,
    dependencyFreeSidecar,
    websocketPeerObserved,
    audioMetadataObserved,
    opaqueBinaryPacketProbeObserved,
    productionAudioClaims,
    blockers,
  };
}

function readWorkspaceText(relativePath: string): string {
  const absolutePath = join(process.cwd(), relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
}

function summarizePythonBackendRuntimeSmoke(
  report: ApiPythonBackendRuntimeSmokeEvidence,
): RealtimeVoiceTransportSpikeReport["pythonBackendRuntimeSmoke"] {
  const protocolObserved = {
    backendProtocolObserved: report.websocket.protocol?.backendProtocolObserved === true,
    latencyFieldsObserved: report.websocket.protocol?.latencyFieldsObserved === true,
    canonicalProtocolObserved: report.websocket.protocol?.canonicalProtocolObserved === true,
  };
  const blockers = [
    ...report.verdict.blockers,
    report.health.ok ? undefined : "runtime_smoke_health_not_ok",
    report.websocket.connected ? undefined : "runtime_smoke_websocket_not_connected",
    report.websocket.controlAckObserved ? undefined : "runtime_smoke_control_ack_missing",
    report.websocket.audioMetadataObserved ? undefined : "runtime_smoke_audio_metadata_missing",
    report.websocket.transcriptDeltaObserved ? undefined : "runtime_smoke_transcript_delta_missing",
    report.websocket.binaryEchoObserved ? undefined : "runtime_smoke_binary_echo_missing",
    protocolObserved.backendProtocolObserved ? undefined : "runtime_smoke_backend_protocol_missing",
    protocolObserved.latencyFieldsObserved ? undefined : "runtime_smoke_latency_fields_missing",
    protocolObserved.canonicalProtocolObserved ? undefined : "runtime_smoke_canonical_protocol_missing",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    status: report.verdict.passed && blockers.length === 0 ? "passed" : "blocked",
    blockers,
    healthOk: report.health.ok,
    websocketConnected: report.websocket.connected,
    websocketLatencyMs: report.websocket.latencyMs,
    protocolObserved,
  };
}

function summarizeApiBunWebSocketRuntimeSmoke(
  report: ApiBunWebSocketRuntimeSmokeEvidence,
): RealtimeVoiceTransportSpikeReport["apiBunWebSocketRuntimeSmoke"] {
  const blockers = [
    ...report.runtimeEvidenceBlockers,
    report.websocket.connected ? undefined : "runtime_smoke_websocket_not_connected",
    report.websocket.controlAckObserved ? undefined : "runtime_smoke_control_ack_missing",
    report.websocket.audioMetadataObserved ? undefined : "runtime_smoke_audio_metadata_missing",
    report.websocket.transcriptDeltaObserved ? undefined : "runtime_smoke_transcript_delta_missing",
    report.websocket.binaryEchoObserved ? undefined : "runtime_smoke_binary_echo_missing",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    status: report.status === "passed" && report.verdict.smokePassed && blockers.length === 0 ? "passed" : "blocked",
    blockers,
    websocketConnected: report.websocket.connected,
    controlAckObserved: report.websocket.controlAckObserved,
    audioMetadataObserved: report.websocket.audioMetadataObserved,
    transcriptDeltaObserved: report.websocket.transcriptDeltaObserved,
    binaryEchoObserved: report.websocket.binaryEchoObserved,
  };
}

function summarizeApiBunPythonProxyRuntimeSmoke(
  report: ApiBunPythonProxyRuntimeSmokeEvidence,
): RealtimeVoiceTransportSpikeReport["apiBunPythonProxyRuntimeSmoke"] {
  const backendReadyObserved = report.websocket.eventTypesObserved.includes("backend.ready");
  const blockers = [
    ...report.runtimeEvidenceBlockers,
    report.pythonBackend.healthOk ? undefined : "proxy_smoke_python_backend_health_not_ok",
    report.bunGateway.healthOk ? undefined : "proxy_smoke_bun_gateway_health_not_ok",
    report.bunGateway.backendUrlConfigured ? undefined : "proxy_smoke_backend_url_not_configured",
    report.websocket.connected ? undefined : "proxy_smoke_websocket_not_connected",
    backendReadyObserved ? undefined : "proxy_smoke_backend_ready_missing",
    report.websocket.backendProtocolObserved ? undefined : "proxy_smoke_backend_protocol_missing",
    report.websocket.latencyFieldsObserved ? undefined : "proxy_smoke_latency_fields_missing",
    report.websocket.binaryEchoObserved ? undefined : "proxy_smoke_binary_echo_missing",
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    status: report.status === "passed" && report.verdict.smokePassed && blockers.length === 0 ? "passed" : "blocked",
    blockers,
    pythonBackendHealthOk: report.pythonBackend.healthOk,
    bunGatewayHealthOk: report.bunGateway.healthOk,
    backendUrlConfigured: report.bunGateway.backendUrlConfigured,
    websocketConnected: report.websocket.connected,
    backendReadyObserved,
    backendProtocolObserved: report.websocket.backendProtocolObserved,
    latencyFieldsObserved: report.websocket.latencyFieldsObserved,
    binaryEchoObserved: report.websocket.binaryEchoObserved,
    eventTypesObserved: report.websocket.eventTypesObserved,
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

async function anyCommandAvailable(commands: string[]): Promise<boolean> {
  for (const command of commands) {
    if (await commandAvailable(command)) {
      return true;
    }
  }
  return false;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
