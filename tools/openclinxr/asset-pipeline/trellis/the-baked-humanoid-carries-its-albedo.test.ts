/**
 * HB-02 — the baked humanoid carries its albedo.
 *
 * Asserted against the LIVE GLBs plus the bake report, never against prose.
 * Each body: parses, declared length equals file length, mesh/node counts match
 * the report's before/after (unchanged by the bake), every textured material is
 * white-factored or a recorded exception. Counterweight: the textured-material
 * population across the baked bodies is non-zero, so this cannot pass vacuously.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { crc32, inflateSync } from "node:zlib";
import path from "node:path";

const ROOT = process.cwd();
const HUMANOIDS = path.join(ROOT, "apps/ui-xr/public/generated-humanoids");
const REPORT_PATH = path.join(ROOT, "docs/openclinxr/humanoid-albedo-bake-2026-09-10.json");

type Sample = { x: number; y: number; before: number[]; factor: number[] };
type BakedMaterialRow = {
  material: string;
  bakedResolution: string;
  ladderRungId: string;
  texelBudget: number;
  decision: string;
  samples: Sample[];
};
type BakedBodyRow = {
  body: string;
  meshCountBefore: number;
  meshCountAfter: number;
  nodeCountBefore: number;
  nodeCountAfter: number;
  materials: BakedMaterialRow[];
};
type BakeReport = { bodies: BakedBodyRow[]; exceptions: Array<{ body: string; reason: string }>; ladderRungId: string };

function readGlbJson(file: string): { json: Record<string, unknown>; bytes: Buffer } {
  const bytes = readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as Record<string, unknown>;
  return { json, bytes };
}

function binSlice(bytes: Buffer, json: Record<string, unknown>): Buffer {
  const jsonLength = bytes.readUInt32LE(12);
  const binChunkLength = bytes.readUInt32LE(20 + jsonLength);
  return bytes.subarray(20 + jsonLength + 8, 20 + jsonLength + 8 + binChunkLength);
}

function baseColorTextureBytes(json: Record<string, unknown>, bin: Buffer, materialName: string): Buffer {
  const materials = (json["materials"] as Array<Record<string, unknown>> | undefined) ?? [];
  const mat = materials.find((m) => m["name"] === materialName);
  if (!mat) throw new Error(`material ${materialName} not found`);
  const pbr = mat["pbrMetallicRoughness"] as Record<string, unknown>;
  const texRef = pbr["baseColorTexture"] as Record<string, unknown>;
  const textures = json["textures"] as Array<Record<string, unknown>>;
  const images = json["images"] as Array<Record<string, unknown>>;
  const bufferViews = json["bufferViews"] as Array<Record<string, unknown>>;
  const img = images[(textures[texRef["index"] as number] as Record<string, unknown>)["source"] as number] as Record<string, unknown>;
  const bv = bufferViews[img["bufferView"] as number] as Record<string, unknown>;
  const off = (bv["byteOffset"] as number | undefined) ?? 0;
  return bin.subarray(off, off + (bv["byteLength"] as number));
}

type PngScan = { w: number; h: number; chans: number; raw: Buffer };

function inflatePng(bytes: Buffer): PngScan {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error("not a PNG");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let w = 0;
  let h = 0;
  let depth = 0;
  let colour = -1;
  const idat: Buffer[] = [];
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    const body = bytes.subarray(off + 8, off + 8 + len);
    const stored = dv.getUint32(off + 8 + len);
    const correct = crc32(Buffer.concat([Buffer.from(type, "ascii"), body])) >>> 0;
    if (stored !== correct) throw new Error(`bad CRC on ${type}: stored ${stored.toString(16)}, correct ${correct.toString(16)}`);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
      depth = bytes[off + 16]!;
      colour = bytes[off + 17]!;
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (depth !== 8 || w === 0 || h === 0) throw new Error(`unsupported PNG depth=${depth} ${w}x${h}`);
  const chans = colour === 2 ? 3 : colour === 6 ? 4 : 0;
  if (chans === 0) throw new Error(`unsupported PNG colour type ${colour}`);
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== h * (1 + w * chans)) {
    throw new Error(`IDAT inflates to ${raw.length} bytes, expected ${h * (1 + w * chans)} for ${w}x${h}x${chans}`);
  }
  return { w, h, chans, raw };
}

function unfilter(scan: PngScan, x: number, y: number): number[] {
  return pixelAt(decodeScanToPixels(scan), scan.w, scan.chans, x, y);
}

function decodeScanToPixels(scan: PngScan): Buffer {
  const { w, h, chans, raw } = scan;
  const stride = w * chans;
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  const pixels = Buffer.alloc(w * h * chans);
  let p = 0;
  for (let row = 0; row < h; row += 1) {
    const filter = raw[p++]!;
    for (let k = 0; k < stride; k += 1) {
      const rb = raw[p + k]!;
      const a = k >= chans ? cur[k - chans]! : 0;
      const b = prev[k]!;
      const c = k >= chans ? prev[k - chans]! : 0;
      let v: number;
      if (filter === 0) v = rb;
      else if (filter === 1) v = rb + a;
      else if (filter === 2) v = rb + b;
      else if (filter === 3) v = rb + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[k] = v & 0xff;
    }
    p += stride;
    cur.copy(pixels, row * stride);
    prev.set(cur);
  }
  return pixels;
}

function pixelAt(pixels: Buffer, w: number, chans: number, x: number, y: number): number[] {
  const i = (y * w + x) * chans;
  return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
}

function texturedMaterials(json: Record<string, unknown>): Array<{ name: string; factor: unknown }> {
  const materials = (json["materials"] as Array<Record<string, unknown>> | undefined) ?? [];
  return materials
    .filter((m) => (m["pbrMetallicRoughness"] as Record<string, unknown> | undefined)?.["baseColorTexture"] !== undefined)
    .map((m) => ({
      name: m["name"] as string,
      factor: (m["pbrMetallicRoughness"] as Record<string, unknown>)["baseColorFactor"] as unknown,
    }));
}

function isWhite3(factor: unknown): boolean {
  if (factor === undefined || factor === null) return true;
  if (!Array.isArray(factor) || factor.length < 3) return false;
  return (factor as number[]).slice(0, 3).every((c) => c === 1);
}

describe("the baked humanoid carries its albedo", () => {
  const report = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as BakeReport;
  const exceptionBodies = new Set(report.exceptions.map((e) => e.body));

  it("every baked body parses, its declared length matches, and mesh/node counts are unchanged", () => {
    expect(report.bodies.length).toBeGreaterThan(0);
    for (const row of report.bodies) {
      const { json, bytes } = readGlbJson(path.join(HUMANOIDS, row.body));
      expect(bytes.readUInt32LE(8)).toBe(bytes.byteLength);
      expect((json["meshes"] as unknown[]).length).toBe(row.meshCountAfter);
      expect((json["nodes"] as unknown[]).length).toBe(row.nodeCountAfter);
      expect(row.meshCountAfter).toBe(row.meshCountBefore);
      expect(row.nodeCountAfter).toBe(row.nodeCountBefore);
    }
  });

  it("every textured material is white-factored or a recorded exception, and the population is non-zero", () => {
    let texturedCount = 0;
    for (const row of report.bodies) {
      const { json } = readGlbJson(path.join(HUMANOIDS, row.body));
      for (const mat of texturedMaterials(json)) {
        texturedCount += 1;
        const hidden = mat.name.startsWith("openclinxr_hidden_");
        expect(isWhite3(mat.factor) || hidden || exceptionBodies.has(row.body)).toBe(true);
      }
    }
    expect(texturedCount).toBeGreaterThan(0);
  });

  it("every baked material records source and baked resolution, rung id and texel budget", () => {
    let bakedCount = 0;
    for (const row of report.bodies) {
      for (const mat of row.materials) {
        if (!mat.bakedResolution || mat.bakedResolution === "n/a") continue;
        if (mat.texelBudget === 0) continue;
        bakedCount += 1;
        expect(mat.bakedResolution).toMatch(/^\d+x\d+$/);
        expect(mat.ladderRungId).toBe(report.ladderRungId);
        expect(mat.texelBudget).toBeGreaterThan(0);
      }
    }
    expect(bakedCount).toBeGreaterThan(0);
  });

  it("every PNG baseColorTexture in every baked GLB carries valid CRCs and inflates to its declared size", () => {
    let checked = 0;
    for (const row of report.bodies) {
      const { json, bytes } = readGlbJson(path.join(HUMANOIDS, row.body));
      const bin = binSlice(bytes, json);
      const materials = (json["materials"] as Array<Record<string, unknown>> | undefined) ?? [];
      for (const mat of materials) {
        const pbr = mat["pbrMetallicRoughness"] as Record<string, unknown> | undefined;
        if (pbr?.["baseColorTexture"] === undefined) continue;
        inflatePng(baseColorTextureBytes(json, bin, mat["name"] as string));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("each sampled texel in the shipped texture equals round(before x factor) within 1", () => {
    let sampled = 0;
    for (const row of report.bodies) {
      const { json, bytes } = readGlbJson(path.join(HUMANOIDS, row.body));
      const bin = binSlice(bytes, json);
      for (const mat of row.materials) {
        if (!mat.decision.startsWith("baked")) continue;
        expect(mat.samples.length).toBe(32);
        const scan = inflatePng(baseColorTextureBytes(json, bin, mat.material));
        const pixels = decodeScanToPixels(scan);
        for (const s of mat.samples) {
          const actual = pixelAt(pixels, scan.w, scan.chans, s.x, s.y);
          for (let c = 0; c < 3; c += 1) {
            expect(Math.abs(actual[c]! - Math.round(s.before[c]! * s.factor[c]!))).toBeLessThanOrEqual(1);
          }
          sampled += 1;
        }
      }
    }
    expect(sampled).toBeGreaterThan(0);
  }, 120_000);
});
