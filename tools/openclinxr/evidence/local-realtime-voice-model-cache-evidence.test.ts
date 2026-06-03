import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLocalRealtimeVoiceModelCacheEvidence,
  main,
  validateLocalRealtimeVoiceModelCacheEvidenceReport,
} from "./local-realtime-voice-model-cache-evidence.js";

describe("local realtime voice model cache evidence", () => {
  it("exposes generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["local:voice:model-cache"]).toBe(
      "tsx tools/openclinxr/local-realtime-voice-model-cache-evidence.ts",
    );
    expect(rootPackage.scripts["local:voice:model-cache:validate"]).toBe(
      "tsx tools/openclinxr/local-realtime-voice-model-cache-evidence.ts --validate-latest",
    );
    expect(rootPackage.scripts["agent:verify"]).toContain("pnpm local:voice:model-cache:validate");
  });

  it("recognizes an approved Qwen3-TTS MLX cache with local weight evidence", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-voice-cache-"));
    const modelDir = path.join(dir, "mlx-community__Qwen3-TTS-12Hz-0.6B-Base-4bit");
    const metadataDir = path.join(modelDir, ".cache/huggingface/download");
    const localRevision = "0d6bb6fe33f92d47a507e23b9148940e8366ab5b";
    await mkdir(modelDir, { recursive: true });
    await writeFile(path.join(modelDir, "config.json"), "{}");
    await writeFile(path.join(modelDir, "model.safetensors"), "pretend weights");
    await writeFile(path.join(modelDir, "README.md"), "# Qwen3-TTS");
    await mkdir(metadataDir, { recursive: true });
    await writeFile(path.join(metadataDir, "model.safetensors.metadata"), `${localRevision}\n07dcb37b\n1778072899\n`);
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
          local_revision: localRevision,
          metadata_revision_file_count: 1,
          metadata_revision_consistent: true,
          file_count: 4,
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

  it("ignores cached smoke output directories when judging approved model readiness", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-voice-cache-"));
    const smokeDir = path.join(dir, "qwen-tts-smoke-2026-05-06-run2");
    await mkdir(smokeDir, { recursive: true });
    await writeFile(path.join(smokeDir, "openclinxr-qwen-smoke_000.wav"), "pretend audio");

    const report = await buildLocalRealtimeVoiceModelCacheEvidence({
      cacheDir: dir,
      generatedAt: "2026-05-06T14:00:00.000Z",
    });

    expect(report.ready).toBe(false);
    expect(report.models).toEqual([]);
    expect(report.support_directories).toEqual([
      expect.objectContaining({
        name: "qwen-tts-smoke-2026-05-06-run2",
        reason: "runtime_generated_output_not_model_weights",
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

  it("validates model cache reports before aggregate reuse", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-voice-cache-"));
    const modelDir = path.join(dir, "mlx-community__Qwen3-TTS-12Hz-0.6B-Base-4bit");
    await mkdir(modelDir, { recursive: true });
    await writeFile(path.join(modelDir, "config.json"), "{}");
    await writeFile(path.join(modelDir, "model.safetensors"), "pretend weights");

    const report = await buildLocalRealtimeVoiceModelCacheEvidence({
      cacheDir: dir,
      generatedAt: "2026-05-06T14:00:00.000Z",
    });

    expect(validateLocalRealtimeVoiceModelCacheEvidenceReport(report)).toEqual({ ok: true });

    const invalid = structuredClone(report) as unknown as Record<string, unknown>;
    invalid.ready = true;
    invalid.models = [];

    expect(validateLocalRealtimeVoiceModelCacheEvidenceReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/ready cannot be true without at least one ready approved model",
      ]),
    });
  });

  it("validates model cache reports from the CLI without rescanning the cache", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openclinxr-voice-cache-validate-"));
    const outputPath = path.join(tempDir, "model-cache-evidence.json");
    const invalidPath = path.join(tempDir, "model-cache-evidence-invalid.json");
    const previousExitCode = process.exitCode;

    try {
      const report = await buildLocalRealtimeVoiceModelCacheEvidence({
        cacheDir: tempDir,
        generatedAt: "2026-05-06T14:00:00.000Z",
      });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

      await expect(main(["--validate", outputPath])).resolves.toBeUndefined();
      await expect(main(["--validate-latest"])).resolves.toBeUndefined();

      const invalidReport = structuredClone(report) as unknown as Record<string, unknown>;
      delete invalidReport.approved_model_ids;
      await writeFile(invalidPath, `${JSON.stringify(invalidReport, null, 2)}\n`, "utf8");

      process.exitCode = undefined;
      await main(["--validate", invalidPath]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
