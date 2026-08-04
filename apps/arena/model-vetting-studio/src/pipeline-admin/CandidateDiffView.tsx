import {
  diffPipelineCandidates,
  type PipelineCandidate,
  type PipelineCandidateDiff,
} from "@openclinxr/model-vetting";
import { Descriptions, Space, Table, Tag, Typography } from "antd";
import { useMemo } from "react";
import { formatScorePercent } from "./pipeline-admin-data.js";

const { Text, Title } = Typography;

function formatDelta(value: number | null, asPercent = false): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  if (asPercent) return `${sign}${Math.round(value * 100)}`;
  return `${sign}${value}`;
}

function deltaColor(value: number | null): string {
  if (value === null || value === 0) return "#8c8c8c";
  return value > 0 ? "#52c41a" : "#d4380d";
}

function SidePanel(props: {
  label: string;
  candidate: PipelineCandidate;
}): React.ReactElement {
  const { candidate } = props;
  return (
    <div data-testid={`diff-side-${props.label}`}>
      <Title level={5} style={{ marginTop: 0 }}>
        {props.label}: {candidate.manifestId}
      </Title>
      <Descriptions size="small" column={1} bordered>
        <Descriptions.Item label="Role">
          <Tag color="cyan">{candidate.role.replaceAll("_", " ")}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Aggregate realism">
          {formatScorePercent(candidate.visionScore?.aggregateRealism_0to1 ?? null)}
        </Descriptions.Item>
        <Descriptions.Item label="Aggregate clothing">
          {formatScorePercent(candidate.visionScore?.aggregateClothing_0to1 ?? null)}
        </Descriptions.Item>
        <Descriptions.Item label="Full / face realism">
          {formatScorePercent(candidate.visionScore?.full?.realism_0to1 ?? null)}
          {" / "}
          {formatScorePercent(candidate.visionScore?.face?.realism_0to1 ?? null)}
        </Descriptions.Item>
        <Descriptions.Item label="Grade">{candidate.riggingSummary?.realismGrade ?? "—"}</Descriptions.Item>
        <Descriptions.Item label="Bones">{candidate.riggingSummary?.boneCount ?? "—"}</Descriptions.Item>
        <Descriptions.Item label="Morphs">
          {candidate.riggingSummary?.morphTargetCount ?? "—"}
        </Descriptions.Item>
        <Descriptions.Item label="Garment faces">
          {candidate.riggingSummary?.garmentRegionFaces ?? "—"}
        </Descriptions.Item>
        <Descriptions.Item label="Wardrobe">
          {candidate.riggingSummary?.wardrobeTags.join(", ") || "—"}
        </Descriptions.Item>
      </Descriptions>
    </div>
  );
}

type DeltaRow = {
  key: string;
  metric: string;
  left: string;
  right: string;
  delta: string;
  deltaValue: number | null;
};

function buildDeltaRows(
  left: PipelineCandidate,
  right: PipelineCandidate,
  diff: PipelineCandidateDiff,
): DeltaRow[] {
  const scoreRows: DeltaRow[] = [
    {
      key: "agg-realism",
      metric: "Aggregate realism",
      left: formatScorePercent(left.visionScore?.aggregateRealism_0to1 ?? null),
      right: formatScorePercent(right.visionScore?.aggregateRealism_0to1 ?? null),
      delta: formatDelta(diff.scoreDeltas.aggregateRealism, true),
      deltaValue: diff.scoreDeltas.aggregateRealism,
    },
    {
      key: "agg-clothing",
      metric: "Aggregate clothing",
      left: formatScorePercent(left.visionScore?.aggregateClothing_0to1 ?? null),
      right: formatScorePercent(right.visionScore?.aggregateClothing_0to1 ?? null),
      delta: formatDelta(diff.scoreDeltas.aggregateClothing, true),
      deltaValue: diff.scoreDeltas.aggregateClothing,
    },
    {
      key: "full-realism",
      metric: "Full-frame realism",
      left: formatScorePercent(left.visionScore?.full?.realism_0to1 ?? null),
      right: formatScorePercent(right.visionScore?.full?.realism_0to1 ?? null),
      delta: formatDelta(diff.scoreDeltas.fullRealism, true),
      deltaValue: diff.scoreDeltas.fullRealism,
    },
    {
      key: "face-realism",
      metric: "Face-frame realism",
      left: formatScorePercent(left.visionScore?.face?.realism_0to1 ?? null),
      right: formatScorePercent(right.visionScore?.face?.realism_0to1 ?? null),
      delta: formatDelta(diff.scoreDeltas.faceRealism, true),
      deltaValue: diff.scoreDeltas.faceRealism,
    },
  ];

  const rigRows: DeltaRow[] = [
    {
      key: "bones",
      metric: "Bone count",
      left: String(left.riggingSummary?.boneCount ?? "—"),
      right: String(right.riggingSummary?.boneCount ?? "—"),
      delta: formatDelta(diff.riggingDeltas.boneCount),
      deltaValue: diff.riggingDeltas.boneCount,
    },
    {
      key: "morphs",
      metric: "Morph targets",
      left: String(left.riggingSummary?.morphTargetCount ?? "—"),
      right: String(right.riggingSummary?.morphTargetCount ?? "—"),
      delta: formatDelta(diff.riggingDeltas.morphTargetCount),
      deltaValue: diff.riggingDeltas.morphTargetCount,
    },
    {
      key: "garment-faces",
      metric: "Garment faces",
      left: String(left.riggingSummary?.garmentRegionFaces ?? "—"),
      right: String(right.riggingSummary?.garmentRegionFaces ?? "—"),
      delta: formatDelta(diff.riggingDeltas.garmentRegionFaces),
      deltaValue: diff.riggingDeltas.garmentRegionFaces,
    },
    {
      key: "grade",
      metric: "Realism grade",
      left: diff.riggingDeltas.realismGrade.left ?? "—",
      right: diff.riggingDeltas.realismGrade.right ?? "—",
      delta: diff.riggingDeltas.realismGrade.changed ? "changed" : "same",
      deltaValue: diff.riggingDeltas.realismGrade.changed ? 1 : 0,
    },
  ];

  return [...scoreRows, ...rigRows];
}

/**
 * Candidate DIFF view: side-by-side metadata + score/rigging deltas (right − left).
 * Aesthetic comparison only — not evidence for clinical/scoring readiness.
 */
export function CandidateDiffView(props: {
  left: PipelineCandidate;
  right: PipelineCandidate;
}): React.ReactElement {
  const diff = useMemo(
    () => diffPipelineCandidates(props.left, props.right),
    [props.left, props.right],
  );
  const rows = useMemo(
    () => buildDeltaRows(props.left, props.right, diff),
    [props.left, props.right, diff],
  );

  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }} data-testid="candidate-diff-view">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <SidePanel label="Left" candidate={props.left} />
        <SidePanel label="Right" candidate={props.right} />
      </div>

      <div>
        <Title level={5}>Score &amp; rigging deltas (right − left)</Title>
        <Table<DeltaRow>
          size="small"
          pagination={false}
          dataSource={rows}
          rowKey="key"
          columns={[
            { title: "Metric", dataIndex: "metric", key: "metric" },
            { title: "Left", dataIndex: "left", key: "left", align: "center" },
            { title: "Right", dataIndex: "right", key: "right", align: "center" },
            {
              title: "Δ",
              dataIndex: "delta",
              key: "delta",
              align: "center",
              render: (text: string, row) => (
                <Text strong style={{ color: deltaColor(row.deltaValue) }}>
                  {text}
                </Text>
              ),
            },
          ]}
        />
        {diff.riggingDeltas.wardrobeTagsAdded.length > 0 ||
        diff.riggingDeltas.wardrobeTagsRemoved.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            {diff.riggingDeltas.wardrobeTagsAdded.map((tag) => (
              <Tag color="green" key={`add-${tag}`}>
                +{tag}
              </Tag>
            ))}
            {diff.riggingDeltas.wardrobeTagsRemoved.map((tag) => (
              <Tag color="red" key={`rm-${tag}`}>
                −{tag}
              </Tag>
            ))}
          </div>
        ) : null}
      </div>

      <div>
        {diff.notEvidenceFor.map((claim) => (
          <Tag color="volcano" key={claim}>
            not evidence for: {claim.replaceAll("_", " ")}
          </Tag>
        ))}
        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
          {diff.claimScope}
        </Text>
      </div>
    </Space>
  );
}
