/**
 * Queue review snapshot history panel (#57 / #88).
 * Extracted from App.tsx so the admin shell stays under the shrink-only size freeze.
 * Shows which runs assembled from fixtures when the learner API was unreachable, and
 * per-station body provenance (api authored vs bank residual) when recorded.
 */
import { Tag, Typography } from "antd";
import type { AdminStationRunQueueSnapshot } from "./api-client-types.js";

export type QueueReviewSnapshotHistoryProps = {
  snapshots: readonly AdminStationRunQueueSnapshot[];
};

type SnapshotAcquisitionMarkers = AdminStationRunQueueSnapshot & {
  fallbackActive?: boolean;
  scenarioSource?: string;
  stationBodySources?: Array<{ scenarioId: string; bodySource: string }>;
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
                {bodySourceTags(snapshot).map((tag) => (
                  <Tag key={tag.key} color={tag.color}>
                    {tag.label}
                  </Tag>
                ))}
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
  const markers = snapshot as SnapshotAcquisitionMarkers;
  return markers.fallbackActive === true || markers.scenarioSource === "fixture_fallback";
}

/**
 * #88 — render per-station body provenance when the learner recorded it.
 * Counts (not a single set-level scenarioSource) so mixed authored/residual queues stay honest.
 */
function bodySourceTags(snapshot: AdminStationRunQueueSnapshot): Array<{ key: string; label: string; color: string }> {
  const markers = snapshot as SnapshotAcquisitionMarkers;
  const sources = markers.stationBodySources;
  if (!Array.isArray(sources) || sources.length === 0) {
    return [];
  }
  let apiAuthored = 0;
  let bankResidual = 0;
  for (const entry of sources) {
    if (entry?.bodySource === "api_authored") apiAuthored += 1;
    else if (entry?.bodySource === "bank_residual") bankResidual += 1;
  }
  const tags: Array<{ key: string; label: string; color: string }> = [];
  if (apiAuthored > 0) {
    tags.push({
      key: "api_authored",
      label: apiAuthored === 1 ? "api authored" : `api authored (${apiAuthored})`,
      color: "blue",
    });
  }
  if (bankResidual > 0) {
    tags.push({
      key: "bank_residual",
      label: bankResidual === 1 ? "bank residual" : `bank residual (${bankResidual})`,
      color: "default",
    });
  }
  return tags;
}
