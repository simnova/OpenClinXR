import { iwsdkDev, type DevPluginOptions } from "@iwsdk/vite-plugin-dev";
import { defineConfig } from "vitest/config";

export const openClinXrIwsdkSpikeDevPluginOptions = Object.freeze({
  emulator: {
    device: "metaQuest3",
    activation: "localhost",
    injectOnBuild: false,
    userAgentException: /OculusBrowser/,
  },
  ai: {
    mode: "agent",
    tools: ["codex"],
    screenshotSize: {
      width: 500,
      height: 500,
    },
  },
  verbose: true,
} satisfies DevPluginOptions);

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

export function resolveOpenClinXrIwsdkSpikeModulePreloads(_url: string, deps: string[]): string[] {
  return deps.filter((dep) => !dep.includes("iwsdk-vendor"));
}

export function createOpenClinXrIwsdkSpikePlugins() {
  const devPlugin = iwsdkDev(openClinXrIwsdkSpikeDevPluginOptions);
  return [{ ...devPlugin, apply: "serve" as const }];
}

export default defineConfig({
  plugins: createOpenClinXrIwsdkSpikePlugins(),
  build: {
    chunkSizeWarningLimit: openClinXrIwsdkSpikeChunkSizeWarningLimitKb,
    modulePreload: {
      resolveDependencies: resolveOpenClinXrIwsdkSpikeModulePreloads,
    },
    rolldownOptions: {
      output: openClinXrIwsdkSpikeBuildOutput,
    },
  },
});
