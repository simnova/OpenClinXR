import { Document } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import {
  finalizeEquipmentGlbDocument,
  removeDegenerateTrianglesFromPrimitive,
} from "./finalize-equipment-glb.js";

/**
 * Fixture: a quad (2 real triangles) plus one deliberately zero-area triangle
 * reusing an existing vertex twice, plus one vertex referenced by NO triangle
 * at all (the orphaned-vertex defect measured on bedside-monitor-generated.glb).
 *
 *   v0 (0,0,0)  v1 (1,0,0)  v2 (1,1,0)  v3 (0,1,0)  v4 (9,9,9) orphan
 *   real tris: [0,1,2] [0,2,3]
 *   degenerate tri: [1,1,1] (zero area, all three indices the same vertex)
 */
function buildFixtureDocWithDegenerateAndOrphan(): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(
      new Float32Array([
        0, 0, 0, // v0
        1, 0, 0, // v1
        1, 1, 0, // v2
        0, 1, 0, // v3
        9, 9, 9, // v4 orphan
      ]),
    )
    .setBuffer(buffer);
  const indices = doc
    .createAccessor()
    .setType("SCALAR")
    .setArray(new Uint16Array([0, 1, 2, 0, 2, 3, 1, 1, 1]))
    .setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute("POSITION", position).setIndices(indices);
  const mesh = doc.createMesh("fixture-quad-with-defects").addPrimitive(prim);
  const node = doc.createNode("fixture-node").setMesh(mesh);
  doc.createScene().addChild(node);
  return doc;
}

/** A clean quad control fixture: no degenerate triangles, no orphaned vertices. */
function buildCleanFixtureDoc(): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const indices = doc
    .createAccessor()
    .setType("SCALAR")
    .setArray(new Uint16Array([0, 1, 2, 0, 2, 3]))
    .setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute("POSITION", position).setIndices(indices);
  const mesh = doc.createMesh("fixture-clean-quad").addPrimitive(prim);
  const node = doc.createNode("fixture-node").setMesh(mesh);
  doc.createScene().addChild(node);
  return doc;
}

function tris(doc: Document): number {
  let t = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) t += idx.getCount() / 3;
    }
  }
  return t;
}

function verts(doc: Document): number {
  let v = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (pos) v += pos.getCount();
    }
  }
  return v;
}

describe("finalizeEquipmentGlbDocument — degenerate triangles and orphaned vertices", () => {
  it("removes a planted zero-area triangle and drops the vertex it orphans", async () => {
    const doc = buildFixtureDocWithDegenerateAndOrphan();
    expect(tris(doc)).toBe(3);
    expect(verts(doc)).toBe(5);

    const report = await finalizeEquipmentGlbDocument(doc);

    expect(report.degenerateTrianglesRemoved).toBe(1);
    expect(report.trianglesBefore).toBe(3);
    expect(report.trianglesAfter).toBe(2);
    // v4 (orphan, never referenced by any triangle even before the fix) is dropped too.
    expect(report.verticesBefore).toBe(5);
    expect(report.verticesAfter).toBe(4);
    expect(tris(doc)).toBe(2);
    expect(verts(doc)).toBe(4);

    // The two surviving triangles still describe the same unit quad — no real
    // geometry was touched, only the planted defect and the orphan.
    const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    const pos = prim.getAttribute("POSITION")!.getArray()!;
    const xs = [...pos].filter((_, i) => i % 3 === 0);
    const ys = [...pos].filter((_, i) => i % 3 === 1);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(1);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(1);
  });

  it("control: a clean primitive with no defects passes through with zero triangles or vertices removed", async () => {
    const doc = buildCleanFixtureDoc();
    const report = await finalizeEquipmentGlbDocument(doc);

    expect(report.degenerateTrianglesRemoved).toBe(0);
    expect(report.trianglesBefore).toBe(2);
    expect(report.trianglesAfter).toBe(2);
    expect(report.verticesBefore).toBe(4);
    expect(report.verticesAfter).toBe(4);
  });

  it("removeDegenerateTrianglesFromPrimitive returns 0 and leaves a non-indexed primitive untouched", () => {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const position = doc
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]))
      .setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute("POSITION", position); // no setIndices()
    expect(removeDegenerateTrianglesFromPrimitive(prim)).toBe(0);
  });
});

/**
 * 2x2 non-solid-color PNG (red/green/blue/yellow pixels), valid header. A 1x1
 * solid-color PNG collapses through prune()'s keepSolidTextures=false path
 * (single-color texture -> material factor, texture removed) before the dedup
 * count can be asserted — a fixture artifact, not the defect under test — so
 * this fixture is deliberately non-uniform, matching the real 203,149-byte
 * exam-table texture it stands in for.
 */
const FIXTURE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAAMIM////ZwAAHu8E/KPItPcAAAAASUVORK5CYII=";

describe("finalizeEquipmentGlbDocument — duplicate texture/material dedup", () => {
  it("collapses N property-identical materials sharing one byte-identical texture into 1", async () => {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const imageBytes = new Uint8Array(Buffer.from(FIXTURE_PNG_BASE64, "base64")); // identical each time

    const position = doc
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]))
      .setBuffer(buffer);
    const uv = doc
      .createAccessor()
      .setType("VEC2")
      .setArray(new Float32Array([0, 0, 1, 0, 1, 1]))
      .setBuffer(buffer);

    const mesh = doc.createMesh("fixture-mesh");
    for (let i = 0; i < 5; i++) {
      const texture = doc
        .createTexture(`Image_${i}`)
        .setImage(imageBytes)
        .setMimeType("image/png");
      const material = doc
        .createMaterial(`Material.${i}`)
        .setBaseColorTexture(texture)
        .setRoughnessFactor(0.8)
        .setMetallicFactor(0);
      const prim = doc
        .createPrimitive()
        .setAttribute("POSITION", position)
        .setAttribute("TEXCOORD_0", uv)
        .setMaterial(material);
      mesh.addPrimitive(prim);
    }
    const node = doc.createNode("fixture-node").setMesh(mesh);
    doc.createScene().addChild(node);

    expect(doc.getRoot().listTextures().length).toBe(5);
    expect(doc.getRoot().listMaterials().length).toBe(5);

    const report = await finalizeEquipmentGlbDocument(doc);

    expect(report.texturesBefore).toBe(5);
    expect(report.texturesAfter).toBe(1);
    expect(report.materialsBefore).toBe(5);
    expect(report.materialsAfter).toBe(1);
    expect(doc.getRoot().listTextures().length).toBe(1);
    expect(doc.getRoot().listMaterials().length).toBe(1);
    // All 5 primitives still render — they now share the single deduped material.
    expect(mesh.listPrimitives().length).toBe(5);
    for (const prim of mesh.listPrimitives()) {
      expect(prim.getMaterial()).toBe(doc.getRoot().listMaterials()[0]);
    }
  });

  it("control: materials that differ in a real property (roughness) are NOT merged", async () => {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const position = doc
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]))
      .setBuffer(buffer);
    const mesh = doc.createMesh("fixture-mesh");
    const matte = doc.createMaterial("Matte").setRoughnessFactor(0.9);
    const glossy = doc.createMaterial("Glossy").setRoughnessFactor(0.1);
    mesh.addPrimitive(doc.createPrimitive().setAttribute("POSITION", position).setMaterial(matte));
    mesh.addPrimitive(doc.createPrimitive().setAttribute("POSITION", position).setMaterial(glossy));
    doc.createScene().addChild(doc.createNode("fixture-node").setMesh(mesh));

    const report = await finalizeEquipmentGlbDocument(doc);

    expect(report.materialsBefore).toBe(2);
    expect(report.materialsAfter).toBe(2);
  });
});
