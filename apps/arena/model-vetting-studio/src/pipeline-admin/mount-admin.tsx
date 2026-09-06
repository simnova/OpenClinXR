import { ConfigProvider } from "antd";
import { createRoot } from "react-dom/client";
import { PipelineAdminApp } from "./pipeline-admin-app.js";
import { openClinXrVettingTheme } from "./theme.js";

/** Mount the React + antd Pipeline Administration admin surface into an element. */
export function mountPipelineAdmin(mount: HTMLElement, indexOverrideUrl?: string | null): void {
  mount.replaceChildren();
  const root = createRoot(mount);
  root.render(
    <ConfigProvider theme={openClinXrVettingTheme}>
      <PipelineAdminApp indexOverrideUrl={indexOverrideUrl ?? null} />
    </ConfigProvider>,
  );
}
