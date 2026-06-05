import { buildFacultyReviewPath } from "@openclinxr/review-workflow";
import { Tag, Typography } from "antd";
import type { ReactElement } from "react";
import type { AdminCaseDefinedHumanoidPerformanceContract, AdminCaseDefinedHumanoidRuntimeHandoff, AdminReviewPacketReplay } from "./api-client.js";

type ReviewPacket = NonNullable<AdminReviewPacketReplay["reviewPacket"]>;
type ClinicalEventReviewSummary = AdminReviewPacketReplay["clinicalEventReviewSummary"] | null | undefined;
type ReviewReplayReadinessSummary = AdminReviewPacketReplay["reviewReplayReadinessSummary"] | null | undefined;

export type FacultyReviewDecisionPanelProps = {
  packet: ReviewPacket;
  clinicalEventReviewSummary: ClinicalEventReviewSummary;
  reviewReplayReadinessSummary?: ReviewReplayReadinessSummary;
  humanoidPerformanceContract?: AdminCaseDefinedHumanoidPerformanceContract;
  traceEventCount: number;
  safetyFlagLabels: readonly string[];
};

export function FacultyReviewDecisionPanel({
  packet,
  clinicalEventReviewSummary,
  reviewReplayReadinessSummary,
  humanoidPerformanceContract,
  traceEventCount,
  safetyFlagLabels,
}: FacultyReviewDecisionPanelProps): ReactElement {
  const reviewPath = buildFacultyReviewPath({
    packet,
    hasDurableSummary: Boolean(clinicalEventReviewSummary),
    durableSummaryIsSafe: clinicalEventReviewSummary?.safeForFacultyReview === true,
    traceEventCount,
    safetyFlagLabels,
  });
  const decision = reviewPath.decision;

  return (
    <section className="workbench-panel" aria-label="Faculty review decision handoff">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Completed-station review handoff</Typography.Text>
          <Typography.Title level={4}>Faculty Review Decision Handoff</Typography.Title>
        </div>
        <Tag color={decision.color}>{decision.title}</Tag>
      </div>
      <Typography.Paragraph>{decision.guidance}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        This is a local faculty review aid for debrief preparation and scenario iteration; it is not a score-use, clinical-validity, Quest-readiness, or production-readiness claim.
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        Faculty decision support only; this does not approve score use, clinical-validity, Quest readiness, raw-payload readiness, or full runtime readiness.
      </Typography.Paragraph>
      <div className="readiness-strip review-replay-strip">
        <FacultyReviewDecisionMetric label={`${packet.timeline.length} timeline ${pluralize(packet.timeline.length, "entry")}`} detail={`${traceEventCount} trace metadata events`} />
        <FacultyReviewDecisionMetric
          label={`${packet.missingRequiredTraceTags.length} missing required ${pluralize(packet.missingRequiredTraceTags.length, "behavior")}`}
          detail={packet.missingRequiredTraceTags.length === 0 ? "coverage complete" : packet.missingRequiredTraceTags.join(", ")}
        />
        <FacultyReviewDecisionMetric
          label={`${packet.lateTraceTags.length} late ${pluralize(packet.lateTraceTags.length, "behavior")}`}
          detail={packet.lateTraceTags.length === 0 ? "none visible" : packet.lateTraceTags.join(", ")}
        />
        <FacultyReviewDecisionMetric
          label={`${safetyFlagLabels.length} safety ${pluralize(safetyFlagLabels.length, "signal")}`}
          detail={safetyFlagLabels.length === 0 ? "none visible" : safetyFlagLabels.join(", ")}
        />
      </div>
      <Typography.Text strong>Why this posture</Typography.Text>
      <ul className="compact-list">
        {decision.reasons.map((reason) => (
          <li key={reason}>
            <Typography.Text>{reason}</Typography.Text>
          </li>
        ))}
      </ul>
      <Typography.Text strong>Review blocker IDs</Typography.Text>
      <ul className="compact-list" aria-label="Faculty review blocker IDs">
        {decision.blockers.map((blocker) => (
          <li key={blocker}>
            <Typography.Text>{blocker}</Typography.Text>
          </li>
        ))}
      </ul>
      {reviewReplayReadinessSummary ? (
        <>
          <Typography.Text strong>Canonical replay readiness</Typography.Text>
          <Typography.Paragraph type="secondary">
            Canonical replay readiness here is metadata-only; it does not mean raw payload readiness, Quest readiness, clinical-validity, or full runtime readiness.
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary">
            {`Canonical replay action: ${reviewReplayReadinessSummary.recommendedNextAction}`}
          </Typography.Paragraph>
          {humanoidPerformanceContract ? renderCaseDefinedHumanoidPerformanceContract(humanoidPerformanceContract) : null}
          {(reviewReplayReadinessSummary.caseDefinedHumanoidRuntimeHandoff?.length ?? 0) > 0
            ? renderCaseDefinedHumanoidRuntimeHandoff(reviewReplayReadinessSummary.caseDefinedHumanoidRuntimeHandoff ?? [])
            : null}
          {renderRuntimeVisualEvidenceReplayProjection(reviewReplayReadinessSummary)}
          {renderRuntimeVisualEvidenceFacultyFollowUp(reviewReplayReadinessSummary)}
          {renderAssetReleaseLadderReplayProjection(reviewReplayReadinessSummary)}
          {renderXrTraceEvidenceHandoff(reviewReplayReadinessSummary)}
          {hasRemediationPlanningContext(reviewReplayReadinessSummary) ? (
            <>
              <Typography.Text strong>Remediation planning context</Typography.Text>
              <Typography.Paragraph type="secondary">
                Metadata only for admin/faculty planning; this does not enable a learner flow, Quest-readiness, clinical-validity, scoring-validity, live provider readiness, or production-readiness.
              </Typography.Paragraph>
              <ul className="compact-list" aria-label="Remediation planning context">
                {(reviewReplayReadinessSummary.runtimeRemediationPlanRefs ?? []).map((planRef) => (
                  <li key={`runtime-remediation-plan:${planRef}`}>
                    <Typography.Text>{`runtime remediation plan ref: ${planRef}`}</Typography.Text>
                  </li>
                ))}
                {(reviewReplayReadinessSummary.providerDisabledRemediation ?? []).map((remediation) => (
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
          <ul className="compact-list" aria-label="Canonical replay readiness blocker IDs">
            {reviewReplayReadinessSummary.blockers.length > 0 ? reviewReplayReadinessSummary.blockers.map((blocker) => (
              <li key={blocker}>
                <Typography.Text>{blocker}</Typography.Text>
              </li>
            )) : (
              <li>
                <Typography.Text>no_replay_readiness_blockers</Typography.Text>
              </li>
            )}
          </ul>
        </>
      ) : null}
      <Typography.Text strong>Reviewer decision posture</Typography.Text>
      <fieldset className="readiness-strip review-replay-strip" aria-label="Reviewer decision posture metrics">
        <FacultyReviewDecisionMetric
          label={`${packet.timeline.length} timeline ${pluralize(packet.timeline.length, "entry")}`}
          detail={packet.timeline.length > 0 ? `latest at ${packet.timeline[packet.timeline.length - 1]?.atSecond ?? 0}s` : "timeline evidence missing"}
        />
        <FacultyReviewDecisionMetric
          label={packet.patientNote ? "Patient note attached" : "Patient note missing"}
          detail={packet.patientNote ? `submitted at ${packet.patientNote.submittedAtSecond}s` : "note evidence should remain visible for debrief review"}
        />
        <FacultyReviewDecisionMetric
          label={`Faculty draft ${packet.facultyScoreDraft.status}`}
          detail={`reviewer ${packet.facultyScoreDraft.reviewerId}`}
        />
        <FacultyReviewDecisionMetric
          label={packet.facultyScoreDraft.comments.trim().length > 0 ? "Draft comments present" : "Draft comments empty"}
          detail={packet.facultyScoreDraft.comments.trim().length > 0 ? summarizeText(packet.facultyScoreDraft.comments) : "faculty decision rationale still needed"}
        />
        <FacultyReviewDecisionMetric
          label={`${packet.traceQuality.missingRequiredTraceTagCount} trace-quality missing ${pluralize(packet.traceQuality.missingRequiredTraceTagCount, "tag")}`}
          detail={packet.traceQuality.hasModelProvenance ? "model provenance present" : "model provenance missing"}
        />
      </fieldset>
      <Typography.Paragraph type="secondary">
        Faculty draft status is a review artifact only; it does not authorize score use or imply scoring validity.
      </Typography.Paragraph>
      <Typography.Text strong>Recommended next actions</Typography.Text>
      <ol className="compact-list">
        {decision.nextActions.map((action) => (
          <li key={action}>
            <Typography.Text>{action}</Typography.Text>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FacultyReviewDecisionMetric({ label, detail }: { label: string; detail: string }): ReactElement {
  return (
    <div className="readiness-metric">
      <Typography.Text strong>{label}</Typography.Text>
      <Typography.Text type="secondary">{detail}</Typography.Text>
    </div>
  );
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function summarizeText(value: string): string {
  const normalized = value.trim().replaceAll(/\s+/g, " ");
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function hasRemediationPlanningContext(summary: NonNullable<ReviewReplayReadinessSummary>): boolean {
  return (summary.runtimeRemediationPlanRefs?.length ?? 0) > 0 || (summary.providerDisabledRemediation?.length ?? 0) > 0;
}

function renderXrTraceEvidenceHandoff(summary: NonNullable<ReviewReplayReadinessSummary>): ReactElement | null {
  const xrSummary = summary.xrTraceEvidenceSummary ?? summary.reviewPacketEvidenceHandoff?.xrTraceEvidenceSummary;
  if (!xrSummary) {
    return null;
  }
  return (
    <fieldset className="station-queue-row" aria-label="XR trace evidence handoff">
      <Typography.Text type="secondary">
        {formatXrTraceEvidenceSummary(xrSummary)}
      </Typography.Text>
    </fieldset>
  );
}

function renderRuntimeVisualEvidenceReplayProjection(summary: NonNullable<ReviewReplayReadinessSummary>): ReactElement | null {
  const projection = summary.runtimeVisualEvidenceReplayProjection;
  if (!projection) {
    return null;
  }

  return (
    <fieldset className="station-queue-row" aria-label="Faculty runtime visual evidence context">
      <Typography.Text strong>Faculty runtime visual evidence context</Typography.Text>
      <Typography.Paragraph type="secondary">
        Runtime/visual evidence posture is a read-only replay projection for faculty planning; accepted metadata refs are not raw payloads, runtime-readiness, Quest-readiness, production-readiness, clinical-validity, or scoring-validity evidence.
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        {[
          `${projection.acceptedAttachmentRefCount} accepted metadata refs`,
          `${projection.runtimeEvidenceRefCount} runtime refs`,
          `${projection.visualQaEvidenceRefCount} visual QA refs`,
          `${projection.reviewedMetadataOnlyCount} reviewed`,
          `${projection.heldMetadataOnlyCount} held`,
          `actions ${projection.acceptedActionIds.join(", ") || "none"}`,
          projection.rawPayloadDisplayed ? "raw payload visible" : "raw payload hidden",
          `blockers ${projection.blockerIds.length}`,
          `runtime ${String(projection.runtimeExecutionAllowed)}`,
          `learner ${String(projection.learnerLaunchAllowed)}`,
          `Quest ${String(projection.questEvidenceRefreshAllowed)}`,
          `production ${String(projection.productionAssetReadinessClaimed)}`,
          projection.claimBoundary,
        ].join("; ")}
      </Typography.Paragraph>
    </fieldset>
  );
}

function renderRuntimeVisualEvidenceFacultyFollowUp(summary: NonNullable<ReviewReplayReadinessSummary>): ReactElement | null {
  const projection = summary.runtimeVisualEvidenceReplayProjection;
  if (!projection) {
    return null;
  }
  const followUpActions = projection.nextActions && projection.nextActions.length > 0 ? projection.nextActions : [
    projection.acceptedAttachmentRefCount > 0 ? `review ${projection.acceptedAttachmentRefCount} accepted metadata-only runtime/visual refs during faculty debrief preparation` : "request runtime/visual metadata refs before faculty debrief preparation",
    projection.blockerIds.length > 0 ? `carry forward blockers ${projection.blockerIds.slice(0, 3).join(", ")}` : "confirm no runtime/visual projection blockers before scenario iteration",
    "keep runtime, learner, Quest, production, clinical, and scoring gates blocked until real runtime and visual-QA evidence clears review",
  ];

  return (
    <fieldset className="station-queue-row" aria-label="Faculty runtime visual evidence follow-up actions">
      <Typography.Text strong>Faculty runtime visual evidence follow-up actions</Typography.Text>
      <ul className="compact-list">
        {followUpActions.map((action) => (
          <li key={action}>
            <Typography.Text>{action}</Typography.Text>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function renderAssetReleaseLadderReplayProjection(summary: NonNullable<ReviewReplayReadinessSummary>): ReactElement | null {
  const projection = summary.assetReleaseLadderReplayProjection;
  if (!projection) {
    return null;
  }
  const sampleBlockedAssets = projection.blockedAssets
    .slice(0, 3)
    .map((asset) => `${asset.assetId}:${asset.firstBlockedStep ?? "blocked"}`)
    .join(", ") || "no blocked assets";

  return (
    <fieldset className="station-queue-row" aria-label="Faculty asset release ladder context">
      <Typography.Text strong>Faculty asset release ladder context</Typography.Text>
      <Typography.Paragraph type="secondary">
        Asset release-ladder posture is summary-only for faculty planning; it is not production-release approval, Quest-readiness, runtime-readiness, clinical-validity, or scoring-validity evidence.
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        {[
          `${projection.assetCount} assets`,
          `${projection.productionReadyAssetCount} release-ladder complete`,
          `${projection.blockedAssetCount} blocked`,
          `${projection.missingRequiredAssetCount} missing required`,
          `${projection.blockerCount} blockers`,
          `station budget ${projection.stationBudgetStatus}`,
          `sample blocked assets ${sampleBlockedAssets}`,
          `runtime ${String(projection.runtimeExecutionAllowed)}`,
          `learner ${String(projection.learnerLaunchAllowed)}`,
          `Quest ${String(projection.questEvidenceRefreshAllowed)}`,
          `production ${String(projection.productionAssetReadinessClaimed)}`,
          projection.claimBoundary,
        ].join("; ")}
      </Typography.Paragraph>
    </fieldset>
  );
}

function renderCaseDefinedHumanoidPerformanceContract(
  contract: AdminCaseDefinedHumanoidPerformanceContract,
): ReactElement {
  return (
    <fieldset className="station-queue-row" aria-label="Case-defined humanoid performance metadata">
      <Typography.Text strong>Case-defined humanoid performance metadata</Typography.Text>
      <Typography.Paragraph type="secondary">
        Humanoid behavior metadata is derived from the encounter definition for faculty planning only; it is not generated-humanoid-asset readiness, animation-quality approval, Quest-readiness, runtime-readiness, or clinical-validity.
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        {[
          `${contract.actorCount} humanoid actors`,
          `${contract.emotionStateCount} emotion states`,
          `locomotion roles ${contract.locomotionActorRoles.join(", ") || "none"}`,
          `expression roles ${contract.expressionActorRoles.join(", ") || "none"}`,
          `gaze roles ${contract.gazeActorRoles.join(", ") || "none"}`,
          `lip-sync roles ${contract.lipSyncActorRoles.join(", ") || "none"}`,
          `interactive roles ${contract.interactiveActorRoles.join(", ") || "none"}`,
          `dialogueDrivenVisemeMappingRequired:${String(contract.dialogueDrivenVisemeMappingRequired)}`,
          `gazeTargetingRequired:${String(contract.gazeTargetingRequired)}`,
          `locomotionPlanningRequired:${String(contract.locomotionPlanningRequired)}`,
          contract.claimBoundary,
          `not evidence for ${contract.notEvidenceFor.join(", ")}`,
        ].join("; ")}
      </Typography.Paragraph>
    </fieldset>
  );
}

function renderCaseDefinedHumanoidRuntimeHandoff(
  handoff: AdminCaseDefinedHumanoidRuntimeHandoff[],
): ReactElement {
  const actorRoles = Array.from(new Set(handoff.map((item) => item.actorRole)));
  const requiredSignalIds = Array.from(new Set(handoff.flatMap((item) => item.requiredSignalIds)));
  const blockers = Array.from(new Set(handoff.flatMap((item) => item.blockers)));
  const notEvidenceFor = Array.from(new Set(handoff.flatMap((item) => item.notEvidenceFor)));
  return (
    <fieldset className="station-queue-row" aria-label="Faculty case-defined humanoid runtime handoff">
      <Typography.Text strong>Faculty case-defined humanoid runtime handoff</Typography.Text>
      <Typography.Paragraph type="secondary">
        Case-defined humanoid runtime handoff context is deterministic faculty planning metadata only; it is not generated-humanoid-asset readiness, animation-quality approval, Quest-readiness, runtime-readiness, clinical-validity, or scoring-validity.
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        {[
          `${handoff.length} actor runtime handoffs`,
          `roles ${actorRoles.join(", ") || "none"}`,
          `${requiredSignalIds.length} required runtime signals`,
          requiredSignalIds.join(", ") || "signals none",
          `${blockers.length} handoff blockers`,
          blockers.join(", ") || "blockers none",
          handoff[0]?.claimBoundary ?? "case_definition_humanoid_runtime_handoff_metadata_only",
          `not evidence for ${notEvidenceFor.join(", ")}`,
        ].join("; ")}
      </Typography.Paragraph>
    </fieldset>
  );
}

function formatXrTraceEvidenceSummary(
  summary: NonNullable<NonNullable<ReviewReplayReadinessSummary>["xrTraceEvidenceSummary"]>,
): string {
  return `XR trace evidence handoff: latest ${summary.latestTraceTag ?? "none"} from ${summary.source}; locomotion ${summary.activeLocomotionSource ?? "not observed"}; latency ${summary.latestTraceLatencyMs ?? "not attached"}; ${summary.claimBoundary}`;
}
