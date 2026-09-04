import { describe, expect, it } from "vitest";
import {
  createPromotedEncounterBundleRepository,
  MemoryPromotedEncounterBundleRepository,
} from "./promoted-encounter-bundle-repository.js";
import type { EncounterBundleFactoryMember } from "@openclinxr/asset-registry/runtime-asset-review";
import {
  registerGeneratedRuntimeAssetReference,
  resolveRuntimeAssetStoreConfig,
  type RuntimeAssetKind,
} from "@openclinxr/asset-registry/runtime-bundles";
import type { RuntimeAssetReviewDecision } from "@openclinxr/asset-registry/runtime-asset-review";

const STORE = resolveRuntimeAssetStoreConfig({
  storeKind: "azurite_blob",
  containerName: "openclinxr-assets",
});

describe("PromotedEncounterBundleRepository", () => {
  it("uses an in-memory backend when no Mongo db is provided", async () => {
    const repository = createPromotedEncounterBundleRepository();
    expect(repository.backend).toBe("memory");
    expect(repository).toBeInstanceOf(MemoryPromotedEncounterBundleRepository);
    await repository.ensureIndexes();
  });

  it("persists one promotion and returns the exact bundle after a restart lookup", async () => {
    const repository = createPromotedEncounterBundleRepository();
    const first = await repository.promote(promotionInput());
    expect(first.runtimeEligibility).toBe("promoted");
    expect(first.durableStore).toBe("database_source_of_truth");
    expect(first.learnerBundle.identityScope).toBe("learner_runtime_opaque_bundle");

    const restarted = await repository.findByOpaqueId(first.bundleId);
    expect(restarted).toEqual(first);
    expect(restarted?.learnerBundle).toEqual(first.learnerBundle);
    expect(restarted?.contentIdentity).toBe(first.contentIdentity);
  });

  it("is idempotent for the same bytes and refuses a mutating repromotion", async () => {
    const repository = createPromotedEncounterBundleRepository();
    const input = promotionInput({ opaqueBundleId: "bdl_opaque_station_bundle_v1" });
    const first = await repository.promote(input);
    const same = await repository.promote(input);
    expect(same).toEqual(first);

    const mutatedMembers = reviewedMembers().map((member) =>
      member.memberKind === "humanoid"
        ? {
          ...member,
          asset: {
            ...member.asset,
            blob: { ...member.asset.blob, contentHash: "mutated-humanoid-hash" },
          },
        }
        : member,
    );
    await expect(repository.promote({
      ...input,
      members: mutatedMembers,
      expectedContentHashes: { patient_humanoid_v1: "mutated-humanoid-hash" },
    })).rejects.toThrow("repromotion cannot mutate immutable encounter bundle");

    const afterFailedMutation = await repository.findByOpaqueId(first.bundleId);
    expect(afterFailedMutation).toEqual(first);
  });
});

function promotionInput(
  overrides: { opaqueBundleId?: string } = {},
): Parameters<ReturnType<typeof createPromotedEncounterBundleRepository>["promote"]>[0] {
  const members = reviewedMembers();
  return {
    stationId: "ed_chest_pain_station_v1",
    scenarioId: "ed_chest_pain_priority_v1",
    assetStoreKind: "azurite_blob",
    members,
    decisions: reviewDecisions(members),
    ...overrides,
  };
}

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
  memberKind: EncounterBundleFactoryMember["memberKind"],
  assetId: string,
  kind: RuntimeAssetKind,
  contentHash: string,
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
      reviewStatus: "approved_for_local_runtime",
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
