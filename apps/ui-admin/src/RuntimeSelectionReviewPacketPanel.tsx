import { Button, Tag, Typography } from "antd";
import type { ReactElement } from "react";
import type { AdminRuntimeSelectionReviewPacket, RuntimeVisualEvidenceAttachment, SubmitRuntimeVisualEvidenceAttachmentInput } from "./api-client.js";

export type RuntimeSelectionReviewPacketPanelProps = {
  packet: AdminRuntimeSelectionReviewPacket;
  runtimeVisualEvidenceAttachmentSubmitStatus?: "idle" | "submitting" | "submitted" | "error";
  runtimeVisualEvidenceAttachmentSubmitMessage?: string;
  onSubmitRuntimeVisualEvidenceAttachment?: (input: SubmitRuntimeVisualEvidenceAttachmentInput) => void | Promise<void>;
};

export function RuntimeSelectionReviewPacketPanel({
  packet,
  runtimeVisualEvidenceAttachmentSubmitStatus = "idle",
  runtimeVisualEvidenceAttachmentSubmitMessage,
  onSubmitRuntimeVisualEvidenceAttachment,
}: RuntimeSelectionReviewPacketPanelProps): ReactElement {
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
          <fieldset className="readiness-strip" aria-label="Operator review readiness metrics">
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
          </fieldset>
          <ul className="compact-list" aria-label="Operator review required actions">
            {packet.operatorReviewReadiness.requiredOperatorActions.map((action) => (
              <li key={action}>
                <Typography.Text type="secondary">{action}</Typography.Text>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {packet.runtimeRealismEvidenceDraftReview ? (
        <>
          <Typography.Title level={5}>Runtime realism evidence draft review</Typography.Title>
          <fieldset className="readiness-strip" aria-label="Runtime realism evidence draft metrics">
            <RuntimeSelectionMetric
              label={packet.runtimeRealismEvidenceDraftReview.status}
              detail={`runtime hooks ${packet.runtimeRealismEvidenceDraftReview.runtimeRealismEvidenceHookCount}; visual QA hooks ${packet.runtimeRealismEvidenceDraftReview.visualQaEvidenceHookCount}`}
            />
            <RuntimeSelectionMetric
              label={packet.runtimeRealismEvidenceDraftReview.claimBoundary}
              detail={`runtime ${String(packet.runtimeRealismEvidenceDraftReview.runtimeExecutionAllowed)}; learner ${String(packet.runtimeRealismEvidenceDraftReview.learnerLaunchAllowed)}; Quest ${String(packet.runtimeRealismEvidenceDraftReview.questEvidenceRefreshAllowed)}`}
            />
          </fieldset>
          <ul className="compact-list" aria-label="Runtime realism evidence draft blockers">
            {packet.runtimeRealismEvidenceDraftReview.blockerIds.map((blocker) => (
              <li key={blocker}>
                <Typography.Text type="secondary">{blocker}</Typography.Text>
              </li>
            ))}
          </ul>
          <ul className="compact-list" aria-label="Runtime realism evidence draft actions">
            {packet.runtimeRealismEvidenceDraftReview.recommendedNextActions.map((action) => (
              <li key={action}>
                <Typography.Text type="secondary">{action}</Typography.Text>
              </li>
            ))}
          </ul>
          <ul className="compact-list" aria-label="Runtime realism evidence draft hook details">
            {packet.runtimeRealismEvidenceDraftReview.runtimeHookDrafts.slice(0, 3).map((draft) => (
              <li key={`runtime:${draft.actorId}:${draft.evidenceRef}`}>
                <Typography.Text>{`${draft.actorId} (${draft.actorRole}): ${draft.status}`}</Typography.Text>
                <Typography.Text type="secondary">
                  {`${draft.requiredSignalCount} signals; ${draft.evidenceRef}; ${draft.claimBoundary}`}
                </Typography.Text>
              </li>
            ))}
            {packet.runtimeRealismEvidenceDraftReview.visualQaHookDrafts.slice(0, 6).map((draft) => (
              <li key={`visual:${draft.targetId}:${draft.evidenceRef}`}>
                <Typography.Text>{`${draft.targetId} (${draft.targetKind}): ${draft.status}`}</Typography.Text>
                <Typography.Text type="secondary">
                  {`${draft.requiredReviewFocus.length} review focuses; ${draft.evidenceRef}; ${draft.claimBoundary}`}
                </Typography.Text>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {packet.runtimeRealismEvidenceInputDraft ? (
        <>
          <Typography.Title level={5}>Runtime realism evidence input draft</Typography.Title>
          <fieldset className="readiness-strip" aria-label="Runtime realism evidence input draft metrics">
            <RuntimeSelectionMetric
              label={packet.runtimeRealismEvidenceInputDraft.status}
              detail={`${packet.runtimeRealismEvidenceInputDraft.runtimeActorEvidenceInputs.length} actor inputs; ${packet.runtimeRealismEvidenceInputDraft.visualQaEvidenceInputs.length} visual QA inputs`}
            />
            <RuntimeSelectionMetric
              label={packet.runtimeRealismEvidenceInputDraft.gateBoundary.claimBoundary}
              detail={`provider ${String(packet.runtimeRealismEvidenceInputDraft.gateBoundary.providerExecutionAllowed)}; runtime ${String(packet.runtimeRealismEvidenceInputDraft.gateBoundary.runtimeExecutionAllowed)}; learner ${String(packet.runtimeRealismEvidenceInputDraft.gateBoundary.learnerLaunchAllowed)}; Quest ${String(packet.runtimeRealismEvidenceInputDraft.gateBoundary.questEvidenceRefreshAllowed)}`}
            />
          </fieldset>
          <ul className="compact-list" aria-label="Runtime realism evidence input draft details">
            {packet.runtimeRealismEvidenceInputDraft.runtimeActorEvidenceInputs.slice(0, 3).map((input) => (
              <li key={input.evidenceInputId}>
                <Typography.Text>{`${input.actorId} (${input.actorRole}): ${input.requiredEvidenceStatus}`}</Typography.Text>
                <Typography.Text type="secondary">
                  {`${input.requiredSignalCount} signals; ${input.sourceEvidenceRef}; ${input.claimBoundary}`}
                </Typography.Text>
              </li>
            ))}
            {packet.runtimeRealismEvidenceInputDraft.visualQaEvidenceInputs.slice(0, 6).map((input) => (
              <li key={input.evidenceInputId}>
                <Typography.Text>{`${input.targetId} (${input.targetKind}): ${input.requiredEvidenceStatus}`}</Typography.Text>
                <Typography.Text type="secondary">
                  {`${input.requiredReviewFocus.length} review focuses; ${input.sourceEvidenceRef}; ${input.claimBoundary}`}
                </Typography.Text>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {packet.runtimeRealismEvidenceInputReviewDecisionRecord ? (
        <>
          <Typography.Title level={5}>Runtime realism evidence input review decisions</Typography.Title>
          <fieldset className="readiness-strip" aria-label="Runtime realism evidence input review decision metrics">
            <RuntimeSelectionMetric
              label={`${packet.runtimeRealismEvidenceInputReviewDecisionRecord.decisionCount} evidence input decisions`}
              detail={`reviewed ${packet.runtimeRealismEvidenceInputReviewDecisionRecord.reviewedDecisionCount}; held ${packet.runtimeRealismEvidenceInputReviewDecisionRecord.heldDecisionCount}`}
            />
            <RuntimeSelectionMetric
              label={packet.runtimeRealismEvidenceInputReviewDecisionRecord.claimBoundary}
              detail={`provider ${String(packet.runtimeRealismEvidenceInputReviewDecisionRecord.providerExecutionAllowed)}; runtime ${String(packet.runtimeRealismEvidenceInputReviewDecisionRecord.runtimeExecutionAllowed)}; learner ${String(packet.runtimeRealismEvidenceInputReviewDecisionRecord.learnerLaunchAllowed)}; Quest ${String(packet.runtimeRealismEvidenceInputReviewDecisionRecord.questEvidenceRefreshAllowed)}`}
            />
          </fieldset>
          <ul className="compact-list" aria-label="Runtime realism evidence input review decision details">
            {packet.runtimeRealismEvidenceInputReviewDecisionRecord.decisions.slice(0, 6).map((decision) => (
              <li key={`${decision.inputId}:${decision.reviewedAt}`}>
                <Typography.Text>{`${decision.inputId}: ${decision.decision}`}</Typography.Text>
                <Typography.Text type="secondary">{`${decision.inputKind}; ${decision.comments}`}</Typography.Text>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {packet.runtimeVisualEvidenceAttachmentSummary ? (
        <>
          <Typography.Title level={5}>Runtime visual evidence attachment summary</Typography.Title>
          <fieldset className="readiness-strip" aria-label="Runtime visual evidence attachment summary metrics">
            <RuntimeSelectionMetric
              label={`${packet.runtimeVisualEvidenceAttachmentSummary.reviewedMetadataOnlyCount} reviewed metadata-only; ${packet.runtimeVisualEvidenceAttachmentSummary.heldMetadataOnlyCount} held metadata-only`}
              detail={`${packet.runtimeVisualEvidenceAttachmentSummary.attachedRuntimeEvidenceCount} runtime evidence refs; ${packet.runtimeVisualEvidenceAttachmentSummary.attachedVisualQaEvidenceCount} visual QA evidence refs`}
            />
            <RuntimeSelectionMetric
              label={packet.runtimeVisualEvidenceAttachmentSummary.claimBoundary}
              detail={`runtime ${String(packet.runtimeVisualEvidenceAttachmentSummary.runtimeExecutionAllowed)}; learner ${String(packet.runtimeVisualEvidenceAttachmentSummary.learnerLaunchAllowed)}; Quest ${String(packet.runtimeVisualEvidenceAttachmentSummary.questEvidenceRefreshAllowed)}`}
            />
          </fieldset>
        </>
      ) : null}
      {packet.runtimeVisualEvidenceAttachmentRecord ? (
        <>
          <Typography.Title level={5}>Runtime visual evidence attachment record</Typography.Title>
          <fieldset className="readiness-strip" aria-label="Runtime visual evidence attachment record metrics">
            <RuntimeSelectionMetric
              label={`${packet.runtimeVisualEvidenceAttachmentRecord.attachmentCount} metadata-only attachment refs`}
              detail={`${packet.runtimeVisualEvidenceAttachmentRecord.runtimeEvidenceAttachmentCount} runtime evidence refs; ${packet.runtimeVisualEvidenceAttachmentRecord.visualQaEvidenceAttachmentCount} visual QA refs`}
            />
            <RuntimeSelectionMetric
              label={packet.runtimeVisualEvidenceAttachmentRecord.claimBoundary}
              detail={`provider ${String(packet.runtimeVisualEvidenceAttachmentRecord.providerExecutionAllowed)}; runtime ${String(packet.runtimeVisualEvidenceAttachmentRecord.runtimeExecutionAllowed)}; learner ${String(packet.runtimeVisualEvidenceAttachmentRecord.learnerLaunchAllowed)}; Quest ${String(packet.runtimeVisualEvidenceAttachmentRecord.questEvidenceRefreshAllowed)}`}
            />
          </fieldset>
          <ul className="compact-list" aria-label="Runtime visual evidence attachment record details">
            {packet.runtimeVisualEvidenceAttachmentRecord.attachments.slice(0, 6).map((attachment) => (
              <li key={`${attachment.inputId}:${attachment.evidenceRef}:${attachment.attachedAt}`}>
                <Typography.Text>{`${attachment.inputId}: ${attachment.attachmentStatus}`}</Typography.Text>
                <Typography.Text type="secondary">
                  {`${attachment.actionId}; ${attachment.evidenceRef}; ${attachment.localArtifactPath}; ${packet.runtimeVisualEvidenceAttachmentRecord?.claimBoundary ?? "metadata_only_runtime_visual_evidence_attachment_refs_not_launch_evidence"}`}
                </Typography.Text>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {packet.runtimeVisualEvidenceAttachmentActionPacket ? (
        <>
          <Typography.Title level={5}>Runtime visual evidence attachment actions</Typography.Title>
          <fieldset className="readiness-strip" aria-label="Runtime visual evidence attachment action metrics">
            <RuntimeSelectionMetric
              label={packet.runtimeVisualEvidenceAttachmentActionPacket.claimBoundary}
              detail={`provider ${String(packet.runtimeVisualEvidenceAttachmentActionPacket.providerExecutionAllowed)}; runtime ${String(packet.runtimeVisualEvidenceAttachmentActionPacket.runtimeExecutionAllowed)}; learner ${String(packet.runtimeVisualEvidenceAttachmentActionPacket.learnerLaunchAllowed)}; Quest ${String(packet.runtimeVisualEvidenceAttachmentActionPacket.questEvidenceRefreshAllowed)}`}
            />
          </fieldset>
          <ul className="compact-list" aria-label="Runtime visual evidence attachment action details">
            {packet.runtimeVisualEvidenceAttachmentActionPacket.availableActions.map((action) => (
              <li key={action.actionId}>
                <Typography.Text>{`${action.actionId}: ${action.status}`}</Typography.Text>
                <Typography.Text type="secondary">
                  {`${action.requiredInputCount} inputs; reviewed ${action.reviewedMetadataOnlyCount}; held ${action.heldMetadataOnlyCount}; attached ${action.attachedEvidenceCount}; runtime ${String(action.runtimeExecutionAllowed)}; learner ${String(action.learnerLaunchAllowed)}; ${action.claimBoundary}`}
                </Typography.Text>
                {onSubmitRuntimeVisualEvidenceAttachment ? (
                  <Button
                    size="small"
                    loading={runtimeVisualEvidenceAttachmentSubmitStatus === "submitting"}
                    disabled={!canSubmitRuntimeVisualEvidenceAttachment(packet, action.actionId)}
                    onClick={() => {
                      const input = buildRuntimeVisualEvidenceAttachmentSubmitInput(packet, action.actionId);
                      if (input) {
                        void onSubmitRuntimeVisualEvidenceAttachment(input);
                      }
                    }}
                  >
                    {action.actionId === "attach_runtime_realism_evidence_refs"
                      ? "Submit metadata-only runtime evidence ref"
                      : "Submit metadata-only visual QA ref"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {runtimeVisualEvidenceAttachmentSubmitMessage ? (
            <Typography.Text type={runtimeVisualEvidenceAttachmentSubmitStatus === "error" ? "danger" : "secondary"}>
              {runtimeVisualEvidenceAttachmentSubmitMessage}
            </Typography.Text>
          ) : null}
        </>
      ) : null}
      {packet.runtimeEvidenceCaptureScaffold ? (
        <>
          <Typography.Title level={5}>Runtime evidence capture scaffold</Typography.Title>
          <fieldset className="readiness-strip" aria-label="Runtime evidence capture scaffold metrics">
            <RuntimeSelectionMetric
              label={`${packet.runtimeEvidenceCaptureScaffold.runtimeEvidenceCandidateCount} runtime candidates; ${packet.runtimeEvidenceCaptureScaffold.visualQaEvidenceCandidateCount} visual QA candidates`}
              detail={`${packet.runtimeEvidenceCaptureScaffold.submitRuntimeVisualEvidenceAttachmentInput.attachments.length} metadata-only submit candidates; ${packet.runtimeEvidenceCaptureScaffold.status}`}
            />
            <RuntimeSelectionMetric
              label={packet.runtimeEvidenceCaptureScaffold.claimBoundary}
              detail={`provider ${String(packet.runtimeEvidenceCaptureScaffold.gateBoundary.providerExecutionAllowed)}; runtime ${String(packet.runtimeEvidenceCaptureScaffold.gateBoundary.runtimeExecutionAllowed)}; learner ${String(packet.runtimeEvidenceCaptureScaffold.gateBoundary.learnerLaunchAllowed)}; Quest ${String(packet.runtimeEvidenceCaptureScaffold.gateBoundary.questEvidenceRefreshAllowed)}`}
            />
          </fieldset>
          <ul className="compact-list" aria-label="Runtime evidence capture scaffold candidate details">
            {packet.runtimeEvidenceCaptureScaffold.attachmentCandidates.slice(0, 6).map((candidate) => (
              <li key={`${candidate.inputId}:${candidate.evidenceRef}`}>
                <Typography.Text>{`${candidate.inputId}: ${candidate.actionId}`}</Typography.Text>
                <Typography.Text type="secondary">
                  {`${candidate.evidenceRef}; ${candidate.localArtifactPath}; ${candidate.claimBoundary}`}
                </Typography.Text>
              </li>
            ))}
          </ul>
          {onSubmitRuntimeVisualEvidenceAttachment ? (
            <Button
              size="small"
              loading={runtimeVisualEvidenceAttachmentSubmitStatus === "submitting"}
              disabled={!canSubmitRuntimeEvidenceCaptureScaffold(packet)}
              onClick={() => {
                if (packet.runtimeEvidenceCaptureScaffold) {
                  void onSubmitRuntimeVisualEvidenceAttachment(packet.runtimeEvidenceCaptureScaffold.submitRuntimeVisualEvidenceAttachmentInput);
                }
              }}
            >
              Submit metadata-only capture scaffold refs
            </Button>
          ) : null}
        </>
      ) : null}
      <fieldset className="readiness-strip" aria-label="Runtime selection review metrics">
        <RuntimeSelectionMetric label={packet.selectedScenarioId} detail={packet.selectedStationId} />
        <RuntimeSelectionMetric label={packet.selectedRuntimeAssetBundleId} detail={packet.reviewPacketMode} />
        <RuntimeSelectionMetric label={`model ${packet.runtimeCandidates.model}`} detail={`voice ${packet.runtimeCandidates.voice}`} />
        <RuntimeSelectionMetric label={packet.guardedRuntimeSelectorDecision.selectionStatus} detail={`${packet.blockers.length} blockers`} />
      </fieldset>
      <Typography.Title level={5}>Prepare local XR handoff</Typography.Title>
      <Typography.Paragraph type="secondary">
        This review-only link carries the selected scenario, encounter, station, and runtime bundle into the local XR surface for operator inspection. It does not clear evidence gates, launch a learner exam, execute providers, refresh Quest evidence, or make runtime-readiness claims.
      </Typography.Paragraph>
      <fieldset className="readiness-strip" aria-label="Prepare local XR handoff metrics">
        <RuntimeSelectionMetric label="local XR review URL" detail={localXrHandoffUrl} />
        <RuntimeSelectionMetric label="handoff carries" detail="scenario, encounter, station, runtime bundle, actor-realism capture mode" />
        <RuntimeSelectionMetric label="launch remains blocked" detail={packet.blockers.join(", ") || "no blockers listed"} />
        {packet.publicationPayloadLinkage?.actorEquipmentMaterializationGate ? (
          <RuntimeSelectionMetric
            label="actor/equipment materialization evidence required"
            detail={`${packet.publicationPayloadLinkage.actorEquipmentMaterializationGate.actorBlockers.length} actor blockers; ${packet.publicationPayloadLinkage.actorEquipmentMaterializationGate.equipmentBlockers.length} equipment blockers`}
          />
        ) : null}
      </fieldset>
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
      {packet.materializationInputManifestSummary ? (
        <>
          <Typography.Title level={5}>Worker materialization input summary</Typography.Title>
          <fieldset className="readiness-strip" aria-label="Worker materialization input summary metrics">
            <RuntimeSelectionMetric
              label={`${packet.materializationInputManifestSummary.actorWorkOrderInputCount} actor materialization inputs`}
              detail={`${packet.materializationInputManifestSummary.equipmentWorkOrderInputCount} equipment materialization inputs`}
            />
            <RuntimeSelectionMetric
              label={packet.materializationInputManifestSummary.claimBoundary}
              detail={`blockers ${packet.materializationInputManifestSummary.blockerIds.length}`}
            />
            <RuntimeSelectionMetric
              label="provider execution remains disabled"
              detail={`provider ${String(packet.materializationInputManifestSummary.providerExecutionPerformed)}; paid APIs ${String(packet.materializationInputManifestSummary.paidApisUsed)}; external network ${String(packet.materializationInputManifestSummary.externalNetworkUsed)}`}
            />
            <RuntimeSelectionMetric
              label="actor cue inputs"
              detail={packet.materializationInputManifestSummary.requiredActorCueIds.join(", ") || "none"}
            />
            <RuntimeSelectionMetric
              label="equipment cue inputs"
              detail={packet.materializationInputManifestSummary.requiredEquipmentCueIds.join(", ") || "none"}
            />
          </fieldset>
          <ul className="compact-list" aria-label="Worker materialization input blockers">
            {packet.materializationInputManifestSummary.blockerIds.slice(0, 8).map((blocker) => (
              <li key={blocker}>
                <Typography.Text type="secondary">{blocker}</Typography.Text>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {packet.materializationAttachmentPlanSummary ? (
        <>
          <Typography.Title level={5}>Worker materialization attachment plan</Typography.Title>
          <fieldset className="readiness-strip" aria-label="Worker materialization attachment plan metrics">
            <RuntimeSelectionMetric
              label={`${packet.materializationAttachmentPlanSummary.missingAttachmentCount} missing attachment slots`}
              detail={`${packet.materializationAttachmentPlanSummary.actorAttachmentSlotCount} actor slots; ${packet.materializationAttachmentPlanSummary.equipmentAttachmentSlotCount} equipment slots`}
            />
            <RuntimeSelectionMetric
              label={packet.materializationAttachmentPlanSummary.claimBoundary}
              detail={`blockers ${packet.materializationAttachmentPlanSummary.blockerIds.length}`}
            />
            <RuntimeSelectionMetric
              label="runtime selection remains blocked"
              detail={`provider ${String(packet.materializationAttachmentPlanSummary.providerExecutionPerformed)}; runtime ${String(packet.materializationAttachmentPlanSummary.runtimeSelectionAllowed)}; learner ${String(packet.materializationAttachmentPlanSummary.learnerLaunchAllowed)}; Quest ${String(packet.materializationAttachmentPlanSummary.questEvidenceRefreshAllowed)}`}
            />
            <RuntimeSelectionMetric
              label="actor attachment cues"
              detail={packet.materializationAttachmentPlanSummary.actorRequiredCueIds.join(", ") || "none"}
            />
            <RuntimeSelectionMetric
              label="equipment attachment cues"
              detail={packet.materializationAttachmentPlanSummary.equipmentRequiredCueIds.join(", ") || "none"}
            />
          </fieldset>
          <ul className="compact-list" aria-label="Worker materialization attachment blockers">
            {packet.materializationAttachmentPlanSummary.blockerIds.slice(0, 8).map((blocker) => (
              <li key={blocker}>
                <Typography.Text type="secondary">{blocker}</Typography.Text>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {packet.materializationEvidenceAttachmentSummary ? (
        <>
          <Typography.Title level={5}>Worker materialization evidence attachments</Typography.Title>
          <fieldset className="readiness-strip" aria-label="Worker materialization evidence attachment metrics">
            <RuntimeSelectionMetric
              label={`${packet.materializationEvidenceAttachmentSummary.attachedSlotCount}/${packet.materializationEvidenceAttachmentSummary.totalRequiredSlotCount} attachment slots satisfied`}
              detail={`${packet.materializationEvidenceAttachmentSummary.missingSlotCount} missing; ${packet.materializationEvidenceAttachmentSummary.heldOrInvalidAttachmentCount} held or invalid`}
            />
            <RuntimeSelectionMetric
              label={packet.materializationEvidenceAttachmentSummary.claimBoundary}
              detail={`blockers ${packet.materializationEvidenceAttachmentSummary.blockerIds.length}`}
            />
            <RuntimeSelectionMetric
              label="runtime selection remains blocked"
              detail={`all slots satisfied ${String(packet.materializationEvidenceAttachmentSummary.allRequiredSlotsSatisfied)}; runtime ${String(packet.materializationEvidenceAttachmentSummary.runtimeSelectionAllowed)}; learner ${String(packet.materializationEvidenceAttachmentSummary.learnerLaunchAllowed)}; Quest ${String(packet.materializationEvidenceAttachmentSummary.questEvidenceRefreshAllowed)}`}
            />
          </fieldset>
          <ul className="compact-list" aria-label="Worker materialization evidence attachment blockers">
            {packet.materializationEvidenceAttachmentSummary.blockerIds.slice(0, 8).map((blocker) => (
              <li key={blocker}>
                <Typography.Text type="secondary">{blocker}</Typography.Text>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {packet.materializationInputReviewDecisionRecord ? (
        <>
          <Typography.Title level={5}>Worker materialization input review decisions</Typography.Title>
          <fieldset className="readiness-strip" aria-label="Worker materialization input review decision metrics">
            <RuntimeSelectionMetric
              label={`${packet.materializationInputReviewDecisionRecord.decisionCount} materialization input decisions`}
              detail={`reviewed ${packet.materializationInputReviewDecisionRecord.reviewedDecisionCount}; held ${packet.materializationInputReviewDecisionRecord.heldDecisionCount}`}
            />
            <RuntimeSelectionMetric
              label={packet.materializationInputReviewDecisionRecord.claimBoundary}
              detail={`request ${packet.materializationInputReviewDecisionRecord.requestId}`}
            />
            <RuntimeSelectionMetric
              label="runtime selection remains blocked until evidence attaches"
              detail={`provider ${String(packet.materializationInputReviewDecisionRecord.providerExecutionAllowed)}; runtime ${String(packet.materializationInputReviewDecisionRecord.runtimeExecutionAllowed)}; learner ${String(packet.materializationInputReviewDecisionRecord.learnerLaunchAllowed)}; Quest ${String(packet.materializationInputReviewDecisionRecord.questEvidenceRefreshAllowed)}`}
            />
          </fieldset>
          <ul className="compact-list" aria-label="Worker materialization input review decision details">
            {packet.materializationInputReviewDecisionRecord.decisions.map((decision) => (
              <li key={`${decision.actionId}:${decision.reviewedAt}`}>
                <Typography.Text>{`${decision.actionId}: ${decision.decision}`}</Typography.Text>
                <Typography.Text type="secondary">{decision.comments}</Typography.Text>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {packet.publicationPayloadLinkage ? (
        <>
          <Typography.Title level={5}>Publication materialization gate</Typography.Title>
          <fieldset className="readiness-strip" aria-label="Publication materialization metrics">
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
            {packet.pedsActiveEmotionDemo ? (
              <RuntimeSelectionMetric label="peds active emotion demo (from case machine)" detail={packet.pedsActiveEmotionDemo} />
            ) : null}
            {packet.pedsDialogueCueIdsDemo ? (
              <RuntimeSelectionMetric label="peds dialogue cue ids demo (from case policy)" detail={packet.pedsDialogueCueIdsDemo.join(", ")} />
            ) : null}
            {packet.publicationPayloadLinkage.realismEvidenceRefs ? (
              <RuntimeSelectionMetric
                label="realism evidence refs"
                detail={`${packet.publicationPayloadLinkage.realismEvidenceRefs.refIds.join(", ")}; runtime hooks ${packet.publicationPayloadLinkage.realismEvidenceRefs.runtimeRealismEvidenceHookCount ?? 0}; visual QA hooks ${packet.publicationPayloadLinkage.realismEvidenceRefs.visualQaEvidenceHookCount ?? 0}; ${packet.publicationPayloadLinkage.realismEvidenceRefs.claimBoundary}`}
              />
            ) : null}
            {packet.publicationPayloadLinkage.pedsHumanoidMaterializationHandoff && packet.selectedScenarioId === "peds_asthma_parent_anxiety_v1" ? (
              <div style={{ marginTop: 8, fontSize: 12 }}>
                <Typography.Text strong>Peds humanoid materialization handoff (from asset worker, metadata for review/replay only)</Typography.Text>
                <ul style={{ margin: "2px 0 0 12px", padding: 0 }}>
                  {packet.publicationPayloadLinkage.pedsHumanoidMaterializationHandoff.assets?.map((a: { actorRole: string; runtimeAssetPath?: string; assetPath?: string; provenanceManifestPath?: string }) => (
                    <li key={a.actorRole}>{a.actorRole}: {a.runtimeAssetPath || a.assetPath} (B, claims=false, {a.provenanceManifestPath})</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </fieldset>
          <ul className="compact-list" aria-label="Publication materialization blockers">
            {[...packet.publicationPayloadLinkage.blockers, ...packet.publicationPayloadLinkage.assetNeedsReadiness.blockers].map((blocker) => (
              <li key={blocker}>
                <Typography.Text type="secondary">{blocker}</Typography.Text>
              </li>
            ))}
          </ul>
          {packet.publicationPayloadLinkage.actorEquipmentMaterializationGate ? (
            <>
              <Typography.Title level={5}>Actor/equipment materialization gate</Typography.Title>
              <fieldset className="readiness-strip" aria-label="Actor equipment materialization metrics">
                <RuntimeSelectionMetric
                  label={packet.publicationPayloadLinkage.actorEquipmentMaterializationGate.claimBoundary}
                  detail={`runtime selection blocked: ${String(packet.publicationPayloadLinkage.actorEquipmentMaterializationGate.runtimeSelectionBlockedUntilEvidenceAttached)}`}
                />
                <RuntimeSelectionMetric
                  label="actor materialization blockers"
                  detail={packet.publicationPayloadLinkage.actorEquipmentMaterializationGate.actorBlockers.join(", ") || "none"}
                />
                <RuntimeSelectionMetric
                  label="equipment materialization blockers"
                  detail={packet.publicationPayloadLinkage.actorEquipmentMaterializationGate.equipmentBlockers.join(", ") || "none"}
                />
              </fieldset>
              <ul className="compact-list" aria-label="Actor equipment materialization caveats">
                {[
                  ...packet.publicationPayloadLinkage.actorEquipmentMaterializationGate.caveats,
                  ...packet.publicationPayloadLinkage.actorEquipmentMaterializationGate.recommendedNextActions,
                ].map((item) => (
                  <li key={item}>
                    <Typography.Text type="secondary">{item}</Typography.Text>
                  </li>
                ))}
              </ul>
              {packet.publicationPayloadLinkage.actorEquipmentMaterializationGate.remainingRuntimeBlockerReasons ? (
                <>
                  <fieldset className="readiness-strip" aria-label="Remaining runtime blocker review metrics">
                    <RuntimeSelectionMetric
                      label={packet.publicationPayloadLinkage.actorEquipmentMaterializationGate.remainingRuntimeBlockerReasons.claimBoundary}
                      detail={`materialization complete ${String(packet.publicationPayloadLinkage.actorEquipmentMaterializationGate.remainingRuntimeBlockerReasons.materializationEvidenceComplete)}; runtime ${String(packet.publicationPayloadLinkage.actorEquipmentMaterializationGate.remainingRuntimeBlockerReasons.runtimeSelectionAllowed)}; learner ${String(packet.publicationPayloadLinkage.actorEquipmentMaterializationGate.remainingRuntimeBlockerReasons.learnerLaunchAllowed)}; Quest ${String(packet.publicationPayloadLinkage.actorEquipmentMaterializationGate.remainingRuntimeBlockerReasons.questEvidenceRefreshAllowed)}`}
                    />
                  </fieldset>
                  <ul className="compact-list" aria-label="Remaining runtime blocker review reasons">
                    {packet.publicationPayloadLinkage.actorEquipmentMaterializationGate.remainingRuntimeBlockerReasons.categories.map((category) => (
                      <li key={category.category}>
                        <Typography.Text>{`${category.category}: ${category.blockerIds.join(", ")}`}</Typography.Text>
                        <Typography.Text type="secondary">{category.recommendedNextAction}</Typography.Text>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          ) : null}
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

function canSubmitRuntimeVisualEvidenceAttachment(
  packet: AdminRuntimeSelectionReviewPacket,
  actionId: RuntimeVisualEvidenceAttachment["actionId"],
): boolean {
  return Boolean(buildRuntimeVisualEvidenceAttachmentSubmitInput(packet, actionId));
}

function canSubmitRuntimeEvidenceCaptureScaffold(packet: AdminRuntimeSelectionReviewPacket): boolean {
  return Boolean(
    packet.runtimeEvidenceCaptureScaffold
      && packet.runtimeEvidenceCaptureScaffold.selectedScenarioId === packet.selectedScenarioId
      && packet.runtimeEvidenceCaptureScaffold.submitRuntimeVisualEvidenceAttachmentInput.attachments.length > 0,
  );
}

function buildRuntimeVisualEvidenceAttachmentSubmitInput(
  packet: AdminRuntimeSelectionReviewPacket,
  actionId: RuntimeVisualEvidenceAttachment["actionId"],
): SubmitRuntimeVisualEvidenceAttachmentInput | undefined {
  const inputKind = actionId === "attach_runtime_realism_evidence_refs" ? "runtime_realism_signal_input" : "visual_qa_review_input";
  const decision = packet.runtimeRealismEvidenceInputReviewDecisionRecord?.decisions.find((candidate) =>
    candidate.decision === "reviewed_metadata_only" && candidate.inputKind === inputKind
  );
  if (!decision) return undefined;
  const evidenceRef = decision.evidenceRefs[0] ?? `metadata-only-runtime-visual-evidence-ref:${decision.inputId}`;
  return {
    scenarioId: packet.selectedScenarioId,
    attachments: [
      {
        actionId,
        inputId: decision.inputId,
        inputKind,
        evidenceRef,
        localArtifactPath: `metadata-only-admin-review/${sanitizeAttachmentPathSegment(decision.inputId)}.json`,
        reviewerId: "admin_runtime_visual_evidence_reviewer",
        attachmentStatus: "attached_metadata_only",
        comments: "Admin reviewer attached a metadata-only evidence ref; this does not clear runtime, learner, Quest, production, clinical, or scoring gates.",
        attachedAt: new Date().toISOString(),
      },
    ],
  };
}

function sanitizeAttachmentPathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_");
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
