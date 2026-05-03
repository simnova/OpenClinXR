import { describe, expect, it } from "vitest";
import { createOpenClinXrAzureFunctionsRolldownConfig, summarizeRolldownAdoption } from "./index.js";

describe("OpenClinXR Rolldown config adoption", () => {
  it("creates an Azure Functions bundle config shaped after Cellix config-rolldown", () => {
    const config = createOpenClinXrAzureFunctionsRolldownConfig({
      appPackageName: "@openclinxr/api",
      repoRoot: "/repo",
    });

    expect(config).toMatchObject({
      input: "./dist/index.js",
      platform: "node",
      treeshake: true,
      external: [/^node:/, "@azure/functions-core"],
      output: {
        dir: "deploy/dist",
        format: "esm",
        sourcemap: true,
      },
    });
    expect(config.resolve.alias["@openclinxr/api"]).toBe("/repo/apps/api/dist/index.js");
    expect(config.transform.define.__dirname).toBe("import.meta.dirname");
    expect(config.output.banner).toContain("globalThis.require");
  });

  it("documents why OpenClinXR owns a local config before copying Cellix config packages", () => {
    expect(summarizeRolldownAdoption()).toEqual({
      candidateCellixPackage: "@cellix/config-rolldown",
      localPackage: "@openclinxr/config-rolldown",
      status: "local_compatibility_spike",
      reason: "Cellix config-rolldown is useful, but OpenClinXR needs a verified package layout and latest Rolldown compatibility before vendoring Cellix-derived code.",
    });
  });
});
