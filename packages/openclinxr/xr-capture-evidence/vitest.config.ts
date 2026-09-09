import { nodeConfig } from "@cellix/config-vitest/node";
import { defineConfig, mergeConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default mergeConfig(nodeConfig, defineConfig({
  test: {
    setupFiles: [resolve(__dirname, "./vitest.setup.ts")],
  },
}));
