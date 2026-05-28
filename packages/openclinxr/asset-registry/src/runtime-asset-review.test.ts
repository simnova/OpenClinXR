import { describe, expect, it } from "vitest";
import { promoteRuntimeAssetForLocalUse } from "./runtime-asset-review.js";
import { registerGeneratedRuntimeAssetReference, resolveRuntimeAssetStoreConfig } from "./runtime-bundles.js";

describe("runtime asset review promotion", () => {
  it("promotes generated assets to local runtime only after required review roles approve with evidence", () => {
    const asset = generatedAsset("blocked");
    const result = promoteRuntimeAssetForLocalUse({
      asset,
      decisions: [
        decision("asset_pipeline"),
        decision("security_privacy"),
      ],
    });

    expect(result).toMatchObject({
      assetId: "generated_patient_model_v17",
      promoted: false,
      nextStatus: "blocked",
      blockers: ["asset_currently_blocked"],
    });

    const pendingAsset = { ...asset, reviewStatus: "approved_for_local_runtime" as const };
    const promoted = promoteRuntimeAssetForLocalUse({
      asset: pendingAsset,
      decisions: [
        decision("asset_pipeline"),
        decision("security_privacy"),
      ],
    });
    expect(promoted).toMatchObject({
      promoted: true,
      nextStatus: "approved_for_local_runtime",
      missingReviewerRoles: [],
      blockers: [],
      asset: { reviewStatus: "approved_for_local_runtime" },
    });
    expect(promoted.notEvidenceFor).toContain("production_asset_readiness");
  });

  it("blocks promotion when required roles or evidence are missing", () => {
    const result = promoteRuntimeAssetForLocalUse({
      asset: generatedAsset("approved_for_local_runtime"),
      decisions: [
        { ...decision("asset_pipeline"), evidenceRefs: [] },
      ],
    });

    expect(result.promoted).toBe(false);
    expect(result.missingReviewerRoles).toEqual(["asset_pipeline", "security_privacy"]);
    expect(result.blockers).toEqual([
      "missing_runtime_asset_review:asset_pipeline",
      "missing_runtime_asset_review:security_privacy",
    ]);
  });

  it("does not promote fixture assets through generated-asset review gates", () => {
    const fixture = { ...generatedAsset("fixture_approved_for_local_runtime"), reviewStatus: "fixture_approved_for_local_runtime" as const };
    const result = promoteRuntimeAssetForLocalUse({
      asset: fixture,
      decisions: [decision("asset_pipeline"), decision("security_privacy")],
    });

    expect(result.promoted).toBe(false);
    expect(result.blockers).toContain("fixture_assets_do_not_require_generated_asset_promotion");
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
