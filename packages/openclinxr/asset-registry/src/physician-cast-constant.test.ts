import { describe, expect, it } from "vitest";

const PHYSICIAN_GLB = "mpfb-clinical-physician-adult.glb";

describe("the physician resolves to its own MPFB body", () => {
  it("the physician GLB constant mirrors the runtime path in cast-asset-constants", async () => {
    const mod = await import("./cast-asset-constants-mod.js");
    expect(mod.MPFB_CLINICAL_PHYSICIAN_ADULT_GLB).toBe(PHYSICIAN_GLB);
  });
});
