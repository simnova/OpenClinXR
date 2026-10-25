import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { bakeGlbAlbedo, decodePng8 } from "../bake-humanoid-albedo.js";

function refBake(b: number, f: number): number {
  const c = b / 255;
  const l = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const m = Math.min(1, Math.max(0, l * f));
  const s = m <= 0.0031308 ? 12.92 * m : 1.055 * Math.pow(m, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(s * 255)));
}

function pngChunk(type: string, body: Buffer): Buffer {
  const h = Buffer.alloc(8);
  h.writeUInt32BE(body.length, 0);
  h.write(type, 4, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), body])) >>> 0, 0);
  return Buffer.concat([h, body, crc]);
}

function encodePng(w: number, h: number, chans: 3 | 4, px: Uint8Array): Buffer {
  const stride = w * chans;
  const scan = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    scan[y * (stride + 1)] = 0;
    Buffer.from(px.subarray(y * stride, (y + 1) * stride)).copy(scan, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = chans === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scan)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function writeGlb(file: string, json: Record<string, unknown>, bin: Buffer): void {
  const encoded = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = (4 - (encoded.length % 4)) % 4;
  const jsonChunk = Buffer.concat([encoded, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binPadded = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binPadded.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonChunk.length, 0);
  jh.write("JSON", 4, "ascii");
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binPadded.length, 0);
  bh.write("BIN\0", 4, 4, "ascii");
  writeFileSync(file, Buffer.concat([header, jh, jsonChunk, bh, binPadded]));
}

function readGlb(file: string): { json: Record<string, unknown>; bin: Buffer } {
  const bytes = readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as Record<string, unknown>;
  const binLen = bytes.readUInt32LE(20 + jsonLength);
  return { json, bin: bytes.subarray(20 + jsonLength + 8, 20 + jsonLength + 8 + binLen) };
}

function f32(vals: number[]): Buffer {
  const b = Buffer.alloc(vals.length * 4);
  vals.forEach((v, i) => b.writeFloatLE(v, i * 4));
  return b;
}
function u16(vals: number[]): Buffer {
  const b = Buffer.alloc(vals.length * 2);
  vals.forEach((v, i) => b.writeUInt16LE(v, i * 2));
  return b;
}

/** Geometry-heavy fixture: orphan albedo image FIRST (bv0), then POSITION,
 *  indices, sparse triple, skin IBM, morph deltas, metallicRoughness + sheen
 *  images. Guards the repack against geometry corruption. */
function geometryGlb(dir: string): { file: string; expect: Record<string, Buffer | unknown> } {
  const albedoPx = Uint8Array.from([64, 124, 231, 10, 20, 30, 200, 100, 50, 255, 255, 255]);
  const albedo = encodePng(2, 2, 3, albedoPx);
  const mrPx = Uint8Array.from([128, 128, 128]);
  const mr = encodePng(1, 1, 3, mrPx);
  const sheenPx = Uint8Array.from([200, 10, 20]);
  const sheen = encodePng(1, 1, 3, sheenPx);
  const pos = f32([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const idx = u16([0, 1, 2]);
  const sparseBase = f32(new Array(12).fill(0));
  const sparseIdx = u16([2]);
  const sparseVal = f32([9, 9, 9]);
  const ibm = f32([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const morph = f32([0.1, 0, 0, 0.1, 0, 0, 0.1, 0, 0]);

  const parts = [albedo, pos, idx, sparseBase, sparseIdx, sparseVal, ibm, morph, mr, sheen];
  const offsets: number[] = [];
  let cursor = 0;
  for (const p of parts) {
    offsets.push(cursor);
    cursor += p.length;
  }
  const bv = (i: number) => ({ buffer: 0, byteOffset: offsets[i], byteLength: parts[i]!.length });
  const json: Record<string, unknown> = {
    asset: { version: "2.0" },
    extensionsUsed: ["KHR_materials_sheen"],
    buffers: [{ byteLength: cursor }],
    bufferViews: [bv(0), bv(1), bv(2), bv(3), bv(4), bv(5), bv(6), bv(7), bv(8), bv(9)],
    accessors: [
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 2, componentType: 5123, count: 3, type: "SCALAR" },
      {
        bufferView: 3, componentType: 5126, count: 4, type: "VEC3",
        sparse: { count: 1, indices: { bufferView: 4, componentType: 5123 }, values: { bufferView: 5 } },
      },
      { bufferView: 6, componentType: 5126, count: 1, type: "MAT4" },
      { bufferView: 7, componentType: 5126, count: 3, type: "VEC3", min: [0.1, 0, 0], max: [0.1, 0, 0] },
    ],
    images: [
      { bufferView: 0, mimeType: "image/png" },
      { bufferView: 8, mimeType: "image/png" },
      { bufferView: 9, mimeType: "image/png" },
    ],
    textures: [{ source: 0 }, { source: 1 }, { source: 2 }],
    materials: [
      {
        name: "m0",
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          baseColorFactor: [0.2, 1, 0.7, 1],
          metallicRoughnessTexture: { index: 1 },
        },
        extensions: { KHR_materials_sheen: { sheenColorTexture: { index: 2 }, sheenRoughnessFactor: 0.5 } },
      },
      {
        name: "m1",
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] },
        normalTexture: { index: 0 },
      },
    ],
    meshes: [{
      primitives: [
        { attributes: { POSITION: 0 }, indices: 1, material: 0, targets: [{ POSITION: 4 }] },
        { attributes: { POSITION: 0 }, indices: 1, material: 1 },
      ],
      weights: [0.5],
    }],
    skins: [{ inverseBindMatrices: 3, joints: [1], skeleton: 0 }],
    nodes: [{ mesh: 0, skin: 0, name: "root" }, { name: "j0", translation: [0, 0, 0] }],
  };
  const file = join(dir, "geo.glb");
  writeGlb(file, json, Buffer.concat(parts));
  return { file, expect: { pos, idx, sparseBase, sparseIdx, sparseVal, ibm, morph, mr, sheen, albedoPx: Buffer.from(albedoPx) } };
}

function accBytes(file: string, accIndex: number): Buffer {
  const { json, bin } = readGlb(file);
  const accs = json["accessors"] as Array<Record<string, unknown>>;
  const bvs = json["bufferViews"] as Array<Record<string, unknown>>;
  const bv = bvs[accs[accIndex]!["bufferView"] as number]!;
  const off = (bv["byteOffset"] as number | undefined) ?? 0;
  return Buffer.from(bin.subarray(off, off + (bv["byteLength"] as number)));
}

function imgBytes(file: string, imgIndex: number): Buffer {
  const { json, bin } = readGlb(file);
  const imgs = json["images"] as Array<Record<string, unknown>>;
  const bvs = json["bufferViews"] as Array<Record<string, unknown>>;
  const bv = bvs[(imgs[imgIndex] as Record<string, unknown>)["bufferView"] as number]!;
  const off = (bv["byteOffset"] as number | undefined) ?? 0;
  return Buffer.from(bin.subarray(off, off + (bv["byteLength"] as number)));
}

function pbrSlotBytes(file: string, matName: string, slot: string): Buffer {
  const { json, bin } = readGlb(file);
  const mats = json["materials"] as Array<Record<string, unknown>>;
  const mat = mats.find((m) => m["name"] === matName)!;
  const texRef = (mat["pbrMetallicRoughness"] as Record<string, unknown>)[slot] as Record<string, unknown>;
  const textures = json["textures"] as Array<Record<string, unknown>>;
  const images = json["images"] as Array<Record<string, unknown>>;
  const bvs = json["bufferViews"] as Array<Record<string, unknown>>;
  const img = images[(textures[texRef["index"] as number] as Record<string, unknown>)["source"] as number]!;
  const bv = bvs[img["bufferView"] as number]!;
  const off = (bv["byteOffset"] as number | undefined) ?? 0;
  return Buffer.from(bin.subarray(off, off + (bv["byteLength"] as number)));
}

describe("geometry invariance: accessors/sparse/skin/morph survive the repack", () => {
  it("POSITION/indices/sparse/IBM/morph float bytes + bindings identical after bake", () => {
    const dir = mkdtempSync(join(tmpdir(), "albedo-geo-"));
    const { file, expect: exp } = geometryGlb(dir);
    const output = join(dir, "out.glb");
    bakeGlbAlbedo(file, output);
    expect(accBytes(output, 0).compare(exp["pos"] as Buffer)).toBe(0);
    expect(accBytes(output, 1).compare(exp["idx"] as Buffer)).toBe(0);
    expect(accBytes(output, 3).compare(exp["ibm"] as Buffer)).toBe(0);
    expect(accBytes(output, 4).compare(exp["morph"] as Buffer)).toBe(0);
    // Sparse triple: base + indices + values bytes preserved, JSON bindings intact.
    const { json } = readGlb(output);
    const accs = json["accessors"] as Array<Record<string, unknown>>;
    expect(accs[2]).toEqual({
      bufferView: expect.any(Number),
      componentType: 5126, count: 4, type: "VEC3",
      sparse: {
        count: 1,
        indices: { bufferView: expect.any(Number), componentType: 5123 },
        values: { bufferView: expect.any(Number) },
      },
    });
    const bvs = json["bufferViews"] as Array<Record<string, unknown>>;
    const bin = readGlb(output).bin;
    const slice = (n: number): Buffer => {
      const bv = bvs[n]!;
      const off = (bv["byteOffset"] as number | undefined) ?? 0;
      return Buffer.from(bin.subarray(off, off + (bv["byteLength"] as number)));
    };
    const sparse = accs[2]!["sparse"] as Record<string, unknown>;
    const sIdx = sparse["indices"] as Record<string, unknown>;
    const sVal = sparse["values"] as Record<string, unknown>;
    expect(slice(accs[2]!["bufferView"] as number).compare(exp["sparseBase"] as Buffer)).toBe(0);
    expect(slice(sIdx["bufferView"] as number).compare(exp["sparseIdx"] as Buffer)).toBe(0);
    expect(slice(sVal["bufferView"] as number).compare(exp["sparseVal"] as Buffer)).toBe(0);
    // Bindings: counts, min/max, skins, morph weights.
    expect(accs[0]).toMatchObject({ count: 3, min: [0, 0, 0], max: [1, 1, 0] });
    expect(json["skins"]).toEqual([{ inverseBindMatrices: 3, joints: [1], skeleton: 0 }]);
    expect((json["meshes"] as Array<Record<string, unknown>>)[0]!["weights"]).toEqual([0.5]);
    // Baked albedo itself still linear-correct.
    const t = decodePng8(new Uint8Array(pbrSlotBytes(output, "m0", "baseColorTexture")));
    expect([t.px[0], t.px[1], t.px[2]]).toEqual([26, 124, 197]);
  });

  it("metallicRoughness texture + KHR sheen source preserved byte-identical", () => {
    const dir = mkdtempSync(join(tmpdir(), "albedo-geo2-"));
    const { file, expect: exp } = geometryGlb(dir);
    const output = join(dir, "out.glb");
    bakeGlbAlbedo(file, output);
    expect(pbrSlotBytes(output, "m0", "metallicRoughnessTexture").compare(exp["mr"] as Buffer)).toBe(0);
    const { json, bin } = readGlb(output);
    const mats = json["materials"] as Array<Record<string, unknown>>;
    const sheen = (mats[0]!["extensions"] as Record<string, unknown>)["KHR_materials_sheen"] as Record<string, unknown>;
    expect(sheen["sheenRoughnessFactor"]).toBe(0.5);
    const textures = json["textures"] as Array<Record<string, unknown>>;
    const images = json["images"] as Array<Record<string, unknown>>;
    const bvs = json["bufferViews"] as Array<Record<string, unknown>>;
    const sheenTex = textures[(sheen["sheenColorTexture"] as Record<string, unknown>)["index"] as number]!;
    const img = images[sheenTex["source"] as number]!;
    const bv = bvs[img["bufferView"] as number]!;
    const off = (bv["byteOffset"] as number | undefined) ?? 0;
    expect(Buffer.from(bin.subarray(off, off + (bv["byteLength"] as number))).compare(exp["sheen"] as Buffer)).toBe(0);
    expect(json["extensionsUsed"]).toEqual(["KHR_materials_sheen"]);
  });
});

describe("fail-closed texture references", () => {
  it("baseColorTexture without index: skip, no throw, factor retained", () => {
    const dir = mkdtempSync(join(tmpdir(), "albedo-noidx-"));
    const json: Record<string, unknown> = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: 0 }],
      bufferViews: [],
      images: [],
      textures: [],
      materials: [{ name: "m", pbrMetallicRoughness: { baseColorTexture: {}, baseColorFactor: [0.2, 1, 0.7, 1] } }],
      meshes: [{ primitives: [{}] }],
      nodes: [{ mesh: 0 }],
    };
    const input = join(dir, "in.glb");
    writeGlb(input, json, Buffer.alloc(0));
    const output = join(dir, "out.glb");
    const row = bakeGlbAlbedo(input, output);
    expect(row.materials[0]!.decision).toMatch(/^unsupported:/);
    const { json: outJson } = readGlb(output);
    const mats = outJson["materials"] as Array<Record<string, unknown>>;
    expect((mats[0]!["pbrMetallicRoughness"] as Record<string, unknown>)["baseColorFactor"]).toEqual([0.2, 1, 0.7, 1]);
  });
});
