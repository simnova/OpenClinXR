import { buildPromotionRecord, type PipelineCandidate, type PromotionRecord } from "@openclinxr/model-vetting";
import { Alert, Button, Input, Result, Space, Tag, Typography } from "antd";
import { useMemo, useState } from "react";

const { Paragraph, Text } = Typography;

type DeploySuccess = {
  record: PromotionRecord | null;
  deployTargets: string[];
  stdout: string;
};

/**
 * Promote a candidate: optional one-click Deploy now (dev-only POST /__promote)
 * plus offline fallback (build record + download + copyCommand).
 *
 * Deploy = aesthetic asset staging to runtime dirs only.
 * Not production / clinical / scoring / learner readiness.
 */
export function PromotePanel(props: {
  candidate: PipelineCandidate;
  onDeployed?: () => void;
}): React.ReactElement {
  const [reason, setReason] = useState<string>("");
  const [record, setRecord] = useState<PromotionRecord | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deploySuccess, setDeploySuccess] = useState<DeploySuccess | null>(null);

  const recordJson = useMemo(() => (record ? JSON.stringify(record, null, 2) : ""), [record]);

  const manualCommand = useMemo(() => {
    const r = reason.trim() || "no reason provided";
    return `tsx tools/openclinxr/evidence/promote-candidate.ts --candidate-id "${props.candidate.candidateId}" --reason "${r}" --promoted-by faculty_reviewer --apply-copy`;
  }, [props.candidate.candidateId, reason]);

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

  async function handleDeployNow(): Promise<void> {
    setDeploying(true);
    setDeployError(null);
    setDeploySuccess(null);
    try {
      const response = await fetch("/__promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: props.candidate.candidateId,
          reason: reason.trim() || "no reason provided",
          promotedBy: "faculty_reviewer",
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        record?: PromotionRecord;
        deployTargets?: string[];
        stdout?: string;
        error?: string;
        stderr?: string;
      };
      if (!response.ok || !body.ok) {
        const detail = body.error || body.stderr || `HTTP ${response.status}`;
        setDeployError(
          `Deploy failed (dev server only). Use the manual command below.\n${detail}`,
        );
        return;
      }
      const success: DeploySuccess = {
        record: body.record ?? null,
        deployTargets: body.deployTargets ?? body.record?.deployTargets ?? [],
        stdout: body.stdout ?? "",
      };
      setDeploySuccess(success);
      if (body.record) setRecord(body.record);
      props.onDeployed?.();
    } catch (error) {
      setDeployError(
        `Deploy unavailable (not running under vite dev, or network error). Use the manual command below.\n${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setDeploying(false);
    }
  }

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      <Alert
        type="info"
        showIcon
        title="Aesthetic promotion / deploy only"
        description="Stages a chosen candidate GLB into runtime preview dirs. Not evidence for clinical validity, exam equivalence, scoring, or learner readiness — and not production readiness."
      />
      <Input.TextArea
        aria-label="Promotion reason"
        placeholder="Why promote this candidate? (e.g. best nurse realism this batch)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
      />
      <Space wrap>
        <Button
          type="primary"
          onClick={() => void handleDeployNow()}
          loading={deploying}
          data-testid="promote-deploy-now"
        >
          Deploy now
        </Button>
        <Button onClick={handleBuild} data-testid="promote-build">
          Build promotion record
        </Button>
      </Space>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Deploy now calls the local vite dev endpoint (POST /__promote) and copies the GLB to
        generated-humanoids + cagematch current. Aesthetic staging only — not production or clinical readiness.
      </Text>

      {deploySuccess ? (
        <div data-testid="promote-deploy-success">
          <Result
            status="success"
            title="Deployed (aesthetic staging)"
            subTitle="GLB copied to runtime preview paths. Not production/clinical readiness."
            extra={
              <Space orientation="vertical" style={{ width: "100%", textAlign: "left" }} size="small">
                {deploySuccess.deployTargets.map((t) => (
                  <Text code key={t}>
                    {t}
                  </Text>
                ))}
                {deploySuccess.record ? (
                  <pre
                    data-testid="promote-deploy-record"
                    style={{ maxHeight: 160, overflow: "auto", background: "#0f1613", padding: 12, borderRadius: 8 }}
                  >
                    {JSON.stringify(deploySuccess.record, null, 2)}
                  </pre>
                ) : null}
              </Space>
            }
          />
        </div>
      ) : null}

      {deployError ? (
        <Alert
          type="warning"
          showIcon
          data-testid="promote-deploy-error"
          title="One-click deploy unavailable — use offline fallback"
          description={
            <Space orientation="vertical" size="small" style={{ width: "100%" }}>
              <Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{deployError}</Paragraph>
              <Paragraph copyable={{ text: manualCommand }}>
                <Text code>{manualCommand}</Text>
              </Paragraph>
            </Space>
          }
        />
      ) : null}

      {record ? (
        <Space orientation="vertical" style={{ width: "100%" }} size="small">
          <Text strong>Deploy targets</Text>
          {(record.deployTargets ?? [record.deployTargetSuggestion]).map((t) => (
            <Text code key={t}>
              {t}
            </Text>
          ))}
          <Text strong>Durable write command (offline fallback)</Text>
          <Paragraph copyable={{ text: manualCommand }}>
            <Text code>{manualCommand}</Text>
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
