import { buildPromotionRecord, type PipelineCandidate, type PromotionRecord } from "@openclinxr/model-vetting";
import { Alert, Button, Input, Space, Tag, Typography } from "antd";
import { useMemo, useState } from "react";

const { Paragraph, Text } = Typography;

/**
 * Promote a candidate: builds a claim-scoped PromotionRecord and exposes the
 * durable-write command + a JSON download. Browsers cannot write the repo
 * filesystem; the node tool tools/openclinxr/evidence/promote-candidate.ts
 * performs the authoritative durable write.
 */
export function PromotePanel(props: { candidate: PipelineCandidate }): React.ReactElement {
  const [reason, setReason] = useState<string>("");
  const [record, setRecord] = useState<PromotionRecord | null>(null);

  const recordJson = useMemo(() => (record ? JSON.stringify(record, null, 2) : ""), [record]);

  function handleBuild(): void {
    setRecord(
      buildPromotionRecord(props.candidate, {
        promotedBy: "faculty_reviewer",
        reason: reason.trim() || "no reason provided",
        promotedAt: new Date().toISOString(),
      }),
    );
  }

  function handleDownload(): void {
    if (!record) return;
    const blob = new Blob([recordJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `promotion-${props.candidate.manifestId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      <Alert
        type="info"
        showIcon
        title="Aesthetic promotion record only"
        description="Records a chosen candidate for staging. Not evidence for clinical validity, exam equivalence, scoring, or learner readiness."
      />
      <Input.TextArea
        aria-label="Promotion reason"
        placeholder="Why promote this candidate? (e.g. best nurse realism this batch)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
      />
      <Button type="primary" onClick={handleBuild} data-testid="promote-build">
        Build promotion record
      </Button>
      {record ? (
        <Space orientation="vertical" style={{ width: "100%" }} size="small">
          <Text strong>Deploy target suggestion</Text>
          <Text code>{record.deployTargetSuggestion}</Text>
          <Text strong>Durable write command (run in repo)</Text>
          <Paragraph copyable={{ text: `tsx tools/openclinxr/evidence/promote-candidate.ts --candidate-id "${record.candidateId}" --reason "${record.reason}"` }}>
            <Text code>{`tsx tools/openclinxr/evidence/promote-candidate.ts --candidate-id "${record.candidateId}"`}</Text>
          </Paragraph>
          <Text strong>Copy-to-deployed command</Text>
          <Paragraph copyable={{ text: record.copyCommand }}>
            <Text code>{record.copyCommand}</Text>
          </Paragraph>
          <div>
            {record.notEvidenceFor.map((claim) => (
              <Tag color="volcano" key={claim}>
                not evidence for: {claim.replaceAll("_", " ")}
              </Tag>
            ))}
          </div>
          <Button onClick={handleDownload} data-testid="promote-download">
            Download record JSON
          </Button>
          <pre
            data-testid="promote-record-json"
            style={{ maxHeight: 220, overflow: "auto", background: "#0f1613", padding: 12, borderRadius: 8 }}
          >
            {recordJson}
          </pre>
        </Space>
      ) : null}
    </Space>
  );
}
