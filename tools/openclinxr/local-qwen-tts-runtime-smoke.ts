import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { writeJson } from "../agent-factory/lib.js";
import { type LocalRealtimeVoiceModelCacheEvidenceReport } from "./local-realtime-voice-model-cache-evidence.js";

type CliOptions = {
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

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
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
  const options: CliOptions = {};

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
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

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
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
