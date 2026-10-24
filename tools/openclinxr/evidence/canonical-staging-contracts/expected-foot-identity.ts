/**
 * Canonical staging contracts — expected foot-grounder identity.
 *
 * F3 scope only. Reads the expected asset pin + clip revision from the
 * specific canonical frozen plan (case-frozen-scene-plans.ts) at runtime.
 * The independent provenance lineage (mpfb-clinical-physician-adult.
 * provenance.json) is cross-checked in the feature unit, not re-typed here.
 * No GLB/source/plan/provenance edits, no disk-hash refresh, no regeneration.
 */

import { CASE_FROZEN_SCENE_PLANS } from "@openclinxr/asset-registry/case-frozen-scene-plans";

export const FOOT_GROUNDER_CASE_ID = "scene_closure_supine_bedside_v1" as const;
export const FOOT_GROUNDER_PHYSICIAN_INSTANCE_ID =
  "scene_closure_supine_bedside_station_v1:senior_resident_ward_v1" as const;
export const FOOT_GROUNDER_ASSET_PATH =
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb" as const;
export const FOOT_GROUNDER_PROVENANCE_PATH =
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.provenance.json" as const;
export const FROZEN_PLAN_SOURCE =
  "packages/openclinxr/asset-registry/src/case-frozen-scene-plans.ts:101-107 revisions.clipRevision + instances[] senior_resident_ward_v1 assetSha256/byteCount" as const;
export const PROVENANCE_LINEAGE_SOURCE =
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.provenance.json motionClips[0].clipName=openclinxr_retarget_walk_source, outputSha256, retiredMotionClips formal_cc0 removed 2026-09-23" as const;

/** Historical snapshot, preserved as retired metadata only. Bytes UNKNOWN. */
export const RETIRED_FOOT_IDENTITY = {
  sha256: "63a4c9dec2065aae38d0e3336fc4a46be2de647354848cebe8269564c01d4b13",
  bytes: 9457652,
  clipRevision: "openclinxr_retarget_walk_formal_cc0",
  era: "2026-09-16",
  status: "retired",
  reason:
    "superseded by generator lineage; formal_cc0 removed 2026-09-23, replaced by walk_source (wt/walk-rebind)",
} as const;

export interface ExpectedFootGrounderIdentity {
  caseId: string;
  expectedClipRevision: string;
  expectedAssetSha256: string;
  expectedBytes: number;
  assetPath: string;
  frozenPlanSource: string;
  provenanceSource: string;
  retired: typeof RETIRED_FOOT_IDENTITY;
}

/** Expected pins read from the canonical frozen plan (NOT from disk hash). */
export function getExpectedFootGrounderIdentity(): ExpectedFootGrounderIdentity {
  const plan = CASE_FROZEN_SCENE_PLANS[FOOT_GROUNDER_CASE_ID] as unknown as {
    revisions?: { clipRevision?: string };
    instances?: Array<{
      instanceId?: string;
      assetPath?: string;
      assetSha256?: string;
      byteCount?: number;
    }>;
  };
  const clipRevision = plan?.revisions?.clipRevision ?? "";
  const physician = (plan?.instances ?? []).find(
    (i) => i?.instanceId === FOOT_GROUNDER_PHYSICIAN_INSTANCE_ID,
  );
  return {
    caseId: FOOT_GROUNDER_CASE_ID,
    expectedClipRevision: clipRevision,
    expectedAssetSha256: physician?.assetSha256 ?? "",
    expectedBytes: physician?.byteCount ?? 0,
    assetPath: FOOT_GROUNDER_ASSET_PATH,
    frozenPlanSource: FROZEN_PLAN_SOURCE,
    provenanceSource: PROVENANCE_LINEAGE_SOURCE,
    retired: RETIRED_FOOT_IDENTITY,
  };
}

/** Pure: actual producer bytes vs expected frozen-plan pin. */
export function assetMatchesExpected(
  actualSha256: string,
  actualBytes: number,
  expected: Pick<ExpectedFootGrounderIdentity, "expectedAssetSha256" | "expectedBytes">,
): boolean {
  return (
    actualSha256 === expected.expectedAssetSha256 &&
    actualBytes === expected.expectedBytes
  );
}

/** Pure: live clip stamp vs expected declared revision. */
export function clipMatchesExpected(
  liveClipStamp: string | null,
  expectedClipRevision: string,
): boolean {
  return liveClipStamp === expectedClipRevision;
}
