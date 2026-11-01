import { nodeConfig } from "@cellix/config-vitest/node";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  nodeConfig,
  defineConfig({
    test: {
      // T0: every moved test classifies serial-browser (repo static
      // serialPoolOf: value-import closure reaches the compute-slots
      // browser-capture pool), so the tools runner pins them --maxWorkers=1
      // --no-file-parallelism. Keep files serial in the sidecar the way the
      // foot-plant sidecar does, so slot queueing cannot consume test deadlines.
      fileParallelism: false,
    },
  }),
);
