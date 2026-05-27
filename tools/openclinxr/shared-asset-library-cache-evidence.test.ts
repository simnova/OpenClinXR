import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildEncounterAssetGenerationQueueReport } from "./encounter-asset-generation-queue.js";
import {
  buildSharedAssetLibraryCacheEvidenceReport,
  validateSharedAssetLibraryCacheEvidenceReport,
} from "./shared-asset-library-cache-evidence.js";

describe("shared asset library cache evidence", () => {
  it("proves encounter-derived shared asset lookup, reuse, and claim boundaries", () => {
    const report = buildSharedAssetLibraryCacheEvidenceReport({
      generatedAt: "2026-05-25T10:00:00.000Z",
      queueReport: buildEncounterAssetGenerationQueueReport({
        generatedAt: "2026-05-25T09:00:00.000Z",
      }),
    });

    expect(report).toMatchObject({
      schemaVersion: "openclinxr.shared-asset-library-cache-evidence.v1",
      claimScope: "metadata_only_cache_policy_evidence",
      sourceScenarioId: "ed_chest_pain_priority_v1",
      cachePolicy: {
        lookupKeySource: "encounter_definition_semantic_requirements",
        cacheDisposition: "lookup_before_generate",
        evictionPolicy: "least_recently_used",
        updateRecencyOnHit: true,
        reuseRequiresEvidenceGateCompatibility: true,
        maxEntries: 500,
      },
      notEvidenceFor: [
        "generated_asset_quality",
        "provider_runtime_readiness",
        "production_asset_readiness",
        "quest_readiness",
        "clinical_validity",
        "scoring_validity",
      ],
    });
    expect(report.summary.hitCount).toBeGreaterThan(0);
    expect(report.summary.missCount).toBeGreaterThan(0);
    expect(report.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetKind: "role_specific_humanoid_glb",
        lookupKey: expect.stringContaining("role_specific_humanoid_glb__patient"),
        result: "miss_stored",
        generationDisposition: "generate_and_store_asset",
        evidenceGateCompatibility: {
          required: true,
          checkedBeforeReuse: true,
          disposition: "requires_review_before_new_asset_reuse",
        },
        storedAssetRef: expect.stringContaining("blob://openclinxr-assets/shared-encounter-assets/"),
      }),
      expect.objectContaining({
        targetKind: "role_specific_humanoid_glb",
        lookupKey: expect.stringContaining("role_specific_humanoid_glb__patient"),
        result: "hit_reused",
        generationDisposition: "skip_generation_reuse_cached_asset",
        evidenceGateCompatibility: {
          required: true,
          checkedBeforeReuse: true,
          disposition: "compatible_cached_asset_reused",
        },
        reusedAssetRef: expect.stringContaining("blob://openclinxr-assets/shared-encounter-assets/"),
      }),
    ]));
    expect(validateSharedAssetLibraryCacheEvidenceReport(report)).toEqual({ ok: true });
  });

  it("captures LRU eviction when the shared library cache is capacity constrained", () => {
    const queueReport = buildEncounterAssetGenerationQueueReport();
    queueReport.plan.generationWorkOrders = [
      queueReport.plan.generationWorkOrders[0],
      queueReport.plan.generationWorkOrders[1],
      queueReport.plan.generationWorkOrders[0],
      queueReport.plan.generationWorkOrders[2],
    ];
    const report = buildSharedAssetLibraryCacheEvidenceReport({
      generatedAt: "2026-05-25T10:00:00.000Z",
      queueReport,
      maxEntries: 2,
      replayWorkOrdersTwice: false,
    });
    const firstMiss = report.operations.find((operation) => operation.result === "miss_stored");
    const hit = report.operations.find((operation) => operation.result === "hit_reused");
    const evictionMiss = report.operations.find((operation) => operation.result === "miss_stored_with_lru_eviction");

    expect(report.cachePolicy.maxEntries).toBe(2);
    expect(report.summary.evictionCount).toBeGreaterThan(0);
    expect(hit?.reusedAssetRef).toBe(firstMiss?.storedAssetRef);
    expect(hit?.generationDisposition).toBe("skip_generation_reuse_cached_asset");
    expect(hit?.recencyMostRecentFirst[0]).toBe(hit?.lookupKey);
    expect(evictionMiss?.evictedLookupKeys).not.toContain(hit?.lookupKey);
    expect(report.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        result: "miss_stored_with_lru_eviction",
        generationDisposition: "generate_and_store_after_lru_eviction",
        evictedLookupKeys: expect.arrayContaining([
          expect.stringContaining("role_idle_animation_glb"),
        ]),
      }),
    ]));
    expect(report.summary.finalCacheSize).toBeLessThanOrEqual(2);
    expect(validateSharedAssetLibraryCacheEvidenceReport(report)).toEqual({ ok: true });
  });

  it("rejects cache evidence that cannot show both generation misses and reusable hits", () => {
    const report = buildSharedAssetLibraryCacheEvidenceReport({
      generatedAt: "2026-05-25T10:00:00.000Z",
      queueReport: buildEncounterAssetGenerationQueueReport(),
      replayWorkOrdersTwice: false,
    });

    expect(validateSharedAssetLibraryCacheEvidenceReport(report)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/summary/hitCount must be greater than 0 for reuse evidence",
      ]),
    });
  });

  it("validates reports from disk", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-shared-asset-cache-"));
    const reportPath = path.join(tempDir, "shared-asset-library-cache-evidence.json");
    const invalidPath = path.join(tempDir, "shared-asset-library-cache-evidence-invalid.json");
    try {
      const report = buildSharedAssetLibraryCacheEvidenceReport({
        generatedAt: "2026-05-25T10:00:00.000Z",
      });
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      await expect(readFile(reportPath, "utf8").then(JSON.parse).then(validateSharedAssetLibraryCacheEvidenceReport)).resolves.toEqual({ ok: true });

      const invalid = structuredClone(report);
      invalid.cachePolicy.evictionPolicy = "random" as never;
      await writeFile(invalidPath, `${JSON.stringify(invalid, null, 2)}\n`, "utf8");
      await expect(readFile(invalidPath, "utf8").then(JSON.parse).then(validateSharedAssetLibraryCacheEvidenceReport)).resolves.toEqual({
        ok: false,
        errors: expect.arrayContaining([
          "/cachePolicy/evictionPolicy must be \"least_recently_used\"",
        ]),
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
