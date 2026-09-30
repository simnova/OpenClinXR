import { execFile } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
 * OBSERVABLE: the room_clinic_finish ceiling shows ONE grid (real T-bar
 * strips) over a structure-free tile face, and the troffer is an inset
 * gradient diffuser in a real slim frame (S6 ceiling/troffer rework).
 *
 * Defects (graded 2026-09-28 on poses 03/05 at native resolution):
 * (1) ceiling-acoustic-tile.jpg photographed a 4x4 tile patch WITH its own
 *     baked T-bar lines and repeated it across the plane, so the capture
 *     showed two overlapping misaligned grids. The replacement tile-face
 *     texture holds speckle only; the grid lines are real strip geometry.
 * (2) troffer-light.jpg photographed a yellow egg-crate louvre fixture, not
 *     the v2 flat 600x1200 lay-in LED panel. The replacement troffer has a
 *     deterministic centre-bright diffuser texture and a 30 mm metal frame.
 *
 * Runs the REAL compose.py (raw Blender spawn, no package-internal imports)
 * on the same fixture shell as the S6 ceiling-troffer test, then asserts
 * against the exported GLB bytes:
 *
 * - the ceiling material's baked image has NO T-bar edge structure: mean
 *   gradient magnitude over the 32 px border band is at or below the
 *   interior mean (live PIL/numpy analysis on temp files);
 * - real openclinxr_tbar_* strip meshes sit on the 0.6 m grid lines within
 *   5 mm, 24 mm wide, underside 2 mm proud of the T-bar plane;
 * - the troffer has a named 20-40 mm frame in the exported GLB;
 * - the diffuser material is emissive and carries the gradient texture.
 *
 * Live Blender in this test per dispatch; one compose run shared by all
 * cases via beforeAll; timeout 5 min.
 */

const SHELL = { minX: -2.15, maxX: 2.15, minY: 0, maxY: 2.4, minZ: -1.95, maxZ: 1.95 };
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

type Prepared = { work: string; workGlb: string; report: Record<string, unknown> };
let prepared: Prepared | null = null;

async function composeOnce(): Promise<Prepared> {
  const work = mkdtempSync(path.join(tmpdir(), "clinic-finish-grid-"));
  const fixture = path.join(work, "fixture.glb");
  const workGlb = path.join(work, "work.glb");
  const recipePath = path.join(work, "recipe.json");
  const reportPath = path.join(work, "report.json");
  await writeFixtureGlb(fixture);
  copyFileSync(fixture, workGlb);
  writeFileSync(recipePath, recipeJson(), "utf8");
  await withComputeSlot("blender", { label: "test:clinic-ceiling-grid" }, () => execFileAsync(
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
  return { work, workGlb, report };
}

function gridDistance(value: number, origin: number): number {
  const steps = (value - origin) / GRID;
  return Math.abs(steps - Math.round(steps)) * GRID;
}

// Edge-structure probe (live PIL/numpy on temp files, printed per run).
// Two measurements on the grayscale gradient magnitude (outermost 1 px ring
// dropped AFTER differentiating: numpy's first-order edge stencil reads
// ~+0.05 hotter than the interior second-order stencil on ANY image, so the
// ring is a property of the estimator, not of the texture):
// (a) border-vs-interior: mean over the outer 32 px band vs the rest.
//     Discriminates on the repo texture FILE (old ceiling-acoustic-tile.jpg:
//     border 3.8584 vs interior 3.6133 FAIL; tile-face.png: 2.9374 vs
//     2.9809 PASS) but NOT on the baked GLB image: Blender re-encodes the
//     JPEG on export (155 kB -> 143 kB) and the baked old photo reads
//     border 5.0245 vs interior 5.1203, a false pass behind a visibly
//     gridded image. Recorded, not asserted, on the baked bytes.
// (b) quarter-pitch band test (the asserted check, file AND baked bytes):
//     pitch = width/4 tests the 4-tiles-per-side grid hypothesis the
//     defective asset carried; mean gradient within +-6 px of the grid
//     lines vs pixels at least pitch/4 from any line. Old photo baked:
//     line 7.5684 vs mid 4.6288 (ratio 1.635) FAIL; tile-face.png file
//     and baked: line 2.9660 vs mid 2.9782 (ratio 0.996) PASS.
//     A structure-free face passes at any pitch; a baked grid cannot hide
//     from its own period.
const GRADIENT_DRIVER = `
import sys
import numpy as np
from PIL import Image
g = np.asarray(Image.open(sys.argv[1]).convert("L"), dtype=np.float64)
gy, gx = np.gradient(g)
mag = np.sqrt(gx * gx + gy * gy)[1:-1, 1:-1]
h, w = mag.shape
b = 32
border = np.concatenate([mag[:b, :].ravel(), mag[-b:, :].ravel(), mag[b:-b, :b].ravel(), mag[b:-b, -b:].ravel()])
interior = mag[b:-b, b:-b].ravel()
pitch = w / 4.0
xs = np.arange(w)
ys = np.arange(h)
dx = np.minimum(xs % pitch, pitch - (xs % pitch))
dy = np.minimum(ys % pitch, pitch - (ys % pitch))
DX, DY = np.meshgrid(dx, dy)
dist = np.minimum(DX, DY)
line = mag[dist <= 6].mean()
mid = mag[dist >= pitch / 4].mean()
print("border=%.4f interior=%.4f line=%.4f mid=%.4f ratio=%.4f" % (
    float(border.mean()), float(interior.mean()), float(line), float(mid), float(line / mid)))
`;

type EdgeNumbers = { border: number; interior: number; line: number; mid: number; ratio: number };

async function edgeNumbersOf(pngBytes: Buffer, work: string, tag: string): Promise<{ numbers: EdgeNumbers; imgPath: string }> {
  const imgPath = path.join(work, `${tag}.png`);
  writeFileSync(imgPath, pngBytes);
  const driverPath = path.join(work, `${tag}-gradient.py`);
  writeFileSync(driverPath, GRADIENT_DRIVER, "utf8");
  const result = await execFileAsync("python3", [driverPath, imgPath], { timeout: 120_000 });
  const match = /border=([0-9.]+) interior=([0-9.]+) line=([0-9.]+) mid=([0-9.]+) ratio=([0-9.]+)/.exec(result.stdout);
  expect(match, `gradient driver printed measurements (stdout: ${result.stdout.slice(-500)})`).not.toBeNull();
  return {
    numbers: {
      border: Number(match![1]),
      interior: Number(match![2]),
      line: Number(match![3]),
      mid: Number(match![4]),
      ratio: Number(match![5]),
    },
    imgPath,
  };
}

describe("the room clinic finish ceiling grid and flat troffer", () => {
  beforeAll(async () => {
    prepared = await composeOnce();
  }, 300_000);

  it("(1) the ceiling texture image carries no T-bar edge structure", async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(prepared!.workGlb);
    const mats = new Map(doc.getRoot().listMaterials().map((m) => [m.getName(), m]));
    const ceilingMat = [...mats.values()].find((m) => m.getName().includes("ceiling"));
    expect(ceilingMat, "expected a ceiling material in the export").toBeDefined();
    const tex = ceilingMat!.getBaseColorTexture();
    expect(tex, "ceiling material must carry a baseColorTexture").not.toBeNull();
    const bytes = Buffer.from(tex!.getImage()!);
    expect(bytes.length).toBeGreaterThan(10_000);
    // The baked bytes must show no grid at the defective asset's own
    // period (end-to-end: texture file -> Blender pack -> GLB embed).
    const baked = await edgeNumbersOf(bytes, prepared!.work, "ceiling-baked");
    expect(
      baked.numbers.line,
      `baked ceiling texture shows grid lines (line ${baked.numbers.line.toFixed(4)} vs mid ${baked.numbers.mid.toFixed(4)}, ratio ${baked.numbers.ratio.toFixed(4)})`,
    ).toBeLessThanOrEqual(baked.numbers.mid);
    // The repo texture file behind the baked bytes must be structure-free
    // too: locate it by matching the baked image's stem against the
    // textures directory (real file bytes, no source-text assertion).
    // The directory also holds the Imagine working set for the same
    // station (kept albedo .jpg plus the pipeline's -tileable/-normal/
    // -roughness derivatives); only the wired albedo face itself is
    // probed here, and there must be exactly one of it.
    const { readdirSync } = await import("node:fs");
    const stems = readdirSync(path.join(SRC, "textures"));
    const ceilingFiles = stems.filter(
      (f) => f.toLowerCase().includes("ceiling") && f.endsWith(".png") && !/(-normal|-roughness)\.png$/u.test(f),
    );
    expect(ceilingFiles.length, "exactly one wired ceiling albedo face file").toBe(1);
    const fileBytes = readFileSync(path.join(SRC, "textures", ceilingFiles[0]!));
    const file = await edgeNumbersOf(fileBytes, prepared!.work, "ceiling-file");
    expect(
      file.numbers.line,
      `ceiling texture file ${ceilingFiles[0]} shows grid lines (line ${file.numbers.line.toFixed(4)} vs mid ${file.numbers.mid.toFixed(4)})`,
    ).toBeLessThanOrEqual(file.numbers.mid);
    expect(
      file.numbers.border,
      `ceiling texture file ${ceilingFiles[0]} shows edge structure (border ${file.numbers.border.toFixed(4)} vs interior ${file.numbers.interior.toFixed(4)})`,
    ).toBeLessThanOrEqual(file.numbers.interior);
  }, 180_000);

  it("(2) real T-bar strip meshes sit on the 0.6 m grid within 5 mm", async () => {
    const grid = prepared!.report["emittedCeilingGrid"] as {
      origin: [number, number];
      module: number;
      tbarZ: number;
    };
    expect(grid.module).toBe(GRID);
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(prepared!.workGlb);
    const xStrips = doc.getRoot().listMeshes().filter((m) => m.getName().includes("openclinxr_tbar_x_"));
    const yStrips = doc.getRoot().listMeshes().filter((m) => m.getName().includes("openclinxr_tbar_y_"));
    // 4.3 x 3.9 m shell at a 0.6 m module: ~8 x-lines, ~7 y-lines.
    expect(xStrips.length, "expected openclinxr_tbar_x_* strip meshes").toBeGreaterThan(5);
    expect(yStrips.length, "expected openclinxr_tbar_y_* strip meshes").toBeGreaterThan(5);
    const aabb = (mesh: { listPrimitives: () => Array<{ getAttribute: (n: string) => { getArray: () => unknown } | null }> }): {
      minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
    } => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const prim of mesh.listPrimitives()) {
        const arr = prim.getAttribute("POSITION")!.getArray() as Float32Array;
        for (let i = 0; i < arr.length; i += 3) {
          const x = arr[i] as number, y = arr[i + 1] as number, z = arr[i + 2] as number;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
      }
      return { minX, maxX, minY, maxY, minZ, maxZ };
    };
    // Blender x maps to glTF x, Blender y maps to glTF -z, Blender z maps to glTF y.
    const xLines: number[] = [];
    for (const mesh of xStrips) {
      const box = aabb(mesh as unknown as Parameters<typeof aabb>[0]);
      const line = (box.minX + box.maxX) / 2;
      xLines.push(line);
      expect(gridDistance(line, grid.origin[0])).toBeLessThan(0.005);
      expect(box.maxX - box.minX, "T-bar strip width").toBeCloseTo(0.024, 2);
      expect(Math.abs(box.minY - (grid.tbarZ - 0.002)), "T-bar strip underside 2 mm proud").toBeLessThan(0.005);
    }
    const yLines: number[] = [];
    for (const mesh of yStrips) {
      const box = aabb(mesh as unknown as Parameters<typeof aabb>[0]);
      const blenderY = -((box.minZ + box.maxZ) / 2);
      yLines.push(blenderY);
      expect(gridDistance(blenderY, grid.origin[1])).toBeLessThan(0.005);
      expect(box.maxZ - box.minZ, "T-bar strip width").toBeCloseTo(0.024, 2);
      expect(Math.abs(box.minY - (grid.tbarZ - 0.002)), "T-bar strip underside 2 mm proud").toBeLessThan(0.005);
    }
    for (const lines of [xLines, yLines]) {
      const sorted = [...new Set(lines.map((v) => v.toFixed(4)))].map(Number).sort((a, b) => a - b);
      expect(sorted.length).toBeGreaterThan(5);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i]! - sorted[i - 1]!, "consecutive T-bar spacing").toBeCloseTo(GRID, 2);
      }
    }
    const edgeMeshes = doc.getRoot().listMeshes().filter((m) => m.getName().includes("openclinxr_tbar_edge_"));
    expect(edgeMeshes.length, "two shadowed edge/reveal strips per T-bar span").toBe(2 * (xStrips.length + yStrips.length));
    const materials = doc.getRoot().listMaterials();
    const tbarMaterial = materials.find((material) => material.getName() === "openclinxr_finish_tbar");
    const edgeMaterial = materials.find((material) => material.getName() === "openclinxr_finish_tbar_edge");
    expect(tbarMaterial, "off-white T-bar material").toBeDefined();
    expect(edgeMaterial, "shadowed T-bar edge material").toBeDefined();
    expect(tbarMaterial!.getBaseColorFactor()[0]).toBeLessThan(0.9);
    expect(edgeMaterial!.getBaseColorFactor()[0]).toBeLessThan(tbarMaterial!.getBaseColorFactor()[0]!);
  }, 120_000);

  it("(3) the troffer exports a named 20-40 mm metal frame", async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(prepared!.workGlb);
    const frameNodes = doc.getRoot().listNodes().filter((n) => n.getName().startsWith("openclinxr_troffer_frame_"));
    expect(frameNodes.length, "named troffer frame nodes in the GLB").toBe(4);
    for (const node of frameNodes) {
      const mesh = node.getMesh();
      expect(mesh, `${node.getName()} carries frame geometry`).not.toBeNull();
      const position = mesh!.listPrimitives()[0]!.getAttribute("POSITION")!;
      const min = position.getMin([]);
      const max = position.getMax([]);
      const dimensions = max.map((value, index) => value - min[index]!).sort((a, b) => a - b);
      expect(dimensions[1], `${node.getName()} visible frame width`).toBeGreaterThanOrEqual(0.02);
      expect(dimensions[1], `${node.getName()} visible frame width`).toBeLessThanOrEqual(0.04);
    }
  }, 120_000);

  it("(4) the troffer diffuser is emissive and carries its gradient texture", async () => {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(prepared!.workGlb);
    const trofferMat = doc.getRoot().listMaterials().find((m) => m.getName().includes("troffer_diffuser"));
    expect(trofferMat, "expected a troffer material in the export").toBeDefined();
    expect(Math.max(...trofferMat!.getEmissiveFactor())).toBeGreaterThan(0);
    expect(trofferMat!.getBaseColorTexture(), "gradient diffuser on baseColor").not.toBeNull();
    expect(trofferMat!.getEmissiveTexture(), "gradient diffuser on emissive").not.toBeNull();
    expect(trofferMat!.getNormalTexture(), "no photo on normal").toBeNull();
    expect(trofferMat!.getOcclusionTexture(), "no photo on occlusion").toBeNull();
    expect(trofferMat!.getMetallicRoughnessTexture(), "no photo on metallicRoughness").toBeNull();
    expect(JSON.stringify(prepared!.report).includes("troffer-light")).toBe(false);
  }, 120_000);
});

// NOT TESTED: runtime tone-mapped appearance (covered by the pose captures).
