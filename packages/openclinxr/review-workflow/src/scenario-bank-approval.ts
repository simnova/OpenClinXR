import {
  approveScenarioBankVersion,
  authoredContentIdentityFromEvidenceRefs,
  forkDraftFromImmutableVersion,
  markScenarioBankReviewReady,
  SCENARIO_BANK_AUTONOMOUS_APPROVAL_ERROR,
  SCENARIO_BANK_PARTIAL_APPROVAL_ERROR,
  SCENARIO_BANK_STALE_APPROVAL_ERROR,
  type CompletedHumanReview,
  type ScenarioBankRevision,
} from "@openclinxr/domain";
import type { ReviewerAttestationVerifier, ReviewerEvidence } from "./scenario-publication.js";

export {
  SCENARIO_BANK_AUTONOMOUS_APPROVAL_ERROR,
  SCENARIO_BANK_PARTIAL_APPROVAL_ERROR,
  SCENARIO_BANK_STALE_APPROVAL_ERROR,
};

export type BindScenarioBankHumanReviewInput<TAuthored> = {
  revision: ScenarioBankRevision<TAuthored>;
  reviewerEvidence: readonly ReviewerEvidence[];
  requiredGateRoles: readonly string[];
  attestationVerifier?: ReviewerAttestationVerifier;
};

export type ApproveScenarioBankRevisionInput<TAuthored> = BindScenarioBankHumanReviewInput<TAuthored> & {
  actorId: string;
  now?: string;
};

function shapeValidApprovals(reviewerEvidence: readonly ReviewerEvidence[]): ReviewerEvidence[] {
  return reviewerEvidence
    .filter((evidence) => evidence.decision === "approved")
    .filter((evidence) => evidence.reviewerId.trim().length > 0)
    .filter((evidence) => evidence.comments.trim().length > 0)
    .filter((evidence) => evidence.evidenceRefs.length > 0 && evidence.evidenceRefs.every((ref) => ref.trim().length > 0))
    .filter((evidence) => !Number.isNaN(Date.parse(evidence.reviewedAt)));
}

/**
 * Completed human review for one revision. Roles come from the trusted verifier, never from the
 * evidence row's self-declared `reviewerRole`. Absence of a verifier credits no roles (fail closed).
 * Stale identity bindings are refused rather than reused against later authored content.
 */
export function bindCompletedHumanReview<TAuthored>(
  input: BindScenarioBankHumanReviewInput<TAuthored>,
): CompletedHumanReview {
  const required = [...new Set(input.requiredGateRoles.map((role) => role.trim()).filter((role) => role.length > 0))];
  if (required.length === 0) {
    throw new Error(SCENARIO_BANK_PARTIAL_APPROVAL_ERROR);
  }

  const shapeValid = shapeValidApprovals(input.reviewerEvidence);
  const boundIdentities = shapeValid
    .map((evidence) => authoredContentIdentityFromEvidenceRefs(evidence.evidenceRefs))
    .filter((identity): identity is string => identity !== undefined && identity.length > 0);

  if (boundIdentities.some((identity) => identity !== input.revision.authoredContentIdentity)) {
    throw new Error(SCENARIO_BANK_STALE_APPROVAL_ERROR);
  }
  if (shapeValid.length > 0 && boundIdentities.length === 0) {
    throw new Error(SCENARIO_BANK_STALE_APPROVAL_ERROR);
  }

  const currentIdentityEvidence = shapeValid.filter(
    (evidence) => authoredContentIdentityFromEvidenceRefs(evidence.evidenceRefs) === input.revision.authoredContentIdentity,
  );

  const approvedRoles = new Set<string>();
  if (input.attestationVerifier) {
    for (const evidence of currentIdentityEvidence) {
      const principal = input.attestationVerifier({
        scenarioId: input.revision.scenarioId,
        scenarioVersion: input.revision.version,
        reviewerId: evidence.reviewerId,
        assertedRole: evidence.reviewerRole,
        decision: evidence.decision,
        evidenceId: evidence.evidenceRefs.join("|"),
      });
      if (principal.verified && principal.roles.includes(evidence.reviewerRole)) {
        approvedRoles.add(evidence.reviewerRole);
      }
    }
  }

  if (required.some((role) => !approvedRoles.has(role))) {
    throw new Error(SCENARIO_BANK_PARTIAL_APPROVAL_ERROR);
  }

  const latest = currentIdentityEvidence[currentIdentityEvidence.length - 1];
  if (!latest) {
    throw new Error(SCENARIO_BANK_PARTIAL_APPROVAL_ERROR);
  }

  return {
    authoredContentIdentity: input.revision.authoredContentIdentity,
    reviewedAt: latest.reviewedAt,
    reviewerId: latest.reviewerId,
    requiredGateRoles: required,
    approvedGateRoles: [...approvedRoles],
    autonomousApproval: false,
    scoringClaimed: false,
  };
}

function withOptionalNow(actorId: string, now: string | undefined): { actorId: string; now?: string } {
  return now === undefined ? { actorId } : { actorId, now };
}

export function submitScenarioBankForReview<TAuthored>(
  revision: ScenarioBankRevision<TAuthored>,
  input: { actorId: string; now?: string },
): ScenarioBankRevision<TAuthored> {
  return markScenarioBankReviewReady(revision, withOptionalNow(input.actorId, input.now));
}

/**
 * Human-review path onto an immutable assembly-eligible approved version.
 * Does not score. Does not autonomously invent clinical approval.
 */
export function approveScenarioBankRevisionFromHumanReview<TAuthored>(
  input: ApproveScenarioBankRevisionInput<TAuthored>,
): ScenarioBankRevision<TAuthored> {
  const bindInput: BindScenarioBankHumanReviewInput<TAuthored> = {
    revision: input.revision,
    reviewerEvidence: input.reviewerEvidence,
    requiredGateRoles: input.requiredGateRoles,
  };
  if (input.attestationVerifier !== undefined) {
    bindInput.attestationVerifier = input.attestationVerifier;
  }
  const review = bindCompletedHumanReview(bindInput);
  if (review.autonomousApproval !== false || review.scoringClaimed !== false) {
    throw new Error(SCENARIO_BANK_AUTONOMOUS_APPROVAL_ERROR);
  }
  return approveScenarioBankVersion(input.revision, review, withOptionalNow(input.actorId, input.now));
}

export function forkScenarioBankDraftFromApproved<TAuthored>(
  revision: ScenarioBankRevision<TAuthored>,
  authoredContent: TAuthored,
  input: { actorId: string; now?: string },
): ScenarioBankRevision<TAuthored> {
  return forkDraftFromImmutableVersion(revision, authoredContent, withOptionalNow(input.actorId, input.now));
}
