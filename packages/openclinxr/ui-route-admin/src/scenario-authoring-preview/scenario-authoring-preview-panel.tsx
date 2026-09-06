import {
  type AuthoringPreviewResult,
  previewAuthoringRevision,
  STALE_REVIEW_IDENTITY_REFUSAL,
} from "@openclinxr/ui-route-admin";
import { Alert, Button, List, Space, Tag, Typography } from "antd";
import { type ReactElement, useMemo } from "react";

export type ScenarioAuthoringPreviewPanelProps = {
  draft: unknown;
  approved?: unknown;
  reviewIdentity?: string | null;
  onPromote?: () => void;
  preview?: AuthoringPreviewResult;
};

const SURFACE_LABEL: Record<AuthoringPreviewResult["changes"][number]["surface"], string> = {
  actor: "Actor",
  dialogue: "Dialogue",
  emotion: "Emotion",
  asset: "Asset",
};

export function ScenarioAuthoringPreviewPanel({
  draft,
  approved,
  reviewIdentity = null,
  onPromote,
  preview: injected,
}: ScenarioAuthoringPreviewPanelProps): ReactElement {
  const preview = useMemo(
    () => injected ?? previewAuthoringRevision({ draft, approved, reviewIdentity }),
    [injected, draft, approved, reviewIdentity],
  );
  const promotionAllowed = preview.promotion.allowed;
  const reasons = preview.promotion.allowed ? [] : preview.promotion.reasons;

  return (
    <section aria-label="Authoring preview">
      <Typography.Title level={3}>Authoring preview</Typography.Title>
      <Typography.Paragraph>
        Compiles this draft through production encounter contracts and shows the exact
        actor, dialogue, emotion, and asset delta versus the currently approved revision.
      </Typography.Paragraph>
      <Space wrap>
        {preview.notEvidenceFor.map((flag) => (
          <Tag key={flag}>{flag}</Tag>
        ))}
      </Space>
      {!preview.validationOk ? (
        <Alert
          type="error"
          showIcon
          message="Draft failed production encounter-contract validation"
          description={preview.validationErrors.join(" ")}
        />
      ) : null}
      {reasons.includes(STALE_REVIEW_IDENTITY_REFUSAL) ? (
        <Alert type="warning" showIcon message={STALE_REVIEW_IDENTITY_REFUSAL} />
      ) : null}
      <List
        aria-label="Reviewed runtime delta"
        locale={{ emptyText: "No actor, dialogue, emotion, or asset changes versus the approved revision." }}
        dataSource={[...preview.changes]}
        renderItem={(change) => (
          <List.Item>
            <Space direction="vertical" size={0}>
              <Typography.Text>
                <Tag>{SURFACE_LABEL[change.surface]}</Tag>
                {change.change} {change.path}
              </Typography.Text>
              {change.before ? (
                <Typography.Text type="secondary">before: {change.before}</Typography.Text>
              ) : null}
              {change.after ? <Typography.Text>after: {change.after}</Typography.Text> : null}
            </Space>
          </List.Item>
        )}
      />
      <Button
        type="primary"
        disabled={!promotionAllowed}
        onClick={() => {
          if (promotionAllowed) {
            onPromote?.();
          }
        }}
      >
        Promote scenario
      </Button>
    </section>
  );
}
