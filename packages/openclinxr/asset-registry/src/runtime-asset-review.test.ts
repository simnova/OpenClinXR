import {
  buildEncounterRuntimeAssetBundle,
  registerGeneratedRuntimeAssetReference,
  resolveRuntimeAssetStoreConfig,
} from "@openclinxr/asset-registry/runtime-bundles";
import { describe, expect, it } from "vitest";
import { promoteEncounterRuntimeAssetBundleForLocalUse } from "./runtime-asset-review.js";

describe("runtime asset review promotion", () => {
  it("promotes generated assets to local runtime only after required review roles approve with evidence", () => {
    const blocked = promoteEncounterRuntimeAssetBundleForLocalUse({
      bundle: bundleWith("blocked"),
      decisions: [decision("asset_pipeline"), decision("security_privacy")],
    });

    expect(blocked.promoted).toBe(false);
    expect(blocked.blockers).toContain("generated_patient_model_v17:asset_currently_blocked");

    const promoted = promoteEncounterRuntimeAssetBundleForLocalUse({
      bundle: bundleWith("approved_for_local_runtime"),
      decisions: [decision("asset_pipeline"), decision("security_privacy")],
    });
    expect(promoted).toMatchObject({
      promoted: true,
      blockers: [],
      promotedBundle: { environment: { reviewStatus: "approved_for_local_runtime" } },
    });
    expect(promoted.notEvidenceFor).toContain("production_asset_readiness");
  });

  it("blocks promotion when required roles or evidence are missing", () => {
    const result = promoteEncounterRuntimeAssetBundleForLocalUse({
      bundle: bundleWith("approved_for_local_runtime"),
      decisions: [{ ...decision("asset_pipeline"), evidenceRefs: [] }],
    });

    expect(result.promoted).toBe(false);
    expect(result.blockers).toEqual([
      "generated_patient_model_v17:missing_runtime_asset_review:asset_pipeline",
      "generated_patient_model_v17:missing_runtime_asset_review:security_privacy",
    ]);
  });

  it("does not promote fixture assets through generated-asset review gates", () => {
    const result = promoteEncounterRuntimeAssetBundleForLocalUse({
      bundle: bundleWith("fixture_approved_for_local_runtime"),
      decisions: [decision("asset_pipeline"), decision("security_privacy")],
    });

    expect(result.promoted).toBe(false);
    expect(result.blockers).toContain(
      "generated_patient_model_v17:fixture_assets_do_not_require_generated_asset_promotion",
    );
  });
});

function generatedAsset(reviewStatus: "approved_for_local_runtime" | "blocked" | "fixture_approved_for_local_runtime") {
  return registerGeneratedRuntimeAssetReference({
    assetId: "generated_patient_model_v17",
    version: "v17",
    kind: "humanoid_model",
    displayName: "Generated patient model v17",
    scenarioAssetId: "patient_robert_hayes_character",
    blobName: "tenants/local/asset-library/generated_patient_model_v17/v17/model.glb",
    assetStore: resolveRuntimeAssetStoreConfig({ storeKind: "azurite_blob", containerName: "openclinxr-assets" }),
    reviewStatus,
    provenanceRefs: ["rigging-report-v17"],
  });
}

function bundleWith(reviewStatus: "approved_for_local_runtime" | "blocked" | "fixture_approved_for_local_runtime") {
  const assetStore = resolveRuntimeAssetStoreConfig({ storeKind: "azurite_blob", containerName: "openclinxr-assets" });
  return buildEncounterRuntimeAssetBundle({
    bundleId: "test-bundle",
    tenantId: "test-tenant",
    userId: "test-user",
    examRunId: "test-exam",
    encounterId: "test-encounter",
    stationId: "test-station",
    scenarioId: "test-scenario",
    assetStore,
    environment: generatedAsset(reviewStatus),
    actors: [],
  });
}

function decision(reviewerRole: "asset_pipeline" | "security_privacy") {
  return {
    assetId: "generated_patient_model_v17",
    reviewerRole,
    reviewerId: `${reviewerRole}_reviewer`,
    decision: "approved_for_local_runtime" as const,
    comments: "Local runtime review approved for deterministic fixture use.",
    evidenceRefs: [`evidence:${reviewerRole}:2026-05-22`],
    reviewedAt: "2026-05-22T18:20:00.000Z",
  };
}
