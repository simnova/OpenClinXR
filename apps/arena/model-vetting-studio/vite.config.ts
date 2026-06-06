import { defineConfig } from "vitest/config";

export const modelVettingStudioPort = 5184;

export default defineConfig({
  server: {
    port: modelVettingStudioPort,
  },
  build: {
    chunkSizeWarningLimit: 650,
  },
});
