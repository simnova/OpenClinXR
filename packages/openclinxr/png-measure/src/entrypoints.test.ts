import { describe, expect, it } from "vitest";
import { decodePng, regionLuminance } from "./index.js";
import { UNIFORM_SD_CEILING, classifyCaptureFrame } from "./evidence-capture.js";
import * as evidencePng from "./evidence-png.js";

/**
 * Entrypoint wiring: every published symbol resolves. A name missing from an entrypoint
 * index fails only at runtime ("is not a function"), so this pins the dual-entrypoint
 * split without re-asserting any contract threshold.
 */
describe("png-measure entrypoints", () => {
  it("publishes general measurement on '.'", () => {
    expect(typeof decodePng).toBe("function");
    expect(typeof regionLuminance).toBe("function");
  });

  it("publishes the capture-grading verdict on './evidence-capture'", () => {
    expect(typeof classifyCaptureFrame).toBe("function");
    expect(UNIFORM_SD_CEILING).toBe(9.22);
  });

  it("publishes the sidecar-test measurement on './evidence-png'", () => {
    expect(evidencePng.decodePng).toBe(decodePng);
    expect(evidencePng.regionLuminance).toBe(regionLuminance);
  });

  it("rejects non-PNG bytes without throwing", () => {
    const junk = new Uint8Array([1, 2, 3]);
    expect(decodePng(junk)).toBeNull();
    expect(regionLuminance(junk)).toBeNull();
    expect(classifyCaptureFrame(junk)).toBeNull();
  });
});
