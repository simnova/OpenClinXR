export const FACULTY_ENCOUNTER_BUNDLE_FACTORY_KINDS = [
  "humanoid",
  "room",
  "equipment",
  "motion",
  "voice",
  "interaction",
] as const;

export type FacultyEncounterBundleFactoryKind = (typeof FACULTY_ENCOUNTER_BUNDLE_FACTORY_KINDS)[number];

export type FacultyEncounterBundleMemberSelection = {
  memberKind: FacultyEncounterBundleFactoryKind;
  assetId: string;
  pipelineState: "generated" | "reviewed";
  reviewStatus: "fixture_approved_for_local_runtime" | "approved_for_local_runtime" | "blocked";
  provenanceRefs: readonly string[];
  contentHash: string;
  expectedContentHash: string;
  missingReviewAttestations: readonly string[];
};

export type FacultyEncounterBundlePromotionSelection = {
  scenarioId: string;
  stationId: string;
  scenarioReviewIdentity: string;
  expectedScenarioReviewIdentity: string;
  members: readonly FacultyEncounterBundleMemberSelection[];
};

export type FacultyLearnerLaunchIdentity = {
  bundleId: string;
  href: string;
};

export function collectFacultyEncounterBundleSelectionBlockers(
  selection: FacultyEncounterBundlePromotionSelection,
): string[] {
  const blockers: string[] = [];
  if (selection.scenarioId.trim().length === 0 || selection.stationId.trim().length === 0) {
    blockers.push("selection:partial");
  }
  if (selection.members.length === 0) {
    blockers.push("selection:partial");
  }
  if (
    selection.expectedScenarioReviewIdentity.trim().length === 0
    || selection.scenarioReviewIdentity.trim() !== selection.expectedScenarioReviewIdentity.trim()
  ) {
    blockers.push("selection:stale_scenario_review");
  }
  const kinds = new Set(selection.members.map((member) => member.memberKind));
  for (const kind of FACULTY_ENCOUNTER_BUNDLE_FACTORY_KINDS) {
    if (!kinds.has(kind)) {
      blockers.push(`missing_factory_member:${kind}`);
    }
  }
  for (const member of selection.members) {
    const prefix = `${member.memberKind}:${member.assetId}`;
    if (member.pipelineState === "generated") {
      blockers.push(`${prefix}:generated`);
    }
    if (member.reviewStatus === "blocked") {
      blockers.push(`${prefix}:blocked`);
    }
    if (member.provenanceRefs.length === 0 || member.provenanceRefs.some((ref) => ref.trim().length === 0)) {
      blockers.push(`${prefix}:missing_provenance`);
    }
    if (member.contentHash.trim().length === 0 || member.contentHash !== member.expectedContentHash) {
      blockers.push(`${prefix}:stale`);
    }
    for (const role of member.missingReviewAttestations) {
      blockers.push(`${prefix}:missing_review_attestation:${role}`);
    }
  }
  return [...new Set(blockers)];
}

export function collectFacultyEncounterBundleAttestations(
  selection: FacultyEncounterBundlePromotionSelection,
): string[] {
  const rows: string[] = [];
  for (const member of selection.members) {
    const prefix = `${member.memberKind}:${member.assetId}`;
    for (const ref of member.provenanceRefs) {
      if (ref.trim().length > 0) {
        rows.push(`${prefix}:provenance:${ref}`);
      }
    }
    for (const role of member.missingReviewAttestations) {
      rows.push(`${prefix}:missing_review_attestation:${role}`);
    }
  }
  return rows;
}

export function learnerLaunchHref(bundleId: string): string {
  return `/runtime/asset-bundles/${encodeURIComponent(bundleId)}`;
}
