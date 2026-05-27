import { edChestPainScenario, pediatricAsthmaScenario } from "@openclinxr/scenario-fixtures";
import { describe, expect, it } from "vitest";
import { evaluateScenarioPublicationReadiness, type ReviewerEvidence } from "./index.js";

const completeReviewerEvidence: ReviewerEvidence[] = [
  reviewer("clinician", "clinical-cmo-001"),
  reviewer("psychometrician", "psychometrician-001"),
  reviewer("legal", "legal-001"),
  reviewer("simulation_qa", "simulation-qa-001"),
];

const devReadyAssets = {
  scenarioId: edChestPainScenario.scenarioId,
  devReady: true,
  productionReady: false,
  missingRequiredAssetIds: [],
  blockedAssets: [],
  productionBlockedAssets: [{ assetId: "patient_robert_hayes_character", blockers: ["placeholder_asset_not_clinical_release_ready"] }],
};

describe("scenario publication readiness", () => {
  it("allows local formative learner use when governance, reviewers, and dev assets are ready", () => {
    const readiness = evaluateScenarioPublicationReadiness({
      scenario: edChestPainScenario,
      targetUse: "local_formative",
      reviewerEvidence: completeReviewerEvidence,
      assetReadiness: devReadyAssets,
    });

    expect(readiness.canPublishForLearnerUse).toBe(true);
    expect(readiness.releaseLabel).toBe("formative_local_only");
    expect(readiness.missingReviewerRoles).toEqual([]);
    expect(readiness.blockerVisibility).toEqual({
      claimBoundary: "publication_blocker_visibility_not_readiness_claim",
      humanReviewRequired: true,
      blockerIds: [],
      warningIds: ["publication_gate_warning:asset_readiness"],
      recommendedNextAction: "review_asset_warnings_before_local_formative_use",
    });
    expect(readiness.gateResults.filter((gate) => gate.status === "block")).toEqual([]);
    expect(readiness.gateResults).toContainEqual({
      gate: "asset_readiness",
      status: "warn",
      details: ["Production assets are not ready; local formative release may use dev-ready placeholders."],
    });
  });

  it("blocks publication when required reviewer evidence is missing", () => {
    const readiness = evaluateScenarioPublicationReadiness({
      scenario: edChestPainScenario,
      targetUse: "local_formative",
      reviewerEvidence: completeReviewerEvidence.filter((evidence) => evidence.reviewerRole !== "legal"),
      assetReadiness: devReadyAssets,
    });

    expect(readiness.canPublishForLearnerUse).toBe(false);
    expect(readiness.missingReviewerRoles).toEqual(["legal"]);
    expect(readiness.blockerVisibility).toMatchObject({
      claimBoundary: "publication_blocker_visibility_not_readiness_claim",
      humanReviewRequired: true,
      blockerIds: ["publication_gate_blocked:reviewer_evidence"],
      recommendedNextAction: "collect_required_reviewer_evidence",
    });
    expect(readiness.gateResults).toContainEqual({
      gate: "reviewer_evidence",
      status: "block",
      details: ["Missing approved reviewer evidence for: legal"],
    });
  });

  it("deduplicates repeated required reviewer roles before reporting missing evidence", () => {
    const readiness = evaluateScenarioPublicationReadiness({
      scenario: {
        ...edChestPainScenario,
        governance: {
          ...edChestPainScenario.governance,
          requiredReviewerRoles: [...edChestPainScenario.governance.requiredReviewerRoles, "legal"],
        },
      },
      targetUse: "local_formative",
      reviewerEvidence: completeReviewerEvidence.filter((evidence) => evidence.reviewerRole !== "legal"),
      assetReadiness: devReadyAssets,
    });

    expect(readiness.missingReviewerRoles).toEqual(["legal"]);
    expect(readiness.gateResults).toContainEqual({
      gate: "reviewer_evidence",
      status: "block",
      details: ["Missing approved reviewer evidence for: legal"],
    });
  });

  it("does not accept blank reviewer evidence references", () => {
    const readiness = evaluateScenarioPublicationReadiness({
      scenario: edChestPainScenario,
      targetUse: "local_formative",
      reviewerEvidence: completeReviewerEvidence.map((evidence) =>
        evidence.reviewerRole === "legal" ? { ...evidence, evidenceRefs: ["   "] } : evidence
      ),
      assetReadiness: devReadyAssets,
    });

    expect(readiness.canPublishForLearnerUse).toBe(false);
    expect(readiness.missingReviewerRoles).toEqual(["legal"]);
  });

  it("blocks publication when a required reviewer requests changes", () => {
    const readiness = evaluateScenarioPublicationReadiness({
      scenario: edChestPainScenario,
      targetUse: "local_formative",
      reviewerEvidence: completeReviewerEvidence.map((evidence) =>
        evidence.reviewerRole === "legal"
          ? {
            ...evidence,
            decision: "changes_requested",
            comments: "Legal review requested changes before learner publication.",
          }
          : evidence
      ),
      assetReadiness: devReadyAssets,
    });

    expect(readiness.canPublishForLearnerUse).toBe(false);
    expect(readiness.missingReviewerRoles).toEqual(["legal"]);
    expect(readiness.blockerVisibility).toMatchObject({
      blockerIds: ["publication_gate_blocked:reviewer_evidence"],
      recommendedNextAction: "collect_required_reviewer_evidence",
    });
    expect(readiness.gateResults).toContainEqual({
      gate: "reviewer_evidence",
      status: "block",
      details: ["Missing approved reviewer evidence for: legal"],
    });
  });

  it("blocks publication when asset readiness belongs to a different scenario", () => {
    const readiness = evaluateScenarioPublicationReadiness({
      scenario: edChestPainScenario,
      targetUse: "local_formative",
      reviewerEvidence: completeReviewerEvidence,
      assetReadiness: { ...devReadyAssets, scenarioId: "different_scenario_v1" },
    });

    expect(readiness.canPublishForLearnerUse).toBe(false);
    expect(readiness.blockerVisibility).toMatchObject({
      blockerIds: ["publication_gate_blocked:asset_readiness"],
      recommendedNextAction: "repair_asset_readiness",
    });
    expect(readiness.gateResults).toContainEqual({
      gate: "asset_readiness",
      status: "block",
      details: ["Asset readiness scenario ID must match scenario ed_chest_pain_priority_v1."],
    });
  });

  it("blocks stage 0 synthetic drafts even if reviewer evidence is supplied", () => {
    const readiness = evaluateScenarioPublicationReadiness({
      scenario: pediatricAsthmaScenario,
      targetUse: "local_formative",
      reviewerEvidence: [
        reviewer("pediatrician", "peds-001"),
        reviewer("psychometrician", "psychometrician-001"),
        reviewer("legal", "legal-001"),
        reviewer("simulation_qa", "simulation-qa-001"),
      ],
      assetReadiness: { ...devReadyAssets, scenarioId: pediatricAsthmaScenario.scenarioId },
    });

    expect(readiness.canPublishForLearnerUse).toBe(false);
    expect(readiness.blockerVisibility).toMatchObject({
      blockerIds: expect.arrayContaining([
        "publication_gate_blocked:scenario_status",
        "publication_gate_blocked:review_state",
        "publication_gate_blocked:validation_stage",
      ]),
      recommendedNextAction: "complete_scenario_review_gates",
    });
    expect(readiness.gateResults).toContainEqual({
      gate: "scenario_status",
      status: "block",
      details: ["Scenario status must be approved before learner publication."],
    });
    expect(readiness.gateResults).toContainEqual({
      gate: "validation_stage",
      status: "block",
      details: ["Local formative release requires at least stage_1_expert_reviewed governance."],
    });
  });

  it("blocks target-use overclaim beyond scenario score-use label", () => {
    const readiness = evaluateScenarioPublicationReadiness({
      scenario: edChestPainScenario,
      targetUse: "pilot_research",
      reviewerEvidence: completeReviewerEvidence,
      assetReadiness: devReadyAssets,
    });

    expect(readiness.canPublishForLearnerUse).toBe(false);
    expect(readiness.gateResults).toContainEqual({
      gate: "score_use",
      status: "block",
      details: ["pilot_research target use requires pilot_research_only or validated_summative score-use governance."],
    });
  });
});

function reviewer(reviewerRole: string, reviewerId: string): ReviewerEvidence {
  return {
    reviewerRole,
    reviewerId,
    decision: "approved",
    comments: `Approved by ${reviewerRole}.`,
    evidenceRefs: [`evidence:${reviewerRole}:2026-05-03`],
    reviewedAt: "2026-05-03T17:00:00.000Z",
  };
}
