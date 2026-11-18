import { describe, expect, it } from "vitest";
import { parseCaptureArgs, resolveLevers, runRuntimeCapture } from "./index.js";
import type { CaptureCli } from "./index.js";

describe("entrypoint: the thin-CLI + dist contract", () => {
  it("publishes parse/run/types and resolves presets through the entrypoint", async () => {
    expect(typeof parseCaptureArgs).toBe("function");
    expect(typeof runRuntimeCapture).toBe("function");
    const { name, levers } = await resolveLevers("p2b-e2");
    expect(name).toBe("p2b-e2");
    expect(levers["exposure"]).toBe(0.87);
    const cli: CaptureCli = parseCaptureArgs([
      "--cameras",
      "cameras.json",
      "--out",
      "E/check",
      "--levers",
      "p2b-e2",
    ]);
    expect(cli.levers).toBe("p2b-e2");
  });
});
