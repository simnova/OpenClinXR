import { describe, expect, it } from "vitest";
import {
  resolveOpenClinXrIwsdkSpikeModulePreloads,
  openClinXrIwsdkSpikeBuildOutput,
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
});
