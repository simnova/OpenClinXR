import { defineConfig } from "vitest/config";

export const openClinXrXrBuildOutput = Object.freeze({
  codeSplitting: {
    groups: [
      {
        name: "three-vendor",
        test: /node_modules[\\/](?:\.pnpm[\\/])?three/,
        priority: 20,
      },
      {
        name: "vendor",
        test: /node_modules/,
        priority: 10,
      },
    ],
  },
});

export const openClinXrXrChunkSizeWarningLimitKb = 600;

export default defineConfig({
  build: {
    chunkSizeWarningLimit: openClinXrXrChunkSizeWarningLimitKb,
    rolldownOptions: {
      output: openClinXrXrBuildOutput,
    },
  },
});
