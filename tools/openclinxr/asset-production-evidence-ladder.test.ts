import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAssetProductionEvidenceLadderReport,
  runAssetProductionEvidenceLadderCli,
  validateAssetProductionEvidenceLadderReport,
} from "./asset-production-evidence-ladder.js";
import { buildAssetProductionReadinessReport } from "./asset-production-readiness-benchmark.js";

describe("asset production evidence ladder report", () => {
  it("exposes generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:production:ladder"]).toBe(
      "tsx tools/openclinxr/asset-production-evidence-ladder.ts",
    );
    expect(rootPackage.scripts["asset:production:ladder:validate"]).toBe(
      "tsx tools/openclinxr/asset-production-evidence-ladder.ts --validate-latest",
    );
    expect(rootPackage.scripts["agent:verify"]).toContain("pnpm asset:production:ladder:validate");
  });

  it("turns contract-only local asset fixture readiness into explicit blocked proof lanes", () => {
    const readiness = buildAssetProductionReadinessReport({
      generatedAt: "2026-05-06T12:00:00.000Z",
      gltfSmokeFile: "docs/openclinxr/gltf-pipeline-smoke-2026-05-06.json",
      blenderAssetBakeSmokeFile: "docs/openclinxr/blender-asset-bake-smoke-2026-05-06.json",
      gltfSmoke: gltfSmoke(),
      blenderAssetBakeSmoke: blenderSmokeWithClinicalInventory(),
      useLocalAssetEvidenceFixture: true,
    });

    const report = buildAssetProductionEvidenceLadderReport({
      generatedAt: "2026-05-06T12:05:00.000Z",
      readinessReportFile: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json",
      readinessReport: readiness,
    });

    expect(report).toMatchObject({
      schemaVersion: "openclinxr.asset-production-evidence-ladder.v1",
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
    const readinessPath = path.join(tempDir, "asset-production-readiness-benchmark.json");

    try {
      await writeReadinessFixture(readinessPath);
      await runAssetProductionEvidenceLadderCli([
        "--readiness",
        readinessPath,
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

  it("validates generated ladder reports before reuse", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-asset-ladder-validate-"));
    const outputPath = path.join(tempDir, "asset-production-evidence-ladder.json");
    const readinessPath = path.join(tempDir, "asset-production-readiness-benchmark.json");
    const invalidPath = path.join(tempDir, "asset-production-evidence-ladder-invalid.json");
    const staleSourcePath = path.join(tempDir, "asset-production-evidence-ladder-stale-source.json");
    const previousExitCode = process.exitCode;

    try {
      await writeReadinessFixture(readinessPath);
      await runAssetProductionEvidenceLadderCli([
        "--readiness",
        readinessPath,
        "--output",
        outputPath,
      ]);

      await expect(runAssetProductionEvidenceLadderCli(["--validate", outputPath])).resolves.toBeUndefined();
      await expect(runAssetProductionEvidenceLadderCli(["--validate-latest"])).resolves.toBeUndefined();

      const staleSourceReport = JSON.parse(await readFile(outputPath, "utf8"));
      staleSourceReport.sourceReadinessReport.generatedAt = "2026-05-06T00:00:00.000Z";
      await writeFile(staleSourcePath, `${JSON.stringify(staleSourceReport, null, 2)}\n`, "utf8");

      process.exitCode = undefined;
      await runAssetProductionEvidenceLadderCli(["--validate", staleSourcePath]);
      expect(process.exitCode).toBe(1);

      const invalidReport = JSON.parse(await readFile(outputPath, "utf8"));
      delete invalidReport.schemaVersion;
      await writeFile(invalidPath, `${JSON.stringify(invalidReport, null, 2)}\n`, "utf8");

      process.exitCode = undefined;
      await runAssetProductionEvidenceLadderCli(["--validate", invalidPath]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid source readiness reports before writing derived ladder evidence", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-asset-ladder-invalid-readiness-"));
    const readinessPath = path.join(tempDir, "asset-production-readiness-invalid.json");
    const outputPath = path.join(tempDir, "asset-production-evidence-ladder.json");
    const previousExitCode = process.exitCode;

    try {
      const readiness = buildAssetProductionReadinessReport({
        generatedAt: "2026-05-06T12:00:00.000Z",
        gltfSmokeFile: "docs/openclinxr/gltf-pipeline-smoke-2026-05-06.json",
        blenderAssetBakeSmokeFile: "docs/openclinxr/blender-asset-bake-smoke-2026-05-06.json",
        gltfSmoke: gltfSmoke(),
        blenderAssetBakeSmoke: blenderSmokeWithClinicalInventory(),
        useLocalAssetEvidenceFixture: true,
      });
      const invalidReadiness = structuredClone(readiness) as Record<string, unknown>;
      delete invalidReadiness.policy;
      await writeFile(readinessPath, `${JSON.stringify(invalidReadiness, null, 2)}\n`, "utf8");

      process.exitCode = undefined;
      await runAssetProductionEvidenceLadderCli([
        "--readiness",
        readinessPath,
        "--output",
        outputPath,
      ]);

      expect(process.exitCode).toBe(1);
      await expect(stat(outputPath)).rejects.toThrow();
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects malformed lane evidence inside an otherwise valid report", () => {
    const readiness = buildAssetProductionReadinessReport({
      generatedAt: "2026-05-06T12:00:00.000Z",
      gltfSmokeFile: "docs/openclinxr/gltf-pipeline-smoke-2026-05-06.json",
      blenderAssetBakeSmokeFile: "docs/openclinxr/blender-asset-bake-smoke-2026-05-06.json",
      gltfSmoke: gltfSmoke(),
      blenderAssetBakeSmoke: blenderSmokeWithClinicalInventory(),
      useLocalAssetEvidenceFixture: true,
    });
    const report = buildAssetProductionEvidenceLadderReport({
      generatedAt: "2026-05-06T12:05:00.000Z",
      readinessReportFile: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json",
      readinessReport: readiness,
    });
    const malformed = structuredClone(report) as Record<string, unknown>;
    (malformed.lanes as Array<Record<string, unknown>>)[0] = {
      id: "generatedHumanRigging",
      title: "Generated human rigging",
      status: "contract_only",
    };

    expect(validateAssetProductionEvidenceLadderReport(malformed)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/lanes/0/requiredArtifactEvidence must be array",
        "/lanes/0/currentEvidence must be object",
        "/lanes/0/claimBoundary must be object",
        "/lanes/0/blockers must be array",
      ]),
    });
  });

  it("rejects internally inconsistent lane counts and verdict blockers", () => {
    const readiness = buildAssetProductionReadinessReport({
      generatedAt: "2026-05-06T12:00:00.000Z",
      gltfSmokeFile: "docs/openclinxr/gltf-pipeline-smoke-2026-05-06.json",
      blenderAssetBakeSmokeFile: "docs/openclinxr/blender-asset-bake-smoke-2026-05-06.json",
      gltfSmoke: gltfSmoke(),
      blenderAssetBakeSmoke: blenderSmokeWithClinicalInventory(),
      useLocalAssetEvidenceFixture: true,
    });
    const report = buildAssetProductionEvidenceLadderReport({
      generatedAt: "2026-05-06T12:05:00.000Z",
      readinessReportFile: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json",
      readinessReport: readiness,
    });
    const inconsistent = structuredClone(report);
    inconsistent.summary.totalLaneCount = 6;
    inconsistent.verdict.blockers = [
      "artifact_backed_production_asset_evidence_missing",
      "generatedHumanRigging:contract_only_fixture_not_artifact_backed",
    ];

    expect(validateAssetProductionEvidenceLadderReport(inconsistent)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/summary/totalLaneCount must match lanes.length",
        "/verdict/blockers must include lane blocker skinClothingProvenance:contract_only_fixture_not_artifact_backed",
      ]),
    });
  });

  it("rejects duplicated or missing canonical proof lanes", () => {
    const readiness = buildAssetProductionReadinessReport({
      generatedAt: "2026-05-06T12:00:00.000Z",
      gltfSmokeFile: "docs/openclinxr/gltf-pipeline-smoke-2026-05-06.json",
      blenderAssetBakeSmokeFile: "docs/openclinxr/blender-asset-bake-smoke-2026-05-06.json",
      gltfSmoke: gltfSmoke(),
      blenderAssetBakeSmoke: blenderSmokeWithClinicalInventory(),
      useLocalAssetEvidenceFixture: true,
    });
    const report = buildAssetProductionEvidenceLadderReport({
      generatedAt: "2026-05-06T12:05:00.000Z",
      readinessReportFile: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-06.json",
      readinessReport: readiness,
    });
    const invalid = structuredClone(report);
    invalid.lanes[1] = structuredClone(invalid.lanes[0]);

    expect(validateAssetProductionEvidenceLadderReport(invalid)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/lanes must not repeat canonical lane id generatedHumanRigging",
        "/lanes must include canonical lane id skinClothingProvenance",
      ]),
    });
  });
});

async function writeReadinessFixture(filePath: string): Promise<void> {
  const readiness = buildAssetProductionReadinessReport({
    generatedAt: "2026-05-06T12:00:00.000Z",
    gltfSmokeFile: "docs/openclinxr/gltf-pipeline-smoke-2026-05-06.json",
    blenderAssetBakeSmokeFile: "docs/openclinxr/blender-asset-bake-smoke-2026-05-06.json",
    gltfSmoke: gltfSmoke(),
    blenderAssetBakeSmoke: blenderSmokeWithClinicalInventory(),
    useLocalAssetEvidenceFixture: true,
  });
  await writeFile(filePath, `${JSON.stringify(readiness, null, 2)}\n`, "utf8");
}

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
