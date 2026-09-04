import { Alert, Button, Tag, Typography } from "antd";
import { type ReactElement, useMemo } from "react";
import {
  collectFacultyEncounterBundleAttestations,
  collectFacultyEncounterBundleSelectionBlockers,
  type FacultyEncounterBundlePromotionSelection,
  type FacultyLearnerLaunchIdentity,
} from "./faculty-encounter-bundle-promotion.js";

export type EncounterBundlePromotionPanelProps = {
  selection: FacultyEncounterBundlePromotionSelection;
  previewBlockers?: readonly string[];
  previewAttestations?: readonly string[];
  submitStatus?: "idle" | "submitting" | "submitted" | "error";
  submitMessage?: string | undefined;
  launchIdentity?: FacultyLearnerLaunchIdentity | null;
  onPromote?: (selection: FacultyEncounterBundlePromotionSelection) => void | Promise<void>;
};

export function EncounterBundlePromotionPanel({
  selection,
  previewBlockers = [],
  previewAttestations = [],
  submitStatus = "idle",
  submitMessage,
  launchIdentity = null,
  onPromote,
}: EncounterBundlePromotionPanelProps): ReactElement {
  const blockers = useMemo(
    () => [...new Set([
      ...collectFacultyEncounterBundleSelectionBlockers(selection),
      ...previewBlockers,
    ])],
    [selection, previewBlockers],
  );
  const attestations = useMemo(
    () => [...new Set([
      ...collectFacultyEncounterBundleAttestations(selection),
      ...previewAttestations,
    ])],
    [selection, previewAttestations],
  );
  const canPromote = blockers.length === 0 && submitStatus !== "submitting";

  return (
    <section className="workbench-panel" aria-label="Encounter bundle promotion">
      <div className="station-queue-row">
        <Typography.Title level={4}>Encounter bundle promotion</Typography.Title>
        <Tag color="gold">Faculty local promotion; no automatic approval</Tag>
      </div>
      <Typography.Paragraph>
        Selects one reviewed scenario and its factory outputs, shows every blocking review and
        provenance attestation, and submits one atomic promotion. The learner launch link carries
        only the opaque bundle identity.
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        {`Scenario ${selection.scenarioId || "(none)"}; station ${selection.stationId || "(none)"}; review identity ${selection.scenarioReviewIdentity || "(none)"}.`}
      </Typography.Paragraph>
      <ul className="compact-list" aria-label="Factory output selection">
        {selection.members.map((member) => (
          <li key={`${member.memberKind}:${member.assetId}`}>
            <Typography.Text>{`${member.memberKind}: ${member.assetId}`}</Typography.Text>
            <Typography.Text type="secondary">
              {`${member.pipelineState}; ${member.reviewStatus}; hash ${member.contentHash || "(missing)"}`}
            </Typography.Text>
          </li>
        ))}
      </ul>
      <Typography.Title level={5}>Blocking review and provenance attestations</Typography.Title>
      {blockers.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          title="Promotion refused until the selection is complete, fresh, and fully attested"
        />
      ) : null}
      <ul className="compact-list" aria-label="Promotion blockers">
        {blockers.length === 0 ? (
          <li>
            <Typography.Text type="secondary">No blocking attestations</Typography.Text>
          </li>
        ) : blockers.map((blocker) => (
          <li key={blocker}>
            <Typography.Text type="secondary">{blocker}</Typography.Text>
          </li>
        ))}
      </ul>
      <ul className="compact-list" aria-label="Review and provenance attestations">
        {attestations.map((row) => (
          <li key={row}>
            <Typography.Text type="secondary">{row}</Typography.Text>
          </li>
        ))}
      </ul>
      <Button
        type="primary"
        disabled={!canPromote}
        loading={submitStatus === "submitting"}
        onClick={() => {
          if (canPromote) {
            void onPromote?.(selection);
          }
        }}
      >
        Promote encounter bundle
      </Button>
      {submitStatus === "error" && submitMessage ? (
        <Alert type="error" showIcon title={submitMessage} />
      ) : null}
      {launchIdentity ? (
        <p>
          <a aria-label="Learner launch identity" href={launchIdentity.href}>
            {launchIdentity.bundleId}
          </a>
        </p>
      ) : null}
    </section>
  );
}
