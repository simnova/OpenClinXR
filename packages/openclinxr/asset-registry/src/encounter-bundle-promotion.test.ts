import { describe, expect, it } from "vitest";
import {
  promoteReviewedFactoryOutputsToImmutableEncounterBundle,
  type EncounterBundleFactoryMember,
  type EncounterBundleFactoryMemberKind,
} from "./encounter-bundle-promotion.js";
import {
  registerGeneratedRuntimeAssetReference,
  resolveRuntimeAssetStoreConfig,
  type EncounterRuntimeAsset,
  type RuntimeAssetKind,
  type RuntimeAssetReviewStatus,
} from "./runtime-bundles.js";
import type { RuntimeAssetReviewDecision } from "./runtime-asset-review.js";

const STORE = resolveRuntimeAssetStoreConfig({
  storeKind: "azurite_blob",
  containerName: "openclinxr-assets",
});

describe("promoteReviewedFactoryOutputsToImmutableEncounterBundle", () => {
  it("promotes reviewed factory members into a content-addressed opaque learner bundle", () => {
    const members = reviewedMembers();
    const result = promoteReviewedFactoryOutputsToImmutableEncounterBundle({
      stationId: "ed_chest_pain_station_v1",
      scenarioId: "ed_chest_pain_priority_v1",
      assetStoreKind: "azurite_blob",
      members,
      decisions: reviewDecisions(members),
    });

    expect(result.promoted).toBe(true);
    if (!result.promoted) {
      throw new Error(result.blockers.join(", "));
    }
    expect(result.bundleId).toMatch(/^bdl_[0-9a-f]{32}$/u);
    expect(result.contentIdentity).toMatch(/^[0-9a-f]{32}$/u);
    expect(result.learnerBundle.identityScope).toBe("learner_runtime_opaque_bundle");
    expect(result.learnerBundle.bundleId).toBe(result.bundleId);
    expect(result.learnerBundle.frozenForEncounter).toBe(true);
    expect(result.learnerBundle).not.toHaveProperty("tenantId");
    expect(result.learnerBundle).not.toHaveProperty("examRunId");
    expect(result.learnerBundle.environment.blob.contentHash).toBe("room-hash-v1");
    expect(result.notEvidenceFor).toContain("quest_readiness");

    const replay = promoteReviewedFactoryOutputsToImmutableEncounterBundle({
      stationId: "ed_chest_pain_station_v1",
      scenarioId: "ed_chest_pain_priority_v1",
      assetStoreKind: "azurite_blob",
      members: reviewedMembers(),
      decisions: reviewDecisions(members),
    });
    expect(replay.promoted).toBe(true);
    if (replay.promoted) {
      expect(replay.contentIdentity).toBe(result.contentIdentity);
      expect(replay.bundleId).toBe(result.bundleId);
    }
  });

  it("rejects generated, blocked, stale, and identity-leaking members", () => {
    const base = reviewedMembers();
    const generated = promoteReviewedFactoryOutputsToImmutableEncounterBundle({
      stationId: "ed_chest_pain_station_v1",
      scenarioId: "ed_chest_pain_priority_v1",
      assetStoreKind: "azurite_blob",
      members: withMember(base, "humanoid", { pipelineState: "generated" }),
      decisions: reviewDecisions(base),
    });
    expect(generated.promoted).toBe(false);
    if (!generated.promoted) {
      expect(generated.blockers).toContain("humanoid:patient_humanoid_v1:generated");
    }

    const blocked = promoteReviewedFactoryOutputsToImmutableEncounterBundle({
      stationId: "ed_chest_pain_station_v1",
      scenarioId: "ed_chest_pain_priority_v1",
      assetStoreKind: "azurite_blob",
      members: withAsset(base, "room", { reviewStatus: "blocked" }),
      decisions: reviewDecisions(base),
    });
    expect(blocked.promoted).toBe(false);
    if (!blocked.promoted) {
      expect(blocked.blockers).toContain("room:exam_bay_room_v1:blocked");
    }

    const stale = promoteReviewedFactoryOutputsToImmutableEncounterBundle({
      stationId: "ed_chest_pain_station_v1",
      scenarioId: "ed_chest_pain_priority_v1",
      assetStoreKind: "azurite_blob",
      members: base,
      decisions: reviewDecisions(base),
      expectedContentHashes: { patient_humanoid_v1: "other-hash" },
    });
    expect(stale.promoted).toBe(false);
    if (!stale.promoted) {
      expect(stale.blockers).toContain("humanoid:patient_humanoid_v1:stale");
    }

    const leaking = promoteReviewedFactoryOutputsToImmutableEncounterBundle({
      stationId: "ed_chest_pain_station_v1",
      scenarioId: "ed_chest_pain_priority_v1",
      assetStoreKind: "azurite_blob",
      members: withBlobName(base, "equipment", "tenants/local-dev-tenant/asset-library/ecg/v1/model.glb"),
      decisions: reviewDecisions(base),
    });
    expect(leaking.promoted).toBe(false);
    if (!leaking.promoted) {
      expect(leaking.blockers).toContain("equipment:ecg_cart_v1:identity-leaking");
    }
  });

  it("refuses encounter-scoped bundle ids that leak exam or encounter identity", () => {
    const members = reviewedMembers();
    const result = promoteReviewedFactoryOutputsToImmutableEncounterBundle({
      stationId: "ed_chest_pain_station_v1",
      scenarioId: "ed_chest_pain_priority_v1",
      assetStoreKind: "azurite_blob",
      members,
      decisions: reviewDecisions(members),
      opaqueBundleId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
    });
    expect(result.promoted).toBe(false);
    if (!result.promoted) {
      expect(result.blockers).toContain("opaque_bundle_id:identity-leaking");
    }
  });
});

function reviewedMembers(): EncounterBundleFactoryMember[] {
  return [
    member("humanoid", "patient_humanoid_v1", "humanoid_model", "humanoid-hash-v1"),
    member("room", "exam_bay_room_v1", "environment_model", "room-hash-v1"),
    member("equipment", "ecg_cart_v1", "equipment_model", "ecg-hash-v1"),
    member("motion", "patient_idle_clip_v1", "animation_clip", "motion-hash-v1"),
    member("voice", "patient_phoneme_map_v1", "phoneme_map", "voice-hash-v1"),
    member("interaction", "station_schema_panel_v1", "ui_schema", "interaction-hash-v1"),
  ];
}

function member(
  memberKind: EncounterBundleFactoryMemberKind,
  assetId: string,
  kind: RuntimeAssetKind,
  contentHash: string,
  reviewStatus: RuntimeAssetReviewStatus = "approved_for_local_runtime",
): EncounterBundleFactoryMember {
  return {
    memberKind,
    pipelineState: "reviewed",
    asset: registerGeneratedRuntimeAssetReference({
      assetId,
      version: "v1",
      kind,
      displayName: assetId,
      scenarioAssetId: assetId,
      blobName: `asset-library/${assetId}/v1/asset.bin`,
      contentHash,
      assetStore: STORE,
      reviewStatus,
      provenanceRefs: [`provenance:${assetId}`],
    }),
  };
}

function reviewDecisions(members: readonly EncounterBundleFactoryMember[]): RuntimeAssetReviewDecision[] {
  return members.flatMap((entry) => [
    decision(entry.asset.assetId, "asset_pipeline"),
    decision(entry.asset.assetId, "security_privacy"),
  ]);
}

function decision(assetId: string, reviewerRole: "asset_pipeline" | "security_privacy"): RuntimeAssetReviewDecision {
  return {
    assetId,
    reviewerRole,
    reviewerId: `${reviewerRole}_reviewer`,
    decision: "approved_for_local_runtime",
    comments: "Local runtime review approved.",
    evidenceRefs: [`evidence:${reviewerRole}:${assetId}`],
    reviewedAt: "2026-09-04T00:00:00.000Z",
  };
}

function withMember(
  members: EncounterBundleFactoryMember[],
  kind: EncounterBundleFactoryMemberKind,
  patch: Partial<EncounterBundleFactoryMember>,
): EncounterBundleFactoryMember[] {
  return members.map((entry) => entry.memberKind === kind ? { ...entry, ...patch } : entry);
}

function withAsset(
  members: EncounterBundleFactoryMember[],
  kind: EncounterBundleFactoryMemberKind,
  patch: Partial<EncounterRuntimeAsset>,
): EncounterBundleFactoryMember[] {
  return members.map((entry) =>
    entry.memberKind === kind ? { ...entry, asset: { ...entry.asset, ...patch } } : entry,
  );
}

function withBlobName(
  members: EncounterBundleFactoryMember[],
  kind: EncounterBundleFactoryMemberKind,
  blobName: string,
): EncounterBundleFactoryMember[] {
  return members.map((entry) => {
    if (entry.memberKind !== kind) {
      return entry;
    }
    return {
      ...entry,
      asset: {
        ...entry.asset,
        blob: {
          ...entry.asset.blob,
          blobName,
          url: `${entry.asset.blob.url.replace(entry.asset.blob.blobName, blobName)}`,
        },
      },
    };
  });
}
