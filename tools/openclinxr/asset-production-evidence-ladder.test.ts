import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAssetProductionReadinessReport } from "./asset-production-readiness-benchmark.js";
import {
  buildAssetProductionEvidenceLadderReport,
  runAssetProductionEvidenceLadderCli,
} from "./asset-production-evidence-ladder.js";

describe("asset production evidence ladder report", () => {
  it("turns contract-only local asset fixture readiness into explicit blocked proof lanes", () => {
    const readiness = buildAssetProductionReadinessReport({
      generatedAt: "2026-05-06T12:00:00.000Z",
      gltfPipelineSmokeFile: "docs/openclinxr/gltf-pipeline-smoke-2026-05-06.json",
      blenderAssetBakeSmokeFile: "docs/openclinxr/blender-asset-bake-smoke-2026-05-06.json",
      gltfPipelineSmoke: gltfSmoke(),
      blenderAssetBakeSmoke: blenderSmokeWithClinicalInventory(),
      useLocalAssetEvidenceFixture: true,
    });

    const report = buildAssetProductionEvidenceLadderReport({
      generatedAt: "2026-05-06T12:05:00.000Z",
      readinessReportFile: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json",
      readinessReport: readiness,
    });

    expect(report).toMatchObject({
      kind: "asset_production_evidence_ladder",
      status: "blocked",
      sourceReadinessReport: {
        file: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json",
        status: "blocked",
        localAssetEvidenceFixtureUsed: true,
      },
      policy: {
        installsIntroduced: false,
        cloudApisUsed: false,
        paidApisUsed: false,
        externalAssetsUsed: false,
        productionAssetReadinessClaimed: false,
      },
      summary: {
        totalLaneCount: 7,
        observedLaneCount: 0,
        contractOnlyLaneCount: 6,
        blockedLaneCount: 7,
        artifactBackedProductionAssetEvidenceObserved: false,
      },
      verdict: {
        passed: false,
        readyForProductionAssets: false,
        blockers: [
          "artifact_backed_production_asset_evidence_missing",
          "generatedHumanRigging:contract_only_fixture_not_artifact_backed",
          "skinClothingProvenance:contract_only_fixture_not_artifact_backed",
          "medicalEquipmentLibrary:contract_only_fixture_not_artifact_backed",
          "animationRetargeting:contract_only_fixture_not_artifact_backed",
          "lodTextureColliderBudget:contract_only_fixture_not_artifact_backed",
          "multiActorQuestBudget:contract_only_fixture_not_artifact_backed",
        ],
      },
    });
    expect(report.lanes.map((lane) => lane.id)).toEqual([
      "generatedHumanRigging",
      "skinClothingProvenance",
      "medicalEquipmentLibrary",
      "animationRetargeting",
      "lodTextureColliderBudget",
      "multiActorQuestBudget",
      "artifactBackedProductionAssetEvidence",
    ]);
    expect(report.lanes[0]).toMatchObject({
      id: "generatedHumanRigging",
      title: "Generated human rigging",
      status: "contract_only",
      currentEvidence: {
        source: "asset_production_readiness_benchmark.productionProofs.generatedHumanRigging",
        observed: true,
        posture: "contract_only_fixture",
      },
      blockers: ["contract_only_fixture_not_artifact_backed"],
    });
    expect(report.lanes[6]).toMatchObject({
      id: "artifactBackedProductionAssetEvidence",
      title: "Artifact-backed production asset evidence",
      status: "blocked",
      blockers: ["artifact_backed_production_asset_evidence_missing"],
      claimBoundary: {
        allowedClaims: [
          "local asset evidence fixture contract slots observed",
          "reviewed local clinical fixture semantic inventory observed",
        ],
      },
    });
  });

  it("writes a report from the CLI without mutating production readiness claims", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-asset-ladder-"));
    const outputPath = path.join(tempDir, "asset-production-evidence-ladder.json");

    try {
      await runAssetProductionEvidenceLadderCli([
        "--readiness",
        "docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json",
        "--output",
        outputPath,
      ]);

      const report = JSON.parse(await readFile(outputPath, "utf8"));
      expect(report.kind).toBe("asset_production_evidence_ladder");
      expect(report.policy.productionAssetReadinessClaimed).toBe(false);
      expect(report.verdict.readyForProductionAssets).toBe(false);
      expect(report.verdict.blockers).toContain("artifact_backed_production_asset_evidence_missing");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function gltfSmoke() {
  return {
    generatedAt: "2026-05-06T00:10:04.220Z",
    tool: {
      command: "gltf-pipeline",
      package: "gltf-pipeline",
      version: "4.3.1",
      license: "Apache-2.0",
    },
    output: {
      glbBytes: 848,
      magic: "glTF",
      version: 2,
      declaredLength: 848,
      elapsedMs: 431.5,
    },
    verdict: {
      passed: true,
      blockers: [],
    },
  };
}

function blenderSmokeWithClinicalInventory() {
  const names = [
    "ed_exam_bay_floor_panel",
    "ed_exam_bay_back_wall",
    "stretcher_frame_with_side_rails",
    "patient_robert_hayes_canonical_skeleton_anchor",
    "nurse_maria_alvarez_canonical_skeleton_anchor",
    "ecg_cart_12_lead",
    "iv_pole_with_pump",
    "asset_pack_scale_and_origin_marker",
  ];

  return {
    generatedAt: "2026-05-06T08:19:07.305Z",
    tool: {
      command: "blender",
      package: "Blender",
      version: "Blender 5.1.1",
      license: "GPL-3.0-or-later-tooling",
    },
    input: {
      fixture: "ed_chest_pain_clinical_asset_pack",
      externalAssetsUsed: false,
      sourceLicensePosture: "reviewed_local_clinical_asset_fixture",
      expectedObjectCount: names.length,
    },
    output: {
      glbBytes: 109040,
      magic: "glTF",
      version: 2,
      declaredLength: 109040,
      elapsedMs: 5608.9,
      semanticInventory: {
        sceneCount: 1,
        nodeCount: names.length,
        meshCount: names.length,
        materialCount: 2,
        observedObjectNames: names,
        requiredObjectNames: names,
        missingRequiredObjectNames: [],
      },
    },
    verdict: {
      passed: true,
      blockers: [],
    },
  };
}
