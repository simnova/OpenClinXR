import type { CreateScenarioSceneGenerationRequestResult } from "./admin-review-types.js";
import { Typography } from "antd";
import type { ReactElement } from "react";

const sceneGenerationRequestReviewStatusColors: Record<CreateScenarioSceneGenerationRequestResult["reviewStatus"], string> = {
  pending_runtime_asset_review: "gold",
  runtime_asset_review_attached: "blue",
};

const sceneGenerationRequestProjectionArtifactStatusLabels: Record<CreateScenarioSceneGenerationRequestResult["reviewStatus"], string> = {
  pending_runtime_asset_review: "projection artifact review pending",
  runtime_asset_review_attached: "projection artifact review attached",
};

export function sceneGenerationRequestReviewStatusColor(
  reviewStatus: CreateScenarioSceneGenerationRequestResult["reviewStatus"],
): string {
  return sceneGenerationRequestReviewStatusColors[reviewStatus];
}

export function sceneGenerationRequestProjectionArtifactStatusColor(
  reviewStatus: CreateScenarioSceneGenerationRequestResult["reviewStatus"],
): string {
  return sceneGenerationRequestReviewStatusColors[reviewStatus];
}

export function sceneGenerationRequestProjectionArtifactStatusLabel(
  reviewStatus: CreateScenarioSceneGenerationRequestResult["reviewStatus"],
): string {
  return sceneGenerationRequestProjectionArtifactStatusLabels[reviewStatus];
}

export function ReadinessMetric({ label, detail }: { label: string; detail: string }): ReactElement {
  return (
    <div className="readiness-metric">
      <Typography.Text strong>{label}</Typography.Text>
      <Typography.Text type="secondary">{detail}</Typography.Text>
    </div>
  );
}
