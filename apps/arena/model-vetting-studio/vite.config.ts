import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export const modelVettingStudioPort = 5184;

export default defineConfig({
  plugins: [react()],
  server: {
    port: modelVettingStudioPort,
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
