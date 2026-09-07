import { createRouteManifest, findRouteByPath } from "@openclinxr/ui-route-shared";

export const adminWorkbenchRoutes = createRouteManifest([
  {
    id: "case-authoring",
    path: "/authoring",
    label: "Case Authoring",
    description: "Create and edit encounter cases that drive the factory; export scenario-bank JSON.",
    capabilityTags: ["Ant Design 6", "ScenarioSchema"],
  },
  {
    id: "scenario-bank",
    path: "/scenarios",
    label: "Scenario Bank",
    description: "Author, validate, and review case-bank scenarios before publication.",
    capabilityTags: ["GraphQL Codegen", "Apollo Client"],
  },
  {
    id: "review-packet-replay",
    path: "/reviews",
    label: "Review Replay",
    description: "Inspect trace replay, actor responses, scoring evidence, and reviewer findings.",
    capabilityTags: ["OpenTelemetry", "Serenity/JS"],
  },
  {
    id: "exam-form-workbench",
    path: "/exam-forms",
    label: "Exam Forms",
    description: "Assemble locked station sequences from approved scenarios and coverage targets.",
    capabilityTags: ["Psychometric Review", "MongoDB"],
  },
]);

export const adminPublicationGates = Object.freeze([
  "Clinical review",
  "Psychometric review",
  "Legal review",
  "Simulation QA",
]);

export function findAdminWorkbenchRoute(path: string) {
  return findRouteByPath(adminWorkbenchRoutes, path);
}

export {
  authoredContentIdentity,
  AUTHORING_PREVIEW_NOT_EVIDENCE_FOR,
  evaluateScenarioPromotion,
  previewAuthoringRevision,
  STALE_REVIEW_IDENTITY_REFUSAL,
  STALE_VALIDATION_REFUSAL,
  type AuthoringPreviewChange,
  type AuthoringPreviewResult,
  type PromotionDecision,
} from "./scenario-authoring-preview/preview-authoring-revision.js";

export { ActorPhenotypeFields, type ActorPhenotypeFieldsProps } from "./actor-phenotype-fields.js";
export { ActorTouchResponseFields, type ActorTouchResponseFieldsProps } from "./actor-touch-response-fields.js";
export { AssetNeedsPanel } from "./asset-needs-panel.js";
export * from "./admin-review-types.js";
export { CaseAuthoringWorkbench, type CaseAuthoringApiClient, type CaseAuthoringWorkbenchProps } from "./case-authoring-workbench.js";
export * from "./case-authoring-model.js";
export * from "./case-authoring-io.js";
export {
  DialogueSeedAuthoringPanel,
  previewAuthoredDialogueCatalog,
  validateAuthoredDialoguePreviewResponse,
  type AuthoredDialogueSeedDraft,
  type DialogueCatalogPreviewOptions,
  type DialogueFetchLike,
  type DialogueSeedPublicationGate,
  type FrozenActorTurnPlanPreview,
} from "./dialogue-seed-authoring-panel.js";
export { EmotionPolicyPanel } from "./emotion-policy-panel.js";
export { EncounterEnvironmentPanel, type EncounterEnvironmentPanelProps } from "./encounter-environment-panel.js";
export {
  EnvironmentGenerationQueuePanel,
  type EnvironmentGenerationQueuePanelProps,
  type PlacementAuthorRow,
  type PlacementAuthorValue,
} from "./environment-generation-queue-panel.js";
export { EquipmentPanel } from "./equipment-panel.js";
export {
  FacultyAdjudicationWorkspace,
  fetchAssembledExamReviewPacket,
  assembledExamReviewPacketPath,
  ADMIN_ASSEMBLED_EXAM_REVIEW_PACKET_PATH,
  type FacultyAdjudicationWorkspaceProps,
  type AdminAssembledExamReviewPacket,
} from "./faculty-adjudication-workspace.js";
export * from "./faculty-compile-lock.js";
export * from "./faculty-compile-lock-types.js";
export { FacultyReviewDecisionPanel, type FacultyReviewDecisionPanelProps } from "./faculty-review-decision-panel.js";
export { QueueReviewSnapshotHistory, type QueueReviewSnapshotHistoryProps } from "./queue-review-snapshot-history.js";
export {
  ReviewReplayReadinessSummaryPanel,
  type ReviewReplayReadinessSummaryPanelProps,
} from "./review-replay-readiness-summary-panel.js";
export { ReviewReplaySafetyPanel, type ReviewReplaySafetyPanelProps } from "./review-replay-safety-panel.js";
export {
  RuntimeSelectionReviewPacketPanel,
  type RuntimeSelectionReviewPacketPanelProps,
} from "./runtime-selection-review-packet-panel.js";
export { ScenarioAuthoringWorkspace, type ScenarioAuthoringWorkspaceProps } from "./scenario-authoring-workspace.js";
export {
  ScenarioBankMaturityPanel,
  formatMinutes,
  formatStationQueueBlocker,
  reviewGateColor,
  scenarioReviewGateEntries,
  scenarioStatusColor,
  type ScenarioBankMaturityPanelProps,
} from "./scenario-bank-maturity-panel.js";
export { ScenarioReviewGatePanel, type ScenarioReviewGatePanelProps } from "./scenario-review-gate-panel.js";
export * from "./scenario-review-gate-constants.js";
export { SeedExamReadinessBoundaryPanel, type SeedExamReadinessBoundaryPanelProps } from "./seed-exam-readiness-boundary-panel.js";
export * from "./seed-worldview-queue.js";
export * from "./status-view-model.js";
export * from "./environment-queue-readiness-summaries.js";
export { LiveAuthoringPreview } from "./scenario-authoring-preview/live-authoring-preview.js";
export { ScenarioAuthoringPreviewPanel } from "./scenario-authoring-preview/scenario-authoring-preview-panel.js";
export * from "./encounter-bundle-promotion/index.js";
export { ReviewReplayWorkbenchProvider, ReviewReplayWorkbenchUI, useReviewReplayWorkbenchContext } from "./review-replay-workbench.js";
export { ScenarioBankWorkbenchProvider, ScenarioBankWorkbenchUI, useScenarioBankWorkbenchContext } from "./scenario-bank-workbench.js";
export { ScenarioDetailWorkbenchProvider, ScenarioDetailWorkbenchUI, useScenarioDetailWorkbenchContext } from "./scenario-detail-workbench.js";
export { clampedScoreFromInput } from "./validators.js";
export { formatDuration, pluralize, uniqueValues, formatActorCommunicationProfileCoverage, formatScenarioGovernanceNotice, countActorCommunicationProfiles, capabilityTagColor } from "./formatters.js";
export { ReadinessMetric } from "./status-view-model.js";
