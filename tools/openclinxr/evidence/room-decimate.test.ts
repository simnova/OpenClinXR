import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Accessor, Document, Material, Mesh, NodeIO, Primitive, Texture } from "@gltf-transform/core";

/**
 * #346 — instrument test for the room-decimate measure. The pre-fix.json numbers are only
 * as good as `measureGlb`, and that function is what decides whether "UVs survive" is
 * true or false — so it gets a deterministic test on a synthetic GLB, not on the 1 GB
 * generator output.
 *
 * Header IMMUTABLE — append ## FIXED (#346).
 */

type MeasureFn = (glbPath: string) => Promise<{
  triangleCount: number;
  meshCount: number;
  materialCount: number;
  texturedMaterialCount: number;
  uvPrimCount: number;
  textureCount: number;
  lightCount: number;
  bytes: number;
}>;

const load = () => import("./room-decimate.js") as Promise<Record<string, unknown>>;

/** Build a tiny in-memory GLB: 2 meshes, 1 of them UV'd, 2 materials, 1 textured. */
async function buildFixture(): Promise<string> {
  const doc = new Document();

  const buf = doc.createBuffer();
  const pos = doc.createAccessor("pos")
    .setType(Accessor.Type["VEC3"])
    .setArray(new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, // triangle 1
      1, 1, 0, 0, 1, 0, 1, 0, 0, // triangle 2 (shares 2 verts of tri 1)
    ]))
    .setBuffer(buf);

  const idx = doc.createAccessor("idx")
    .setType(Accessor.Type["SCALAR"])
    .setArray(new Uint32Array([0, 1, 2, 3, 4, 5]))
    .setBuffer(buf);

  const uv = doc.createAccessor("uv")
    .setType(Accessor.Type["VEC2"])
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 1, 0]))
    .setBuffer(buf);

  const plain = doc.createMaterial("plain").setBaseColorFactor([0.8, 0.8, 0.8, 1]);

  // A real 1x1 PNG so the textured material carries an actual baseColorTexture.
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x8b, 0x4b, 0xb3, 0x5e,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  const img = doc.createTexture("tex").setMimeType("image/png").setImage(pngBytes);
  const textured = doc.createMaterial("textured").setBaseColorTexture(img);

  const uvPrim = doc.createPrimitive()
    .setAttribute("POSITION", pos)
    .setAttribute("TEXCOORD_0", uv)
    .setIndices(idx)
    .setMaterial(textured);

  const plainPrim = doc.createPrimitive()
    .setAttribute("POSITION", pos)
    .setIndices(idx)
    .setMaterial(plain);

  doc.createMesh("uvMesh").addPrimitive(uvPrim);
  doc.createMesh("plainMesh").addPrimitive(plainPrim);
  doc.createScene("scene").addChild(doc.createNode("root"));

  const dir = mkdtempSync(path.join(os.tmpdir(), "room-decimate-"));
  const glbPath = path.join(dir, "fixture.glb");
  await new NodeIO().write(glbPath, doc);
  return glbPath;
}

describe("room-decimate measureGlb (#346)", () => {
  it("counts tris, materials, textured materials and UV primitives", async () => {
    const mod = await load();
    const measure = mod["measureGlb"] as MeasureFn | undefined;
    expect(measure).toBeTypeOf("function");

    const glbPath = await buildFixture();
    try {
      const m = await measure!(glbPath);
      // 2 meshes x 2 triangles each (both primitives share the same pos+idx accessors).
      expect(m.triangleCount).toBe(4);
      expect(m.meshCount).toBe(2);
      expect(m.materialCount).toBe(2);
      expect(m.texturedMaterialCount).toBe(1);
      expect(m.uvPrimCount).toBe(1);
      expect(m.textureCount).toBe(1);
      expect(m.lightCount).toBe(0);

      const countComponents = mod["countConnectedComponents"] as
        | ((glbPath: string) => Promise<number>)
        | undefined;
      expect(countComponents).toBeTypeOf("function");
      // Index-connectivity: each primitive is 2 triangles with duplicated (not shared)
      // vertex indices -> 2 components per mesh x 2 meshes.
      expect(await countComponents!(glbPath)).toBe(4);
    } finally {
      rmSync(path.dirname(glbPath), { recursive: true, force: true });
    }
  });
});

/**
 * ## FIXED (#346)
 *
 * Implemented `measureGlb`, `decimateGlb` (meshoptimizer via @gltf-transform/functions)
 * and `inspectRoomDecimate` in `room-decimate.ts`. Instrument test above pins the
 * measure's channel counts on a synthetic 2-triangle fixture.
 */
