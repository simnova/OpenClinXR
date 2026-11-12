import { Card, Steps, Typography } from "antd";
import { Link } from "react-router";

/** One workbench card: the route's path, label and one-line description. */
export interface WorkbenchOverviewRoute {
  path: string;
  label: string;
  description: string;
}

/** The admin "/" overview: one card per workbench route, then the publication gates in review order. */
export function WorkbenchOverview({ routes, gates }: { routes: readonly WorkbenchOverviewRoute[]; gates: readonly string[] }): React.ReactElement {
  return (
    <div className="admin-grid">
      {routes.map((route) => (
        <Card key={route.path} title={route.label}>
          <Typography.Paragraph>{route.description}</Typography.Paragraph>
          <Link to={route.path}>Open {route.label}</Link>
        </Card>
      ))}
      <Card title="Publication gates">
        <Steps
          orientation="vertical"
          size="small"
          items={gates.map((title, index) => ({
            title,
            status: index === 0 ? "process" : "wait",
          }))}
        />
      </Card>
    </div>
  );
}
