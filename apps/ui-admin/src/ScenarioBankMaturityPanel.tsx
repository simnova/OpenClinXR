import { Tag, Typography } from "antd";
import type { ReactElement } from "react";
import type { AdminScenario, AdminScenarioBankExamSequenceProjection, AdminScenarioBankMaturityReport } from "./api-client.js";

export type ScenarioBankMaturityPanelProps = {
  scenarios: AdminScenario[];
  maturityReport?: AdminScenarioBankMaturityReport;
  examSequenceProjection?: AdminScenarioBankExamSequenceProjection;
};

export function ScenarioBankMaturityPanel({ scenarios, maturityReport, examSequenceProjection }: ScenarioBankMaturityPanelProps): ReactElement {
  const approvedCount = scenarios.filter((scenario) => scenario.status === "APPROVED").length;
  const readyForReviewCount = scenarios.filter((scenario) => scenario.status === "READY_FOR_REVIEW").length;
  const draftCount = scenarios.filter((scenario) => scenario.status === "DRAFT").length;
  const actorCount = scenarios.reduce((total, scenario) => total + scenario.actors.length, 0);
  const behaviorProfileCount = scenarios.reduce((total, scenario) => total + scenario.actors.filter((actor) => actor.communicationProfile).length, 0);
  const visualLoopProfileCount = maturityReport?.communicationProfileCoverage?.actorCount.withCommunicationProfile ?? behaviorProfileCount;
  const visualLoopActorCount = maturityReport?.communicationProfileCoverage?.actorCount.total ?? actorCount;
  const pendingReviewGateCount = scenarios.reduce((total, scenario) =>
    total + reviewGateStates(scenario).filter((state) => state !== "approved").length, 0);
  const traceTagCount = scenarios.reduce((total, scenario) => total + scenario.requiredTraceTags.length, 0);
  const assetNeedCount = scenarios.reduce((total, scenario) => total + scenario.assetNeeds.length, 0);
  const assetNeedScenarioCount = scenarios.filter((scenario) => scenario.assetNeeds.length > 0).length;
  const reviewBlockerIds = scenarios.flatMap(scenarioReviewBlockerIds);
  const draftReviewStationCount = examSequenceProjection?.stations.filter((station) => station.learnerUseBoundary === "draft_review_required").length ?? 0;
  const dialogueReplayGateCount = examSequenceProjection?.stations.filter((station) => station.learnerUseBoundary === "dialogue_seed_replay_required").length ?? 0;

  return (
    <section className="workbench-panel" aria-label="Scenario bank maturity">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Scenario authoring queue</Typography.Text>
          <Typography.Title level={4}>Scenario Bank Maturity</Typography.Title>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Tag color={pendingReviewGateCount === 0 ? "green" : "gold"}>
          {pendingReviewGateCount === 0 ? "review gates clear" : "review gates pending"}
          </Tag>
          <Tag color="blue">admin/report surface only</Tag>
        </div>
      </div>
      <Typography.Paragraph>
        This admin/report surface summarizes authoring, visual-loop, and asset maturity signals. It does not claim Quest, learner, or production readiness.
      </Typography.Paragraph>
      <div className="readiness-strip scenario-bank-strip">
        <ScenarioBankMaturityMetric label={`${scenarios.length} scenarios in bank`} detail={`${approvedCount} approved for local formative review`} />
        <ScenarioBankMaturityMetric label={`${readyForReviewCount} ready for review`} detail={`${draftCount} drafts awaiting gates`} />
        <ScenarioBankMaturityMetric
          label={`${visualLoopProfileCount} visual-loop review profiles`}
          detail={`${visualLoopActorCount} actors tracked in the scenario bank`}
        />
        <ScenarioBankMaturityMetric
          label={`${assetNeedScenarioCount} scenario${assetNeedScenarioCount === 1 ? "" : "s"} with asset needs`}
          detail={`${assetNeedCount} asset need${assetNeedCount === 1 ? "" : "s"} logged for separate asset review`}
        />
        <ScenarioBankMaturityMetric label={`${pendingReviewGateCount} pending review gates`} detail={`${traceTagCount} trace tags`} />
        <ScenarioBankMaturityMetric label={`${reviewBlockerIds.length} scenario review blocker IDs`} detail={reviewBlockerIds.slice(0, 3).join(", ") || "no review blockers"} />
        {maturityReport ? (
          <>
            <ScenarioBankMaturityMetric label={`${maturityReport.targetScenarioCount} target stations`} detail={`${maturityReport.missingScenarioCount} missing stations`} />
            <ScenarioBankMaturityMetric label={`${maturityReport.activationEligibleScenarioIds.length} activation eligible`} detail={`${maturityReport.blockedScenarioIds.length} blocked by gates`} />
            {maturityReport.statusCounts ? (
              <ScenarioBankMaturityMetric label={summarizeStatusCounts(maturityReport.statusCounts)} detail="scenario status mix from the admin maturity report" />
            ) : null}
            {maturityReport.validationStageCounts ? (
              <ScenarioBankMaturityMetric
                label={summarizeValidationStageCounts(maturityReport.validationStageCounts)}
                detail="validation stage mix from the admin maturity report"
              />
            ) : null}
            {maturityReport.scenarioMaturityBreakdown ? (
              <ScenarioBankMaturityMetric
                label={`${maturityReport.scenarioMaturityBreakdown.length} scenario maturity breakdowns`}
                detail={summarizeFirstScenarioBreakdown(maturityReport.scenarioMaturityBreakdown)}
              />
            ) : null}
            <ScenarioBankMaturityMetric label={`${maturityReport.clinicalSettings.length} clinical settings`} detail={`${maturityReport.fixtureCompleteness.missingRequiredActorRoles.length} missing actor roles`} />
            {maturityReport.actorRoleCoverage ? (
              <ScenarioBankMaturityMetric
                label={`${maturityReport.actorRoleCoverage.length} actor roles covered`}
                detail={maturityReport.actorRoleCoverage.slice(0, 4).join(", ") || "no actor roles listed"}
              />
            ) : null}
            {maturityReport.communicationProfileCoverage ? (
              <ScenarioBankMaturityMetric
                label={`${maturityReport.communicationProfileCoverage.actorCount.withCommunicationProfile} actors with communication profiles`}
                detail={`${maturityReport.communicationProfileCoverage.actorCount.total} actors tracked in the admin report`}
              />
            ) : null}
            {maturityReport.traceabilityCoverage ? (
              <ScenarioBankMaturityMetric
                label={`${maturityReport.traceabilityCoverage.completeScenarioIds.length} traceability-complete scenarios`}
                detail={`${maturityReport.traceabilityCoverage.incompleteScenarioIds.length} traceability gaps remain`}
              />
            ) : null}
            {maturityReport.hiddenFactPolicy ? (
              <ScenarioBankMaturityMetric
                label={maturityReport.hiddenFactPolicy.redactsAll ? "hidden facts redacted" : "hidden facts exposed"}
                detail={maturityReport.hiddenFactPolicy.requiresTriggerForAll ? "disclosure still requires trigger gates" : "disclosure policy is not uniform"}
              />
            ) : null}
            {maturityReport.pressureActorCoverage ? (
              <ScenarioBankMaturityMetric
                label={`${maturityReport.pressureActorCoverage.scenarioCountWithNonPatientActors} multi-actor pressure scenarios`}
                detail={`${maturityReport.pressureActorCoverage.incompleteScenarioIds.length} missing pressure actors`}
              />
            ) : null}
            <ScenarioBankMaturityMetric label={`${maturityReport.dialogueSeedCoverage.seededScenarioIds.length} seeded dialogue scenarios`} detail={`${maturityReport.dialogueSeedCoverage.guardrailProbeScenarioIds.length} guardrail-probed scenarios`} />
            {maturityReport.sharedAssetReuseMaturity ? (
              <>
                <ScenarioBankMaturityMetric
                  label={`${maturityReport.sharedAssetReuseMaturity.reusableLookupKeyCount} reusable shared-asset lookup keys`}
                  detail={`${maturityReport.sharedAssetReuseMaturity.duplicateLookupKeyCount} duplicate lookups; ${maturityReport.sharedAssetReuseMaturity.scenarioCountWithReusableKeys} LRU candidate scenarios`}
                />
                <ScenarioBankMaturityMetric
                  label={`${maturityReport.sharedAssetReuseMaturity.lookupKeyCount} shared-asset lookup keys`}
                  detail={`${maturityReport.sharedAssetReuseMaturity.claimBoundary}; not evidence for ${maturityReport.sharedAssetReuseMaturity.notEvidenceFor.join(", ")}`}
                />
                <ScenarioBankMaturityMetric
                  label="top shared-asset reuse candidate"
                  detail={summarizeTopSharedAssetReuseKey(maturityReport.sharedAssetReuseMaturity.topReusableLookupKeys)}
                />
              </>
            ) : null}
          </>
        ) : null}
        {examSequenceProjection ? (
          <>
            <ScenarioBankMaturityMetric label={`${examSequenceProjection.stationCount} ordered stations`} detail={`${examSequenceProjection.activationEligibleCount} activation-ready station`} />
            <ScenarioBankMaturityMetric label={`${draftReviewStationCount} draft-review stations`} detail={`${dialogueReplayGateCount} dialogue-replay gates`} />
          </>
        ) : null}
      </div>
    </section>
  );
}

function summarizeTopSharedAssetReuseKey(
  topReusableLookupKeys: NonNullable<AdminScenarioBankMaturityReport["sharedAssetReuseMaturity"]>["topReusableLookupKeys"],
): string {
  const topKey = topReusableLookupKeys[0];
  return topKey ? `${topKey.lookupKey} across ${topKey.scenarioCount} scenarios` : "no reusable shared-asset keys";
}

function summarizeFirstScenarioBreakdown(
  breakdowns: NonNullable<AdminScenarioBankMaturityReport["scenarioMaturityBreakdown"]>,
): string {
  const firstBlocked = breakdowns.find((breakdown) => !breakdown.activationEligible) ?? breakdowns[0];
  if (!firstBlocked) {
    return "no scenario maturity blockers";
  }
  const blockerSummary = firstBlocked.blockerIds.slice(0, 2).join(", ") || "no blockers";
  return `${firstBlocked.scenarioId}: ${blockerSummary}; next ${firstBlocked.recommendedNextAction}; dialogue ${firstBlocked.dialogueSeedReady ? "ready" : "blocked"}; traceability ${firstBlocked.traceabilityReady ? "ready" : "blocked"}`;
}

function summarizeStatusCounts(statusCounts: NonNullable<AdminScenarioBankMaturityReport["statusCounts"]>): string {
  return `${statusCounts.approved} approved, ${statusCounts.draft} drafts, ${statusCounts.retired} retired`;
}

function summarizeValidationStageCounts(
  validationStageCounts: NonNullable<AdminScenarioBankMaturityReport["validationStageCounts"]>,
): string {
  return `${validationStageCounts.stage_0_synthetic_draft} synthetic drafts, ${validationStageCounts.stage_1_expert_reviewed} expert-reviewed, ${validationStageCounts.stage_2_pilot_ready} pilot-ready, ${validationStageCounts.stage_3_validated} validated`;
}

function ScenarioBankMaturityMetric({ label, detail }: { label: string; detail: string }): ReactElement {
  return (
    <div className="readiness-metric">
      <Typography.Text strong>{label}</Typography.Text>
      <Typography.Text type="secondary">{detail}</Typography.Text>
    </div>
  );
}

function reviewGateStates(scenario: AdminScenario): string[] {
  return [
    scenario.review.clinical,
    scenario.review.psychometric,
    scenario.review.legal,
    scenario.review.simulationQa,
  ];
}

function scenarioReviewBlockerIds(scenario: AdminScenario): string[] {
  const blockers = [
    scenario.status === "APPROVED" ? undefined : `scenario_status:${scenario.status}`,
    scenario.review.clinical === "approved" ? undefined : `clinical_review:${scenario.review.clinical}`,
    scenario.review.psychometric === "approved" ? undefined : `psychometric_review:${scenario.review.psychometric}`,
    scenario.review.legal === "approved" ? undefined : `legal_review:${scenario.review.legal}`,
    scenario.review.simulationQa === "approved" ? undefined : `simulation_qa_review:${scenario.review.simulationQa}`,
    scenario.governance.validationStage === "stage_1_expert_reviewed" ? undefined : `validation_stage:${scenario.governance.validationStage}`,
  ];

  return blockers.filter((blocker): blocker is string => typeof blocker === "string");
}
