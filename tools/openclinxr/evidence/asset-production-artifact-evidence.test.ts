import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAssetProductionArtifactEvidenceReport,
  runAssetProductionArtifactEvidenceCli,
  validateAssetProductionArtifactEvidenceReport,
} from "./asset-production-artifact-evidence.js";

describe("asset production artifact evidence report", () => {
  it("exposes generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:production:artifact-evidence"]).toBe(
      "tsx tools/openclinxr/evidence/asset-production-artifact-evidence.ts",
    );
    expect(rootPackage.scripts["asset:production:artifact-evidence:validate"]).toBe(
      "tsx tools/openclinxr/evidence/asset-production-artifact-evidence.ts --validate-latest",
    );
    expect(rootPackage.scripts["agent:verify"]).toContain("pnpm asset:production:artifact-evidence:validate");
  });

  it("builds a blocked artifact-evidence manifest for every approved production asset lane", async () => {
    await withTemporaryCwd(async () => {
      const report = buildAssetProductionArtifactEvidenceReport({
        generatedAt: "2026-05-06T20:00:00.000Z",
      });

      expect(report).toMatchObject({
        schemaVersion: "openclinxr.asset-production-artifact-evidence.v1",
        kind: "asset_production_artifact_evidence",
        status: "blocked",
        policy: {
          installsIntroduced: false,
          cloudApisUsed: false,
          paidApisUsed: false,
          externalAssetsUsed: false,
          generatedThirdPartyAssetsCommitted: false,
          productionAssetReadinessClaimed: false,
        },
        summary: {
          requiredLaneIds: [
            "generatedHumanRigging",
            "skinClothingProvenance",
            "medicalEquipmentLibrary",
            "environmentShell",
            "animationRetargeting",
            "lodTextureColliderBudget",
            "multiActorQuestBudget",
          ],
          observedLaneIds: [
            "generatedHumanRigging",
            "skinClothingProvenance",
            "medicalEquipmentLibrary",
            "environmentShell",
            "animationRetargeting",
            "lodTextureColliderBudget",
            "multiActorQuestBudget",
          ],
          artifactBackedLaneIds: [],
          placeholderOrFixtureLaneIds: [
            "generatedHumanRigging",
            "skinClothingProvenance",
            "medicalEquipmentLibrary",
            "environmentShell",
            "animationRetargeting",
            "lodTextureColliderBudget",
            "multiActorQuestBudget",
          ],
          missingLaneIds: [],
          allRequiredLanesObserved: true,
          allArtifactFilesMaterialized: false,
          artifactBackedProductionEvidenceObserved: false,
        },
        verdict: {
          passed: false,
          readyForProductionAssets: false,
        },
      });
      expect(report.records).toHaveLength(7);
      expect(report.records[0]).toMatchObject({
        laneId: "generatedHumanRigging",
        evidenceTier: "reviewed_local_clinical_asset_fixture",
        artifactBacked: false,
        materializedArtifactPaths: [],
        missingArtifactPaths: [
          ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human.glb",
          ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/canonical-skeleton-binding.json",
          ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/skin-weight-quality.json",
          ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human-realism-manifest.json",
        ],
        blockers: [
          "evidence_tier_not_reviewed_generated_production_source",
          "artifact_files_missing",
        ],
      });
      expect(report.verdict.blockers).toEqual(expect.arrayContaining([
        "artifact_backed_production_asset_evidence_missing",
        "generatedHumanRigging:evidence_tier_not_reviewed_generated_production_source",
        "generatedHumanRigging:artifact_files_missing",
        "environmentShell:artifact_files_missing",
        "multiActorQuestBudget:artifact_files_missing",
      ]));
    });
  });

  it("does not report artifact_files_missing when fixture artifacts are materialized", async () => {
    await withTemporaryCwd(async () => {
      const generatedHumanRiggingPaths = [
        ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human.glb",
        ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/canonical-skeleton-binding.json",
        ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/skin-weight-quality.json",
        ".openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human-realism-manifest.json",
      ];
      for (const artifactPath of generatedHumanRiggingPaths) {
        await mkdir(path.dirname(artifactPath), { recursive: true });
        await writeFile(artifactPath, artifactPath.endsWith(".glb") ? Buffer.from("fixture glb") : "{}\n");
      }

      const report = buildAssetProductionArtifactEvidenceReport({
        generatedAt: "2026-05-21T20:00:00.000Z",
      });
      const generatedHumanRiggingRecord = report.records.find(
        (record) => record.laneId === "generatedHumanRigging",
      );

      expect(generatedHumanRiggingRecord).toMatchObject({
        materializedArtifactPaths: generatedHumanRiggingPaths,
        missingArtifactPaths: [],
        blockers: ["evidence_tier_not_reviewed_generated_production_source"],
      });
      expect(report.verdict.blockers).toContain(
        "generatedHumanRigging:evidence_tier_not_reviewed_generated_production_source",
      );
      expect(report.verdict.blockers).not.toContain("generatedHumanRigging:artifact_files_missing");
      expect(validateAssetProductionArtifactEvidenceReport(report)).toEqual({ ok: true });
    });
  });

  it("validates report shape and refuses fake artifact-backed claims when files are absent", () => {
    return withTemporaryCwd(() => {
      const report = buildAssetProductionArtifactEvidenceReport({
        generatedAt: "2026-05-06T20:00:00.000Z",
      });
      expect(validateAssetProductionArtifactEvidenceReport(report)).toEqual({ ok: true });

      const invalid = structuredClone(report);
      invalid.records[0].evidenceTier = "reviewed_generated_production_source";
      invalid.records[0].artifactBacked = true;
      invalid.records[0].missingArtifactPaths = [];
      invalid.summary.artifactBackedLaneIds = ["generatedHumanRigging"];
      invalid.summary.placeholderOrFixtureLaneIds = invalid.summary.placeholderOrFixtureLaneIds.filter(
        (laneId) => laneId !== "generatedHumanRigging",
      );

      expect(validateAssetProductionArtifactEvidenceReport(invalid)).toEqual({
        ok: false,
        errors: expect.arrayContaining([
          "/records/0/artifactBacked cannot be true while artifact path is missing: .openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human.glb",
          "/records/0/missingArtifactPaths must include missing artifact path .openclinxr/asset-production/ed-chest-pain/generated-human-rigging/neutral-generated-human.glb",
        ]),
      });
    });
  });

  it("rejects duplicated and missing canonical lanes", () => {
    const report = buildAssetProductionArtifactEvidenceReport({
      generatedAt: "2026-05-06T20:00:00.000Z",
    });
    const invalid = structuredClone(report);
    invalid.records[1] = structuredClone(invalid.records[0]);

    expect(validateAssetProductionArtifactEvidenceReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/records must not repeat canonical lane id generatedHumanRigging",
        "/records must include canonical lane id skinClothingProvenance",
      ]),
    });
  });

  it("validates artifact evidence reports from the CLI", async () => {
    await withTemporaryCwd(async () => {
      const outputPath = path.join("docs/openclinxr", "asset-production-artifact-evidence-2026-05-06.json");
      await mkdir(path.dirname(outputPath), { recursive: true });
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-asset-artifact-evidence-"));
      const invalidPath = path.join(tempDir, "asset-production-artifact-evidence-invalid.json");
      const previousExitCode = process.exitCode;

      try {
        await runAssetProductionArtifactEvidenceCli(["--output", outputPath]);

        await expect(runAssetProductionArtifactEvidenceCli(["--validate", outputPath])).resolves.toBeUndefined();
        await expect(runAssetProductionArtifactEvidenceCli(["--validate-latest"])).resolves.toBeUndefined();

        const invalidReport = JSON.parse(await readFile(outputPath, "utf8"));
        invalidReport.policy.productionAssetReadinessClaimed = true;
        await writeFile(invalidPath, `${JSON.stringify(invalidReport, null, 2)}\n`, "utf8");

        process.exitCode = undefined;
        await runAssetProductionArtifactEvidenceCli(["--validate", invalidPath]);
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = previousExitCode;
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});

async function withTemporaryCwd<T>(callback: () => Promise<T> | T): Promise<T> {
  const previousCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-asset-artifact-evidence-cwd-"));
  process.chdir(tempDir);
  try {
    return await callback();
  } finally {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}
