import { nodeConfig } from "@cellix/config-vitest/node";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  nodeConfig,
  defineConfig({
    test: {
      // T0: the-runtime-displays-the-walk stays serial-browser in the sidecar:
      // its displayed-walk-on-the-loaded-physician import closure reaches the
      // slotted-Playwright wrapper (chromium.launch) and the portless dev
      // server (spawnPortlessDevServer), and the tools runner pins the same
      // file at --maxWorkers=1 --no-file-parallelism. Keep files serial the
      // way the station-capture sidecar does, so slot queueing cannot consume
      // test deadlines.
      fileParallelism: false,
    },
  }),
);
