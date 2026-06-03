import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  attemptGeneratedHumanoidUpload,
  runAzuriteAssetUploadSmokeCli,
  validateAzuriteAssetUploadSmokeReport,
} from "./azurite-asset-upload-smoke.js";

describe("azurite asset upload smoke", () => {
  it("reports not_configured when generated humanoid report is missing", async () => {
    const report = await attemptGeneratedHumanoidUpload("missing-generated-human-rigging-report.json");

    expect(report).toMatchObject({
      schemaVersion: "openclinxr.azurite-asset-upload-smoke.v1",
      mode: "attempt_upload",
      status: "not_configured",
      productionCloudCall: false,
      blocker: "generated_human_rigging_report_missing",
    });
    expect(validateAzuriteAssetUploadSmokeReport(report)).toEqual({ ok: true, errors: [] });
  });

  it("writes and validates a default not_configured report without requiring a running emulator", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-azurite-upload-smoke-"));
    const outputPath = path.join(tempDir, "azurite-upload-smoke.json");
    const previousExitCode = process.exitCode;

    try {
      await runAzuriteAssetUploadSmokeCli(["--output", outputPath]);
      const report = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      expect(validateAzuriteAssetUploadSmokeReport(report)).toEqual({ ok: true, errors: [] });
      await runAzuriteAssetUploadSmokeCli(["--validate-latest", "--output", outputPath]);
      expect(process.exitCode).toBe(previousExitCode);
    } finally {
      process.exitCode = previousExitCode;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects uploaded reports that point at non-local storage", () => {
    expect(validateAzuriteAssetUploadSmokeReport({
      schemaVersion: "openclinxr.azurite-asset-upload-smoke.v1",
      generatedAt: "2026-05-22T00:00:00.000Z",
      mode: "attempt_upload",
      emulator: {
        storeKind: "azurite_blob",
        accountName: "devstoreaccount1",
        containerName: "openclinxr-assets",
        baseUrl: "http://127.0.0.1:10000/devstoreaccount1",
        expectedEndpoint: "http://127.0.0.1:10000/devstoreaccount1/openclinxr-assets",
        productionCloudCall: false,
      },
      status: "uploaded",
      productionCloudCall: false,
      asset: {
        assetId: "patient",
        blobName: "patient.glb",
        url: "https://example.blob.core.windows.net/openclinxr-assets/patient.glb",
        manifestBlobName: "asset.runtime-manifest.json",
        contentType: "model/gltf-binary",
      },
      blocker: null,
      nextOperatorAction: null,
      notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    })).toEqual({
      ok: false,
      errors: ["/asset/url must be local Azurite URL when uploaded"],
    });
  });

  it("exposes root package scripts for local emulator smoke usage", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(rootPackage.scripts["asset:azurite:upload-smoke"]).toBe("tsx tools/openclinxr/azurite-asset-upload-smoke.ts --attempt-upload");
    expect(rootPackage.scripts["asset:azurite:upload-smoke:validate"]).toBe("tsx tools/openclinxr/azurite-asset-upload-smoke.ts --validate-latest");
  });
});
