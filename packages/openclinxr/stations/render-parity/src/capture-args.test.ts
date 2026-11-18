import { describe, expect, it } from "vitest";
import { parseCaptureArgs, resolveLevers } from "./capture-args.js";

describe("render-parity capture args", () => {
  it("maps --cameras/--out/--levers/--only to the parsed fields", () => {
    const cli = parseCaptureArgs([
      "--cameras",
      "cameras.json",
      "--out",
      "E/check",
      "--levers",
      "p2b-e2",
      "--only",
      "head_front,head_34",
    ]);
    expect(cli.cameras).toBe("cameras.json");
    expect(cli.out).toBe("E/check");
    expect(cli.levers).toBe("p2b-e2");
    expect(cli.only).toEqual(["head_front", "head_34"]);
  });

  it("refuses an unknown preset name", async () => {
    await expect(resolveLevers("no-such-preset")).rejects.toThrow();
  });

  it("resolves the p2b-e2 preset by name", async () => {
    const { name, levers } = await resolveLevers("p2b-e2");
    expect(name).toBe("p2b-e2");
    expect(levers["exposure"]).toBe(0.87);
  });
});
