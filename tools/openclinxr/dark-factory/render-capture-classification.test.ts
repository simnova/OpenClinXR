import { describe, expect, it } from "vitest";
import { classifyRenderCapture } from "./render-capture-classification.js";

describe("dark-factory render capture classification", () => {
  it("requires both the image and whole standing-cast containment", () => {
    expect(classifyRenderCapture({ captureExists: true, containment: { contained: 2, total: 2 } }))
      .toEqual({ classification: "deterministic", note: "capture written; standing actor containment 2/2" });
    expect(classifyRenderCapture({ captureExists: true, containment: { contained: 1, total: 2 } }))
      .toEqual({ classification: "error", note: "capture written; standing actor containment 1/2" });
    expect(classifyRenderCapture({ captureExists: false, containment: { contained: 2, total: 2 } }))
      .toEqual({ classification: "error", note: "capture missing; standing actor containment 2/2" });
    expect(classifyRenderCapture({ captureExists: true }))
      .toEqual({ classification: "error", note: "capture written; standing actor containment 0/0" });
  });
});
