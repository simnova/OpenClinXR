import { execFile } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { withComputeSlot } from "@openclinxr/compute-slots";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SRC = dirname(fileURLToPath(import.meta.url));

/**
 * OBSERVABLE: room_clinic_finish emits a textured acoustic-tile ceiling with
 * a flush troffer (S6), and the floor vinyl repeat survives glTF export as
 * real TEXCOORD_0 values (TASK 2).
 *
 * Runs the REAL compose.py (raw Blender spawn, no package-internal imports --
 * the runner wrapper is not the subject here) on a fixture shell with exact
 * known bounds (glTF x in [-2.15, 2.15], y in [0, 2.4], z in
 * [-1.95, 1.95], i.e. the ward footprint), then asserts against the
 * exported GLB bytes and the compose report:
 *
 * - a ceiling material carries a baseColorTexture photo distinct from the
 *   floor vinyl photo, on a ceiling mesh spanning the shell;
 * - the troffer AABB top sits within 3 mm of the measured ceiling plane
 *   minus the 0.06 m T-bar drop, with long edges on the recorded 0.6 m grid;
 * - the floor (and ceiling) UV accessors span tiled ranges, not [0, 1];
 * - no Blender light object was created (report count 0, no
 *   KHR_lights_punctual in the export).
 *
 * Live Blender in this test per dispatch; one compose run shared by all
 * cases via beforeAll; timeout 5 min.
 */

const SHELL = { minX: -2.15, maxX: 2.15, minY: 0, maxY: 2.4, minZ: -1.95, maxZ: 1.95 };
const CEILING_PLANE = 2.4;
const TBAR_DROP = 0.06;
const GRID = 0.6;

function boxPositions(min: [number, number, number], max: [number, number, number]): Float32Array<ArrayBuffer> {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return new Float32Array([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]);
}

const BOX_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);

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
  addBox("TestShell", [SHELL.minX, SHELL.minY, SHELL.minZ], [SHELL.maxX, SHELL.maxY, SHELL.maxZ]);
  addBox("TestRoom_0.door_leaf", [0.0, 0.0, 3.7], [0.95, 2.1, 3.75]);
  await new NodeIO().write(outputPath, doc);
}

function recipeJson(): string {
  return `${JSON.stringify(
    {
      schemaVersion: "openclinxr.room-clinic-finish.v1",
      environmentId: "ed_exam_bay_v1",
      preset: "clinic_day",
      seed: 7,
      palette: {
        wallAlbedo: [0.9, 0.9, 0.88],
        trimAlbedo: [0.96, 0.96, 0.94],
        accentAlbedo: [0.25, 0.5, 0.68],
        roughness: 0.8,
        signageAnchors: ["door_header", "exam_table_foot"],
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
  const work = mkdtempSync(path.join(tmpdir(), "clinic-finish-s6-"));
  const fixture = path.join(work, "fixture.glb");
  const workGlb = path.join(work, "work.glb");
  const recipePath = path.join(work, "recipe.json");
  const reportPath = path.join(work, "report.json");
  await writeFixtureGlb(fixture);
  copyFileSync(fixture, workGlb);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(recipePath, recipeJson(), "utf8");
  await withComputeSlot("blender", { label: "test:clinic-troffer-floor-uv" }, () => execFileAsync(
    "blender",
    [
      "--background",
      "--python",
      path.join(SRC, "compose.py"),
      "--",
      "--input",
      workGlb,
      "--output",
      workGlb,
      "--recipe-json",
      recipePath,
      "--report",
      reportPath,
    ],
    { timeout: 300_000 },
  ));
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
  return { workGlb, report };
}

type PrimStats = { mesh: string; material: string; uv: { minU: number; maxU: number; minV: number; maxV: number } | null };

async function readPrimStats(glbPath: string): Promise<{ stats: PrimStats[]; rawJson: Record<string, unknown> }> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(glbPath);
  const stats: PrimStats[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const uvAcc = prim.getAttribute("TEXCOORD_0");
      let uv: PrimStats["uv"] = null;
      if (uvAcc) {
        const arr = uvAcc.getArray() as Float32Array;
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        for (let i = 0; i < arr.length; i += 2) {
          const u = arr[i] as number;
          const v = arr[i + 1] as number;
          if (u < minU) minU = u;
          if (u > maxU) maxU = u;
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
        uv = { minU, maxU, minV, maxV };
      }
      stats.push({ mesh: mesh.getName(), material: mat ? mat.getName() : "(none)", uv });
    }
  }
  const raw = readFileSync(glbPath);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const chunkLength = view.getUint32(12, true);
  const rawJson = JSON.parse(raw.subarray(20, 20 + chunkLength).toString("utf8")) as Record<string, unknown>;
  return { stats, rawJson };
}

function gridDistance(value: number, origin: number): number {
  const steps = (value - origin) / GRID;
  return Math.abs(steps - Math.round(steps)) * GRID;
}

describe("the room clinic finish ceiling grid and flush troffer", () => {
  beforeAll(async () => {
    prepared = await composeOnce();
  }, 300_000);

  it("(1) the ceiling mesh carries an acoustic-tile photo material distinct from the floor vinyl", async () => {
    const { stats } = await readPrimStats(prepared!.workGlb);
    const ceiling = stats.filter((entry) => entry.mesh.includes("openclinxr_ceiling"));
    expect(ceiling.length, "expected an openclinxr_ceiling_* mesh in the export").toBeGreaterThan(0);
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(prepared!.workGlb);
    const mats = new Map(doc.getRoot().listMaterials().map((m) => [m.getName(), m]));
    const ceilingMat = mats.get(ceiling[0]!.material);
    expect(ceilingMat).toBeDefined();
    expect(ceilingMat!.getBaseColorTexture(), "ceiling material must carry a baseColorTexture").not.toBeNull();
    const ceilingBytes = ceilingMat!.getBaseColorTexture()!.getImage()!.byteLength;
    expect(ceilingBytes).toBeGreaterThan(50_000);
    const floorMat = [...mats.values()].find((m) => m.getName().includes("floor_photo"));
    expect(floorMat).toBeDefined();
    const floorBytes = floorMat!.getBaseColorTexture()!.getImage()!.byteLength;
    expect(ceilingBytes).not.toBe(floorBytes);
  }, 120_000);

  it("(2) the troffer top sits within 3 mm of the T-bar plane with long edges on the 0.6 m grid", async () => {
    const grid = prepared!.report["emittedCeilingGrid"] as {
      origin: [number, number];
      module: number;
      tbarZ: number;
      troffer: { minX: number; maxX: number; minY: number; maxY: number; topZ: number };
    };
    expect(grid.module).toBe(GRID);
    expect(grid.tbarZ).toBeCloseTo(CEILING_PLANE - TBAR_DROP, 3);
    expect(Math.abs(grid.origin[0] / GRID - Math.round(grid.origin[0] / GRID))).toBeLessThan(1e-6);
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(prepared!.workGlb);
    const trofferMeshes = doc.getRoot().listMeshes().filter((m) => m.getName().includes("troffer"));
    expect(trofferMeshes.length, "expected diffuser and frame meshes in the export").toBe(5);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
    for (const mesh of trofferMeshes) {
      for (const prim of mesh.listPrimitives()) {
        const arr = (prim.getAttribute("POSITION")!.getArray() as Float32Array);
        for (let i = 0; i < arr.length; i += 3) {
          const x = arr[i] as number;
          const y = arr[i + 1] as number;
          const z = arr[i + 2] as number;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
          if (y > maxY) maxY = y;
        }
      }
    }
    // glTF y is up: the AABB top is the troffer face nearest the ceiling plane.
    expect(Math.abs(maxY - grid.tbarZ)).toBeLessThan(0.003);
    // Blender x maps to glTF x, Blender y maps to glTF -z.
    expect(maxX - minX).toBeCloseTo(1.2, 2);
    expect(maxZ - minZ).toBeCloseTo(0.6, 2);
    for (const edge of [minX, maxX]) {
      expect(gridDistance(edge, grid.origin[0])).toBeLessThan(0.01);
    }
    for (const edge of [-minZ, -maxZ]) {
      expect(gridDistance(edge, grid.origin[1])).toBeLessThan(0.01);
    }
  }, 120_000);

  it("(3) the troffer material is emissive and no Blender light object was created", async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(prepared!.workGlb);
    const trofferMat = doc.getRoot().listMaterials().find((m) => m.getName().includes("troffer"));
    expect(trofferMat, "expected a troffer material in the export").toBeDefined();
    const emissive = trofferMat!.getEmissiveFactor();
    expect(Math.max(...emissive)).toBeGreaterThan(0);
    expect(prepared!.report["blenderLights"]).toBe(0);
    const { rawJson } = await readPrimStats(prepared!.workGlb);
    expect(JSON.stringify(rawJson).includes("KHR_lights_punctual")).toBe(false);
  }, 120_000);

  it("(4) the floor vinyl UVs span a tiled range, not a single stretched [0, 1] image", async () => {
    const { stats } = await readPrimStats(prepared!.workGlb);
    const floor = stats.filter((entry) => entry.mesh.includes("openclinxr_floor"));
    expect(floor.length).toBeGreaterThan(0);
    for (const entry of floor) {
      expect(entry.uv, "floor primitive must carry TEXCOORD_0").not.toBeNull();
      // 4.3 m of floor at a 1.2 m repeat tiles ~3.6 times; a stretched
      // single image would span at most 1.
      expect(entry.uv!.maxU - entry.uv!.minU).toBeGreaterThan(2.5);
      expect(entry.uv!.maxV - entry.uv!.minV).toBeGreaterThan(2.5);
    }
  }, 120_000);

  it("(5) the ceiling tile UVs span a 0.6 m-module tiled range", async () => {
    const { stats } = await readPrimStats(prepared!.workGlb);
    const ceiling = stats.filter((entry) => entry.mesh.includes("openclinxr_ceiling"));
    expect(ceiling.length).toBeGreaterThan(0);
    for (const entry of ceiling) {
      expect(entry.uv, "ceiling primitive must carry TEXCOORD_0").not.toBeNull();
      // 4.3 m at a 0.6 m repeat (one tile face per repeat, one tile per
      // 0.6 m module) tiles ~7.2 times: a stretched single image would
      // span at most 1.
      expect(entry.uv!.maxU - entry.uv!.minU).toBeGreaterThan(2.5);
      expect(entry.uv!.maxV - entry.uv!.minV).toBeGreaterThan(2.5);
    }
  }, 120_000);
});

// NOT TESTED: runtime tone-mapped appearance (covered by the pose captures);
// T-bar edge structure and strip positions (covered by
// the-room-clinic-finish-ceiling-grid-and-flat-troffer.test.ts).
