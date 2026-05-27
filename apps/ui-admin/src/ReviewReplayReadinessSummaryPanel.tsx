import { Tag, Typography } from "antd";
import type { ReactElement } from "react";
import type {
  AdminCaseDefinedHumanoidPerformanceContract,
  AdminCaseDefinedHumanoidRuntimeHandoff,
  AdminReviewPacketReplay,
} from "./api-client.js";

type ReviewReplayReadinessSummary = AdminReviewPacketReplay["reviewReplayReadinessSummary"];

export type ReviewReplayReadinessSummaryPanelProps = {
  summary: ReviewReplayReadinessSummary;
  humanoidPerformanceContract?: AdminCaseDefinedHumanoidPerformanceContract;
};

export function ReviewReplayReadinessSummaryPanel({
  summary,
  humanoidPerformanceContract,
}: ReviewReplayReadinessSummaryPanelProps): ReactElement {
  return (
    <section className="workbench-panel" aria-label="Review replay readiness summary">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Summary-only replay gate</Typography.Text>
          <Typography.Title level={4}>Review Replay Readiness Summary</Typography.Title>
        </div>
        <Tag color={summary.replayEvidenceReady && summary.facultyReviewSafe ? "green" : "gold"}>
          {summary.replayEvidenceReady && summary.facultyReviewSafe ? "Faculty review evidence ready" : "Review blockers present"}
        </Tag>
      </div>
      <Typography.Paragraph type="secondary">
        Read-only faculty review posture; this does not approve score use, clinical-validity, live provider readiness, Quest-readiness, or production release.
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        Summary packet readiness only; this does not mean Quest readiness, score-use readiness, clinical validity, raw-payload readiness, or full runtime readiness.
      </Typography.Paragraph>
      <div className="readiness-strip review-replay-strip" aria-label="Review replay readiness metrics">
        <ReviewReplayReadinessMetric label={`${summary.timelineEntryCount} timeline entries`} detail={`${summary.traceEventCount} trace events`} />
        <ReviewReplayReadinessMetric label={`${summary.durableEventCount} durable events`} detail={`${summary.redactedDurableEventCount} redacted summaries`} />
        <ReviewReplayReadinessMetric label={`${summary.missingRequiredBehaviorCount} missing behaviors`} detail={`${summary.lateBehaviorCount} late behaviors`} />
        <ReviewReplayReadinessMetric label={`${summary.safetySignalCount} safety signals`} detail={summary.replayBoundary} />
      </div>
      <Typography.Text strong>Recommended next action</Typography.Text>
      <Typography.Paragraph type="secondary">{summary.recommendedNextAction}</Typography.Paragraph>
      {summary.generatedBundlePosture ? (
        <>
          <Typography.Text strong>Generated bundle blocked posture</Typography.Text>
          <div className="readiness-strip review-replay-strip" aria-label="Generated bundle blocked posture">
            <ReviewReplayReadinessMetric label={summary.generatedBundlePosture.bundleId} detail={summary.generatedBundlePosture.status} />
            <ReviewReplayReadinessMetric
              label={summary.generatedBundlePosture.learnerRuntimeUseBlocked ? "Learner runtime blocked" : "Learner runtime unblocked"}
              detail={summary.generatedBundlePosture.claimBoundary}
            />
            <ReviewReplayReadinessMetric
              label={`${summary.generatedBundlePosture.pendingEvidenceGateIds.length} pending runtime gates`}
              detail={summary.generatedBundlePosture.pendingEvidenceGateIds.join(", ") || "none"}
            />
            <ReviewReplayReadinessMetric
              label={`${summary.generatedBundlePosture.learnerRuntimeUseBlockers.length} bundle blockers`}
              detail={summary.generatedBundlePosture.learnerRuntimeUseBlockers.join(", ") || "none"}
            />
          </div>
          <Typography.Paragraph type="secondary" aria-label="Review-safe learner launch link">
            <Typography.Link href={learnerRuntimeLaunchHref(summary.generatedBundlePosture)}>
              Open learner runtime with this opaque bundle id
            </Typography.Link>
            {" while preserving runtime evidence gates; this link is for review-only navigation and does not assert full runtime readiness, raw-payload readiness, or clinical/score/Quest validity."}
          </Typography.Paragraph>
        </>
      ) : null}
      {summary.reviewPacketEvidenceHandoff ? (
        <>
          <Typography.Text strong>Replay evidence handoff</Typography.Text>
          <div className="readiness-strip review-replay-strip" aria-label="Replay evidence handoff">
            <ReviewReplayReadinessMetric label={summary.reviewPacketEvidenceHandoff.reviewPacketRef} detail={summary.reviewPacketEvidenceHandoff.claimBoundary} />
            <ReviewReplayReadinessMetric label={`${summary.reviewPacketEvidenceHandoff.traceEventRefs.length} trace refs`} detail={`${summary.reviewPacketEvidenceHandoff.actorTurnCount} actor turns`} />
            <ReviewReplayReadinessMetric
              label={summary.reviewPacketEvidenceHandoff.patientNoteAttached ? "Patient note handoff attached" : "Patient note handoff missing"}
              detail={summary.reviewPacketEvidenceHandoff.patientNoteRef ?? "no patient note ref"}
            />
            <ReviewReplayReadinessMetric
              label={summary.reviewPacketEvidenceHandoff.privatePayloadRedacted ? "Private payload redacted" : "Private payload visible"}
              detail="summary-only handoff"
            />
          </div>
        </>
      ) : null}
      {humanoidPerformanceContract ? (
        <CaseDefinedHumanoidPerformanceContractSection contract={humanoidPerformanceContract} />
      ) : null}
      {(summary.caseDefinedHumanoidRuntimeHandoff?.length ?? 0) > 0 ? (
        <CaseDefinedHumanoidRuntimeHandoffSection handoff={summary.caseDefinedHumanoidRuntimeHandoff ?? []} />
      ) : null}
      {summary.xrTraceEvidenceSummary ?? summary.reviewPacketEvidenceHandoff?.xrTraceEvidenceSummary ? (
        <>
          <Typography.Text strong>XR trace evidence handoff</Typography.Text>
          <Typography.Paragraph type="secondary">
            XR trace summary only; it is not raw payload access, not an execution trace, and not evidence of Quest, clinical, scoring, or runtime readiness.
          </Typography.Paragraph>
          <div className="readiness-strip review-replay-strip" aria-label="XR trace evidence handoff">
            {(() => {
              const xrSummary = summary.xrTraceEvidenceSummary ?? summary.reviewPacketEvidenceHandoff?.xrTraceEvidenceSummary;
              return xrSummary ? (
                <>
                  <ReviewReplayReadinessMetric label={xrSummary.latestTraceTag ?? "no latest trace"} detail={xrSummary.source} />
                  <ReviewReplayReadinessMetric label={xrSummary.activeLocomotionSource ?? "locomotion not observed"} detail={`distance ${xrSummary.locomotionDistanceMeters ?? "n/a"}m; turn ${xrSummary.locomotionTurnRadians ?? "n/a"}rad`} />
                  <ReviewReplayReadinessMetric label={`${xrSummary.interactionSignalRefs.length} interaction refs`} detail={xrSummary.interactionSignalRefs.join(", ") || "none"} />
                  <ReviewReplayReadinessMetric label={xrSummary.latestTraceLatencyMs === null ? "latency not attached" : `${xrSummary.latestTraceLatencyMs}ms latest latency`} detail={xrSummary.claimBoundary} />
                  <ReviewReplayReadinessMetric label="trace evidence ref" detail={xrSummary.evidenceRef} />
                  <ReviewReplayReadinessMetric label={`${xrSummary.blockers.length} XR trace blockers`} detail={xrSummary.blockers.join(", ") || "none"} />
                </>
              ) : null;
            })()}
          </div>
        </>
      ) : null}
      {(summary.runtimeRemediationPlanRefs?.length ?? 0) > 0 || (summary.providerDisabledRemediation?.length ?? 0) > 0 ? (
        <>
          <Typography.Text strong>Remediation planning context</Typography.Text>
          <Typography.Paragraph type="secondary">
            Metadata-only planning context for admin review; this is not learner, Quest, clinical, scoring, live-provider, or production-readiness evidence.
          </Typography.Paragraph>
          <ul className="compact-list" aria-label="Remediation planning context">
            {(summary.runtimeRemediationPlanRefs ?? []).map((planRef) => (
              <li key={`runtime-remediation-plan:${planRef}`}>
                <Typography.Text>{`runtime remediation plan ref: ${planRef}`}</Typography.Text>
              </li>
            ))}
            {(summary.providerDisabledRemediation ?? []).map((remediation) => (
              <li key={`provider-disabled-remediation:${remediation.providerId}`}>
                <Typography.Text>{`${remediation.providerId}: ${remediation.status}`}</Typography.Text>
                <Typography.Text type="secondary">
                  {[
                    remediation.remediationPlanRefs.length > 0 ? `plans ${remediation.remediationPlanRefs.join(", ")}` : "plans none",
                    remediation.blockers.length > 0 ? `blockers ${remediation.blockers.join(", ")}` : "blockers none",
                    remediation.claimBoundary,
                  ].join("; ")}
                </Typography.Text>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {summary.runtimeEvidenceGateRefs && summary.runtimeEvidenceGateRefs.length > 0 ? (
        <>
          <Typography.Text strong>Runtime evidence gate refs</Typography.Text>
          <ul className="compact-list" aria-label="Runtime evidence gate refs">
            {summary.runtimeEvidenceGateRefs.map((gateRef) => (
              <li key={gateRef.gateId}>
                <Typography.Text>{`${gateRef.gateId}: ${gateRef.status}`}</Typography.Text>
                <Typography.Text type="secondary">{gateRef.blockers.join(", ") || gateRef.claimBoundary}</Typography.Text>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Typography.Text strong>Replay blocker IDs</Typography.Text>
      <ul className="compact-list" aria-label="Review replay readiness blocker IDs">
        {summary.blockers.length > 0 ? summary.blockers.map((blocker) => (
          <li key={blocker}>
            <Typography.Text>{blocker}</Typography.Text>
          </li>
        )) : (
          <li>
            <Typography.Text>no_replay_readiness_blockers</Typography.Text>
          </li>
        )}
      </ul>
    </section>
  );
}

function CaseDefinedHumanoidRuntimeHandoffSection({
  handoff,
}: {
  handoff: AdminCaseDefinedHumanoidRuntimeHandoff[];
}): ReactElement {
  const actorRoles = Array.from(new Set(handoff.map((item) => item.actorRole)));
  const requiredSignalIds = Array.from(new Set(handoff.flatMap((item) => item.requiredSignalIds)));
  const blockers = Array.from(new Set(handoff.flatMap((item) => item.blockers)));
  const notEvidenceFor = Array.from(new Set(handoff.flatMap((item) => item.notEvidenceFor)));
  return (
    <>
      <Typography.Text strong>caseDefinedHumanoidRuntimeHandoff</Typography.Text>
      <Typography.Paragraph type="secondary">
        Case-defined humanoid runtime handoff context only; not generated-humanoid-asset readiness, not animation-quality approval, not runtime-readiness, not Quest-readiness, not clinical-validity, and not scoring-validity.
      </Typography.Paragraph>
      <div className="readiness-strip review-replay-strip" aria-label="Case-defined humanoid runtime handoff">
        <ReviewReplayReadinessMetric label={`${handoff.length} actor runtime handoffs`} detail={actorRoles.join(", ") || "none"} />
        <ReviewReplayReadinessMetric label={`${requiredSignalIds.length} required runtime signals`} detail={requiredSignalIds.join(", ") || "none"} />
        <ReviewReplayReadinessMetric label={`${blockers.length} runtime handoff blockers`} detail={blockers.join(", ") || "none"} />
        <ReviewReplayReadinessMetric label={handoff[0]?.claimBoundary ?? "case_definition_humanoid_runtime_handoff_metadata_only"} detail={`not evidence for ${notEvidenceFor.join(", ")}`} />
      </div>
    </>
  );
}

function CaseDefinedHumanoidPerformanceContractSection({
  contract,
}: {
  contract: AdminCaseDefinedHumanoidPerformanceContract;
}): ReactElement {
  return (
    <>
      <Typography.Text strong>Case-defined humanoid performance metadata</Typography.Text>
      <Typography.Paragraph type="secondary">
        Encounter-definition derived humanoid behavior contract only; this is not generated-humanoid-asset readiness, animation-quality approval, Quest-readiness, runtime-readiness, or clinical-validity.
      </Typography.Paragraph>
      <div className="readiness-strip review-replay-strip" aria-label="Case-defined humanoid performance metadata">
        <ReviewReplayReadinessMetric label={`${contract.actorCount} humanoid actors`} detail={`${contract.emotionStateCount} emotion states`} />
        <ReviewReplayReadinessMetric label={`${contract.locomotionActorRoles.length} locomotion roles`} detail={contract.locomotionActorRoles.join(", ") || "none"} />
        <ReviewReplayReadinessMetric label={`${contract.expressionActorRoles.length} expression roles`} detail={contract.expressionActorRoles.join(", ") || "none"} />
        <ReviewReplayReadinessMetric label={`${contract.gazeActorRoles.length} gaze roles`} detail={contract.gazeActorRoles.join(", ") || "none"} />
        <ReviewReplayReadinessMetric label={`${contract.lipSyncActorRoles.length} lip-sync roles`} detail={contract.lipSyncActorRoles.join(", ") || "none"} />
        <ReviewReplayReadinessMetric label={`${contract.interactiveActorRoles.length} interactive roles`} detail={contract.interactiveActorRoles.join(", ") || "none"} />
        <ReviewReplayReadinessMetric
          label="planning flags"
          detail={[
            `dialogueDrivenVisemeMappingRequired:${String(contract.dialogueDrivenVisemeMappingRequired)}`,
            `gazeTargetingRequired:${String(contract.gazeTargetingRequired)}`,
            `locomotionPlanningRequired:${String(contract.locomotionPlanningRequired)}`,
          ].join("; ")}
        />
        <ReviewReplayReadinessMetric label={contract.claimBoundary} detail={`not evidence for ${contract.notEvidenceFor.join(", ")}`} />
      </div>
    </>
  );
}

function ReviewReplayReadinessMetric({ label, detail }: { label: string; detail: string }): ReactElement {
  return (
    <div className="readiness-metric">
      <Typography.Text strong>{label}</Typography.Text>
      <Typography.Text type="secondary">{detail}</Typography.Text>
    </div>
  );
}

function learnerRuntimeLaunchHref(posture: NonNullable<ReviewReplayReadinessSummary["generatedBundlePosture"]>): string {
  const params = new URLSearchParams({
    runtimeAssetBundleId: posture.bundleId,
    scenarioId: posture.scenarioId,
    stationId: posture.stationId,
  });
  return `/xr?${params.toString()}`;
}
