import {
  encounterBundleFactoryMemberKinds,
  immutableEncounterBundleNotEvidenceFor,
  promoteReviewedFactoryOutputsToImmutableEncounterBundle,
  registerGeneratedRuntimeAssetReference,
  resolveRuntimeAssetStoreConfig,
  type EncounterBundleFactoryMember,
  type EncounterBundleFactoryMemberKind,
  type PromoteReviewedFactoryOutputsInput,
  type RuntimeAssetKind,
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

export function hydrateFacultyEncounterBundlePromotionRequest(
  value: FacultyEncounterBundlePromotionRequest,
): FacultyEncounterBundlePromotionRequest {
  const storeKind = value.assetStoreKind;
  const store = resolveRuntimeAssetStoreConfig({
    storeKind,
    containerName: "openclinxr-assets",
  });
  const members = value.members.map((member) => {
    if (hasAsset(member)) {
      return member;
    }
    const slim = member as unknown as Record<string, unknown>;
    const memberKind = String(slim["memberKind"] ?? "") as EncounterBundleFactoryMemberKind;
    const assetId = String(slim["assetId"] ?? `${memberKind}_asset_v1`);
    const contentHash = String(slim["contentHash"] ?? `${memberKind}-hash-v1`);
    const provenanceRefs = Array.isArray(slim["provenanceRefs"])
      ? slim["provenanceRefs"].filter((ref): ref is string => typeof ref === "string")
      : [`provenance:${assetId}`];
    const pipelineState = slim["pipelineState"] === "generated" ? "generated" : "reviewed";
    return {
      memberKind,
      pipelineState,
      asset: registerGeneratedRuntimeAssetReference({
        assetId,
        version: "v1",
        kind: runtimeKindFor(memberKind),
        displayName: assetId,
        scenarioAssetId: assetId,
        blobName: `asset-library/${assetId}/v1/asset.bin`,
        contentHash,
        assetStore: store,
        reviewStatus: slim["reviewStatus"] === "blocked" ? "blocked" : "approved_for_local_runtime",
        provenanceRefs,
      }),
    } satisfies EncounterBundleFactoryMember;
  });
  const decisions = value.decisions ?? reviewDecisionsFor(members);
  const expectedContentHashes = value.expectedContentHashes ?? Object.fromEntries(
    members.map((member, index) => {
      const slim = value.members[index] as unknown as Record<string, unknown>;
      const expected = typeof slim["expectedContentHash"] === "string"
        ? slim["expectedContentHash"]
        : member.asset.blob.contentHash ?? "";
      return [member.asset.assetId, expected];
    }),
  );
  return {
    ...value,
    members,
    decisions,
    expectedContentHashes,
  };
}

function hasAsset(member: EncounterBundleFactoryMember): boolean {
  return typeof member === "object"
    && member !== null
    && "asset" in member
    && typeof (member as { asset?: unknown }).asset === "object";
}

function runtimeKindFor(memberKind: EncounterBundleFactoryMemberKind): RuntimeAssetKind {
  switch (memberKind) {
    case "humanoid":
      return "humanoid_model";
    case "room":
      return "environment_model";
    case "equipment":
      return "equipment_model";
    case "motion":
      return "animation_clip";
    case "voice":
      return "phoneme_map";
    case "interaction":
      return "ui_schema";
  }
}

function reviewDecisionsFor(members: readonly EncounterBundleFactoryMember[]): RuntimeAssetReviewDecision[] {
  return members.flatMap((member) => (
    ["asset_pipeline", "security_privacy"] as const
  ).map((reviewerRole) => ({
    assetId: member.asset.assetId,
    reviewerRole,
    reviewerId: `${reviewerRole}_reviewer`,
    decision: "approved_for_local_runtime" as const,
    comments: "Local runtime review approved.",
    evidenceRefs: [`evidence:${reviewerRole}:${member.asset.assetId}`],
    reviewedAt: "2026-09-04T00:00:00.000Z",
  })));
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
