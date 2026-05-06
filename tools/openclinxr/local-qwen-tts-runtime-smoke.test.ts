import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildLocalQwenTtsRuntimeSmokeReport, main } from "./local-qwen-tts-runtime-smoke.js";
import type { LocalRealtimeVoiceModelCacheEvidenceReport } from "./local-realtime-voice-model-cache-evidence.js";

describe("local Qwen TTS runtime smoke report", () => {
  it("harvests a successful local Qwen3-TTS MLX file-generation smoke without claiming full duplex", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-qwen-tts-"));
    const audioPath = path.join(dir, "qwen-output.wav");
    await writeFile(audioPath, pcm16Wav({ durationMs: 1200, sampleRateHz: 24000 }));

    const report = buildLocalQwenTtsRuntimeSmokeReport({
      generatedAt: "2026-05-06T18:30:00.000Z",
      logPath: path.join(dir, "run.log"),
      logContent: [
        "started_at_utc=2026-05-06T18:29:55Z",
        "ended_at_utc=2026-05-06T18:30:01Z",
        "exit_status=0",
        "command=python -m mlx_audio.tts.generate --model /Users/patrick/.cache/openclinxr/realtime-voice/mlx-community__Qwen3-TTS-12Hz-0.6B-Base-4bit --text The chest pressure is worse.",
        "mlx_audio_version=0.3.0",
        "python_version=3.11.4",
        "real 0.42",
        "123456 maximum resident set size",
      ].join("\n"),
      audioPath,
      audioBytes: pcm16Wav({ durationMs: 1200, sampleRateHz: 24000 }),
      promptText: "The chest pressure is worse.",
      modelCacheEvidence: readyQwenCacheEvidence(),
    });

    expect(report).toMatchObject({
      kind: "local_qwen_tts_runtime_smoke",
      claim_scope: "local_tts_inference_only",
      generatedAt: "2026-05-06T18:30:00.000Z",
      status: "passed_with_caveats",
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        productionUseAllowed: false,
        generatedAudioCommitted: false,
        fullDuplexClaimAllowed: false,
        clinicalValidityClaimAllowed: false,
        runtimeExecutionObserved: true,
        downloadAttemptedByThisTool: false,
        networkAccessObservedByThisTool: false,
      },
      runtime: {
        modelId: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
        modelLicense: "Apache-2.0",
        sourceRecordIds: [
          "src-qwen3-tts-mlx-4bit-2026",
          "src-mlx-audio-pypi-2026",
        ],
        tool: "mlx-audio",
        toolVersion: "0.3.0",
        toolLicense: "MIT",
        pythonVersion: "3.11.4",
        exitStatus: 0,
      },
      input: {
        text: "The chest pressure is worse.",
        textLength: 28,
        referenceAudioUsed: false,
      },
      audio: {
        outputPath: audioPath,
        codec: "pcm_s16le",
        sampleRateHz: 24000,
        channels: 1,
        durationMs: 1200,
      },
      metrics: {
        wallClockMs: 420,
        realTimeFactor: 0.35,
        maxResidentSetBytes: 123456,
        approxFirstAudiblePlaybackLatencyMs: null,
      },
      modelCache: {
        evidenceKind: "local_voice_evidence_check",
        ready: true,
        readyModelObserved: true,
        blockers: [],
      },
      verdict: {
        passed: true,
        readyForLiveDialog: false,
        blockers: [],
      },
    });
    expect(report.audio.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.verdict.caveats).toContain("This is local outbound TTS file-generation evidence only; it is not full-duplex ASR/dialog evidence.");
  });

  it("blocks the smoke when the process succeeds but approved Qwen cache evidence is missing", () => {
    const audioBytes = pcm16Wav({ durationMs: 800, sampleRateHz: 24000 });
    const report = buildLocalQwenTtsRuntimeSmokeReport({
      logPath: "/tmp/qwen.log",
      logContent: "exit_status=0\nreal 1.20",
      audioPath: "/tmp/qwen.wav",
      audioBytes,
      promptText: "Hello.",
    });

    expect(report.status).toBe("blocked");
    expect(report.modelCache).toMatchObject({
      ready: false,
      readyModelObserved: false,
      blockers: ["missing_local_realtime_voice_model_cache_evidence_report"],
    });
    expect(report.verdict.blockers).toEqual(["model_cache:missing_local_realtime_voice_model_cache_evidence_report"]);
  });

  it("writes a CLI report to the requested output path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-qwen-tts-"));
    const logPath = path.join(dir, "run.log");
    const promptPath = path.join(dir, "prompt.txt");
    const audioPath = path.join(dir, "qwen-output.wav");
    const cachePath = path.join(dir, "cache.json");
    const outputPath = path.join(dir, "report.json");
    await writeFile(logPath, "exit_status=0\nreal 0.40\nmlx_audio_version=0.3.0");
    await writeFile(promptPath, "Hello from OpenClinXR.");
    await writeFile(audioPath, pcm16Wav({ durationMs: 1000, sampleRateHz: 24000 }));
    await writeFile(cachePath, JSON.stringify(readyQwenCacheEvidence()));

    await main([
      "--log",
      logPath,
      "--prompt",
      promptPath,
      "--audio",
      audioPath,
      "--model-cache-evidence",
      cachePath,
      "--generated-at",
      "2026-05-06T18:30:00.000Z",
      "--output",
      outputPath,
    ]);

    const report = JSON.parse(await readFile(outputPath, "utf8")) as Awaited<ReturnType<typeof buildLocalQwenTtsRuntimeSmokeReport>>;
    expect(report).toMatchObject({
      generatedAt: "2026-05-06T18:30:00.000Z",
      input: {
        text: "Hello from OpenClinXR.",
      },
      verdict: {
        passed: true,
      },
    });
  });
});

function readyQwenCacheEvidence(): LocalRealtimeVoiceModelCacheEvidenceReport {
  return {
    kind: "local_voice_evidence_check",
    claim_scope: "cache_inventory_only",
    generatedAt: "2026-05-06T18:00:00.000Z",
    cache_dir: "/Users/patrick/.cache/openclinxr/realtime-voice",
    approved_model_ids: [
      "kyutai/moshiko-mlx-q4",
      "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
    ],
    cache_exists: true,
    ready: true,
    models: [
      {
        model_id: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
        path: "/Users/patrick/.cache/openclinxr/realtime-voice/mlx-community__Qwen3-TTS-12Hz-0.6B-Base-4bit",
        source_type: "local_cache_snapshot",
        expected_storage_name: "mlx-community__Qwen3-TTS-12Hz-0.6B-Base-4bit",
        license: "Apache-2.0",
        source_id: "src-qwen3-tts-mlx-4bit-2026",
        approved: true,
        has_evidence: true,
        ready: true,
        blockers: [],
        file_count: 30,
        total_bytes: 1711330264,
      },
    ],
    support_directories: [],
  };
}

function pcm16Wav(input: { durationMs: number; sampleRateHz: number }): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const samples = Math.round((input.durationMs / 1000) * input.sampleRateHz);
  const dataBytes = samples * channels * (bitsPerSample / 8);
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(input.sampleRateHz, 24);
  bytes.writeUInt32LE(input.sampleRateHz * channels * (bitsPerSample / 8), 28);
  bytes.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  bytes.writeUInt16LE(bitsPerSample, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
}
