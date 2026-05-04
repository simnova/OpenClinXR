import { describe, expect, it } from "vitest";
import { openClinXrAdminBuildOutput, openClinXrApiProxy } from "./vite.config.js";

describe("ui-admin Vite local API proxy", () => {
  it("proxies control-plane and XR runtime routes to the local API server", () => {
    expect(openClinXrApiProxy).toMatchObject({
      "/exam-blueprints": { target: "http://localhost:3000", changeOrigin: true },
      "/scenario-bank": { target: "http://localhost:3000", changeOrigin: true },
      "/scenarios": { target: "http://localhost:3000", changeOrigin: true },
      "/sessions": { target: "http://localhost:3000", changeOrigin: true },
    });
  });

  it("enables Rolldown code splitting for the Apollo and AntD admin bundle", () => {
    expect(openClinXrAdminBuildOutput.codeSplitting).toMatchObject({
      groups: [
        { name: "react-vendor", priority: 30 },
        { name: "antd-vendor", priority: 25 },
        { name: "graphql-vendor", priority: 20 },
        { name: "vendor", priority: 10 },
      ],
    });
  });
});
