import { describe, expect, it } from "vitest";
import { DEFAULT_DEV_AUTH_SECRET, signAuthToken } from "@openclinxr/auth";
import {
  registerGeneratedRuntimeAssetReference,
  resolveRuntimeAssetStoreConfig,
  type EncounterBundleFactoryMember,
  type EncounterBundleFactoryMemberKind,
  type EncounterRuntimeAsset,
  type RuntimeAssetKind,
  type RuntimeAssetReviewDecision,
  type RuntimeAssetReviewStatus,
} from "@openclinxr/asset-registry";
import { ApiApplication } from "../../api-application.js";
import {
  FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH,
  FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PREVIEW_PATH,
  registerEncounterBundlePromotionRoutes,
} from "./encounter-bundle-promotion-routes.js";
import type { FacultyEncounterBundlePromotionRequest } from "./faculty-encounter-bundle-promotion.js";

const STORE = resolveRuntimeAssetStoreConfig({
  storeKind: "azurite_blob",
  containerName: "openclinxr-assets",
});
const REVIEW_IDENTITY = "scenario-review:ed_chest_pain_priority_v1:v7";

function compose() {
  return ApiApplication.create()
    .withContext()
    .withCoreMiddleware()
    .withRoutes(registerEncounterBundlePromotionRoutes)
    .build();
}

function authHeader(role: "learner" | "faculty" | "admin"): Record<string, string> {
  return {
    authorization: `Bearer ${signAuthToken({
      identity: {
        subject: `${role}_bundle_promoter`,
        role,
        ...(role === "learner" ? { learnerId: "learner_bundle_promoter" } : {}),
      },
      secret: DEFAULT_DEV_AUTH_SECRET,
    })}`,
    "content-type": "application/json",
  };
}

describe("faculty encounter bundle promotion routes", () => {
  it("promotes reviewed factory outputs atomically and returns only the opaque launch identity", async () => {
    const composed = compose();
    const response = await composed.app.request(FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH, {
      method: "POST",
      headers: authHeader("faculty"),
      body: JSON.stringify(reviewedRequest()),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.promoted).toBe(true);
    const launch = body.learnerLaunchIdentity as { bundleId: string; href: string };
    expect(launch.bundleId).toMatch(/^bdl_[0-9a-f]{32}$/u);
    expect(launch.href).toBe(`/runtime/asset-bundles/${launch.bundleId}`);
    expect(JSON.stringify(body)).not.toMatch(/tenantId|examRunId|encounterId|userId/u);
    expect(body).not.toHaveProperty("learnerBundle");
    expect(body).not.toHaveProperty("members");
    expect(body.notEvidenceFor).toEqual(expect.arrayContaining([
      "production_asset_readiness",
      "quest_readiness",
      "clinical_validity",
      "automatic_approval",
    ]));
  });

  it("previews every blocking review and provenance attestation without promoting", async () => {
    const composed = compose();
    const request = reviewedRequest();
    request.members = request.members.map((member, index) =>
      index === 0
        ? { ...member, pipelineState: "generated", asset: { ...member.asset, provenanceRefs: [] } }
        : member,
    );
    const response = await composed.app.request(FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PREVIEW_PATH, {
      method: "POST",
      headers: authHeader("faculty"),
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      promoted: boolean;
      canPromote: boolean;
      blockers: string[];
      attestations: string[];
      learnerLaunchIdentity: null;
    };
    expect(body.promoted).toBe(false);
    expect(body.canPromote).toBe(false);
    expect(body.learnerLaunchIdentity).toBeNull();
    expect(body.blockers).toEqual(expect.arrayContaining([
      "humanoid:patient_humanoid_v1:generated",
      "humanoid:patient_humanoid_v1:missing_provenance",
    ]));
    expect(body.attestations.some((row) => row.includes("missing_review_attestation"))).toBe(false);
    expect(body.attestations.some((row) => row.includes("room:exam_bay_room_v1:provenance:"))).toBe(true);
  });

  it("refuses stale hashes, partial selections, and learner callers", async () => {
    const composed = compose();
    const stale = await composed.app.request(FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH, {
      method: "POST",
      headers: authHeader("faculty"),
      body: JSON.stringify({
        ...reviewedRequest(),
        expectedContentHashes: { patient_humanoid_v1: "other-hash" },
      }),
    });
    expect(stale.status).toBe(409);
    const staleBody = await stale.json() as { promoted: boolean; blockers: string[]; learnerLaunchIdentity: null };
    expect(staleBody.promoted).toBe(false);
    expect(staleBody.learnerLaunchIdentity).toBeNull();
    expect(staleBody.blockers).toContain("humanoid:patient_humanoid_v1:stale");

    const partial = await composed.app.request(FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH, {
      method: "POST",
      headers: authHeader("faculty"),
      body: JSON.stringify({
        ...reviewedRequest(),
        scenarioId: "",
        members: reviewedRequest().members.slice(0, 2),
      }),
    });
    expect(partial.status).toBe(409);
    const partialBody = await partial.json() as { blockers: string[] };
    expect(partialBody.blockers).toEqual(expect.arrayContaining([
      "selection:partial",
      "missing_factory_member:equipment",
    ]));

    const identityDrift = await composed.app.request(FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH, {
      method: "POST",
      headers: authHeader("faculty"),
      body: JSON.stringify({
        ...reviewedRequest(),
        expectedScenarioReviewIdentity: "scenario-review:other",
      }),
    });
    expect(identityDrift.status).toBe(409);
    const driftBody = await identityDrift.json() as { blockers: string[] };
    expect(driftBody.blockers).toContain("selection:stale_scenario_review");

    const learner = await composed.app.request(FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH, {
      method: "POST",
      headers: authHeader("learner"),
      body: JSON.stringify(reviewedRequest()),
    });
    expect(learner.status).toBe(403);
  });
});

function reviewedRequest(): FacultyEncounterBundlePromotionRequest {
  const members = reviewedMembers();
  return {
    scenarioId: "ed_chest_pain_priority_v1",
    stationId: "ed_chest_pain_station_v1",
    scenarioReviewIdentity: REVIEW_IDENTITY,
    expectedScenarioReviewIdentity: REVIEW_IDENTITY,
    assetStoreKind: "azurite_blob",
    members,
    decisions: reviewDecisions(members),
    expectedContentHashes: Object.fromEntries(members.map((member) => [
      member.asset.assetId,
      member.asset.blob.contentHash ?? "",
    ])),
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
    }) as EncounterRuntimeAsset,
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
