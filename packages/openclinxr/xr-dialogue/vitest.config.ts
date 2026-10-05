import { nodeConfig } from "@cellix/config-vitest/node";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(nodeConfig, defineConfig({
  resolve: {
    alias: {
      "@openclinxr/xr-dialogue/actor-audio-runtime": fileURLToPath(new URL("./src/actor-audio-runtime.ts", import.meta.url)),
    },
  },
}));
