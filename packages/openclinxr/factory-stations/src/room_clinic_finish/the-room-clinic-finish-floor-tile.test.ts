import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { withComputeSlot } from "@openclinxr/compute-slots";
import { describe, expect, it, beforeAll } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SRC = dirname(fileURLToPath(import.meta.url));

/**
 * OBSERVABLE: under ward_photo the finish emits the procedural 600 mm
 * vinyl-tile floor field (ward tile exception, see README) instead of
 * passing the shell rubber bake through.
 *
 * On main compose.py has no tile path (ward_photo skips the floor field
 * entirely), so every case below fails there and passes after the change.
 * One real compose.py run (raw Blender spawn, ward_photo recipe) shared by
 * the live cases via beforeAll; the rest pin the mechanism statically.
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
  // Four wall slabs (authored Y-UP: height along Y; Blender maps it to
  // Z on import). One box yields only one slab orientation, and the cove
  // placement fails closed without all four inner-face planes.
  addBox("TestRoom_0.wall_south", [-2.15, 0, 1.73], [2.15, 2.4, 1.95]);
  addBox("TestRoom_0.wall_north", [-2.15, 0, -1.95], [2.15, 2.4, -1.73]);
  addBox("TestRoom_0.wall_west", [-2.15, 0, -1.95], [-1.93, 2.4, 1.95]);
  addBox("TestRoom_0.wall_east", [1.93, 0, -1.95], [2.15, 2.4, 1.95]);
  // Shell floor slab (authored Y-UP): the tile field anchors 3 mm above
  // its top plane, never the shell bounds min.
  addBox("TestRoom_0.floor", [-2.15, 0, -1.95], [2.15, 0.02, 1.95]);
  addBox("TestRoom_0.door_leaf", [0.0, 0, -1.8], [0.95, 2.1, -1.7]);
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
  const work = mkdtempSync(path.join(tmpdir(), "clinic-finish-tile-"));
  const fixture = path.join(work, "fixture.glb");
  const workGlb = path.join(work, "work.glb");
  const recipePath = path.join(work, "recipe.json");
  const reportPath = path.join(work, "report.json");
  await writeFixtureGlb(fixture);
  copyFileSync(fixture, workGlb);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(recipePath, wardRecipeJson(), "utf8");
  await withComputeSlot("blender", { label: "test:clinic-floor-tile" }, () => execFileAsync(
    "blender",
    ["--background", "--python", path.join(SRC, "compose.py"), "--",
      "--input", workGlb, "--output", workGlb,
      "--recipe-json", recipePath, "--report", reportPath],
    { timeout: 300_000 },
  ));
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
  return { workGlb, report };
}

describe("the room clinic finish ward tile floor", () => {
  beforeAll(async () => {
    prepared = await composeOnce();
  }, 300_000);

  it("(1) the tile texture set exists and is generated deterministically", () => {
    for (const file of ["floor-vinyl-tile.png", "floor-vinyl-tile-derived-normal.png",
      "floor-vinyl-tile-derived-roughness.png", "generate-floor-tile-face.py"]) {
      expect(existsSync(path.join(SRC, "textures", file)), file).toBe(true);
    }
    const genSrc = readFileSync(path.join(SRC, "textures", "generate-floor-tile-face.py"), "utf8");
    expect(genSrc).toMatch(/SEED\s*=\s*\d+/);
    expect(genSrc).toContain("default_rng(SEED)");
  });

  it("(2) compose wires the tile face under ward_photo with a 0.6 m module", () => {
    const composeSrc = readFileSync(path.join(SRC, "compose.py"), "utf8");
    expect(composeSrc).toContain("FLOOR_TILE_MODULE_M = 0.6");
    expect(composeSrc).toContain("floor-vinyl-tile.png");
    expect(composeSrc).toContain("openclinxr_finish_floor_tile_photo");
    expect(composeSrc).toContain("floor_tile_layout");
  });

  it("(3) the ward compose emits a tile floor field, not a skipped shell pass-through", async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(prepared!.workGlb);
    const floorMesh = doc.getRoot().listMeshes().find((m) => m.getName().includes("openclinxr_floor"));
    expect(floorMesh, "expected an openclinxr_floor_* field under ward_photo").toBeDefined();
    const mat = floorMesh!.listPrimitives()[0]!.getMaterial();
    expect(mat?.getName()).toBe("openclinxr_finish_floor_tile_photo");
    expect(mat!.getBaseColorTexture(), "tile material must carry a baseColorTexture").not.toBeNull();
    expect(mat!.getNormalTexture(), "tile material must carry a normal map with seam grooves").not.toBeNull();
    expect(mat!.getMetallicRoughnessTexture(), "tile material must carry a roughness map").not.toBeNull();
  }, 120_000);

  it("(4) the tile UVs repeat at the 0.6 m module", async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(prepared!.workGlb);
    const floorMesh = doc.getRoot().listMeshes().find((m) => m.getName().includes("openclinxr_floor"));
    expect(floorMesh).toBeDefined();
    const uvAcc = floorMesh!.listPrimitives()[0]!.getAttribute("TEXCOORD_0");
    expect(uvAcc, "floor primitive must carry TEXCOORD_0").not.toBeNull();
    const arr = uvAcc!.getArray() as Float32Array;
    let minU = Infinity, maxU = -Infinity;
    for (let i = 0; i < arr.length; i += 2) {
      const u = arr[i] as number;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
    }
    // 4.3 m of floor at a 0.6 m module tiles ~7.2 times; the legacy
    // 1.2 m sheet repeat would span ~3.6.
    expect(maxU - minU).toBeGreaterThan(5);
  }, 120_000);
});

// NOT TESTED: runtime tone-mapped appearance (covered by the pose captures).
