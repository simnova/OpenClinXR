import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { modelVettingDevServerPlugin } from "./src/pipeline-admin/dev-server-plugin.js";

export const modelVettingStudioPort = 5184;

export default defineConfig({
  // modelVettingDevServerPlugin uses apply:"serve" — dev-only; never in production build.
  plugins: [react(), modelVettingDevServerPlugin()],
  server: {
    port: modelVettingStudioPort,
    // Deploy writes GLBs under apps/ui-xr and promotion records under .openclinxr.
    // Do not full-reload the admin UI when those land (would wipe the Deploy success panel).
    watch: {
      ignored: [
        "**/apps/ui-xr/public/generated-humanoids/**",
        "**/apps/ui-xr/public/cagematch/**",
        "**/.openclinxr/asset-production/**",
        // Index regen rewrites this file; don't full-reload the Deploy success panel.
        "**/pipeline-candidate-index.json",
        "**/node_modules/**",
      ],
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
  },
  test: {
    // Default node env keeps the existing three.js *.test.ts suites intact;
    // React admin *.test.tsx files opt into jsdom via a per-file docblock.
    environment: "node",
    setupFiles: ["./src/pipeline-admin/jsdom-setup.ts"],
  },
});
