import { describe, expect, it } from "vitest";
import { openClinXrXrBuildOutput, openClinXrXrChunkSizeWarningLimitKb } from "./vite.config.js";

describe("XR Vite build configuration", () => {
  it("splits Three.js into a stable vendor chunk with an explicit XR warning budget", () => {
    expect(openClinXrXrBuildOutput.codeSplitting).toMatchObject({
      groups: [
        { name: "three-vendor", priority: 20 },
        { name: "vendor", priority: 10 },
      ],
    });
    expect(openClinXrXrChunkSizeWarningLimitKb).toBe(600);
  });
});
