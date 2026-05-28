import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLocalModelCacheEvidence,
  main,
  validateLocalModelCacheEvidenceReport,
} from "./local-model-cache-evidence.js";

describe("local reasoning model cache evidence", () => {
  it("exposes generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["local:model:cache"]).toBe("tsx tools/openclinxr/local-model-cache-evidence.ts");
    expect(rootPackage.scripts["local:model:cache:validate"]).toBe(
      "tsx tools/openclinxr/local-model-cache-evidence.ts --validate-latest",
    );
    expect(rootPackage.scripts["agent:verify"]).toContain("pnpm local:model:cache:validate");
  });

  it("recognizes an approved Qwen GGUF cache with local weight evidence", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-model-cache-"));
    const revision = "bc640142c66e1fdd12af0bd68f40445458f3869b";
    const modelRoot = path.join(dir, "models--Qwen--Qwen3-4B-GGUF");
    const modelFile = path.join(modelRoot, "snapshots", revision, "Qwen3-4B-Q4_K_M.gguf");
    await mkdir(path.dirname(modelFile), { recursive: true });
    await mkdir(path.join(modelRoot, "refs"), { recursive: true });
    await writeFile(path.join(modelRoot, "refs", "main"), revision);
    await writeFile(modelFile, "pretend gguf weights");

    const report = await buildLocalModelCacheEvidence({
      cacheDir: dir,
      generatedAt: "2026-05-06T22:00:00.000Z",
    });

    expect(report).toMatchObject({
      kind: "local_model_evidence_check",
      claim_scope: "cache_inventory_only",
      generatedAt: "2026-05-06T22:00:00.000Z",
      cache_dir: dir,
      ready: true,
      policy: {
        cloudApisUsed: false,
        paidApisUsed: false,
        downloadAttemptedByThisTool: false,
        localRuntimeExecutionAttemptedByThisTool: false,
        productionUseAllowed: false,
      },
      approved_model_ids: ["Qwen/Qwen3-4B-GGUF"],
      models: [
        {
          model_id: "Qwen/Qwen3-4B-GGUF",
          path: modelFile,
          source_type: "local_cache_snapshot",
          expected_storage_name: "models--Qwen--Qwen3-4B-GGUF",
          file_name: "Qwen3-4B-Q4_K_M.gguf",
          license: "Apache-2.0",
          source_id: "src-qwen3-4b-gguf-2026",
          approved: true,
          has_evidence: true,
          ready: true,
          blockers: [],
          local_revision: revision,
          main_ref_revision: revision,
          main_ref_matches_file_revision: true,
          size_bytes: 20,
        },
      ],
    });
    expect(report.models[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps an approved model blocked when the main ref points to a missing weight file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-model-cache-"));
    const revision = "bc640142c66e1fdd12af0bd68f40445458f3869b";
    const modelRoot = path.join(dir, "models--Qwen--Qwen3-4B-GGUF");
    await mkdir(path.join(modelRoot, "refs"), { recursive: true });
    await writeFile(path.join(modelRoot, "refs", "main"), revision);

    const report = await buildLocalModelCacheEvidence({
      cacheDir: dir,
      generatedAt: "2026-05-06T22:00:00.000Z",
    });

    expect(report.ready).toBe(false);
    expect(report.models).toEqual([
      expect.objectContaining({
        model_id: "Qwen/Qwen3-4B-GGUF",
        ready: false,
        has_evidence: false,
        blockers: ["approved_model_file_missing"],
        local_revision: revision,
        main_ref_revision: revision,
      }),
    ]);
  });

  it("keeps stale cached snapshots blocked when refs/main points at a newer missing file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-model-cache-"));
    const mainRevision = "bc640142c66e1fdd12af0bd68f40445458f3869b";
    const staleRevision = "1111111111111111111111111111111111111111";
    const modelRoot = path.join(dir, "models--Qwen--Qwen3-4B-GGUF");
    const staleModelFile = path.join(modelRoot, "snapshots", staleRevision, "Qwen3-4B-Q4_K_M.gguf");
    await mkdir(path.dirname(staleModelFile), { recursive: true });
    await mkdir(path.join(modelRoot, "refs"), { recursive: true });
    await writeFile(path.join(modelRoot, "refs", "main"), mainRevision);
    await writeFile(staleModelFile, "stale pretend gguf weights");

    const report = await buildLocalModelCacheEvidence({
      cacheDir: dir,
      generatedAt: "2026-05-06T22:00:00.000Z",
    });

    expect(report.ready).toBe(false);
    expect(report.models).toEqual([
      expect.objectContaining({
        model_id: "Qwen/Qwen3-4B-GGUF",
        ready: false,
        has_evidence: true,
        blockers: ["main_ref_file_missing"],
        local_revision: staleRevision,
        main_ref_revision: mainRevision,
        main_ref_matches_file_revision: false,
      }),
    ]);
  });

  it("writes and validates cache reports from the CLI", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openclinxr-model-cache-cli-"));
    const outputPath = path.join(dir, "model-cache-evidence.json");
    const invalidPath = path.join(dir, "model-cache-evidence-invalid.json");
    const previousExitCode = process.exitCode;

    try {
      await main([
        "--cache-dir",
        dir,
        "--generated-at",
        "2026-05-06T22:00:00.000Z",
        "--output",
        outputPath,
      ]);

      const report = JSON.parse(await readFile(outputPath, "utf8")) as Awaited<ReturnType<typeof buildLocalModelCacheEvidence>>;
      expect(report).toMatchObject({
        generatedAt: "2026-05-06T22:00:00.000Z",
        cache_dir: dir,
        ready: false,
      });
      expect(validateLocalModelCacheEvidenceReport(report)).toEqual({ ok: true });
      await expect(main(["--validate", outputPath])).resolves.toBeUndefined();

      const invalid = structuredClone(report) as unknown as Record<string, unknown>;
      invalid.ready = true;
      invalid.models = [];
      await writeFile(invalidPath, `${JSON.stringify(invalid, null, 2)}\n`, "utf8");

      process.exitCode = undefined;
      await main(["--validate", invalidPath]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
