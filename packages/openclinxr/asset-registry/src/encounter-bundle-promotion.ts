import type { RuntimeAssetReviewDecision } from "./runtime-asset-review.js";
import {
  buildEncounterRuntimeAssetBundle,
  toLearnerRuntimeAssetBundle,
  type EncounterRuntimeAsset,
  type LearnerRuntimeAssetBundle,
  type RuntimeAssetStoreKind,
} from "./runtime-bundles.js";

export const encounterBundleFactoryMemberKinds = [
  "humanoid",
  "room",
  "equipment",
  "motion",
  "voice",
  "interaction",
] as const;

export type EncounterBundleFactoryMemberKind = (typeof encounterBundleFactoryMemberKinds)[number];

export type EncounterBundleFactoryMemberPipelineState = "generated" | "reviewed";

export type EncounterBundleFactoryMember = {
  memberKind: EncounterBundleFactoryMemberKind;
  asset: EncounterRuntimeAsset;
  pipelineState?: EncounterBundleFactoryMemberPipelineState | undefined;
};

export const immutableEncounterBundleNotEvidenceFor = [
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
] as const;

export const immutableEncounterBundleClaimScope =
  "local_promoted_encounter_bundle_not_production_readiness" as const;

const REQUIRED_REVIEW_ROLES = ["asset_pipeline", "security_privacy"] as const;
const IDENTITY_LEAK_KEYS = ["tenantId", "userId", "examRunId", "encounterId"] as const;
const IDENTITY_LEAK_PATTERN = /tenantid|userid|examrunid|encounterid|(?:^|\/)tenants\/|exam_run|encounter_/iu;

export type EncounterBundleMemberContentIdentity = {
  assetId: string;
  memberKind: EncounterBundleFactoryMemberKind;
  contentHash: string;
  provenanceRefs: string[];
};

export type PromoteReviewedFactoryOutputsInput = {
  stationId: string;
  scenarioId: string;
  assetStoreKind: RuntimeAssetStoreKind;
  members: readonly EncounterBundleFactoryMember[];
  decisions?: readonly RuntimeAssetReviewDecision[] | undefined;
  expectedContentHashes?: Readonly<Record<string, string>> | undefined;
  opaqueBundleId?: string | undefined;
  generatedAt?: string | undefined;
  nowIso?: string | undefined;
};

export type ImmutableEncounterBundlePromotion = {
  promoted: true;
  bundleId: string;
  contentIdentity: string;
  learnerBundle: LearnerRuntimeAssetBundle;
  memberContentIdentities: EncounterBundleMemberContentIdentity[];
  claimScope: typeof immutableEncounterBundleClaimScope;
  notEvidenceFor: typeof immutableEncounterBundleNotEvidenceFor;
};

export type ImmutableEncounterBundlePromotionRefusal = {
  promoted: false;
  bundleId: null;
  contentIdentity: null;
  learnerBundle: null;
  blockers: string[];
  claimScope: typeof immutableEncounterBundleClaimScope;
  notEvidenceFor: typeof immutableEncounterBundleNotEvidenceFor;
};

export type ImmutableEncounterBundlePromotionResult =
  | ImmutableEncounterBundlePromotion
  | ImmutableEncounterBundlePromotionRefusal;

export function promoteReviewedFactoryOutputsToImmutableEncounterBundle(
  input: PromoteReviewedFactoryOutputsInput,
): ImmutableEncounterBundlePromotionResult {
  const blockers = [
    ...requireFactoryKinds(input.members),
    ...input.members.flatMap((member) => inspectMember(member, input)),
  ];
  if (input.opaqueBundleId) {
    blockers.push(...inspectOpaqueBundleId(input.opaqueBundleId));
  }
  if (blockers.length > 0) {
    return refuse(blockers);
  }

  const memberContentIdentities = input.members
    .map((member) => ({
      assetId: member.asset.assetId,
      memberKind: member.memberKind,
      contentHash: member.asset.blob.contentHash ?? "",
      provenanceRefs: [...member.asset.provenanceRefs].sort(),
    }))
    .sort((left, right) =>
      left.memberKind === right.memberKind
        ? left.assetId.localeCompare(right.assetId)
        : left.memberKind.localeCompare(right.memberKind),
    );
  const contentIdentity = contentIdentityHex(canonical({
    schemaVersion: "openclinxr.immutable-encounter-bundle.v1",
    stationId: input.stationId,
    scenarioId: input.scenarioId,
    assetStoreKind: input.assetStoreKind,
    members: memberContentIdentities.map((member) => ({
      memberKind: member.memberKind,
      assetId: member.assetId,
      contentHash: member.contentHash,
      provenanceRefs: member.provenanceRefs,
    })),
  }));
  const bundleId = input.opaqueBundleId ?? `bdl_${contentIdentity}`;
  const idBlockers = inspectOpaqueBundleId(bundleId);
  if (idBlockers.length > 0) {
    return refuse(idBlockers);
  }

  const learnerBundle = freezeLearnerBundle(assembleLearnerBundle(input, bundleId));
  return {
    promoted: true,
    bundleId,
    contentIdentity,
    learnerBundle,
    memberContentIdentities,
    claimScope: immutableEncounterBundleClaimScope,
    notEvidenceFor: immutableEncounterBundleNotEvidenceFor,
  };
}

function refuse(blockers: string[]): ImmutableEncounterBundlePromotionRefusal {
  return {
    promoted: false,
    bundleId: null,
    contentIdentity: null,
    learnerBundle: null,
    blockers: [...new Set(blockers)],
    claimScope: immutableEncounterBundleClaimScope,
    notEvidenceFor: immutableEncounterBundleNotEvidenceFor,
  };
}

function requireFactoryKinds(members: readonly EncounterBundleFactoryMember[]): string[] {
  return encounterBundleFactoryMemberKinds
    .filter((kind) => !members.some((member) => member.memberKind === kind))
    .map((kind) => `missing_factory_member:${kind}`);
}

function inspectMember(
  member: EncounterBundleFactoryMember,
  input: PromoteReviewedFactoryOutputsInput,
): string[] {
  const asset = member.asset;
  const prefix = `${member.memberKind}:${asset.assetId}`;
  const blockers: string[] = [];
  const pipelineState = member.pipelineState ?? inferredPipelineState(asset);

  if (pipelineState === "generated") {
    blockers.push(`${prefix}:generated`);
  }
  if (asset.reviewStatus === "blocked") {
    blockers.push(`${prefix}:blocked`);
  }
  if (asset.provenanceRefs.length === 0 || asset.provenanceRefs.some((ref) => ref.trim().length === 0)) {
    blockers.push(`${prefix}:missing_provenance`);
  }
  const contentHash = asset.blob.contentHash?.trim() ?? "";
  if (contentHash.length === 0) {
    blockers.push(`${prefix}:stale`);
  }
  const expected = input.expectedContentHashes?.[asset.assetId];
  if (expected && expected !== contentHash) {
    blockers.push(`${prefix}:stale`);
  }
  blockers.push(...inspectIdentityLeak(prefix, asset));
  if (asset.reviewStatus === "approved_for_local_runtime") {
    blockers.push(...inspectReviewAttestations(prefix, asset.assetId, input.decisions ?? []));
  }
  if (
    asset.reviewStatus !== "approved_for_local_runtime"
    && asset.reviewStatus !== "fixture_approved_for_local_runtime"
    && asset.reviewStatus !== "blocked"
  ) {
    blockers.push(`${prefix}:generated`);
  }
  return blockers;
}

function inferredPipelineState(asset: EncounterRuntimeAsset): EncounterBundleFactoryMemberPipelineState {
  if (asset.reviewStatus === "blocked") {
    return "reviewed";
  }
  if (
    asset.reviewStatus === "approved_for_local_runtime"
    || asset.reviewStatus === "fixture_approved_for_local_runtime"
  ) {
    return "reviewed";
  }
  return "generated";
}

function inspectReviewAttestations(
  prefix: string,
  assetId: string,
  decisions: readonly RuntimeAssetReviewDecision[],
): string[] {
  const approvedRoles = new Set(
    decisions
      .filter((decision) => decision.assetId === assetId)
      .filter((decision) => decision.decision === "approved_for_local_runtime")
      .filter((decision) => decision.reviewerId.trim().length > 0)
      .filter((decision) => decision.evidenceRefs.length > 0)
      .filter((decision) => !Number.isNaN(Date.parse(decision.reviewedAt)))
      .map((decision) => decision.reviewerRole),
  );
  return REQUIRED_REVIEW_ROLES
    .filter((role) => !approvedRoles.has(role))
    .map((role) => `${prefix}:missing_review_attestation:${role}`);
}

function inspectIdentityLeak(prefix: string, asset: EncounterRuntimeAsset): string[] {
  const record = asset as unknown as Record<string, unknown>;
  const leakedKeys = IDENTITY_LEAK_KEYS.filter((key) => key in record);
  const haystack = `${asset.assetId} ${asset.blob.blobName} ${asset.blob.url} ${asset.displayName}`;
  if (leakedKeys.length > 0 || IDENTITY_LEAK_PATTERN.test(haystack)) {
    return [`${prefix}:identity-leaking`];
  }
  return [];
}

function inspectOpaqueBundleId(bundleId: string): string[] {
  if (bundleId.trim().length === 0) {
    return ["opaque_bundle_id:blank"];
  }
  if (IDENTITY_LEAK_PATTERN.test(bundleId) || bundleId.includes(":")) {
    return ["opaque_bundle_id:identity-leaking"];
  }
  return [];
}

function assembleLearnerBundle(
  input: PromoteReviewedFactoryOutputsInput,
  bundleId: string,
): LearnerRuntimeAssetBundle {
  const byKind = Object.fromEntries(
    encounterBundleFactoryMemberKinds.map((kind) => [
      kind,
      input.members.filter((member) => member.memberKind === kind).map((member) => member.asset),
    ]),
  ) as Record<EncounterBundleFactoryMemberKind, EncounterRuntimeAsset[]>;
  const humanoid = byKind.humanoid[0];
  const room = byKind.room[0];
  if (!humanoid || !room) {
    throw new Error("immutable encounter bundle assembly requires humanoid and room members");
  }
  const voice = byKind.voice[0];
  const generatedAt = input.generatedAt ?? input.nowIso ?? "2026-09-04T00:00:00.000Z";
  const encounterBundle = buildEncounterRuntimeAssetBundle({
    bundleId,
    tenantId: "opaque",
    userId: "opaque",
    examRunId: "opaque",
    encounterId: "opaque",
    stationId: input.stationId,
    scenarioId: input.scenarioId,
    assetStore: { storeKind: input.assetStoreKind, containerName: "openclinxr-assets" },
    environment: room,
    actors: [{
      actorId: "promoted_patient",
      embodiment: "humanoid",
      role: "patient",
      model: humanoid,
      animationClips: byKind.motion,
      phonemeMap: voice,
      gazeProfile: { defaultTarget: "learner_camera", supportsActorTargets: true },
    }],
    equipment: byKind.equipment.map((model, index) => ({
      equipmentId: `promoted_equipment_${index + 1}`,
      model,
    })),
    uiSurfaces: byKind.interaction.map((schema, index) => ({
      surfaceId: `promoted_interaction_${index + 1}`,
      renderer: "schema_panel" as const,
      schema,
    })),
    generatedAt,
    expiresAt: null,
  });
  return toLearnerRuntimeAssetBundle({
    ...encounterBundle,
    frozenForEncounter: true,
  });
}

function freezeLearnerBundle(bundle: LearnerRuntimeAssetBundle): LearnerRuntimeAssetBundle {
  return freezeDeep(structuredClone(bundle));
}

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    freezeDeep(nested);
  }
  return Object.freeze(value);
}

function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}

function contentIdentityHex(value: string): string {
  return `${fnv1a64(value)}${fnv1a64([...value].reverse().join(""))}`;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}
