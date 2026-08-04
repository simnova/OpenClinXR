import type { PipelineCandidate, PipelineCandidateIndex } from "@openclinxr/model-vetting";
import { Alert, Button, Descriptions, Modal, Progress, Segmented, Space, Spin, Statistic, Table, type TableColumnsType, Tag, Typography, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CandidateDiffView } from "./CandidateDiffView.js";
import { CandidateCompare, CandidatePreview } from "./CandidatePreview.js";
import {
  aggregateClothing,
  aggregateRealism,
  distinctRoles,
  faceRealism,
  formatDay,
  formatMegabytes,
  formatScorePercent,
  fullRealism,
  loadPipelineCandidateIndex,
  realismForFraming,
  requestBatchScore,
  type ScoreFraming,
} from "./pipeline-admin-data.js";
import { PromotePanel } from "./PromotePanel.js";

const { Title, Text, Paragraph } = Typography;

function scoreColor(value: number | null): string {
  if (value === null) return "#8c8c8c";
  if (value >= 0.6) return "#52c41a";
  if (value >= 0.35) return "#e0a30c";
  return "#d4380d";
}

function ScoreCell(props: { value: number | null }): React.ReactElement {
  return (
    <Space size={6}>
      <Progress
        type="circle"
        size={34}
        percent={props.value === null ? 0 : Math.round(props.value * 100)}
        strokeColor={scoreColor(props.value)}
        format={() => formatScorePercent(props.value)}
      />
    </Space>
  );
}

function formatPromotedDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function PipelineAdminApp(props: { indexOverrideUrl?: string | null }): React.ReactElement {
  const [index, setIndex] = useState<PipelineCandidateIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedFromUrl, setLoadedFromUrl] = useState<string>("");
  const [framing, setFraming] = useState<ScoreFraming>("aggregate");
  const [previewCandidate, setPreviewCandidate] = useState<PipelineCandidate | null>(null);
  const [promoteCandidate, setPromoteCandidate] = useState<PipelineCandidate | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState<boolean>(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenMessage, setRegenMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [batchScoring, setBatchScoring] = useState(false);
  const [batchScoreMessage, setBatchScoreMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );
  const [compareTab, setCompareTab] = useState<"diff" | "capture">("diff");

  const reloadIndex = useCallback(async (): Promise<void> => {
    const result = await loadPipelineCandidateIndex({ overrideUrl: props.indexOverrideUrl ?? null });
    setIndex(result.index);
    setLoadedFromUrl(result.loadedFromUrl);
    setLoadError(null);
  }, [props.indexOverrideUrl]);

  useEffect(() => {
    let cancelled = false;
    loadPipelineCandidateIndex({ overrideUrl: props.indexOverrideUrl ?? null })
      .then((result) => {
        if (cancelled) return;
        setIndex(result.index);
        setLoadedFromUrl(result.loadedFromUrl);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [props.indexOverrideUrl]);

  const candidates = index?.candidates ?? [];
  const selected = useMemo(
    () => selectedKeys.map((key) => candidates.find((c) => c.candidateId === key)).filter((c): c is PipelineCandidate => Boolean(c)),
    [selectedKeys, candidates],
  );

  async function handleRegenerateIndex(): Promise<void> {
    setRegenerating(true);
    setRegenMessage(null);
    try {
      const response = await fetch("/__regenerate-index", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        stderr?: string;
        index?: PipelineCandidateIndex;
      };
      if (!response.ok || !body.ok) {
        const detail = body.error || body.stderr || `HTTP ${response.status}`;
        setRegenMessage({
          type: "error",
          text: `Regenerate failed (dev server only): ${detail}`,
        });
        return;
      }
      await reloadIndex();
      setRegenMessage({
        type: "success",
        text: `Index regenerated (${body.index?.candidateCount ?? "?"} candidates). Aesthetic inventory only.`,
      });
      void message.success("Index regenerated");
    } catch (error) {
      setRegenMessage({
        type: "error",
        text: `Regenerate unavailable (not under vite dev): ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } finally {
      setRegenerating(false);
    }
  }

  async function handleBatchScore(): Promise<void> {
    setBatchScoring(true);
    setBatchScoreMessage(null);
    try {
      const result = await requestBatchScore();
      if (!result.ok) {
        setBatchScoreMessage({
          type: "error",
          text: `Batch score failed (dev server only): ${result.error ?? "unknown"}`,
        });
        return;
      }
      if (result.index) {
        setIndex(result.index);
        setLoadedFromUrl("/pipeline-candidate-index.json");
      } else {
        await reloadIndex();
      }
      setBatchScoreMessage({
        type: "success",
        text: `Batch score applied (${result.scoredCandidateCount ?? result.index?.scoredCandidateCount ?? "?"} scored). Aesthetic-only via humanoid-vision-score join; not clinical/scoring validity.`,
      });
      void message.success("Batch score applied");
    } catch (error) {
      setBatchScoreMessage({
        type: "error",
        text: `Batch score unavailable (not under vite dev): ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } finally {
      setBatchScoring(false);
    }
  }

  async function handleAfterDeploy(): Promise<void> {
    // Prefer a quiet index rebuild so Status tags pick up the new promotion record.
    // Failures are non-fatal — Deploy success is already shown in the promote panel.
    try {
      await fetch("/__regenerate-index", { method: "POST" });
    } catch {
      // dev-only endpoint may be absent
    }
    try {
      await reloadIndex();
    } catch {
      // ignore
    }
  }

  const columns: TableColumnsType<PipelineCandidate> = useMemo(
    () => [
      {
        title: "Status",
        key: "promotionStatus",
        width: 140,
        filters: [
          { text: "Promoted", value: "promoted" },
          { text: "Not promoted", value: "not" },
        ],
        onFilter: (value, record) => {
          const isPromoted = Boolean(record.promotion?.promoted);
          return value === "promoted" ? isPromoted : !isPromoted;
        },
        render: (_v, record) =>
          record.promotion?.promoted ? (
            <Space orientation="vertical" size={0}>
              <Tag color="success" data-testid="status-promoted">
                Promoted
              </Tag>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {formatPromotedDay(record.promotion.promotedAt)}
              </Text>
            </Space>
          ) : (
            <Text type="secondary" data-testid="status-not-promoted">
              —
            </Text>
          ),
      },
      {
        title: "Role",
        dataIndex: "role",
        key: "role",
        filters: distinctRoles(candidates).map((role) => ({ text: role.replaceAll("_", " "), value: role })),
        onFilter: (value, record) => record.role === value,
        render: (role: string) => <Tag color="cyan">{role.replaceAll("_", " ")}</Tag>,
      },
      {
        title: "Candidate",
        dataIndex: "manifestId",
        key: "manifestId",
        render: (manifestId: string, record) => (
          <Space orientation="vertical" size={0}>
            <Text strong>{manifestId}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{record.group}</Text>
          </Space>
        ),
      },
      {
        title: "Full realism",
        key: "full",
        align: "center",
        sorter: (a, b) => (fullRealism(a) ?? -1) - (fullRealism(b) ?? -1),
        render: (_v, record) => <ScoreCell value={fullRealism(record)} />,
      },
      {
        title: "Face realism",
        key: "face",
        align: "center",
        sorter: (a, b) => (faceRealism(a) ?? -1) - (faceRealism(b) ?? -1),
        render: (_v, record) => <ScoreCell value={faceRealism(record)} />,
      },
      {
        title: "Aggregate",
        key: "aggregate",
        align: "center",
        defaultSortOrder: "descend",
        sorter: (a, b) => (aggregateRealism(a) ?? -1) - (aggregateRealism(b) ?? -1),
        render: (_v, record) => <ScoreCell value={aggregateRealism(record)} />,
      },
      {
        title: "Clothing",
        key: "clothing",
        align: "center",
        sorter: (a, b) => (aggregateClothing(a) ?? -1) - (aggregateClothing(b) ?? -1),
        render: (_v, record) => <Text>{formatScorePercent(aggregateClothing(record))}</Text>,
      },
      {
        title: "Rigging",
        key: "rigging",
        render: (_v, record) =>
          record.riggingSummary ? (
            <Space orientation="vertical" size={0}>
              <Tag color="geekblue">grade {record.riggingSummary.realismGrade ?? "?"}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {record.riggingSummary.boneCount ?? "?"} bones · {record.riggingSummary.morphTargetCount ?? "?"} morphs
              </Text>
            </Space>
          ) : (
            <Text type="secondary">no report</Text>
          ),
      },
      {
        title: "Modified",
        dataIndex: "modifiedAt",
        key: "modifiedAt",
        sorter: (a, b) => a.modifiedAt.localeCompare(b.modifiedAt),
        render: (modifiedAt: string, record) => (
          <Space orientation="vertical" size={0}>
            <Text>{formatDay(modifiedAt)}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{formatMegabytes(record.sizeBytes)}</Text>
          </Space>
        ),
      },
      {
        title: "Actions",
        key: "actions",
        render: (_v, record) => (
          <Space>
            <Button size="small" onClick={() => setPreviewCandidate(record)}>Preview</Button>
            <Button size="small" type="primary" ghost onClick={() => setPromoteCandidate(record)}>Promote</Button>
          </Space>
        ),
      },
    ],
    [candidates, framing],
  );

  if (loadError) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="error" showIcon title="Unable to load candidate index" description={loadError} />
      </div>
    );
  }
  if (!index) {
    return <Spin style={{ display: "block", margin: "80px auto" }} size="large" />;
  }

  const scored = index.scoredCandidateCount;

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <Space orientation="vertical" size="large" style={{ width: "100%" }}>
        <div>
          <Text type="secondary">Capability Arena</Text>
          <Title level={2} style={{ marginTop: 4 }}>Pipeline Administration &amp; Model Vetting</Title>
          <Paragraph type="secondary">
            Browse generated humanoid GLB candidates with dual-frame (full + face) aesthetic vision scores and rigging metadata.
            Preview head-in-frame, compare side-by-side, and record a promotion. Aesthetic generation-quality only — never clinical validity.
          </Paragraph>
        </div>

        <Space size="large" wrap>
          <Statistic title="Candidates" value={index.candidateCount} />
          <Statistic title="Scored" value={scored} suffix={`/ ${index.candidateCount}`} />
          <Statistic title="Vision report" valueRender={() => <Text code style={{ fontSize: 12 }}>{index.sourceVisionScoreReportPath ?? "none"}</Text>} />
          <div>
            <Text type="secondary" style={{ display: "block", marginBottom: 4 }}>Score emphasis</Text>
            <Segmented
              options={[
                { label: "Aggregate", value: "aggregate" },
                { label: "Full frame", value: "full" },
                { label: "Face frame", value: "face" },
              ]}
              value={framing}
              onChange={(value) => setFraming(value as ScoreFraming)}
              aria-label="Score framing emphasis"
            />
          </div>
          <Button
            type="primary"
            disabled={selected.length !== 2}
            onClick={() => setCompareOpen(true)}
            data-testid="compare-button"
          >
            Compare {selected.length}/2 selected
          </Button>
          <Button
            onClick={() => void handleRegenerateIndex()}
            loading={regenerating}
            data-testid="regenerate-index"
          >
            Regenerate index
          </Button>
          <Button
            type="default"
            onClick={() => void handleBatchScore()}
            loading={batchScoring}
            data-testid="batch-score"
          >
            Batch score
          </Button>
        </Space>

        {regenMessage ? (
          <Alert
            type={regenMessage.type === "success" ? "success" : "error"}
            showIcon
            closable
            onClose={() => setRegenMessage(null)}
            title={regenMessage.type === "success" ? "Index updated" : "Regenerate failed"}
            description={regenMessage.text}
            data-testid="regenerate-message"
          />
        ) : null}

        {batchScoreMessage ? (
          <Alert
            type={batchScoreMessage.type === "success" ? "success" : "error"}
            showIcon
            closable
            onClose={() => setBatchScoreMessage(null)}
            title={batchScoreMessage.type === "success" ? "Batch score applied" : "Batch score failed"}
            description={batchScoreMessage.text}
            data-testid="batch-score-message"
          />
        ) : null}

        <div>
          {index.notEvidenceFor.map((claim) => (
            <Tag color="volcano" key={claim}>not evidence for: {claim.replaceAll("_", " ")}</Tag>
          ))}
          <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>loaded from {loadedFromUrl.split("/").at(-1)}</Text>
        </div>

        <Table<PipelineCandidate>
          rowKey="candidateId"
          columns={columns}
          dataSource={candidates}
          size="middle"
          pagination={{ pageSize: 12, showSizeChanger: true }}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys.slice(0, 2).map(String)),
            getCheckboxProps: (record) => ({
              disabled: selectedKeys.length >= 2 && !selectedKeys.includes(record.candidateId),
            }),
          }}
          onRow={(record) => ({
            onClick: () => setFraming((prev) => prev),
            "aria-label": `candidate ${record.manifestId}, aggregate realism ${formatScorePercent(realismForFraming(record, "aggregate"))}`,
          })}
        />
      </Space>

      <Modal
        open={previewCandidate !== null}
        onCancel={() => setPreviewCandidate(null)}
        footer={null}
        width={760}
        title={previewCandidate ? `Preview · ${previewCandidate.manifestId}` : "Preview"}
        destroyOnHidden
      >
        {previewCandidate ? (
          <Space orientation="vertical" style={{ width: "100%" }} size="middle">
            <CandidatePreview candidate={previewCandidate} />
            <Descriptions bordered size="small" column={2} title="Rigging & quality metadata">
              <Descriptions.Item label="Role">{previewCandidate.role.replaceAll("_", " ")}</Descriptions.Item>
              <Descriptions.Item label="Grade">{previewCandidate.riggingSummary?.realismGrade ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Bones">{previewCandidate.riggingSummary?.boneCount ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Morph targets">{previewCandidate.riggingSummary?.morphTargetCount ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Garment faces">{previewCandidate.riggingSummary?.garmentRegionFaces ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Wardrobe">{previewCandidate.riggingSummary?.wardrobeTags.join(", ") || "—"}</Descriptions.Item>
              <Descriptions.Item label="Vision reason" span={2}>
                {previewCandidate.visionScore?.reason ?? "not scored"}
              </Descriptions.Item>
            </Descriptions>
            <div>
              {previewCandidate.notEvidenceFor.map((claim) => (
                <Tag color="volcano" key={claim}>not evidence for: {claim.replaceAll("_", " ")}</Tag>
              ))}
            </div>
          </Space>
        ) : null}
      </Modal>

      <Modal
        open={promoteCandidate !== null}
        onCancel={() => setPromoteCandidate(null)}
        footer={null}
        width={640}
        title={promoteCandidate ? `Promote · ${promoteCandidate.manifestId}` : "Promote"}
        destroyOnHidden
      >
        {promoteCandidate ? (
          <PromotePanel
            candidate={promoteCandidate}
            onDeployed={() => {
              void handleAfterDeploy();
            }}
          />
        ) : null}
      </Modal>

      <Modal
        open={compareOpen && selected.length === 2}
        onCancel={() => {
          setCompareOpen(false);
          setCompareTab("diff");
        }}
        footer={null}
        width={980}
        title={
          selected.length === 2
            ? `DIFF · ${selected[0]!.manifestId} vs ${selected[1]!.manifestId}`
            : "DIFF"
        }
        destroyOnHidden
      >
        {selected.length === 2 ? (
          <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
            <Segmented
              options={[
                { label: "Score & rigging DIFF", value: "diff" },
                { label: "Capture compare", value: "capture" },
              ]}
              value={compareTab}
              onChange={(value) => setCompareTab(value as "diff" | "capture")}
              data-testid="compare-tab"
            />
            {compareTab === "diff" ? (
              <CandidateDiffView left={selected[0]!} right={selected[1]!} />
            ) : (
              <CandidateCompare left={selected[0]!} right={selected[1]!} />
            )}
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
