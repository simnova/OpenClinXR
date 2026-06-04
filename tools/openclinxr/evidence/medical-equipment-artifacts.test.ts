import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMedicalEquipmentArtifactsReport,
  buildMedicalEquipmentRuntimeAssetReferences,
  runMedicalEquipmentArtifactsCli,
  validateMedicalEquipmentArtifactsReport,
} from "./medical-equipment-artifacts.js";

describe("medical equipment artifacts", () => {
  it("exposes generation and validation scripts", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(rootPackage.scripts["asset:medical-equipment:generate"]).toBe(
      "tsx tools/openclinxr/evidence/medical-equipment-artifacts.ts",
    );
    expect(rootPackage.scripts["asset:medical-equipment:validate"]).toBe(
      "tsx tools/openclinxr/evidence/medical-equipment-artifacts.ts --validate-latest",
    );
  });

  it("blocks when equipment artifacts are missing", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-missing-medical-equipment-"));
    try {
      const report = await buildMedicalEquipmentArtifactsReport({
        generatedAt: "2026-05-21T00:00:00.000Z",
        outputRoot: path.join(tempDir, "missing"),
      });

      expect(report.verdict.passed).toBe(false);
      expect(report.verdict.blockers).toEqual(expect.arrayContaining([
        expect.stringContaining("artifact_file_missing:"),
      ]));
      expect(validateMedicalEquipmentArtifactsReport(report)).toEqual({ ok: true, errors: [] });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("validates report posture and blocker consistency", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-medical-equipment-validate-"));
    try {
      const report = await buildMedicalEquipmentArtifactsReport({
        generatedAt: "2026-05-21T00:00:00.000Z",
        outputRoot: path.join(tempDir, "missing"),
      });
      const invalid = structuredClone(report) as unknown as {
        policy: { externalAssetsUsed: boolean };
        verdict: { blockers: string[] };
      };
      invalid.policy.externalAssetsUsed = true;
      invalid.verdict.blockers = [];

      expect(validateMedicalEquipmentArtifactsReport(invalid)).toEqual({
        ok: false,
        errors: expect.arrayContaining([
          "/policy/externalAssetsUsed must be false",
          expect.stringContaining("/verdict/blockers must include artifact_file_missing:"),
        ]),
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("builds bundle-ready runtime asset references for medical equipment artifacts", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-medical-equipment-runtime-"));
    try {
      const outputRoot = path.join(tempDir, "artifacts");
      await mkdir(outputRoot, { recursive: true });
      await writeFile(path.join(outputRoot, "ecg-cart-12-lead.glb"), "glTF", "utf8");
      await writeFile(path.join(outputRoot, "iv-pole-with-pump.glb"), "glTF", "utf8");
      await writeFile(
        path.join(outputRoot, "equipment-provenance.json"),
        JSON.stringify({ schemaVersion: "fixture", kind: "fixture" }, null, 2),
        "utf8",
      );
      await writeFile(
        path.join(outputRoot, "ed-chest-pain-equipment-realism-manifest.json"),
        JSON.stringify({ schemaVersion: "fixture", kind: "fixture" }, null, 2),
        "utf8",
      );

      const report = await buildMedicalEquipmentArtifactsReport({
        generatedAt: "2026-05-21T00:00:00.000Z",
        outputRoot,
      });
      const [ecgCart, ivPole] = buildMedicalEquipmentRuntimeAssetReferences(report);

      expect(ecgCart).toMatchObject({
        assetId: "ecg_cart_12_lead_glb",
        kind: "equipment_model",
        scenarioAssetId: "ecg_cart_12_lead",
        reviewStatus: "approved_for_local_runtime",
        blob: {
          storeKind: "azurite_blob",
          containerName: "openclinxr-assets",
          contentType: "model/gltf-binary",
        },
      });
      expect(ecgCart.blob.url).toBe(
        `http://127.0.0.1:10000/devstoreaccount1/openclinxr-assets/${report.artifacts.ecgCartGlbPath}`,
      );

      expect(ivPole).toMatchObject({
        assetId: "iv_pole_with_pump_glb",
        kind: "equipment_model",
        scenarioAssetId: "iv_stand_equipment",
        reviewStatus: "approved_for_local_runtime",
      });
      expect(ivPole.blob.url).toBe(`http://127.0.0.1:10000/devstoreaccount1/openclinxr-assets/${report.artifacts.ivPoleWithPumpGlbPath}`);
      expect(ecgCart.provenanceRefs).toEqual(expect.arrayContaining([
        report.artifacts.equipmentProvenancePath,
        report.artifacts.equipmentRealismManifestPath,
        "shared-asset-library-lookup://medical_equipment_glb__scenario__ed_chest_pain_station_v1__clinical_zone_layout__recognizable_ed_props__functional_placement__scale_validation__cable_tube_logic",
        report.artifacts.ecgCartGlbPath,
      ]));
      expect(ivPole.provenanceRefs).toEqual(expect.arrayContaining([
        report.artifacts.equipmentProvenancePath,
        report.artifacts.equipmentRealismManifestPath,
        "shared-asset-library-lookup://medical_equipment_glb__scenario__ed_chest_pain_station_v1__clinical_zone_layout__recognizable_ed_props__functional_placement__scale_validation__cable_tube_logic",
        report.artifacts.ivPoleWithPumpGlbPath,
      ]));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("validates medical equipment reports from the CLI without launching Blender", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-medical-equipment-cli-"));
    const reportPath = path.join(tempDir, "medical-equipment-artifacts.json");
    const invalidPath = path.join(tempDir, "medical-equipment-artifacts-invalid.json");
    const previousExitCode = process.exitCode;

    try {
      const report = await buildMedicalEquipmentArtifactsReport({
        generatedAt: "2026-05-21T00:00:00.000Z",
        outputRoot: path.join(tempDir, "missing"),
      });
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      await expect(runMedicalEquipmentArtifactsCli(["--validate", reportPath])).resolves.toBeUndefined();

      const invalidReport = structuredClone(report) as Record<string, unknown>;
      delete invalidReport.schemaVersion;
      await writeFile(invalidPath, `${JSON.stringify(invalidReport, null, 2)}\n`, "utf8");

      process.exitCode = undefined;
      await runMedicalEquipmentArtifactsCli(["--validate", invalidPath]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
