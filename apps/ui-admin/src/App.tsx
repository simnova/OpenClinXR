import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { buildScenarioGovernanceCopy, safeUserFacingClaimLanguage, scoreUseCopy, validationStageCopy } from "@openclinxr/domain/claim-language";
import { adminPublicationGates, adminWorkbenchRoutes } from "@openclinxr/ui-route-admin";
import { adminWorkbenchCapabilityTags, openClinXrAdminTheme } from "@openclinxr/ui-shared";
import { Alert, Button, Card, ConfigProvider, Input, Layout, Space, Spin, Steps, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Link, MemoryRouter, Route, Routes, useParams, useSearchParams } from "react-router";
import {
  createAdminControlPlaneClient,
  buildAdminGraphqlEndpoint,
  type AdminScenario,
  type AdminScenarioDetail,
  type AdminControlPlaneClient,
  type AdminReviewPacketReplay,
  type AdminStationRunQueueSnapshot,
  type BlueprintScenarioReadiness,
  type ExamBlueprint,
  type ExamStationRunQueue,
  type ExamTimingPlan,
  type ScenarioAssetReadiness,
} from "./api-client.js";

const { Content, Sider } = Layout;
const { TextArea } = Input;

type AdminAppProps = {
  router?: "browser" | "memory";
  initialPath?: string;
  controlPlaneClient?: AdminControlPlaneClient;
};

export const adminApolloClient = new ApolloClient({
  cache: new InMemoryCache(),
  link: new HttpLink({ uri: buildAdminGraphqlEndpoint("") }),
});

const seedExamGovernanceCopy = buildScenarioGovernanceCopy({
  scoreUseLabel: "formative_local_only",
  syntheticCaseDisclosure: "Synthetic training scenario for local review.",
  validationStage: "stage_1_expert_reviewed",
  validationLimitations: ["Prototype fixture review only."],
  requiredReviewerRoles: ["clinician", "psychometrician", "legal", "simulation_qa"],
  sourceIds: ["src-public-clinical-skills-structure", "src-ama-clinical-skills-competencies"],
  safetyCriticalTraceTags: ["ecg_request", "urgent_escalation", "team_communication"],
  hiddenFactPolicy: {
    learnerView: "redact_hidden_facts",
    disclosureRequiresTrigger: true,
  },
});

export function AdminApp({ router = "memory", initialPath = "/", controlPlaneClient }: AdminAppProps): React.ReactElement {
  const client = useMemo(() => controlPlaneClient ?? createAdminControlPlaneClient({ apolloClient: adminApolloClient }), [controlPlaneClient]);

  return (
    <ConfigProvider theme={openClinXrAdminTheme}>
      <ApolloProvider client={adminApolloClient}>
        <AdminRouter router={router} initialPath={initialPath}>
          <Layout className="admin-shell">
            <Sider className="admin-sider" width={232}>
              <Typography.Title level={1}>OpenClinXR Admin</Typography.Title>
              <nav aria-label="Admin workbench">
                <ul className="admin-nav">
                  {adminWorkbenchRoutes.map((route) => (
                    <li key={route.path}>
                      <Link to={route.path}>{route.label}</Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </Sider>
            <Content className="admin-content">
              <section className="admin-heading" aria-labelledby="admin-overview-title">
                <Typography.Text className="eyebrow">Single-user pilot control plane</Typography.Text>
                <Typography.Title id="admin-overview-title" level={2}>
                  Scenario governance workbench
                </Typography.Title>
                <Typography.Paragraph>
                  <Typography.Text strong>Clinical, psychometric, legal, and simulation QA gates</Typography.Text>
                  {" stay visible before a scenario can feed a learner-facing XR station."}
                </Typography.Paragraph>
                <Space wrap>
                  {adminWorkbenchCapabilityTags.map((tag) => (
                    <Tag key={tag} color={capabilityTagColor(tag)}>
                      {tag}
                    </Tag>
                  ))}
                </Space>
              </section>

              <Routes>
                <Route path="/" element={<WorkbenchOverview />} />
                <Route path="/scenarios" element={<ScenarioBankWorkbench controlPlaneClient={client} />} />
                <Route path="/scenarios/:scenarioId" element={<ScenarioDetailWorkbench controlPlaneClient={client} />} />
                <Route path="/reviews" element={<ReviewReplayWorkbench controlPlaneClient={client} />} />
                <Route path="/exam-forms" element={<SeedBlueprintWorkbench controlPlaneClient={client} />} />
              </Routes>
            </Content>
          </Layout>
        </AdminRouter>
      </ApolloProvider>
    </ConfigProvider>
  );
}

function AdminRouter({
  router,
  initialPath,
  children,
}: {
  router: "browser" | "memory";
  initialPath: string;
  children: React.ReactNode;
}): React.ReactElement {
  if (router === "browser") {
    return <BrowserRouter>{children}</BrowserRouter>;
  }

  return <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>;
}

function WorkbenchOverview(): React.ReactElement {
  return (
    <div className="admin-grid">
      {adminWorkbenchRoutes.map((route) => (
        <Card key={route.path} title={route.label}>
          <Typography.Paragraph>{route.description}</Typography.Paragraph>
          <Link to={route.path}>Open {route.label}</Link>
        </Card>
      ))}
      <Card title="Publication gates">
        <Steps
          orientation="vertical"
          size="small"
          items={adminPublicationGates.map((title, index) => ({
            title,
            status: index === 0 ? "process" : "wait",
          }))}
        />
      </Card>
    </div>
  );
}

type ReviewReplayWorkbenchState =
  | { status: "idle" }
  | { status: "loading"; stationRunId: string }
  | { status: "error"; stationRunId: string; message: string }
  | { status: "ready"; stationRunId: string; replay: AdminReviewPacketReplay };

function ReviewReplayWorkbench({ controlPlaneClient }: { controlPlaneClient: AdminControlPlaneClient }): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const stationRunIdParam = searchParams.get("stationRunId") ?? "";
  const [stationRunIdInput, setStationRunIdInput] = useState(stationRunIdParam);
  const [state, setState] = useState<ReviewReplayWorkbenchState>(stationRunIdParam ? { status: "loading", stationRunId: stationRunIdParam } : { status: "idle" });
  const [reviewerId, setReviewerId] = useState("faculty_001");
  const [comments, setComments] = useState("");
  const [urgentRecognitionScore, setUrgentRecognitionScore] = useState("2");
  const [teamCommunicationScore, setTeamCommunicationScore] = useState("1");
  const [saveState, setSaveState] = useState<
    | { status: "idle" }
    | { status: "saving" }
    | { status: "saved" }
    | { status: "error"; message: string }
  >({ status: "idle" });

  useEffect(() => {
    const stationRunId = stationRunIdParam.trim();
    setStationRunIdInput(stationRunIdParam);
    setSaveState({ status: "idle" });
    if (!stationRunId) {
      setState({ status: "idle" });
      return;
    }

    let active = true;
    setState({ status: "loading", stationRunId });
    controlPlaneClient.getReviewPacketReplay({ stationRunId })
      .then((replay) => {
        if (!active) {
          return;
        }
        setState({ status: "ready", stationRunId, replay });
        setReviewerId(replay.reviewPacket?.facultyScoreDraft.reviewerId ?? "faculty_001");
        setComments(replay.reviewPacket?.facultyScoreDraft.comments ?? "");
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "error", stationRunId, message: error instanceof Error ? error.message : "Unknown review replay error" });
        }
      });

    return () => {
      active = false;
    };
  }, [controlPlaneClient, stationRunIdParam]);

  const loadReplay = () => {
    const stationRunId = stationRunIdInput.trim();
    if (stationRunId) {
      setSearchParams({ stationRunId });
    }
  };

  const saveDraft = async () => {
    if (state.status !== "ready" || !state.replay.reviewPacket) {
      return;
    }

    setSaveState({ status: "saving" });
    try {
      const savedPacket = await controlPlaneClient.saveFacultyScoreDraft({
        stationRunId: state.stationRunId,
        reviewerId,
        comments,
        rubricScores: {
          urgent_recognition: clampedScoreFromInput(urgentRecognitionScore),
          communication_team_family: clampedScoreFromInput(teamCommunicationScore),
        },
      });
      setState((currentState) => {
        if (currentState.status !== "ready" || !currentState.replay.reviewPacket) {
          return currentState;
        }
        return {
          ...currentState,
          replay: {
            ...currentState.replay,
            reviewPacket: {
              ...currentState.replay.reviewPacket,
              ...savedPacket,
              timeline: currentState.replay.reviewPacket.timeline,
              patientNote: currentState.replay.reviewPacket.patientNote,
            },
          },
        };
      });
      setSaveState({ status: "saved" });
    } catch (error) {
      setSaveState({ status: "error", message: error instanceof Error ? error.message : "Unknown faculty score draft error" });
    }
  };

  const packet = state.status === "ready" ? state.replay.reviewPacket : null;

  return (
    <section className="review-replay-workbench" aria-labelledby="review-replay-title" aria-label="Review packet replay workbench">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Generated ReviewPacketReplay</Typography.Text>
          <Typography.Title id="review-replay-title" level={3}>
            Review Replay
          </Typography.Title>
        </div>
        <Space wrap>
          <Input
            aria-label="Station run ID"
            className="station-run-input"
            id="review-replay-station-run-id"
            name="stationRunId"
            value={stationRunIdInput}
            onChange={(event) => setStationRunIdInput(event.target.value)}
            onPressEnter={loadReplay}
          />
          <Button type="primary" onClick={loadReplay} disabled={stationRunIdInput.trim().length === 0}>
            Load replay
          </Button>
        </Space>
      </div>

      {state.status === "idle" ? (
        <Alert type="info" title="Station run required" description="Enter a station run ID to replay trace evidence and record a faculty draft." showIcon />
      ) : null}
      {state.status === "loading" ? <Spin /> : null}
      {state.status === "error" ? (
        <Alert type="error" title="Review replay unavailable" description={state.message} showIcon />
      ) : null}

      {state.status === "ready" && !packet ? (
        <Alert type="warning" title="Review packet not found" description={state.stationRunId} showIcon />
      ) : null}

      {packet ? (
        <>
          <div className="readiness-strip review-replay-strip" aria-label="Review replay trace summary">
            <ReadinessMetric label={packet.scenarioId} detail={packet.stationRunId} />
            <ReadinessMetric label={`${packet.observedTraceTags.length} observed tags`} detail={`${packet.missingRequiredTraceTags.length} missing required`} />
            <ReadinessMetric label={`${packet.traceQuality.eventCount} trace events`} detail={`${packet.traceQuality.modelGeneratedEventCount} model generated`} />
            <ReadinessMetric label={`${packet.traceQuality.unsafeEventCount} unsafe events`} detail={`${packet.traceQuality.blockedGuardrailCount} blocked guardrails`} />
          </div>

          {saveState.status === "saved" ? (
            <Alert type="success" title="Faculty draft saved" description={`${packet.facultyScoreDraft.reviewerId} draft updated`} showIcon />
          ) : null}
          {saveState.status === "error" ? (
            <Alert type="error" title="Faculty draft failed" description={saveState.message} showIcon />
          ) : null}

          <div className="review-replay-grid">
            <section className="workbench-panel" aria-label="Required trace tag coverage">
              <Typography.Title level={4}>Trace Coverage</Typography.Title>
              <Typography.Text strong>Observed</Typography.Text>
              <div className="tag-row">
                {packet.observedTraceTags.map((tag) => (
                  <Tag key={tag} color="green">{tag}</Tag>
                ))}
              </div>
              <Typography.Text strong>Missing</Typography.Text>
              <div className="tag-row">
                {packet.missingRequiredTraceTags.length === 0 ? <Tag color="green">none</Tag> : packet.missingRequiredTraceTags.map((tag) => (
                  <Tag key={tag} color="gold">{tag}</Tag>
                ))}
              </div>
            </section>

            <section className="workbench-panel" aria-label="Review replay timeline">
              <Typography.Title level={4}>Timeline</Typography.Title>
              <ol className="compact-list replay-timeline-list">
                {packet.timeline.map((entry) => (
                  <li key={`${entry.sequence}:${entry.eventType}`}>
                    <Typography.Text>{entry.summary}</Typography.Text>
                    <Typography.Text type="secondary">{`${entry.atSecond}s / ${entry.eventType}${entry.tag ? ` / ${entry.tag}` : ""}`}</Typography.Text>
                  </li>
                ))}
              </ol>
            </section>

            <section className="workbench-panel" aria-label="Patient note">
              <Typography.Title level={4}>Patient Note</Typography.Title>
              {packet.patientNote ? (
                <>
                  <Typography.Text type="secondary">{`${packet.patientNote.submittedAtSecond}s`}</Typography.Text>
                  <Typography.Paragraph>{packet.patientNote.text}</Typography.Paragraph>
                </>
              ) : (
                <Typography.Paragraph className="empty-panel-note">No patient note submitted.</Typography.Paragraph>
              )}
            </section>

            <section className="workbench-panel faculty-score-panel" aria-label="Faculty score draft">
              <Typography.Title level={4}>Faculty Draft</Typography.Title>
              <label className="field-label">
                <Typography.Text strong>Faculty reviewer ID</Typography.Text>
                <Input
                  aria-label="Faculty reviewer ID"
                  id="faculty-reviewer-id"
                  name="facultyReviewerId"
                  value={reviewerId}
                  onChange={(event) => setReviewerId(event.target.value)}
                />
              </label>
              <label className="field-label">
                <Typography.Text strong>Faculty draft comments</Typography.Text>
                <TextArea
                  aria-label="Faculty draft comments"
                  id="faculty-draft-comments"
                  name="facultyDraftComments"
                  rows={4}
                  value={comments}
                  onChange={(event) => setComments(event.target.value)}
                />
              </label>
              <div className="score-input-grid">
                <label className="field-label">
                  <Typography.Text strong>Urgent recognition score</Typography.Text>
                  <Input
                    aria-label="Urgent recognition score"
                    id="urgent-recognition-score"
                    name="urgentRecognitionScore"
                    type="number"
                    min={0}
                    max={2}
                    value={urgentRecognitionScore}
                    onChange={(event) => setUrgentRecognitionScore(event.target.value)}
                  />
                </label>
                <label className="field-label">
                  <Typography.Text strong>Team communication score</Typography.Text>
                  <Input
                    aria-label="Team communication score"
                    id="team-communication-score"
                    name="teamCommunicationScore"
                    type="number"
                    min={0}
                    max={2}
                    value={teamCommunicationScore}
                    onChange={(event) => setTeamCommunicationScore(event.target.value)}
                  />
                </label>
              </div>
              <Button type="primary" loading={saveState.status === "saving"} onClick={() => void saveDraft()}>
                Save faculty draft
              </Button>
            </section>
          </div>
        </>
      ) : null}
    </section>
  );
}

type ScenarioBankWorkbenchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; scenarios: AdminScenario[] };

function ScenarioBankWorkbench({ controlPlaneClient }: { controlPlaneClient: AdminControlPlaneClient }): React.ReactElement {
  const [state, setState] = useState<ScenarioBankWorkbenchState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    controlPlaneClient.listScenarios()
      .then((scenarios) => {
        if (active) {
          setState({ status: "ready", scenarios });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "error", message: error instanceof Error ? error.message : "Unknown ScenarioBank error" });
        }
      });

    return () => {
      active = false;
    };
  }, [controlPlaneClient]);

  if (state.status === "loading") {
    return (
      <section className="scenario-bank-workbench" aria-labelledby="scenario-bank-title">
        <Typography.Title id="scenario-bank-title" level={3}>
          Scenario Bank
        </Typography.Title>
        <Spin />
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="scenario-bank-workbench" aria-labelledby="scenario-bank-title">
        <Typography.Title id="scenario-bank-title" level={3}>
          Scenario Bank
        </Typography.Title>
        <Alert type="error" title="Scenario bank unavailable" description={state.message} showIcon />
      </section>
    );
  }

  const approvedCount = state.scenarios.filter((scenario) => scenario.status === "APPROVED").length;
  const draftCount = state.scenarios.filter((scenario) => scenario.status === "DRAFT").length;
  const readyForReviewCount = state.scenarios.filter((scenario) => scenario.status === "READY_FOR_REVIEW").length;

  return (
    <section className="scenario-bank-workbench" aria-labelledby="scenario-bank-title" aria-label="Scenario bank governance">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Generated ScenarioBank</Typography.Text>
          <Typography.Title id="scenario-bank-title" level={3}>
            Scenario Bank
          </Typography.Title>
        </div>
        <Space wrap>
          <Tag color="green">{`${approvedCount} approved`}</Tag>
          <Tag color="gold">{`${draftCount} draft`}</Tag>
          <Tag color="blue">{`${readyForReviewCount} ready for review`}</Tag>
        </Space>
      </div>

      <div className="readiness-strip scenario-bank-strip" aria-label="Scenario bank status summary">
        <ReadinessMetric label={`${state.scenarios.length} scenarios`} detail={`${uniqueValues(state.scenarios.flatMap((scenario) => scenario.governance.requiredReviewerRoles)).length} reviewer roles`} />
        <ReadinessMetric label={`${approvedCount} approved`} detail={`${draftCount + readyForReviewCount} awaiting gates`} />
        <ReadinessMetric label={`${uniqueValues(state.scenarios.flatMap((scenario) => scenario.actors.map((actor) => actor.role))).length} actor roles`} detail={`${state.scenarios.reduce((total, scenario) => total + scenario.actors.length, 0)} virtual actors`} />
        <ReadinessMetric label={`${state.scenarios.reduce((total, scenario) => total + scenario.assetNeeds.length, 0)} asset needs`} detail="placeholder license posture" />
      </div>

      <div className="scenario-list">
        {state.scenarios.map((scenario) => (
          <article className="scenario-row" key={`${scenario.scenarioId}:${scenario.version}`}>
            <div className="scenario-row-main">
              <div>
                <Typography.Title level={4}>{scenario.title}</Typography.Title>
                <Typography.Text type="secondary">{`${scenario.scenarioId} v${scenario.version}`}</Typography.Text>
              </div>
              <Space wrap>
                <Tag color={scenarioStatusColor(scenario.status)}>{scenario.status.toLowerCase().replaceAll("_", " ")}</Tag>
                <Link to={`/scenarios/${scenario.scenarioId}?version=${scenario.version}`}>Open detail</Link>
              </Space>
            </div>

            <div className="scenario-row-grid">
              <section aria-label={`${scenario.title} review gates`}>
                <Typography.Text strong>Review gates</Typography.Text>
                <div className="tag-row">
                  {scenarioReviewGateEntries(scenario).map(([gate, stateName]) => (
                    <Tag key={gate} color={reviewGateColor(stateName)}>{`${gate}: ${stateName}`}</Tag>
                  ))}
                </div>
              </section>

              <section aria-label={`${scenario.title} actors`}>
                <Typography.Text strong>Actors</Typography.Text>
                <ol className="compact-list">
                  {scenario.actors.map((actor) => (
                    <li key={actor.actorId}>
                      <Typography.Text>{actor.displayName}</Typography.Text>
                      <Typography.Text type="secondary">{actor.role}</Typography.Text>
                    </li>
                  ))}
                </ol>
              </section>

              <section aria-label={`${scenario.title} governance`}>
                <Typography.Text strong>Governance</Typography.Text>
                <div className="tag-row">
                  {scenario.governance.requiredReviewerRoles.map((role) => (
                    <Tag key={role}>{role}</Tag>
                  ))}
                </div>
                <Typography.Text type="secondary">{formatScenarioGovernanceNotice(scenario)}</Typography.Text>
              </section>

              <section aria-label={`${scenario.title} trace tags and assets`}>
                <Typography.Text strong>{`${scenario.requiredTraceTags.length} trace tags`}</Typography.Text>
                <Typography.Text type="secondary">{`${scenario.assetNeeds.length} asset needs`}</Typography.Text>
              </section>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

type ScenarioDetailWorkbenchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: AdminScenarioDetail };

function ScenarioDetailWorkbench({ controlPlaneClient }: { controlPlaneClient: AdminControlPlaneClient }): React.ReactElement {
  const { scenarioId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const version = Number.parseInt(searchParams.get("version") ?? "1", 10);
  const [state, setState] = useState<ScenarioDetailWorkbenchState>({ status: "loading" });
  const [reviewDecisionState, setReviewDecisionState] = useState<
    | { status: "idle" }
    | { status: "saving" }
    | { status: "saved"; reviewerRole: string }
    | { status: "error"; message: string }
  >({ status: "idle" });

  useEffect(() => {
    let active = true;

    controlPlaneClient.getScenarioDetail({ scenarioId, version: Number.isFinite(version) ? version : 1 })
      .then((detail) => {
        if (active) {
          setState({ status: "ready", detail });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "error", message: error instanceof Error ? error.message : "Unknown ScenarioDetail error" });
        }
      });

    return () => {
      active = false;
    };
  }, [controlPlaneClient, scenarioId, version]);

  if (state.status === "loading") {
    return (
      <section className="scenario-detail-workbench" aria-labelledby="scenario-detail-title">
        <Link to="/scenarios">Back to Scenario Bank</Link>
        <Typography.Title id="scenario-detail-title" level={3}>
          Scenario Detail
        </Typography.Title>
        <Spin />
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="scenario-detail-workbench" aria-labelledby="scenario-detail-title">
        <Link to="/scenarios">Back to Scenario Bank</Link>
        <Typography.Title id="scenario-detail-title" level={3}>
          Scenario Detail
        </Typography.Title>
        <Alert type="error" title="Scenario detail unavailable" description={state.message} showIcon />
      </section>
    );
  }

  const { scenario, assetReadiness } = state.detail;

  if (!scenario) {
    return (
      <section className="scenario-detail-workbench" aria-labelledby="scenario-detail-title">
        <Link to="/scenarios">Back to Scenario Bank</Link>
        <Typography.Title id="scenario-detail-title" level={3}>
          Scenario Detail
        </Typography.Title>
        <Alert type="warning" title="Scenario not found" description={`${scenarioId} v${Number.isFinite(version) ? version : 1}`} showIcon />
      </section>
    );
  }

  const recordClinicalApproval = async () => {
    setReviewDecisionState({ status: "saving" });
    try {
      const nextScenario = await controlPlaneClient.submitScenarioReview({
        scenarioId: scenario.scenarioId,
        version: scenario.version,
        reviewerRole: "clinical",
        reviewerId: "admin_clinical_reviewer",
        decision: "APPROVED",
        comments: "Clinical reviewer approval recorded from the local admin workbench.",
        evidenceRefs: [`evidence:${scenario.scenarioId}:clinical:local-admin`],
      });
      setState((currentState) =>
        currentState.status === "ready"
          ? { ...currentState, detail: { ...currentState.detail, scenario: nextScenario } }
          : currentState
      );
      setReviewDecisionState({ status: "saved", reviewerRole: "clinical" });
    } catch (error) {
      setReviewDecisionState({ status: "error", message: error instanceof Error ? error.message : "Unknown review decision error" });
    }
  };

  return (
    <section className="scenario-detail-workbench" aria-labelledby="scenario-detail-title" aria-label="Scenario detail governance">
      <div className="workbench-title-row">
        <div>
          <Link to="/scenarios">Back to Scenario Bank</Link>
          <Typography.Text className="eyebrow">Generated ScenarioDetail</Typography.Text>
          <Typography.Title id="scenario-detail-title" level={3}>
            {scenario.title}
          </Typography.Title>
          <Typography.Text type="secondary">{`${scenario.scenarioId} v${scenario.version}`}</Typography.Text>
        </div>
        <Space wrap>
          <Button loading={reviewDecisionState.status === "saving"} onClick={() => void recordClinicalApproval()}>
            Record clinical approval
          </Button>
          <Tag color={scenarioStatusColor(scenario.status)}>{scenario.status.toLowerCase().replaceAll("_", " ")}</Tag>
          <Tag color={assetReadiness.devReady ? "green" : "red"}>Dev-ready assets</Tag>
          <Tag color={assetReadiness.productionReady ? "green" : "gold"}>
            {assetReadiness.productionReady ? "Production ready" : "Production blocked"}
          </Tag>
        </Space>
      </div>

      <Alert
        type="info"
        title="Governance posture"
        description={formatScenarioGovernanceNotice(scenario)}
        showIcon
      />

      {reviewDecisionState.status === "saved" ? (
        <Alert type="success" title="Review decision recorded" description={`${reviewDecisionState.reviewerRole} gate updated`} showIcon />
      ) : null}
      {reviewDecisionState.status === "error" ? (
        <Alert type="error" title="Review decision failed" description={reviewDecisionState.message} showIcon />
      ) : null}

      <div className="readiness-strip scenario-bank-strip" aria-label="Scenario detail summary">
        <ReadinessMetric label={`${scenario.clinicalObjectives.length} objectives`} detail={`${scenario.requiredTraceTags.length} required trace tags`} />
        <ReadinessMetric label={`${scenario.actors.length} actors`} detail={`${uniqueValues(scenario.actors.map((actor) => actor.role)).length} actor roles`} />
        <ReadinessMetric label={`${scenario.assetNeeds.length} asset needs`} detail={`${assetReadiness.productionBlockedAssets.length} production blockers`} />
        <ReadinessMetric label={scenario.environment?.name ?? "Environment pending"} detail={`${scenario.equipment.length} equipment items`} />
      </div>

      <div className="scenario-detail-grid">
        <section className="workbench-panel" aria-label="Scenario environment">
          <Typography.Title level={4}>Environment</Typography.Title>
          <Typography.Text strong>{scenario.environment?.name ?? "Environment pending"}</Typography.Text>
          <Typography.Paragraph>{scenario.environment?.description ?? "No environment description supplied."}</Typography.Paragraph>
          <Typography.Text type="secondary">{scenario.environment?.environmentId ?? "missing environment ID"}</Typography.Text>
        </section>

        <section className="workbench-panel" aria-label="Scenario equipment">
          <Typography.Title level={4}>Equipment</Typography.Title>
          <ol className="compact-list">
            {scenario.equipment.map((item) => (
              <li key={item}>
                <Typography.Text>{item}</Typography.Text>
              </li>
            ))}
          </ol>
        </section>

        <section className="workbench-panel" aria-label="Scenario actors">
          <Typography.Title level={4}>Actors</Typography.Title>
          <ol className="compact-list">
            {scenario.actors.map((actor) => (
              <li key={actor.actorId}>
                <Typography.Text>{actor.displayName}</Typography.Text>
                <Typography.Text type="secondary">{`${actor.role}${actor.demeanor ? `, ${actor.demeanor}` : ""}`}</Typography.Text>
              </li>
            ))}
          </ol>
        </section>

        <section className="workbench-panel" aria-label="Scenario review gates">
          <Typography.Title level={4}>Review Gates</Typography.Title>
          <div className="tag-row">
            {scenarioReviewGateEntries(scenario).map(([gate, stateName]) => (
              <Tag key={gate} color={reviewGateColor(stateName)}>{`${gate}: ${stateName}`}</Tag>
            ))}
          </div>
        </section>

        <section className="workbench-panel" aria-label="Scenario asset needs">
          <Typography.Title level={4}>Asset Needs</Typography.Title>
          <ol className="compact-list">
            {scenario.assetNeeds.map((asset) => (
              <li key={asset.assetId}>
                <Typography.Text>{asset.assetId}</Typography.Text>
                <Typography.Text type="secondary">{`${asset.assetType} / ${asset.licenseStatus}`}</Typography.Text>
              </li>
            ))}
          </ol>
        </section>

        <section className="workbench-panel" aria-label="Scenario production blockers">
          <Typography.Title level={4}>Production Blockers</Typography.Title>
          {assetReadiness.productionBlockedAssets.length === 0 ? (
            <Typography.Paragraph className="empty-panel-note">No production blockers recorded.</Typography.Paragraph>
          ) : (
            <ol className="compact-list">
              {assetReadiness.productionBlockedAssets.map((asset) => (
                <li key={asset.assetId}>
                  <Typography.Text>{asset.assetId}</Typography.Text>
                  <Typography.Text type="secondary">{asset.blockers.join(", ")}</Typography.Text>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </section>
  );
}

type SeedBlueprintWorkbenchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
    status: "ready";
    blueprint: ExamBlueprint;
    readiness: BlueprintScenarioReadiness;
    timingPlan: ExamTimingPlan;
    stationRunQueue: ExamStationRunQueue;
    queueSnapshots: AdminStationRunQueueSnapshot[];
    assetReadiness: ScenarioAssetReadiness[];
  };

function SeedBlueprintWorkbench({ controlPlaneClient }: { controlPlaneClient: AdminControlPlaneClient }): React.ReactElement {
  const [state, setState] = useState<SeedBlueprintWorkbenchState>({ status: "loading" });
  const [snapshotState, setSnapshotState] = useState<
    | { status: "idle" }
    | { status: "saving" }
    | { status: "saved"; snapshotId: string }
    | { status: "error"; message: string }
  >({ status: "idle" });

  useEffect(() => {
    let active = true;

    Promise.all([
      controlPlaneClient.getStep2CsSeedBlueprint(),
      controlPlaneClient.getStep2CsSeedBlueprintReadiness(),
      controlPlaneClient.getStep2CsSeedTimingPlan(),
      controlPlaneClient.getStep2CsSeedStationRunQueue(),
      controlPlaneClient.listStep2CsSeedStationRunQueueSnapshots(),
      controlPlaneClient.getScenarioBankAssetReadiness(),
    ])
      .then(([blueprint, readiness, timingPlan, stationRunQueue, queueSnapshots, assetReadiness]) => {
        if (active) {
          setState({ status: "ready", blueprint, readiness, timingPlan, stationRunQueue, queueSnapshots, assetReadiness });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ status: "error", message: error instanceof Error ? error.message : "Unknown admin API error" });
        }
      });

    return () => {
      active = false;
    };
  }, [controlPlaneClient]);

  if (state.status === "loading") {
    return (
      <section className="seed-workbench" aria-labelledby="seed-exam-readiness-title">
        <Typography.Title id="seed-exam-readiness-title" level={3}>
          Seed Exam Readiness
        </Typography.Title>
        <Spin />
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="seed-workbench" aria-labelledby="seed-exam-readiness-title">
        <Typography.Title id="seed-exam-readiness-title" level={3}>
          Seed Exam Readiness
        </Typography.Title>
        <Alert type="error" title="Control-plane data unavailable" description={state.message} showIcon />
      </section>
    );
  }

  const productionReadyScenes = state.assetReadiness.filter((readiness) => readiness.productionReady).length;
  const devReadyScenes = state.assetReadiness.filter((readiness) => readiness.devReady).length;
  const firstBlockedScenario = state.readiness.blockedScenarioIds[0];
  const createSnapshot = async () => {
    setSnapshotState({ status: "saving" });
    try {
      const snapshot = await controlPlaneClient.createStep2CsSeedStationRunQueueSnapshot({
        reviewerId: "admin_seed_reviewer",
        createdAt: new Date().toISOString(),
      });
      const queueSnapshots = await controlPlaneClient.listStep2CsSeedStationRunQueueSnapshots();
      setState((currentState) => currentState.status === "ready" ? { ...currentState, queueSnapshots } : currentState);
      setSnapshotState({ status: "saved", snapshotId: snapshot.snapshotId });
    } catch (error) {
      setSnapshotState({ status: "error", message: error instanceof Error ? error.message : "Unknown snapshot error" });
    }
  };

  return (
    <section className="seed-workbench" aria-labelledby="seed-exam-readiness-title">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Clinical-skills seed form</Typography.Text>
          <Typography.Title id="seed-exam-readiness-title" level={3}>
            Seed Exam Readiness
          </Typography.Title>
        </div>
        <Space wrap>
          <Button type="primary" loading={snapshotState.status === "saving"} onClick={() => void createSnapshot()}>
            Create review snapshot
          </Button>
          <Tag color={state.readiness.canAssembleReadyForm ? "green" : "gold"}>
            {state.readiness.canAssembleReadyForm ? "Assembly ready" : "Review blocked"}
          </Tag>
        </Space>
      </div>

      <Alert
        aria-label="Seed exam governance notice"
        type="info"
        title={seedExamGovernanceCopy.scoreUseNotice}
        description={`${seedExamGovernanceCopy.syntheticCaseNotice} ${seedExamGovernanceCopy.validationNotice} ${seedExamGovernanceCopy.humanReviewNotice}`}
        showIcon
      />

      <div className="readiness-strip" aria-label="Seed exam readiness summary">
        <ReadinessMetric label={`${state.blueprint.stationSlots.length} stations`} detail={`${state.blueprint.requiredTraceTags.length} trace tags`} />
        <ReadinessMetric label={`${state.readiness.activationEligibleScenarioIds.length} activation ready`} detail={`${state.readiness.stationCount.candidate} candidates`} />
        <ReadinessMetric label={`${state.readiness.blockedScenarioIds.length} blocked drafts`} detail={firstBlockedScenario?.reason ?? "none"} />
        <ReadinessMetric label={`${formatDuration(state.timingPlan.totalStationTimeSeconds)} total`} detail={`${state.timingPlan.breakCheckpoints.length} scheduled breaks`} />
        <ReadinessMetric label={`${devReadyScenes} dev-ready scenes`} detail={`${productionReadyScenes} production-ready scenes`} />
        <ReadinessMetric
          label={state.stationRunQueue.canStartLearnerExam ? "Learner launch ready" : "Learner launch blocked"}
          detail={`${state.stationRunQueue.summary.draftBlocked} draft-blocked stations`}
        />
      </div>

      {snapshotState.status === "saved" ? <Alert type="success" title="Review snapshot saved" description={snapshotState.snapshotId} showIcon /> : null}
      {snapshotState.status === "error" ? <Alert type="error" title="Review snapshot failed" description={snapshotState.message} showIcon /> : null}

      <div className="workbench-panels">
        <section className="workbench-panel station-queue-panel" aria-labelledby="station-queue-title">
          <Typography.Title id="station-queue-title" level={4}>
            Station Run Queue
          </Typography.Title>
          <Typography.Text>{`${state.stationRunQueue.summary.activationReady} activation-ready station, ${state.stationRunQueue.summary.draftBlocked} draft-blocked stations`}</Typography.Text>
          <ol className="station-queue-list">
            {state.stationRunQueue.stationQueue.map((station) => (
              <li key={station.slotId}>
                <div className="station-queue-row">
                  <Typography.Text strong>{`Station ${station.stationOrder}`}</Typography.Text>
                  <Tag color={station.status === "activation_ready" ? "green" : "gold"}>{station.status}</Tag>
                </div>
                <Typography.Text>{station.scenarioId ?? "missing scenario"}</Typography.Text>
                {station.blockers.length > 0 ? <Typography.Text type="secondary">{station.blockers.join(", ")}</Typography.Text> : null}
              </li>
            ))}
          </ol>
        </section>

        <section className="workbench-panel" aria-label="Queue review snapshot history">
          <Typography.Title level={4}>Review Snapshots</Typography.Title>
          <Typography.Text>{`${state.queueSnapshots.length} saved reviewer snapshot${state.queueSnapshots.length === 1 ? "" : "s"}`}</Typography.Text>
          {state.queueSnapshots.length === 0 ? (
            <Typography.Paragraph className="empty-panel-note">No review snapshots yet.</Typography.Paragraph>
          ) : (
            <ol className="queue-snapshot-list">
              {state.queueSnapshots.map((snapshot) => (
                <li key={snapshot.snapshotId}>
                  <div className="station-queue-row">
                    <Typography.Text strong>{snapshot.snapshotId}</Typography.Text>
                    <Tag color={snapshot.queue.canStartLearnerExam ? "green" : "gold"}>
                      {snapshot.queue.canStartLearnerExam ? "launch ready" : "blocked"}
                    </Tag>
                  </div>
                  <Typography.Text>{snapshot.reviewerId ?? "unassigned reviewer"}</Typography.Text>
                  <Typography.Text type="secondary">{formatSnapshotQueueSummary(snapshot)}</Typography.Text>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="workbench-panel" aria-labelledby="timing-title">
          <Typography.Title id="timing-title" level={4}>
            Timing
          </Typography.Title>
          <Typography.Text>{`Breaks after stations ${state.timingPlan.breakCheckpoints.map((checkpoint) => checkpoint.afterStationOrder).join(", ")}`}</Typography.Text>
          <ol className="station-window-list">
            {state.timingPlan.stationWindows.slice(0, 6).map((window) => (
              <li key={window.slotId}>
                <Typography.Text strong>{`Station ${window.stationOrder}`}</Typography.Text>
                <Typography.Text>{`Doorway ${formatMinutes(window.doorway.durationSeconds)}, encounter ${formatMinutes(window.encounter.durationSeconds)}, note ${formatMinutes(window.note.durationSeconds)}`}</Typography.Text>
              </li>
            ))}
          </ol>
        </section>

        <section className="workbench-panel" aria-labelledby="blocked-scenarios-title">
          <Typography.Title id="blocked-scenarios-title" level={4}>
            Blocked Scenarios
          </Typography.Title>
          <ol className="blocked-scenario-list">
            {state.readiness.blockedScenarioIds.map((blockedScenario) => (
              <li key={blockedScenario.scenarioId}>
                <Typography.Text strong>{blockedScenario.scenarioId}</Typography.Text>
                <Tag color="gold">{blockedScenario.reason}</Tag>
              </li>
            ))}
          </ol>
        </section>

        <section className="workbench-panel" aria-labelledby="asset-readiness-title">
          <Typography.Title id="asset-readiness-title" level={4}>
            Asset Readiness
          </Typography.Title>
          <Typography.Text>{`${state.assetReadiness.length} scenario manifests generated from the seed bank`}</Typography.Text>
          <ol className="asset-readiness-list">
            {state.assetReadiness.map((assetReadiness) => (
              <li key={assetReadiness.scenarioId}>
                <Typography.Text strong>{assetReadiness.scenarioId}</Typography.Text>
                <Tag color={assetReadiness.devReady ? "green" : "red"}>{assetReadiness.devReady ? "dev ready" : "blocked"}</Tag>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </section>
  );
}

function ReadinessMetric({ label, detail }: { label: string; detail: string }): React.ReactElement {
  return (
    <div className="readiness-metric">
      <Typography.Text strong>{label}</Typography.Text>
      <Typography.Text type="secondary">{detail}</Typography.Text>
    </div>
  );
}

function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatMinutes(seconds: number): string {
  return `${Math.round(seconds / 60)}m`;
}

function formatSnapshotQueueSummary(snapshot: AdminStationRunQueueSnapshot): string {
  const blocked =
    snapshot.queue.summary.draftBlocked + snapshot.queue.summary.governanceBlocked + snapshot.queue.summary.missingScenario;

  return `${snapshot.queue.summary.activationReady} activation-ready / ${blocked} blocked`;
}

function scenarioStatusColor(status: AdminScenario["status"]): string {
  switch (status) {
    case "APPROVED":
      return "green";
    case "READY_FOR_REVIEW":
      return "blue";
    case "DRAFT":
      return "gold";
    case "ARCHIVED":
      return "default";
  }
}

function reviewGateColor(stateName: string): string {
  return stateName === "approved" ? "green" : stateName === "in_review" ? "blue" : "gold";
}

function scenarioReviewGateEntries(scenario: AdminScenario): Array<[string, string]> {
  return Object.entries(scenario.review).filter(([gate, stateName]) =>
    gate !== "__typename" && typeof stateName === "string"
  ) as Array<[string, string]>;
}

function formatScenarioGovernanceNotice(scenario: AdminScenario): string {
  const scoreUseNotice = scoreUseCopy[scenario.governance.scoreUseLabel as keyof typeof scoreUseCopy]
    ?? safeUserFacingClaimLanguage.formativeAssessment;
  const validationNotice = validationStageCopy[scenario.governance.validationStage as keyof typeof validationStageCopy]
    ?? safeUserFacingClaimLanguage.humanReview;

  return `${scoreUseNotice} ${validationNotice} ${safeUserFacingClaimLanguage.syntheticScenario}`;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function clampedScoreFromInput(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(2, Math.max(0, parsed));
}

function capabilityTagColor(tag: string): string {
  const colorByTag = new Map([
    ["GraphQL Codegen", "green"],
    ["Apollo Client", "blue"],
    ["ProComponents v3", "purple"],
    ["React Router", "cyan"],
    ["Ant Design 6", "gold"],
  ]);

  return colorByTag.get(tag) ?? "default";
}
