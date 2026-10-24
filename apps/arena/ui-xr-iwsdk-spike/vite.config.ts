import { fileURLToPath } from "node:url";
import { type DevPluginOptions, iwsdkDev } from "@iwsdk/vite-plugin-dev";
import { type CompileUIKitOptions, compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig } from "vitest/config";

/**
 * IWSDK 0.3.1 (licensed MIT pin) natively types `ai.tools` (`AiTool` includes
 * `'codex'`), so the local `tools?: string[]` extension required by 0.5.x —
 * which dropped `tools` from `AiOptions` — is removed. 0.3.1 has no
 * `workspace` or `https` options: `ai.mode: 'agent'` already implies a
 * headless managed Playwright runtime, and the plugin never generates TLS
 * certificates, so plain HTTP holds without an opt-out flag.
 */
type OpenClinXrIwsdkSpikeDevPluginOptions = DevPluginOptions;

/**
 * Quest-friendly portless defaults:
 * - Plain HTTP (Vite `server` omits `https`; the 0.3.1 plugin has no `https`
 *   option and never issues self-signed certs) so Quest Browser via
 *   `adb reverse` can load `http://localhost:<port>` without a
 *   self-signed-cert "Privacy error" (localhost is a secure context for WebXR).
 * - No `workspace` block: 0.3.1 predates the managed-workspace option.
 *   `ai.mode: 'agent'` keeps the Playwright runtime headless with a fixed
 *   viewport; nothing auto-launches a desktop browser.
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
  // HTTP for Quest adb reverse. Vite 8 `server.https` is HttpsServerOptions only
  // (boolean false removed); omit `https` → plain HTTP. The 0.3.1 IWSDK plugin
  // has no `https` option and never generates self-signed certs, so omitting
  // here is sufficient for cert-free HTTP.
  server: {
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
