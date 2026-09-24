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
      // Reached via @openclinxr/factory-stations -> room_generate/run.js -> simplify.js (added
      // 2026-09-22). MIT, pure JS with inline WASM; bundling it keeps the Functions deploy
      // self-contained like the other entries.
      "meshoptimizer",
    ],
  },
  outputOptions: {
    entryFileNames: "index.js",
  },
});

export default openClinXrAzureFunctionsTsdownConfig;
