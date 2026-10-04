import { describe, expect, it } from "vitest";
import { classifyRenderCapture } from "./render-capture-classification.js";

describe("dark-factory render capture classification", () => {
  it("requires the image, whole all-actor containment and mean facing at most 90 degrees", () => {
    expect(classifyRenderCapture({ captureExists: true, containment: { contained: 3, total: 3 }, meanFacingDeg: 42 }))
      .toEqual({ classification: "deterministic", note: "capture written; all-actor containment 3/3; mean facing 42.0deg" });
    expect(classifyRenderCapture({ captureExists: true, containment: { contained: 2, total: 3 }, meanFacingDeg: 42 }))
      .toEqual({ classification: "error", note: "capture written; all-actor containment 2/3; mean facing 42.0deg" });
    expect(classifyRenderCapture({ captureExists: true, containment: { contained: 3, total: 3 }, meanFacingDeg: 90.1 }))
      .toEqual({ classification: "error", note: "capture written; all-actor containment 3/3; mean facing 90.1deg" });
    expect(classifyRenderCapture({ captureExists: false, containment: { contained: 3, total: 3 }, meanFacingDeg: 42 }))
      .toEqual({ classification: "error", note: "capture missing; all-actor containment 3/3; mean facing 42.0deg" });
    expect(classifyRenderCapture({ captureExists: true }))
      .toEqual({ classification: "error", note: "capture written; all-actor containment 0/0; mean facing unknown" });
  });
});
