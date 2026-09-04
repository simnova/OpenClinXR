import {
  assemblyVisibleRevisions,
  authoredContentIdentityEvidenceRef,
  createScenarioBankDraft,
  updateScenarioBankDraft,
} from "@openclinxr/domain";
import { describe, expect, it } from "vitest";
import {
  approveScenarioBankRevisionFromHumanReview,
  forkScenarioBankDraftFromApproved,
  submitScenarioBankForReview,
  SCENARIO_BANK_PARTIAL_APPROVAL_ERROR,
  SCENARIO_BANK_STALE_APPROVAL_ERROR,
} from "./scenario-bank-approval.js";
import type { ReviewerAttestationVerifier, ReviewerEvidence } from "./scenario-publication.js";

const NOW = "2026-09-04T15:00:00.000Z";
const CONTENT = { scenarioId: "ed_chest_pain_priority_v1", title: "Chest pain", version: 1 };
const REQUIRED = ["clinician", "psychometrician", "legal", "simulation_qa"] as const;

const trustAssertedRole: ReviewerAttestationVerifier = (request) => ({
  verified: true,
  principalId: request.reviewerId,
  roles: [request.assertedRole],
});

const rejectAll: ReviewerAttestationVerifier = (request) => ({
  verified: false,
  reason: `untrusted:${request.reviewerId}`,
});

function reviewer(role: string, identity: string): ReviewerEvidence {
  return {
    reviewerRole: role,
    reviewerId: `${role}-001`,
    decision: "approved",
    comments: `Approved by ${role}.`,
    evidenceRefs: [`evidence:${role}:2026-09-04`, authoredContentIdentityEvidenceRef(identity)],
    reviewedAt: NOW,
  };
}

function reviewReadyRevision() {
  const draft = createScenarioBankDraft({
    scenarioId: CONTENT.scenarioId,
    authoredContent: CONTENT,
    actorId: "author_001",
    now: NOW,
  });
  return submitScenarioBankForReview(draft, { actorId: "author_001", now: NOW });
}

describe("scenario-bank human review approval", () => {
  it("promotes a completed identity-bound human review to an assembly-eligible approved version", () => {
    const reviewReady = reviewReadyRevision();
    const approved = approveScenarioBankRevisionFromHumanReview({
      revision: reviewReady,
      reviewerEvidence: REQUIRED.map((role) => reviewer(role, reviewReady.authoredContentIdentity)),
      requiredGateRoles: REQUIRED,
      attestationVerifier: trustAssertedRole,
      actorId: "faculty_001",
      now: NOW,
    });

    expect(approved.lifecycle).toBe("approved_version");
    expect(assemblyVisibleRevisions([reviewReady, approved])).toEqual([approved]);
    expect(approved.notEvidenceFor).toContain("scoring");
    expect(approved.notEvidenceFor).toContain("autonomous_clinical_approval");
  });

  it("refuses stale identity, partial gates, missing verifier, and self-declared roles", () => {
    const reviewReady = reviewReadyRevision();
    const identity = reviewReady.authoredContentIdentity;

    expect(() =>
      approveScenarioBankRevisionFromHumanReview({
        revision: reviewReady,
        reviewerEvidence: REQUIRED.map((role) => reviewer(role, "deadbeef")),
        requiredGateRoles: REQUIRED,
        attestationVerifier: trustAssertedRole,
        actorId: "faculty_001",
        now: NOW,
      }),
    ).toThrow(SCENARIO_BANK_STALE_APPROVAL_ERROR);

    expect(() =>
      approveScenarioBankRevisionFromHumanReview({
        revision: reviewReady,
        reviewerEvidence: [reviewer("clinician", identity)],
        requiredGateRoles: REQUIRED,
        attestationVerifier: trustAssertedRole,
        actorId: "faculty_001",
        now: NOW,
      }),
    ).toThrow(SCENARIO_BANK_PARTIAL_APPROVAL_ERROR);

    expect(() =>
      approveScenarioBankRevisionFromHumanReview({
        revision: reviewReady,
        reviewerEvidence: REQUIRED.map((role) => reviewer(role, identity)),
        requiredGateRoles: REQUIRED,
        actorId: "faculty_001",
        now: NOW,
      }),
    ).toThrow(SCENARIO_BANK_PARTIAL_APPROVAL_ERROR);

    expect(() =>
      approveScenarioBankRevisionFromHumanReview({
        revision: reviewReady,
        reviewerEvidence: REQUIRED.map((role) => reviewer(role, identity)),
        requiredGateRoles: REQUIRED,
        attestationVerifier: rejectAll,
        actorId: "faculty_001",
        now: NOW,
      }),
    ).toThrow(SCENARIO_BANK_PARTIAL_APPROVAL_ERROR);
  });

  it("forks a new draft instead of mutating an approved version, and keeps the approved copy assembly-visible", () => {
    const reviewReady = reviewReadyRevision();
    const approved = approveScenarioBankRevisionFromHumanReview({
      revision: reviewReady,
      reviewerEvidence: REQUIRED.map((role) => reviewer(role, reviewReady.authoredContentIdentity)),
      requiredGateRoles: REQUIRED,
      attestationVerifier: trustAssertedRole,
      actorId: "faculty_001",
      now: NOW,
    });

    const nextContent = { ...CONTENT, title: "Chest pain — revised history", version: 2 };
    const forked = forkScenarioBankDraftFromApproved(approved, nextContent, { actorId: "author_001", now: NOW });
    expect(forked.lifecycle).toBe("draft");
    expect(forked.parentRevisionId).toBe(approved.revisionId);
    expect(approved.authoredContent).toEqual(CONTENT);
    expect(assemblyVisibleRevisions([approved, forked])).toEqual([approved]);
    expect(() => updateScenarioBankDraft(approved, nextContent, { actorId: "author_001", now: NOW })).toThrow(
      /immutable|fork/,
    );
  });
});
