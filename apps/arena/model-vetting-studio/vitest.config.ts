import { nodeConfig } from "@cellix/config-vitest/node";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  nodeConfig,
  defineConfig({
    test: {
      // Default node env keeps the three.js suites and node:fs fixture reads
      // intact (jsdom rewrites import.meta.url to http:, breaking fileURLToPath,
      // and turns new URL(dynamic, import.meta.url) into a denied fs glob).
      // React admin *.test.tsx files opt into jsdom via a per-file docblock.
      environment: "node",
    },
  }),
);
