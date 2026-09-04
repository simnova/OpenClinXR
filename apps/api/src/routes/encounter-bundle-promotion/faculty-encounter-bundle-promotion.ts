import {
  encounterBundleFactoryMemberKinds,
  immutableEncounterBundleNotEvidenceFor,
  promoteReviewedFactoryOutputsToImmutableEncounterBundle,
  type EncounterBundleFactoryMember,
  type PromoteReviewedFactoryOutputsInput,
  type RuntimeAssetReviewDecision,
  type RuntimeAssetStoreKind,
} from "@openclinxr/asset-registry";

export const FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PATH = "/faculty/encounter-bundle-promotion";
export const FACULTY_ENCOUNTER_BUNDLE_PROMOTION_PREVIEW_PATH = "/faculty/encounter-bundle-promotion/preview";

export const facultyEncounterBundlePromotionClaimScope =
  "faculty_encounter_bundle_promotion_not_production_readiness" as const;

export const facultyEncounterBundlePromotionNotEvidenceFor = [
  ...immutableEncounterBundleNotEvidenceFor,
  "automatic_approval",
] as const;

export type FacultyEncounterBundlePromotionRequest = {
  scenarioId: string;
  stationId: string;
  scenarioReviewIdentity: string;
  expectedScenarioReviewIdentity: string;
  assetStoreKind: RuntimeAssetStoreKind;
  members: readonly EncounterBundleFactoryMember[];
  decisions?: readonly RuntimeAssetReviewDecision[] | undefined;
  expectedContentHashes?: Readonly<Record<string, string>> | undefined;
};

export type FacultyLearnerLaunchIdentity = {
  bundleId: string;
  href: string;
};

export type FacultyEncounterBundlePromotionPreview = {
  promoted: false;
  canPromote: boolean;
  blockers: string[];
  attestations: string[];
  learnerLaunchIdentity: null;
  claimScope: typeof facultyEncounterBundlePromotionClaimScope;
  notEvidenceFor: typeof facultyEncounterBundlePromotionNotEvidenceFor;
};

export type FacultyEncounterBundlePromotionSuccess = {
  promoted: true;
  canPromote: true;
  blockers: [];
  attestations: string[];
  learnerLaunchIdentity: FacultyLearnerLaunchIdentity;
  claimScope: typeof facultyEncounterBundlePromotionClaimScope;
  notEvidenceFor: typeof facultyEncounterBundlePromotionNotEvidenceFor;
};

export type FacultyEncounterBundlePromotionResult =
  | FacultyEncounterBundlePromotionPreview
  | FacultyEncounterBundlePromotionSuccess;

export function collectFacultyEncounterBundlePromotionBlockers(
  input: FacultyEncounterBundlePromotionRequest,
): string[] {
  const blockers: string[] = [];
  if (input.scenarioId.trim().length === 0 || input.stationId.trim().length === 0) {
    blockers.push("selection:partial");
  }
  if (input.members.length === 0) {
    blockers.push("selection:partial");
  }
  const expectedIdentity = input.expectedScenarioReviewIdentity.trim();
  const actualIdentity = input.scenarioReviewIdentity.trim();
  if (expectedIdentity.length === 0 || actualIdentity !== expectedIdentity) {
    blockers.push("selection:stale_scenario_review");
  }
  const kinds = new Set(input.members.map((member) => member.memberKind));
  for (const kind of encounterBundleFactoryMemberKinds) {
    if (!kinds.has(kind)) {
      blockers.push(`missing_factory_member:${kind}`);
    }
  }
  const promotion = promoteReviewedFactoryOutputsToImmutableEncounterBundle(toFactoryInput(input));
  if (!promotion.promoted) {
    blockers.push(...promotion.blockers);
  }
  return [...new Set(blockers)];
}

export function collectFacultyEncounterBundleAttestations(
  input: FacultyEncounterBundlePromotionRequest,
): string[] {
  const attestations: string[] = [];
  for (const member of input.members) {
    const prefix = `${member.memberKind}:${member.asset.assetId}`;
    for (const ref of member.asset.provenanceRefs) {
      if (ref.trim().length > 0) {
        attestations.push(`${prefix}:provenance:${ref}`);
      }
    }
    const approvedRoles = new Set(
      (input.decisions ?? [])
        .filter((decision) => decision.assetId === member.asset.assetId)
        .filter((decision) => decision.decision === "approved_for_local_runtime")
        .map((decision) => decision.reviewerRole),
    );
    for (const role of ["asset_pipeline", "security_privacy"] as const) {
      if (approvedRoles.has(role)) {
        attestations.push(`${prefix}:review:${role}`);
      } else {
        attestations.push(`${prefix}:missing_review_attestation:${role}`);
      }
    }
  }
  return attestations;
}

export function previewFacultyEncounterBundlePromotion(
  input: FacultyEncounterBundlePromotionRequest,
): FacultyEncounterBundlePromotionPreview {
  const blockers = collectFacultyEncounterBundlePromotionBlockers(input);
  return {
    promoted: false,
    canPromote: blockers.length === 0,
    blockers,
    attestations: collectFacultyEncounterBundleAttestations(input),
    learnerLaunchIdentity: null,
    claimScope: facultyEncounterBundlePromotionClaimScope,
    notEvidenceFor: facultyEncounterBundlePromotionNotEvidenceFor,
  };
}

export function promoteFacultyEncounterBundle(
  input: FacultyEncounterBundlePromotionRequest,
): FacultyEncounterBundlePromotionResult {
  const preview = previewFacultyEncounterBundlePromotion(input);
  if (!preview.canPromote) {
    return preview;
  }
  const promotion = promoteReviewedFactoryOutputsToImmutableEncounterBundle(toFactoryInput(input));
  if (!promotion.promoted) {
    return {
      ...preview,
      canPromote: false,
      blockers: promotion.blockers,
    };
  }
  return {
    promoted: true,
    canPromote: true,
    blockers: [],
    attestations: preview.attestations,
    learnerLaunchIdentity: {
      bundleId: promotion.bundleId,
      href: learnerLaunchHref(promotion.bundleId),
    },
    claimScope: facultyEncounterBundlePromotionClaimScope,
    notEvidenceFor: facultyEncounterBundlePromotionNotEvidenceFor,
  };
}

export function learnerLaunchHref(bundleId: string): string {
  return `/runtime/asset-bundles/${encodeURIComponent(bundleId)}`;
}

export function isFacultyEncounterBundlePromotionRequest(
  value: unknown,
): value is FacultyEncounterBundlePromotionRequest {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value["scenarioId"] === "string"
    && typeof value["stationId"] === "string"
    && typeof value["scenarioReviewIdentity"] === "string"
    && typeof value["expectedScenarioReviewIdentity"] === "string"
    && typeof value["assetStoreKind"] === "string"
    && Array.isArray(value["members"]);
}

function toFactoryInput(input: FacultyEncounterBundlePromotionRequest): PromoteReviewedFactoryOutputsInput {
  return {
    stationId: input.stationId,
    scenarioId: input.scenarioId,
    assetStoreKind: input.assetStoreKind,
    members: input.members,
    decisions: input.decisions,
    expectedContentHashes: input.expectedContentHashes,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
