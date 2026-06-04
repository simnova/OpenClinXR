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

  it("compiles UIKitML text sources with absolute paths for portless/worktree safety", () => {
    expect(openClinXrIwsdkSpikeUIKitmlSourceDir).toContain("apps/arena/ui-xr-iwsdk-spike/ui");
    expect(openClinXrIwsdkSpikeUIKitmlOutputDir).toContain("apps/arena/ui-xr-iwsdk-spike/public/uikitml");
  });
});
