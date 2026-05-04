import { defineConfig } from "tsdown";

export const openClinXrAzureFunctionsTsdownConfig = defineConfig({
  entry: "src/index.ts",
  platform: "node",
  format: "esm",
  target: "node20",
  clean: true,
  minify: true,
  sourcemap: true,
  outDir: "deploy/dist",
  deps: {
    neverBundle: ["@azure/functions-core"],
    alwaysBundle: [/^@openclinxr\//, "hono", "graphql"],
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
  },
  outputOptions: {
    entryFileNames: "index.js",
  },
});

export default openClinXrAzureFunctionsTsdownConfig;
