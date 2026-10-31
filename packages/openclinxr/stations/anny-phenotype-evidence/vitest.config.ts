import { nodeConfig } from "@cellix/config-vitest/node";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  nodeConfig,
  defineConfig({
    test: {
      // T0/T10: all 14 tests are serial-spawn (serialPoolOf reports serial-spawn
      // for each: they spawn python3/pnpm/tsx per case and run single-threaded
      // under the tools runner with --no-file-parallelism). Keep files serial in
      // the sidecar the way the humanoid-vetting sidecar does, so slot queueing
      // cannot consume test deadlines.
      fileParallelism: false,
    },
  }),
);
