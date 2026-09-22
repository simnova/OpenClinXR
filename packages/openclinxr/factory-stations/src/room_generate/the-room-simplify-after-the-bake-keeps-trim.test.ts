import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { simplifyRoomAfterBake, trimLockReason } from "./simplify.js";

/**
 * Post-bake room simplify keeps architectural trim and reduces the rest.
 *
 * simplifyRoomAfterBake runs after both bakes on options.workGlb and writes
 * back to it (the UV bake needs the full mesh first). Fixture: a subdivided
 * grid mesh named "wall" (large connected surface, ratio 0.5 reduces it) plus
 * a 12-triangle box named "skirtingboard_support" (matches the trim lock
 * /skirt|casing|door|window/i). No Blender in this test: the fixture is built
 * with @gltf-transform/core document APIs, and assertions compare after
 * against before rather than hardcoding an output count.
 */

function gridPositions(size: number, segments: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(new ArrayBuffer((segments + 1) * (segments + 1) * 3 * 4));
  const step = (2 * size) / segments;
  let i = 0;
  for (let row = 0; row <= segments; row++) {
    for (let col = 0; col <= segments; col++) {
      out[i++] = -size + col * step;
      out[i++] = -size + row * step;
      out[i++] = Math.sin(col * 0.35) * Math.cos(row * 0.3) * 0.12;
    }
  }
  return out;
}

function gridIndices(segments: number): Uint32Array<ArrayBuffer> {
  const out = new Uint32Array(new ArrayBuffer(segments * segments * 6 * 4));
  let i = 0;
  for (let row = 0; row < segments; row++) {
    for (let col = 0; col < segments; col++) {
      const a = row * (segments + 1) + col;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      out[i++] = a; out[i++] = c; out[i++] = b;
      out[i++] = b; out[i++] = c; out[i++] = d;
    }
  }
  return out;
}

const BOX_POSITIONS = new Float32Array([
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
  -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
]);

const BOX_INDICES = new Uint32Array([
  0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
  0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2,
  2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
]);

async function buildFixtureGlb(outPath: string): Promise<void> {
  const doc = new Document();
  const buffer = doc.createBuffer();

  const wallPos = doc.createAccessor().setType("VEC3").setArray(gridPositions(2, 32));
  const wallIdx = doc.createAccessor().setType("SCALAR").setArray(gridIndices(32));
  const wallPrim = doc.createPrimitive().setAttribute("POSITION", wallPos).setIndices(wallIdx);
  const wallMesh = doc.createMesh("wall").addPrimitive(wallPrim);
  const wallNode = doc.createNode("wall_node").setMesh(wallMesh);

  const boxPos = doc.createAccessor().setType("VEC3").setArray(BOX_POSITIONS);
  const boxIdx = doc.createAccessor().setType("SCALAR").setArray(BOX_INDICES);
  const boxPrim = doc.createPrimitive().setAttribute("POSITION", boxPos).setIndices(boxIdx);
  const boxMesh = doc.createMesh("skirtingboard_support").addPrimitive(boxPrim);
  const boxNode = doc.createNode("skirting_node").setMesh(boxMesh);

  doc.createScene("fixture").addChild(wallNode).addChild(boxNode);
  for (const accessor of [wallPos, wallIdx, boxPos, boxIdx]) accessor.setBuffer(buffer);

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  await io.write(outPath, doc);
}

function meshTriangleCounts(doc: Document): Map<string, number> {
  const counts = new Map<string, number>();
  for (const mesh of doc.getRoot().listMeshes()) {
    let tris = 0;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) tris += idx.getCount() / 3;
    }
    counts.set(mesh.getName(), Math.round(tris));
  }
  return counts;
}

let workDir = "";

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "room-simplify-"));
});

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

function readingIo(): NodeIO {
  return new NodeIO()
    .registerExtensions([...ALL_EXTENSIONS, EXTMeshoptCompression])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
}

describe("the room simplify after the bake keeps trim", () => {
  it("(1) skirting triangle count is unchanged and wall triangle count is lower", async () => {
    const glbPath = path.join(workDir, "fixture.glb");
    await buildFixtureGlb(glbPath);

    const before = meshTriangleCounts(await readingIo().read(glbPath));
    const wallBefore = before.get("wall") ?? 0;
    const skirtingBefore = before.get("skirtingboard_support") ?? 0;
    expect(wallBefore).toBeGreaterThan(0);
    expect(skirtingBefore).toBe(BOX_INDICES.length / 3);

    const report = await simplifyRoomAfterBake(glbPath);

    const after = meshTriangleCounts(await readingIo().read(glbPath));
    expect(after.get("skirtingboard_support")).toBe(skirtingBefore);
    expect(after.get("wall") ?? 0).toBeLessThan(wallBefore);

    const skirting = report.meshes.find((row) => row.name === "skirtingboard_support");
    const wall = report.meshes.find((row) => row.name === "wall");
    expect(skirting?.locked).toBe(true);
    expect(skirting?.before).toBe(skirtingBefore);
    expect(skirting?.after).toBe(skirtingBefore);
    expect(wall?.locked).toBe(false);
    expect(wall?.before).toBe(wallBefore);
    expect(report.lockedBefore).toBe(skirtingBefore);
    expect(report.lockedAfter).toBe(skirtingBefore);
    expect(report.simplifiedBefore).toBe(wallBefore);
    expect(report.simplifiedAfter).toBe(after.get("wall"));
    expect(report.trimReverted).toEqual([]);
  });

  it("(2) a dense coplanar skirting grid loses triangles within 1% of its AABB", async () => {
    const glbPath = path.join(workDir, "trim-grid.glb");
    const doc = new Document();
    const buffer = doc.createBuffer();
    const pos = doc.createAccessor().setType("VEC3").setArray(gridPositions(3, 24));
    const idx = doc.createAccessor().setType("SCALAR").setArray(gridIndices(24));
    const prim = doc.createPrimitive().setAttribute("POSITION", pos).setIndices(idx);
    const mesh = doc.createMesh("skirtingboard_support").addPrimitive(prim);
    const node = doc.createNode("skirtingboard_support").setMesh(mesh);
    doc.createScene("trim").addChild(node);
    for (const accessor of [pos, idx]) accessor.setBuffer(buffer);
    await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(glbPath, doc);

    const before = meshTriangleCounts(await readingIo().read(glbPath));
    const trimBefore = before.get("skirtingboard_support") ?? 0;
    expect(trimBefore).toBeGreaterThan(200);
    expect(trimLockReason("skirtingboard_support", ["skirtingboard_support"])).toBe("mesh");

    const report = await simplifyRoomAfterBake(glbPath);

    const after = meshTriangleCounts(await readingIo().read(glbPath));
    const trimAfter = after.get("skirtingboard_support") ?? 0;
    expect(trimAfter).toBeLessThan(trimBefore);

    const row = report.meshes.find((entry) => entry.name === "skirtingboard_support");
    expect(row?.locked).toBe(true);
    expect(row?.before).toBe(trimBefore);
    expect(row?.after).toBe(trimAfter);
    expect(report.lockedBefore).toBe(trimBefore);
    expect(report.lockedAfter).toBe(trimAfter);
    expect(report.trimReverted).toEqual([]);
    expect(report.trimDiagonalDrift["skirtingboard_support"] ?? 1).toBeLessThan(0.01);
  });
});
