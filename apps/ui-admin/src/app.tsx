import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { adminPublicationGates, adminWorkbenchRoutes, ScenarioBankWorkbenchProvider, ScenarioBankWorkbenchUI, ReviewReplayWorkbenchProvider, ReviewReplayWorkbenchUI, SeedBlueprintWorkbenchProvider, SeedBlueprintWorkbenchUI, ScenarioDetailWorkbenchProvider, ScenarioDetailWorkbenchUI, capabilityTagColor } from "@openclinxr/ui-route-admin";
import { adminWorkbenchCapabilityTags, openClinXrAdminTheme } from "@openclinxr/ui-shared";
import "@xyflow/react/dist/style.css";
import { Card, ConfigProvider, Layout, Space, Steps, Tag, Typography } from "antd";
import { Link } from "react-router";
import { useMemo } from "react";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router";
import { buildAdminGraphqlEndpoint, createAdminControlPlaneClient, compileEncounterWorld, type AdminControlPlaneClient } from "@openclinxr/ui-route-shared";
import { CaseAuthoringWorkbench, type FacultyCompileLockClient } from "@openclinxr/ui-route-admin";

const { Content, Sider } = Layout;

type AdminAppProps = {
  router?: "browser" | "memory";
  initialPath?: string;
  controlPlaneClient?: AdminControlPlaneClient & FacultyCompileLockClient;
};

const adminApolloClient = new ApolloClient({
  cache: new InMemoryCache(),
  link: new HttpLink({ uri: buildAdminGraphqlEndpoint("") }),
});

export function AdminApp({ router = "memory", initialPath = "/", controlPlaneClient }: AdminAppProps): React.ReactElement {
  const client = useMemo(() => controlPlaneClient ?? createAdminControlPlaneClient({ apolloClient: adminApolloClient }), [controlPlaneClient]);
  const factoryRunTableBaseUrl = import.meta.env["VITE_OPENCLINXR_API_BASE_URL"] ?? "";

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
                <Route path="/authoring" element={<CaseAuthoringWorkbench />} />
                <Route path="/scenarios" element={
                  <ScenarioBankWorkbenchProvider controlPlaneClient={client}>
                    <ScenarioBankWorkbenchUI />
                  </ScenarioBankWorkbenchProvider>
                } />
                <Route path="/scenarios/:scenarioId" element={
                  <ScenarioDetailWorkbenchProvider controlPlaneClient={client}>
                    <ScenarioDetailWorkbenchUI />
                  </ScenarioDetailWorkbenchProvider>
                } />
                <Route path="/reviews" element={
                  <ReviewReplayWorkbenchProvider controlPlaneClient={client}>
                    <ReviewReplayWorkbenchUI />
                  </ReviewReplayWorkbenchProvider>
                } />
                {/* SeedBlueprintWorkbench owns its own factory-run fetch, world-compile wiring,
                    SeedWorldviewQueue, and snapshot UI. The composition root passes only the
                    client surface and env-derived config. */}
                <Route path="/exam-forms" element={
                  <SeedBlueprintWorkbenchProvider controlPlaneClient={client} compileEncounterWorld={compileEncounterWorld} factoryRunTableBaseUrl={factoryRunTableBaseUrl}>
                    <SeedBlueprintWorkbenchUI />
                  </SeedBlueprintWorkbenchProvider>
                } />
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