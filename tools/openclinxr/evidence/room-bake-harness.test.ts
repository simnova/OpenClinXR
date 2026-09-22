import { mkdtempSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseRoomBakeCliArgs, runRoomBakeCli } from "../asset-pipeline/environment/room-bake-cli.js";
import {
  occupiedLuminanceStats,
  type RoomBakeHarnessReport,
  runRoomBakeHarness,
  SHIPPED_PRIMARY_CARE_GLB,
} from "./room-bake-harness.js";

describe("room bake harness", () => {
  it("scores a bright field with a black island nearer the bright field than the whole-image mean", () => {
    const bright = 180;
    const width = 10;
    const height = 10;
    const samples = new Array<number>(width * height).fill(bright);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) samples[y * width + x] = 0;
    }
    const stats = occupiedLuminanceStats(samples);
    const distanceToBright = (value: number) => Math.abs(value - bright);
    expect(distanceToBright(stats.occupiedMean)).toBeLessThan(distanceToBright(stats.wholeMean));
    expect(stats.occupiedMean).toBeGreaterThan(stats.wholeMean);
    expect(stats.occupiedCount).toBe(width * height - 16);
  });

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
    const reportPath = path.join(mkdtempSync(path.join(tmpdir(), "room-bake-harness-")), "report.json");
    const report = await runRoomBakeHarness(
      [
        "--measure-only",
        "--control",
        SHIPPED_PRIMARY_CARE_GLB,
        "--treatment",
        SHIPPED_PRIMARY_CARE_GLB,
        "--report",
        reportPath,
      ],
      {
        spawn() {
          throw new Error("measure-only must not start Blender");
        },
      },
    ) as RoomBakeHarnessReport;

    expect(report.mode).toBe("measure-only");
    for (const side of [report.control, report.treatment]) {
      for (const surface of [side.wall, side.floor, side.ceiling]) {
        expect(Number.isFinite(surface.occupiedMean)).toBe(true);
        expect(Number.isFinite(surface.occupiedSd)).toBe(true);
        expect(Number.isFinite(surface.wholeMean)).toBe(true);
      }
    }
    expect(report.control.wall.occupiedMean).toBeGreaterThan(report.control.wall.wholeMean);
    expect(JSON.stringify(report)).not.toMatch(/tris|textureBytes/);

    const written = JSON.parse(await readFile(report.reportPath, "utf8")) as RoomBakeHarnessReport;
    expect(written.control.wall.occupiedMean).toBeGreaterThan(written.control.wall.wholeMean);
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
