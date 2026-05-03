import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import type { ScenarioAssetReadiness } from "@openclinxr/asset-registry";
import type { BlueprintScenarioReadiness, ExamBlueprint, ExamTimingPlan } from "@openclinxr/exam-assembly";
import { adminPublicationGates, adminWorkbenchRoutes } from "@openclinxr/ui-route-admin";
import { adminWorkbenchCapabilityTags, openClinXrAdminTheme } from "@openclinxr/ui-shared";
import { Alert, Card, ConfigProvider, Layout, Space, Spin, Steps, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Link, MemoryRouter, Route, Routes } from "react-router";
import { createAdminControlPlaneClient, type AdminControlPlaneClient } from "./api-client.js";

const { Content, Sider } = Layout;

type AdminAppProps = {
  router?: "browser" | "memory";
  initialPath?: string;
  controlPlaneClient?: AdminControlPlaneClient;
};

export const adminApolloClient = new ApolloClient({
  cache: new InMemoryCache(),
  link: new HttpLink({ uri: "/admin/graphql" }),
});

export function AdminApp({ router = "memory", initialPath = "/", controlPlaneClient }: AdminAppProps): React.ReactElement {
  const client = useMemo(() => controlPlaneClient ?? createAdminControlPlaneClient(), [controlPlaneClient]);

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
                <Route path="/scenarios" element={<WorkbenchPanel routeId="scenario-bank" />} />
                <Route path="/reviews" element={<WorkbenchPanel routeId="review-packet-replay" />} />
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

function WorkbenchPanel({ routeId }: { routeId: string }): React.ReactElement {
  return (
    <Card title={routeId}>
      <Typography.Paragraph>
        This route is reserved for the generated GraphQL operation document and an Apollo-backed workbench module.
      </Typography.Paragraph>
    </Card>
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
    assetReadiness: ScenarioAssetReadiness[];
  };

function SeedBlueprintWorkbench({ controlPlaneClient }: { controlPlaneClient: AdminControlPlaneClient }): React.ReactElement {
  const [state, setState] = useState<SeedBlueprintWorkbenchState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    Promise.all([
      controlPlaneClient.getStep2CsSeedBlueprint(),
      controlPlaneClient.getStep2CsSeedBlueprintReadiness(),
      controlPlaneClient.getStep2CsSeedTimingPlan(),
      controlPlaneClient.getScenarioBankAssetReadiness(),
    ])
      .then(([blueprint, readiness, timingPlan, assetReadiness]) => {
        if (active) {
          setState({ status: "ready", blueprint, readiness, timingPlan, assetReadiness });
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

  return (
    <section className="seed-workbench" aria-labelledby="seed-exam-readiness-title">
      <div className="workbench-title-row">
        <div>
          <Typography.Text className="eyebrow">Step 2 CS-style seed form</Typography.Text>
          <Typography.Title id="seed-exam-readiness-title" level={3}>
            Seed Exam Readiness
          </Typography.Title>
        </div>
        <Tag color={state.readiness.canAssembleReadyForm ? "green" : "gold"}>
          {state.readiness.canAssembleReadyForm ? "Assembly ready" : "Review blocked"}
        </Tag>
      </div>

      <div className="readiness-strip" aria-label="Seed exam readiness summary">
        <ReadinessMetric label={`${state.blueprint.stationSlots.length} stations`} detail={`${state.blueprint.requiredTraceTags.length} trace tags`} />
        <ReadinessMetric label={`${state.readiness.activationEligibleScenarioIds.length} activation ready`} detail={`${state.readiness.stationCount.candidate} candidates`} />
        <ReadinessMetric label={`${state.readiness.blockedScenarioIds.length} blocked drafts`} detail={firstBlockedScenario?.reason ?? "none"} />
        <ReadinessMetric label={`${formatDuration(state.timingPlan.totalStationTimeSeconds)} total`} detail={`${state.timingPlan.breakCheckpoints.length} scheduled breaks`} />
        <ReadinessMetric label={`${devReadyScenes} dev-ready scenes`} detail={`${productionReadyScenes} production-ready scenes`} />
      </div>

      <div className="workbench-panels">
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
