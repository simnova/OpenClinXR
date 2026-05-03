import { describe, expect, it } from "vitest";
import { openClinXrApiProxy } from "./vite.config.js";

describe("ui-admin Vite local API proxy", () => {
  it("proxies control-plane and XR runtime routes to the local API server", () => {
    expect(openClinXrApiProxy).toMatchObject({
      "/exam-blueprints": { target: "http://localhost:3000", changeOrigin: true },
      "/scenario-bank": { target: "http://localhost:3000", changeOrigin: true },
      "/scenarios": { target: "http://localhost:3000", changeOrigin: true },
      "/sessions": { target: "http://localhost:3000", changeOrigin: true },
    });
  });
});
