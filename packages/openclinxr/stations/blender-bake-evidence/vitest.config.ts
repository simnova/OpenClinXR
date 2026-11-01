import { nodeConfig } from "@cellix/config-vitest/node";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  nodeConfig,
  defineConfig({
    test: {
      // T0: these tests run in the serial-blender pool today (their helper
      // modules call withComputeSlot(Sync)("blender")), so the tools runner
      // pins them --maxWorkers=1 --no-file-parallelism. Keep files serial in
      // the sidecar the way the foot-plant and humanoid-vetting sidecars do,
      // so slot queueing cannot consume test deadlines.
      fileParallelism: false,
    },
  }),
);
