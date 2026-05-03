import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { adminPublicationGates, adminWorkbenchRoutes } from "@openclinxr/ui-route-admin";
import { adminWorkbenchCapabilityTags, openClinXrAdminTheme } from "@openclinxr/ui-shared";
import { Card, ConfigProvider, Layout, Space, Steps, Tag, Typography } from "antd";
import { BrowserRouter, Link, MemoryRouter, Route, Routes } from "react-router";

const { Content, Sider } = Layout;

type AdminAppProps = {
  router?: "browser" | "memory";
};

export const adminApolloClient = new ApolloClient({
  cache: new InMemoryCache(),
  link: new HttpLink({ uri: "/admin/graphql" }),
});

export function AdminApp({ router = "memory" }: AdminAppProps): React.ReactElement {
  const Router = router === "browser" ? BrowserRouter : MemoryRouter;

  return (
    <ConfigProvider theme={openClinXrAdminTheme}>
      <ApolloProvider client={adminApolloClient}>
        <Router>
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
                <Route path="/exam-forms" element={<WorkbenchPanel routeId="exam-form-workbench" />} />
              </Routes>
            </Content>
          </Layout>
        </Router>
      </ApolloProvider>
    </ConfigProvider>
  );
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
