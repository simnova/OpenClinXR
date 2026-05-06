import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { globFiles, readJson, writeJson } from "../agent-factory/lib.js";
import { type LocalRealtimeVoiceModelCacheEvidenceReport } from "./local-realtime-voice-model-cache-evidence.js";

type CliOptions = {
  validatePath?: string;
  validateLatest: boolean;
  logPath?: string;
  promptPath?: string;
  audioPath?: string;
  modelCacheEvidencePath?: string;
  generatedAt?: string;
  outputPath?: string;
};

type WavMetadata = {
  codec: "pcm_s16le";
  sampleRateHz: number;
  channels: number;
  durationMs: number;
  sizeBytes: number;
  bitRate: number;
};

export type LocalQwenTtsRuntimeSmokeReport = {
  kind: "local_qwen_tts_runtime_smoke";
  claim_scope: "local_tts_inference_only";
  generatedAt: string;
  status: "passed_with_caveats" | "blocked";
  policy: {
    cloudApisUsed: false;
    paidApisUsed: false;
    productionUseAllowed: false;
    generatedAudioCommitted: false;
    fullDuplexClaimAllowed: false;
    clinicalValidityClaimAllowed: false;
    runtimeExecutionObserved: boolean;
    downloadAttemptedByThisTool: false;
    networkAccessObservedByThisTool: false;
  };
  runtime: {
    modelId: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit";
    modelLicense: "Apache-2.0";
    sourceRecordIds: ["src-qwen3-tts-mlx-4bit-2026", "src-mlx-audio-pypi-2026"];
    tool: "mlx-audio";
    toolVersion: string | null;
    toolLicense: "MIT";
    pythonVersion: string | null;
    exitStatus: number | null;
    command: string | null;
  };
  input: {
    text: string;
    textLength: number;
    referenceAudioUsed: boolean;
  };
  audio: WavMetadata & {
    outputPath: string;
    sha256: string;
  };
  metrics: {
    wallClockMs: number | null;
    audioDurationMs: number;
    realTimeFactor: number | null;
    maxResidentSetBytes: number | null;
    approxFirstAudiblePlaybackLatencyMs: null;
  };
  modelCache: {
    evidenceKind: string | null;
    evidenceGeneratedAt: string | null;
    cacheDir: string | null;
    ready: boolean;
    readyModelObserved: boolean;
    readyModelIds: string[];
    blockers: string[];
  };
  verdict: {
    passed: boolean;
    readyForLiveDialog: false;
    blockers: string[];
    caveats: string[];
  };
};

type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.validatePath || options.validateLatest) {
    const validatePath = options.validatePath ?? await latestQwenTtsSmokePath();
    if (!validatePath) {
      throw new Error("Missing local Qwen TTS runtime smoke report to validate.");
    }
    const validation = validateLocalQwenTtsRuntimeSmokeReport(await readJson<unknown>(validatePath));
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

  if (!options.logPath || !options.promptPath || !options.audioPath) {
    throw new Error("Missing --log, --prompt, or --audio. This tool harvests existing local Qwen TTS files only and does not execute inference.");
  }
  const [logContent, promptText, audioBytes, modelCacheEvidence] = await Promise.all([
    readFile(options.logPath, "utf8"),
    readFile(options.promptPath, "utf8"),
    readFile(options.audioPath),
    options.modelCacheEvidencePath
      ? readJson<LocalRealtimeVoiceModelCacheEvidenceReport>(options.modelCacheEvidencePath)
      : Promise.resolve(undefined),
  ]);
  const report = buildLocalQwenTtsRuntimeSmokeReport({
    generatedAt: options.generatedAt,
    logPath: options.logPath,
    logContent,
    audioPath: options.audioPath,
    audioBytes,
    promptText,
    modelCacheEvidence,
  });

  if (options.outputPath) {
    await writeJson(options.outputPath, report);
    console.log(`Wrote ${options.outputPath}`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

export function buildLocalQwenTtsRuntimeSmokeReport(input: {
  generatedAt?: string;
  logPath: string;
  logContent: string;
  audioPath: string;
  audioBytes: Buffer;
  promptText: string;
  modelCacheEvidence?: LocalRealtimeVoiceModelCacheEvidenceReport;
}): LocalQwenTtsRuntimeSmokeReport {
  const parsed = parseQwenTtsRuntimeLog(input.logContent);
  const audio = parsePcmWavMetadata(input.audioBytes);
  const modelCache = inspectModelCache(input.modelCacheEvidence);
  const blockers = [
    parsed.exitStatus === null ? "runtime_exit_status_missing" : undefined,
    parsed.exitStatus !== null && parsed.exitStatus !== 0 ? `runtime_exit_status_${parsed.exitStatus}` : undefined,
    audio.durationMs > 0 ? undefined : "audio_duration_missing",
    ...modelCache.blockers.map((blocker) => `model_cache:${blocker}`),
  ].filter((blocker): blocker is string => typeof blocker === "string");
  const passed = blockers.length === 0;

  return {
    kind: "local_qwen_tts_runtime_smoke",
    claim_scope: "local_tts_inference_only",
    generatedAt: input.generatedAt ?? parsed.endedAt ?? new Date().toISOString(),
    status: passed ? "passed_with_caveats" : "blocked",
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      productionUseAllowed: false,
      generatedAudioCommitted: false,
      fullDuplexClaimAllowed: false,
      clinicalValidityClaimAllowed: false,
      runtimeExecutionObserved: parsed.exitStatus === 0,
      downloadAttemptedByThisTool: false,
      networkAccessObservedByThisTool: false,
    },
    runtime: {
      modelId: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
      modelLicense: "Apache-2.0",
      sourceRecordIds: ["src-qwen3-tts-mlx-4bit-2026", "src-mlx-audio-pypi-2026"],
      tool: "mlx-audio",
      toolVersion: parsed.mlxAudioVersion,
      toolLicense: "MIT",
      pythonVersion: parsed.pythonVersion,
      exitStatus: parsed.exitStatus,
      command: parsed.command,
    },
    input: {
      text: input.promptText,
      textLength: input.promptText.length,
      referenceAudioUsed: parsed.referenceAudioUsed,
    },
    audio: {
      outputPath: input.audioPath,
      sha256: sha256(input.audioBytes),
      ...audio,
    },
    metrics: {
      wallClockMs: parsed.wallClockSeconds === null ? null : Math.round(parsed.wallClockSeconds * 1000),
      audioDurationMs: audio.durationMs,
      realTimeFactor: parsed.wallClockSeconds === null
        ? null
        : Math.round((parsed.wallClockSeconds / (audio.durationMs / 1000)) * 100) / 100,
      maxResidentSetBytes: parsed.maxResidentSetBytes,
      approxFirstAudiblePlaybackLatencyMs: null,
    },
    modelCache,
    verdict: {
      passed,
      readyForLiveDialog: false,
      blockers,
      caveats: [
        "This is local outbound TTS file-generation evidence only; it is not full-duplex ASR/dialog evidence.",
        "Qwen3-TTS does not satisfy the learner interruption, microphone capture, or agent-to-agent realtime loop by itself.",
        "Generated audio remains local-only and must not be committed as clinical or production voice evidence.",
      ],
    },
  };
}

export function validateLocalQwenTtsRuntimeSmokeReport(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["/ must be object"] };
  }

  requireLiteral(value.kind, "local_qwen_tts_runtime_smoke", "/kind", errors);
  requireLiteral(value.claim_scope, "local_tts_inference_only", "/claim_scope", errors);
  requireString(value.generatedAt, "/generatedAt", errors);
  requireOneOf(value.status, ["passed_with_caveats", "blocked"], "/status", errors);
  requireRecord(value.policy, "/policy", errors);
  if (isRecord(value.policy)) {
    requireLiteral(value.policy.cloudApisUsed, false, "/policy/cloudApisUsed", errors);
    requireLiteral(value.policy.paidApisUsed, false, "/policy/paidApisUsed", errors);
    requireLiteral(value.policy.productionUseAllowed, false, "/policy/productionUseAllowed", errors);
    requireLiteral(value.policy.generatedAudioCommitted, false, "/policy/generatedAudioCommitted", errors);
    requireLiteral(value.policy.fullDuplexClaimAllowed, false, "/policy/fullDuplexClaimAllowed", errors);
    requireLiteral(value.policy.clinicalValidityClaimAllowed, false, "/policy/clinicalValidityClaimAllowed", errors);
    requireBoolean(value.policy.runtimeExecutionObserved, "/policy/runtimeExecutionObserved", errors);
    requireLiteral(value.policy.downloadAttemptedByThisTool, false, "/policy/downloadAttemptedByThisTool", errors);
    requireLiteral(value.policy.networkAccessObservedByThisTool, false, "/policy/networkAccessObservedByThisTool", errors);
  }
  validateRuntime(value.runtime, errors);
  requireRecord(value.input, "/input", errors);
  if (isRecord(value.input)) {
    requireString(value.input.text, "/input/text", errors);
    requireNumber(value.input.textLength, "/input/textLength", errors);
    requireBoolean(value.input.referenceAudioUsed, "/input/referenceAudioUsed", errors);
  }
  validateAudio(value.audio, errors);
  validateMetrics(value.metrics, errors);
  validateModelCache(value.modelCache, errors);
  requireRecord(value.verdict, "/verdict", errors);
  if (isRecord(value.verdict)) {
    requireBoolean(value.verdict.passed, "/verdict/passed", errors);
    requireLiteral(value.verdict.readyForLiveDialog, false, "/verdict/readyForLiveDialog", errors);
    requireStringArray(value.verdict.blockers, "/verdict/blockers", errors);
    requireStringArray(value.verdict.caveats, "/verdict/caveats", errors);
  }
  validateConsistency(value, errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateRuntime(value: unknown, errors: string[]): void {
  requireRecord(value, "/runtime", errors);
  if (!isRecord(value)) {
    return;
  }

  requireLiteral(value.modelId, "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit", "/runtime/modelId", errors);
  requireLiteral(value.modelLicense, "Apache-2.0", "/runtime/modelLicense", errors);
  requireStringArray(value.sourceRecordIds, "/runtime/sourceRecordIds", errors);
  requireLiteral(value.tool, "mlx-audio", "/runtime/tool", errors);
  requireNullableString(value.toolVersion, "/runtime/toolVersion", errors);
  requireLiteral(value.toolLicense, "MIT", "/runtime/toolLicense", errors);
  requireNullableString(value.pythonVersion, "/runtime/pythonVersion", errors);
  requireNullableNumber(value.exitStatus, "/runtime/exitStatus", errors);
  requireNullableString(value.command, "/runtime/command", errors);
}

function validateAudio(value: unknown, errors: string[]): void {
  requireRecord(value, "/audio", errors);
  if (!isRecord(value)) {
    return;
  }

  requireString(value.outputPath, "/audio/outputPath", errors);
  requireSha256(value.sha256, "/audio/sha256", errors);
  requireLiteral(value.codec, "pcm_s16le", "/audio/codec", errors);
  requireNumber(value.sampleRateHz, "/audio/sampleRateHz", errors);
  requireNumber(value.channels, "/audio/channels", errors);
  requireNumber(value.durationMs, "/audio/durationMs", errors);
  requireNumber(value.sizeBytes, "/audio/sizeBytes", errors);
  requireNumber(value.bitRate, "/audio/bitRate", errors);
}

function validateMetrics(value: unknown, errors: string[]): void {
  requireRecord(value, "/metrics", errors);
  if (!isRecord(value)) {
    return;
  }

  requireNullableNumber(value.wallClockMs, "/metrics/wallClockMs", errors);
  requireNumber(value.audioDurationMs, "/metrics/audioDurationMs", errors);
  requireNullableNumber(value.realTimeFactor, "/metrics/realTimeFactor", errors);
  requireNullableNumber(value.maxResidentSetBytes, "/metrics/maxResidentSetBytes", errors);
  requireLiteral(value.approxFirstAudiblePlaybackLatencyMs, null, "/metrics/approxFirstAudiblePlaybackLatencyMs", errors);
}

function validateModelCache(value: unknown, errors: string[]): void {
  requireRecord(value, "/modelCache", errors);
  if (!isRecord(value)) {
    return;
  }

  requireNullableString(value.evidenceKind, "/modelCache/evidenceKind", errors);
  requireNullableString(value.evidenceGeneratedAt, "/modelCache/evidenceGeneratedAt", errors);
  requireNullableString(value.cacheDir, "/modelCache/cacheDir", errors);
  requireBoolean(value.ready, "/modelCache/ready", errors);
  requireBoolean(value.readyModelObserved, "/modelCache/readyModelObserved", errors);
  requireStringArray(value.readyModelIds, "/modelCache/readyModelIds", errors);
  requireStringArray(value.blockers, "/modelCache/blockers", errors);
}

function validateConsistency(value: Record<string, unknown>, errors: string[]): void {
  if (isRecord(value.input) && typeof value.input.text === "string" && typeof value.input.textLength === "number" && value.input.textLength !== value.input.text.length) {
    errors.push("/input/textLength must match /input/text length");
  }
  if (isRecord(value.audio) && isRecord(value.metrics)) {
    const audioDurationMs = numberOrNull(value.audio.durationMs);
    const metricAudioDurationMs = numberOrNull(value.metrics.audioDurationMs);
    if (audioDurationMs !== null && metricAudioDurationMs !== null && audioDurationMs !== metricAudioDurationMs) {
      errors.push("/metrics/audioDurationMs must match /audio/durationMs");
    }
  }
  if (isRecord(value.verdict)) {
    const expectedBlockers = expectedBlockersFor(value);
    if (Array.isArray(value.verdict.blockers)) {
      const verdictBlockers = new Set(value.verdict.blockers);
      for (const blocker of expectedBlockers) {
        if (!verdictBlockers.has(blocker)) {
          errors.push(`/verdict/blockers must include ${blocker}`);
        }
      }
    }
    const verdictPassed = value.verdict.passed;
    if (typeof verdictPassed === "boolean" && Array.isArray(value.verdict.blockers) && verdictPassed !== (value.verdict.blockers.length === 0)) {
      errors.push("/verdict/passed must match whether verdict blockers are empty");
    }
  }
}

function expectedBlockersFor(value: Record<string, unknown>): string[] {
  const runtime = isRecord(value.runtime) ? value.runtime : {};
  const audio = isRecord(value.audio) ? value.audio : {};
  const modelCache = isRecord(value.modelCache) ? value.modelCache : {};

  return [
    runtime.exitStatus === null ? "runtime_exit_status_missing" : undefined,
    typeof runtime.exitStatus === "number" && runtime.exitStatus !== 0 ? `runtime_exit_status_${runtime.exitStatus}` : undefined,
    numberOrNull(audio.durationMs) !== null && numberOrNull(audio.durationMs)! > 0 ? undefined : "audio_duration_missing",
    ...stringArray(modelCache.blockers).map((blocker) => `model_cache:${blocker}`),
  ].filter((blocker): blocker is string => typeof blocker === "string");
}

function parseQwenTtsRuntimeLog(content: string): {
  endedAt: string | null;
  exitStatus: number | null;
  command: string | null;
  mlxAudioVersion: string | null;
  pythonVersion: string | null;
  wallClockSeconds: number | null;
  maxResidentSetBytes: number | null;
  referenceAudioUsed: boolean;
} {
  const command = stringMatch(content, /^command=(.+)$/m);
  return {
    endedAt: stringMatch(content, /ended_at_utc=([^\s]+)/),
    exitStatus: parseNumberMatch(content, /exit_status=(\d+)/),
    command,
    mlxAudioVersion: stringMatch(content, /mlx_audio_version[=:]\s*"?([^",\n]+)"?/),
    pythonVersion: stringMatch(content, /python_version[=:]\s*"?([^",\n]+)"?/),
    wallClockSeconds: parseNumberMatch(content, /^real\s+([\d.]+)$/m)
      ?? parseNumberMatch(content, /^\s*([\d.]+)\s+real\b/m),
    maxResidentSetBytes: parseNumberMatch(content, /(\d+)\s+maximum resident set size/),
    referenceAudioUsed: Boolean(command?.includes("--ref-audio") || command?.includes("ref_audio=")),
  };
}

function inspectModelCache(
  evidence: LocalRealtimeVoiceModelCacheEvidenceReport | undefined,
): LocalQwenTtsRuntimeSmokeReport["modelCache"] {
  if (!evidence) {
    return {
      evidenceKind: null,
      evidenceGeneratedAt: null,
      cacheDir: null,
      ready: false,
      readyModelObserved: false,
      readyModelIds: [],
      blockers: ["missing_local_realtime_voice_model_cache_evidence_report"],
    };
  }

  const qwenModelId = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit";
  const qwenModel = evidence.models.find((model) => model.model_id === qwenModelId);
  const readyModelObserved = Boolean(qwenModel?.ready && qwenModel.approved === true);
  const readyModelIds = evidence.models
    .filter((model) => model.ready && model.approved === true)
    .map((model) => model.model_id);
  const blockers = [
    evidence.kind === "local_voice_evidence_check" ? undefined : "invalid_local_realtime_voice_model_cache_evidence_kind",
    evidence.cache_exists ? undefined : "cache_directory_missing",
    qwenModel ? undefined : "qwen3_tts_model_cache_missing",
    qwenModel?.approved === true ? undefined : "qwen3_tts_model_not_marked_approved",
    readyModelObserved ? undefined : "qwen3_tts_model_cache_not_ready",
    ...(qwenModel?.ready ? [] : qwenModel?.blockers.map((blocker) => `qwen3_tts:${blocker}`) ?? []),
  ].filter((blocker): blocker is string => typeof blocker === "string");

  return {
    evidenceKind: evidence.kind,
    evidenceGeneratedAt: evidence.generatedAt,
    cacheDir: evidence.cache_dir,
    ready: evidence.ready && readyModelObserved && blockers.length === 0,
    readyModelObserved,
    readyModelIds,
    blockers,
  };
}

function parsePcmWavMetadata(audioBytes: Buffer): WavMetadata {
  if (audioBytes.toString("ascii", 0, 4) !== "RIFF" || audioBytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Unsupported audio file: expected RIFF/WAVE");
  }
  const format = audioBytes.readUInt16LE(20);
  const channels = audioBytes.readUInt16LE(22);
  const sampleRateHz = audioBytes.readUInt32LE(24);
  const byteRate = audioBytes.readUInt32LE(28);
  const bitsPerSample = audioBytes.readUInt16LE(34);
  const dataChunkOffset = findChunk(audioBytes, "data");
  const dataBytes = audioBytes.readUInt32LE(dataChunkOffset + 4);
  if (format !== 1 || bitsPerSample !== 16) {
    throw new Error("Unsupported audio file: expected PCM signed 16-bit WAV");
  }
  return {
    codec: "pcm_s16le",
    sampleRateHz,
    channels,
    durationMs: Math.round((dataBytes / byteRate) * 1000 * 1000) / 1000,
    sizeBytes: audioBytes.byteLength,
    bitRate: byteRate * 8,
  };
}

function findChunk(bytes: Buffer, chunkId: string): number {
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === chunkId) {
      return offset;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`Unsupported audio file: missing ${chunkId} chunk`);
}

function parseArgs(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const options: CliOptions = {
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
    if (arg === "--log") {
      options.logPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--prompt") {
      options.promptPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--audio") {
      options.audioPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--model-cache-evidence") {
      options.modelCacheEvidencePath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--generated-at") {
      options.generatedAt = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ""}`);
  }

  return options;
}

async function latestQwenTtsSmokePath(): Promise<string | undefined> {
  const files = await globFiles("docs/openclinxr/local-qwen-tts-runtime-smoke-*.json");
  return files.sort().at(-1);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
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

function requireLiteral<T extends string | boolean | number | null>(
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

function requireSha256(value: unknown, pathName: string, errors: string[]): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    errors.push(`${pathName} must be sha256 hex string`);
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function parseNumberMatch(content: string, pattern: RegExp): number | null {
  const value = content.match(pattern)?.[1];
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringMatch(content: string, pattern: RegExp): string | null {
  return content.match(pattern)?.[1]?.trim() ?? null;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
