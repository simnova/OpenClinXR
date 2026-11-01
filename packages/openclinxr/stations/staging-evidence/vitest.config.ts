import { nodeConfig } from "@cellix/config-vitest/node";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  nodeConfig,
  defineConfig({
    test: {
      // T0: these tests run in the serial-browser pool today (the staging
      // helpers value-import the slotted-Playwright wrapper and the portless dev
      // server, so the tools runner pins them --maxWorkers=1
      // --no-file-parallelism). Keep files serial in the sidecar the way the
      // station-capture sidecar does, so slot queueing cannot consume test deadlines.
      fileParallelism: false,
    },
  }),
);
