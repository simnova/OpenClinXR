import { describe, expect, it } from "vitest";
import type { AssetObjectStore, AssetObjectStorePutInput, AssetObjectStorePutResult } from "./object-store.js";
import { buildEncounterRuntimeAssetBundle, registerGeneratedRuntimeAssetReference, resolveRuntimeAssetStoreConfig } from "./runtime-bundles.js";
import {
  encounterRuntimeAssetBundleBlobName,
  runtimeAssetManifestBlobName,
  writeEncounterRuntimeAssetBundle,
  writeGeneratedRuntimeAssetWithManifest,
} from "./asset-writer.js";

describe("asset writer", () => {
  it("writes generated asset bytes plus a sidecar runtime manifest through the object store", async () => {
    const store = fakeObjectStore();
    const assetStore = resolveRuntimeAssetStoreConfig({ storeKind: "azurite_blob", containerName: "openclinxr-assets" });
    const asset = registerGeneratedRuntimeAssetReference({
      assetId: "generated_patient_model_v17",
      version: "v17",
      kind: "humanoid_model",
      displayName: "Generated patient model v17",
      scenarioAssetId: "patient_robert_hayes_character",
      blobName: "tenants/local/asset-library/generated_patient_model_v17/v17/model.glb",
      contentType: "model/gltf-binary",
      assetStore,
      reviewStatus: "approved_for_local_runtime",
      provenanceRefs: ["rigging-report-v17"],
    });

    await expect(writeGeneratedRuntimeAssetWithManifest({ store, asset, body: "glb-bytes" })).resolves.toMatchObject({
      manifestBlobName: "tenants/local/asset-library/generated_patient_model_v17/v17/asset.runtime-manifest.json",
    });
    expect(store.puts.map((put) => put.blobName)).toEqual([
      "tenants/local/asset-library/generated_patient_model_v17/v17/model.glb",
      "tenants/local/asset-library/generated_patient_model_v17/v17/asset.runtime-manifest.json",
    ]);
    const manifest = JSON.parse(String(store.puts[1]?.body)) as { schemaVersion: string; productionCloudCall: boolean };
    expect(manifest.schemaVersion).toBe("openclinxr.runtime-asset-manifest.v1");
    expect(manifest.productionCloudCall).toBe(false);
    expect(runtimeAssetManifestBlobName(asset)).toBe("tenants/local/asset-library/generated_patient_model_v17/v17/asset.runtime-manifest.json");
  });

  it("rejects blocked generated assets before storage writes", async () => {
    const store = fakeObjectStore();
    const asset = registerGeneratedRuntimeAssetReference({
      assetId: "blocked_patient_model",
      version: "v1",
      kind: "humanoid_model",
      displayName: "Blocked patient model",
      scenarioAssetId: "patient_robert_hayes_character",
      blobName: "tenants/local/asset-library/blocked_patient_model/v1/model.glb",
      assetStore: resolveRuntimeAssetStoreConfig({ storeKind: "azurite_blob", containerName: "openclinxr-assets" }),
      reviewStatus: "blocked",
      provenanceRefs: ["failed-rigging-report"],
    });

    await expect(writeGeneratedRuntimeAssetWithManifest({ store, asset, body: "glb-bytes" }))
      .rejects.toThrow("Blocked runtime asset cannot be written");
    expect(store.puts).toEqual([]);
  });

  it("writes frozen encounter asset bundles at deterministic per-encounter blob paths", async () => {
    const store = fakeObjectStore();
    const assetStore = resolveRuntimeAssetStoreConfig({ storeKind: "azurite_blob", containerName: "openclinxr-assets" });
    const environment = registerGeneratedRuntimeAssetReference({
      assetId: "generated_room_shell_v4",
      version: "v4",
      kind: "environment_model",
      displayName: "Generated ED room shell",
      scenarioAssetId: "ed_exam_bay_environment",
      blobName: "tenants/local/asset-library/generated_room_shell_v4/v4/model.glb",
      assetStore,
      reviewStatus: "approved_for_local_runtime",
      provenanceRefs: ["environment-report-v4"],
    });
    const bundle = buildEncounterRuntimeAssetBundle({
      bundleId: "exam/run:encounter#9:runtime-assets",
      tenantId: "tenant alpha",
      userId: "learner 1",
      examRunId: "exam/run",
      encounterId: "encounter#9",
      stationId: "ed_chest_pain_station_v1",
      scenarioId: "ed_chest_pain_priority_v1",
      assetStore,
      environment,
      actors: [],
      evidenceGateRefs: [{
        gateId: "runtime_realism_evidence",
        status: "attached",
        evidenceRefs: ["docs/openclinxr/runtime-realism-evidence-check-authored-idle-pose-required-2026-05-23.json"],
        requiredSignalIds: ["animated_humanoid_runtime_playback"],
        blockers: [],
        notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      }],
    });

    await expect(writeEncounterRuntimeAssetBundle({ store, bundle })).resolves.toMatchObject({
      bundleBlobName: "tenants/tenant_alpha/sessions/exam_run/encounters/encounter_9/asset-bundle.json",
    });
    expect(encounterRuntimeAssetBundleBlobName(bundle)).toBe("tenants/tenant_alpha/sessions/exam_run/encounters/encounter_9/asset-bundle.json");
    expect(store.puts[0]?.contentType).toBe("application/json");
    expect(store.puts[0]?.metadata).toMatchObject({
      scenarioassetid: "ed_chest_pain_priority_v1",
      reviewstatus: "approved_for_local_runtime",
      version: "frozen_encounter_bundle",
    });
    const writtenBundle = JSON.parse(String(store.puts[0]?.body)) as { evidenceGateRefs: Array<{ gateId: string; evidenceRefs: string[] }> };
    expect(writtenBundle.evidenceGateRefs).toEqual([
      expect.objectContaining({
        gateId: "runtime_realism_evidence",
        evidenceRefs: ["docs/openclinxr/runtime-realism-evidence-check-authored-idle-pose-required-2026-05-23.json"],
      }),
    ]);
  });
});

function fakeObjectStore(): AssetObjectStore & { puts: AssetObjectStorePutInput[] } {
  const puts: AssetObjectStorePutInput[] = [];
  return {
    puts,
    config: resolveRuntimeAssetStoreConfig({ storeKind: "azurite_blob", containerName: "openclinxr-assets" }),
    async putObject(input) {
      puts.push(input);
      return putResult(input.blobName);
    },
    async getObject() {
      throw new Error("not needed");
    },
    async putEncounterRuntimeAsset(asset, body) {
      const input = {
        blobName: asset.blob.blobName,
        body,
        contentType: asset.blob.contentType,
        metadata: {
          assetid: asset.assetId,
          scenarioassetid: asset.scenarioAssetId,
          reviewstatus: asset.reviewStatus,
          version: asset.version,
        },
      } satisfies AssetObjectStorePutInput;
      puts.push(input);
      return putResult(asset.blob.blobName);
    },
  };
}

function putResult(blobName: string): AssetObjectStorePutResult {
  return {
    storeKind: "azurite_blob",
    containerName: "openclinxr-assets",
    blobName,
    url: `http://127.0.0.1:10000/devstoreaccount1/openclinxr-assets/${blobName}`,
    etag: "etag",
    requestId: "request-id",
  };
}
