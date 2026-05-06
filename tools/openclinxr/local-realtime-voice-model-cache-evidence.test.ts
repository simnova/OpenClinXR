import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildLocalRealtimeVoiceModelCacheEvidence, main } from "./local-realtime-voice-model-cache-evidence.js";

describe("local realtime voice model cache evidence", () => {
  it("recognizes an approved Qwen3-TTS MLX cache with local weight evidence", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-voice-cache-"));
    const modelDir = path.join(dir, "mlx-community__Qwen3-TTS-12Hz-0.6B-Base-4bit");
    await mkdir(modelDir, { recursive: true });
    await writeFile(path.join(modelDir, "config.json"), "{}");
    await writeFile(path.join(modelDir, "model.safetensors"), "pretend weights");
    await writeFile(path.join(modelDir, "README.md"), "# Qwen3-TTS");
    await mkdir(path.join(dir, "api-python-backend-venv"), { recursive: true });
    await writeFile(path.join(dir, "api-python-backend-venv", "pyvenv.cfg"), "home = /usr/bin");

    const report = await buildLocalRealtimeVoiceModelCacheEvidence({
      cacheDir: dir,
      generatedAt: "2026-05-06T14:00:00.000Z",
    });

    expect(report).toMatchObject({
      kind: "local_voice_evidence_check",
      claim_scope: "cache_inventory_only",
      generatedAt: "2026-05-06T14:00:00.000Z",
      cache_dir: dir,
      cache_exists: true,
      ready: true,
      approved_model_ids: [
        "kyutai/moshiko-mlx-q4",
        "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
      ],
      models: [
        {
          model_id: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
          path: modelDir,
          source_type: "local_cache_snapshot",
          expected_storage_name: "mlx-community__Qwen3-TTS-12Hz-0.6B-Base-4bit",
          license: "Apache-2.0",
          source_id: "src-qwen3-tts-mlx-4bit-2026",
          approved: true,
          has_evidence: true,
          ready: true,
          blockers: [],
          file_count: 3,
        },
      ],
      support_directories: [
        {
          path: path.join(dir, "api-python-backend-venv"),
          name: "api-python-backend-venv",
          reason: "runtime_support_venv_not_model_weights",
          file_count: 1,
        },
      ],
    });
    expect(report.models[0]?.total_bytes).toBeGreaterThan(0);
  });

  it("keeps an approved model directory blocked until weight files are present", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-voice-cache-"));
    const modelDir = path.join(dir, "kyutai__moshiko-mlx-q4");
    await mkdir(modelDir, { recursive: true });
    await writeFile(path.join(modelDir, "README.md"), "# Moshi");

    const report = await buildLocalRealtimeVoiceModelCacheEvidence({
      cacheDir: dir,
      generatedAt: "2026-05-06T14:00:00.000Z",
    });

    expect(report.ready).toBe(false);
    expect(report.models).toEqual([
      expect.objectContaining({
        model_id: "kyutai/moshiko-mlx-q4",
        license: "CC-BY-4.0",
        source_id: "src-moshiko-mlx-q4-2026",
        ready: false,
        blockers: ["model_weight_file_missing"],
      }),
    ]);
  });

  it("writes a CLI report to the requested output path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-voice-cache-"));
    const output = path.join(dir, "cache-evidence.json");

    await main([
      "--cache-dir",
      dir,
      "--generated-at",
      "2026-05-06T14:00:00.000Z",
      "--output",
      output,
    ]);

    const report = JSON.parse(await readFile(output, "utf8")) as Awaited<ReturnType<typeof buildLocalRealtimeVoiceModelCacheEvidence>>;
    expect(report).toMatchObject({
      generatedAt: "2026-05-06T14:00:00.000Z",
      cache_dir: dir,
      models: [],
      ready: false,
    });
  });
});
