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
});
