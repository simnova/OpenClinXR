import { nodeConfig, worktreeExcludePatterns } from "@cellix/config-vitest/node";
import { defaultExclude, defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  nodeConfig,
  defineConfig({
    test: {
      exclude: [...defaultExclude, ...worktreeExcludePatterns, "**/*.integration.test.ts"],
    },
  }),
);
