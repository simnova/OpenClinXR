import { execFile } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, beforeAll } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SRC = dirname(fileURLToPath(import.meta.url));

/**
 * OBSERVABLE: under ward_photo the finish removes the shell floor
 * skirting and emits the thin (100 mm) vinyl cove base with a door gap
 * (ward cove exception, see README).
 *
 * On main compose.py has no cove path (shell skirting passes through),
 * so every case below fails there and passes after the change. One real
 * compose.py run (raw Blender spawn, ward_photo recipe) shared via
 * beforeAll; the rest pin the mechanism statically.
 */

function boxPositions(min: [number, number, number], max: [number, number, number]): Float32Array<ArrayBuffer> {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return new Float32Array([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]);
}

// Bottom faces flipped vs the troffer-test fixture: that winding has
// outward sides but an inward bottom, and the cove normal-clustered
// planes need outward normals on every face (verified natively).
const BOX_INDICES = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);

async function writeFixtureGlb(outputPath: string): Promise<void> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const addBox = (name: string, min: [number, number, number], max: [number, number, number]): void => {
    const pos = doc.createAccessor().setType("VEC3").setArray(boxPositions(min, max)).setBuffer(buffer);
    const idx = doc.createAccessor().setType("SCALAR").setArray(BOX_INDICES).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute("POSITION", pos).setIndices(idx);
    const mesh = doc.createMesh(name).addPrimitive(prim);
    doc.createNode(name).setMesh(mesh);
  };
  // Fixture boxes are authored Y-UP (glTF convention: height along Y;
  // Blender maps it to Z on import). Blender-space room: x in
  // [-2.15, 2.15], y in [-1.95, 1.95], z in [0, 2.4]; authored gz = -y.
  // Four wall slabs: interior x in [-2.15, 2.15], y in [-1.95, 1.95].
  addBox("TestRoom_0.wall_south", [-2.15, 0, 1.73], [2.15, 2.4, 1.95]);
  addBox("TestRoom_0.wall_north", [-2.15, 0, -1.95], [2.15, 2.4, -1.73]);
  addBox("TestRoom_0.wall_west", [-2.15, 0, -1.95], [-1.93, 2.4, 1.95]);
  addBox("TestRoom_0.wall_east", [1.93, 0, -1.95], [2.15, 2.4, 1.95]);
  addBox("TestRoom_0.door_leaf", [0.0, 0, -1.8], [0.95, 2.1, -1.7]);
  // Fake shell skirting: floor one must go, ceiling one must stay.
  addBox("TestRoom_0.skirting_floor", [-2.15, 0, 1.9], [2.15, 0.14, 1.95]);
  addBox("TestRoom_0.skirting_ceiling", [-2.15, 2.26, 1.9], [2.15, 2.4, 1.95]);
  await new NodeIO().write(outputPath, doc);
}

function wardRecipeJson(): string {
  return `${JSON.stringify(
    {
      schemaVersion: "openclinxr.room-clinic-finish.v1",
      environmentId: "inpatient_ward_room_v1",
      preset: "ward_photo",
      seed: 205,
      palette: {
        wallAlbedo: [0.72, 0.74, 0.72],
        trimAlbedo: [0.69, 0.73, 0.75],
        accentAlbedo: [0.53, 0.55, 0.56],
        roughness: 0.85,
        signageAnchors: ["door_header", "bed_wall"],
      },
      modules: [
        { module: "ceiling", version: "clinic-finish-ceiling-v1" },
        { module: "floor", version: "clinic-finish-floor-v1" },
        { module: "door", version: "clinic-finish-door-v1" },
        { module: "corridor_cues", version: "clinic-finish-corridor-cues-v1" },
        { module: "geometry", version: "clinic-finish-geometry-v1" },
      ],
      light: { exposure: "xr", floorResponse: "xt_matte" },
      options: { crashRail: false },
      finishPassLlm: false,
    },
    null,
    2,
  )}\n`;
}

type Prepared = { workGlb: string; report: Record<string, unknown> };
let prepared: Prepared | null = null;

async function composeOnce(): Promise<Prepared> {
  const work = mkdtempSync(path.join(tmpdir(), "clinic-finish-cove-"));
  const fixture = path.join(work, "fixture.glb");
  const workGlb = path.join(work, "work.glb");
  const recipePath = path.join(work, "recipe.json");
  const reportPath = path.join(work, "report.json");
  await writeFixtureGlb(fixture);
  copyFileSync(fixture, workGlb);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(recipePath, wardRecipeJson(), "utf8");
  await execFileAsync(
    "blender",
    ["--background", "--python", path.join(SRC, "compose.py"), "--",
      "--input", workGlb, "--output", workGlb,
      "--recipe-json", recipePath, "--report", reportPath],
    { timeout: 300_000 },
  );
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
  return { workGlb, report };
}

describe("the room clinic finish ward cove base", () => {
  beforeAll(async () => {
    prepared = await composeOnce();
  }, 300_000);

  it("(1) compose carries the cove path with a 100 mm height", () => {
    const composeSrc = readFileSync(path.join(SRC, "compose.py"), "utf8");
    expect(composeSrc).toContain("SKIRTING_COVE_HEIGHT_M = 0.10");
    expect(composeSrc).toContain("openclinxr_finish_cove");
    expect(composeSrc).toContain("_is_shell_floor_skirting");
    expect(composeSrc).toContain("emit_cove");
  });

  it("(2) the shell floor skirting is removed and the ceiling skirting stays", async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(prepared!.workGlb);
    const names = doc.getRoot().listMeshes().map((m) => m.getName());
    expect(names.some((n) => n.includes("skirting_floor")), "shell floor skirting must be gone").toBe(false);
    expect(names.some((n) => n.includes("skirting_ceiling")), "ceiling skirting must stay").toBe(true);
    expect((prepared!.report["removedShellSkirting"] as string[]).length).toBeGreaterThan(0);
  }, 120_000);

  it("(3) cove runs stand 0.08-0.12 m tall with a door gap on the leaf wall", async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(prepared!.workGlb);
    const coves = doc.getRoot().listMeshes().filter((m) => m.getName().includes("openclinxr_cove_"));
    // 3 full runs + the door wall split in two around the leaf.
    expect(coves.length).toBe(5);
    for (const mesh of coves) {
      let minY = Infinity, maxY = -Infinity;
      for (const prim of mesh.listPrimitives()) {
        const arr = prim.getAttribute("POSITION")!.getArray() as Float32Array;
        for (let i = 1; i < arr.length; i += 3) {
          const y = arr[i] as number;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      // glTF y is up: height is the y extent.
      expect(maxY - minY).toBeGreaterThanOrEqual(0.08);
      expect(maxY - minY).toBeLessThanOrEqual(0.12);
    }
    const cove = prepared!.report["emittedCove"] as { doorSide: string; doorGap: number[] };
    expect(cove.doorSide).toBe("y1");
    expect(cove.doorGap!.length).toBe(2);
    // The x0 run sits against the west inner face (x=-1.93), not the
    // shell bound (-2.15): plane placement is measured, not bounded.
    const x0mesh = coves.find((m) => m.getName().includes("openclinxr_cove_x0_"));
    expect(x0mesh).toBeDefined();
    const xarr = (x0mesh!.listPrimitives()[0]!.getAttribute("POSITION")!.getArray() as Float32Array);
    let xsum = 0;
    for (let i = 0; i < xarr.length; i += 3) xsum += xarr[i] as number;
    const xmean = xsum / (xarr.length / 3);
    expect(xmean).toBeGreaterThan(-1.97);
    expect(xmean).toBeLessThan(-1.89);
  }, 120_000);

  it("(4) the cove material is the flat matte vinyl grey", async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(prepared!.workGlb);
    const coveMat = doc.getRoot().listMaterials().find((m) => m.getName() === "openclinxr_finish_cove");
    expect(coveMat).toBeDefined();
    expect(coveMat!.getBaseColorTexture(), "cove must be flat, no photo").toBeNull();
    const factor = coveMat!.getBaseColorFactor();
    for (let i = 0; i < 3; i += 1) {
      expect(Math.abs(factor[i]! - [0.313, 0.323, 0.352][i]!)).toBeLessThan(0.02);
    }
  }, 120_000);
});

// NOT TESTED: runtime tone-mapped appearance (covered by the pose captures).
