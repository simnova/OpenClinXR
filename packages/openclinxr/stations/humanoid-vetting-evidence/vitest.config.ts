import { nodeConfig } from "@cellix/config-vitest/node";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  nodeConfig,
  defineConfig({
    test: {
      // T0: these tests run in the serial-blender (a-hair-mhmat, which value-
      // imports the compute-slots blender pool) and serial-spawn (teeth-rest-
      // clearance, body-auto-smooth, reduced-eyebrow, two-waist-meet,
      // vetted-glb-subject-alone, which spawn pnpm/python3 per case) pools
      // today, so the tools runner pins them --maxWorkers=1
      // --no-file-parallelism. Keep files serial in the sidecar the way the
      // foot-plant sidecar does, so slot queueing cannot consume test deadlines.
      fileParallelism: false,
    },
  }),
);
