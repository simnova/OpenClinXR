import { fileURLToPath } from "node:url";
import { nodeConfig } from "@cellix/config-vitest/node";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(nodeConfig, defineConfig({
  resolve: { alias: [{ find: /^@openclinxr\/xr-capacity\/browser$/, replacement: fileURLToPath(new URL("./src/browser/index.ts", import.meta.url)) }] },
  test: { include: ["src/**/*.test.ts"] }
}));
