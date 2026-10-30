import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { bakeGlbAlbedo, decodePng8 } from "../../../../../../../tools/openclinxr/asset-pipeline/trellis/bake-humanoid-albedo.js";
import { buildAlbedoLut } from "../../../../../../../tools/openclinxr/asset-pipeline/trellis/albedo-linear/colour-transfer.js";

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

/** Minimal 8-bit PNG encoder (filter 0), enough for the baker's decodePng8. */
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

function writeGlb(
  file: string,
  json: Record<string, unknown>,
  bin: Buffer,
): void {
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

/** One textured material + one embedded PNG. Returns input path. */
function makeInputGlb(
  dir: string,
  name: string,
  png: Buffer,
  factor: number[],
  chans: 3 | 4,
): string {
  const w = 2;
  const h = 2;
  void chans;
  void w;
  void h;
  const json: Record<string, unknown> = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: png.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.length }],
    images: [{ bufferView: 0, mimeType: "image/png" }],
    textures: [{ source: 0 }],
    materials: [{ name: "m", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: factor } }],
    meshes: [{ primitives: [{}] }],
    nodes: [{ mesh: 0 }],
  };
  const file = join(dir, name);
  writeGlb(file, json, png);
  return file;
}

function readGlbJson(file: string): Record<string, unknown> {
  const bytes = readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as Record<string, unknown>;
}

function materialFactor(file: string): number[] {
  const json = readGlbJson(file);
  const mats = json["materials"] as Array<Record<string, unknown>>;
  const pbr = mats[0]!["pbrMetallicRoughness"] as Record<string, unknown>;
  return pbr["baseColorFactor"] as number[];
}

function bakedPng(file: string): { w: number; h: number; chans: number; px: Uint8Array } {
  const bytes = readFileSync(file);
  const json = readGlbJson(file);
  const jsonLength = bytes.readUInt32LE(12);
  const binLen = bytes.readUInt32LE(20 + jsonLength);
  const bin = bytes.subarray(20 + jsonLength + 8, 20 + jsonLength + 8 + binLen);
  const mats = json["materials"] as Array<Record<string, unknown>>;
  const texRef = (mats[0]!["pbrMetallicRoughness"] as Record<string, unknown>)["baseColorTexture"] as Record<string, unknown>;
  const textures = json["textures"] as Array<Record<string, unknown>>;
  const images = json["images"] as Array<Record<string, unknown>>;
  const bvs = json["bufferViews"] as Array<Record<string, unknown>>;
  const img = images[(textures[texRef["index"] as number] as Record<string, unknown>)["source"] as number] as Record<string, unknown>;
  const bv = bvs[img["bufferView"] as number] as Record<string, unknown>;
  const off = (bv["byteOffset"] as number | undefined) ?? 0;
  const len = bv["byteLength"] as number;
  return decodePng8(new Uint8Array(bin.subarray(off, off + len)));
}

describe("tiny GLB roundtrip (linear-correct bake)", () => {
  it("tinted RGB: factor becomes white, bytes match independent linear reference", () => {
    const dir = mkdtempSync(join(tmpdir(), "albedo-rgb-"));
    const px = Uint8Array.from([64, 124, 231, 10, 20, 30, 200, 100, 50, 255, 255, 255]);
    const input = makeInputGlb(dir, "in.glb", encodePng(2, 2, 3, px), [0.2, 1, 0.7, 1], 3);
    const output = join(dir, "out.glb");
    const row = bakeGlbAlbedo(input, output);
    expect(materialFactor(output)).toEqual([1, 1, 1, 1]);
    expect(row.materials[0]!.ladderRungId).toBe("bake-resolution-ladder.res2048");
    const got = bakedPng(output);
    expect([got.w, got.h, got.chans]).toEqual([2, 2, 3]);
    const lut = buildAlbedoLut([0.2, 1, 0.7]);
    expect([lut[0]![64], lut[1]![124], lut[2]![231]]).toEqual([26, 124, 197]);
    for (let i = 0; i < 4; i += 1) {
      for (let c = 0; c < 3; c += 1) {
        const f = [0.2, 1, 0.7][c]!;
        expect(got.px[i * 3 + c]).toBe(refBake(px[i * 3 + c]!, f));
      }
    }
    // Old wrong formula is NOT what shipped.
    expect(refBake(64, 0.2)).not.toBe(Math.round(64 * 0.2));
  });

  it("white RGB factor: byte-identity, appearance preserved", () => {
    const dir = mkdtempSync(join(tmpdir(), "albedo-white-"));
    const px = Uint8Array.from([0, 13, 64, 124, 128, 231, 200, 100, 50, 255, 0, 255]);
    const input = makeInputGlb(dir, "in.glb", encodePng(2, 2, 3, px), [1, 1, 1, 1], 3);
    const output = join(dir, "out.glb");
    bakeGlbAlbedo(input, output);
    const got = bakedPng(output);
    expect(Array.from(got.px)).toEqual(Array.from(px));
  });

  it("RGBA: RGB via linear LUT, alpha linear (texA x factorA), factor reset to white", () => {
    const dir = mkdtempSync(join(tmpdir(), "albedo-rgba-"));
    const px = Uint8Array.from([64, 124, 231, 200, 10, 20, 30, 40]);
    const input = makeInputGlb(dir, "in.glb", encodePng(2, 1, 4, px), [0.2, 1, 0.7, 0.5], 4);
    const output = join(dir, "out.glb");
    bakeGlbAlbedo(input, output);
    expect(materialFactor(output)).toEqual([1, 1, 1, 1]);
    const got = bakedPng(output);
    expect([got.px[0], got.px[1], got.px[2]]).toEqual([26, 124, 197]);
    expect(got.px[3]).toBe(100); // 200 x 0.5 linear
    expect(got.px[7]).toBe(20); // 40 x 0.5 linear
  });

  it("RGB-only texture preserves non-1 factor alpha (no accidental opacity reset)", () => {
    const dir = mkdtempSync(join(tmpdir(), "albedo-rgbalpha-"));
    const px = Uint8Array.from([64, 124, 231, 10, 20, 30, 200, 100, 50, 255, 255, 255]);
    const input = makeInputGlb(dir, "in.glb", encodePng(2, 2, 3, px), [0.2, 1, 0.7, 0.5], 3);
    const output = join(dir, "out.glb");
    bakeGlbAlbedo(input, output);
    expect(materialFactor(output)).toEqual([1, 1, 1, 0.5]);
  });
});
