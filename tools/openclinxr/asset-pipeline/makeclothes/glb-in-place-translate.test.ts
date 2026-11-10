import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { translateMeshZInPlace } from "./glb-in-place-translate.js";

/** Minimal GLB: one or two meshes over float32 VEC3 POSITION accessors, plus an unknown extension. */
function glb(json: Record<string, unknown>, bin: Buffer): string {
  let text = Buffer.from(JSON.stringify(json), "utf8");
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(text.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  const out = Buffer.concat([header, jh, text, bh, bin]);
  out.writeUInt32LE(out.length, 8);
  const path = join(mkdtempSync(join(tmpdir(), "inplace-")), "a.glb");
  writeFileSync(path, out);
  return path;
}

function floats(values: number[]): Buffer {
  return Buffer.from(new Float32Array(values).buffer);
}

const BASE = {
  asset: { version: "2.0" },
  extensionsUsed: ["OPENCLINXR_skin_shade"],
  materials: [{ name: "skin", extensions: { OPENCLINXR_skin_shade: { tile: 7 } } }],
  buffers: [{ byteLength: 48 }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 24 },
    { buffer: 0, byteOffset: 24, byteLength: 24 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 2, type: "VEC3", min: [0, 0, 1], max: [1, 1, 2] },
    { bufferView: 1, componentType: 5126, count: 2, type: "VEC3", min: [0, 0, 0], max: [1, 1, 1] },
  ],
  meshes: [
    { name: "openclinxr_fitted_teeth_x", primitives: [{ attributes: { POSITION: 0 } }] },
    { name: "body", primitives: [{ attributes: { POSITION: 1 }, material: 0 }] },
  ],
};

describe("glb-in-place-translate", () => {
  it("moves only the matched POSITION z and keeps every other byte and the unknown extension", () => {
    const bin = Buffer.concat([floats([0, 0, 1, 1, 1, 2]), floats([0, 0, 0, 1, 1, 1])]);
    const path = glb(structuredClone(BASE), bin);
    const rows = translateMeshZInPlace(path, /teeth/i, -0.5);
    expect(rows).toEqual([{ mesh: "openclinxr_fitted_teeth_x", accessor: 0, verts: 2, beforeMaxZ: 2, afterMaxZ: 1.5 }]);
    const raw = readFileSync(path);
    const n = raw.readUInt32LE(12);
    const json = JSON.parse(raw.subarray(20, 20 + n).toString("utf8")) as typeof BASE;
    expect(json.materials).toEqual(BASE.materials);
    expect(json.extensionsUsed).toEqual(["OPENCLINXR_skin_shade"]);
    expect(json.accessors[0]!.min).toEqual([0, 0, 0.5]);
    expect(json.accessors[0]!.max).toEqual([1, 1, 1.5]);
    const out = new Float32Array(raw.buffer.slice(raw.byteOffset + 28 + n, raw.byteOffset + 28 + n + 48));
    expect(Array.from(out)).toEqual([0, 0, 0.5, 1, 1, 1.5, 0, 0, 0, 1, 1, 1]);
  });

  it("refuses a shared bufferView", () => {
    const doc = structuredClone(BASE);
    doc.accessors.push({ bufferView: 0, componentType: 5126, count: 2, type: "VEC3", min: [0, 0, 0], max: [1, 1, 1] });
    const path = glb(doc, Buffer.alloc(48));
    expect(() => translateMeshZInPlace(path, /teeth/i, 0.1)).toThrow(/shares bufferView/);
  });

  it("refuses an interleaved view", () => {
    const doc = structuredClone(BASE) as typeof BASE & { bufferViews: Array<Record<string, number>> };
    doc.bufferViews[0]!["byteStride"] = 16;
    const path = glb(doc, Buffer.alloc(48));
    expect(() => translateMeshZInPlace(path, /teeth/i, 0.1)).toThrow(/interleaved/);
  });

  it("refuses a sparse POSITION", () => {
    const doc = structuredClone(BASE) as typeof BASE & { accessors: Array<Record<string, unknown>> };
    doc.accessors[0]!["sparse"] = { count: 1, indices: { bufferView: 1, componentType: 5125 }, values: { bufferView: 1 } };
    const path = glb(doc, Buffer.alloc(48));
    expect(() => translateMeshZInPlace(path, /teeth/i, 0.1)).toThrow(/sparse/);
  });

  it("refuses a POSITION accessor a morph target also references", () => {
    const doc = structuredClone(BASE) as typeof BASE & { meshes: Array<{ primitives: Array<Record<string, unknown>> }> };
    doc.meshes[1]!.primitives[0]!["targets"] = [{ POSITION: 0 }];
    const path = glb(doc, Buffer.alloc(48));
    expect(() => translateMeshZInPlace(path, /teeth/i, 0.1)).toThrow(/referenced 2 times/);
  });

  it("refuses zero or several matching meshes", () => {
    const path = glb(structuredClone(BASE), Buffer.alloc(48));
    expect(() => translateMeshZInPlace(path, /tongue/i, 0.1)).toThrow(/0 meshes match/);
    expect(() => translateMeshZInPlace(path, /./, 0.1)).toThrow(/2 meshes match/);
  });
});
