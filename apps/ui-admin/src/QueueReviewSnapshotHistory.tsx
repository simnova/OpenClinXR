/**
 * Queue review snapshot history panel (#57).
 * Extracted from App.tsx so the admin shell stays under the shrink-only size freeze.
 * Shows which runs assembled from fixtures when the learner API was unreachable.
 */
import { Tag, Typography } from "antd";
import type { AdminStationRunQueueSnapshot } from "./api-client-types.js";

export type QueueReviewSnapshotHistoryProps = {
  snapshots: readonly AdminStationRunQueueSnapshot[];
};

export function QueueReviewSnapshotHistory({ snapshots }: QueueReviewSnapshotHistoryProps) {
  return (
    <section className="workbench-panel" aria-label="Queue review snapshot history">
      <Typography.Title level={4}>Review Snapshots</Typography.Title>
      <Typography.Text>{`${snapshots.length} saved reviewer snapshot${snapshots.length === 1 ? "" : "s"}`}</Typography.Text>
      {snapshots.length === 0 ? (
        <Typography.Paragraph className="empty-panel-note">No review snapshots yet.</Typography.Paragraph>
      ) : (
        <ol className="queue-snapshot-list">
          {snapshots.map((snapshot) => (
            <li key={snapshot.snapshotId}>
              <div className="station-queue-row">
                <Typography.Text strong>{snapshot.snapshotId}</Typography.Text>
                <Tag color={snapshot.queue.canStartLearnerExam ? "green" : "gold"}>
                  {snapshot.queue.canStartLearnerExam ? "launch ready" : "blocked"}
                </Tag>
                {snapshotFellBackToFixtures(snapshot) ? <Tag color="orange">fixture fallback</Tag> : null}
              </div>
              <Typography.Text>{snapshot.reviewerId ?? "unassigned reviewer"}</Typography.Text>
              <Typography.Text type="secondary">{formatSnapshotQueueSummary(snapshot)}</Typography.Text>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function formatSnapshotQueueSummary(snapshot: AdminStationRunQueueSnapshot): string {
  const blocked =
    snapshot.queue.summary.draftBlocked + snapshot.queue.summary.governanceBlocked + snapshot.queue.summary.missingScenario;
  return `${snapshot.queue.summary.activationReady} activation-ready / ${blocked} blocked`;
}

/** #57 — optional fields until GraphQL schema codegen; not stuffed into reviewerId. */
function snapshotFellBackToFixtures(snapshot: AdminStationRunQueueSnapshot): boolean {
  const markers = snapshot as AdminStationRunQueueSnapshot & {
    fallbackActive?: boolean;
    scenarioSource?: string;
  };
  return markers.fallbackActive === true || markers.scenarioSource === "fixture_fallback";
}
