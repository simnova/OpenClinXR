import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseRoomBakeCliArgs, runRoomBakeCli } from "../asset-pipeline/environment/room-bake-cli.js";
import {
  type RoomBakeHarnessReport,
  runRoomBakeHarness,
  SHIPPED_PRIMARY_CARE_GLB,
} from "./room-bake-harness.js";

describe("room bake harness", () => {
  it("throws when asked to write the shipped primary-care GLB", async () => {
    const before = statSync(SHIPPED_PRIMARY_CARE_GLB);
    await expect(runRoomBakeHarness(
      [
        "--bake-treatment",
        "--light-rig",
        "legacy",
        "--output",
        SHIPPED_PRIMARY_CARE_GLB,
      ],
      {
        spawn() {
          throw new Error("baker was invoked");
        },
      },
    )).rejects.toThrow(/refusing to write apps\/ui-xr\/public\/xr-assets\/environment\/infinigen-primary-care-clinic\.glb/);
    const after = statSync(SHIPPED_PRIMARY_CARE_GLB);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
  });

  it("measure-only returns finite wall, floor, and ceiling means without starting Blender", async () => {
    const report = await runRoomBakeHarness(
      [
        "--measure-only",
        "--control",
        SHIPPED_PRIMARY_CARE_GLB,
        "--treatment",
        SHIPPED_PRIMARY_CARE_GLB,
      ],
      {
        spawn() {
          throw new Error("measure-only must not start Blender");
        },
      },
    ) as RoomBakeHarnessReport;

    expect(report.mode).toBe("measure-only");
    for (const side of [report.control, report.treatment]) {
      expect(Number.isFinite(side.wall)).toBe(true);
      expect(Number.isFinite(side.floor)).toBe(true);
      expect(Number.isFinite(side.ceiling)).toBe(true);
    }
    expect(JSON.stringify(report)).not.toMatch(/tris|textureBytes/);

    const written = JSON.parse(await readFile(report.reportPath, "utf8")) as RoomBakeHarnessReport;
    for (const side of [written.control, written.treatment]) {
      expect(Number.isFinite(side.wall)).toBe(true);
      expect(Number.isFinite(side.floor)).toBe(true);
      expect(Number.isFinite(side.ceiling)).toBe(true);
    }
  });
});

describe("room-bake-cli --light-rig", () => {
  it("accepts --help and --light-rig distributed without starting Blender", async () => {
    await expect(runRoomBakeCli(["--help"])).resolves.toBeUndefined();
    await expect(runRoomBakeCli(["--help", "--light-rig", "distributed"])).resolves.toBeUndefined();
    expect(parseRoomBakeCliArgs(["--input", "room.glb", "--light-rig", "distributed"]).lightRig)
      .toBe("distributed");
    expect(parseRoomBakeCliArgs(["--light-rig", "legacy"]).lightRig).toBe("legacy");
    expect(parseRoomBakeCliArgs(["--light-rig", "rig"]).lightRig).toBe("rig");
  });

  it("throws on an unknown light rig", () => {
    expect(() => parseRoomBakeCliArgs(["--light-rig", "studio"])).toThrow(/--light-rig must be one of legacy\|distributed\|rig/);
    expect(() => parseRoomBakeCliArgs(["--light-rig"])).toThrow(/Missing value for --light-rig/);
  });
});
