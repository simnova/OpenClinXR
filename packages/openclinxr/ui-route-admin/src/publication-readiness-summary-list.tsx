import { Typography } from "antd";
import type { ReactElement } from "react";
import type { ScenarioSceneGenerationRequestPublicationReadiness } from "./admin-review-types.js";
import {
  summarizeAssetReleaseLadderReplayProjection,
  summarizeDynamicBehaviorCoverage,
  summarizeEncounterFactoryDryRun,
  summarizeEncounterFactoryInputPlanning,
  summarizeHumanoidMetadataBlockers,
  summarizeHumanoidRealismProfiles,
  summarizeHumanReviewActions,
  summarizeMaterializationEvidenceAttachments,
  summarizeMaterializationInputManifest,
  summarizeMaterializationInputReviewActions,
  summarizeMaterializationInputReviewDecisionRecord,
  summarizePedsGeneratedPlayerAndEmotion,
  summarizePublicationMetadata,
  summarizeRuntimeBundleAssemblyAudit,
  summarizeRuntimeBundleGateRefs,
  summarizeRuntimeEvidenceCaptureScaffold,
  summarizeRuntimeRealismEvidenceInputReviewDecisionRecord,
  summarizeRuntimeVisualEvidenceAttachmentActions,
  summarizeRuntimeVisualEvidenceAttachmentRecord,
  summarizeRuntimeVisualEvidenceAttachmentSummary,
  summarizeScenarioReviewGate,
} from "./environment-queue-readiness-summaries.js";

/**
 * The single-argument `summarize*(sceneGenerationPublicationReadiness)` lines from the
 * "Publication gate" block: extracted from environment-generation-queue-panel.tsx rather than
 * left inline. 21 near-identical `<Typography.Text type="secondary">{summarizeX(...)}</Typography.Text>`
 * lines were most of what pushed that file over its frozen 575-line ceiling when the WCG
 * typed-port "connect nodes" row landed; file-size-budgets.ts says "freeze ceilings may only
 * shrink — split the file; do NOT raise the ceiling" (same reasoning `placement-authoring-row.tsx`
 * and `connect-nodes-row.tsx` were split out for). Rendered order and text content are unchanged —
 * this is a mechanical extraction, not a behavior change.
 *
 * `summarizeEvidenceGateRefs` (takes `.evidenceGateRefs`, not the whole readiness object) stays
 * inline in the panel: it does not fit this uniform single-argument shape.
 */
const SUMMARIZERS: ReadonlyArray<(readiness: ScenarioSceneGenerationRequestPublicationReadiness) => string> = [
  summarizeScenarioReviewGate,
  summarizeRuntimeBundleGateRefs,
  summarizeRuntimeBundleAssemblyAudit,
  summarizePublicationMetadata,
  summarizeHumanoidRealismProfiles,
  summarizeHumanoidMetadataBlockers,
  summarizeHumanReviewActions,
  summarizeDynamicBehaviorCoverage,
  summarizeEncounterFactoryInputPlanning,
  summarizeMaterializationInputManifest,
  summarizeMaterializationEvidenceAttachments,
  summarizeMaterializationInputReviewActions,
  summarizeMaterializationInputReviewDecisionRecord,
  summarizeRuntimeRealismEvidenceInputReviewDecisionRecord,
  summarizeRuntimeVisualEvidenceAttachmentSummary,
  summarizeRuntimeVisualEvidenceAttachmentRecord,
  summarizeAssetReleaseLadderReplayProjection,
  summarizeRuntimeVisualEvidenceAttachmentActions,
  summarizeRuntimeEvidenceCaptureScaffold,
  summarizePedsGeneratedPlayerAndEmotion,
  summarizeEncounterFactoryDryRun,
];

export function PublicationReadinessSummaryList({
  sceneGenerationPublicationReadiness,
}: {
  sceneGenerationPublicationReadiness: ScenarioSceneGenerationRequestPublicationReadiness;
}): ReactElement {
  return (
    <>
      {SUMMARIZERS.map((summarize) => (
        <Typography.Text type="secondary" key={summarize.name}>
          {summarize(sceneGenerationPublicationReadiness)}
        </Typography.Text>
      ))}
    </>
  );
}
