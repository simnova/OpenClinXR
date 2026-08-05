import { describe, expect, it } from "vitest";
import {
  createOpenClinXrIwsdkSpikePlugins,
  openClinXrIwsdkSpikeBuildOutput,
  openClinXrIwsdkSpikeDevPluginOptions,
  openClinXrIwsdkSpikeUIKitmlOutputDir,
  openClinXrIwsdkSpikeUIKitmlSourceDir,
  resolveOpenClinXrIwsdkSpikeModulePreloads,
} from "./vite.config.js";

describe("IWSDK sidecar Vite config", () => {
  it("keeps the heavy IWSDK vendor chunk lazy instead of modulepreloading it", () => {
    expect(resolveOpenClinXrIwsdkSpikeModulePreloads("assets/index.js", [
      "assets/rolldown-runtime.js",
      "assets/iwsdk-vendor.js",
      "assets/three-vendor.js",
    ])).toEqual([
      "assets/rolldown-runtime.js",
      "assets/three-vendor.js",
    ]);
  });

  it("keeps IWSDK packages split away from the Quest shell entry chunk", () => {
    expect(openClinXrIwsdkSpikeBuildOutput.codeSplitting.groups[0]).toEqual(expect.objectContaining({
      name: "iwsdk-vendor",
      priority: 30,
    }));
  });

  it("enables approved IWER Quest 3 agent-mode emulation only in the sidecar Vite app", () => {
    expect(openClinXrIwsdkSpikeDevPluginOptions).toMatchObject({
      emulator: {
        device: "metaQuest3",
        activation: "localhost",
        injectOnBuild: false,
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
      https: false,
      verbose: true,
    });
    expect(openClinXrIwsdkSpikeDevPluginOptions.emulator?.userAgentException).toBeInstanceOf(RegExp);
    const plugins = createOpenClinXrIwsdkSpikePlugins();
    expect(plugins.some((plugin) => plugin.name.includes("iwsdk"))).toBe(true);
    expect(plugins.some((plugin) => plugin.name === "compile-uikitml")).toBe(true);
    expect(plugins.filter((plugin) => plugin.name.includes("iwsdk")).every((plugin) => plugin.apply === "serve")).toBe(
      true,
    );
  });

  it("keeps portless HTTP so Quest Browser can load via adb reverse without cert privacy errors", async () => {
    const { default: viteConfig } = await import("./vite.config.js");
    const resolved = typeof viteConfig === "function" ? await viteConfig({ command: "serve", mode: "development" }) : viteConfig;
    // The guarantee is NO TLS, not a specific literal. Vite 8 dropped `false` from the
    // `server.https` type, so the idiom for plain HTTP is to OMIT the key — `undefined` and
    // `false` both mean "no TLS". Anything truthy (an object carrying key/cert) does not, and
    // would give Quest Browser a self-signed cert privacy interstitial over adb reverse.
    expect(resolved.server?.https ?? false, "server.https must not enable TLS").toBe(false);
    expect(resolved.server?.hmr).toMatchObject({ overlay: false });
    expect(openClinXrIwsdkSpikeDevPluginOptions.https).toBe(false);
  });

  it("disables Vite HMR error overlay so non-fatal dynamic-import failures on Quest do not block shellLoaded CDP gate", async () => {
    const { default: viteConfig } = await import("./vite.config.js");
    const resolved = typeof viteConfig === "function" ? await viteConfig({ command: "serve", mode: "development" }) : viteConfig;
    expect(resolved.server?.hmr?.overlay).toBe(false);
  });

  it("pre-bundles @pmndrs/uikitml so Quest Browser can load it without failing on dynamic Vite deps import", async () => {
    const { default: viteConfig } = await import("./vite.config.js");
    const resolved = typeof viteConfig === "function" ? await viteConfig({ command: "serve", mode: "development" }) : viteConfig;
    expect(resolved.optimizeDeps?.include).toContain("@pmndrs/uikitml");
  });

  it("compiles UIKitML text sources with absolute paths for portless/worktree safety", () => {
    expect(openClinXrIwsdkSpikeUIKitmlSourceDir).toContain("apps/arena/ui-xr-iwsdk-spike/ui");
    expect(openClinXrIwsdkSpikeUIKitmlOutputDir).toContain("apps/arena/ui-xr-iwsdk-spike/public/uikitml");
  });
});
