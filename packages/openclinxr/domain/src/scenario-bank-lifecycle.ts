import {
  authoredContentIdentity,
  deepFreezeAuthoredContent,
  snapshotAuthoredContent,
} from "./authored-content-identity.js";
import type { Scenario } from "@openclinxr/shared-schemas";

export type ScenarioBankLifecycleState = "draft" | "review_ready" | "approved_version" | "retired_version";

export type ScenarioBankProvenanceKind =
  | "create_draft"
  | "edit_draft"
  | "mark_review_ready"
  | "approve_version"
  | "retire_version"
  | "fork_draft";

export type ScenarioBankProvenanceEvent = {
  at: string;
  from: ScenarioBankLifecycleState | null;
  to: ScenarioBankLifecycleState;
  kind: ScenarioBankProvenanceKind;
  authoredContentIdentity: string;
  actorId: string;
};

export const SCENARIO_BANK_APPROVED_VERSION_CLAIM_SCOPE =
  "assembly_eligible_immutable_version_from_completed_human_review" as const;

export const SCENARIO_BANK_APPROVED_VERSION_NOT_EVIDENCE_FOR = [
  "clinical_validity",
  "exam_equivalence",
  "autonomous_clinical_approval",
  "scoring",
] as const;

export type ScenarioBankApprovedVersionNotEvidenceFor =
  (typeof SCENARIO_BANK_APPROVED_VERSION_NOT_EVIDENCE_FOR)[number];

/**
 * Completed HUMAN review bound to one authored-content identity.
 * Domain never invents gate decisions. `autonomousApproval` and `scoringClaimed` are
 * false-literals so a typed caller cannot request auto-approval or scoring.
 */
export type CompletedHumanReview = {
  authoredContentIdentity: string;
  reviewedAt: string;
  reviewerId: string;
  requiredGateRoles: readonly string[];
  approvedGateRoles: readonly string[];
  autonomousApproval: false;
  scoringClaimed: false;
};

export type ScenarioBankRevision<TAuthored = unknown> = {
  scenarioId: string;
  revisionId: string;
  version: number;
  lifecycle: ScenarioBankLifecycleState;
  authoredContentIdentity: string;
  authoredContent: TAuthored;
  provenance: readonly ScenarioBankProvenanceEvent[];
  parentRevisionId?: string;
  claimScope?: typeof SCENARIO_BANK_APPROVED_VERSION_CLAIM_SCOPE;
  notEvidenceFor?: readonly ScenarioBankApprovedVersionNotEvidenceFor[];
};

export const SCENARIO_BANK_STALE_APPROVAL_ERROR =
  "Scenario bank approval authored content identity is stale for the revision under review.";
export const SCENARIO_BANK_PARTIAL_APPROVAL_ERROR =
  "Scenario bank approval requires completed human review for every required gate role.";
export const SCENARIO_BANK_AUTONOMOUS_APPROVAL_ERROR =
  "Scenario bank approval refuses autonomous clinical approval or scoring.";
export const SCENARIO_BANK_MUST_FORK_ERROR =
  "Approved and retired scenario-bank versions are immutable; edits must fork a new draft.";
export const SCENARIO_BANK_INVALID_TRANSITION_ERROR = "Invalid scenario-bank lifecycle transition.";
export const SCENARIO_BANK_CONTENT_INTEGRITY_ERROR =
  "Scenario bank assembly refuses a revision whose authored content no longer matches its canonical identity.";

function isSealedLifecycle(lifecycle: ScenarioBankLifecycleState): boolean {
  return lifecycle === "approved_version" || lifecycle === "retired_version";
}

type ActorClock = {
  actorId: string;
  now?: string;
};

function requireNonEmpty(value: string, label: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function atIso(now: string | undefined): string {
  return now ?? new Date().toISOString();
}

function revisionIdFor(scenarioId: string, version: number, identity: string): string {
  return `rev:${scenarioId}:v${version}:${identity}`;
}

function appendProvenance(
  previous: readonly ScenarioBankProvenanceEvent[],
  event: ScenarioBankProvenanceEvent,
): readonly ScenarioBankProvenanceEvent[] {
  return Object.freeze([...previous, Object.freeze(event)]);
}

function freezeRevision<TAuthored>(revision: ScenarioBankRevision<TAuthored>): ScenarioBankRevision<TAuthored> {
  const snapshot = snapshotAuthoredContent(revision.authoredContent);
  const authoredContent = isSealedLifecycle(revision.lifecycle)
    ? deepFreezeAuthoredContent(snapshot)
    : snapshot;
  const frozen: ScenarioBankRevision<TAuthored> = {
    scenarioId: revision.scenarioId,
    revisionId: revision.revisionId,
    version: revision.version,
    lifecycle: revision.lifecycle,
    authoredContentIdentity: revision.authoredContentIdentity,
    authoredContent,
    provenance: Object.freeze([...revision.provenance]),
  };
  if (revision.parentRevisionId !== undefined) {
    frozen.parentRevisionId = revision.parentRevisionId;
  }
  if (revision.claimScope !== undefined) {
    frozen.claimScope = revision.claimScope;
  }
  if (revision.notEvidenceFor !== undefined) {
    frozen.notEvidenceFor = Object.freeze([...revision.notEvidenceFor]);
  }
  return Object.freeze(frozen);
}

export function scenarioStatusForLifecycle(lifecycle: ScenarioBankLifecycleState): Scenario["status"] {
  if (lifecycle === "approved_version") return "approved";
  if (lifecycle === "retired_version") return "retired";
  return "draft";
}

export function authoredContentMatchesIdentity(revision: ScenarioBankRevision): boolean {
  return authoredContentIdentity(revision.authoredContent) === revision.authoredContentIdentity;
}

export function assertAuthoredContentIntegrity(revision: ScenarioBankRevision): void {
  if (!authoredContentMatchesIdentity(revision)) {
    throw new Error(SCENARIO_BANK_CONTENT_INTEGRITY_ERROR);
  }
}

export function isAssemblyEligibleRevision(revision: ScenarioBankRevision): boolean {
  if (revision.lifecycle !== "approved_version") {
    return false;
  }
  assertAuthoredContentIntegrity(revision);
  return true;
}

/** Only approved versions whose content still matches canonical identity are visible to exam assembly. */
export function assemblyVisibleRevisions<TAuthored>(
  revisions: readonly ScenarioBankRevision<TAuthored>[],
): readonly ScenarioBankRevision<TAuthored>[] {
  return revisions.filter((revision) => isAssemblyEligibleRevision(revision));
}

export function createScenarioBankDraft<TAuthored>(input: {
  scenarioId: string;
  authoredContent: TAuthored;
  actorId: string;
  now?: string;
  version?: number;
}): ScenarioBankRevision<TAuthored> {
  const scenarioId = requireNonEmpty(input.scenarioId, "scenarioId");
  const actorId = requireNonEmpty(input.actorId, "actorId");
  const version = input.version ?? 1;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("version must be a positive integer");
  }
  const identity = authoredContentIdentity(input.authoredContent);
  const at = atIso(input.now);
  const lifecycle = "draft" as const;
  return freezeRevision({
    scenarioId,
    revisionId: revisionIdFor(scenarioId, version, identity),
    version,
    lifecycle,
    authoredContentIdentity: identity,
    authoredContent: input.authoredContent,
    provenance: appendProvenance([], {
      at,
      from: null,
      to: lifecycle,
      kind: "create_draft",
      authoredContentIdentity: identity,
      actorId,
    }),
  });
}

export function updateScenarioBankDraft<TAuthored>(
  revision: ScenarioBankRevision<TAuthored>,
  authoredContent: TAuthored,
  input: ActorClock,
): ScenarioBankRevision<TAuthored> {
  if (isSealedLifecycle(revision.lifecycle)) {
    throw new Error(SCENARIO_BANK_MUST_FORK_ERROR);
  }
  const actorId = requireNonEmpty(input.actorId, "actorId");
  const identity = authoredContentIdentity(authoredContent);
  const at = atIso(input.now);
  const nextLifecycle = "draft" as const;
  const next: ScenarioBankRevision<TAuthored> = {
    scenarioId: revision.scenarioId,
    revisionId: revisionIdFor(revision.scenarioId, revision.version, identity),
    version: revision.version,
    lifecycle: nextLifecycle,
    authoredContentIdentity: identity,
    authoredContent,
    provenance: appendProvenance(revision.provenance, {
      at,
      from: revision.lifecycle,
      to: nextLifecycle,
      kind: "edit_draft",
      authoredContentIdentity: identity,
      actorId,
    }),
  };
  if (revision.parentRevisionId !== undefined) {
    next.parentRevisionId = revision.parentRevisionId;
  }
  return freezeRevision(next);
}

export function markScenarioBankReviewReady<TAuthored>(
  revision: ScenarioBankRevision<TAuthored>,
  input: ActorClock,
): ScenarioBankRevision<TAuthored> {
  if (revision.lifecycle !== "draft") {
    throw new Error(SCENARIO_BANK_INVALID_TRANSITION_ERROR);
  }
  const currentIdentity = authoredContentIdentity(revision.authoredContent);
  if (currentIdentity !== revision.authoredContentIdentity) {
    throw new Error(SCENARIO_BANK_STALE_APPROVAL_ERROR);
  }
  const actorId = requireNonEmpty(input.actorId, "actorId");
  const at = atIso(input.now);
  return freezeRevision({
    ...revision,
    lifecycle: "review_ready",
    provenance: appendProvenance(revision.provenance, {
      at,
      from: revision.lifecycle,
      to: "review_ready",
      kind: "mark_review_ready",
      authoredContentIdentity: revision.authoredContentIdentity,
      actorId,
    }),
  });
}

function assertCompletedHumanReview(revision: ScenarioBankRevision, review: CompletedHumanReview): void {
  if (review.autonomousApproval !== false || review.scoringClaimed !== false) {
    throw new Error(SCENARIO_BANK_AUTONOMOUS_APPROVAL_ERROR);
  }
  requireNonEmpty(review.reviewerId, "reviewerId");
  if (Number.isNaN(Date.parse(review.reviewedAt))) {
    throw new Error("completed human review requires a parseable reviewedAt");
  }
  if (review.authoredContentIdentity !== revision.authoredContentIdentity) {
    throw new Error(SCENARIO_BANK_STALE_APPROVAL_ERROR);
  }
  if (authoredContentIdentity(revision.authoredContent) !== revision.authoredContentIdentity) {
    throw new Error(SCENARIO_BANK_STALE_APPROVAL_ERROR);
  }
  const required = [...new Set(review.requiredGateRoles.map((role) => role.trim()).filter((role) => role.length > 0))];
  if (required.length === 0) {
    throw new Error(SCENARIO_BANK_PARTIAL_APPROVAL_ERROR);
  }
  const approved = new Set(review.approvedGateRoles);
  if (required.some((role) => !approved.has(role))) {
    throw new Error(SCENARIO_BANK_PARTIAL_APPROVAL_ERROR);
  }
}

export function approveScenarioBankVersion<TAuthored>(
  revision: ScenarioBankRevision<TAuthored>,
  review: CompletedHumanReview,
  input: ActorClock,
): ScenarioBankRevision<TAuthored> {
  if (revision.lifecycle !== "review_ready") {
    throw new Error(SCENARIO_BANK_INVALID_TRANSITION_ERROR);
  }
  assertCompletedHumanReview(revision, review);
  const actorId = requireNonEmpty(input.actorId, "actorId");
  const at = atIso(input.now);
  return freezeRevision({
    ...revision,
    lifecycle: "approved_version",
    claimScope: SCENARIO_BANK_APPROVED_VERSION_CLAIM_SCOPE,
    notEvidenceFor: SCENARIO_BANK_APPROVED_VERSION_NOT_EVIDENCE_FOR,
    provenance: appendProvenance(revision.provenance, {
      at,
      from: revision.lifecycle,
      to: "approved_version",
      kind: "approve_version",
      authoredContentIdentity: revision.authoredContentIdentity,
      actorId,
    }),
  });
}

export function retireScenarioBankVersion<TAuthored>(
  revision: ScenarioBankRevision<TAuthored>,
  input: ActorClock,
): ScenarioBankRevision<TAuthored> {
  if (revision.lifecycle !== "approved_version") {
    throw new Error(SCENARIO_BANK_INVALID_TRANSITION_ERROR);
  }
  const actorId = requireNonEmpty(input.actorId, "actorId");
  const at = atIso(input.now);
  return freezeRevision({
    ...revision,
    lifecycle: "retired_version",
    provenance: appendProvenance(revision.provenance, {
      at,
      from: revision.lifecycle,
      to: "retired_version",
      kind: "retire_version",
      authoredContentIdentity: revision.authoredContentIdentity,
      actorId,
    }),
  });
}

export function forkDraftFromImmutableVersion<TAuthored>(
  revision: ScenarioBankRevision<TAuthored>,
  authoredContent: TAuthored,
  input: ActorClock,
): ScenarioBankRevision<TAuthored> {
  if (!isSealedLifecycle(revision.lifecycle)) {
    throw new Error(SCENARIO_BANK_INVALID_TRANSITION_ERROR);
  }
  const actorId = requireNonEmpty(input.actorId, "actorId");
  const identity = authoredContentIdentity(authoredContent);
  const version = revision.version + 1;
  const at = atIso(input.now);
  return freezeRevision({
    scenarioId: revision.scenarioId,
    revisionId: revisionIdFor(revision.scenarioId, version, identity),
    version,
    lifecycle: "draft",
    authoredContentIdentity: identity,
    authoredContent,
    parentRevisionId: revision.revisionId,
    provenance: appendProvenance([], {
      at,
      from: null,
      to: "draft",
      kind: "fork_draft",
      authoredContentIdentity: identity,
      actorId,
    }),
  });
}
