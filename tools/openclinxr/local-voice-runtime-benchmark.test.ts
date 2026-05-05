import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildLocalVoiceRuntimeBenchmarkReport,
  parsePcmWavMetadata,
  parseVibeVoiceRuntimeLog,
} from "./local-voice-runtime-benchmark.js";

const execFileAsync = promisify(execFile);

describe("local voice runtime benchmark parser", () => {
  it("parses VibeVoice file-generation logs without treating them as live-dialog evidence", () => {
    const parsed = parseVibeVoiceRuntimeLog(sampleVibeVoiceLog);

    expect(parsed.generatedAt).toBe("2026-05-05T20:20:00Z");
    expect(parsed.runtime).toMatchObject({
      modelId: "microsoft/VibeVoice-Realtime-0.5B",
      device: "mps",
      torchVersion: "2.11.0",
      transformersVersion: "4.51.3",
      voicePreset: "Carter",
      voicePresetPath: "/Users/patrick/.cache/openclinxr/vibevoice/VibeVoice/demo/voices/streaming_model/en-Carter_man.pt",
    });
    expect(parsed.metrics).toMatchObject({
      wallClockMs: 118920,
      modelGenerationMs: 18170,
      audioDurationMs: 3470,
      realTimeFactor: 5.24,
      approxFirstSpeechTokenLatencyMs: 9000,
      prefillingTextTokens: 10,
      generatedSpeechTokens: 30,
      totalTokens: 356,
      maxResidentSetBytes: 6952583168,
      peakMemoryFootprintBytes: 9178091624,
    });
    expect(parsed.outputPath).toBe("/Users/patrick/.cache/openclinxr/vibevoice/outputs/openclinxr-first-audio_generated.wav");
    expect(parsed.blockers).toEqual([]);
  });

  it("reads PCM WAV metadata from local bytes", () => {
    const metadata = parsePcmWavMetadata(samplePcmWav({
      sampleRateHz: 24_000,
      channels: 1,
      durationMs: 500,
    }));

    expect(metadata).toEqual({
      codec: "pcm_s16le",
      sampleRateHz: 24000,
      channels: 1,
      durationMs: 500,
      sizeBytes: 24044,
      bitRate: 384000,
    });
  });

  it("builds a report that preserves no-cloud/no-audio-commit boundaries", () => {
    const audioBytes = samplePcmWav({
      sampleRateHz: 24_000,
      channels: 1,
      durationMs: 500,
    });
    const report = buildLocalVoiceRuntimeBenchmarkReport({
      logPath: "/Users/patrick/.cache/openclinxr/vibevoice/benchmarks/vibevoice-first-audio.log",
      logContent: sampleVibeVoiceLog,
      promptPath: "/Users/patrick/.cache/openclinxr/vibevoice/benchmarks/openclinxr-first-audio.txt",
      promptText: "The patient reports chest pressure and needs help now.",
      audioPath: "/Users/patrick/.cache/openclinxr/vibevoice/outputs/openclinxr-first-audio_generated.wav",
      audioBytes,
      audioSha256: "abc123",
    });

    expect(report).toMatchObject({
      generatedAt: "2026-05-05T20:20:00Z",
      status: "passed_with_caveats",
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        voiceRuntimeExecutionApproved: false,
        voiceRuntimeExecutionAttemptedByThisTool: false,
        generatedAudioCommitted: false,
        productionUseAllowed: false,
      },
      runtime: {
        command: "/Users/patrick/.local/bin/vibevoice realtime-file",
        repositoryHead: "e73d1e17c3754f046352014856a922f8208fb5d3",
        modelId: "microsoft/VibeVoice-Realtime-0.5B",
      },
      audio: {
        sha256: "abc123",
        codec: "pcm_s16le",
        durationMs: 500,
      },
      verdict: {
        passed: true,
        blockers: [],
      },
    });
    expect(report.verdict.caveats).toEqual(expect.arrayContaining([
      "This measured file-based local generation, not WebXR playback or a live streaming websocket turn.",
      "This report was harvested from existing local files; this repo-managed tool did not execute VibeVoice.",
    ]));
  });
});

describe("local voice runtime benchmark CLI", () => {
  it("harvests existing local log, prompt, and WAV files without running VibeVoice", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-local-voice-runtime-"));
    const logPath = path.join(dir, "voice.log");
    const promptPath = path.join(dir, "prompt.txt");
    const audioPath = path.join(dir, "voice.wav");
    const outputPath = path.join(dir, "report.json");
    await writeFile(logPath, sampleVibeVoiceLog, "utf8");
    await writeFile(promptPath, "The patient reports chest pressure and needs help now.", "utf8");
    await writeFile(audioPath, samplePcmWav({ sampleRateHz: 24_000, channels: 1, durationMs: 500 }));

    await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      [
        "tools/openclinxr/local-voice-runtime-benchmark.ts",
        "--log",
        logPath,
        "--prompt",
        promptPath,
        "--audio",
        audioPath,
        "--output",
        outputPath,
      ],
      {
        encoding: "utf8",
        timeout: 15000,
      },
    );

    const report = JSON.parse(await readFile(outputPath, "utf8")) as {
      policy: {
        cloudApisUsed: boolean;
        voiceRuntimeExecutionAttemptedByThisTool: boolean;
        generatedAudioCommitted: boolean;
      };
      audio: {
        outputPath: string;
        sha256: string;
      };
      verdict: {
        readyForLiveDialog: boolean;
      };
    };

    expect(report.policy.cloudApisUsed).toBe(false);
    expect(report.policy.voiceRuntimeExecutionAttemptedByThisTool).toBe(false);
    expect(report.policy.generatedAudioCommitted).toBe(false);
    expect(report.audio.outputPath).toBe(audioPath);
    expect(report.audio.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.verdict.readyForLiveDialog).toBe(false);
  });
});

function samplePcmWav(input: { sampleRateHz: number; channels: number; durationMs: number }): Buffer {
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const sampleCount = Math.round((input.sampleRateHz * input.durationMs) / 1000);
  const dataBytes = sampleCount * input.channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(input.channels, 22);
  buffer.writeUInt32LE(input.sampleRateHz, 24);
  buffer.writeUInt32LE(input.sampleRateHz * input.channels * bytesPerSample, 28);
  buffer.writeUInt16LE(input.channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

const sampleVibeVoiceLog = [
  "started_at_utc=2026-05-05T20:18:01Z",
  "Using device: mps, torch_dtype: torch.float32, attn_implementation: sdpa",
  "\"transformers_version\": \"4.51.3\"",
  "torch_version=2.11.0",
  "Loading processor & model from microsoft/VibeVoice-Realtime-0.5B",
  "Using voice preset for Carter: /Users/patrick/.cache/openclinxr/vibevoice/VibeVoice/demo/voices/streaming_model/en-Carter_man.pt",
  "Prefilled 5 text tokens, generated 1 speech tokens, current step (322 / 8192):   4%| | 322/8192 [00:09<04:03, 32.38it/s]",
  "Generation time: 18.17 seconds",
  "Generated audio duration: 3.47 seconds",
  "RTF (Real Time Factor): 5.24x",
  "Prefilling text tokens: 10",
  "Generated speech tokens: 30",
  "Total tokens: 356",
  "Saved output to /Users/patrick/.cache/openclinxr/vibevoice/outputs/openclinxr-first-audio_generated.wav",
  "real 118.92",
  "          6952583168  maximum resident set size",
  "          9178091624  peak memory footprint",
  "ended_at_utc=2026-05-05T20:20:00Z",
  "exit_status=0",
].join("\n");
