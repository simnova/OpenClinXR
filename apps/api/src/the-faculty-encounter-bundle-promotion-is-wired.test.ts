import { describe, expect, it } from "vitest";
import { DEFAULT_DEV_AUTH_SECRET, signAuthToken } from "@openclinxr/auth";
import { createApiApp } from "./index.js";
import {
  FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH,
  FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PREVIEW_PATH,
} from "./routes/encounter-bundle-promotion/index.js";

const REVIEW_IDENTITY = "scenario-review:ed_chest_pain_priority_v1:faculty-local";

describe("faculty encounter bundle promotion is wired through createApiApp", () => {
  it("previews blockers then promotes once with only the opaque learner launch identity", async () => {
    const app = createApiApp();
    const faculty = authHeader("faculty");
    const blocked = {
      ...slimSelection(),
      members: slimSelection().members.map((member, index) =>
        index === 0 ? { ...member, contentHash: "stale-hash", expectedContentHash: "humanoid-hash-v1" } : member
      ),
    };

    const preview = await app.request(FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PREVIEW_PATH, {
      method: "POST",
      headers: faculty,
      body: JSON.stringify(blocked),
    });
    expect(preview.status).toBe(200);
    const previewBody = await preview.json() as { canPromote: boolean; blockers: string[]; learnerLaunchIdentity: null };
    expect(previewBody.canPromote).toBe(false);
    expect(previewBody.blockers).toContain("humanoid:patient_humanoid_v1:stale");
    expect(previewBody.learnerLaunchIdentity).toBeNull();

    const promoted = await app.request(FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH, {
      method: "POST",
      headers: faculty,
      body: JSON.stringify(slimSelection()),
    });
    expect(promoted.status).toBe(200);
    const body = await promoted.json() as Record<string, unknown>;
    expect(body.promoted).toBe(true);
    const launch = body.learnerLaunchIdentity as { bundleId: string; href: string };
    expect(launch.bundleId).toMatch(/^bdl_[0-9a-f]{32}$/u);
    expect(launch.href).toBe(`/runtime/asset-bundles/${launch.bundleId}`);
    expect(JSON.stringify(body)).not.toMatch(/tenantId|examRunId|encounterId|userId/u);
    expect(body).not.toHaveProperty("learnerBundle");
  });
});

function authHeader(role: "faculty" | "admin"): Record<string, string> {
  return {
    authorization: `Bearer ${signAuthToken({
      identity: { subject: `${role}_bundle_promoter`, role },
      secret: DEFAULT_DEV_AUTH_SECRET,
    })}`,
    "content-type": "application/json",
  };
}

function slimSelection() {
  const kinds = ["humanoid", "room", "equipment", "motion", "voice", "interaction"] as const;
  return {
    scenarioId: "ed_chest_pain_priority_v1",
    stationId: "ed_chest_pain_station_v1",
    scenarioReviewIdentity: REVIEW_IDENTITY,
    expectedScenarioReviewIdentity: REVIEW_IDENTITY,
    assetStoreKind: "azurite_blob",
    members: kinds.map((memberKind) => {
      const assetId = memberKind === "humanoid"
        ? "patient_humanoid_v1"
        : memberKind === "room"
          ? "exam_bay_room_v1"
          : memberKind === "equipment"
            ? "ecg_cart_v1"
            : `${memberKind}_asset_v1`;
      return {
        memberKind,
        assetId,
        pipelineState: "reviewed",
        reviewStatus: "approved_for_local_runtime",
        provenanceRefs: [`provenance:${assetId}`],
        contentHash: `${memberKind}-hash-v1`,
        expectedContentHash: `${memberKind}-hash-v1`,
        missingReviewAttestations: [],
      };
    }),
  };
}
