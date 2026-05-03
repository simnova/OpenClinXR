import type { Scenario } from "@openclinxr/shared-schemas";

export type PublicationTargetUse = "local_formative" | "pilot_research" | "summative";

export type ReviewerEvidence = {
  reviewerRole: string;
  reviewerId: string;
  decision: "approved" | "changes_requested";
  comments: string;
  evidenceRefs: string[];
  reviewedAt: string;
};

export type PublicationAssetReadiness = {
  scenarioId: string;
  devReady: boolean;
  productionReady: boolean;
  missingRequiredAssetIds: string[];
  blockedAssets: Array<{ assetId: string; blockers: string[] }>;
  productionBlockedAssets: Array<{ assetId: string; blockers: string[] }>;
};

export type PublicationGate = "scenario_status" | "review_state" | "validation_stage" | "score_use" | "reviewer_evidence" | "hidden_fact_policy" | "asset_readiness";

export type PublicationGateResult = {
  gate: PublicationGate;
  status: "pass" | "warn" | "block";
  details: string[];
};

export type ScenarioPublicationReadiness = {
  scenarioId: string;
  targetUse: PublicationTargetUse;
  releaseLabel: Scenario["governance"]["scoreUseLabel"];
  canPublishForLearnerUse: boolean;
  requiredReviewerRoles: string[];
  missingReviewerRoles: string[];
  gateResults: PublicationGateResult[];
};

export type EvaluateScenarioPublicationReadinessInput = {
  scenario: Scenario;
  targetUse: PublicationTargetUse;
  reviewerEvidence: readonly ReviewerEvidence[];
  assetReadiness: PublicationAssetReadiness;
};

export function evaluateScenarioPublicationReadiness(input: EvaluateScenarioPublicationReadinessInput): ScenarioPublicationReadiness {
  const gateResults: PublicationGateResult[] = [];
  const requiredReviewerRoles = [...input.scenario.governance.requiredReviewerRoles];
  const missingReviewerRoles = missingApprovedReviewerRoles(requiredReviewerRoles, input.reviewerEvidence);

  gateResults.push(scenarioStatusGate(input.scenario));
  gateResults.push(reviewStateGate(input.scenario));
  gateResults.push(validationStageGate(input.scenario, input.targetUse));
  gateResults.push(scoreUseGate(input.scenario, input.targetUse));
  gateResults.push(reviewerEvidenceGate(missingReviewerRoles));
  gateResults.push(hiddenFactPolicyGate(input.scenario));
  gateResults.push(assetReadinessGate(input.assetReadiness, input.targetUse));

  return {
    scenarioId: input.scenario.scenarioId,
    targetUse: input.targetUse,
    releaseLabel: input.scenario.governance.scoreUseLabel,
    canPublishForLearnerUse: gateResults.every((gate) => gate.status !== "block"),
    requiredReviewerRoles,
    missingReviewerRoles,
    gateResults,
  };
}

function scenarioStatusGate(scenario: Scenario): PublicationGateResult {
  if (scenario.status === "approved") {
    return pass("scenario_status", "Scenario status is approved.");
  }
  return block("scenario_status", "Scenario status must be approved before learner publication.");
}

function reviewStateGate(scenario: Scenario): PublicationGateResult {
  const unapproved = Object.entries(scenario.review).filter(([, state]) => state !== "approved").map(([gate]) => gate);
  if (unapproved.length === 0) {
    return pass("review_state", "Clinical, psychometric, legal, and simulation QA gates are approved.");
  }
  return block("review_state", `Scenario review gates must be approved before publication: ${unapproved.join(", ")}`);
}

function validationStageGate(scenario: Scenario, targetUse: PublicationTargetUse): PublicationGateResult {
  if (targetUse === "local_formative") {
    if (scenario.governance.validationStage === "stage_0_synthetic_draft") {
      return block("validation_stage", "Local formative release requires at least stage_1_expert_reviewed governance.");
    }
    return pass("validation_stage", "Validation stage supports local formative release.");
  }

  if (targetUse === "pilot_research") {
    if (["stage_2_pilot_ready", "stage_3_validated"].includes(scenario.governance.validationStage)) {
      return pass("validation_stage", "Validation stage supports pilot research release.");
    }
    return block("validation_stage", "Pilot research release requires stage_2_pilot_ready or stage_3_validated governance.");
  }

  if (scenario.governance.validationStage === "stage_3_validated") {
    return pass("validation_stage", "Validation stage supports summative release.");
  }
  return block("validation_stage", "Summative release requires stage_3_validated governance.");
}

function scoreUseGate(scenario: Scenario, targetUse: PublicationTargetUse): PublicationGateResult {
  if (targetUse === "local_formative") {
    return pass("score_use", "Target use does not exceed local formative governance.");
  }

  if (targetUse === "pilot_research") {
    if (["pilot_research_only", "validated_summative"].includes(scenario.governance.scoreUseLabel)) {
      return pass("score_use", "Target use is covered by pilot or summative governance.");
    }
    return block("score_use", "pilot_research target use requires pilot_research_only or validated_summative score-use governance.");
  }

  if (scenario.governance.scoreUseLabel === "validated_summative") {
    return pass("score_use", "Target use is covered by validated summative governance.");
  }
  return block("score_use", "summative target use requires validated_summative score-use governance.");
}

function reviewerEvidenceGate(missingReviewerRoles: readonly string[]): PublicationGateResult {
  if (missingReviewerRoles.length === 0) {
    return pass("reviewer_evidence", "Approved reviewer evidence is present for all required roles.");
  }
  return block("reviewer_evidence", `Missing approved reviewer evidence for: ${missingReviewerRoles.join(", ")}`);
}

function hiddenFactPolicyGate(scenario: Scenario): PublicationGateResult {
  if (scenario.governance.hiddenFactPolicy.learnerView === "redact_hidden_facts" && scenario.governance.hiddenFactPolicy.disclosureRequiresTrigger) {
    return pass("hidden_fact_policy", "Hidden facts are redacted from learner view and require explicit triggers.");
  }
  return block("hidden_fact_policy", "Hidden facts must be redacted from learner view and require explicit disclosure triggers.");
}

function assetReadinessGate(assetReadiness: PublicationAssetReadiness, targetUse: PublicationTargetUse): PublicationGateResult {
  if (!assetReadiness.devReady) {
    const blockers = [
      ...assetReadiness.missingRequiredAssetIds.map((assetId) => `missing:${assetId}`),
      ...assetReadiness.blockedAssets.map((asset) => `${asset.assetId}:${asset.blockers.join(",")}`),
    ];
    return block("asset_readiness", `Development asset readiness must pass before learner publication: ${blockers.join("; ")}`);
  }

  if (!assetReadiness.productionReady) {
    if (targetUse === "local_formative") {
      return warn("asset_readiness", "Production assets are not ready; local formative release may use dev-ready placeholders.");
    }
    return block("asset_readiness", `${targetUse} release requires production-ready assets.`);
  }

  return pass("asset_readiness", "Required scenario assets are production ready.");
}

function missingApprovedReviewerRoles(requiredReviewerRoles: readonly string[], reviewerEvidence: readonly ReviewerEvidence[]): string[] {
  const approvedRoles = new Set(
    reviewerEvidence
      .filter((evidence) => evidence.decision === "approved")
      .filter((evidence) => evidence.reviewerId.trim().length > 0)
      .filter((evidence) => evidence.comments.trim().length > 0)
      .filter((evidence) => evidence.evidenceRefs.length > 0)
      .filter((evidence) => !Number.isNaN(Date.parse(evidence.reviewedAt)))
      .map((evidence) => evidence.reviewerRole),
  );

  return requiredReviewerRoles.filter((role) => !approvedRoles.has(role));
}

function pass(gate: PublicationGate, detail: string): PublicationGateResult {
  return { gate, status: "pass", details: [detail] };
}

function warn(gate: PublicationGate, detail: string): PublicationGateResult {
  return { gate, status: "warn", details: [detail] };
}

function block(gate: PublicationGate, detail: string): PublicationGateResult {
  return { gate, status: "block", details: [detail] };
}
