import { Tag, Typography } from "antd";
import type { ReactElement } from "react";
import type { AdminReviewPacketReplay } from "./api-client.js";

type ReviewPacket = NonNullable<AdminReviewPacketReplay["reviewPacket"]>;

export type ReviewReplaySafetyPanelProps = {
  packet: ReviewPacket;
  clinicalEventReviewSummary: AdminReviewPacketReplay["clinicalEventReviewSummary"];
  traceEventCount: number;
  safetyFlagLabels: readonly string[];
};

export function ReviewReplaySafetyPanel({
  packet,
  clinicalEventReviewSummary,
  traceEventCount,
  safetyFlagLabels,
}: ReviewReplaySafetyPanelProps): ReactElement {
  const needsFacultyChanges = packet.missingRequiredTraceTags.length > 0
    || packet.lateTraceTags.length > 0
    || safetyFlagLabels.length > 0
    || !clinicalEventReviewSummary.safeForFacultyReview;
  const durableStatusCounts = formatCountMap(clinicalEventReviewSummary.statusCounts);

  return (
    <section className="workbench-panel" aria-label="Review-safe evidence boundary">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Completed-station evidence boundary</Typography.Text>
          <Typography.Title level={4}>Review-Safe Evidence Boundary</Typography.Title>
        </div>
        <Tag color={needsFacultyChanges ? "gold" : "green"}>
          {needsFacultyChanges ? "Faculty changes recommended" : "Faculty review ready"}
        </Tag>
      </div>
      <Typography.Paragraph>
        Faculty can use this completed-station replay for local review, debrief preparation, and scenario iteration, while the admin surface shows summaries and trace metadata only.
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        Private clinical-event payloads stay out of the replay UI; durable events appear as redacted summary counts and trace links.
      </Typography.Paragraph>
      <div className="readiness-strip review-replay-strip">
        <ReviewSafetyMetric label={`${packet.timeline.length} timeline ${pluralize(packet.timeline.length, "entry")}`} detail={`${traceEventCount} trace metadata events`} />
        <ReviewSafetyMetric
          label={`${clinicalEventReviewSummary.eventCount} durable clinical ${pluralize(clinicalEventReviewSummary.eventCount, "event")}`}
          detail={`${clinicalEventReviewSummary.redactedEventCount} private payload redactions`}
        />
        <ReviewSafetyMetric
          label={`${durableStatusCounts.count} durable status ${pluralize(durableStatusCounts.count, "count")}`}
          detail={durableStatusCounts.summary}
        />
        <ReviewSafetyMetric
          label={`${safetyFlagLabels.length} safety ${pluralize(safetyFlagLabels.length, "flag")}`}
          detail={safetyFlagLabels.length === 0 ? "none visible" : safetyFlagLabels.join(", ")}
        />
        <ReviewSafetyMetric
          label={`${packet.missingRequiredTraceTags.length} missing required ${pluralize(packet.missingRequiredTraceTags.length, "behavior")}`}
          detail={packet.missingRequiredTraceTags.length === 0 ? "coverage complete" : packet.missingRequiredTraceTags.join(", ")}
        />
        <ReviewSafetyMetric
          label={packet.patientNote ? "Patient note attached" : "Patient note missing"}
          detail={packet.patientNote ? `submitted at ${packet.patientNote.submittedAtSecond}s` : "no note evidence in replay packet"}
        />
        <ReviewSafetyMetric
          label={`${latestTimelineSecond(packet)}s latest timeline`}
          detail={packet.timeline.length > 0 ? "latest summary-only replay event" : "timeline evidence missing"}
        />
      </div>
    </section>
  );
}

function ReviewSafetyMetric({ label, detail }: { label: string; detail: string }): ReactElement {
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

function latestTimelineSecond(packet: ReviewPacket): number {
  return packet.timeline.length === 0 ? 0 : Math.max(...packet.timeline.map((entry) => entry.atSecond));
}

function formatCountMap(value: unknown): { count: number; summary: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { count: 0, summary: "none" };
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key.trim().length > 0)
    .map(([key, count]) => `${key}: ${String(count)}`);

  return {
    count: entries.length,
    summary: entries.length > 0 ? entries.join(", ") : "none",
  };
}
