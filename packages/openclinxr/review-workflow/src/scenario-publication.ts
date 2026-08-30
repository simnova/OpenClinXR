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

/**
 * What a verifier is handed for one candidate approval. Enough to BIND the approval to its subject:
 * an approval that verifies for one scenario must not verify for another, or for a later version of
 * the same one. `assertedRole` is what the evidence row CLAIMS — it is input to the verifier, never
 * an output trusted on its own.
 */
export type ReviewerAttestationRequest = {
  scenarioId: string;
  scenarioVersion: Scenario["version"];
  reviewerId: string;
  assertedRole: string;
  decision: ReviewerEvidence["decision"];
  evidenceId: string;
};

/**
 * What a verifier returns. Roles come from HERE — the trusted principal — never from the evidence
 * row's own `reviewerRole` field, which is a string its author typed.
 */
export type ReviewerVerifiedPrincipal =
  | { verified: true; principalId: string; roles: readonly string[] }
  | { verified: false; reason: string };

/**
 * A trusted attestation port. Production identity providers, signature formats, and token lifetimes
 * are NOT this package's concern — this is the seam a real verifier plugs into. When no verifier is
 * supplied, no approval can be trusted, so no required role is ever satisfied: the gate fails closed
 * rather than falling back to the row's own self-declared `reviewerRole`.
 */
export type ReviewerAttestationVerifier = (request: ReviewerAttestationRequest) => ReviewerVerifiedPrincipal;

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
  blockerVisibility: {
    claimBoundary: "publication_blocker_visibility_not_readiness_claim";
    humanReviewRequired: boolean;
    blockerIds: string[];
    warningIds: string[];
    recommendedNextAction:
      | "collect_required_reviewer_evidence"
      | "complete_scenario_review_gates"
      | "advance_governance_validation_stage"
      | "repair_hidden_fact_policy"
      | "repair_asset_readiness"
      | "review_asset_warnings_before_local_formative_use"
      | "ready_for_operator_publication_review";
  };
};

export type EvaluateScenarioPublicationReadinessInput = {
  scenario: Scenario;
  targetUse: PublicationTargetUse;
  reviewerEvidence: readonly ReviewerEvidence[];
  assetReadiness: PublicationAssetReadiness;
  /**
   * Trusted verifier the gate consults to bind an evidence row's claimed `reviewerRole` to a
   * verified principal. Optional at the type level because a real caller wires a real identity
   * provider here — but its ABSENCE is not a bypass: see `missingApprovedReviewerRoles`, which
   * credits no role at all when no verifier is supplied.
   */
  attestationVerifier?: ReviewerAttestationVerifier;
};

export function evaluateScenarioPublicationReadiness(input: EvaluateScenarioPublicationReadinessInput): ScenarioPublicationReadiness {
  const gateResults: PublicationGateResult[] = [];
  const requiredReviewerRoles = [...new Set(input.scenario.governance.requiredReviewerRoles)];
  const missingReviewerRoles = missingApprovedReviewerRoles(
    requiredReviewerRoles,
    input.reviewerEvidence,
    input.scenario,
    input.attestationVerifier,
  );

  gateResults.push(scenarioStatusGate(input.scenario));
  gateResults.push(reviewStateGate(input.scenario));
  gateResults.push(validationStageGate(input.scenario, input.targetUse));
  gateResults.push(scoreUseGate(input.scenario, input.targetUse));
  gateResults.push(reviewerEvidenceGate(missingReviewerRoles));
  gateResults.push(hiddenFactPolicyGate(input.scenario));
  gateResults.push(assetReadinessGate(input.assetReadiness, input.scenario.scenarioId, input.targetUse));

  return {
    scenarioId: input.scenario.scenarioId,
    targetUse: input.targetUse,
    releaseLabel: input.scenario.governance.scoreUseLabel,
    canPublishForLearnerUse: gateResults.every((gate) => gate.status !== "block"),
    requiredReviewerRoles,
    missingReviewerRoles,
    gateResults,
    blockerVisibility: buildPublicationBlockerVisibility(gateResults),
  };
}

function buildPublicationBlockerVisibility(
  gateResults: readonly PublicationGateResult[],
): ScenarioPublicationReadiness["blockerVisibility"] {
  const blockingGateIds = gateResults.filter((gate) => gate.status === "block").map((gate) => gate.gate);
  const warningGateIds = gateResults.filter((gate) => gate.status === "warn").map((gate) => gate.gate);

  return {
    claimBoundary: "publication_blocker_visibility_not_readiness_claim",
    humanReviewRequired: blockingGateIds.length > 0 || warningGateIds.length > 0,
    blockerIds: blockingGateIds.map((gate) => `publication_gate_blocked:${gate}`),
    warningIds: warningGateIds.map((gate) => `publication_gate_warning:${gate}`),
    recommendedNextAction: publicationRecommendedNextAction(blockingGateIds, warningGateIds),
  };
}

function publicationRecommendedNextAction(
  blockingGateIds: readonly PublicationGate[],
  warningGateIds: readonly PublicationGate[],
): ScenarioPublicationReadiness["blockerVisibility"]["recommendedNextAction"] {
  if (blockingGateIds.includes("reviewer_evidence")) return "collect_required_reviewer_evidence";
  if (blockingGateIds.includes("scenario_status") || blockingGateIds.includes("review_state")) return "complete_scenario_review_gates";
  if (blockingGateIds.includes("validation_stage") || blockingGateIds.includes("score_use")) return "advance_governance_validation_stage";
  if (blockingGateIds.includes("hidden_fact_policy")) return "repair_hidden_fact_policy";
  if (blockingGateIds.includes("asset_readiness")) return "repair_asset_readiness";
  if (warningGateIds.includes("asset_readiness")) return "review_asset_warnings_before_local_formative_use";
  return "ready_for_operator_publication_review";
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

function assetReadinessGate(
  assetReadiness: PublicationAssetReadiness,
  scenarioId: string,
  targetUse: PublicationTargetUse,
): PublicationGateResult {
  if (assetReadiness.scenarioId !== scenarioId) {
    return block("asset_readiness", `Asset readiness scenario ID must match scenario ${scenarioId}.`);
  }

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

/**
 * A required role is satisfied only by a shape-valid, VERIFIED approval whose verified principal
 * actually holds the role the row claims. `evidence.reviewerRole` alone never credits anything —
 * it is what the row's own author typed, and it is only ever used as the `assertedRole` handed TO
 * the verifier, never trusted as the role itself.
 *
 * No `attestationVerifier` means no approval can be verified, so `approvedRoles` stays empty and
 * every required role is reported missing. This is the fail-closed default clause (1) requires.
 */
function missingApprovedReviewerRoles(
  requiredReviewerRoles: readonly string[],
  reviewerEvidence: readonly ReviewerEvidence[],
  scenario: Scenario,
  attestationVerifier: ReviewerAttestationVerifier | undefined,
): string[] {
  const shapeValidApprovals = reviewerEvidence
    .filter((evidence) => evidence.decision === "approved")
    .filter((evidence) => evidence.reviewerId.trim().length > 0)
    .filter((evidence) => evidence.comments.trim().length > 0)
    .filter((evidence) => evidence.evidenceRefs.length > 0 && evidence.evidenceRefs.every((ref) => ref.trim().length > 0))
    .filter((evidence) => !Number.isNaN(Date.parse(evidence.reviewedAt)));

  const approvedRoles = new Set<string>();

  if (attestationVerifier) {
    for (const evidence of shapeValidApprovals) {
      const request: ReviewerAttestationRequest = {
        scenarioId: scenario.scenarioId,
        scenarioVersion: scenario.version,
        reviewerId: evidence.reviewerId,
        assertedRole: evidence.reviewerRole,
        decision: evidence.decision,
        evidenceId: evidence.evidenceRefs.join("|"),
      };
      const principal = attestationVerifier(request);
      // The role is credited only when the VERIFIED principal's own role list contains the role
      // being claimed — never merely because the verifier said `verified: true` to something.
      if (principal.verified && principal.roles.includes(evidence.reviewerRole)) {
        approvedRoles.add(evidence.reviewerRole);
      }
    }
  }

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
