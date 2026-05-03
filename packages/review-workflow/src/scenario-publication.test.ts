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
    expect(readiness.gateResults).toContainEqual({
      gate: "reviewer_evidence",
      status: "block",
      details: ["Missing approved reviewer evidence for: legal"],
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
