import { Tag, Typography } from "antd";
import type { ReactElement } from "react";
import type { AdminRuntimeSelectionReviewPacket } from "./api-client.js";

export type RuntimeSelectionReviewPacketPanelProps = {
  packet: AdminRuntimeSelectionReviewPacket;
};

export function RuntimeSelectionReviewPacketPanel({ packet }: RuntimeSelectionReviewPacketPanelProps): ReactElement {
  const localXrHandoffUrl = buildLocalXrHandoffUrl(packet);
  return (
    <section className="workbench-panel" aria-label="Runtime selection review packet">
      <div className="station-queue-row">
        <Typography.Title level={4}>Runtime Selection Review Packet</Typography.Title>
        <Tag color="gold">Provider-disabled review bundle</Tag>
      </div>
      <Typography.Paragraph>
        Provider-disabled review bundle for a read-only guarded runtime handoff; this panel does not launch the encounter, execute providers, refresh Quest evidence, run broad verification, confirm provider availability, confirm runtime readiness, confirm Quest readiness, confirm clinical validity, confirm scoring validity, or approve learner launch readiness.
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        {`Boundary: ${packet.claimBoundary}; selector boundary: ${packet.guardedRuntimeSelectorDecision.claimBoundary}.`}
      </Typography.Paragraph>
      {packet.operatorReviewReadiness ? (
        <>
          <Typography.Title level={5}>Operator review readiness</Typography.Title>
          <div className="readiness-strip" aria-label="Operator review readiness metrics">
            <RuntimeSelectionMetric
              label={packet.operatorReviewReadiness.status}
              detail={`${packet.operatorReviewReadiness.blockingArtifactCount} blockers across ${packet.operatorReviewReadiness.reviewedArtifactCount} artifacts`}
            />
            <RuntimeSelectionMetric
              label={packet.operatorReviewReadiness.claimBoundary}
              detail={`materialization required: ${String(packet.operatorReviewReadiness.materializationRequiredBeforeRuntime)}`}
            />
            <RuntimeSelectionMetric
              label="provider/runtime/learner/Quest execution disabled; no readiness claim"
              detail={`provider ${String(packet.operatorReviewReadiness.providerExecutionAllowed)}; runtime ${String(packet.operatorReviewReadiness.runtimeExecutionAllowed)}; learner ${String(packet.learnerLaunchAllowed)}; Quest ${String(packet.operatorReviewReadiness.questEvidenceRefreshAllowed)}; broad verification ${String(packet.broadVerificationPerformed)}`}
            />
          </div>
          <ul className="compact-list" aria-label="Operator review required actions">
            {packet.operatorReviewReadiness.requiredOperatorActions.map((action) => (
              <li key={action}>
                <Typography.Text type="secondary">{action}</Typography.Text>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="readiness-strip" aria-label="Runtime selection review metrics">
        <RuntimeSelectionMetric label={packet.selectedScenarioId} detail={packet.selectedStationId} />
        <RuntimeSelectionMetric label={packet.selectedRuntimeAssetBundleId} detail={packet.reviewPacketMode} />
        <RuntimeSelectionMetric label={`model ${packet.runtimeCandidates.model}`} detail={`voice ${packet.runtimeCandidates.voice}`} />
        <RuntimeSelectionMetric label={packet.guardedRuntimeSelectorDecision.selectionStatus} detail={`${packet.blockers.length} blockers`} />
      </div>
      <Typography.Title level={5}>Prepare local XR handoff</Typography.Title>
      <Typography.Paragraph type="secondary">
        This review-only link carries the selected scenario, encounter, station, and runtime bundle into the local XR surface for operator inspection. It does not clear evidence gates, launch a learner exam, execute providers, refresh Quest evidence, or make runtime-readiness claims.
      </Typography.Paragraph>
      <div className="readiness-strip" aria-label="Prepare local XR handoff metrics">
        <RuntimeSelectionMetric label="local XR review URL" detail={localXrHandoffUrl} />
        <RuntimeSelectionMetric label="handoff carries" detail="scenario, encounter, station, runtime bundle, actor-realism capture mode" />
        <RuntimeSelectionMetric label="launch remains blocked" detail={packet.blockers.join(", ") || "no blockers listed"} />
      </div>
      <Typography.Link href={localXrHandoffUrl} target="_blank" rel="noreferrer">
        Open local XR review handoff
      </Typography.Link>
      <ul className="compact-list" aria-label="Runtime selection reviewer checklist">
        {packet.reviewerChecklist.map((check) => (
          <li key={check.checkId}>
            <Typography.Text>{check.checkId}</Typography.Text>
            <Typography.Text type="secondary">
              {check.blockerIds.length > 0 ? check.blockerIds.join(", ") : check.status}
            </Typography.Text>
          </li>
        ))}
      </ul>
      {packet.publicationPayloadLinkage ? (
        <>
          <Typography.Title level={5}>Publication materialization gate</Typography.Title>
          <div className="readiness-strip" aria-label="Publication materialization metrics">
            <RuntimeSelectionMetric
              label={packet.publicationPayloadLinkage.status}
              detail={`materialized ${packet.publicationPayloadLinkage.localMaterializationHandoff.materializedOutputCount}/${packet.publicationPayloadLinkage.localMaterializationHandoff.plannedOutputCount}`}
            />
            <RuntimeSelectionMetric
              label={packet.publicationPayloadLinkage.localMaterializationHandoff.requestId}
              detail={packet.publicationPayloadLinkage.localMaterializationHandoff.rootPath}
            />
            <RuntimeSelectionMetric
              label={`humanoids ${packet.publicationPayloadLinkage.assetNeedsReadiness.requiredHumanoidRoles.join(", ")}`}
              detail={`shared keys ${packet.publicationPayloadLinkage.assetNeedsReadiness.sharedAssetLibrarySemanticKeyCount}`}
            />
            <RuntimeSelectionMetric
              label="animation evidence requirements"
              detail={`animation ${packet.publicationPayloadLinkage.assetNeedsReadiness.animationRequirementCount}; emotion ${packet.publicationPayloadLinkage.assetNeedsReadiness.emotionRequirementCount}; gaze ${packet.publicationPayloadLinkage.assetNeedsReadiness.gazeRequirementCount}; lip-sync ${packet.publicationPayloadLinkage.assetNeedsReadiness.lipSyncRequirementCount}`}
            />
            {packet.publicationPayloadLinkage.realismEvidenceRefs ? (
              <RuntimeSelectionMetric
                label="realism evidence refs"
                detail={`${packet.publicationPayloadLinkage.realismEvidenceRefs.refIds.join(", ")}; ${packet.publicationPayloadLinkage.realismEvidenceRefs.claimBoundary}`}
              />
            ) : null}
          </div>
          <ul className="compact-list" aria-label="Publication materialization blockers">
            {[...packet.publicationPayloadLinkage.blockers, ...packet.publicationPayloadLinkage.assetNeedsReadiness.blockers].map((blocker) => (
              <li key={blocker}>
                <Typography.Text type="secondary">{blocker}</Typography.Text>
              </li>
            ))}
          </ul>
          {packet.publicationPayloadLinkage.realismEvidenceRefs?.refs?.length ? (
            <ul className="compact-list" aria-label="Publication realism evidence trace">
              {packet.publicationPayloadLinkage.realismEvidenceRefs.refs.map((ref) => (
                <li key={`${ref.refId}:${ref.evidenceRef}`}>
                  <Typography.Text>{`${ref.refId}: ${ref.status} before ${ref.requiredBefore}`}</Typography.Text>
                  <Typography.Text type="secondary">{ref.evidenceRef}</Typography.Text>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <ul className="compact-list" aria-label="Runtime selection blockers">
        {packet.blockers.map((blocker) => (
          <li key={blocker}>
            <Typography.Text type="secondary">{blocker}</Typography.Text>
          </li>
        ))}
      </ul>
      <Typography.Paragraph type="secondary">
        {`Not evidence for: ${packet.notEvidenceFor.join(", ")}.`}
      </Typography.Paragraph>
    </section>
  );
}

function buildLocalXrHandoffUrl(packet: AdminRuntimeSelectionReviewPacket): string {
  const params = new URLSearchParams({
    openclinxrScenarioId: packet.selectedScenarioId,
    openclinxrEncounterId: packet.selectedEncounterId,
    openclinxrStationId: packet.selectedStationId,
    openclinxrRuntimeAssetBundleId: packet.selectedRuntimeAssetBundleId,
    openclinxrCaptureMode: "actor-realism",
  });
  return `http://127.0.0.1:5173/?${params.toString()}`;
}

function RuntimeSelectionMetric({ label, detail }: { label: string; detail: string }): ReactElement {
  return (
    <div className="readiness-metric">
      <Typography.Text strong>{label}</Typography.Text>
      <Typography.Text type="secondary">{detail}</Typography.Text>
    </div>
  );
}
