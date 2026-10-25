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

function matTexBytes(file: string, materialName: string, slot = "baseColorTexture"): Buffer {
  const { json, bin } = readGlb(file);
  const mats = json["materials"] as Array<Record<string, unknown>>;
  const mat = mats.find((m) => m["name"] === materialName)!;
  const holder = slot === "baseColorTexture"
    ? (mat["pbrMetallicRoughness"] as Record<string, unknown>)
    : mat;
  const texRef = holder[slot] as Record<string, unknown>;
  const textures = json["textures"] as Array<Record<string, unknown>>;
  const images = json["images"] as Array<Record<string, unknown>>;
  const bvs = json["bufferViews"] as Array<Record<string, unknown>>;
  const img = images[(textures[texRef["index"] as number] as Record<string, unknown>)["source"] as number]!;
  const bv = bvs[img["bufferView"] as number]!;
  const off = (bv["byteOffset"] as number | undefined) ?? 0;
  return bin.subarray(off, off + (bv["byteLength"] as number));
}

function matFactor(file: string, materialName: string): unknown {
  const { json } = readGlb(file);
  const mats = json["materials"] as Array<Record<string, unknown>>;
  const mat = mats.find((m) => m["name"] === materialName)!;
  return (mat["pbrMetallicRoughness"] as Record<string, unknown>)["baseColorFactor"];
}

function matTexture(file: string, materialName: string): Record<string, unknown> {
  const { json } = readGlb(file);
  const mats = json["materials"] as Array<Record<string, unknown>>;
  const mat = mats.find((m) => m["name"] === materialName)!;
  const texRef = (mat["pbrMetallicRoughness"] as Record<string, unknown>)["baseColorTexture"] as Record<string, unknown>;
  return (json["textures"] as Array<Record<string, unknown>>)[texRef["index"] as number]!;
}

const PX = Uint8Array.from([64, 124, 231, 10, 20, 30, 200, 100, 50, 255, 255, 255]);
const TINT = [0.2, 1, 0.7, 1];

function sharedWhiteTintGlb(dir: string, whiteFirst: boolean): string {
  const png = encodePng(2, 2, 3, PX);
  const white = { name: "mWhite", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [1, 1, 1, 1] } };
  const tint = { name: "mTint", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: TINT } };
  const json: Record<string, unknown> = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: png.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.length }],
    images: [{ bufferView: 0, mimeType: "image/png" }],
    textures: [{ source: 0 }],
    materials: whiteFirst ? [white, tint] : [tint, white],
    meshes: [{ primitives: [{}, {}] }],
    nodes: [{ mesh: 0 }],
  };
  const file = join(dir, "in.glb");
  writeGlb(file, json, png);
  return file;
}

describe("clone-for-all-transformed: orders, sampler, normal users, fail-closed, orphans", () => {
  for (const whiteFirst of [true, false]) {
    it(`white+tinted share image (whiteFirst=${String(whiteFirst)}): white bytes pristine + factor kept, tint cloned correct`, () => {
      const dir = mkdtempSync(join(tmpdir(), "albedo-order-"));
      const output = join(dir, "out.glb");
      bakeGlbAlbedo(sharedWhiteTintGlb(dir, whiteFirst), output);
      expect(matFactor(output, "mWhite")).toEqual([1, 1, 1, 1]);
      expect(matFactor(output, "mTint")).toEqual([1, 1, 1, 1]);
      const w = decodePng8(new Uint8Array(matTexBytes(output, "mWhite")));
      expect(Array.from(w.px)).toEqual(Array.from(PX));
      const t = decodePng8(new Uint8Array(matTexBytes(output, "mTint")));
      for (let i = 0; i < 4; i += 1) {
        for (let c = 0; c < 3; c += 1) expect(t.px[i * 3 + c]).toBe(refBake(PX[i * 3 + c]!, [0.2, 1, 0.7][c]!));
      }
    });
  }

  it("cloned texture preserves sampler + extras + extensions; sampler array untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "albedo-sampler-"));
    const png = encodePng(2, 2, 3, PX);
    const json: Record<string, unknown> = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: png.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.length }],
      images: [{ bufferView: 0, mimeType: "image/png", name: "albedo", extras: { author: "t" } }],
      samplers: [{ magFilter: 9729, minFilter: 9986, wrapS: 10497, wrapT: 33071 }],
      textures: [{ source: 0, sampler: 0, extras: { tag: "k" }, extensions: { EXT_x: { v: 1 } } }],
      materials: [{ name: "m", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: TINT } }],
      meshes: [{ primitives: [{}] }],
      nodes: [{ mesh: 0 }],
    };
    const input = join(dir, "in.glb");
    writeGlb(input, json, png);
    const output = join(dir, "out.glb");
    bakeGlbAlbedo(input, output);
    const cloned = matTexture(output, "m");
    expect(cloned["sampler"]).toBe(0);
    expect(cloned["extras"]).toEqual({ tag: "k" });
    expect(cloned["extensions"]).toEqual({ EXT_x: { v: 1 } });
    const { json: outJson } = readGlb(output);
    expect(outJson["samplers"]).toEqual([{ magFilter: 9729, minFilter: 9986, wrapS: 10497, wrapT: 33071 }]);
    const imgs = outJson["images"] as Array<Record<string, unknown>>;
    // Original retained + clone appended; the CLONE carries name/extras.
    expect(imgs).toHaveLength(2);
    const cloneImg = imgs[(cloned["source"] as number)]!;
    expect(cloneImg["name"]).toBe("albedo");
    expect(cloneImg["extras"]).toEqual({ author: "t" });
  });

  it("same image used as another material's normal map stays pristine", () => {
    const dir = mkdtempSync(join(tmpdir(), "albedo-normal-"));
    const png = encodePng(2, 2, 3, PX);
    const json: Record<string, unknown> = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: png.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.length }],
      images: [{ bufferView: 0, mimeType: "image/png" }],
      textures: [{ source: 0 }],
      materials: [
        { name: "mTint", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: TINT } },
        { name: "mNorm", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] }, normalTexture: { index: 0 } },
      ],
      meshes: [{ primitives: [{}, {}] }],
      nodes: [{ mesh: 0 }],
    };
    const input = join(dir, "in.glb");
    writeGlb(input, json, png);
    const output = join(dir, "out.glb");
    bakeGlbAlbedo(input, output);
    const n = decodePng8(new Uint8Array(matTexBytes(output, "mNorm", "normalTexture")));
    expect(Array.from(n.px)).toEqual(Array.from(PX));
    const t = decodePng8(new Uint8Array(matTexBytes(output, "mTint")));
    expect([t.px[0], t.px[1], t.px[2]]).toEqual([26, 124, 197]);
  });

  it("unsupported mimeType (jpeg) with tint: fail-closed, no throw, factor + bytes kept", () => {
    const dir = mkdtempSync(join(tmpdir(), "albedo-jpeg-"));
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const json: Record<string, unknown> = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: fakeJpeg.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: fakeJpeg.length }],
      images: [{ bufferView: 0, mimeType: "image/jpeg" }],
      textures: [{ source: 0 }],
      materials: [{ name: "m", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: TINT } }],
      meshes: [{ primitives: [{}] }],
      nodes: [{ mesh: 0 }],
    };
    const input = join(dir, "in.glb");
    writeGlb(input, json, fakeJpeg);
    const output = join(dir, "out.glb");
    const row = bakeGlbAlbedo(input, output);
    expect(matFactor(output, "m")).toEqual(TINT);
    expect(row.materials[0]!.decision).toMatch(/^unsupported:/);
  });

  it("retained-original: single tinted material keeps pristine original (2/2/2), no deletion without a schema-aware pruner", () => {
    const dir = mkdtempSync(join(tmpdir(), "albedo-orphan-"));
    const png = encodePng(2, 2, 3, PX);
    const json: Record<string, unknown> = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: png.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.length }],
      images: [{ bufferView: 0, mimeType: "image/png" }],
      textures: [{ source: 0 }],
      materials: [{ name: "m", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: TINT } }],
      meshes: [{ primitives: [{}] }],
      nodes: [{ mesh: 0 }],
    };
    const input = join(dir, "in.glb");
    writeGlb(input, json, png);
    const output = join(dir, "out.glb");
    bakeGlbAlbedo(input, output);
    const { json: outJson, bin } = readGlb(output);
    // Original retained: 2 images / 2 views / 2 textures (pristine + clone).
    expect((outJson["images"] as unknown[])).toHaveLength(2);
    expect((outJson["bufferViews"] as unknown[])).toHaveLength(2);
    expect((outJson["textures"] as unknown[])).toHaveLength(2);
    const textures = outJson["textures"] as Array<Record<string, unknown>>;
    const images = outJson["images"] as Array<Record<string, unknown>>;
    const bvs = outJson["bufferViews"] as Array<Record<string, unknown>>;
    const mats = outJson["materials"] as Array<Record<string, unknown>>;
    const usedTex = textures[((mats[0]!["pbrMetallicRoughness"] as Record<string, unknown>)["baseColorTexture"] as Record<string, unknown>)["index"] as number]!;
    const usedImg = (usedTex["source"] as number);
    const otherImg = usedImg === 0 ? 1 : 0;
    const bv = bvs[(images[otherImg] as Record<string, unknown>)["bufferView"] as number]!;
    const off = (bv["byteOffset"] as number | undefined) ?? 0;
    const pristine = decodePng8(new Uint8Array(bin.subarray(off, off + (bv["byteLength"] as number))));
    expect(Array.from(pristine.px)).toEqual(Array.from(PX));
  });
});
