import { defineConfig } from "vitest/config";

export const openClinXrIwsdkSpikeBuildOutput = Object.freeze({
  codeSplitting: {
    groups: [
      {
        name: "iwsdk-vendor",
        test: /node_modules[\\/](?:\.pnpm[\\/])?@iwsdk[\\/]/,
        priority: 30,
      },
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

export const openClinXrIwsdkSpikeChunkSizeWarningLimitKb = 650;

export default defineConfig({
  build: {
    chunkSizeWarningLimit: openClinXrIwsdkSpikeChunkSizeWarningLimitKb,
    rolldownOptions: {
      output: openClinXrIwsdkSpikeBuildOutput,
    },
  },
});
