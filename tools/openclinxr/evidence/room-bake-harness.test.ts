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
  surfaceForBakeName,
  surfaceForNodeName,
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

  it("reads a surface token before a shared plaster name, and Infinigen node roles", () => {
    expect(surfaceForBakeName("openclinxr_room_bake_surface_wall_shader_plaster")).toBe("wall");
    expect(surfaceForBakeName("openclinxr_room_bake_surface_floor_shader_wood")).toBe("floor");
    expect(surfaceForBakeName("openclinxr_room_bake_shader_plaster")).toBe("ceiling");
    expect(surfaceForNodeName("bedroom_0/0.wall")).toBe("wall");
    expect(surfaceForNodeName("bedroom_0/0.floor")).toBe("floor");
    expect(surfaceForNodeName("bedroom_0/0.ceiling")).toBe("ceiling");
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

  it("forwards --samples and refuses a non-positive sample count", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "room-bake-harness-"));
    const output = path.join(dir, "out.glb");
    const reportPath = path.join(dir, "report.json");
    let seen = "";
    await runRoomBakeHarness(
      [
        "--bake-treatment",
        "--light-rig",
        "distributed",
        "--samples",
        "48",
        "--output",
        output,
        "--report",
        reportPath,
      ],
      {
        spawn(argv) {
          seen = argv.join(" ");
        },
      },
    );
    expect(seen).toContain("--samples 48");
    await expect(runRoomBakeHarness(
      ["--bake-treatment", "--light-rig", "distributed", "--samples", "0", "--output", output],
      {
        spawn() {
          throw new Error("baker was invoked");
        },
      },
    )).rejects.toThrow(/--samples must be a positive integer/);
  });

  it("scores urgent-care wall, floor, and ceiling from node roles", async () => {
    const reportPath = path.join(mkdtempSync(path.join(tmpdir(), "room-bake-harness-")), "report.json");
    const source = "apps/ui-xr/public/xr-assets/environment/infinigen-urgent-care-clinic.glb";
    const report = await runRoomBakeHarness(
      ["--measure-only", "--control", source, "--treatment", source, "--report", reportPath],
      {
        spawn() {
          throw new Error("measure-only must not start Blender");
        },
      },
    ) as RoomBakeHarnessReport;
    expect(report.control.floor.occupiedCount).toBeGreaterThan(0);
    expect(report.control.ceiling.occupiedCount).toBeGreaterThan(0);
    expect(report.control.wall.occupiedCount).toBe(0);
    expect(report.control.floor.occupiedMean).toBeGreaterThan(report.control.wall.wholeMean);
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
    expect(parseRoomBakeCliArgs(["--input", "room.glb", "--samples", "48"]).samples).toBe(48);
    expect(() => parseRoomBakeCliArgs(["--samples", "0"])).toThrow(/--samples must be a positive integer/);
    expect(() => parseRoomBakeCliArgs(["--samples", "nope"])).toThrow(/--samples must be a positive integer/);
    expect(parseRoomBakeCliArgs(["--input", "room.glb", "--wall-contrast", "0.6"]).wallContrast).toBe(0.6);
    expect(() => parseRoomBakeCliArgs(["--wall-contrast", "1"])).toThrow(/--wall-contrast must be in \[0, 1\)/);
    expect(parseRoomBakeCliArgs(["--floor-energy-scale", "0.1"]).floorEnergyScale).toBe(0.1);
    expect(() => parseRoomBakeCliArgs(["--floor-energy-scale", "0"])).toThrow(/--floor-energy-scale must be a positive number/);
  });
});
