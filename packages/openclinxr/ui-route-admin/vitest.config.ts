import { nodeConfig } from "@cellix/config-vitest/node";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  nodeConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      // Matches apps/ui-admin, which these panels and their tests came from.
      testTimeout: 20_000,
    },
  }),
);
