import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEnvironmentArtifactsReport,
  buildEnvironmentRuntimeAssetReference,
  runEnvironmentArtifactsCli,
  validateEnvironmentArtifactsReport,
  writeEnvironmentArtifacts,
} from "./environment-artifacts.js";

describe("environment artifacts", () => {
  it("exposes generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:environment:generate"]).toBe(
      "tsx tools/openclinxr/evidence/environment-artifacts.ts",
    );
    expect(rootPackage.scripts["asset:environment:validate"]).toBe(
      "tsx tools/openclinxr/evidence/environment-artifacts.ts --validate-latest",
    );
  });

  it("blocks when environment artifact files are missing", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-missing-environment-artifacts-"));
    try {
      const report = await buildEnvironmentArtifactsReport({
        generatedAt: "2026-05-21T00:00:00.000Z",
        outputRoot: path.join(tempDir, "missing"),
      });

      expect(report.verdict.passed).toBe(false);
      expect(report.verdict.readyForProductionEnvironment).toBe(false);
      expect(report.verdict.blockers).toEqual(expect.arrayContaining([
        expect.stringContaining("edExamBayShellGlbPath_missing:"),
        expect.stringContaining("layoutManifestPath_missing:"),
        expect.stringContaining("equipmentPlacementManifestPath_missing:"),
        expect.stringContaining("questBudgetPath_missing:"),
      ]));
      expect(validateEnvironmentArtifactsReport(report)).toEqual({
        ok: false,
        errors: expect.arrayContaining([
          "/output/edExamBayShellGlbBytes must be a positive integer",
          "/output/spatialZoneCount must be a positive integer",
          "/output/equipmentPlacementCount must be a positive integer",
          "/output/interactionAnchorCount must be a positive integer",
          "/output/environmentRealismCueCount must be a positive integer",
        ]),
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes a local ED bay layout evidence bundle without readiness claims", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-environment-artifacts-"));
    const reportPath = path.join(tempDir, "environment-artifacts.json");
    try {
      const report = await writeEnvironmentArtifacts({
        outputRoot: path.join(tempDir, "environment"),
        reportPath,
      });

      expect(report.verdict).toEqual({
        passed: true,
        readyForProductionEnvironment: false,
        blockers: [],
      });
      expect(report.policy).toMatchObject({
        cloudApisUsed: false,
        paidApisUsed: false,
        externalAssetsUsed: false,
        productionAssetReadinessClaimed: false,
        questReadinessClaimed: false,
      });
      expect(report.output).toMatchObject({
        edExamBayShellGlbBytes: expect.any(Number),
        spatialZoneCount: 8,
        equipmentPlacementCount: 24,
        interactionAnchorCount: 22,
        environmentRealismCueCount: 46,
      });
      expect(validateEnvironmentArtifactsReport(report)).toEqual({ ok: true, errors: [] });
      await expect(runEnvironmentArtifactsCli(["--validate", reportPath])).resolves.toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("builds a bundle-ready environment runtime asset reference", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-environment-runtime-"));
    try {
      const outputRoot = path.join(tempDir, "environment");
      await mkdir(outputRoot, { recursive: true });
      await writeFile(path.join(outputRoot, "ed-exam-bay-shell.glb"), "glTF", "utf8");
      await writeFile(
        path.join(outputRoot, "ed-exam-bay-layout.json"),
        JSON.stringify({
          spatialZones: [{ interactionAnchors: ["entry_prompt"], zoneId: "zone-1", description: "fixture", center: { x: 0, y: 0, z: 0 } }],
          claimBoundary: "fixture",
        }, null, 2),
        "utf8",
      );
      await writeFile(
        path.join(outputRoot, "equipment-placement-manifest.json"),
        JSON.stringify({ equipmentPlacements: [{}] }, null, 2),
        "utf8",
      );
      await writeFile(
        path.join(outputRoot, "quest-environment-budget.json"),
        JSON.stringify({ blockedClaims: [] }, null, 2),
        "utf8",
      );

      const report = await buildEnvironmentArtifactsReport({
        generatedAt: "2026-05-21T00:00:00.000Z",
        outputRoot,
      });
      const runtimeAsset = buildEnvironmentRuntimeAssetReference(report);

      expect(runtimeAsset).toMatchObject({
        assetId: "ed_exam_bay_environment_shell_glb",
        kind: "environment_model",
        scenarioAssetId: "ed_exam_bay_environment",
        reviewStatus: "approved_for_local_runtime",
        blob: {
          storeKind: "azurite_blob",
          containerName: "openclinxr-assets",
          contentType: "model/gltf-binary",
        },
      });
      expect(runtimeAsset.blob.url).toBe(
        `http://127.0.0.1:10000/devstoreaccount1/openclinxr-assets/${report.artifacts.edExamBayShellGlbPath}`,
      );
      expect(runtimeAsset.provenanceRefs).toEqual(expect.arrayContaining([
        report.artifacts.layoutManifestPath,
        report.artifacts.equipmentPlacementManifestPath,
        report.artifacts.questBudgetPath,
        report.artifacts.edExamBayShellGlbPath,
      ]));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects production or Quest readiness claims", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-environment-invalid-"));
    try {
      const report = await writeEnvironmentArtifacts({
        outputRoot: path.join(tempDir, "environment"),
        reportPath: path.join(tempDir, "environment-artifacts.json"),
      });
      const invalid = structuredClone(report) as unknown as {
        policy: { productionAssetReadinessClaimed: boolean; questReadinessClaimed: boolean };
        verdict: { readyForProductionEnvironment: boolean };
      };
      invalid.policy.productionAssetReadinessClaimed = true;
      invalid.policy.questReadinessClaimed = true;
      invalid.verdict.readyForProductionEnvironment = true;

      expect(validateEnvironmentArtifactsReport(invalid)).toEqual({
        ok: false,
        errors: expect.arrayContaining([
          "/policy/productionAssetReadinessClaimed must be false",
          "/policy/questReadinessClaimed must be false",
          "/verdict/readyForProductionEnvironment must be false",
        ]),
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("sets exitCode for invalid CLI validation without throwing", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-environment-cli-invalid-"));
    const invalidPath = path.join(tempDir, "environment-artifacts-invalid.json");
    const previousExitCode = process.exitCode;
    try {
      await writeFile(invalidPath, `${JSON.stringify({ kind: "wrong" }, null, 2)}\n`, "utf8");
      process.exitCode = undefined;
      await runEnvironmentArtifactsCli(["--validate", invalidPath]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
