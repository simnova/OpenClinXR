import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCaptureArgs, resolveLevers, resolveUnderCwd } from "./capture-args.js";

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

  it("I7: refuses garbage eyeShade values (value error, before any globe search)", async () => {
    const bad = (eyeShade: Record<string, unknown>) =>
      JSON.stringify({ exposure: 0.87, physical: { eyeShade } });
    await expect(
      resolveLevers(bad({ scleraAtten: -1, lidBandM: 0.007, lidDarken: 0.85 })),
    ).rejects.toThrow(/scleraAtten/);
    await expect(
      resolveLevers(bad({ scleraAtten: 0.35, lidBandM: 0, lidDarken: 0.85 })),
    ).rejects.toThrow(/lidBandM/);
    await expect(
      resolveLevers(bad({ scleraAtten: 0.35, lidBandM: 0.007, lidDarken: 1.5 })),
    ).rejects.toThrow(/lidDarken/);
    // Non-finite serialises to null over the JSON boundary: still refused.
    await expect(
      resolveLevers(bad({ scleraAtten: Number.NaN, lidBandM: 0.007, lidDarken: 0.85 })),
    ).rejects.toThrow(/scleraAtten/);
  });

  it("I7 counterweight: the p2h eyeShade presets load", async () => {
    for (const preset of ["p2h-f0", "p2h-s1"]) {
      const { name, levers } = await resolveLevers(preset);
      expect(name).toBe(preset);
      expect((levers["physical"] as Record<string, unknown>)["eyeShade"]).toBeDefined();
    }
  });

  it("resolves relative --calib-sweep and lever files under --cwd", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "parity-cwd-"));
    await writeFile(path.join(dir, "lever.json"), JSON.stringify({ exposure: 0.5 }));
    const cli = parseCaptureArgs([
      "--cameras",
      "cameras.json",
      "--out",
      "o",
      "--levers",
      "lever.json",
      "--calib-sweep",
      "sweep.json",
      "--cwd",
      dir,
    ]);
    expect(cli.cwd).toBe(dir);
    const { name, levers } = await resolveLevers(cli.levers, cli.cwd);
    expect(name).toBe("lever");
    expect(levers["exposure"]).toBe(0.5);
    expect(resolveUnderCwd(cli.cwd, cli.calibSweep)).toBe(path.join(dir, "sweep.json"));
    expect(resolveUnderCwd(cli.cwd, "/abs/sweep.json")).toBe("/abs/sweep.json");
  });
});
