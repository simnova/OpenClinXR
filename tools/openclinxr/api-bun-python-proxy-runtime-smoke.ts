import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { realtimeVoiceProtocol } from "../../packages/openclinxr/voice-gateway/src/index.js";
import { writeJson } from "../agent-factory/lib.js";

const execFileAsync = promisify(execFile);

export type ApiBunPythonProxyRuntimeSmokeObservation = {
  generatedAt?: string;
  python: {
    executable: string;
    version: string | null;
  };
  bun: {
    executable: string | null;
    version: string | null;
    revision: string | null;
  };
  pythonBackend: {
    attempted: boolean;
    port: number;
    healthOk: boolean;
    stdout: string[];
    stderr: string[];
  };
  bunGateway: {
    attempted: boolean;
    port: number;
    healthOk: boolean;
    backendUrlConfigured: boolean;
    stdout: string[];
    stderr: string[];
  };
  bunGatewayPosture: {
    attempted: boolean;
    fetched: boolean;
    httpStatus: number | null;
    pythonFastApiStatus: string | null;
    pythonBackendTransportProxyStatus: string | null;
    pythonBackendTransportProxyConfigured: boolean;
    readyForLiveDialog: boolean | null;
    transportProxyBlockers: string[];
    pythonBackendBlockers: string[];
  };
  websocket: {
    attempted: boolean;
    connected: boolean;
    eventTypesObserved: string[];
    binaryMessages: number;
    backendProtocolObserved: boolean;
    latencyFieldsObserved: boolean;
    binaryEchoObserved: boolean;
    errorMessages?: string[];
  };
};

export type ApiBunPythonProxyRuntimeSmokeReport = {
  generatedAt: string;
  status: "passed" | "blocked";
  policy: {
    cloudApisUsed: false;
    paidApisUsed: false;
    modelDownloadsUsed: false;
    http3Enabled: false;
    webTransportUsed: false;
    quicUsed: false;
    web3Used: false;
    questHardwareClaimed: false;
    productionUseAllowed: false;
    lowLatencyClaimed: false;
  };
  python: ApiBunPythonProxyRuntimeSmokeObservation["python"];
  bun: ApiBunPythonProxyRuntimeSmokeObservation["bun"];
  runtime: {
    apiTarget: "apps/api bun+hono";
    pythonBackendTarget: "apps/api-python-backend fastapi";
    websocketPath: "/voice/realtime/ws";
    backendProtocol: "python-fastapi-compatible-websocket";
  };
  pythonBackend: ApiBunPythonProxyRuntimeSmokeObservation["pythonBackend"];
  bunGateway: ApiBunPythonProxyRuntimeSmokeObservation["bunGateway"];
  bunGatewayPosture: ApiBunPythonProxyRuntimeSmokeObservation["bunGatewayPosture"];
  websocket: Required<ApiBunPythonProxyRuntimeSmokeObservation["websocket"]>;
  runtimeEvidenceBlockers: string[];
  postureEvidencePromotion: {
    eligible: boolean;
    promotedTransportProxyStatus: "configured_reachability_verified" | null;
    environment: {
      backendUrlVariable: "OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL";
      evidenceFileVariable: "OPENCLINXR_PYTHON_VOICE_PROXY_EVIDENCE_FILE";
    };
    instructions: string[];
    blockers: string[];
    caveats: string[];
  };
  verdict: {
    smokePassed: boolean;
    readyForLiveDialog: false;
    blockers: string[];
    caveats: string[];
  };
};

type CliOptions = {
  outputPath?: string;
  pythonExecutable: string;
  bunExecutable?: string;
  pythonPort: number;
  apiPort: number;
  timeoutMs: number;
};

type WebSocketLike = {
  binaryType: string;
  close: () => void;
  send: (data: string | Uint8Array) => void;
  addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => void;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await runApiBunPythonProxyRuntimeSmoke(options);

  if (options.outputPath) {
    await writeJson(options.outputPath, report);
    console.log(`Wrote ${options.outputPath}`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
    pythonExecutable: "/Users/patrick/.cache/openclinxr/realtime-voice/api-python-backend-venv/bin/python",
    pythonPort: 8766,
    apiPort: 4326,
    timeoutMs: 8_000,
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--python") {
      options.pythonExecutable = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--bun") {
      options.bunExecutable = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--python-port") {
      options.pythonPort = numberValue(requireValue(normalizedArgs, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--api-port") {
      options.apiPort = numberValue(requireValue(normalizedArgs, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = numberValue(requireValue(normalizedArgs, index, arg), arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

export async function runApiBunPythonProxyRuntimeSmoke(
  options: CliOptions,
): Promise<ApiBunPythonProxyRuntimeSmokeReport> {
  const bunExecutable = await resolveBunExecutable(options.bunExecutable);
  const pythonVersion = await readCommandFirstLine(options.pythonExecutable, ["--version"]);
  const bun = bunExecutable
    ? {
        executable: bunExecutable,
        version: await readCommandFirstLine(bunExecutable, ["--version"]),
        revision: await readCommandFirstLine(bunExecutable, ["--revision"]),
      }
    : { executable: null, version: null, revision: null };

  if (!bunExecutable) {
    return buildApiBunPythonProxyRuntimeSmokeReport({
      python: { executable: options.pythonExecutable, version: pythonVersion },
      bun,
      pythonBackend: emptyServerObservation(false, options.pythonPort),
      bunGateway: {
        ...emptyServerObservation(false, options.apiPort),
        backendUrlConfigured: false,
      },
      bunGatewayPosture: emptyBunGatewayPosture(false),
      websocket: emptyWebSocket(false),
    });
  }

  const pythonServer = spawn(options.pythonExecutable, [
    "-m",
    "uvicorn",
    "api_python_backend.main:app",
    "--app-dir",
    "apps/api-python-backend/src",
    "--host",
    "127.0.0.1",
    "--port",
    String(options.pythonPort),
  ], {
    cwd: process.cwd(),
    env: process.env,
  });
  const pythonStdout: string[] = [];
  const pythonStderr: string[] = [];
  pythonServer.stdout.on("data", (chunk) => pushLines(pythonStdout, chunk));
  pythonServer.stderr.on("data", (chunk) => pushLines(pythonStderr, chunk));

  let bunServer: ChildProcessWithoutNullStreams | undefined;
  const bunStdout: string[] = [];
  const bunStderr: string[] = [];

  try {
    const pythonHealthOk = await waitForHealth(options.pythonPort, options.timeoutMs, "api-python-backend");
    if (pythonHealthOk) {
      bunServer = spawn(bunExecutable, ["src/bun-server.ts"], {
        cwd: path.join(process.cwd(), "apps/api"),
        env: {
          ...process.env,
          PORT: String(options.apiPort),
          OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL: `ws://127.0.0.1:${options.pythonPort}/voice/realtime/ws`,
          PATH: prependPath(process.env.PATH ?? "", path.dirname(bunExecutable)),
        },
      });
      bunServer.stdout.on("data", (chunk) => pushLines(bunStdout, chunk));
      bunServer.stderr.on("data", (chunk) => pushLines(bunStderr, chunk));
    }

    const bunHealthOk = bunServer
      ? await waitForHealth(options.apiPort, options.timeoutMs, "openclinxr-api")
      : false;
    const bunGatewayPosture = bunHealthOk
      ? await fetchBunGatewayPosture(options.apiPort, options.timeoutMs)
      : emptyBunGatewayPosture(Boolean(bunServer));
    const websocket = bunHealthOk
      ? await runProxyWebSocketProbe(options.apiPort, options.timeoutMs)
      : emptyWebSocket(false);

    return buildApiBunPythonProxyRuntimeSmokeReport({
      python: { executable: options.pythonExecutable, version: pythonVersion },
      bun,
      pythonBackend: {
        attempted: true,
        port: options.pythonPort,
        healthOk: pythonHealthOk,
        stdout: pythonStdout,
        stderr: pythonStderr,
      },
      bunGateway: {
        attempted: Boolean(bunServer),
        port: options.apiPort,
        healthOk: bunHealthOk,
        backendUrlConfigured: Boolean(bunServer),
        stdout: bunStdout,
        stderr: bunStderr,
      },
      bunGatewayPosture,
      websocket,
    });
  } finally {
    await Promise.all([
      bunServer ? stopServer(bunServer) : Promise.resolve(),
      stopServer(pythonServer),
    ]);
  }
}

export function buildApiBunPythonProxyRuntimeSmokeReport(
  input: ApiBunPythonProxyRuntimeSmokeObservation,
): ApiBunPythonProxyRuntimeSmokeReport {
  const websocketErrors = input.websocket.errorMessages ?? [];
  const runtimeEvidenceBlockers = [
    input.bun.executable && input.bun.version ? undefined : "bun_runtime_not_available",
    input.python.version ? undefined : "python_runtime_not_available",
    input.pythonBackend.attempted ? undefined : "python_backend_not_started",
    input.pythonBackend.healthOk ? undefined : "python_backend_health_failed",
    input.bunGateway.attempted ? undefined : "bun_gateway_not_started",
    input.bunGateway.healthOk ? undefined : "bun_gateway_health_failed",
    input.bunGateway.backendUrlConfigured ? undefined : "python_backend_url_not_configured",
    input.bunGatewayPosture.attempted ? undefined : "bun_gateway_posture_not_requested",
    input.bunGatewayPosture.fetched ? undefined : "bun_gateway_posture_fetch_failed",
    input.bunGatewayPosture.pythonFastApiStatus === "source_present_not_executed"
      ? undefined
      : "python_backend_posture_status_unexpected",
    input.bunGatewayPosture.pythonBackendTransportProxyConfigured
      ? undefined
      : "python_backend_transport_proxy_not_configured_in_posture",
    input.bunGatewayPosture.pythonBackendTransportProxyStatus === "configured_not_verified"
      ? undefined
      : "python_backend_transport_proxy_status_unexpected",
    input.bunGatewayPosture.readyForLiveDialog === false ? undefined : "bun_gateway_posture_overclaims_live_dialog_ready",
    input.websocket.attempted && input.websocket.connected ? undefined : "websocket_not_connected",
    input.websocket.eventTypesObserved.includes("gateway.ready") ? undefined : "gateway_ready_not_observed",
    input.websocket.backendProtocolObserved ? undefined : "backend_protocol_not_observed",
    input.websocket.eventTypesObserved.includes("voice.started") ? undefined : "voice_started_not_observed",
    input.websocket.eventTypesObserved.includes("audio.chunk") ? undefined : "audio_chunk_not_observed",
    input.websocket.eventTypesObserved.includes("transcript.partial") ? undefined : "transcript_partial_not_observed",
    input.websocket.eventTypesObserved.includes("transcript.final") ? undefined : "transcript_final_not_observed",
    input.websocket.eventTypesObserved.includes("voice.stopped") ? undefined : "voice_stopped_not_observed",
    input.websocket.latencyFieldsObserved ? undefined : "latency_fields_not_observed",
    input.websocket.binaryEchoObserved ? undefined : "binary_echo_not_observed",
    websocketErrors.length === 0 ? undefined : "websocket_errors_observed",
  ].filter((blocker): blocker is string => typeof blocker === "string");
  const smokePassed = runtimeEvidenceBlockers.length === 0;
  const postureEvidencePromotion = buildPostureEvidencePromotion(runtimeEvidenceBlockers, smokePassed);

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: smokePassed ? "passed" : "blocked",
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      modelDownloadsUsed: false,
      http3Enabled: false,
      webTransportUsed: false,
      quicUsed: false,
      web3Used: false,
      questHardwareClaimed: false,
      productionUseAllowed: false,
      lowLatencyClaimed: false,
    },
    python: input.python,
    bun: input.bun,
    runtime: {
      apiTarget: "apps/api bun+hono",
      pythonBackendTarget: "apps/api-python-backend fastapi",
      websocketPath: realtimeVoiceProtocol.websocketPath,
      backendProtocol: realtimeVoiceProtocol.backendProtocol,
    },
    pythonBackend: {
      ...input.pythonBackend,
      stdout: input.pythonBackend.stdout.slice(-20),
      stderr: input.pythonBackend.stderr.slice(-20),
    },
    bunGateway: {
      ...input.bunGateway,
      stdout: input.bunGateway.stdout.slice(-20),
      stderr: input.bunGateway.stderr.slice(-20),
    },
    bunGatewayPosture: input.bunGatewayPosture,
    websocket: {
      ...input.websocket,
      errorMessages: websocketErrors,
    },
    runtimeEvidenceBlockers,
    postureEvidencePromotion,
    verdict: {
      smokePassed,
      readyForLiveDialog: false,
      blockers: [
        "real_model_inference_not_observed",
        "quest_browser_audio_capture_not_observed",
        "quest_playback_not_observed",
        "opus_codec_not_verified",
        "clinical_voice_safety_not_exercised",
        "production_ingress_not_verified",
        "low_latency_claim_not_supported_by_local_smoke",
      ],
      caveats: [
        "This smoke proves only the local Bun-to-FastAPI WebSocket proxy path.",
        "The binary frame is opaque Opus-like data; no codec, speech recognition, model inference, or speech synthesis is exercised.",
        "HTTP/3, WebTransport, QUIC, Web3, cloud relays, paid APIs, and Quest media are out of scope.",
      ],
    },
  };
}

function buildPostureEvidencePromotion(
  runtimeEvidenceBlockers: string[],
  smokePassed: boolean,
): ApiBunPythonProxyRuntimeSmokeReport["postureEvidencePromotion"] {
  const eligible = smokePassed;

  return {
    eligible,
    promotedTransportProxyStatus: eligible ? "configured_reachability_verified" : null,
    environment: {
      backendUrlVariable: "OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL",
      evidenceFileVariable: "OPENCLINXR_PYTHON_VOICE_PROXY_EVIDENCE_FILE",
    },
    instructions: eligible
      ? [
          "Keep OPENCLINXR_PYTHON_VOICE_BACKEND_WS_URL pointed at the same reviewed local FastAPI voice backend WebSocket route.",
          "Set OPENCLINXR_PYTHON_VOICE_PROXY_EVIDENCE_FILE to this passed smoke report JSON file before starting a later Bun/Hono API process.",
          "Expect the later posture endpoint to promote only proxy reachability to configured_reachability_verified; live dialog readiness must remain false until model inference, Quest audio capture/playback, Opus, and clinical safety are verified.",
        ]
      : [
          "Do not use this blocked report as OPENCLINXR_PYTHON_VOICE_PROXY_EVIDENCE_FILE.",
          "Fix the runtime evidence blockers and rerun the local smoke before promoting proxy reachability posture.",
        ],
    blockers: eligible ? [] : runtimeEvidenceBlockers,
    caveats: [
      "The live smoke fetches the posture endpoint before this report is written, so the current process can truthfully remain configured_not_verified.",
      "This promotion path is local developer evidence only and does not claim model inference, Quest media, production ingress, or low latency.",
    ],
  };
}

async function runProxyWebSocketProbe(
  port: number,
  timeoutMs: number,
): Promise<ApiBunPythonProxyRuntimeSmokeObservation["websocket"]> {
  const WebSocketCtor = globalThis.WebSocket as unknown as { new(url: string): WebSocketLike } | undefined;
  if (!WebSocketCtor) {
    return emptyWebSocket(true, ["global_websocket_unavailable"]);
  }

  const socket = new WebSocketCtor(`ws://127.0.0.1:${port}/voice/realtime/ws`);
  socket.binaryType = "arraybuffer";
  const eventTypesObserved: string[] = [];
  const errorMessages: string[] = [];
  let connected = false;
  let binaryMessages = 0;
  let backendProtocolObserved = false;
  let latencyFieldsObserved = false;
  let binaryEchoObserved = false;

  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timeout);
      socket.close();
      resolve({
        attempted: true,
        connected,
        eventTypesObserved,
        binaryMessages,
        backendProtocolObserved,
        latencyFieldsObserved,
        binaryEchoObserved,
        errorMessages,
      });
    };
    const timeout = setTimeout(() => {
      errorMessages.push("proxy_websocket_timeout");
      finish();
    }, timeoutMs);

    socket.addEventListener("open", () => {
      connected = true;
      socket.send(JSON.stringify({
        type: realtimeVoiceProtocol.clientControlFrames.start,
        codec: realtimeVoiceProtocol.codec,
        sampleRateHz: realtimeVoiceProtocol.sampleRateHz,
      }));
      socket.send(JSON.stringify({
        type: realtimeVoiceProtocol.clientControlFrames.audioMetadata,
        chunkIndex: 0,
        byteLength: 4,
        codec: realtimeVoiceProtocol.codec,
        clientSentAtMs: performance.now(),
      }));
      socket.send(new Uint8Array([0x4f, 0x70, 0x75, 0x73]));
      socket.send(JSON.stringify({ type: realtimeVoiceProtocol.clientControlFrames.stop }));
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        const payload = safeJsonParse(event.data);
        const eventType = typeof payload === "object" && payload !== null ? (payload as { type?: unknown }).type : undefined;
        if (typeof eventType === "string") {
          eventTypesObserved.push(eventType);
        }
        backendProtocolObserved ||= eventType === realtimeVoiceProtocol.serverEvents.backendReady
          && typeof payload === "object"
          && payload !== null
          && (payload as { backendProtocol?: unknown }).backendProtocol === realtimeVoiceProtocol.backendProtocol;
        latencyFieldsObserved ||= eventType === realtimeVoiceProtocol.serverEvents.audioChunk
          && typeof payload === "object"
          && payload !== null
          && typeof (payload as { clientSentAtMs?: unknown }).clientSentAtMs === "number"
          && typeof (payload as { backendObservedAtMs?: unknown }).backendObservedAtMs === "number";
      } else {
        binaryMessages += 1;
        binaryEchoObserved = true;
      }

      if (
        backendProtocolObserved
        && latencyFieldsObserved
        && binaryEchoObserved
        && eventTypesObserved.includes(realtimeVoiceProtocol.serverEvents.voiceStopped)
      ) {
        finish();
      }
    });

    socket.addEventListener("error", () => {
      errorMessages.push("proxy_websocket_error");
      finish();
    });
  });
}

async function fetchBunGatewayPosture(
  port: number,
  timeoutMs: number,
): Promise<ApiBunPythonProxyRuntimeSmokeObservation["bunGatewayPosture"]> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/voice/realtime/posture`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json();
    const pythonFastApi = isRecord(body)
      && isRecord(body.backends)
      && isRecord(body.backends.pythonFastApi)
      ? body.backends.pythonFastApi
      : {};
    const transportProxy = isRecord(pythonFastApi.transportProxy) ? pythonFastApi.transportProxy : {};

    return {
      attempted: true,
      fetched: response.ok,
      httpStatus: response.status,
      pythonFastApiStatus: stringOrNull(pythonFastApi.status),
      pythonBackendTransportProxyStatus: stringOrNull(transportProxy.status),
      pythonBackendTransportProxyConfigured: transportProxy.backendUrlConfigured === true,
      readyForLiveDialog: typeof transportProxy.readyForLiveDialog === "boolean"
        ? transportProxy.readyForLiveDialog
        : null,
      transportProxyBlockers: stringArray(transportProxy.blockers),
      pythonBackendBlockers: stringArray(pythonFastApi.blockers),
    };
  } catch {
    return emptyBunGatewayPosture(true);
  }
}

async function waitForHealth(
  port: number,
  timeoutMs: number,
  expectedService: string,
): Promise<boolean> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      const body = await response.json();
      if (response.ok && typeof body === "object" && body !== null && (body as { service?: unknown }).service === expectedService) {
        return true;
      }
    } catch {
      await sleep(100);
    }
  }
  return false;
}

function emptyServerObservation(attempted: boolean, port: number): ApiBunPythonProxyRuntimeSmokeObservation["pythonBackend"] {
  return {
    attempted,
    port,
    healthOk: false,
    stdout: [],
    stderr: [],
  };
}

function emptyBunGatewayPosture(
  attempted: boolean,
): ApiBunPythonProxyRuntimeSmokeObservation["bunGatewayPosture"] {
  return {
    attempted,
    fetched: false,
    httpStatus: null,
    pythonFastApiStatus: null,
    pythonBackendTransportProxyStatus: null,
    pythonBackendTransportProxyConfigured: false,
    readyForLiveDialog: null,
    transportProxyBlockers: [],
    pythonBackendBlockers: [],
  };
}

function emptyWebSocket(
  attempted: boolean,
  errorMessages: string[] = [],
): ApiBunPythonProxyRuntimeSmokeObservation["websocket"] {
  return {
    attempted,
    connected: false,
    eventTypesObserved: [],
    binaryMessages: 0,
    backendProtocolObserved: false,
    latencyFieldsObserved: false,
    binaryEchoObserved: false,
    errorMessages,
  };
}

async function resolveBunExecutable(explicitExecutable: string | undefined): Promise<string | null> {
  const candidates = [
    explicitExecutable,
    process.execPath.toLowerCase().includes("bun") ? process.execPath : undefined,
    process.env.BUN_INSTALL ? path.join(process.env.BUN_INSTALL, "bin", "bun") : undefined,
    path.join(homedir(), ".bun/bin/bun"),
    await which("bun"),
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function which(command: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/which", [command], {
      encoding: "utf8",
      timeout: 3_000,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function readCommandFirstLine(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      encoding: "utf8",
      timeout: 5_000,
    });
    return `${stdout}${stderr}`.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? null;
  } catch {
    return null;
  }
}

async function stopServer(server: ChildProcessWithoutNullStreams): Promise<void> {
  if (server.exitCode !== null || server.killed) {
    return;
  }
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (server.exitCode === null && !server.killed) {
        server.kill("SIGKILL");
      }
      resolve();
    }, 1_000);
    server.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function pushLines(target: string[], chunk: unknown): void {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length > 0) {
      target.push(line);
    }
  }
}

function safeJsonParse(payload: string): unknown {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function numberValue(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} requires a numeric value`);
  }
  return parsed;
}

function prependPath(currentPath: string, entry: string): string {
  return currentPath ? `${entry}:${currentPath}` : entry;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
