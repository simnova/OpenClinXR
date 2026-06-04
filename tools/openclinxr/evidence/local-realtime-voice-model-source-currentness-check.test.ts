import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LocalRealtimeVoiceModelCacheEvidenceReport } from "./local-realtime-voice-model-cache-evidence.js";
import {
  buildLocalRealtimeVoiceModelSourceCurrentnessReport,
  type LocalRealtimeVoiceModelSourceMetadataSnapshot,
  main,
  validateLocalRealtimeVoiceModelSourceMetadataSnapshot,
} from "./local-realtime-voice-model-source-currentness-check.js";

const moshiRevision = "18e4df760a34d5977a34517d7d1580e07acbb2f1";
const qwenTtsRevision = "0d6bb6fe33f92d47a507e23b9148940e8366ab5b";

describe("local realtime voice model source currentness evidence", () => {
  it("exposes source-currentness scripts in the root package", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["local:voice:model-source-currentness"]).toBe(
      "tsx tools/openclinxr/evidence/local-realtime-voice-model-source-currentness-check.ts",
    );
    expect(rootPackage.scripts["local:voice:model-source-currentness:validate"]).toBe(
      "tsx tools/openclinxr/evidence/local-realtime-voice-model-source-currentness-check.ts --validate-latest",
    );
    expect(rootPackage.scripts["agent:verify"]).toContain("pnpm local:voice:model-source-currentness:validate");
  });

  it("passes when Hugging Face metadata matches ready local voice model cache evidence", () => {
    const report = buildLocalRealtimeVoiceModelSourceCurrentnessReport({
      generatedAt: "2026-05-06T23:20:00.000Z",
      metadataFile: "docs/openclinxr/local-realtime-voice-model-source-metadata-2026-05-06.json",
      cacheEvidenceFile: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-06.json",
      metadata: sourceMetadata(),
      cacheEvidence: cacheEvidence(),
    });

    expect(report).toMatchObject({
      kind: "local_realtime_voice_model_source_currentness_check",
      ready: true,
      metadata_file: "docs/openclinxr/local-realtime-voice-model-source-metadata-2026-05-06.json",
      cache_evidence_file: "docs/openclinxr/local-realtime-voice-model-cache-evidence-2026-05-06.json",
      models: [
        {
          model_id: "kyutai/moshiko-mlx-q4",
          source_revision: moshiRevision,
          local_revision: moshiRevision,
          license: {
            source: "cc-by-4.0",
            expected: "cc-by-4.0",
            accepted: true,
          },
          files: {
            required: ["model.q4.safetensors"],
            listed_by_source: true,
          },
          cache: {
            cached: true,
            ready: true,
            metadata_revision_consistent: true,
          },
          verdict: {
            passed: true,
            blockers: [],
          },
        },
        {
          model_id: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
          source_revision: qwenTtsRevision,
          local_revision: qwenTtsRevision,
          license: {
            source: "apache-2.0",
            expected: "apache-2.0",
            accepted: true,
          },
          files: {
            required: ["model.safetensors", "speech_tokenizer/model.safetensors"],
            listed_by_source: true,
          },
          cache: {
            cached: true,
            ready: true,
            metadata_revision_consistent: true,
          },
          verdict: {
            passed: true,
            blockers: [],
          },
        },
      ],
      verdict: {
        passed: true,
        blockers: [],
      },
    });
  });

  it("blocks stale local voice cache evidence when a source metadata revision has moved", () => {
    const report = buildLocalRealtimeVoiceModelSourceCurrentnessReport({
      generatedAt: "2026-05-06T23:20:00.000Z",
      metadataFile: "metadata.json",
      cacheEvidenceFile: "cache.json",
      metadata: {
        ...sourceMetadata(),
        models: sourceMetadata().models.map((model) =>
          model.modelId === "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit"
            ? { ...model, sha: "9999999999999999999999999999999999999999" }
            : model,
        ),
      },
      cacheEvidence: cacheEvidence(),
    });

    expect(report.ready).toBe(false);
    expect(report.verdict.blockers).toEqual([
      "local_voice_model_cache_revision_not_current:mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit:source_9999999999999999999999999999999999999999_local_0d6bb6fe33f92d47a507e23b9148940e8366ab5b",
    ]);
  });

  it("writes and validates latest source-currentness reports from the CLI", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-voice-model-currentness-"));
    const metadataPath = path.join(dir, "local-realtime-voice-model-source-metadata-2026-05-06.json");
    const cachePath = path.join(dir, "local-realtime-voice-model-cache-evidence-2026-05-06.json");
    const outputPath = path.join(dir, "local-realtime-voice-model-source-currentness-2026-05-06.json");

    await writeFile(metadataPath, `${JSON.stringify(sourceMetadata(), null, 2)}\n`, "utf8");
    await writeFile(cachePath, `${JSON.stringify(cacheEvidence(), null, 2)}\n`, "utf8");

    await main([
      "--metadata-input",
      metadataPath,
      "--cache-evidence-input",
      cachePath,
      "--generated-at",
      "2026-05-06T23:20:00.000Z",
      "--output",
      outputPath,
    ]);
    const report = JSON.parse(await readFile(outputPath, "utf8")) as ReturnType<typeof buildLocalRealtimeVoiceModelSourceCurrentnessReport>;

    expect(report.ready).toBe(true);
    expect(validateLocalRealtimeVoiceModelSourceMetadataSnapshot(sourceMetadata())).toEqual({ ok: true });
    await expect(main(["--validate", outputPath])).resolves.toBeUndefined();
  });
});

function sourceMetadata(): LocalRealtimeVoiceModelSourceMetadataSnapshot {
  return {
    kind: "huggingface_realtime_voice_model_metadata_snapshot",
    capturedAt: "2026-05-06T23:18:00.000Z",
    models: [
      {
        modelId: "kyutai/moshiko-mlx-q4",
        sourceUrl: "https://huggingface.co/kyutai/moshiko-mlx-q4",
        apiUrl: "https://huggingface.co/api/models/kyutai/moshiko-mlx-q4",
        sha: moshiRevision,
        license: "cc-by-4.0",
        lastModified: "2024-09-18T12:50:24.000Z",
        private: false,
        disabled: false,
        siblings: [
          { rfilename: "README.md", size: null },
          { rfilename: "model.q4.safetensors", size: null },
          { rfilename: "tokenizer-e351c8d8-checkpoint125.safetensors", size: null },
        ],
      },
      {
        modelId: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
        sourceUrl: "https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
        apiUrl: "https://huggingface.co/api/models/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
        sha: qwenTtsRevision,
        license: "apache-2.0",
        lastModified: "2026-01-25T21:54:55.000Z",
        private: false,
        disabled: false,
        siblings: [
          { rfilename: "model.safetensors", size: null },
          { rfilename: "speech_tokenizer/model.safetensors", size: null },
          { rfilename: "tokenizer_config.json", size: null },
        ],
      },
    ],
  };
}

function cacheEvidence(): LocalRealtimeVoiceModelCacheEvidenceReport {
  return {
    kind: "local_voice_evidence_check",
    claim_scope: "cache_inventory_only",
    generatedAt: "2026-05-06T14:41:23.601Z",
    cache_dir: "/Users/patrick/.cache/openclinxr/realtime-voice",
    approved_model_ids: [
      "kyutai/moshiko-mlx-q4",
      "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit",
    ],
    cache_exists: true,
    ready: true,
    models: [
      {
        model_id: "kyutai/moshiko-mlx-q4",
        path: "/Users/patrick/.cache/openclinxr/realtime-voice/kyutai__moshiko-mlx-q4",
        source_type: "local_cache_snapshot",
        expected_storage_name: "kyutai__moshiko-mlx-q4",
        license: "CC-BY-4.0",
        source_id: "src-moshiko-mlx-q4-2026",
        approved: true,
        has_evidence: true,
        ready: true,
        blockers: [],
        file_count: 12,
        total_bytes: 5190750933,
        local_revision: moshiRevision,
        metadata_revision_file_count: 5,
        metadata_revision_consistent: true,
      },
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
        local_revision: qwenTtsRevision,
        metadata_revision_file_count: 14,
        metadata_revision_consistent: true,
      },
    ],
    support_directories: [],
  };
}
