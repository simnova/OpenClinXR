import { fileURLToPath } from "node:url";
import { type DevPluginOptions, iwsdkDev } from "@iwsdk/vite-plugin-dev";
import { type CompileUIKitOptions, compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig } from "vitest/config";

type OpenClinXrIwsdkSpikeDevPluginOptions = DevPluginOptions & {
  ai?: NonNullable<DevPluginOptions["ai"]> & {
    tools?: string[];
  };
};

/**
 * Quest-friendly portless defaults:
 * - `https: false` so Quest Browser via `adb reverse` can load `http://localhost:<port>`
 *   without a self-signed-cert "Privacy error" (localhost is a secure context for WebXR).
 * - IWSDK 0.5.x defaults https:true for self-signed certs; that works for managed
 *   Playwright (auto-accepts cert) but blocks Quest Browser shell smoke.
 * - `workspace.open: false` avoids auto-launching a desktop browser on every portless start.
 */
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
  workspace: {
    open: false,
    headless: true,
  },
  /** Prefer HTTP for Quest USB reverse + CDP smoke; override via Vite server.https if needed. */
  https: false,
  verbose: true,
} satisfies OpenClinXrIwsdkSpikeDevPluginOptions);

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
export const openClinXrIwsdkSpikeUIKitmlSourceDir = fileURLToPath(new URL("./ui", import.meta.url));
export const openClinXrIwsdkSpikeUIKitmlOutputDir = fileURLToPath(new URL("./public/uikitml", import.meta.url));

export const openClinXrIwsdkSpikeUIKitmlOptions = Object.freeze({
  sourceDir: openClinXrIwsdkSpikeUIKitmlSourceDir,
  outputDir: openClinXrIwsdkSpikeUIKitmlOutputDir,
  watch: true,
  verbose: false,
} satisfies CompileUIKitOptions);

export function resolveOpenClinXrIwsdkSpikeModulePreloads(_url: string, deps: string[]): string[] {
  return deps.filter((dep) => !dep.includes("iwsdk-vendor"));
}

export function createOpenClinXrIwsdkSpikePlugins() {
  const devPlugin = iwsdkDev(openClinXrIwsdkSpikeDevPluginOptions);
  return [
    compileUIKit(openClinXrIwsdkSpikeUIKitmlOptions),
    { ...devPlugin, apply: "serve" as const },
  ];
}

export default defineConfig({
  plugins: createOpenClinXrIwsdkSpikePlugins(),
  // Explicit HTTP for Quest adb reverse. Plugin `https: false` opts out of IWSDK
  // self-signed cert generation; Vite server.https false wins if plugin re-enables.
  server: {
    https: false,
    host: "127.0.0.1",
    // package.json dev:portless uses --strictPort=false + PORT:-0 for parallel worktrees;
    // CLI flag wins when set. Config default stays non-strict so portless is collision-safe.
    strictPort: false,
    /** Disable Vite error overlay so non-fatal dynamic-import failures
     *  (e.g. @pmndrs/uikitml on Quest Browser) do not inject
     *  <vite-error-overlay> and block the shellLoaded CDP gate. */
    hmr: {
      overlay: false,
    },
  },
  /** Pre-bundle deps that fail dynamic import on Quest Browser (e.g. @pmndrs/uikitml
   *  resolves to .vite/deps/... but Quest cannot fetch them from Vite dev server). */
  optimizeDeps: {
    include: ["@pmndrs/uikitml"],
  },
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
