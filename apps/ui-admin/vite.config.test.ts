import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createOpenClinXrApiProxy, openClinXrAdminBuildOutput, openClinXrApiProxy } from "./vite.config.js";

describe("ui-admin Vite local API proxy", () => {
  it("proxies control-plane and XR runtime routes to the local API server", () => {
    expect(openClinXrApiProxy).toMatchObject({
      "/exam-blueprints": { target: "http://localhost:3000", changeOrigin: true },
      "/runtime": { target: "http://localhost:3000", changeOrigin: true },
      "/scenario-bank": { target: "http://localhost:3000", changeOrigin: true },
      "/sessions": { target: "http://localhost:3000", changeOrigin: true },
      "/voice": { target: "http://localhost:3000", changeOrigin: true },
    });
    expect(openClinXrApiProxy).not.toHaveProperty("/scenarios");
  });

  it("allows local browser smoke runs to point the dev proxy at a non-default API port", () => {
    expect(createOpenClinXrApiProxy("http://127.0.0.1:3001")).toMatchObject({
      "/admin": { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/runtime": { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/scenario-bank": { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/voice": { target: "http://127.0.0.1:3001", changeOrigin: true },
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

  it("keeps the Portless dev script aligned to an injected or admin fallback app port", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    const portParameter = "$" + "{PORT:-5174}";

    expect(packageJson.scripts?.["dev:portless"]).toBe(`vite --host 127.0.0.1 --port ${portParameter} --strictPort`);
  });
});
