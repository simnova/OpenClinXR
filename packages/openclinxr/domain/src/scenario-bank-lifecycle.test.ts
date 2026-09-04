import { describe, expect, it } from "vitest";
import { authoredContentIdentity } from "./authored-content-identity.js";
import {
  approveScenarioBankVersion,
  assemblyVisibleRevisions,
  createScenarioBankDraft,
  forkDraftFromImmutableVersion,
  markScenarioBankReviewReady,
  retireScenarioBankVersion,
  SCENARIO_BANK_AUTONOMOUS_APPROVAL_ERROR,
  SCENARIO_BANK_CONTENT_INTEGRITY_ERROR,
  SCENARIO_BANK_INVALID_TRANSITION_ERROR,
  SCENARIO_BANK_MUST_FORK_ERROR,
  SCENARIO_BANK_PARTIAL_APPROVAL_ERROR,
  SCENARIO_BANK_STALE_APPROVAL_ERROR,
  scenarioStatusForLifecycle,
  updateScenarioBankDraft,
  type CompletedHumanReview,
  type ScenarioBankRevision,
} from "./scenario-bank-lifecycle.js";

const NOW = "2026-09-04T12:00:00.000Z";
const CONTENT = { scenarioId: "ed_chest_pain_priority_v1", title: "Chest pain", version: 1 };

function completeReview(identity: string, roles: readonly string[] = ["clinical", "psychometric", "legal", "simulationQa"]): CompletedHumanReview {
  return {
    authoredContentIdentity: identity,
    reviewedAt: NOW,
    reviewerId: "faculty_001",
    requiredGateRoles: roles,
    approvedGateRoles: roles,
    autonomousApproval: false,
    scoringClaimed: false,
  };
}

describe("scenario-bank lifecycle", () => {
  it("walks draft → review-ready → approved-version → retired-version with append-only provenance", () => {
    const draft = createScenarioBankDraft({
      scenarioId: "ed_chest_pain_priority_v1",
      authoredContent: CONTENT,
      actorId: "author_001",
      now: NOW,
    });
    expect(draft.lifecycle).toBe("draft");
    expect(scenarioStatusForLifecycle(draft.lifecycle)).toBe("draft");

    const reviewReady = markScenarioBankReviewReady(draft, { actorId: "author_001", now: NOW });
    expect(reviewReady.lifecycle).toBe("review_ready");
    expect(scenarioStatusForLifecycle(reviewReady.lifecycle)).toBe("draft");

    const approved = approveScenarioBankVersion(reviewReady, completeReview(reviewReady.authoredContentIdentity), {
      actorId: "faculty_001",
      now: NOW,
    });
    expect(approved.lifecycle).toBe("approved_version");
    expect(scenarioStatusForLifecycle(approved.lifecycle)).toBe("approved");
    expect(approved.notEvidenceFor).toEqual([
      "clinical_validity",
      "exam_equivalence",
      "autonomous_clinical_approval",
      "scoring",
    ]);

    const retired = retireScenarioBankVersion(approved, { actorId: "faculty_001", now: NOW });
    expect(retired.lifecycle).toBe("retired_version");
    expect(scenarioStatusForLifecycle(retired.lifecycle)).toBe("retired");

    expect(retired.provenance.map((event) => event.kind)).toEqual([
      "create_draft",
      "mark_review_ready",
      "approve_version",
      "retire_version",
    ]);
    expect(() => {
      (retired.provenance as ScenarioBankProvenanceEventMutable).push({
        at: NOW,
        from: "retired_version",
        to: "draft",
        kind: "create_draft",
        authoredContentIdentity: retired.authoredContentIdentity,
        actorId: "attacker",
      });
    }).toThrow();
    expect(approved.provenance).toHaveLength(3);
  });

  it("refuses skipped review-ready, stale identity, partial gates, and autonomous approval", () => {
    const draft = createScenarioBankDraft({
      scenarioId: "ed_chest_pain_priority_v1",
      authoredContent: CONTENT,
      actorId: "author_001",
      now: NOW,
    });
    expect(() =>
      approveScenarioBankVersion(draft, completeReview(draft.authoredContentIdentity), { actorId: "faculty_001", now: NOW }),
    ).toThrow(SCENARIO_BANK_INVALID_TRANSITION_ERROR);

    const reviewReady = markScenarioBankReviewReady(draft, { actorId: "author_001", now: NOW });
    expect(() =>
      approveScenarioBankVersion(reviewReady, completeReview("stale-identity"), { actorId: "faculty_001", now: NOW }),
    ).toThrow(SCENARIO_BANK_STALE_APPROVAL_ERROR);

    expect(() =>
      approveScenarioBankVersion(
        reviewReady,
        {
          ...completeReview(reviewReady.authoredContentIdentity),
          approvedGateRoles: ["clinical"],
        },
        { actorId: "faculty_001", now: NOW },
      ),
    ).toThrow(SCENARIO_BANK_PARTIAL_APPROVAL_ERROR);

    const forged = {
      ...completeReview(reviewReady.authoredContentIdentity),
      autonomousApproval: true,
      scoringClaimed: true,
    } as unknown as CompletedHumanReview;
    expect(() => approveScenarioBankVersion(reviewReady, forged, { actorId: "faculty_001", now: NOW })).toThrow(
      SCENARIO_BANK_AUTONOMOUS_APPROVAL_ERROR,
    );
  });

  it("keeps approved versions immutable, forks edits into new drafts, and hides non-approved from assembly", () => {
    const draft = createScenarioBankDraft({
      scenarioId: "ed_chest_pain_priority_v1",
      authoredContent: CONTENT,
      actorId: "author_001",
      now: NOW,
    });
    const reviewReady = markScenarioBankReviewReady(draft, { actorId: "author_001", now: NOW });
    const approved = approveScenarioBankVersion(reviewReady, completeReview(reviewReady.authoredContentIdentity), {
      actorId: "faculty_001",
      now: NOW,
    });

    expect(() =>
      updateScenarioBankDraft(approved, { ...CONTENT, title: "Edited after approval" }, { actorId: "author_001", now: NOW }),
    ).toThrow(SCENARIO_BANK_MUST_FORK_ERROR);

    const forked = forkDraftFromImmutableVersion(
      approved,
      { ...CONTENT, title: "Edited after approval", version: 2 },
      { actorId: "author_001", now: NOW },
    );
    expect(forked.lifecycle).toBe("draft");
    expect(forked.version).toBe(approved.version + 1);
    expect(forked.parentRevisionId).toBe(approved.revisionId);
    expect(forked.authoredContentIdentity).not.toBe(approved.authoredContentIdentity);
    expect(approved.lifecycle).toBe("approved_version");
    expect(approved.authoredContent).toEqual(CONTENT);

    const retired = retireScenarioBankVersion(approved, { actorId: "faculty_001", now: NOW });
    expect(assemblyVisibleRevisions([draft, reviewReady, approved, forked, retired])).toEqual([approved]);
  });

  it("returns a review-ready revision to draft when authored content is edited", () => {
    const draft = createScenarioBankDraft({
      scenarioId: "ed_chest_pain_priority_v1",
      authoredContent: CONTENT,
      actorId: "author_001",
      now: NOW,
    });
    const reviewReady = markScenarioBankReviewReady(draft, { actorId: "author_001", now: NOW });
    const edited = updateScenarioBankDraft(
      reviewReady,
      { ...CONTENT, title: "Updated chief complaint" },
      { actorId: "author_001", now: NOW },
    );
    expect(edited.lifecycle).toBe("draft");
    expect(edited.authoredContentIdentity).not.toBe(reviewReady.authoredContentIdentity);
    expect(edited.provenance.map((event) => event.kind)).toEqual(["create_draft", "mark_review_ready", "edit_draft"]);
  });

  it("keeps approved authored content as a canonical snapshot isolated from original and nested mutation", () => {
    const original = {
      scenarioId: "ed_chest_pain_priority_v1",
      title: "Chest pain",
      version: 1,
      actor: { name: "Maya", notes: ["baseline"] },
      status: "draft",
      review: { clinical: "draft" },
    };
    const draft = createScenarioBankDraft({
      scenarioId: original.scenarioId,
      authoredContent: original,
      actorId: "author_001",
      now: NOW,
    });
    const identityAtCreate = draft.authoredContentIdentity;
    original.actor.name = "Hacked input";
    original.actor.notes.push("after create");
    original.title = "Mutated title";
    original.status = "approved";

    const reviewReady = markScenarioBankReviewReady(draft, { actorId: "author_001", now: NOW });
    const approved = approveScenarioBankVersion(reviewReady, completeReview(identityAtCreate), {
      actorId: "faculty_001",
      now: NOW,
    });

    expect(approved.authoredContentIdentity).toBe(identityAtCreate);
    expect(authoredContentIdentity(approved.authoredContent)).toBe(identityAtCreate);
    expect(approved.authoredContent).toEqual({
      actor: { name: "Maya", notes: ["baseline"] },
      scenarioId: "ed_chest_pain_priority_v1",
      title: "Chest pain",
      version: 1,
    });
    expect((approved.authoredContent as { status?: string }).status).toBeUndefined();

    const nested = approved.authoredContent as { actor: { name: string; notes: string[] }; title: string };
    expect(() => {
      nested.actor.name = "Hacked nested";
    }).toThrow();
    expect(() => {
      nested.actor.notes.push("after approve");
    }).toThrow();
    expect(() => {
      nested.title = "Hacked nested title";
    }).toThrow();
    expect(nested.actor.name).toBe("Maya");
    expect(nested.actor.notes).toEqual(["baseline"]);
    expect(authoredContentIdentity(approved.authoredContent)).toBe(approved.authoredContentIdentity);
    expect(assemblyVisibleRevisions([approved])).toEqual([approved]);
  });

  it("fail-closes assembly visibility when an approved version's identity is stale or tampered", () => {
    const draft = createScenarioBankDraft({
      scenarioId: "ed_chest_pain_priority_v1",
      authoredContent: CONTENT,
      actorId: "author_001",
      now: NOW,
    });
    const reviewReady = markScenarioBankReviewReady(draft, { actorId: "author_001", now: NOW });
    const approved = approveScenarioBankVersion(reviewReady, completeReview(reviewReady.authoredContentIdentity), {
      actorId: "faculty_001",
      now: NOW,
    });
    const tampered: ScenarioBankRevision<typeof CONTENT> = {
      ...approved,
      authoredContent: { ...CONTENT, title: "Tampered after approval" },
    };
    expect(authoredContentIdentity(tampered.authoredContent)).not.toBe(tampered.authoredContentIdentity);
    expect(() => assemblyVisibleRevisions([draft, tampered])).toThrow(SCENARIO_BANK_CONTENT_INTEGRITY_ERROR);
  });
});

type ScenarioBankProvenanceEventMutable = Array<{
  at: string;
  from: string;
  to: string;
  kind: string;
  authoredContentIdentity: string;
  actorId: string;
}>;
