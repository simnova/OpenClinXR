import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { writeJson } from "../agent-factory/lib.js";

const execFileAsync = promisify(execFile);

export type ApiBunWebSocketRuntimeSmokeObservation = {
  generatedAt?: string;
  bun: {
    executable: string | null;
    version: string | null;
    revision: string | null;
  };
  server: {
    attempted: boolean;
    command: string[];
    port: number;
    stdout: string[];
    stderr: string[];
  };
  health: {
    attempted: boolean;
    ok: boolean;
    statusCode: number | null;
    latencyMs: number | null;
    body: unknown;
  };
  h3: {
    enabled: false;
    h3TrueEnabled: boolean;
    optionPresentInServerSource: boolean;
    outOfScopeForThisSmoke: true;
  };
  websocket: ApiBunWebSocketRuntimeEvidence;
};

export type ApiBunWebSocketRuntimeEvidence = {
  attempted: boolean;
  connected: boolean;
  reconnectObserved: boolean;
  openLatencyMs: number | null;
  firstReadyLatencyMs: number | null;
  controlAckLatencyMs: number | null;
  firstBinaryEchoLatencyMs: number | null;
  jsonMessages: number;
  binaryMessages: number;
  eventTypesObserved: string[];
  controlFrameTypesSent: string[];
  binaryFramesSent: number;
  binaryBytesSent: number;
  closeCode: number | null;
  reconnectCloseCode: number | null;
  controlAckObserved: boolean;
  audioMetadataObserved: boolean;
  transcriptDeltaObserved: boolean;
  binaryEchoObserved: boolean;
  serverErrors: string[];
  protocolContract: {
    gatewayReadyLocalEchoObserved: boolean;
    gatewayReadyLiveDialogDisabledObserved: boolean;
    canonicalVoiceStartAckObserved: boolean;
    sanitizedControlPayloadObserved: boolean;
    localClientObservationOnly: true;
  };
  protocolBoundary: {
    malformedJsonFramesSent: number;
    malformedJsonControlRejected: boolean;
    unsupportedControlFrameTypesSent: string[];
    unsupportedControlRejected: boolean;
    errorReasonsObserved: string[];
    localClientObservationOnly: true;
  };
  backpressure: {
    burstFrameCount: number;
    burstBytes: number;
    maxBufferedAmount: number | null;
    bufferedAmountSamples: number[];
    droppedOrErroredMessages: number;
    localClientObservationOnly: true;
  };
};

export type ApiBunWebSocketRuntimeSmokeReport = {
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
  bun: ApiBunWebSocketRuntimeSmokeObservation["bun"];
  runtime: {
    target: "apps/api bun+hono";
    appPath: "apps/api";
    websocketPath: "/voice/realtime/ws";
    h3: ApiBunWebSocketRuntimeSmokeObservation["h3"];
  };
  server: ApiBunWebSocketRuntimeSmokeObservation["server"];
  health: ApiBunWebSocketRuntimeSmokeObservation["health"];
  traceContexts: {
    preVrTraceInteraction: {
      observed: boolean;
      source: "synthetic_local_websocket_control_frame";
      controlFrameTypes: string[];
    };
    inVrTraceInteraction: {
      observed: false;
      blocker: "in_vr_trace_not_executed_by_local_bun_smoke";
    };
  };
  websocket: ApiBunWebSocketRuntimeEvidence;
  runtimeEvidenceBlockers: string[];
  verdict: {
    smokePassed: boolean;
    readyForLiveDialog: false;
    blockers: string[];
    caveats: string[];
  };
};

type CliOptions = {
  outputPath?: string;
  port: number;
  timeoutMs: number;
  bunExecutable?: string;
  burstFrames: number;
  burstFrameBytes: number;
};

type WebSocketLike = {
  binaryType: string;
  bufferedAmount?: number;
  close: (code?: number, reason?: string) => void;
  send: (data: string | Uint8Array) => void;
  addEventListener: (type: string, listener: (event: { data?: unknown; code?: number }) => void) => void;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await runApiBunWebSocketRuntimeSmoke(options);

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
    port: 4322,
    timeoutMs: 8_000,
    burstFrames: 8,
    burstFrameBytes: 256,
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--port") {
      options.port = numberValue(requireValue(normalizedArgs, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = numberValue(requireValue(normalizedArgs, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--bun") {
      options.bunExecutable = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--burst-frames") {
      options.burstFrames = numberValue(requireValue(normalizedArgs, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--burst-frame-bytes") {
      options.burstFrameBytes = numberValue(requireValue(normalizedArgs, index, arg), arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

export async function runApiBunWebSocketRuntimeSmoke(
  options: CliOptions,
): Promise<ApiBunWebSocketRuntimeSmokeReport> {
  const bunExecutable = await resolveBunExecutable(options.bunExecutable);
  const bun = bunExecutable
    ? {
        executable: bunExecutable,
        version: await readBunVersion(bunExecutable),
        revision: await readBunRevision(bunExecutable),
      }
    : {
        executable: null,
        version: null,
        revision: null,
      };
  const serverCommand = bunExecutable ? [bunExecutable, "src/bun-server.ts"] : ["bun", "src/bun-server.ts"];
  const h3 = inspectBunServerH3Posture();

  if (!bunExecutable) {
    return buildApiBunWebSocketRuntimeSmokeReport({
      bun,
      server: {
        attempted: false,
        command: serverCommand,
        port: options.port,
        stdout: [],
        stderr: [],
      },
      health: emptyHealth(false),
      h3,
      websocket: emptyWebSocket(false, options.burstFrames, options.burstFrames * options.burstFrameBytes),
    });
  }

  const server = spawn(bunExecutable, ["src/bun-server.ts"], {
    cwd: path.join(process.cwd(), "apps/api"),
    env: {
      ...process.env,
      PORT: String(options.port),
      PATH: prependPath(process.env.PATH ?? "", path.dirname(bunExecutable)),
    },
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  server.stdout.on("data", (chunk) => pushLines(stdout, chunk));
  server.stderr.on("data", (chunk) => pushLines(stderr, chunk));

  try {
    const health = await waitForHealth(options.port, options.timeoutMs);
    const websocket = health.ok
      ? await runWebSocketProbe({
          port: options.port,
          timeoutMs: options.timeoutMs,
          burstFrames: options.burstFrames,
          burstFrameBytes: options.burstFrameBytes,
        })
      : emptyWebSocket(false, options.burstFrames, options.burstFrames * options.burstFrameBytes);

    return buildApiBunWebSocketRuntimeSmokeReport({
      bun,
      server: {
        attempted: true,
        command: serverCommand,
        port: options.port,
        stdout,
        stderr,
      },
      health,
      h3,
      websocket: {
        ...websocket,
        serverErrors: [...websocket.serverErrors, ...stderr.filter((line) => /error|exception|failed/i.test(line))],
      },
    });
  } finally {
    await stopServer(server);
  }
}

export function buildApiBunWebSocketRuntimeSmokeReport(
  input: ApiBunWebSocketRuntimeSmokeObservation,
): ApiBunWebSocketRuntimeSmokeReport {
  const runtimeEvidenceBlockers = [
    input.bun.executable && input.bun.version ? undefined : "bun_runtime_not_available",
    input.server.attempted ? undefined : "server_not_started",
    input.health.attempted && input.health.ok ? undefined : "health_check_failed",
    input.websocket.attempted && input.websocket.connected ? undefined : "websocket_not_connected",
    input.websocket.reconnectObserved ? undefined : "websocket_reconnect_not_observed",
    input.websocket.controlAckObserved ? undefined : "websocket_control_ack_missing",
    input.websocket.audioMetadataObserved ? undefined : "websocket_audio_metadata_missing",
    input.websocket.transcriptDeltaObserved ? undefined : "websocket_transcript_delta_missing",
    input.websocket.binaryEchoObserved ? undefined : "websocket_binary_echo_missing",
    input.websocket.protocolContract.gatewayReadyLocalEchoObserved ? undefined : "websocket_gateway_ready_contract_missing",
    input.websocket.protocolContract.gatewayReadyLiveDialogDisabledObserved ? undefined : "websocket_live_dialog_disabled_posture_missing",
    input.websocket.protocolContract.canonicalVoiceStartAckObserved ? undefined : "websocket_canonical_voice_start_ack_missing",
    input.websocket.protocolContract.sanitizedControlPayloadObserved ? undefined : "websocket_control_payload_sanitization_missing",
    input.websocket.protocolBoundary.malformedJsonControlRejected ? undefined : "websocket_malformed_json_not_rejected",
    input.websocket.protocolBoundary.unsupportedControlRejected ? undefined : "websocket_unsupported_control_not_rejected",
    input.websocket.serverErrors.length === 0 ? undefined : "server_errors_observed",
    input.h3.enabled === false && input.h3.h3TrueEnabled === false ? undefined : "http3_enabled_outside_approved_scope",
  ].filter((blocker): blocker is string => typeof blocker === "string");
  const smokePassed = runtimeEvidenceBlockers.length === 0;

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
    bun: input.bun,
    runtime: {
      target: "apps/api bun+hono",
      appPath: "apps/api",
      websocketPath: "/voice/realtime/ws",
      h3: input.h3,
    },
    server: {
      ...input.server,
      stdout: input.server.stdout.slice(-20),
      stderr: input.server.stderr.slice(-20),
    },
    health: input.health,
    traceContexts: {
      preVrTraceInteraction: {
        observed: input.websocket.controlFrameTypesSent.length > 0 && input.websocket.controlAckObserved,
        source: "synthetic_local_websocket_control_frame",
        controlFrameTypes: [...input.websocket.controlFrameTypesSent],
      },
      inVrTraceInteraction: {
        observed: false,
        blocker: "in_vr_trace_not_executed_by_local_bun_smoke",
      },
    },
    websocket: input.websocket,
    runtimeEvidenceBlockers,
    verdict: {
      smokePassed,
      readyForLiveDialog: false,
      blockers: [
        "in_vr_trace_not_executed_by_local_bun_smoke",
        "quest_browser_audio_capture_not_observed",
        "quest_playback_not_observed",
        "opus_media_path_not_verified",
        "real_model_inference_not_observed",
        "production_ingress_not_verified",
        "clinical_voice_safety_not_exercised",
        "low_latency_claim_not_supported_by_local_smoke",
      ],
      caveats: [
        "This smoke proves local Bun server WebSocket upgrade and bidirectional frame handling only.",
        "Protocol-boundary rejection checks are synthetic local client observations; they do not prove Quest, production ingress, or clinical media safety.",
        "Backpressure is measured from the local WebSocket client's bufferedAmount field when available; it is not Quest network or headset media evidence.",
        "HTTP/3, WebTransport, QUIC, Web3, cloud relays, model inference, and Quest in-VR media are out of scope for this report.",
      ],
    },
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

async function readBunVersion(bunExecutable: string): Promise<string | null> {
  return readCommandFirstLine(bunExecutable, ["--version"]);
}

async function readBunRevision(bunExecutable: string): Promise<string | null> {
  return readCommandFirstLine(bunExecutable, ["--revision"]);
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

function inspectBunServerH3Posture(): ApiBunWebSocketRuntimeSmokeObservation["h3"] {
  const source = readFileSync(path.join(process.cwd(), "apps/api/src/bun-server.ts"), "utf8");
  return {
    enabled: false,
    h3TrueEnabled: /h3\s*:\s*true/.test(source),
    optionPresentInServerSource: /h3\s*:/.test(source),
    outOfScopeForThisSmoke: true,
  };
}

async function waitForHealth(
  port: number,
  timeoutMs: number,
): Promise<ApiBunWebSocketRuntimeSmokeObservation["health"]> {
  const startedAt = performance.now();
  let statusCode: number | null = null;
  let body: unknown = null;

  while (performance.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      statusCode = response.status;
      body = await response.json();
      return {
        attempted: true,
        ok: response.ok && isApiHealthOk(body),
        statusCode,
        latencyMs: Math.round(performance.now() - startedAt),
        body,
      };
    } catch {
      await sleep(100);
    }
  }

  return {
    attempted: true,
    ok: false,
    statusCode,
    latencyMs: Math.round(performance.now() - startedAt),
    body,
  };
}

function isApiHealthOk(body: unknown): boolean {
  return typeof body === "object"
    && body !== null
    && (body as { ok?: unknown }).ok === true
    && (body as { service?: unknown }).service === "openclinxr-api";
}

async function runWebSocketProbe(input: {
  port: number;
  timeoutMs: number;
  burstFrames: number;
  burstFrameBytes: number;
}): Promise<ApiBunWebSocketRuntimeEvidence> {
  const WebSocketCtor = globalThis.WebSocket as unknown as { new(url: string): WebSocketLike } | undefined;
  const burstBytes = input.burstFrames * input.burstFrameBytes;
  if (!WebSocketCtor) {
    return emptyWebSocket(true, input.burstFrames, burstBytes);
  }

  const first = await runWebSocketExchange({
    WebSocketCtor,
    port: input.port,
    timeoutMs: input.timeoutMs,
    burstFrames: input.burstFrames,
    burstFrameBytes: input.burstFrameBytes,
    sendControl: true,
  });
  const reconnect = await runWebSocketExchange({
    WebSocketCtor,
    port: input.port,
    timeoutMs: input.timeoutMs,
    burstFrames: 0,
    burstFrameBytes: input.burstFrameBytes,
    sendControl: false,
  });

  return {
    ...first,
    reconnectObserved: reconnect.connected && reconnect.eventTypesObserved.includes("gateway.ready"),
    reconnectCloseCode: reconnect.closeCode,
    serverErrors: [...first.serverErrors, ...reconnect.serverErrors],
  };
}

async function runWebSocketExchange(input: {
  WebSocketCtor: { new(url: string): WebSocketLike };
  port: number;
  timeoutMs: number;
  burstFrames: number;
  burstFrameBytes: number;
  sendControl: boolean;
}): Promise<ApiBunWebSocketRuntimeEvidence> {
  const startedAt = performance.now();
  const websocket = new input.WebSocketCtor(`ws://127.0.0.1:${input.port}/voice/realtime/ws`);
  websocket.binaryType = "arraybuffer";
  const state = emptyWebSocket(true, input.burstFrames, input.burstFrames * input.burstFrameBytes);

  return new Promise((resolve) => {
    let resolved = false;
    const resolveOnce = (): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timeout);
      resolve(state);
    };
    const timeout = setTimeout(() => {
      state.serverErrors.push("websocket_probe_timeout");
      closeSocket(websocket);
      resolveOnce();
    }, input.timeoutMs);

    websocket.addEventListener("open", () => {
      state.connected = true;
      state.openLatencyMs = elapsed(startedAt);
      state.backpressure.bufferedAmountSamples.push(readBufferedAmount(websocket));

      if (input.sendControl) {
        state.controlFrameTypesSent.push("voice.start");
        websocket.send(JSON.stringify({
          type: "voice.start",
          sessionId: "local-bun-smoke",
          metadata: { probe: "sanitization" },
          chunkPlan: [1, 2],
        }));
        sendProtocolBoundaryProbeFrames(websocket, state);
        sendBinaryFrame(websocket, state, new Uint8Array([1, 1, 2, 3, 5, 8]));
        for (let index = 0; index < input.burstFrames; index += 1) {
          sendBinaryFrame(websocket, state, makeSyntheticFrame(input.burstFrameBytes, index));
        }
      }
    });

    websocket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        state.jsonMessages += 1;
        const parsed = safeJsonParse(event.data);
        const type = isRecord(parsed) && typeof parsed.type === "string" ? parsed.type : "";
        if (type) {
          state.eventTypesObserved.push(type);
        }
        if (type === "gateway.ready" && state.firstReadyLatencyMs === null) {
          state.firstReadyLatencyMs = elapsed(startedAt);
        }
        if (type === "gateway.ready" && isRecord(parsed)) {
          recordGatewayReadyContract(state, parsed);
        }
        if (type === "control.ack" && isRecord(parsed)) {
          recordControlAckContract(state, parsed);
          if (state.protocolContract.canonicalVoiceStartAckObserved && state.controlAckLatencyMs === null) {
            state.controlAckObserved = true;
            state.controlAckLatencyMs = elapsed(startedAt);
          }
        }
        if (type === "error" && isRecord(parsed)) {
          recordProtocolBoundaryError(state, parsed);
        }
        state.audioMetadataObserved ||= type === "audio.metadata";
        state.transcriptDeltaObserved ||= type === "transcript.delta";
      } else {
        state.binaryMessages += 1;
        state.binaryEchoObserved = true;
        if (state.firstBinaryEchoLatencyMs === null) {
          state.firstBinaryEchoLatencyMs = elapsed(startedAt);
        }
      }

      state.backpressure.bufferedAmountSamples.push(readBufferedAmount(websocket));
      state.backpressure.maxBufferedAmount = Math.max(...state.backpressure.bufferedAmountSamples);

      if (input.sendControl && exchangeComplete(state)) {
        setTimeout(() => closeSocket(websocket), 50);
      }
      if (!input.sendControl && state.firstReadyLatencyMs !== null) {
        closeSocket(websocket);
      }
    });

    websocket.addEventListener("close", (event) => {
      state.closeCode = typeof event.code === "number" ? event.code : state.closeCode;
      resolveOnce();
    });

    websocket.addEventListener("error", () => {
      state.serverErrors.push("websocket_client_error");
      state.backpressure.droppedOrErroredMessages += 1;
      resolveOnce();
    });
  });
}

function sendBinaryFrame(websocket: WebSocketLike, state: ApiBunWebSocketRuntimeEvidence, frame: Uint8Array): void {
  try {
    websocket.send(frame);
    state.binaryFramesSent += 1;
    state.binaryBytesSent += frame.byteLength;
    const bufferedAmount = readBufferedAmount(websocket);
    state.backpressure.bufferedAmountSamples.push(bufferedAmount);
    state.backpressure.maxBufferedAmount = Math.max(...state.backpressure.bufferedAmountSamples);
  } catch {
    state.backpressure.droppedOrErroredMessages += 1;
  }
}

function exchangeComplete(state: ApiBunWebSocketRuntimeEvidence): boolean {
  return state.eventTypesObserved.includes("gateway.ready")
    && state.controlAckObserved
    && state.audioMetadataObserved
    && state.transcriptDeltaObserved
    && state.binaryEchoObserved
    && state.protocolContract.gatewayReadyLocalEchoObserved
    && state.protocolContract.gatewayReadyLiveDialogDisabledObserved
    && state.protocolContract.canonicalVoiceStartAckObserved
    && state.protocolContract.sanitizedControlPayloadObserved
    && state.protocolBoundary.malformedJsonControlRejected
    && state.protocolBoundary.unsupportedControlRejected;
}

function recordGatewayReadyContract(
  state: ApiBunWebSocketRuntimeEvidence,
  payload: Record<string, unknown>,
): void {
  state.protocolContract.gatewayReadyLocalEchoObserved ||= payload.protocol === "bun-native-json-control-and-binary-audio-echo";
  state.protocolContract.gatewayReadyLiveDialogDisabledObserved ||= payload.readyForLiveDialog === false;
}

function recordControlAckContract(
  state: ApiBunWebSocketRuntimeEvidence,
  payload: Record<string, unknown>,
): void {
  state.protocolContract.canonicalVoiceStartAckObserved ||= payload.controlType === "voice.start";
  if (!isRecord(payload.received)) {
    return;
  }
  state.protocolContract.sanitizedControlPayloadObserved ||= payload.received.metadata === "object[1]"
    && payload.received.chunkPlan === "list[2]";
}

function sendProtocolBoundaryProbeFrames(websocket: WebSocketLike, state: ApiBunWebSocketRuntimeEvidence): void {
  const unsupportedControlType = "voice.unsupported_local_smoke_probe";
  try {
    websocket.send("{not-json");
    state.protocolBoundary.malformedJsonFramesSent += 1;
    websocket.send(JSON.stringify({ type: unsupportedControlType, sessionId: "local-bun-smoke" }));
    state.protocolBoundary.unsupportedControlFrameTypesSent.push(unsupportedControlType);
  } catch {
    state.backpressure.droppedOrErroredMessages += 1;
  }
}

function recordProtocolBoundaryError(
  state: ApiBunWebSocketRuntimeEvidence,
  payload: Record<string, unknown>,
): void {
  const reason = typeof payload.reason === "string" ? payload.reason : "unknown_error";
  state.protocolBoundary.errorReasonsObserved.push(reason);
  if (reason === "invalid_json_control_frame" || reason === "invalid JSON control frame") {
    state.protocolBoundary.malformedJsonControlRejected = true;
  }
  if (reason === "unsupported_control_type") {
    state.protocolBoundary.unsupportedControlRejected = true;
  }
}

function closeSocket(websocket: WebSocketLike): void {
  try {
    websocket.close(1000, "openclinxr-bun-smoke-complete");
  } catch {
    // Socket may already be closed.
  }
}

function makeSyntheticFrame(byteLength: number, seed: number): Uint8Array {
  const frame = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    frame[index] = (seed + index) % 256;
  }
  return frame;
}

function emptyHealth(attempted: boolean): ApiBunWebSocketRuntimeSmokeObservation["health"] {
  return {
    attempted,
    ok: false,
    statusCode: null,
    latencyMs: null,
    body: null,
  };
}

function emptyWebSocket(attempted: boolean, burstFrameCount: number, burstBytes: number): ApiBunWebSocketRuntimeEvidence {
  return {
    attempted,
    connected: false,
    reconnectObserved: false,
    openLatencyMs: null,
    firstReadyLatencyMs: null,
    controlAckLatencyMs: null,
    firstBinaryEchoLatencyMs: null,
    jsonMessages: 0,
    binaryMessages: 0,
    eventTypesObserved: [],
    controlFrameTypesSent: [],
    binaryFramesSent: 0,
    binaryBytesSent: 0,
    closeCode: null,
    reconnectCloseCode: null,
    controlAckObserved: false,
    audioMetadataObserved: false,
    transcriptDeltaObserved: false,
    binaryEchoObserved: false,
    serverErrors: [],
    protocolContract: {
      gatewayReadyLocalEchoObserved: false,
      gatewayReadyLiveDialogDisabledObserved: false,
      canonicalVoiceStartAckObserved: false,
      sanitizedControlPayloadObserved: false,
      localClientObservationOnly: true,
    },
    protocolBoundary: {
      malformedJsonFramesSent: 0,
      malformedJsonControlRejected: false,
      unsupportedControlFrameTypesSent: [],
      unsupportedControlRejected: false,
      errorReasonsObserved: [],
      localClientObservationOnly: true,
    },
    backpressure: {
      burstFrameCount,
      burstBytes,
      maxBufferedAmount: null,
      bufferedAmountSamples: [],
      droppedOrErroredMessages: 0,
      localClientObservationOnly: true,
    },
  };
}

async function stopServer(server: ChildProcessWithoutNullStreams): Promise<void> {
  if (server.killed || server.exitCode !== null) {
    return;
  }

  server.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server.once("close", () => resolve())),
    sleep(1_000),
  ]);

  if (!server.killed && server.exitCode === null) {
    server.kill("SIGKILL");
  }
}

function pushLines(target: string[], chunk: unknown): void {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  target.push(...text.split(/\r?\n/).filter(Boolean));
}

function prependPath(currentPath: string, entry: string): string {
  return `${entry}${path.delimiter}${currentPath}`;
}

function readBufferedAmount(websocket: WebSocketLike): number {
  return typeof websocket.bufferedAmount === "number" && Number.isFinite(websocket.bufferedAmount)
    ? websocket.bufferedAmount
    : 0;
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return parsed;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
