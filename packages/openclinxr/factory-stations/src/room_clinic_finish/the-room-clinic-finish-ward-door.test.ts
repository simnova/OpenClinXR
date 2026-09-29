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
 * OBSERVABLE: under ward_photo with recipe options.door, the finish furnishes
 * the ward door -- dark glass pane + steel lite frame + hinge plates
 * on the hinge jamb + casing repainted to the palette trim -- while maple
 * stays on the leaf (ward door exception, see README).
 *
 * On main compose.py has no furniture path (no openclinxr_door_glass node,
 * no lite frame, no hinge plates, casing keeps its input material), so every
 * case below fails there and passes after the change. One real compose.py
 * run (raw Blender spawn, ward_photo recipe) shared via beforeAll; the rest
 * pin the mechanism statically.
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
  // Shell floor slab (authored Y-UP): the cove foundation sits on its
  // top plane plus the field lift.
  addBox("TestRoom_0.floor", [-2.15, 0, -1.95], [2.15, 0.02, 1.95]);
  // Flat ward leaf 0.95 wide x 2.1 tall (no hole: the recipe fractions
  // place the lite, exercising the fallback path).
  addBox("TestRoom_0.door_leaf", [0.0, 0, -1.8], [0.95, 2.1, -1.7]);
  // Three-piece casing: jambs + head, 55 mm face.
  addBox("TestRoom_0.door_casing_1", [-0.055, 0, -1.8], [0.0, 2.1, -1.745]);
  addBox("TestRoom_0.door_casing_2", [0.95, 0, -1.8], [1.005, 2.1, -1.745]);
  addBox("TestRoom_0.door_casing_3", [-0.055, 2.1, -1.8], [1.005, 2.155, -1.745]);
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
      options: { crashRail: false, door: { hingeSide: "+x", lite: [0.64, 0.8, 0.58, 0.87], margin: 0.1 } },
      finishPassLlm: false,
    },
    null,
    2,
  )}\n`;
}

type Prepared = { workGlb: string; report: Record<string, unknown> };
let prepared: Prepared | null = null;

async function composeOnce(): Promise<Prepared> {
  const work = mkdtempSync(path.join(tmpdir(), "clinic-finish-ward-door-"));
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

function meshByName(doc: Awaited<ReturnType<NodeIO["read"]>>, name: string) {
  return doc.getRoot().listMeshes().find((m) => m.getName() === name);
}

function meshExtents(mesh: NonNullable<ReturnType<typeof meshByName>>): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const prim of mesh.listPrimitives()) {
    const arr = prim.getAttribute("POSITION")!.getArray() as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      for (let a = 0; a < 3; a += 1) {
        const v = arr[i + a] as number;
        if (v < min[a]!) min[a] = v;
        if (v > max[a]!) max[a] = v;
      }
    }
  }
  return { min, max };
}

describe("the room clinic finish ward door", () => {
  beforeAll(async () => {
    prepared = await composeOnce();
  }, 300_000);

  it("(1) compose carries the ward-door furniture path", () => {
    const composeSrc = readFileSync(path.join(SRC, "compose.py"), "utf8");
    expect(composeSrc).toContain("_furnish_ward_door");
    expect(composeSrc).toContain("openclinxr_door_glass");
    expect(composeSrc).toContain("Transmission");
    expect(composeSrc).toContain("openclinxr_door_hinge_");
    expect(composeSrc).toContain("openclinxr_finish_casing");
  });

  it("(2) a dark partly-transparent glass pane lands on the lite fractions", async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(prepared!.workGlb);
    const glass = meshByName(doc, "openclinxr_door_glass_mesh");
    expect(glass, "glass pane mesh must exist").toBeDefined();
    // Leaf maps to Blender x 0..0.95, z 0..2.1; the factory mapping
    // mirrors leaf-local +x toward -x over (span - 2*margin) + margin
    // (margin 0.1): lite u = 0.25..0.37 plus 8 mm overlap per side;
    // v = 1.20..1.75 plus overlap.
    // glTF is Y-UP (Blender z maps to y), so width is x, height is y.
    const { min, max } = meshExtents(glass!);
    expect(max[0]! - min[0]!).toBeGreaterThan(0.1);
    expect(max[0]! - min[0]!).toBeLessThan(0.2);
    expect(max[1]! - min[1]!).toBeGreaterThan(0.5);
    expect(max[1]! - min[1]!).toBeLessThan(0.7);
    const glassMat = doc.getRoot().listMaterials().find((m) => m.getName() === "openclinxr_door_glass");
    expect(glassMat, "glass material must exist").toBeDefined();
    expect(glassMat!.getBaseColorTexture(), "glass must not be an opaque photo").toBeNull();
    // Dark glass, not transmission (the runtime has no scene environment
    // for a transmission pass): near-black albedo, alpha blend.
    expect(glassMat!.getAlphaMode()).toBe("BLEND");
    const factor = glassMat!.getBaseColorFactor();
    for (let i = 0; i < 3; i += 1) expect(factor[i]!).toBeLessThan(0.15);
    expect(factor[3]!).toBeLessThan(1.0);
    const furniture = prepared!.report["doorFurniture"] as { openingSource: string };
    expect(furniture.openingSource).toBe("recipe-fractions");
  }, 120_000);

  it("(3) the steel lite frame and three hinge plates mount on the +x jamb", async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(prepared!.workGlb);
    const names = doc.getRoot().listMeshes().map((m) => m.getName());
    for (let i = 0; i < 4; i += 1) {
      expect(names.some((n) => n.includes(`openclinxr_door_liteframe_${i}`)), `lite rail ${i} must exist`).toBe(true);
    }
    for (let i = 0; i < 3; i += 1) {
      expect(names.some((n) => n.includes(`openclinxr_door_hinge_${i}`)), `hinge ${i} must exist`).toBe(true);
    }
    const hinge = meshByName(doc, "openclinxr_door_hinge_0_mesh");
    const { min, max } = meshExtents(hinge!);
    // +x jamb: plate center sits at the leaf edge x = 0.95.
    expect((min[0]! + max[0]!) / 2).toBeGreaterThan(0.9);
    expect((min[0]! + max[0]!) / 2).toBeLessThan(1.0);
    const steel = doc.getRoot().listMaterials().find((m) => m.getName() === "openclinxr_door_steel");
    expect(steel).toBeDefined();
    expect(steel!.getMetallicFactor()).toBeGreaterThan(0.5);
    // Fixture leaf is a plain box: no protruding handle, so no steel slot,
    // no lock, and hinges fall back to the recipe side mapping.
    const furniture = prepared!.report["doorFurniture"] as {
      handle: unknown; lock: unknown; hingeSideUsed: string;
    };
    expect(furniture.handle).toBeNull();
    expect(furniture.lock).toBeNull();
    expect(furniture.hingeSideUsed).toBe("recipe-fallback");
  }, 120_000);

  it("(4) the casing repaints to the palette trim and the leaf keeps maple", async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(prepared!.workGlb);
    const casingMat = doc.getRoot().listMaterials().find((m) => m.getName() === "openclinxr_finish_casing");
    expect(casingMat, "casing paint must exist").toBeDefined();
    const factor = casingMat!.getBaseColorFactor();
    // Ward casing spec white (DOOR_CASING_RGB), decoupled from palette trim.
    for (let i = 0; i < 3; i += 1) {
      expect(Math.abs(factor[i]! - [0.95, 0.96, 0.98][i]!)).toBeLessThan(0.02);
    }
    const furniture = prepared!.report["doorFurniture"] as { casing: string[] };
    expect(furniture.casing.length).toBe(3);
    const leafMat = doc.getRoot().listMaterials().find((m) => m.getName() === "openclinxr_finish_door_photo");
    expect(leafMat, "maple stays on the leaf").toBeDefined();
    expect(leafMat!.getBaseColorTexture()).not.toBeNull();
  }, 120_000);
});

// NOT TESTED: runtime tone-mapped appearance (covered by the pose captures).
