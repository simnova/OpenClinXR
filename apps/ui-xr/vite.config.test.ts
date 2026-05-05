import { describe, expect, it } from "vitest";
import {
  createOpenClinXrXrAppMetadata,
  openClinXrXrBuildOutput,
  openClinXrXrChunkSizeWarningLimitKb,
} from "./vite.config.js";

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

  it("injects package and build metadata for copied Quest evidence", () => {
    const metadata = createOpenClinXrXrAppMetadata("test");

    expect(metadata.packageName).toBe("@openclinxr/ui-xr");
    expect(metadata.version).toBe("0.1.0");
    expect(metadata.gitCommit).toMatch(/^[a-f0-9]{7,12}$|^unknown$/);
    expect(new Date(metadata.buildTime).toISOString()).toBe(metadata.buildTime);
    expect(metadata.mode).toBe("test");
  });
});
