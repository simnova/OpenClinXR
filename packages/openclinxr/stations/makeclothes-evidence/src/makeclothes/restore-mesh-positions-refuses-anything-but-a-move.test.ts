/**
 * restore-mesh-positions.ts may only undo a pure POSITION move: it copies the pre-image
 * positions when every other attribute matches, and refuses when any other attribute differs
 * (that would be a different fit, not an accidental move).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { restoreMeshPositions } from "../../../../../../tools/openclinxr/asset-pipeline/makeclothes/restore-mesh-positions.js";

async function writeTri(path: string, y: number, normalZ: number): Promise<void> {
  const doc = new Document();
  const buf = doc.createBuffer();
  const pos = doc.createAccessor().setType("VEC3").setBuffer(buf).setArray(new Float32Array([0, y, 0, 1, y, 0, 0, y, 1]));
  const nrm = doc.createAccessor().setType("VEC3").setBuffer(buf).setArray(new Float32Array([0, 1, normalZ, 0, 1, normalZ, 0, 1, normalZ]));
  const idx = doc.createAccessor().setType("SCALAR").setBuffer(buf).setArray(new Uint16Array([0, 1, 2]));
  const prim = doc.createPrimitive().setAttribute("POSITION", pos).setAttribute("NORMAL", nrm).setIndices(idx);
  doc.createNode("n").setMesh(doc.createMesh("hair_mesh").addPrimitive(prim));
  await new NodeIO().write(path, doc);
}

async function ys(path: string): Promise<number[]> {
  const doc = await new NodeIO().read(path);
  const a = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!.getAttribute("POSITION")!.getArray()!;
  return [a[1]!, a[4]!, a[7]!];
}

describe("restore-mesh-positions", () => {
  const dir = mkdtempSync(join(tmpdir(), "restore-pos-"));

  it("copies the pre-image positions when only POSITION moved", async () => {
    await writeTri(join(dir, "a.glb"), 1.0, 0);
    await writeTri(join(dir, "pre.glb"), 1.5, 0);
    const r = await restoreMeshPositions(join(dir, "a.glb"), join(dir, "pre.glb"), /hair/i, false);
    expect(r.vertices).toBe(3);
    expect(r.meanDyM).toBeCloseTo(0.5, 6);
    expect(await ys(join(dir, "a.glb"))).toEqual([1.5, 1.5, 1.5]);
  });

  it("refuses when another attribute differs, and writes nothing", async () => {
    await writeTri(join(dir, "b.glb"), 1.0, 0);
    await writeTri(join(dir, "pre2.glb"), 1.5, 0.5);
    await expect(restoreMeshPositions(join(dir, "b.glb"), join(dir, "pre2.glb"), /hair/i, false)).rejects.toThrow(
      /NORMAL differs/,
    );
    expect(await ys(join(dir, "b.glb"))).toEqual([1, 1, 1]);
  });
});
