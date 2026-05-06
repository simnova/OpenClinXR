import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";

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
  validatePath?: string;
  validateLatest: boolean;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

type WebSocketLike = {
  binaryType: string;
  bufferedAmount?: number;
  close: (code?: number, reason?: string) => void;
  send: (data: string | Uint8Array) => void;
  addEventListener: (type: string, listener: (event: { data?: unknown; code?: number }) => void) => void;
};

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestApiBunWebSocketRuntimeSmokePath();
    const validation = validateApiBunWebSocketRuntimeSmokeReport(await readJson<unknown>(validatePath));
    if (validation.ok) {
      console.log(`Validated ${validatePath}`);
      return;
    }

    for (const error of validation.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

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
    validateLatest: false,
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === "--validate") {
      options.validatePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--validate-latest") {
      options.validateLatest = true;
      continue;
    }
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

async function latestApiBunWebSocketRuntimeSmokePath(): Promise<string> {
  const files = await globFiles("docs/openclinxr/api-bun-websocket-runtime-smoke-*.json");
  const latest = files.sort().at(-1);
  if (!latest) {
    throw new Error("No API Bun WebSocket runtime smoke report found.");
  }
  return latest;
}

export function validateApiBunWebSocketRuntimeSmokeReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireString(value.generatedAt, "/generatedAt", errors);
  requireOneOf(value.status, ["passed", "blocked"], "/status", errors);
  validatePolicy(value.policy, errors);
  validateBun(value.bun, errors);
  validateRuntime(value.runtime, errors);
  validateServer(value.server, errors);
  validateHealth(value.health, errors);
  validateTraceContexts(value.traceContexts, errors);
  validateWebSocket(value.websocket, errors);
  requireStringArray(value.runtimeEvidenceBlockers, "/runtimeEvidenceBlockers", errors);
  validateVerdict(value.verdict, errors);
  validateConsistency(value, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validatePolicy(value: unknown, errors: string[]): void {
  requireRecord(value, "/policy", errors);
  if (!isRecord(value)) {
    return;
  }

  for (const key of [
    "cloudApisUsed",
    "paidApisUsed",
    "modelDownloadsUsed",
    "http3Enabled",
    "webTransportUsed",
    "quicUsed",
    "web3Used",
    "questHardwareClaimed",
    "productionUseAllowed",
    "lowLatencyClaimed",
  ]) {
    requireLiteral(value[key], false, `/policy/${key}`, errors);
  }
}

function validateBun(value: unknown, errors: string[]): void {
  requireRecord(value, "/bun", errors);
  if (!isRecord(value)) {
    return;
  }

  requireNullableString(value.executable, "/bun/executable", errors);
  requireNullableString(value.version, "/bun/version", errors);
  requireNullableString(value.revision, "/bun/revision", errors);
}

function validateRuntime(value: unknown, errors: string[]): void {
  requireRecord(value, "/runtime", errors);
  if (!isRecord(value)) {
    return;
  }

  requireLiteral(value.target, "apps/api bun+hono", "/runtime/target", errors);
  requireLiteral(value.appPath, "apps/api", "/runtime/appPath", errors);
  requireLiteral(value.websocketPath, "/voice/realtime/ws", "/runtime/websocketPath", errors);
  requireRecord(value.h3, "/runtime/h3", errors);
  if (!isRecord(value.h3)) {
    return;
  }
  requireLiteral(value.h3.enabled, false, "/runtime/h3/enabled", errors);
  requireLiteral(value.h3.h3TrueEnabled, false, "/runtime/h3/h3TrueEnabled", errors);
  requireBoolean(value.h3.optionPresentInServerSource, "/runtime/h3/optionPresentInServerSource", errors);
  requireLiteral(value.h3.outOfScopeForThisSmoke, true, "/runtime/h3/outOfScopeForThisSmoke", errors);
}

function validateServer(value: unknown, errors: string[]): void {
  requireRecord(value, "/server", errors);
  if (!isRecord(value)) {
    return;
  }

  requireBoolean(value.attempted, "/server/attempted", errors);
  requireStringArray(value.command, "/server/command", errors);
  requireNumber(value.port, "/server/port", errors);
  requireStringArray(value.stdout, "/server/stdout", errors);
  requireStringArray(value.stderr, "/server/stderr", errors);
}

function validateHealth(value: unknown, errors: string[]): void {
  requireRecord(value, "/health", errors);
  if (!isRecord(value)) {
    return;
  }

  requireBoolean(value.attempted, "/health/attempted", errors);
  requireBoolean(value.ok, "/health/ok", errors);
  requireNullableNumber(value.statusCode, "/health/statusCode", errors);
  requireNullableNumber(value.latencyMs, "/health/latencyMs", errors);
}

function validateTraceContexts(value: unknown, errors: string[]): void {
  requireRecord(value, "/traceContexts", errors);
  if (!isRecord(value)) {
    return;
  }

  requireRecord(value.preVrTraceInteraction, "/traceContexts/preVrTraceInteraction", errors);
  if (isRecord(value.preVrTraceInteraction)) {
    requireBoolean(value.preVrTraceInteraction.observed, "/traceContexts/preVrTraceInteraction/observed", errors);
    requireLiteral(
      value.preVrTraceInteraction.source,
      "synthetic_local_websocket_control_frame",
      "/traceContexts/preVrTraceInteraction/source",
      errors,
    );
    requireStringArray(value.preVrTraceInteraction.controlFrameTypes, "/traceContexts/preVrTraceInteraction/controlFrameTypes", errors);
  }
  requireRecord(value.inVrTraceInteraction, "/traceContexts/inVrTraceInteraction", errors);
  if (isRecord(value.inVrTraceInteraction)) {
    requireLiteral(value.inVrTraceInteraction.observed, false, "/traceContexts/inVrTraceInteraction/observed", errors);
    requireLiteral(
      value.inVrTraceInteraction.blocker,
      "in_vr_trace_not_executed_by_local_bun_smoke",
      "/traceContexts/inVrTraceInteraction/blocker",
      errors,
    );
  }
}

function validateWebSocket(value: unknown, errors: string[]): void {
  requireRecord(value, "/websocket", errors);
  if (!isRecord(value)) {
    return;
  }

  for (const key of [
    "attempted",
    "connected",
    "reconnectObserved",
    "controlAckObserved",
    "audioMetadataObserved",
    "transcriptDeltaObserved",
    "binaryEchoObserved",
  ]) {
    requireBoolean(value[key], `/websocket/${key}`, errors);
  }
  for (const key of [
    "openLatencyMs",
    "firstReadyLatencyMs",
    "controlAckLatencyMs",
    "firstBinaryEchoLatencyMs",
    "closeCode",
    "reconnectCloseCode",
  ]) {
    requireNullableNumber(value[key], `/websocket/${key}`, errors);
  }
  for (const key of [
    "jsonMessages",
    "binaryMessages",
    "binaryFramesSent",
    "binaryBytesSent",
  ]) {
    requireNumber(value[key], `/websocket/${key}`, errors);
  }
  requireStringArray(value.eventTypesObserved, "/websocket/eventTypesObserved", errors);
  requireStringArray(value.controlFrameTypesSent, "/websocket/controlFrameTypesSent", errors);
  requireStringArray(value.serverErrors, "/websocket/serverErrors", errors);
  validateProtocolContract(value.protocolContract, errors);
  validateProtocolBoundary(value.protocolBoundary, errors);
  validateBackpressure(value.backpressure, errors);
}

function validateProtocolContract(value: unknown, errors: string[]): void {
  requireRecord(value, "/websocket/protocolContract", errors);
  if (!isRecord(value)) {
    return;
  }

  for (const key of [
    "gatewayReadyLocalEchoObserved",
    "gatewayReadyLiveDialogDisabledObserved",
    "canonicalVoiceStartAckObserved",
    "sanitizedControlPayloadObserved",
  ]) {
    requireBoolean(value[key], `/websocket/protocolContract/${key}`, errors);
  }
  requireLiteral(value.localClientObservationOnly, true, "/websocket/protocolContract/localClientObservationOnly", errors);
}

function validateProtocolBoundary(value: unknown, errors: string[]): void {
  requireRecord(value, "/websocket/protocolBoundary", errors);
  if (!isRecord(value)) {
    return;
  }

  requireNumber(value.malformedJsonFramesSent, "/websocket/protocolBoundary/malformedJsonFramesSent", errors);
  requireBoolean(value.malformedJsonControlRejected, "/websocket/protocolBoundary/malformedJsonControlRejected", errors);
  requireStringArray(value.unsupportedControlFrameTypesSent, "/websocket/protocolBoundary/unsupportedControlFrameTypesSent", errors);
  requireBoolean(value.unsupportedControlRejected, "/websocket/protocolBoundary/unsupportedControlRejected", errors);
  requireStringArray(value.errorReasonsObserved, "/websocket/protocolBoundary/errorReasonsObserved", errors);
  requireLiteral(value.localClientObservationOnly, true, "/websocket/protocolBoundary/localClientObservationOnly", errors);
}

function validateBackpressure(value: unknown, errors: string[]): void {
  requireRecord(value, "/websocket/backpressure", errors);
  if (!isRecord(value)) {
    return;
  }

  requireNumber(value.burstFrameCount, "/websocket/backpressure/burstFrameCount", errors);
  requireNumber(value.burstBytes, "/websocket/backpressure/burstBytes", errors);
  requireNullableNumber(value.maxBufferedAmount, "/websocket/backpressure/maxBufferedAmount", errors);
  if (!Array.isArray(value.bufferedAmountSamples) || value.bufferedAmountSamples.some((sample) => typeof sample !== "number" || !Number.isFinite(sample))) {
    errors.push("/websocket/backpressure/bufferedAmountSamples must be array of finite numbers");
  }
  requireNumber(value.droppedOrErroredMessages, "/websocket/backpressure/droppedOrErroredMessages", errors);
  requireLiteral(value.localClientObservationOnly, true, "/websocket/backpressure/localClientObservationOnly", errors);
}

function validateVerdict(value: unknown, errors: string[]): void {
  requireRecord(value, "/verdict", errors);
  if (!isRecord(value)) {
    return;
  }

  requireBoolean(value.smokePassed, "/verdict/smokePassed", errors);
  requireLiteral(value.readyForLiveDialog, false, "/verdict/readyForLiveDialog", errors);
  requireStringArray(value.blockers, "/verdict/blockers", errors);
  requireStringArray(value.caveats, "/verdict/caveats", errors);
}

function validateConsistency(value: Record<string, unknown>, errors: string[]): void {
  const expectedBlockers = expectedRuntimeEvidenceBlockers(value);
  const actualBlockers = new Set(stringArray(value.runtimeEvidenceBlockers));
  const hasBlockers = expectedBlockers.length > 0;
  const verdict = isRecord(value.verdict) ? value.verdict : {};

  if (value.status === "passed" && hasBlockers) {
    errors.push("/status must be blocked when runtime evidence blockers are present");
  }
  if (value.status === "blocked" && !hasBlockers) {
    errors.push("/status must be passed when no runtime evidence blockers are present");
  }
  for (const blocker of expectedBlockers) {
    if (!actualBlockers.has(blocker)) {
      errors.push(`/runtimeEvidenceBlockers missing expected blocker ${blocker}`);
    }
  }
  if (verdict.smokePassed !== !hasBlockers) {
    errors.push(`/verdict/smokePassed must be ${String(!hasBlockers)} when runtime evidence blockers are ${hasBlockers ? "present" : "absent"}`);
  }
}

function expectedRuntimeEvidenceBlockers(value: Record<string, unknown>): string[] {
  const bun = isRecord(value.bun) ? value.bun : {};
  const server = isRecord(value.server) ? value.server : {};
  const health = isRecord(value.health) ? value.health : {};
  const runtime = isRecord(value.runtime) ? value.runtime : {};
  const h3 = isRecord(runtime.h3) ? runtime.h3 : {};
  const websocket = isRecord(value.websocket) ? value.websocket : {};
  const contract = isRecord(websocket.protocolContract) ? websocket.protocolContract : {};
  const boundary = isRecord(websocket.protocolBoundary) ? websocket.protocolBoundary : {};
  const serverErrors = stringArray(websocket.serverErrors);

  return [
    typeof bun.executable === "string" && typeof bun.version === "string" ? undefined : "bun_runtime_not_available",
    server.attempted === true ? undefined : "server_not_started",
    health.attempted === true && health.ok === true ? undefined : "health_check_failed",
    websocket.attempted === true && websocket.connected === true ? undefined : "websocket_not_connected",
    websocket.reconnectObserved === true ? undefined : "websocket_reconnect_not_observed",
    websocket.controlAckObserved === true ? undefined : "websocket_control_ack_missing",
    websocket.audioMetadataObserved === true ? undefined : "websocket_audio_metadata_missing",
    websocket.transcriptDeltaObserved === true ? undefined : "websocket_transcript_delta_missing",
    websocket.binaryEchoObserved === true ? undefined : "websocket_binary_echo_missing",
    contract.gatewayReadyLocalEchoObserved === true ? undefined : "websocket_gateway_ready_contract_missing",
    contract.gatewayReadyLiveDialogDisabledObserved === true ? undefined : "websocket_live_dialog_disabled_posture_missing",
    contract.canonicalVoiceStartAckObserved === true ? undefined : "websocket_canonical_voice_start_ack_missing",
    contract.sanitizedControlPayloadObserved === true ? undefined : "websocket_control_payload_sanitization_missing",
    boundary.malformedJsonControlRejected === true ? undefined : "websocket_malformed_json_not_rejected",
    boundary.unsupportedControlRejected === true ? undefined : "websocket_unsupported_control_not_rejected",
    serverErrors.length === 0 ? undefined : "server_errors_observed",
    h3.enabled === false && h3.h3TrueEnabled === false ? undefined : "http3_enabled_outside_approved_scope",
  ].filter((blocker): blocker is string => typeof blocker === "string");
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

function requireRecord(value: unknown, pathName: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${pathName} must be object`);
  }
}

function requireString(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${pathName} must be non-empty string`);
  }
}

function requireNullableString(value: unknown, pathName: string, errors: string[]): void {
  if (value !== null && (typeof value !== "string" || value.length === 0)) {
    errors.push(`${pathName} must be null or non-empty string`);
  }
}

function requireStringArray(value: unknown, pathName: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${pathName} must be array`);
    return;
  }

  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      errors.push(`${pathName}/${index} must be non-empty string`);
    }
  });
}

function requireBoolean(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "boolean") {
    errors.push(`${pathName} must be boolean`);
  }
}

function requireNumber(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${pathName} must be finite number`);
  }
}

function requireNullableNumber(value: unknown, pathName: string, errors: string[]): void {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    errors.push(`${pathName} must be null or finite number`);
  }
}

function requireLiteral<T extends string | boolean | number>(
  value: unknown,
  literal: T,
  pathName: string,
  errors: string[],
): void {
  if (value !== literal) {
    errors.push(`${pathName} must be ${JSON.stringify(literal)}`);
  }
}

function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  pathName: string,
  errors: string[],
): void {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    errors.push(`${pathName} must be one of ${allowed.map((entry) => JSON.stringify(entry)).join(", ")}`);
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
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
