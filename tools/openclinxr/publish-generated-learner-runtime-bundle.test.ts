// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
  buildGeneratedLearnerRuntimeBundlePublicationReport,
  validateGeneratedLearnerRuntimeBundlePublicationReport,
} from "./publish-generated-learner-runtime-bundle.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runGeneratedLearnerRuntimeBundlePublicationCli } from "./publish-generated-learner-runtime-bundle.js";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "../../packages/openclinxr/asset-registry/src/index.js";

describe("generated learner runtime bundle publication report", () => {
  it("exposes a root package script", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:generated-learner-bundle:publish-plan"]).toBe(
      "tsx tools/openclinxr/publish-generated-learner-runtime-bundle.ts",
    );
  });

  it("builds a local-only publication report without learner-use readiness claims", () => {
    const report = buildGeneratedLearnerRuntimeBundlePublicationReport({
      generatedAt: "2026-05-24T14:00:00.000Z",
    });

    expect(report).toMatchObject({
      generatedAt: "2026-05-24T14:00:00.000Z",
      schemaVersion: "openclinxr.generated-learner-runtime-bundle-publication.v1",
      status: "planned_not_persisted",
      publication: {
        scenarioId: "ed_chest_pain_priority_v1",
        assetStoreKind: "azurite_blob",
        generatedAssetCount: 6,
        humanoidActorCount: 3,
        equipmentCount: 2,
        pendingEvidenceGateIds: ["runtime_realism_evidence", "visual_qa_evidence", "quest_runtime_evidence"],
        learnerRuntimeUseBlocked: true,
        claimBoundary: "local_publication_metadata_not_runtime_readiness",
        notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      },
      persistence: {
        mongoUriConfigured: false,
        mongoWritePerformed: false,
        blobWritePerformed: false,
        localReportOnly: true,
      },
      evidenceBoundaries: {
        localPublicationPlanPrepared: true,
        learnerRuntimeUseEnabled: false,
        cloudOperationPerformed: false,
        paidApisUsed: false,
        productionDeploymentPerformed: false,
        productionReadinessClaimed: false,
        questReadinessClaimed: false,
        clinicalValidityClaimed: false,
        scoringValidityClaimed: false,
      },
    });
    expect(validateGeneratedLearnerRuntimeBundlePublicationReport(report)).toEqual({ ok: true });
  });

  it("publishes metadata from an injected scenario learner bundle instead of hardcoding ED chest pain", () => {
    const pedsBundle = {
      ...createEdChestPainLocalLearnerRuntimeAssetBundle({
        assetStore: {
          storeKind: "azurite_blob",
          containerName: "openclinxr-assets",
        },
      }),
      bundleId: "local_exam_run:peds_asthma_parent_anxiety_encounter_v1:generated-runtime-assets",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      stationId: "peds_asthma_parent_anxiety_station_v1",
    };

    const report = buildGeneratedLearnerRuntimeBundlePublicationReport({
      generatedAt: "2026-05-26T00:00:00.000Z",
      learnerBundle: pedsBundle,
    });

    expect(report.publication).toMatchObject({
      bundleId: "local_exam_run:peds_asthma_parent_anxiety_encounter_v1:generated-runtime-assets",
      scenarioId: "peds_asthma_parent_anxiety_v1",
      stationId: "peds_asthma_parent_anxiety_station_v1",
      learnerRuntimeUseBlocked: true,
      claimBoundary: "local_publication_metadata_not_runtime_readiness",
    });
    expect(report.publication.notEvidenceFor).toContain("quest_readiness");
    expect(validateGeneratedLearnerRuntimeBundlePublicationReport(report)).toEqual({ ok: true });
  });

  it("reads a generated runtime bundle report from the CLI before planning publication", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-generated-publication-peds-"));
    const previousExitCode = process.exitCode;
    try {
      const bundleReportPath = path.join(tempDir, "generated-peds-bundle-report.json");
      const outputPath = path.join(tempDir, "publication.json");
      const pedsBundle = {
        ...createEdChestPainLocalLearnerRuntimeAssetBundle({
          assetStore: {
            storeKind: "azurite_blob",
            containerName: "openclinxr-assets",
          },
        }),
        bundleId: "local_exam_run:peds_asthma_parent_anxiety_encounter_v1:generated-runtime-assets",
        scenarioId: "peds_asthma_parent_anxiety_v1",
        stationId: "peds_asthma_parent_anxiety_station_v1",
      };
      await writeFile(bundleReportPath, `${JSON.stringify({
        schemaVersion: "openclinxr.generated-ed-station-runtime-bundle.v1",
        generatedAt: "2026-05-26T00:00:00.000Z",
        status: "bundle_ready",
        bundle: null,
        learnerBundle: pedsBundle,
        bundleBlobName: null,
        runtimeAssetReviewDecisions: [],
        blockers: [],
        productionCloudCall: false,
        notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      }, null, 2)}\n`, "utf8");

      await runGeneratedLearnerRuntimeBundlePublicationCli([
        "--bundle-report",
        bundleReportPath,
        "--output",
        outputPath,
      ]);
      const report = JSON.parse(await readFile(outputPath, "utf8")) as ReturnType<typeof buildGeneratedLearnerRuntimeBundlePublicationReport>;

      expect(report.sourceBundleReportPath).toBe(bundleReportPath);
      expect(report.publication.scenarioId).toBe("peds_asthma_parent_anxiety_v1");
      expect(report.publication.stationId).toBe("peds_asthma_parent_anxiety_station_v1");
      expect(report.evidenceBoundaries.learnerRuntimeUseEnabled).toBe(false);
      expect(validateGeneratedLearnerRuntimeBundlePublicationReport(report)).toEqual({ ok: true });
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes and validates local publication reports from the CLI", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-generated-publication-"));
    const previousExitCode = process.exitCode;
    try {
      const outputPath = path.join(tempDir, "publication.json");
      await runGeneratedLearnerRuntimeBundlePublicationCli(["--output", outputPath]);
      await expect(runGeneratedLearnerRuntimeBundlePublicationCli(["--validate", outputPath])).resolves.toBeUndefined();
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("prints help that states the local-only no-readiness boundary", async () => {
    const messages: string[] = [];
    const originalLog = console.log;
    try {
      console.log = (message?: unknown) => {
        messages.push(String(message));
      };
      await runGeneratedLearnerRuntimeBundlePublicationCli(["--help"]);
    } finally {
      console.log = originalLog;
    }

    expect(messages.join("\n")).toContain("generated learner runtime bundle publication plan");
    expect(messages.join("\n")).toContain("Local report planning only");
    expect(messages.join("\n")).toContain("no Blob/Mongo writes");
    expect(messages.join("\n")).toContain("Quest readiness");
  });

  it("returns safe argument errors for missing output or validation paths", async () => {
    await expect(runGeneratedLearnerRuntimeBundlePublicationCli(["--output"])).rejects.toThrow("--output requires a path value");
    await expect(runGeneratedLearnerRuntimeBundlePublicationCli(["--validate", "--stdout"])).rejects.toThrow("--validate requires a path value");
  });

  it("rejects ambiguous local report destinations", async () => {
    await expect(runGeneratedLearnerRuntimeBundlePublicationCli([
      "--stdout",
      "--output",
      "docs/openclinxr/generated-learner-runtime-bundle-publication-test.json",
    ])).rejects.toThrow("--stdout cannot be combined with --output");
  });

  it("rejects corrupted publication reports that overclaim runtime use", () => {
    const report = buildGeneratedLearnerRuntimeBundlePublicationReport();
    const invalid = structuredClone(report);
    invalid.publication.learnerRuntimeUseBlocked = false;
    invalid.evidenceBoundaries.questReadinessClaimed = true;

    expect(validateGeneratedLearnerRuntimeBundlePublicationReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/publication/learnerRuntimeUseBlocked must be true",
        "/evidenceBoundaries/questReadinessClaimed must be false",
      ]),
    });
  });
});
