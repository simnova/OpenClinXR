import type { EncounterRuntimeAsset, EncounterRuntimeAssetBundle, RuntimeAssetReviewStatus } from "./runtime-bundles.js";

export type RuntimeAssetReviewRole = "asset_pipeline" | "clinical_simulation" | "xr_performance" | "security_privacy";

export type RuntimeAssetReviewDecision = {
  assetId: string;
  reviewerRole: RuntimeAssetReviewRole;
  reviewerId: string;
  decision: "approved_for_local_runtime" | "changes_requested";
  comments: string;
  evidenceRefs: string[];
  reviewedAt: string;
};

export type RuntimeAssetPromotionResult = {
  assetId: string;
  promoted: boolean;
  nextStatus: RuntimeAssetReviewStatus;
  missingReviewerRoles: RuntimeAssetReviewRole[];
  blockers: string[];
  asset: EncounterRuntimeAsset;
  notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"];
};

export type RuntimeAssetBundlePromotionResult = {
  bundleId: string;
  promoted: boolean;
  promotedBundle: EncounterRuntimeAssetBundle | null;
  assetResults: RuntimeAssetPromotionResult[];
  blockers: string[];
  notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"];
};

export const requiredRuntimeAssetReviewerRoles = [
  "asset_pipeline",
  "security_privacy",
] as const satisfies RuntimeAssetReviewRole[];

const NOT_EVIDENCE_FOR = [
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
] as const;

export function promoteRuntimeAssetForLocalUse(input: {
  asset: EncounterRuntimeAsset;
  decisions: readonly RuntimeAssetReviewDecision[];
  requiredRoles?: readonly RuntimeAssetReviewRole[] | undefined;
}): RuntimeAssetPromotionResult {
  const requiredRoles = [...(input.requiredRoles ?? requiredRuntimeAssetReviewerRoles)];
  const blockers: string[] = [];
  const approvedRoles = new Set(
    input.decisions
      .filter((decision) => decision.assetId === input.asset.assetId)
      .filter((decision) => decision.decision === "approved_for_local_runtime")
      .filter((decision) => decision.reviewerId.trim().length > 0)
      .filter((decision) => decision.evidenceRefs.length > 0)
      .filter((decision) => !Number.isNaN(Date.parse(decision.reviewedAt)))
      .map((decision) => decision.reviewerRole),
  );
  const missingReviewerRoles = requiredRoles.filter((role) => !approvedRoles.has(role));

  if (input.asset.reviewStatus === "fixture_approved_for_local_runtime") {
    blockers.push("fixture_assets_do_not_require_generated_asset_promotion");
  }
  if (input.asset.reviewStatus === "blocked") {
    blockers.push("asset_currently_blocked");
  }
  for (const role of missingReviewerRoles) {
    blockers.push(`missing_runtime_asset_review:${role}`);
  }

  const promoted = blockers.length === 0;
  const nextStatus: RuntimeAssetReviewStatus = promoted ? "approved_for_local_runtime" : "blocked";
  return {
    assetId: input.asset.assetId,
    promoted,
    nextStatus,
    missingReviewerRoles,
    blockers,
    asset: {
      ...input.asset,
      reviewStatus: nextStatus,
    },
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
}

export function promoteEncounterRuntimeAssetBundleForLocalUse(input: {
  bundle: EncounterRuntimeAssetBundle;
  decisions: readonly RuntimeAssetReviewDecision[];
  requiredRoles?: readonly RuntimeAssetReviewRole[] | undefined;
}): RuntimeAssetBundlePromotionResult {
  const assetResults = collectUniqueRuntimeAssets(input.bundle).map((asset) =>
    promoteRuntimeAssetForLocalUse({
      asset,
      decisions: input.decisions,
      requiredRoles: input.requiredRoles,
    }),
  );
  const blockers = assetResults.flatMap((result) => result.blockers.map((blocker) => `${result.assetId}:${blocker}`));
  const promoted = blockers.length === 0;

  return {
    bundleId: input.bundle.bundleId,
    promoted,
    promotedBundle: promoted ? replaceRuntimeBundleAssets(input.bundle, assetResults) : null,
    assetResults,
    blockers,
    notEvidenceFor: [...NOT_EVIDENCE_FOR],
  };
}

function collectUniqueRuntimeAssets(bundle: EncounterRuntimeAssetBundle): EncounterRuntimeAsset[] {
  const assets = [
    bundle.environment,
    ...bundle.actors.flatMap((actor) => [actor.model, ...actor.animationClips, ...(actor.phonemeMap ? [actor.phonemeMap] : [])]),
    ...bundle.equipment.map((equipment) => equipment.model),
    ...bundle.uiSurfaces.flatMap((surface) => [surface.schema, surface.data].filter((asset): asset is EncounterRuntimeAsset => asset !== undefined)),
  ];
  const byId = new Map<string, EncounterRuntimeAsset>();
  for (const asset of assets) {
    byId.set(asset.assetId, asset);
  }
  return [...byId.values()];
}

function replaceRuntimeBundleAssets(bundle: EncounterRuntimeAssetBundle, assetResults: RuntimeAssetPromotionResult[]): EncounterRuntimeAssetBundle {
  const promotedAssets = new Map(assetResults.map((result) => [result.assetId, result.asset]));
  const replaceAsset = (asset: EncounterRuntimeAsset): EncounterRuntimeAsset => promotedAssets.get(asset.assetId) ?? asset;

  return {
    ...bundle,
    environment: replaceAsset(bundle.environment),
    actors: bundle.actors.map((actor) => ({
      ...actor,
      model: replaceAsset(actor.model),
      animationClips: actor.animationClips.map(replaceAsset),
      phonemeMap: actor.phonemeMap ? replaceAsset(actor.phonemeMap) : undefined,
    })),
    equipment: bundle.equipment.map((equipment) => ({
      ...equipment,
      model: replaceAsset(equipment.model),
    })),
    uiSurfaces: bundle.uiSurfaces.map((surface) => ({
      ...surface,
      schema: surface.schema ? replaceAsset(surface.schema) : undefined,
      data: surface.data ? replaceAsset(surface.data) : undefined,
    })),
  };
}
