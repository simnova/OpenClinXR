import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { writeJson } from "../agent-factory/lib.js";

type CliOptions = {
  logPath?: string;
  promptPath?: string;
  audioPath?: string;
  outputPath?: string;
  runtimeExecutionApproved?: boolean;
  runtimeExecutionObserved?: boolean;
};

type WavMetadata = {
  codec: "pcm_s16le";
  sampleRateHz: number;
  channels: number;
  durationMs: number;
  sizeBytes: number;
  bitRate: number;
};

export type ParsedVibeVoiceRuntimeLog = {
  generatedAt: string | null;
  runtime: {
    modelId: string | null;
    device: string | null;
    torchVersion: string | null;
    transformersVersion: string | null;
    voicePreset: string | null;
    voicePresetPath: string | null;
  };
  outputPath: string | null;
  metrics: {
    wallClockMs: number | null;
    modelGenerationMs: number | null;
    audioDurationMs: number | null;
    realTimeFactor: number | null;
    approxFirstSpeechTokenLatencyMs: number | null;
    prefillingTextTokens: number | null;
    generatedSpeechTokens: number | null;
    totalTokens: number | null;
    maxResidentSetBytes: number | null;
    peakMemoryFootprintBytes: number | null;
    openclinxrCacheDiskFootprintGiB: 3.6;
    vibevoiceModelCacheFootprintGiB: 1.9;
  };
  blockers: string[];
};

export type LocalVoiceRuntimeBenchmarkReport = {
  generatedAt: string;
  status: "passed_with_caveats" | "blocked";
  policy: {
    cloudApisUsed: false;
    paidApisUsed: false;
    voiceInstallApproved: true;
    voiceSafetyReviewApproved: true;
    voiceRuntimeExecutionApproved: boolean;
    voiceRuntimeExecutionObserved: boolean;
    voiceRuntimeExecutionAttemptedByThisTool: false;
    productionUseAllowed: false;
    generatedAudioCommitted: false;
    downloadAttemptedByThisTool: false;
    networkAccessObservedByThisTool: false;
  };
  runtime: {
    command: "/Users/patrick/.local/bin/vibevoice realtime-file";
    repository: "https://github.com/microsoft/VibeVoice.git";
    repositoryHead: "e73d1e17c3754f046352014856a922f8208fb5d3";
    modelId: string | null;
    sourceRecordIds: ["src-vibevoice-github-2026"];
    device: string | null;
    torchVersion: string | null;
    transformersVersion: string | null;
    pythonVenv: "/Users/patrick/.cache/openclinxr/vibevoice/.venv";
    huggingFaceCache: "/Users/patrick/.cache/openclinxr/huggingface";
    voicePreset: string | null;
    voicePresetPath: string | null;
  };
  input: {
    textPath: string;
    text: string;
  };
  audio: WavMetadata & {
    outputPath: string;
    sha256: string;
  };
  metrics: ParsedVibeVoiceRuntimeLog["metrics"];
  verdict: {
    passed: boolean;
    readyForLiveDialog: false;
    blockers: string[];
    caveats: string[];
  };
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.logPath || !options.promptPath || !options.audioPath) {
    throw new Error("Missing --log, --prompt, or --audio. This tool harvests existing local files only and does not execute VibeVoice.");
  }
  const [logContent, promptText, audioBytes] = await Promise.all([
    readFile(options.logPath, "utf8"),
    readFile(options.promptPath, "utf8"),
    readFile(options.audioPath),
  ]);
  const report = buildLocalVoiceRuntimeBenchmarkReport({
    logPath: options.logPath,
    logContent,
    promptPath: options.promptPath,
    promptText,
    audioPath: options.audioPath,
    audioBytes,
    audioSha256: sha256(audioBytes),
    runtimeExecutionApproved: options.runtimeExecutionApproved,
    runtimeExecutionObserved: options.runtimeExecutionObserved,
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
    if (arg === "--output") {
      options.outputPath = requireValue(normalizedArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--runtime-execution-approved") {
      options.runtimeExecutionApproved = true;
      continue;
    }
    if (arg === "--runtime-execution-observed") {
      options.runtimeExecutionObserved = true;
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

export function parseVibeVoiceRuntimeLog(content: string): ParsedVibeVoiceRuntimeLog {
  const exitStatus = parseNumberMatch(content, /exit_status=(\d+)/);
  const modelGenerationSeconds = parseNumberMatch(content, /Generation time:\s*([\d.]+)\s*seconds/);
  const audioDurationSeconds = parseNumberMatch(content, /Generated audio duration:\s*([\d.]+)\s*seconds/);
  const realSeconds = parseNumberMatch(content, /^real\s+([\d.]+)$/m)
    ?? parseNumberMatch(content, /^\s*([\d.]+)\s+real\b/m);
  const blockers = [
    exitStatus === null ? "missing_vibevoice_exit_status" : undefined,
    exitStatus !== null && exitStatus !== 0 ? `vibevoice_exit_status_${exitStatus}` : undefined,
  ].filter((blocker): blocker is string => typeof blocker === "string");
  const voice = content.match(/Using voice preset for ([^:]+):\s*([^\n]+)/);

  return {
    generatedAt: stringMatch(content, /ended_at_utc=([^\s]+)/),
    runtime: {
      modelId: stringMatch(content, /Loading processor & model from ([^\n]+)/),
      device: stringMatch(content, /Using device:\s*([^,\n]+)/),
      torchVersion: stringMatch(content, /torch_version[=:]\s*"?([^",\n]+)"?/),
      transformersVersion: stringMatch(content, /"?transformers_version"?[=:]\s*"?([^",\n]+)"?/),
      voicePreset: voice?.[1]?.trim() ?? null,
      voicePresetPath: voice?.[2]?.trim() ?? null,
    },
    outputPath: stringMatch(content, /Saved output to ([^\n]+)/),
    metrics: {
      wallClockMs: realSeconds === null ? null : Math.round(realSeconds * 1000),
      modelGenerationMs: secondsToMs(modelGenerationSeconds),
      audioDurationMs: secondsToMs(audioDurationSeconds),
      realTimeFactor: parseNumberMatch(content, /RTF \(Real Time Factor\):\s*([\d.]+)x/),
      approxFirstSpeechTokenLatencyMs: deriveApproxFirstSpeechTokenLatencyMs(content),
      prefillingTextTokens: parseNumberMatch(content, /Prefilling text tokens:\s*(\d+)/),
      generatedSpeechTokens: parseNumberMatch(content, /Generated speech tokens:\s*(\d+)/),
      totalTokens: parseNumberMatch(content, /Total tokens:\s*(\d+)/),
      maxResidentSetBytes: parseNumberMatch(content, /(\d+)\s+maximum resident set size/),
      peakMemoryFootprintBytes: parseNumberMatch(content, /(\d+)\s+peak memory footprint/),
      openclinxrCacheDiskFootprintGiB: 3.6,
      vibevoiceModelCacheFootprintGiB: 1.9,
    },
    blockers,
  };
}

export function parsePcmWavMetadata(audioBytes: Buffer): WavMetadata {
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

export function buildLocalVoiceRuntimeBenchmarkReport(input: {
  logPath: string;
  logContent: string;
  promptPath: string;
  promptText: string;
  audioPath: string;
  audioBytes: Buffer;
  audioSha256?: string;
  runtimeExecutionApproved?: boolean;
  runtimeExecutionObserved?: boolean;
}): LocalVoiceRuntimeBenchmarkReport {
  const parsed = parseVibeVoiceRuntimeLog(input.logContent);
  const audio = parsePcmWavMetadata(input.audioBytes);
  const blockers = [...parsed.blockers];
  const passed = blockers.length === 0;
  const runtimeExecutionApproved = input.runtimeExecutionApproved ?? false;
  const runtimeExecutionObserved = input.runtimeExecutionObserved ?? false;

  return {
    generatedAt: parsed.generatedAt ?? new Date().toISOString(),
    status: passed ? "passed_with_caveats" : "blocked",
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      voiceInstallApproved: true,
      voiceSafetyReviewApproved: true,
      voiceRuntimeExecutionApproved: runtimeExecutionApproved,
      voiceRuntimeExecutionObserved: runtimeExecutionObserved,
      voiceRuntimeExecutionAttemptedByThisTool: false,
      productionUseAllowed: false,
      generatedAudioCommitted: false,
      downloadAttemptedByThisTool: false,
      networkAccessObservedByThisTool: false,
    },
    runtime: {
      command: "/Users/patrick/.local/bin/vibevoice realtime-file",
      repository: "https://github.com/microsoft/VibeVoice.git",
      repositoryHead: "e73d1e17c3754f046352014856a922f8208fb5d3",
      modelId: parsed.runtime.modelId,
      sourceRecordIds: ["src-vibevoice-github-2026"],
      device: parsed.runtime.device,
      torchVersion: parsed.runtime.torchVersion,
      transformersVersion: parsed.runtime.transformersVersion,
      pythonVenv: "/Users/patrick/.cache/openclinxr/vibevoice/.venv",
      huggingFaceCache: "/Users/patrick/.cache/openclinxr/huggingface",
      voicePreset: parsed.runtime.voicePreset,
      voicePresetPath: parsed.runtime.voicePresetPath,
    },
    input: {
      textPath: input.promptPath,
      text: input.promptText.trim(),
    },
    audio: {
      outputPath: input.audioPath,
      sha256: input.audioSha256 ?? sha256(input.audioBytes),
      ...audio,
    },
    metrics: {
      ...parsed.metrics,
      audioDurationMs: parsed.metrics.audioDurationMs ?? audio.durationMs,
    },
    verdict: {
      passed,
      readyForLiveDialog: false,
      blockers,
      caveats: [
        "This measured file-based local generation, not WebXR playback or a live streaming websocket turn.",
        "Approximate first speech-token latency came from the progress log; true first audible playback latency still needs an interactive streaming capture.",
        "Real-time factor was above 1x on this Apple M1 Max evidence run, so current local VibeVoice is not yet Quest-ready for live dialog.",
        "Generated audio remains local-only and uncommitted because production, disclosure, retention, and clinical simulation QA are not approved.",
        runtimeExecutionObserved
          ? "Approved local VibeVoice runtime execution was observed in the harvested log/audio inputs, but this repo-managed harvester did not execute VibeVoice."
          : "This report was harvested from existing local files; this repo-managed tool did not execute VibeVoice.",
      ],
    },
  };
}

function deriveApproxFirstSpeechTokenLatencyMs(content: string): number | null {
  const match = content.match(/generated 1 speech tokens.*?\[(\d+):(\d{2})/);
  if (!match) {
    return null;
  }
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  return (minutes * 60 + seconds) * 1000;
}

function findChunk(audioBytes: Buffer, chunkId: string): number {
  for (let offset = 12; offset + 8 <= audioBytes.byteLength;) {
    const id = audioBytes.toString("ascii", offset, offset + 4);
    const size = audioBytes.readUInt32LE(offset + 4);
    if (id === chunkId) {
      return offset;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`Missing WAV ${chunkId} chunk`);
}

function secondsToMs(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1000);
}

function parseNumberMatch(content: string, regex: RegExp): number | null {
  return numberValue(content.match(regex)?.[1]);
}

function numberValue(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringMatch(content: string, regex: RegExp): string | null {
  return content.match(regex)?.[1]?.trim() ?? null;
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
