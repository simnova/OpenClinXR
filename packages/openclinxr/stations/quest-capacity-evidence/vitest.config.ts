import { nodeConfig } from "@cellix/config-vitest/node";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  nodeConfig,
  defineConfig({
    test: {
      // T0: cli + secure-build-identity are serial-browser today and the
      // stage1/stage2-adjacent node:test files run under node --test via the
      // package test script, never under vitest. Keep files serial (the
      // station's own vitest.config.ts already sets fileParallelism: false)
      // and exclude the stage2 dir so vitest never loads node:test files.
      fileParallelism: false,
      exclude: ["src/quest-capacity/stage2/**"],
    },
  }),
);
