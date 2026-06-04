import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { realtimeVoiceProtocol } from "../../../packages/openclinxr/voice-gateway/src/index.js";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";
import type { LocalQwenTtsRuntimeSmokeReport } from "./local-qwen-tts-runtime-smoke.js";

export type PythonDependencyStatus = "available" | "missing";

export type ApiPythonBackendRuntimeSmokeReport = {
  generatedAt: string;
  status: "passed" | "blocked";
  policy: {
    cloudApisUsed: false;
    paidApisUsed: false;
    modelDownloadsUsed: false;
    committedGeneratedAudio: false;
    productionUseAllowed: false;
  };
  python: {
    executable: string;
    version: string | null;
    dependencies: Record<string, PythonDependencyStatus>;
    missingPackages: string[];
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
  capabilities: {
    attempted: boolean;
    ok: boolean;
    statusCode: number | null;
    latencyMs: number | null;
    modes: Array<{
      id: string;
      status: string;
      blockers: string[];
    }>;
    body: unknown;
  };
  websocket: {
    attempted: boolean;
    connected: boolean;
    jsonMessages: number;
    binaryMessages: number;
    controlAckObserved: boolean;
    audioMetadataObserved: boolean;
    transcriptDeltaObserved: boolean;
    binaryEchoObserved: boolean;
    latencyMs: number | null;
    protocol: {
      websocketPath: "/voice/realtime/ws";
      codec: "opus";
      backendProtocolObserved: boolean;
      clientControlFrameTypesSent: string[];
      serverEventTypesObserved: string[];
      latencyFieldsObserved: boolean;
      canonicalProtocolObserved: boolean;
    };
  };
  relatedLocalInferenceEvidence?: {
    qwen3Tts?: {
      observed: boolean;
      claimScope: string;
      modelId: string;
      realTimeFactor: number | null;
      readyForLiveDialog: false;
      blockers: string[];
    };
  };
  verdict: {
    passed: boolean;
    readyForLiveDialog: false;
    blockers: string[];
    caveats: string[];
  };
};

type CliOptions = {
  outputPath?: string;
  pythonExecutable: string;
  port: number;
  timeoutMs: number;
  localQwenTtsRuntimeSmokePath?: string;
  validatePath?: string;
  validateLatest: boolean;
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

type RuntimeSmokeObservation = {
  generatedAt?: string;
  pythonExecutable: string;
  pythonVersion: string | null;
  dependencies: Record<string, PythonDependencyStatus>;
  serverCommand: string[];
  serverAttempted: boolean;
  port: number;
  stdout: string[];
  stderr: string[];
  health: ApiPythonBackendRuntimeSmokeReport["health"];
  capabilities: ApiPythonBackendRuntimeSmokeReport["capabilities"];
  websocket: ApiPythonBackendRuntimeSmokeReport["websocket"];
  localQwenTtsRuntimeSmoke?: LocalQwenTtsRuntimeSmokeReport;
};

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestApiPythonBackendRuntimeSmokePath();
    const validation = validateApiPythonBackendRuntimeSmokeReport(await readJson<unknown>(validatePath));
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

  const localQwenTtsRuntimeSmoke = options.localQwenTtsRuntimeSmokePath
    ? await readJson<LocalQwenTtsRuntimeSmokeReport>(options.localQwenTtsRuntimeSmokePath)
    : undefined;
  const report = await runApiPythonBackendRuntimeSmoke({
    ...options,
    localQwenTtsRuntimeSmoke,
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
  const options: CliOptions = {
    pythonExecutable: "python3",
    port: 8765,
    timeoutMs: 8_000,
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
    if (arg === "--python") {
      options.pythonExecutable = requireValue(normalizedArgs, index, arg);
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
    if (arg === "--local-qwen-tts-runtime-smoke") {
      options.localQwenTtsRuntimeSmokePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

async function latestApiPythonBackendRuntimeSmokePath(): Promise<string> {
  const files = await globFiles("docs/openclinxr/api-python-backend-runtime-smoke-*.json");
  const latest = files.sort().at(-1);
  if (!latest) {
    throw new Error("No API Python backend runtime smoke report found.");
  }
  return latest;
}

export function validateApiPythonBackendRuntimeSmokeReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireString(value.generatedAt, "/generatedAt", errors);
  requireOneOf(value.status, ["passed", "blocked"], "/status", errors);
  validatePolicy(value.policy, errors);
  validatePython(value.python, errors);
  validateServer(value.server, errors);
  validateHealth(value.health, errors);
  validateCapabilities(value.capabilities, errors);
  validateWebSocket(value.websocket, errors);
  if (value.relatedLocalInferenceEvidence !== undefined) {
    validateRelatedLocalInferenceEvidence(value.relatedLocalInferenceEvidence, errors);
  }
  validateVerdict(value.verdict, errors);
  validateConsistency(value, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validatePolicy(value: unknown, errors: string[]): void {
  requireRecord(value, "/policy", errors);
  if (!isRecord(value)) {
    return;
  }

  requireLiteral(value.cloudApisUsed, false, "/policy/cloudApisUsed", errors);
  requireLiteral(value.paidApisUsed, false, "/policy/paidApisUsed", errors);
  requireLiteral(value.modelDownloadsUsed, false, "/policy/modelDownloadsUsed", errors);
  requireLiteral(value.committedGeneratedAudio, false, "/policy/committedGeneratedAudio", errors);
  requireLiteral(value.productionUseAllowed, false, "/policy/productionUseAllowed", errors);
}

function validatePython(value: unknown, errors: string[]): void {
  requireRecord(value, "/python", errors);
  if (!isRecord(value)) {
    return;
  }

  requireString(value.executable, "/python/executable", errors);
  requireNullableString(value.version, "/python/version", errors);
  requireRecord(value.dependencies, "/python/dependencies", errors);
  if (isRecord(value.dependencies)) {
    for (const [packageName, status] of Object.entries(value.dependencies)) {
      requireOneOf(status, ["available", "missing"], `/python/dependencies/${packageName}`, errors);
    }
  }
  requireStringArray(value.missingPackages, "/python/missingPackages", errors);
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

function validateCapabilities(value: unknown, errors: string[]): void {
  requireRecord(value, "/capabilities", errors);
  if (!isRecord(value)) {
    return;
  }

  requireBoolean(value.attempted, "/capabilities/attempted", errors);
  requireBoolean(value.ok, "/capabilities/ok", errors);
  requireNullableNumber(value.statusCode, "/capabilities/statusCode", errors);
  requireNullableNumber(value.latencyMs, "/capabilities/latencyMs", errors);
  if (!Array.isArray(value.modes)) {
    errors.push("/capabilities/modes must be array");
    return;
  }
  value.modes.forEach((mode, index) => {
    if (!isRecord(mode)) {
      errors.push(`/capabilities/modes/${index} must be object`);
      return;
    }
    requireString(mode.id, `/capabilities/modes/${index}/id`, errors);
    requireString(mode.status, `/capabilities/modes/${index}/status`, errors);
    requireStringArray(mode.blockers, `/capabilities/modes/${index}/blockers`, errors);
  });
}

function validateWebSocket(value: unknown, errors: string[]): void {
  requireRecord(value, "/websocket", errors);
  if (!isRecord(value)) {
    return;
  }

  requireBoolean(value.attempted, "/websocket/attempted", errors);
  requireBoolean(value.connected, "/websocket/connected", errors);
  requireNumber(value.jsonMessages, "/websocket/jsonMessages", errors);
  requireNumber(value.binaryMessages, "/websocket/binaryMessages", errors);
  for (const key of [
    "controlAckObserved",
    "audioMetadataObserved",
    "transcriptDeltaObserved",
    "binaryEchoObserved",
  ]) {
    requireBoolean(value[key], `/websocket/${key}`, errors);
  }
  requireNullableNumber(value.latencyMs, "/websocket/latencyMs", errors);
  validateWebSocketProtocol(value.protocol, errors);
}

function validateWebSocketProtocol(value: unknown, errors: string[]): void {
  requireRecord(value, "/websocket/protocol", errors);
  if (!isRecord(value)) {
    return;
  }

  requireLiteral(value.websocketPath, "/voice/realtime/ws", "/websocket/protocol/websocketPath", errors);
  requireLiteral(value.codec, "opus", "/websocket/protocol/codec", errors);
  requireBoolean(value.backendProtocolObserved, "/websocket/protocol/backendProtocolObserved", errors);
  requireStringArray(value.clientControlFrameTypesSent, "/websocket/protocol/clientControlFrameTypesSent", errors);
  requireStringArray(value.serverEventTypesObserved, "/websocket/protocol/serverEventTypesObserved", errors);
  requireBoolean(value.latencyFieldsObserved, "/websocket/protocol/latencyFieldsObserved", errors);
  requireBoolean(value.canonicalProtocolObserved, "/websocket/protocol/canonicalProtocolObserved", errors);
}

function validateRelatedLocalInferenceEvidence(value: unknown, errors: string[]): void {
  requireRecord(value, "/relatedLocalInferenceEvidence", errors);
  if (!isRecord(value)) {
    return;
  }

  if (value.qwen3Tts === undefined) {
    return;
  }
  requireRecord(value.qwen3Tts, "/relatedLocalInferenceEvidence/qwen3Tts", errors);
  if (!isRecord(value.qwen3Tts)) {
    return;
  }
  requireBoolean(value.qwen3Tts.observed, "/relatedLocalInferenceEvidence/qwen3Tts/observed", errors);
  requireLiteral(value.qwen3Tts.claimScope, "local_tts_inference_only", "/relatedLocalInferenceEvidence/qwen3Tts/claimScope", errors);
  requireLiteral(
    value.qwen3Tts.modelId,
    "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
    "/relatedLocalInferenceEvidence/qwen3Tts/modelId",
    errors,
  );
  requireNullableNumber(value.qwen3Tts.realTimeFactor, "/relatedLocalInferenceEvidence/qwen3Tts/realTimeFactor", errors);
  requireLiteral(value.qwen3Tts.readyForLiveDialog, false, "/relatedLocalInferenceEvidence/qwen3Tts/readyForLiveDialog", errors);
  requireStringArray(value.qwen3Tts.blockers, "/relatedLocalInferenceEvidence/qwen3Tts/blockers", errors);
}

function validateVerdict(value: unknown, errors: string[]): void {
  requireRecord(value, "/verdict", errors);
  if (!isRecord(value)) {
    return;
  }

  requireBoolean(value.passed, "/verdict/passed", errors);
  requireLiteral(value.readyForLiveDialog, false, "/verdict/readyForLiveDialog", errors);
  requireStringArray(value.blockers, "/verdict/blockers", errors);
  requireStringArray(value.caveats, "/verdict/caveats", errors);
}

function validateConsistency(value: Record<string, unknown>, errors: string[]): void {
  const verdict = isRecord(value.verdict) ? value.verdict : undefined;
  if (!verdict) {
    return;
  }

  const expectedBlockers = expectedApiPythonBackendRuntimeSmokeBlockers(value);
  const hasBlockers = expectedBlockers.length > 0;
  const actualBlockers = new Set(stringArray(verdict.blockers));

  if (value.status === "passed" && hasBlockers) {
    errors.push("/status must be blocked when blockers are present");
  }
  if (value.status === "blocked" && !hasBlockers) {
    errors.push("/status must be passed when no blockers are present");
  }
  if (verdict.passed !== !hasBlockers) {
    errors.push(`/verdict/passed must be ${String(!hasBlockers)} when blockers are ${hasBlockers ? "present" : "absent"}`);
  }
  for (const blocker of expectedBlockers) {
    if (!actualBlockers.has(blocker)) {
      errors.push(`/verdict/blockers missing expected blocker ${blocker}`);
    }
  }
}

function expectedApiPythonBackendRuntimeSmokeBlockers(value: Record<string, unknown>): string[] {
  const python = isRecord(value.python) ? value.python : {};
  const server = isRecord(value.server) ? value.server : {};
  const health = isRecord(value.health) ? value.health : {};
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {};
  const websocket = isRecord(value.websocket) ? value.websocket : {};
  const protocol = isRecord(websocket.protocol) ? websocket.protocol : {};
  const dependencies = isRecord(python.dependencies) ? python.dependencies : {};

  return [
    ...Object.entries(dependencies)
      .filter(([, status]) => status === "missing")
      .map(([packageName]) => `python_dependency_missing:${packageName}`),
    server.attempted === true ? undefined : "server_not_started",
    health.attempted === true && health.ok === true ? undefined : "health_check_failed",
    capabilities.attempted === true && capabilities.ok === true ? undefined : "capabilities_check_failed",
    websocket.attempted === true && websocket.connected === true ? undefined : "websocket_not_connected",
    websocket.controlAckObserved === true ? undefined : "websocket_control_ack_missing",
    websocket.audioMetadataObserved === true ? undefined : "websocket_audio_metadata_missing",
    websocket.transcriptDeltaObserved === true ? undefined : "websocket_transcript_delta_missing",
    websocket.binaryEchoObserved === true ? undefined : "websocket_binary_echo_missing",
    protocol.backendProtocolObserved === true ? undefined : "websocket_backend_protocol_not_observed",
    protocol.latencyFieldsObserved === true ? undefined : "websocket_latency_fields_not_observed",
    protocol.canonicalProtocolObserved === true ? undefined : "websocket_canonical_protocol_not_observed",
  ].filter((blocker): blocker is string => typeof blocker === "string");
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

export async function runApiPythonBackendRuntimeSmoke(
  options: CliOptions & { localQwenTtsRuntimeSmoke?: LocalQwenTtsRuntimeSmokeReport },
): Promise<ApiPythonBackendRuntimeSmokeReport> {
  const pythonVersion = await readPythonVersion(options.pythonExecutable);
  const dependencies = await probePythonDependencies(options.pythonExecutable, ["fastapi", "uvicorn", "websockets"]);
  const serverCommand = [
    options.pythonExecutable,
    "-m",
    "uvicorn",
    "api_python_backend.main:app",
    "--app-dir",
    "apps/arena/api-python-backend/src",
    "--host",
    "127.0.0.1",
    "--port",
    String(options.port),
  ];

  if (Object.values(dependencies).some((status) => status === "missing")) {
    return buildApiPythonBackendRuntimeSmokeReport({
      pythonExecutable: options.pythonExecutable,
      pythonVersion,
      dependencies,
      serverCommand,
      serverAttempted: false,
      port: options.port,
      stdout: [],
      stderr: [],
      health: emptyHealth(false),
      capabilities: emptyCapabilities(false),
      websocket: emptyWebSocket(false),
      localQwenTtsRuntimeSmoke: options.localQwenTtsRuntimeSmoke,
    });
  }

  const server = spawn(options.pythonExecutable, serverCommand.slice(1), {
    cwd: process.cwd(),
    env: process.env,
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  server.stdout.on("data", (chunk) => pushLines(stdout, chunk));
  server.stderr.on("data", (chunk) => pushLines(stderr, chunk));

  try {
    const health = await waitForHealth(options.port, options.timeoutMs);
    const capabilities = health.ok
      ? await fetchCapabilities(options.port, options.timeoutMs)
      : emptyCapabilities(false);
    const websocket = health.ok
      ? await runWebSocketProbe(options.port, options.timeoutMs)
      : emptyWebSocket(false);

    return buildApiPythonBackendRuntimeSmokeReport({
      pythonExecutable: options.pythonExecutable,
      pythonVersion,
      dependencies,
      serverCommand,
      serverAttempted: true,
      port: options.port,
      stdout,
      stderr,
      health,
      capabilities,
      websocket,
      localQwenTtsRuntimeSmoke: options.localQwenTtsRuntimeSmoke,
    });
  } finally {
    await stopServer(server);
  }
}

export function buildApiPythonBackendRuntimeSmokeReport(
  input: RuntimeSmokeObservation,
): ApiPythonBackendRuntimeSmokeReport {
  const missingPackages = Object.entries(input.dependencies)
    .filter(([, status]) => status === "missing")
    .map(([packageName]) => packageName);
  const blockers = [
    ...missingPackages.map((packageName) => `python_dependency_missing:${packageName}`),
    ...(input.serverAttempted ? [] : ["server_not_started"]),
    ...(input.health.attempted && input.health.ok ? [] : ["health_check_failed"]),
    ...(input.capabilities.attempted && input.capabilities.ok ? [] : ["capabilities_check_failed"]),
    ...(input.websocket.attempted && input.websocket.connected ? [] : ["websocket_not_connected"]),
    ...(input.websocket.controlAckObserved ? [] : ["websocket_control_ack_missing"]),
    ...(input.websocket.audioMetadataObserved ? [] : ["websocket_audio_metadata_missing"]),
    ...(input.websocket.transcriptDeltaObserved ? [] : ["websocket_transcript_delta_missing"]),
    ...(input.websocket.binaryEchoObserved ? [] : ["websocket_binary_echo_missing"]),
    ...(input.websocket.protocol?.backendProtocolObserved ? [] : ["websocket_backend_protocol_not_observed"]),
    ...(input.websocket.protocol?.latencyFieldsObserved ? [] : ["websocket_latency_fields_not_observed"]),
    ...(input.websocket.protocol?.canonicalProtocolObserved ? [] : ["websocket_canonical_protocol_not_observed"]),
  ];
  const passed = blockers.length === 0;
  const relatedLocalInferenceEvidence = buildRelatedLocalInferenceEvidence(input.localQwenTtsRuntimeSmoke);
  const qwenEvidenceObserved = relatedLocalInferenceEvidence?.qwen3Tts?.observed === true;

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: passed ? "passed" : "blocked",
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      modelDownloadsUsed: false,
      committedGeneratedAudio: false,
      productionUseAllowed: false,
    },
    python: {
      executable: input.pythonExecutable,
      version: input.pythonVersion,
      dependencies: input.dependencies,
      missingPackages,
    },
    server: {
      attempted: input.serverAttempted,
      command: input.serverCommand,
      port: input.port,
      stdout: input.stdout.slice(-20),
      stderr: input.stderr.slice(-20),
    },
    health: input.health,
    capabilities: input.capabilities,
    websocket: input.websocket,
    ...(relatedLocalInferenceEvidence ? { relatedLocalInferenceEvidence } : {}),
    verdict: {
      passed,
      readyForLiveDialog: false,
      blockers,
      caveats: [
        "This smoke proves FastAPI health and WebSocket frame handling only.",
        qwenEvidenceObserved
          ? "Qwen3-TTS local inference has separate file-generation evidence, but the FastAPI backend is still transport-echo only and does not execute that model."
          : "No Moshi, Qwen3-TTS, VibeVoice, Grok Voice, ASR, Opus codec, or Quest playback inference is exercised.",
      ],
    },
  };
}

function buildRelatedLocalInferenceEvidence(
  qwenSmoke: LocalQwenTtsRuntimeSmokeReport | undefined,
): ApiPythonBackendRuntimeSmokeReport["relatedLocalInferenceEvidence"] | undefined {
  if (!qwenSmoke) {
    return undefined;
  }
  const blockers = [
    qwenSmoke.kind === "local_qwen_tts_runtime_smoke" ? undefined : "invalid_local_qwen_tts_runtime_smoke_kind",
    qwenSmoke.claim_scope === "local_tts_inference_only" ? undefined : "invalid_local_qwen_tts_claim_scope",
    qwenSmoke.policy.cloudApisUsed ? "qwen_tts_smoke_cloud_apis_used" : undefined,
    qwenSmoke.policy.paidApisUsed ? "qwen_tts_smoke_paid_apis_used" : undefined,
    qwenSmoke.policy.generatedAudioCommitted ? "qwen_tts_generated_audio_committed" : undefined,
    qwenSmoke.verdict.passed ? undefined : "qwen_tts_runtime_smoke_failed",
    ...qwenSmoke.verdict.blockers,
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    qwen3Tts: {
      observed: blockers.length === 0,
      claimScope: qwenSmoke.claim_scope,
      modelId: qwenSmoke.runtime.modelId,
      realTimeFactor: qwenSmoke.metrics.realTimeFactor,
      readyForLiveDialog: false,
      blockers,
    },
  };
}

async function readPythonVersion(pythonExecutable: string): Promise<string | null> {
  const result = await runCommand(pythonExecutable, ["--version"]);
  return result.exitCode === 0 ? [...result.stdout, ...result.stderr].join("\n").trim() : null;
}

async function probePythonDependencies(
  pythonExecutable: string,
  packageNames: string[],
): Promise<Record<string, PythonDependencyStatus>> {
  const entries = await Promise.all(packageNames.map(async (packageName) => {
    const result = await runCommand(pythonExecutable, ["-c", `import ${packageName}`]);
    return [packageName, result.exitCode === 0 ? "available" : "missing"] as const;
  }));

  return Object.fromEntries(entries);
}

async function runCommand(command: string, args: string[]): Promise<{ exitCode: number | null; stdout: string[]; stderr: string[] }> {
  const child = spawn(command, args, { cwd: process.cwd() });
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.on("data", (chunk) => pushLines(stdout, chunk));
  child.stderr.on("data", (chunk) => pushLines(stderr, chunk));

  return new Promise((resolve) => {
    child.on("error", (error) => {
      stderr.push(error.message);
      resolve({ exitCode: 1, stdout, stderr });
    });
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

async function waitForHealth(
  port: number,
  timeoutMs: number,
): Promise<ApiPythonBackendRuntimeSmokeReport["health"]> {
  const startedAt = performance.now();
  let statusCode: number | null = null;
  let body: unknown = null;

  while (performance.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      statusCode = response.status;
      body = await response.json();
      return {
        attempted: true,
        ok: response.ok && isHealthOk(body),
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

function isHealthOk(body: unknown): boolean {
  return typeof body === "object"
    && body !== null
    && (body as { status?: unknown }).status === "ok"
    && (body as { service?: unknown }).service === "api-python-backend";
}

async function fetchCapabilities(
  port: number,
  timeoutMs: number,
): Promise<ApiPythonBackendRuntimeSmokeReport["capabilities"]> {
  const startedAt = performance.now();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/capabilities`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json();
    const modes = extractCapabilityModes(body);
    return {
      attempted: true,
      ok: response.ok && isCapabilitiesOk(body, modes),
      statusCode: response.status,
      latencyMs: Math.round(performance.now() - startedAt),
      modes,
      body,
    };
  } catch {
    return {
      attempted: true,
      ok: false,
      statusCode: null,
      latencyMs: Math.round(performance.now() - startedAt),
      modes: [],
      body: null,
    };
  }
}

function extractCapabilityModes(body: unknown): ApiPythonBackendRuntimeSmokeReport["capabilities"]["modes"] {
  if (typeof body !== "object" || body === null || !Array.isArray((body as { modes?: unknown }).modes)) {
    return [];
  }
  return (body as { modes: unknown[] }).modes
    .filter((mode): mode is Record<string, unknown> => typeof mode === "object" && mode !== null)
    .map((mode) => ({
      id: typeof mode.id === "string" ? mode.id : "unknown",
      status: typeof mode.status === "string" ? mode.status : "unknown",
      blockers: Array.isArray(mode.blockers)
        ? mode.blockers.filter((blocker): blocker is string => typeof blocker === "string")
        : [],
    }));
}

function isCapabilitiesOk(
  body: unknown,
  modes: ApiPythonBackendRuntimeSmokeReport["capabilities"]["modes"],
): boolean {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const defaultMode = (body as { defaultMode?: unknown }).defaultMode;
  const modeById = new Map(modes.map((mode) => [mode.id, mode]));
  return defaultMode === "transport-echo"
    && modeById.get("transport-echo")?.status === "ready"
    && modeById.get("moshi-mlx")?.status === "approved_runtime_missing"
    && modeById.get("qwen3-tts-mlx")?.status === "approved_runtime_missing";
}

async function runWebSocketProbe(
  port: number,
  timeoutMs: number,
): Promise<ApiPythonBackendRuntimeSmokeReport["websocket"]> {
  const WebSocketCtor = globalThis.WebSocket as unknown as {
    new(url: string): {
      binaryType: string;
      close: () => void;
      send: (data: string | Uint8Array) => void;
      addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => void;
    };
  } | undefined;

  if (!WebSocketCtor) {
    return {
      ...emptyWebSocket(true),
      latencyMs: 0,
    };
  }

  const startedAt = performance.now();
  const websocket = new WebSocketCtor(`ws://127.0.0.1:${port}/voice/realtime/ws`);
  websocket.binaryType = "arraybuffer";

  return new Promise((resolve) => {
    const state = {
      connected: false,
      jsonMessages: 0,
      binaryMessages: 0,
      controlAckObserved: false,
      audioMetadataObserved: false,
      transcriptDeltaObserved: false,
      binaryEchoObserved: false,
      clientControlFrameTypesSent: [] as string[],
      serverEventTypesObserved: [] as string[],
      backendProtocolObserved: false,
      latencyFieldsObserved: false,
    };
    const buildProtocol = (): ApiPythonBackendRuntimeSmokeReport["websocket"]["protocol"] => {
      const serverEvents = state.serverEventTypesObserved;
      return {
        websocketPath: realtimeVoiceProtocol.websocketPath,
        codec: realtimeVoiceProtocol.codec,
        backendProtocolObserved: state.backendProtocolObserved,
        clientControlFrameTypesSent: [...state.clientControlFrameTypesSent],
        serverEventTypesObserved: [...serverEvents],
        latencyFieldsObserved: state.latencyFieldsObserved,
        canonicalProtocolObserved: [
          realtimeVoiceProtocol.serverEvents.backendReady,
          realtimeVoiceProtocol.serverEvents.voiceStarted,
          realtimeVoiceProtocol.serverEvents.audioChunk,
          realtimeVoiceProtocol.serverEvents.transcriptPartial,
          realtimeVoiceProtocol.serverEvents.transcriptFinal,
          realtimeVoiceProtocol.serverEvents.voiceStopped,
        ].every((eventType) => serverEvents.includes(eventType)),
      };
    };
    const buildResult = (): ApiPythonBackendRuntimeSmokeReport["websocket"] => ({
      attempted: true,
      connected: state.connected,
      jsonMessages: state.jsonMessages,
      binaryMessages: state.binaryMessages,
      controlAckObserved: state.controlAckObserved,
      audioMetadataObserved: state.audioMetadataObserved,
      transcriptDeltaObserved: state.transcriptDeltaObserved,
      binaryEchoObserved: state.binaryEchoObserved,
      latencyMs: Math.round(performance.now() - startedAt),
      protocol: buildProtocol(),
    });
    const timeout = setTimeout(() => {
      websocket.close();
      resolve(buildResult());
    }, timeoutMs);

    websocket.addEventListener("open", () => {
      state.connected = true;
      state.clientControlFrameTypesSent.push(realtimeVoiceProtocol.clientControlFrames.start);
      websocket.send(JSON.stringify({
        type: realtimeVoiceProtocol.clientControlFrames.start,
        codec: realtimeVoiceProtocol.codec,
        sampleRateHz: realtimeVoiceProtocol.sampleRateHz,
      }));
      state.clientControlFrameTypesSent.push(realtimeVoiceProtocol.clientControlFrames.audioMetadata);
      websocket.send(JSON.stringify({
        type: realtimeVoiceProtocol.clientControlFrames.audioMetadata,
        chunkIndex: 0,
        byteLength: 6,
        codec: realtimeVoiceProtocol.codec,
        clientSentAtMs: Math.round(performance.now()),
      }));
      websocket.send(new Uint8Array([1, 1, 2, 3, 5, 8]));
      state.clientControlFrameTypesSent.push(realtimeVoiceProtocol.clientControlFrames.stop);
      websocket.send(JSON.stringify({ type: realtimeVoiceProtocol.clientControlFrames.stop }));
    });

    websocket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        state.jsonMessages += 1;
        const parsed = safeJsonParse(event.data);
        const type = typeof parsed === "object" && parsed !== null ? (parsed as { type?: unknown }).type : undefined;
        if (typeof type === "string") {
          state.serverEventTypesObserved.push(type);
        }
        state.backendProtocolObserved ||= type === realtimeVoiceProtocol.serverEvents.backendReady
          && typeof parsed === "object"
          && parsed !== null
          && (parsed as { backendProtocol?: unknown }).backendProtocol === realtimeVoiceProtocol.backendProtocol;
        state.controlAckObserved ||= type === realtimeVoiceProtocol.serverEvents.voiceStarted;
        state.audioMetadataObserved ||= type === realtimeVoiceProtocol.serverEvents.audioChunk;
        state.latencyFieldsObserved ||= type === realtimeVoiceProtocol.serverEvents.audioChunk
          && typeof parsed === "object"
          && parsed !== null
          && typeof (parsed as { clientSentAtMs?: unknown }).clientSentAtMs === "number"
          && typeof (parsed as { backendObservedAtMs?: unknown }).backendObservedAtMs === "number";
        state.transcriptDeltaObserved ||= type === realtimeVoiceProtocol.serverEvents.transcriptPartial
          || type === realtimeVoiceProtocol.serverEvents.transcriptFinal;
      } else {
        state.binaryMessages += 1;
        state.binaryEchoObserved = true;
      }

      if (
        state.controlAckObserved
        && state.audioMetadataObserved
        && state.transcriptDeltaObserved
        && state.binaryEchoObserved
        && state.backendProtocolObserved
        && state.latencyFieldsObserved
        && state.serverEventTypesObserved.includes(realtimeVoiceProtocol.serverEvents.transcriptFinal)
        && state.serverEventTypesObserved.includes(realtimeVoiceProtocol.serverEvents.voiceStopped)
      ) {
        clearTimeout(timeout);
        websocket.close();
        resolve(buildResult());
      }
    });

    websocket.addEventListener("error", () => {
      clearTimeout(timeout);
      resolve(buildResult());
    });
  });
}

function emptyHealth(attempted: boolean): ApiPythonBackendRuntimeSmokeReport["health"] {
  return {
    attempted,
    ok: false,
    statusCode: null,
    latencyMs: null,
    body: null,
  };
}

function emptyCapabilities(attempted: boolean): ApiPythonBackendRuntimeSmokeReport["capabilities"] {
  return {
    attempted,
    ok: false,
    statusCode: null,
    latencyMs: null,
    modes: [],
    body: null,
  };
}

function emptyWebSocket(attempted: boolean): ApiPythonBackendRuntimeSmokeReport["websocket"] {
  return {
    attempted,
    connected: false,
    jsonMessages: 0,
    binaryMessages: 0,
    controlAckObserved: false,
    audioMetadataObserved: false,
    transcriptDeltaObserved: false,
    binaryEchoObserved: false,
    latencyMs: null,
    protocol: emptyWebSocketProtocol(),
  };
}

function emptyWebSocketProtocol(): ApiPythonBackendRuntimeSmokeReport["websocket"]["protocol"] {
  return {
    websocketPath: realtimeVoiceProtocol.websocketPath,
    codec: realtimeVoiceProtocol.codec,
    clientControlFrameTypesSent: [],
    serverEventTypesObserved: [],
    backendProtocolObserved: false,
    latencyFieldsObserved: false,
    canonicalProtocolObserved: false,
  };
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
