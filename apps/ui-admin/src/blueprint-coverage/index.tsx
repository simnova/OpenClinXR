import type { TableProps } from "antd";
import { Alert, Button, Space, Table, Tag, Typography } from "antd";
import { type ReactElement, useMemo, useState } from "react";
import {
  type BuildSamplingPlanInput,
  buildSamplingPlan,
  createSamplingPlanActivationReview,
  decideSamplingPlanActivation,
  type SamplingPlan,
  type SamplingPlanActivationRecord,
  type SamplingPlanCoverageDimension,
  type SamplingPlanCoverageMatrixRow,
  type SamplingPlanSubstitution,
  samplingPlanCoverageDimensions,
} from "../../../../packages/openclinxr/exam-assembly/src/sampling-plan/index.js";

export type BlueprintCoverageWorkflowProps = {
  input: BuildSamplingPlanInput;
  reviewerId: string;
  onPersistActivation: (
    record: SamplingPlanActivationRecord,
  ) => Promise<void> | void;
  now?: () => string;
  createDecisionId?: (plan: SamplingPlan, decidedAt: string) => string;
};

type PersistenceState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; record: SamplingPlanActivationRecord }
  | { status: "error"; message: string };

const dimensionLabels: Readonly<Record<SamplingPlanCoverageDimension, string>> = {
  specialty: "Specialty",
  environment: "Environment",
  actor_role: "Actor role",
  safety_critical_event: "Safety-critical event",
  communication: "Communication",
  reasoning: "Reasoning",
  synthesis: "Synthesis",
  pressure_profile: "Pressure profile",
};

export function BlueprintCoverageWorkflow(props: BlueprintCoverageWorkflowProps): ReactElement {
  const inputReviewIdentity = buildSamplingPlan(props.input).reviewIdentity;
  return <VersionPinnedBlueprintCoverageWorkflow key={inputReviewIdentity} {...props} />;
}

function VersionPinnedBlueprintCoverageWorkflow({
  input,
  reviewerId,
  onPersistActivation,
  now = () => new Date().toISOString(),
  createDecisionId = defaultDecisionId,
}: BlueprintCoverageWorkflowProps): ReactElement {
  const [substitutions, setSubstitutions] = useState<SamplingPlanSubstitution[]>(() =>
    (input.substitutions ?? []).map(copySubstitution),
  );
  const [persistence, setPersistence] = useState<PersistenceState>({ status: "idle" });
  const plan = useMemo(
    () => buildSamplingPlan({ ...input, substitutions }),
    [input, substitutions],
  );
  const columns = useMemo(() => coverageMatrixColumns(), []);

  const reviewSubstitution = (
    substitutionId: string,
    status: "accepted" | "rejected",
  ) => {
    const reviewedAt = now();
    setSubstitutions((current) =>
      current.map((substitution) =>
        substitution.substitutionId === substitutionId
          ? {
              ...substitution,
              review: { status, reviewerId, reviewedAt },
            }
          : substitution,
      ),
    );
    setPersistence({ status: "idle" });
  };

  const persistActivationDecision = async (
    decision: "approve_activation" | "reject_activation",
  ) => {
    const decidedAt = now();
    const review = createSamplingPlanActivationReview(plan, {
      decisionId: createDecisionId(plan, decidedAt),
      decision,
      reviewerId,
      decidedAt,
    });
    const record = decideSamplingPlanActivation(plan, review);
    setPersistence({ status: "saving" });
    try {
      await onPersistActivation(record);
      setPersistence({ status: "saved", record });
    } catch (error) {
      setPersistence({
        status: "error",
        message: error instanceof Error ? error.message : "Sampling-plan activation persistence failed",
      });
    }
  };

  return (
    <section className="workbench-panel" aria-label="Blueprint sampling-plan activation">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Version-pinned form review</Typography.Text>
          <Typography.Title level={4}>Blueprint Coverage &amp; Activation</Typography.Title>
        </div>
        <Tag color={plan.activationStatus === "ready_for_faculty_review" ? "green" : "gold"}>
          {plan.activationStatus === "ready_for_faculty_review"
            ? "Ready for faculty activation review"
            : "Activation blocked"}
        </Tag>
      </div>

      <Alert
        type="info"
        showIcon
        title="Coverage is a faculty review aid, not validity evidence"
        description="Activation requires exact blueprint and scenario revisions, complete construct coverage, and reviewed substitutions. This matrix does not establish clinical, psychometric, or scoring validity and does not support high-stakes or exam-equivalence claims."
      />

      <Typography.Paragraph type="secondary">
        {`Form ${plan.examFormId}; plan v${plan.planVersion}; blueprint ${plan.blueprintRevision.blueprintId}@${plan.blueprintRevision.blueprintVersion}.`}
      </Typography.Paragraph>
      <ul className="compact-list" aria-label="Pinned sampling-plan revisions">
        {plan.scenarioRevisions.map((revision) => (
          <li key={revision.slotId}>
            <Typography.Text>
              {`Station ${revision.stationOrder}: ${revision.scenarioId}@${revision.scenarioVersion}`}
            </Typography.Text>
            <Typography.Text type="secondary">{revision.slotId}</Typography.Text>
          </li>
        ))}
      </ul>

      <section aria-label="Construct coverage matrix">
        <Typography.Title level={5}>Per-station construct matrix</Typography.Title>
        <Table<SamplingPlanCoverageMatrixRow>
          bordered
          size="small"
          pagination={false}
          rowKey="slotId"
          dataSource={plan.coverageMatrix}
          columns={columns}
          scroll={{ x: 1640 }}
        />
      </section>

      <section aria-label="Coverage requirements and gaps">
        <Typography.Title level={5}>Required coverage</Typography.Title>
        {plan.unconfiguredDimensions.length > 0 ? (
          <Alert
            type="error"
            showIcon
            title="Unconfigured blueprint dimensions block activation"
            description={plan.unconfiguredDimensions.map((dimension) => dimensionLabels[dimension]).join(", ")}
          />
        ) : null}
        <ul className="compact-list">
          {plan.coverageResults.map((result) => (
            <li key={result.requirementId}>
              <Tag color={result.status === "met" ? "green" : "red"}>{result.status}</Tag>
              <Typography.Text strong>{`${dimensionLabels[result.dimension]}: ${result.value}`}</Typography.Text>
              <Typography.Text type="secondary">
                {`${result.actualStations}/${result.minimumStations} stations; ${result.coveredBySlotIds.join(", ") || "no coverage"}`}
              </Typography.Text>
            </li>
          ))}
        </ul>
        {plan.gaps.length > 0 ? (
          <Alert
            type="error"
            showIcon
            title={`${plan.gaps.length} blueprint coverage gap${plan.gaps.length === 1 ? "" : "s"} block activation`}
            description={plan.gaps
              .map((gap) => `${dimensionLabels[gap.dimension]} ${gap.value}: need ${gap.minimumStations}, have ${gap.actualStations}`)
              .join("; ")}
          />
        ) : plan.unconfiguredDimensions.length === 0 ? (
          <Alert type="success" showIcon title="All configured construct requirements are covered" />
        ) : null}
      </section>

      <section aria-label="Sampling-plan substitutions">
        <Typography.Title level={5}>Faculty substitutions</Typography.Title>
        <Typography.Paragraph type="secondary">
          Substitution decisions are staged here and persisted atomically with the form activation decision.
        </Typography.Paragraph>
        {plan.substitutions.length === 0 ? (
          <Typography.Paragraph type="secondary">No substitutions proposed.</Typography.Paragraph>
        ) : (
          <ul className="compact-list">
            {plan.substitutions.map((substitution) => (
              <li key={substitution.substitutionId}>
                <div className="station-queue-row">
                  <Typography.Text strong>
                    {`${substitution.fromScenarioRevision.scenarioId}@${substitution.fromScenarioRevision.scenarioVersion} → ${substitution.toScenarioRevision.scenarioId}@${substitution.toScenarioRevision.scenarioVersion}`}
                  </Typography.Text>
                  <Tag
                    color={
                      substitution.review.status === "accepted"
                        ? "green"
                        : substitution.review.status === "rejected"
                          ? "red"
                          : "gold"
                    }
                  >
                    {substitution.review.status}
                  </Tag>
                </div>
                <Typography.Text type="secondary">{substitution.rationale}</Typography.Text>
                {substitution.blockers.length > 0 ? (
                  <Typography.Text type="secondary">
                    {`Blockers: ${substitution.blockers.join(", ")}`}
                  </Typography.Text>
                ) : null}
                {substitution.review.status === "pending" ? (
                  <Space wrap>
                    <Button
                      type="primary"
                      aria-label={`Approve substitution to ${substitution.toScenarioRevision.scenarioId}@${substitution.toScenarioRevision.scenarioVersion}`}
                      onClick={() => reviewSubstitution(substitution.substitutionId, "accepted")}
                    >
                      Approve substitution
                    </Button>
                    <Button
                      danger
                      aria-label={`Reject substitution to ${substitution.toScenarioRevision.scenarioId}@${substitution.toScenarioRevision.scenarioVersion}`}
                      onClick={() => reviewSubstitution(substitution.substitutionId, "rejected")}
                    >
                      Reject substitution
                    </Button>
                  </Space>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Sampling-plan activation blockers">
        <Typography.Title level={5}>Activation decision</Typography.Title>
        <ul className="compact-list">
          {plan.activationBlockers.length === 0 ? (
            <li><Typography.Text type="secondary">No activation blockers</Typography.Text></li>
          ) : (
            plan.activationBlockers.map((blocker) => (
              <li key={blocker}><Typography.Text type="secondary">{blocker}</Typography.Text></li>
            ))
          )}
        </ul>
        <Space wrap>
          <Button
            type="primary"
            loading={persistence.status === "saving"}
            onClick={() => void persistActivationDecision("approve_activation")}
          >
            {plan.activationStatus === "blocked"
              ? "Record blocked activation attempt"
              : "Activate reviewed form"}
          </Button>
          <Button
            danger
            disabled={persistence.status === "saving"}
            onClick={() => void persistActivationDecision("reject_activation")}
          >
            Reject or hold form
          </Button>
        </Space>
      </section>

      {persistence.status === "saved" ? (
        <Alert
          type={persistence.record.status === "active" ? "success" : "error"}
          showIcon
          title={
            persistence.record.status === "active"
              ? "Version-pinned form activation persisted"
              : "Activation refusal persisted"
          }
          description={
            persistence.record.status === "active"
              ? `${persistence.record.blueprintRevision.blueprintId}@${persistence.record.blueprintRevision.blueprintVersion}; ${persistence.record.scenarioRevisions.length} scenario revisions pinned`
              : persistence.record.blockers.join(", ")
          }
        />
      ) : null}
      {persistence.status === "error" ? (
        <Alert type="error" showIcon title="Activation decision was not persisted" description={persistence.message} />
      ) : null}
    </section>
  );
}

function coverageMatrixColumns(): NonNullable<TableProps<SamplingPlanCoverageMatrixRow>["columns"]> {
  return [
    {
      title: "Station",
      key: "station",
      fixed: "left",
      width: 110,
      render: (_, row) => `#${row.stationOrder} ${row.slotId}`,
    },
    {
      title: "Scenario revision",
      key: "scenario",
      fixed: "left",
      width: 220,
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{`${row.scenarioId}@${row.scenarioVersion}`}</Typography.Text>
          <Typography.Text type="secondary">{row.scenarioTitle}</Typography.Text>
          {row.selectionSource === "faculty_substitution" ? <Tag color="blue">substituted</Tag> : null}
        </Space>
      ),
    },
    ...samplingPlanCoverageDimensions.map((dimension) => ({
      title: dimensionLabels[dimension],
      key: dimension,
      width: 160,
      render: (_: unknown, row: SamplingPlanCoverageMatrixRow) =>
        row.coverage[dimension].length > 0 ? (
          <Space wrap size={[0, 4]}>
            {row.coverage[dimension].map((value) => <Tag key={value}>{value}</Tag>)}
          </Space>
        ) : <Typography.Text type="secondary">none</Typography.Text>,
    })),
  ];
}

function copySubstitution(substitution: SamplingPlanSubstitution): SamplingPlanSubstitution {
  return {
    ...substitution,
    fromScenarioRevision: { ...substitution.fromScenarioRevision },
    toScenario: {
      ...substitution.toScenario,
      coverage: Object.fromEntries(
        samplingPlanCoverageDimensions.map((dimension) => [
          dimension,
          [...substitution.toScenario.coverage[dimension]],
        ]),
      ) as unknown as SamplingPlanSubstitution["toScenario"]["coverage"],
    },
    review: { ...substitution.review },
  };
}

function defaultDecisionId(plan: SamplingPlan, decidedAt: string): string {
  return `sampling:${plan.examFormId}:v${plan.planVersion}:${decidedAt}`;
}
