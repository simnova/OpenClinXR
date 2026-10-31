import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { bakeGlbAlbedo, decodePng8 } from "../../../../../../../tools/openclinxr/asset-pipeline/trellis/bake-humanoid-albedo.js";

// Independent spec reference (not the implementation under test).
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
  const bin = bytes.subarray(20 + jsonLength + 8, 20 + jsonLength + 8 + binLen);
  return { json, bin };
}

/** Two materials sharing ONE texture/image/bufferView (aliasing fixture). */
function makeSharedGlb(dir: string, png: Buffer, f1: number[], f2: number[]): string {
  const json: Record<string, unknown> = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: png.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.length }],
    images: [{ bufferView: 0, mimeType: "image/png" }],
    textures: [{ source: 0 }],
    materials: [
      { name: "m1", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: f1 } },
      { name: "m2", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: f2 } },
    ],
    meshes: [{ primitives: [{}, {}] }],
    nodes: [{ mesh: 0 }],
  };
  const file = join(dir, "shared.glb");
  writeGlb(file, json, png);
  return file;
}

function texBytesForMaterial(file: string, materialName: string): Buffer {
  const { json, bin } = readGlb(file);
  const mats = json["materials"] as Array<Record<string, unknown>>;
  const mat = mats.find((m) => m["name"] === materialName)!;
  const pbr = mat["pbrMetallicRoughness"] as Record<string, unknown>;
  const texRef = pbr["baseColorTexture"] as Record<string, unknown>;
  const textures = json["textures"] as Array<Record<string, unknown>>;
  const images = json["images"] as Array<Record<string, unknown>>;
  const bvs = json["bufferViews"] as Array<Record<string, unknown>>;
  const img = images[(textures[texRef["index"] as number] as Record<string, unknown>)["source"] as number]!;
  const bv = bvs[img["bufferView"] as number]!;
  const off = (bv["byteOffset"] as number | undefined) ?? 0;
  return bin.subarray(off, off + (bv["byteLength"] as number));
}

function factorForMaterial(file: string, materialName: string): unknown {
  const { json } = readGlb(file);
  const mats = json["materials"] as Array<Record<string, unknown>>;
  const mat = mats.find((m) => m["name"] === materialName)!;
  return (mat["pbrMetallicRoughness"] as Record<string, unknown>)["baseColorFactor"];
}

describe("edge cases: skip-alpha, exactly-once, shared textures", () => {
  it("white RGB + non-1 alpha on RGB texture: skipped, original factor kept, bytes identical", () => {
    const dir = mkdtempSync(join(tmpdir(), "albedo-skipa-"));
    const px = Uint8Array.from([64, 124, 231, 10, 20, 30, 200, 100, 50, 255, 255, 255]);
    const png = encodePng(2, 2, 3, px);
    const json: Record<string, unknown> = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: png.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.length }],
      images: [{ bufferView: 0, mimeType: "image/png" }],
      textures: [{ source: 0 }],
      materials: [{ name: "m", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [1, 1, 1, 0.5] } }],
      meshes: [{ primitives: [{}] }],
      nodes: [{ mesh: 0 }],
    };
    const input = join(dir, "in.glb");
    writeGlb(input, json, png);
    const output = join(dir, "out.glb");
    bakeGlbAlbedo(input, output);
    expect(factorForMaterial(output, "m")).toEqual([1, 1, 1, 0.5]);
    const got = decodePng8(new Uint8Array(texBytesForMaterial(output, "m")));
    expect(Array.from(got.px)).toEqual(Array.from(px));
  });

  it("white RGB + non-1 alpha on RGBA texture: skipped, alpha NOT folded, factor kept", () => {
    const dir = mkdtempSync(join(tmpdir(), "albedo-skipa4-"));
    const px = Uint8Array.from([64, 124, 231, 200, 10, 20, 30, 40]);
    const png = encodePng(2, 1, 4, px);
    const json: Record<string, unknown> = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: png.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.length }],
      images: [{ bufferView: 0, mimeType: "image/png" }],
      textures: [{ source: 0 }],
      materials: [{ name: "m", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [1, 1, 1, 0.5] } }],
      meshes: [{ primitives: [{}] }],
      nodes: [{ mesh: 0 }],
    };
    const input = join(dir, "in.glb");
    writeGlb(input, json, png);
    const output = join(dir, "out.glb");
    bakeGlbAlbedo(input, output);
    expect(factorForMaterial(output, "m")).toEqual([1, 1, 1, 0.5]);
    const got = decodePng8(new Uint8Array(texBytesForMaterial(output, "m")));
    expect(Array.from(got.px)).toEqual(Array.from(px));
  });

  it("RGBA fold happens exactly once: re-baking the output is a byte-identical no-op", () => {
    const dir = mkdtempSync(join(tmpdir(), "albedo-once-"));
    const px = Uint8Array.from([64, 124, 231, 200, 10, 20, 30, 40]);
    const png = encodePng(2, 1, 4, px);
    const json: Record<string, unknown> = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: png.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.length }],
      images: [{ bufferView: 0, mimeType: "image/png" }],
      textures: [{ source: 0 }],
      materials: [{ name: "m", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [0.2, 1, 0.7, 0.5] } }],
      meshes: [{ primitives: [{}] }],
      nodes: [{ mesh: 0 }],
    };
    const input = join(dir, "in.glb");
    writeGlb(input, json, png);
    const once = join(dir, "once.glb");
    const twice = join(dir, "twice.glb");
    bakeGlbAlbedo(input, once);
    bakeGlbAlbedo(once, twice);
    expect(Buffer.compare(texBytesForMaterial(once, "m"), texBytesForMaterial(twice, "m"))).toBe(0);
    const got = decodePng8(new Uint8Array(texBytesForMaterial(twice, "m")));
    expect([got.px[0], got.px[1], got.px[2], got.px[3]]).toEqual([26, 124, 197, 100]);
  });

  it("shared texture + SAME factor: single bake reused, both factors white", () => {
    const dir = mkdtempSync(join(tmpdir(), "albedo-shared-same-"));
    const px = Uint8Array.from([64, 124, 231, 10, 20, 30, 200, 100, 50, 255, 255, 255]);
    const input = makeSharedGlb(dir, encodePng(2, 2, 3, px), [0.5, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 1]);
    const output = join(dir, "out.glb");
    bakeGlbAlbedo(input, output);
    expect(factorForMaterial(output, "m1")).toEqual([1, 1, 1, 1]);
    expect(factorForMaterial(output, "m2")).toEqual([1, 1, 1, 1]);
    for (const m of ["m1", "m2"]) {
      const got = decodePng8(new Uint8Array(texBytesForMaterial(output, m)));
      for (let i = 0; i < 12; i += 1) expect(got.px[i]).toBe(refBake(px[i]!, 0.5));
    }
  });

  it("shared texture + DIFFERENT factors: each material correct, no double-fold", () => {
    const dir = mkdtempSync(join(tmpdir(), "albedo-shared-diff-"));
    const px = Uint8Array.from([64, 124, 231, 10, 20, 30, 200, 100, 50, 255, 255, 255]);
    const input = makeSharedGlb(dir, encodePng(2, 2, 3, px), [0.5, 0.5, 0.5, 1], [0.2, 1, 0.7, 1]);
    const output = join(dir, "out.glb");
    bakeGlbAlbedo(input, output);
    expect(factorForMaterial(output, "m1")).toEqual([1, 1, 1, 1]);
    expect(factorForMaterial(output, "m2")).toEqual([1, 1, 1, 1]);
    const g1 = decodePng8(new Uint8Array(texBytesForMaterial(output, "m1")));
    const g2 = decodePng8(new Uint8Array(texBytesForMaterial(output, "m2")));
    for (let i = 0; i < 4; i += 1) {
      for (let c = 0; c < 3; c += 1) {
        expect(g1.px[i * 3 + c]).toBe(refBake(px[i * 3 + c]!, 0.5));
        expect(g2.px[i * 3 + c]).toBe(refBake(px[i * 3 + c]!, [0.2, 1, 0.7][c]!));
      }
    }
    // m1 must NOT carry the double-folded bytes (old in-place bug symptom).
    expect([g1.px[0], g1.px[1], g1.px[2]]).not.toEqual([26, 124, 197]);
  });
});
