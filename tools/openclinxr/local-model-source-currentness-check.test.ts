import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LocalModelCacheEvidenceReport } from "./local-model-cache-evidence.js";
import {
  buildLocalModelSourceCurrentnessReport,
  type LocalModelSourceMetadataSnapshot,
  main,
  validateLocalModelSourceMetadataSnapshot,
} from "./local-model-source-currentness-check.js";

const modelRevision = "bc640142c66e1fdd12af0bd68f40445458f3869b";

describe("local model source currentness evidence", () => {
  it("exposes source-currentness scripts in the root package", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["local:model:source-currentness"]).toBe(
      "tsx tools/openclinxr/local-model-source-currentness-check.ts",
    );
    expect(rootPackage.scripts["local:model:source-currentness:validate"]).toBe(
      "tsx tools/openclinxr/local-model-source-currentness-check.ts --validate-latest",
    );
    expect(rootPackage.scripts["agent:verify"]).toContain("pnpm local:model:source-currentness:validate");
  });

  it("passes when Hugging Face metadata matches the ready local cache evidence", () => {
    const report = buildLocalModelSourceCurrentnessReport({
      generatedAt: "2026-05-06T22:20:00.000Z",
      metadataFile: "docs/openclinxr/local-model-source-metadata-2026-05-06.json",
      cacheEvidenceFile: "docs/openclinxr/local-model-cache-evidence-2026-05-06.json",
      metadata: sourceMetadata(),
      cacheEvidence: cacheEvidence(),
    });

    expect(report).toMatchObject({
      kind: "local_model_source_currentness_check",
      ready: true,
      metadata_file: "docs/openclinxr/local-model-source-metadata-2026-05-06.json",
      cache_evidence_file: "docs/openclinxr/local-model-cache-evidence-2026-05-06.json",
      model_id: "Qwen/Qwen3-4B-GGUF",
      source_revision: modelRevision,
      local_revision: modelRevision,
      license: {
        source: "apache-2.0",
        expected: "apache-2.0",
        accepted: true,
      },
      file: {
        expected: "Qwen3-4B-Q4_K_M.gguf",
        listed_by_source: true,
        cached: true,
      },
      verdict: {
        passed: true,
        blockers: [],
      },
    });
  });

  it("blocks stale local cache evidence when the source metadata revision has moved", () => {
    const report = buildLocalModelSourceCurrentnessReport({
      generatedAt: "2026-05-06T22:20:00.000Z",
      metadataFile: "metadata.json",
      cacheEvidenceFile: "cache.json",
      metadata: {
        ...sourceMetadata(),
        sha: "9999999999999999999999999999999999999999",
      },
      cacheEvidence: cacheEvidence(),
    });

    expect(report.ready).toBe(false);
    expect(report.verdict.blockers).toEqual([
      "local_model_cache_revision_not_current:Qwen/Qwen3-4B-GGUF:source_9999999999999999999999999999999999999999_local_bc640142c66e1fdd12af0bd68f40445458f3869b",
    ]);
  });

  it("writes and validates latest source-currentness reports from the CLI", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-model-currentness-"));
    const metadataPath = path.join(dir, "local-model-source-metadata-2026-05-06.json");
    const cachePath = path.join(dir, "local-model-cache-evidence-2026-05-06.json");
    const outputPath = path.join(dir, "local-model-source-currentness-2026-05-06.json");

    await writeFile(metadataPath, `${JSON.stringify(sourceMetadata(), null, 2)}\n`, "utf8");
    await writeFile(cachePath, `${JSON.stringify(cacheEvidence(), null, 2)}\n`, "utf8");

    await main([
      "--metadata-input",
      metadataPath,
      "--cache-evidence-input",
      cachePath,
      "--generated-at",
      "2026-05-06T22:20:00.000Z",
      "--output",
      outputPath,
    ]);
    const report = JSON.parse(await readFile(outputPath, "utf8")) as ReturnType<typeof buildLocalModelSourceCurrentnessReport>;

    expect(report.ready).toBe(true);
    expect(validateLocalModelSourceMetadataSnapshot(sourceMetadata())).toEqual({ ok: true });
    await expect(main(["--validate", outputPath])).resolves.toBeUndefined();
  });
});

function sourceMetadata(): LocalModelSourceMetadataSnapshot {
  return {
    kind: "huggingface_model_metadata_snapshot",
    capturedAt: "2026-05-06T22:18:00.000Z",
    modelId: "Qwen/Qwen3-4B-GGUF",
    sourceUrl: "https://huggingface.co/Qwen/Qwen3-4B-GGUF",
    apiUrl: "https://huggingface.co/api/models/Qwen/Qwen3-4B-GGUF",
    sha: modelRevision,
    license: "apache-2.0",
    lastModified: "2025-05-21T06:32:23.000Z",
    private: false,
    disabled: false,
    siblings: [
      { rfilename: "Qwen3-4B-Q4_K_M.gguf", size: null },
      { rfilename: "Qwen3-4B-Q5_0.gguf", size: null },
    ],
  };
}

function cacheEvidence(): LocalModelCacheEvidenceReport {
  return {
    kind: "local_model_evidence_check",
    claim_scope: "cache_inventory_only",
    generatedAt: "2026-05-06T22:00:20.143Z",
    cache_dir: "/Users/patrick/.cache/huggingface/hub",
    approved_model_ids: ["Qwen/Qwen3-4B-GGUF"],
    cache_exists: true,
    ready: true,
    policy: {
      cloudApisUsed: false,
      paidApisUsed: false,
      downloadAttemptedByThisTool: false,
      localRuntimeExecutionAttemptedByThisTool: false,
      productionUseAllowed: false,
    },
    models: [
      {
        model_id: "Qwen/Qwen3-4B-GGUF",
        path: `/Users/patrick/.cache/huggingface/hub/models--Qwen--Qwen3-4B-GGUF/snapshots/${modelRevision}/Qwen3-4B-Q4_K_M.gguf`,
        source_type: "local_cache_snapshot",
        expected_storage_name: "models--Qwen--Qwen3-4B-GGUF",
        file_name: "Qwen3-4B-Q4_K_M.gguf",
        license: "Apache-2.0",
        source_id: "src-qwen3-4b-gguf-2026",
        approved: true,
        has_evidence: true,
        ready: true,
        blockers: [],
        local_revision: modelRevision,
        main_ref_revision: modelRevision,
        main_ref_matches_file_revision: true,
        size_bytes: 2497280256,
        sha256: "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
      },
    ],
  };
}
