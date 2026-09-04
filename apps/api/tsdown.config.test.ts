import { describe, expect, it } from "vitest";
import { openClinXrAzureFunctionsTsdownConfig } from "./tsdown.config.js";

describe("OpenClinXR API Azure Functions tsdown config", () => {
  it("bundles application dependencies into a stable deploy entry", () => {
    expect(openClinXrAzureFunctionsTsdownConfig).toMatchObject({
      entry: "src/index.ts",
      platform: "node",
      format: "esm",
      target: "node20",
      minify: true,
      sourcemap: true,
      outDir: "deploy/dist",
      outputOptions: {
        entryFileNames: "index.js",
      },
    });
    expect(openClinXrAzureFunctionsTsdownConfig.deps).toMatchObject({
      neverBundle: ["@azure/functions-core"],
      alwaysBundle: [expect.any(RegExp), "hono", "graphql"],
      onlyBundle: [
        "graphql",
        "@sinclair/typebox",
        "ajv",
        "fast-deep-equal",
        "json-schema-traverse",
        "fast-uri",
        "ajv-formats",
        "hono",
      ],
    });
  });

  it("refuses to onlyBundle tinyglobby/fdir/picomatch (tsk_3d58a7161a0a9bee counterweight)", () => {
    const only = openClinXrAzureFunctionsTsdownConfig.deps?.onlyBundle;
    const names = Array.isArray(only)
      ? only.filter((item): item is string => typeof item === "string")
      : [];
    expect(names).not.toContain("tinyglobby");
    expect(names).not.toContain("fdir");
    expect(names).not.toContain("picomatch");
  });
});
