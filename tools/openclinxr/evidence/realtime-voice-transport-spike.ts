import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createOpenClinXrApiProtocolPosture, type OpenClinXrApiProtocolPosture } from "../../../apps/api/src/index.js";
import {
  runRealtimeVoiceProxyHarness,
  startPythonCompatibleVoiceBackendFixture,
  startRealtimeVoiceGatewayServer,
} from "../../../apps/arena/mock-realtime-voice-server/src/index.js";
import { realtimeVoiceProtocol } from "../../../packages/openclinxr/voice-gateway/src/index.js";
import { globFiles, readJson, writeJson } from "../../agent-factory/lib.js";
import type { LocalQwenTtsRuntimeSmokeReport } from "./local-qwen-tts-runtime-smoke.js";

const execFileAsync = promisify(execFile);

type CliOptions = {
  outputPath?: string;
  apiPythonBackendRuntimeSmokePath?: string;
  apiBunWebSocketRuntimeSmokePath?: string;
  apiBunPythonProxyRuntimeSmokePath?: string;
  localQwenTtsRuntimeSmokePath?: string;
  validatePath?: string;
  validateLatest: boolean;
};

type ApiBunWebSocketRuntimeSmokeEvidence = {
  status: string;
  policy?: {
    http3Enabled?: boolean;
  };
  bun?: {
    executable?: string;
    version?: string;
    revision?: string;
  };
  runtime?: {
    h3?: {
      enabled?: boolean;
      h3TrueEnabled?: boolean;
      optionPresentInServerSource?: boolean;
      outOfScopeForThisSmoke?: boolean;
    };
  };
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
  policy?: {
    http3Enabled?: boolean;
  };
  bun?: {
    executable?: string;
    version?: string;
    revision?: string;
  };
  runtime?: {
    h3?: {
      enabled?: boolean;
      h3TrueEnabled?: boolean;
      optionPresentInServerSource?: boolean;
      outOfScopeForThisSmoke?: boolean;
    };
  };
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
  appPath: "apps/arena/ui-quest-voice-godot";
  sourceContractObserved: boolean;
  godotRuntimeAvailable: boolean;
  dependencyFreeSidecar: boolean;
  websocketPeerObserved: boolean;
  audioMetadataObserved: boolean;
  opaqueBinaryPacketProbeObserved: boolean;
  productionAudioClaims: boolean;
  blockers: string[];
};

type ApiBunRuntimeEvidenceSource = "api-bun-websocket-runtime-smoke" | "api-bun-python-proxy-runtime-smoke";

type ApiBunRuntimeEvidence = {
  sources: ApiBunRuntimeEvidenceSource[];
  executable: string | null;
  version: string | null;
  revision: string | null;
  http3Enabled: boolean;
  h3TrueEnabled: boolean;
  optionPresentInServerSource: boolean;
  outOfScopeForThisSmoke: boolean;
};

type LocalQwenTtsRuntimeSmokeSummary = {
  status: "passed" | "blocked";
  modelId: string;
  claimScope: string;
  realTimeFactor: number | null;
  audioDurationMs: number;
  wallClockMs: number | null;
  readyForLiveDialog: false;
  blockers: string[];
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

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
      verifiedLocalFallback: "apps/arena/mock-realtime-voice-server node+hono+ws";
      websocketPath: "/voice/realtime/ws";
    };
    pythonBackend: {
      appPath: "apps/arena/api-python-backend";
      target: "fastapi-uvicorn-websocket";
      websocketPath: "/voice/realtime/ws";
    };
    inferenceCandidates: Array<{
      id: "moshi-mlx" | "qwen3-tts";
      fit: string;
      executionObserved: boolean;
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
    command: "python3 apps/arena/api-python-backend/scripts/verify_backend.py";
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
  localQwenTtsRuntimeSmoke?: LocalQwenTtsRuntimeSmokeSummary;
  apiBunRuntimeEvidence?: ApiBunRuntimeEvidence;
  questClientSourceContract: QuestClientSourceContractEvidence;
  harness: Awaited<ReturnType<typeof runRealtimeVoiceProxyHarness>>;
  verdict: {
    transportContractPassed: boolean;
    readyForLiveDialog: false;
    blockers: string[];
    caveats: string[];
  };
};

export async function main(args = process.argv.slice(2)): Promise<void> {
  await runRealtimeVoiceTransportSpikeCli(args);
}

export async function runRealtimeVoiceTransportSpikeCli(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestRealtimeVoiceTransportSpikePath();
    const validation = validateRealtimeVoiceTransportSpikeReport(await readJson<unknown>(validatePath));
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

  const apiPythonBackendRuntimeSmoke = options.apiPythonBackendRuntimeSmokePath
    ? await readJson<ApiPythonBackendRuntimeSmokeEvidence>(options.apiPythonBackendRuntimeSmokePath)
    : undefined;
  const apiBunWebSocketRuntimeSmoke = options.apiBunWebSocketRuntimeSmokePath
    ? await readJson<ApiBunWebSocketRuntimeSmokeEvidence>(options.apiBunWebSocketRuntimeSmokePath)
    : undefined;
  const apiBunPythonProxyRuntimeSmoke = options.apiBunPythonProxyRuntimeSmokePath
    ? await readJson<ApiBunPythonProxyRuntimeSmokeEvidence>(options.apiBunPythonProxyRuntimeSmokePath)
    : undefined;
  const localQwenTtsRuntimeSmoke = options.localQwenTtsRuntimeSmokePath
    ? await readJson<LocalQwenTtsRuntimeSmokeReport>(options.localQwenTtsRuntimeSmokePath)
    : undefined;
  const report = await buildRealtimeVoiceTransportSpikeReport({
    apiPythonBackendRuntimeSmoke,
    apiBunWebSocketRuntimeSmoke,
    apiBunPythonProxyRuntimeSmoke,
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
  const options: CliOptions = { validateLatest: false };

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
    if (arg === "--local-qwen-tts-runtime-smoke") {
      options.localQwenTtsRuntimeSmokePath = requireValue(normalizedArgs, index, arg);
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

async function latestRealtimeVoiceTransportSpikePath(): Promise<string> {
  const files = await globFiles("docs/openclinxr/realtime-voice-transport-spike-*.json");
  const latest = files.sort().at(-1);
  if (!latest) {
    throw new Error("No realtime voice transport spike report found.");
  }
  return latest;
}

export function validateRealtimeVoiceTransportSpikeReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireString(value.generatedAt, "/generatedAt", errors);
  requireOneOf(value.status, ["transport_spike_passed", "blocked"], "/status", errors);

  requireRecord(value.policy, "/policy", errors);
  if (isRecord(value.policy)) {
    requireLiteral(value.policy.cloudApisUsed, false, "/policy/cloudApisUsed", errors);
    requireLiteral(value.policy.paidApisUsed, false, "/policy/paidApisUsed", errors);
    requireLiteral(value.policy.modelDownloadsPerformed, false, "/policy/modelDownloadsPerformed", errors);
    requireLiteral(value.policy.productionUseAllowed, false, "/policy/productionUseAllowed", errors);
  }

  validateArchitecture(value.architecture, errors);
  validateProtocolEvidence(value.protocolEvidence, errors);
  validatePythonBackendVerifier(value.pythonBackendVerifier, errors);
  if (value.pythonBackendRuntimeSmoke !== undefined) {
    validatePythonBackendRuntimeSmoke(value.pythonBackendRuntimeSmoke, errors);
  }
  if (value.apiBunWebSocketRuntimeSmoke !== undefined) {
    validateApiBunWebSocketRuntimeSmoke(value.apiBunWebSocketRuntimeSmoke, errors);
  }
  if (value.apiBunPythonProxyRuntimeSmoke !== undefined) {
    validateApiBunPythonProxyRuntimeSmoke(value.apiBunPythonProxyRuntimeSmoke, errors);
  }
  if (value.localQwenTtsRuntimeSmoke !== undefined) {
    validateLocalQwenTtsRuntimeSmokeSummary(value.localQwenTtsRuntimeSmoke, errors);
  }
  if (value.apiBunRuntimeEvidence !== undefined) {
    validateApiBunRuntimeEvidence(value.apiBunRuntimeEvidence, errors);
  }
  validateQuestClientSourceContract(value.questClientSourceContract, errors);
  validateHarness(value.harness, errors);
  validateRealtimeTransportVerdict(value.verdict, errors);
  validateRealtimeTransportConsistency(value, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateArchitecture(value: unknown, errors: string[]): void {
  requireRecord(value, "/architecture", errors);
  if (!isRecord(value)) {
    return;
  }

  requireRecord(value.questClient, "/architecture/questClient", errors);
  if (isRecord(value.questClient)) {
    requireLiteral(value.questClient.target, "quest3-godot", "/architecture/questClient/target", errors);
    requireLiteral(value.questClient.transport, "websocket-binary-frames", "/architecture/questClient/transport", errors);
    requireLiteral(value.questClient.codecContract, "opus-frame-contract", "/architecture/questClient/codecContract", errors);
    requireString(value.questClient.note, "/architecture/questClient/note", errors);
  }
  requireRecord(value.gateway, "/architecture/gateway", errors);
  if (isRecord(value.gateway)) {
    requireLiteral(value.gateway.target, "apps/api bun+hono", "/architecture/gateway/target", errors);
    requireLiteral(value.gateway.verifiedLocalFallback, "apps/arena/mock-realtime-voice-server node+hono+ws", "/architecture/gateway/verifiedLocalFallback", errors);
    requireLiteral(value.gateway.websocketPath, "/voice/realtime/ws", "/architecture/gateway/websocketPath", errors);
  }
  requireRecord(value.pythonBackend, "/architecture/pythonBackend", errors);
  if (isRecord(value.pythonBackend)) {
    requireLiteral(value.pythonBackend.appPath, "apps/arena/api-python-backend", "/architecture/pythonBackend/appPath", errors);
    requireLiteral(value.pythonBackend.target, "fastapi-uvicorn-websocket", "/architecture/pythonBackend/target", errors);
    requireLiteral(value.pythonBackend.websocketPath, "/voice/realtime/ws", "/architecture/pythonBackend/websocketPath", errors);
  }
  if (!Array.isArray(value.inferenceCandidates)) {
    errors.push("/architecture/inferenceCandidates must be array");
    return;
  }
  const candidateIds = new Set<string>();
  value.inferenceCandidates.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      errors.push(`/architecture/inferenceCandidates/${index} must be object`);
      return;
    }
    requireOneOf(candidate.id, ["moshi-mlx", "qwen3-tts"], `/architecture/inferenceCandidates/${index}/id`, errors);
    requireString(candidate.fit, `/architecture/inferenceCandidates/${index}/fit`, errors);
    requireBoolean(candidate.executionObserved, `/architecture/inferenceCandidates/${index}/executionObserved`, errors);
    if (typeof candidate.id === "string") {
      candidateIds.add(candidate.id);
    }
  });
  for (const id of ["moshi-mlx", "qwen3-tts"]) {
    if (!candidateIds.has(id)) {
      errors.push(`/architecture/inferenceCandidates missing ${id}`);
    }
  }
}

function validateProtocolEvidence(value: unknown, errors: string[]): void {
  requireRecord(value, "/protocolEvidence", errors);
  if (!isRecord(value)) {
    return;
  }

  requireLiteral(value.websocketLocalHarnessObserved, true, "/protocolEvidence/websocketLocalHarnessObserved", errors);
  requireBoolean(value.bunHonoRuntimeObserved, "/protocolEvidence/bunHonoRuntimeObserved", errors);
  requireLiteral(value.webTransportObserved, false, "/protocolEvidence/webTransportObserved", errors);
  requireLiteral(value.quicObserved, false, "/protocolEvidence/quicObserved", errors);
  requireLiteral(value.web3SignalingObserved, false, "/protocolEvidence/web3SignalingObserved", errors);
  requireStringArray(value.notes, "/protocolEvidence/notes", errors);
}

function validatePythonBackendVerifier(value: unknown, errors: string[]): void {
  requireRecord(value, "/pythonBackendVerifier", errors);
  if (!isRecord(value)) {
    return;
  }

  requireOneOf(value.status, ["passed", "blocked"], "/pythonBackendVerifier/status", errors);
  requireLiteral(value.command, "python3 apps/arena/api-python-backend/scripts/verify_backend.py", "/pythonBackendVerifier/command", errors);
  requireString(value.stdout, "/pythonBackendVerifier/stdout", errors);
  requireStringArray(value.blockers, "/pythonBackendVerifier/blockers", errors);
}

function validatePythonBackendRuntimeSmoke(value: unknown, errors: string[]): void {
  requireRecord(value, "/pythonBackendRuntimeSmoke", errors);
  if (!isRecord(value)) {
    return;
  }

  requireOneOf(value.status, ["passed", "blocked"], "/pythonBackendRuntimeSmoke/status", errors);
  requireStringArray(value.blockers, "/pythonBackendRuntimeSmoke/blockers", errors);
  requireBoolean(value.healthOk, "/pythonBackendRuntimeSmoke/healthOk", errors);
  requireBoolean(value.websocketConnected, "/pythonBackendRuntimeSmoke/websocketConnected", errors);
  requireNullableNumber(value.websocketLatencyMs, "/pythonBackendRuntimeSmoke/websocketLatencyMs", errors);
  requireRecord(value.protocolObserved, "/pythonBackendRuntimeSmoke/protocolObserved", errors);
  if (isRecord(value.protocolObserved)) {
    requireBoolean(value.protocolObserved.backendProtocolObserved, "/pythonBackendRuntimeSmoke/protocolObserved/backendProtocolObserved", errors);
    requireBoolean(value.protocolObserved.latencyFieldsObserved, "/pythonBackendRuntimeSmoke/protocolObserved/latencyFieldsObserved", errors);
    requireBoolean(value.protocolObserved.canonicalProtocolObserved, "/pythonBackendRuntimeSmoke/protocolObserved/canonicalProtocolObserved", errors);
  }
}

function validateApiBunWebSocketRuntimeSmoke(value: unknown, errors: string[]): void {
  requireRecord(value, "/apiBunWebSocketRuntimeSmoke", errors);
  if (!isRecord(value)) {
    return;
  }

  requireOneOf(value.status, ["passed", "blocked"], "/apiBunWebSocketRuntimeSmoke/status", errors);
  requireStringArray(value.blockers, "/apiBunWebSocketRuntimeSmoke/blockers", errors);
  for (const key of ["websocketConnected", "controlAckObserved", "audioMetadataObserved", "transcriptDeltaObserved", "binaryEchoObserved"]) {
    requireBoolean(value[key], `/apiBunWebSocketRuntimeSmoke/${key}`, errors);
  }
}

function validateApiBunPythonProxyRuntimeSmoke(value: unknown, errors: string[]): void {
  requireRecord(value, "/apiBunPythonProxyRuntimeSmoke", errors);
  if (!isRecord(value)) {
    return;
  }

  requireOneOf(value.status, ["passed", "blocked"], "/apiBunPythonProxyRuntimeSmoke/status", errors);
  requireStringArray(value.blockers, "/apiBunPythonProxyRuntimeSmoke/blockers", errors);
  for (const key of [
    "pythonBackendHealthOk",
    "bunGatewayHealthOk",
    "backendUrlConfigured",
    "websocketConnected",
    "backendReadyObserved",
    "backendProtocolObserved",
    "latencyFieldsObserved",
    "binaryEchoObserved",
  ]) {
    requireBoolean(value[key], `/apiBunPythonProxyRuntimeSmoke/${key}`, errors);
  }
  requireStringArray(value.eventTypesObserved, "/apiBunPythonProxyRuntimeSmoke/eventTypesObserved", errors);
}

function validateLocalQwenTtsRuntimeSmokeSummary(value: unknown, errors: string[]): void {
  requireRecord(value, "/localQwenTtsRuntimeSmoke", errors);
  if (!isRecord(value)) {
    return;
  }

  requireOneOf(value.status, ["passed", "blocked"], "/localQwenTtsRuntimeSmoke/status", errors);
  requireLiteral(value.modelId, "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit", "/localQwenTtsRuntimeSmoke/modelId", errors);
  requireLiteral(value.claimScope, "local_tts_inference_only", "/localQwenTtsRuntimeSmoke/claimScope", errors);
  requireNullableNumber(value.realTimeFactor, "/localQwenTtsRuntimeSmoke/realTimeFactor", errors);
  requireNumber(value.audioDurationMs, "/localQwenTtsRuntimeSmoke/audioDurationMs", errors);
  requireNullableNumber(value.wallClockMs, "/localQwenTtsRuntimeSmoke/wallClockMs", errors);
  requireLiteral(value.readyForLiveDialog, false, "/localQwenTtsRuntimeSmoke/readyForLiveDialog", errors);
  requireStringArray(value.blockers, "/localQwenTtsRuntimeSmoke/blockers", errors);
}

function validateApiBunRuntimeEvidence(value: unknown, errors: string[]): void {
  requireRecord(value, "/apiBunRuntimeEvidence", errors);
  if (!isRecord(value)) {
    return;
  }

  requireStringArray(value.sources, "/apiBunRuntimeEvidence/sources", errors);
  requireNullableString(value.executable, "/apiBunRuntimeEvidence/executable", errors);
  requireNullableString(value.version, "/apiBunRuntimeEvidence/version", errors);
  requireNullableString(value.revision, "/apiBunRuntimeEvidence/revision", errors);
  requireLiteral(value.http3Enabled, false, "/apiBunRuntimeEvidence/http3Enabled", errors);
  requireLiteral(value.h3TrueEnabled, false, "/apiBunRuntimeEvidence/h3TrueEnabled", errors);
  requireLiteral(value.optionPresentInServerSource, false, "/apiBunRuntimeEvidence/optionPresentInServerSource", errors);
  requireLiteral(value.outOfScopeForThisSmoke, true, "/apiBunRuntimeEvidence/outOfScopeForThisSmoke", errors);
}

function validateQuestClientSourceContract(value: unknown, errors: string[]): void {
  requireRecord(value, "/questClientSourceContract", errors);
  if (!isRecord(value)) {
    return;
  }

  requireOneOf(value.status, ["source_contract_observed", "blocked"], "/questClientSourceContract/status", errors);
  requireLiteral(value.appPath, "apps/arena/ui-quest-voice-godot", "/questClientSourceContract/appPath", errors);
  for (const key of [
    "sourceContractObserved",
    "godotRuntimeAvailable",
    "dependencyFreeSidecar",
    "websocketPeerObserved",
    "audioMetadataObserved",
    "opaqueBinaryPacketProbeObserved",
    "productionAudioClaims",
  ]) {
    requireBoolean(value[key], `/questClientSourceContract/${key}`, errors);
  }
  if (value.productionAudioClaims === true) {
    errors.push("/questClientSourceContract/productionAudioClaims must remain false");
  }
  requireStringArray(value.blockers, "/questClientSourceContract/blockers", errors);
}

function validateHarness(value: unknown, errors: string[]): void {
  requireRecord(value, "/harness", errors);
  if (!isRecord(value)) {
    return;
  }

  for (const key of [
    "controlFramesSent",
    "audioMetadataFramesSent",
    "binaryAudioChunksSent",
    "transcriptEventsReceived",
    "audioChunkMetadataReceived",
    "binaryAudioChunksReceived",
  ]) {
    requireNumber(value[key], `/harness/${key}`, errors);
  }
  requireBoolean(value.latencyFieldsObserved, "/harness/latencyFieldsObserved", errors);
  requireLiteral(value.backendProtocol, "python-fastapi-compatible-websocket", "/harness/backendProtocol", errors);
  requireLiteral(value.codec, "opus", "/harness/codec", errors);
  requireNumber(value.roundTripLatencyMs, "/harness/roundTripLatencyMs", errors);
  if (!Array.isArray(value.frameLatencySamplesMs)) {
    errors.push("/harness/frameLatencySamplesMs must be array");
  }
  requireStringArray(value.receivedEventTypes, "/harness/receivedEventTypes", errors);
  requireRecord(value.latencyBudget, "/harness/latencyBudget", errors);
  if (isRecord(value.latencyBudget)) {
    requireNumber(value.latencyBudget.targetMs, "/harness/latencyBudget/targetMs", errors);
    requireBoolean(value.latencyBudget.passed, "/harness/latencyBudget/passed", errors);
  }
}

function validateRealtimeTransportVerdict(value: unknown, errors: string[]): void {
  requireRecord(value, "/verdict", errors);
  if (!isRecord(value)) {
    return;
  }

  requireBoolean(value.transportContractPassed, "/verdict/transportContractPassed", errors);
  requireLiteral(value.readyForLiveDialog, false, "/verdict/readyForLiveDialog", errors);
  requireStringArray(value.blockers, "/verdict/blockers", errors);
  requireStringArray(value.caveats, "/verdict/caveats", errors);
}

function validateRealtimeTransportConsistency(value: Record<string, unknown>, errors: string[]): void {
  const verdict = isRecord(value.verdict) ? value.verdict : undefined;
  if (!verdict) {
    return;
  }

  if (verdict.transportContractPassed === true && value.status !== "transport_spike_passed") {
    errors.push("/status must be transport_spike_passed when /verdict/transportContractPassed is true");
  }
  if (verdict.transportContractPassed === false && value.status !== "blocked") {
    errors.push("/status must be blocked when /verdict/transportContractPassed is false");
  }

  const actualBlockers = new Set(stringArray(verdict.blockers));
  for (const blocker of expectedRealtimeTransportBlockers(value)) {
    if (!actualBlockers.has(blocker)) {
      errors.push(`/verdict/blockers missing expected blocker ${blocker}`);
    }
  }
}

function expectedRealtimeTransportBlockers(value: Record<string, unknown>): string[] {
  const localQwenTtsRuntimeSmoke = isRecord(value.localQwenTtsRuntimeSmoke) ? value.localQwenTtsRuntimeSmoke : undefined;
  const questClientSourceContract = isRecord(value.questClientSourceContract) ? value.questClientSourceContract : undefined;
  const qwenTtsObserved = localQwenTtsRuntimeSmoke?.status === "passed";

  return [
    questClientSourceContract?.godotRuntimeAvailable === true ? undefined : "quest_godot_client_not_executed",
    "native_opus_codec_not_integrated_in_godot",
    qwenTtsObserved ? "qwen3_tts_not_full_duplex_dialog" : "real_moshi_or_qwen3_inference_not_observed",
    qwenTtsObserved ? "full_duplex_asr_dialog_model_not_observed" : undefined,
    "quest_microphone_and_playback_latency_not_measured",
    "clinical_voice_safety_controls_not_exercised_with_real_model",
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

export async function buildRealtimeVoiceTransportSpikeReport(input: {
  generatedAt?: string;
  targetLatencyMs?: number;
  bunAvailable?: boolean;
  godotAvailable?: boolean;
  apiPythonBackendRuntimeSmoke?: ApiPythonBackendRuntimeSmokeEvidence;
  apiBunWebSocketRuntimeSmoke?: ApiBunWebSocketRuntimeSmokeEvidence;
  apiBunPythonProxyRuntimeSmoke?: ApiBunPythonProxyRuntimeSmokeEvidence;
  localQwenTtsRuntimeSmoke?: LocalQwenTtsRuntimeSmokeReport;
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
  const localQwenTtsRuntimeSmoke = input.localQwenTtsRuntimeSmoke
    ? summarizeLocalQwenTtsRuntimeSmoke(input.localQwenTtsRuntimeSmoke)
    : undefined;
  const apiBunRuntimeEvidence = buildApiBunRuntimeEvidence({
    apiBunWebSocketRuntimeSmoke: input.apiBunWebSocketRuntimeSmoke,
    apiBunPythonProxyRuntimeSmoke: input.apiBunPythonProxyRuntimeSmoke,
  });
  const suppliedRuntimeSmokePassed = pythonBackendRuntimeSmoke ? pythonBackendRuntimeSmoke.status === "passed" : true;
  const suppliedBunRuntimeSmokePassed = apiBunWebSocketRuntimeSmoke ? apiBunWebSocketRuntimeSmoke.status === "passed" : false;
  const suppliedBunPythonProxySmokePassed = apiBunPythonProxyRuntimeSmoke ? apiBunPythonProxyRuntimeSmoke.status === "passed" : false;
  const bunRuntimeObserved = bunAvailable || suppliedBunRuntimeSmokePassed || suppliedBunPythonProxySmokePassed;
  const backendRuntimeObserved = pythonBackendRuntimeSmoke?.status === "passed" || suppliedBunPythonProxySmokePassed;
  const suppliedBunPythonProxySmokeHealthy = apiBunPythonProxyRuntimeSmoke ? suppliedBunPythonProxySmokePassed : true;
  const qwenTtsInferenceObserved = localQwenTtsRuntimeSmoke?.status === "passed";
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
    qwenTtsInferenceObserved ? undefined : "real_moshi_or_qwen3_inference_not_observed",
    qwenTtsInferenceObserved ? "qwen3_tts_not_full_duplex_dialog" : undefined,
    qwenTtsInferenceObserved ? "full_duplex_asr_dialog_model_not_observed" : undefined,
    ...(localQwenTtsRuntimeSmoke?.blockers ?? []).map((blocker) => `qwen3_tts:${blocker}`),
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
        verifiedLocalFallback: "apps/arena/mock-realtime-voice-server node+hono+ws",
        websocketPath: "/voice/realtime/ws",
      },
      pythonBackend: {
        appPath: "apps/arena/api-python-backend",
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
          executionObserved: qwenTtsInferenceObserved,
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
    ...(localQwenTtsRuntimeSmoke ? { localQwenTtsRuntimeSmoke } : {}),
    ...(apiBunRuntimeEvidence ? { apiBunRuntimeEvidence } : {}),
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
        qwenTtsInferenceObserved
          ? "Qwen3-TTS local inference was observed for outbound file generation only; full-duplex ASR/dialog, interruption, and Quest microphone/playback evidence remain blocked."
          : "No real Moshi or Qwen voice inference was observed by this transport spike.",
      ],
    },
  };
}

function buildQuestClientSourceContract(input: {
  godotRuntimeAvailable: boolean;
}): QuestClientSourceContractEvidence {
  const appPath = "apps/arena/ui-quest-voice-godot" as const;
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

function summarizeLocalQwenTtsRuntimeSmoke(
  report: LocalQwenTtsRuntimeSmokeReport,
): LocalQwenTtsRuntimeSmokeSummary {
  const blockers = [
    report.kind === "local_qwen_tts_runtime_smoke" ? undefined : "invalid_local_qwen_tts_runtime_smoke_kind",
    report.claim_scope === "local_tts_inference_only" ? undefined : "invalid_local_qwen_tts_claim_scope",
    report.runtime.modelId === "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit" ? undefined : "unexpected_qwen_tts_model_id",
    report.policy.cloudApisUsed ? "qwen_tts_smoke_cloud_apis_used" : undefined,
    report.policy.paidApisUsed ? "qwen_tts_smoke_paid_apis_used" : undefined,
    report.policy.generatedAudioCommitted ? "qwen_tts_generated_audio_committed" : undefined,
    report.policy.productionUseAllowed ? "qwen_tts_production_use_allowed" : undefined,
    report.policy.fullDuplexClaimAllowed ? "qwen_tts_full_duplex_claim_allowed" : undefined,
    report.verdict.passed ? undefined : "qwen_tts_runtime_smoke_failed",
    ...report.verdict.blockers,
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    status: blockers.length === 0 ? "passed" : "blocked",
    modelId: report.runtime.modelId,
    claimScope: report.claim_scope,
    realTimeFactor: report.metrics.realTimeFactor,
    audioDurationMs: report.audio.durationMs,
    wallClockMs: report.metrics.wallClockMs,
    readyForLiveDialog: false,
    blockers,
  };
}

function buildApiBunRuntimeEvidence(input: {
  apiBunWebSocketRuntimeSmoke?: ApiBunWebSocketRuntimeSmokeEvidence;
  apiBunPythonProxyRuntimeSmoke?: ApiBunPythonProxyRuntimeSmokeEvidence;
}): ApiBunRuntimeEvidence | undefined {
  const sources: ApiBunRuntimeEvidenceSource[] = [];
  const candidates: Array<{
    source: ApiBunRuntimeEvidenceSource;
    smoke: ApiBunWebSocketRuntimeSmokeEvidence | ApiBunPythonProxyRuntimeSmokeEvidence;
  }> = [];

  if (input.apiBunWebSocketRuntimeSmoke) {
    candidates.push({
      source: "api-bun-websocket-runtime-smoke",
      smoke: input.apiBunWebSocketRuntimeSmoke,
    });
  }
  if (input.apiBunPythonProxyRuntimeSmoke) {
    candidates.push({
      source: "api-bun-python-proxy-runtime-smoke",
      smoke: input.apiBunPythonProxyRuntimeSmoke,
    });
  }

  if (candidates.length === 0) {
    return undefined;
  }

  for (const candidate of candidates) {
    sources.push(candidate.source);
  }

  return {
    sources,
    executable: firstString(candidates.map((candidate) => candidate.smoke.bun?.executable)),
    version: firstString(candidates.map((candidate) => candidate.smoke.bun?.version)),
    revision: firstString(candidates.map((candidate) => candidate.smoke.bun?.revision)),
    http3Enabled: candidates.some((candidate) => candidate.smoke.policy?.http3Enabled === true),
    h3TrueEnabled: candidates.some((candidate) => candidate.smoke.runtime?.h3?.h3TrueEnabled === true),
    optionPresentInServerSource: candidates.some((candidate) => candidate.smoke.runtime?.h3?.optionPresentInServerSource === true),
    outOfScopeForThisSmoke: candidates.every((candidate) => candidate.smoke.runtime?.h3?.outOfScopeForThisSmoke !== false),
  };
}

function firstString(values: Array<string | undefined>): string | null {
  return values.find((value): value is string => typeof value === "string" && value.length > 0) ?? null;
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
  const command = "python3 apps/arena/api-python-backend/scripts/verify_backend.py";
  try {
    const { stdout } = await execFileAsync("python3", ["apps/arena/api-python-backend/scripts/verify_backend.py"]);
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
