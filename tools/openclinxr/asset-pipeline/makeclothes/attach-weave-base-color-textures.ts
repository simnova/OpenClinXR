/**
 * attach-weave-base-color-textures.ts — st-palette D1 post-export texture stage.
 *
 * Every garment material the pipeline ships flat gets a procedural base-colour
 * texture whose mean matches the resolved palette, without touching geometry,
 * skinning, morphs or animations (glTF-Transform read/attach/write, the same
 * round-trip tools/openclinxr/asset-pipeline/makeclothes/trim-hide-mask-to-garment.ts
 * performs on these GLBs).
 *
 * The weave is generated, not painted: a deterministic seeded plain-weave
 * modulation (warp/weft sinusoids + hash dither, symmetric about 1.0) over the
 * resolved palette base, then an exact-mean correction so the decoded PNG mean
 * equals the palette to the rounding byte. 512px (bake-resolution-ladder rung
 * res512 — the ladder swept 512/1024/2048; a weave field needs no more).
 * Seed = FNV-1a(material name): same input bytes on every run, no stored asset.
 *
 * Why not the declared .mhmat textures: the scrub-shirt atlas PNG in the
 * provider cache is truncated (no IEND — recorded in the nurse provenance
 * HB-07 note) and the scrub-pants dir is absent from this worktree's cache,
 * so the bake-time consumer (garment_material_from_declared) cannot resolve
 * them here; the gown shell is authored in-Blender with no declared texture
 * at all and ships without UVs. The gown therefore also gets a deterministic
 * cylindrical UV projection (tube shell: u = angle, v = height) via
 * --cyl-uv; meshes that already carry TEXCOORD_0 are refused.
 *
 * Factors are FOLDED into the texture by this stage (fleet convention
 * since HB-02 22ec335a5): the weave PNG carries the resolved LINEAR palette
 * sRGB-encoded as its texels, and the material factor is reset to [1,1,1,a]
 * (alpha kept), so the rendered effective colour (factor x per-channel
 * srgb_to_linear(texel) mean) equals the palette instead of its square.
 * Round 1 kept the factor and stored the palette in the texture, so every
 * textured garment rendered at colour^2 (nurse chest (120,177,181) ->
 * (36,103,115)); the fold is the fix. Round 3 wrote the linear palette as
 * raw bytes, so the sRGB-decoding renderer rendered it dark (nurse after ~60
 * RGB darker); the fold now encodes linear_to_srgb(palette x weave).
 * Materials that already carry a baseColorTexture are refused (no double
 * attach), so a re-run is a loud no-op rather than a stacked bake.
 *
 * Run:
 *   pnpm exec tsx tools/openclinxr/asset-pipeline/makeclothes/attach-weave-base-color-textures.ts \
 *     --glb apps/ui-xr/public/generated-humanoids/<asset>.glb \
 *     --report <report.json> \
 *     --target mat_name:r,g,b [--target ...] [--replace] [--renormalize] \
 *     [--cyl-uv meshSubstring:uRepeat,vRepeat]
 *
 * Round 4 modes for garments the fleet fold already textured (HB-02 wrote the
 * linear palette as raw bytes, so the sRGB-decoding renderer reads them dark):
 * --replace drops the existing texture on each --target material (flat HB-02
 * fills with no authored content: kevin/physician scrub shirts) and attaches
 * a fresh corrected weave. --renormalize keeps authored photo texels (parent/
 * family/maya prints) and re-levels them in linear space to the palette,
 * re-encoded as sRGB. Both end folded (factor white) under the same 0.01 gate.
 */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { type Document, NodeIO } from "@gltf-transform/core";
import { textureChannelMeans } from "../../evidence/lib/effective-garment-colour.js";

type RGB = [number, number, number];

type Target = { material: string; rgb: RGB };

type CylUv = { meshSubstring: string; uRepeat: number; vRepeat: number };

const WEAVE_PX = 512;
const WEAVE_PERIOD_PX = 4;
const WEAVE_AMPLITUDE = 0.045;
const DITHER_AMPLITUDE = 0.008;

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function linearToSrgbChannel(l: number): number {
  const c = Math.min(1, Math.max(0, l));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function srgbToLinearChannel(s: number): number {
  const c = Math.min(1, Math.max(0, s));
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function weavePng(name: string, rgb: RGB): { bytes: Uint8Array; mean: RGB } {
  const rand = mulberry32(fnv1a(`st-palette-weave-v1:${name}`));
  const [phaseX, phaseY] = [rand() * Math.PI * 2, rand() * Math.PI * 2];
  const px = new Uint8Array(WEAVE_PX * WEAVE_PX * 3);
  // Round 4: rgb is the resolved LINEAR palette. PNG texels are sRGB-encoded
  // per the glTF spec, so each modulated linear value is encoded to sRGB
  // before byte rounding. The renderer decodes back to linear, so the decoded
  // mean lands on the palette instead of rendering dark.
  for (let y = 0; y < WEAVE_PX; y += 1) {
    for (let x = 0; x < WEAVE_PX; x += 1) {
      const weave =
        1 +
        WEAVE_AMPLITUDE *
          Math.sin((2 * Math.PI * x) / WEAVE_PERIOD_PX + phaseX) *
          Math.sin((2 * Math.PI * y) / WEAVE_PERIOD_PX + phaseY) +
        (rand() * 2 - 1) * DITHER_AMPLITUDE;
      const i = (y * WEAVE_PX + x) * 3;
      px[i] = Math.max(0, Math.min(255, Math.round(linearToSrgbChannel(rgb[0]! * weave) * 255)));
      px[i + 1] = Math.max(0, Math.min(255, Math.round(linearToSrgbChannel(rgb[1]! * weave) * 255)));
      px[i + 2] = Math.max(0, Math.min(255, Math.round(linearToSrgbChannel(rgb[2]! * weave) * 255)));
    }
  }
  // Exact-mean correction in DECODED linear space: the renderer reads
  // srgb_to_linear(texel), so the mean that must equal the palette is the
  // decoded mean. A uniform integer byte offset per channel (searched
  // -12..+12 for the smallest decoded-mean miss) absorbs byte-rounding bias;
  // the residual is bounded by half a code value in sRGB, well under the 0.01
  // palette bound in linear.
  const n = WEAVE_PX * WEAVE_PX;
  const decodedMean = (channel: 0 | 1 | 2, extra = 0): number => {
    let s = 0;
    for (let i = 0; i < n; i += 1) {
      const b = Math.max(0, Math.min(255, (px[i * 3 + channel] ?? 0) + extra));
      s += srgbToLinearChannel(b / 255);
    }
    return s / n;
  };
  for (const channel of [0, 1, 2] as const) {
    const target = rgb[channel] ?? 0;
    let best = 0;
    let bestMiss = Math.abs(decodedMean(channel) - target);
    for (let o = -12; o <= 12; o += 1) {
      const miss = Math.abs(decodedMean(channel, o) - target);
      if (miss < bestMiss) {
        bestMiss = miss;
        best = o;
      }
    }
    if (best !== 0) {
      for (let i = 0; i < n; i += 1) {
        px[i * 3 + channel] = Math.max(0, Math.min(255, Math.round((px[i * 3 + channel] ?? 0) + best)));
      }
    }
  }
  const mean: RGB = [decodedMean(0), decodedMean(1), decodedMean(2)];
  return { bytes: encodePngRgb8(px, WEAVE_PX, WEAVE_PX), mean };
}

function pngChunk(type: string, body: Uint8Array): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length, 0);
  header.write(type, 4, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(body)])) >>> 0, 0);
  return Buffer.concat([header, Buffer.from(body), crc]);
}

function encodePngRgb8(px: Uint8Array, w: number, h: number): Uint8Array {
  const stride = w * 3;
  if (px.byteLength !== stride * h) throw new Error("refusing: rgb pixel buffer size mismatch");
  const scan = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    scan[y * (stride + 1)] = 0;
    Buffer.from(px.subarray(y * stride, (y + 1) * stride)).copy(scan, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(
    Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(scan)), pngChunk("IEND", new Uint8Array(0))]),
  );
}

function encodePngRgba8(px: Uint8Array, w: number, h: number): Uint8Array {
  const stride = w * 4;
  if (px.byteLength !== stride * h) throw new Error("refusing: rgba pixel buffer size mismatch");
  const scan = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    scan[y * (stride + 1)] = 0;
    Buffer.from(px.subarray(y * stride, (y + 1) * stride)).copy(scan, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(
    Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(scan)), pngChunk("IEND", new Uint8Array(0))]),
  );
}

/** Unfilter an 8-bit PNG into raw texels. Producer-side pixel access for the
 * --renormalize path (re-level kept texels); the contract read of the result
 * stays the shared effective-garment-colour reader. Refuses non-RGB(A). */
function decodePngTexels(bytes: Uint8Array): { w: number; h: number; chans: number; px: Uint8Array } {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
    throw new Error("refusing: not a PNG (renormalize needs the authored bytes)");
  }
  let w = 0;
  let h = 0;
  let depth = 0;
  let colour = -1;
  const idat: Uint8Array[] = [];
  let off = 8;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4] ?? 0, bytes[off + 5] ?? 0, bytes[off + 6] ?? 0, bytes[off + 7] ?? 0);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
      depth = bytes[off + 16] ?? 0;
      colour = bytes[off + 17] ?? -1;
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(off + 8, off + 8 + len));
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  const chans = colour === 0 ? 1 : colour === 2 ? 3 : colour === 4 ? 2 : colour === 6 ? 4 : 0;
  if (depth !== 8 || (chans !== 3 && chans !== 4) || !w || !h) {
    throw new Error(`refusing: renormalize needs 8-bit RGB(A), got depth=${depth} chans=${chans}`);
  }
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  } catch (err) {
    throw new Error(`refusing: PNG IDAT does not inflate: ${(err as Error).message}`);
  }
  const stride = w * chans;
  if (raw.length < (stride + 1) * h) throw new Error("refusing: PNG scanlines short");
  const px = new Uint8Array(w * h * chans);
  let prev = new Uint8Array(stride);
  let p = 0;
  const cur = new Uint8Array(stride);
  for (let y = 0; y < h; y += 1) {
    const f = raw[p++] ?? 0;
    for (let x = 0; x < stride; x += 1) {
      const rb = raw[p + x] ?? 0;
      const a = x >= chans ? (cur[x - chans] ?? 0) : 0;
      const b = prev[x] ?? 0;
      const c = x >= chans ? (prev[x - chans] ?? 0) : 0;
      let v: number;
      if (f === 0) v = rb;
      else if (f === 1) v = rb + a;
      else if (f === 2) v = rb + b;
      else if (f === 3) v = rb + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    p += stride;
    for (let x = 0; x < w * chans; x += 1) px[y * w * chans + x] = cur[x] ?? 0;
    prev = Uint8Array.from(cur);
  }
  return { w, h, chans, px };
}

/** Re-level kept photo texels to the palette in linear space, re-encoded as
 * sRGB: newLinear = decode(old) / decodedMean * palette, per channel over
 * opaque texels. Returns the encoded PNG bytes. */
function renormalizePng(name: string, bytes: Uint8Array, rgb: RGB): { bytes: Uint8Array; mean: RGB; scale: RGB } {
  const { w, h, chans, px } = decodePngTexels(bytes);
  const n = w * h;
  const opaque: number[] = [];
  let sR = 0;
  let sG = 0;
  let sB = 0;
  for (let i = 0; i < n; i += 1) {
    if (chans === 4 && (px[i * chans + 3] ?? 255) < 128) continue;
    opaque.push(i);
    sR += srgbToLinearChannel((px[i * chans] ?? 0) / 255);
    sG += srgbToLinearChannel((px[i * chans + 1] ?? 0) / 255);
    sB += srgbToLinearChannel((px[i * chans + 2] ?? 0) / 255);
  }
  if (!opaque.length) throw new Error(`refusing: ${name} has no opaque texels`);
  const meanOld: RGB = [sR / opaque.length, sG / opaque.length, sB / opaque.length];
  if ((meanOld[0] ?? 0) <= 1e-6 || (meanOld[1] ?? 0) <= 1e-6 || (meanOld[2] ?? 0) <= 1e-6) {
    throw new Error(`refusing: ${name} decoded mean near black, cannot rescale`);
  }
  const scale: RGB = [(rgb[0] ?? 0) / (meanOld[0] ?? 1), (rgb[1] ?? 0) / (meanOld[1] ?? 1), (rgb[2] ?? 0) / (meanOld[2] ?? 1)];
  const out = new Uint8Array(px.byteLength);
  out.set(px);
  for (const i of opaque) {
    const lr = Math.min(1, srgbToLinearChannel((px[i * chans] ?? 0) / 255) * (scale[0] ?? 1));
    const lg = Math.min(1, srgbToLinearChannel((px[i * chans + 1] ?? 0) / 255) * (scale[1] ?? 1));
    const lb = Math.min(1, srgbToLinearChannel((px[i * chans + 2] ?? 0) / 255) * (scale[2] ?? 1));
    out[i * chans] = Math.max(0, Math.min(255, Math.round(linearToSrgbChannel(lr) * 255)));
    out[i * chans + 1] = Math.max(0, Math.min(255, Math.round(linearToSrgbChannel(lg) * 255)));
    out[i * chans + 2] = Math.max(0, Math.min(255, Math.round(linearToSrgbChannel(lb) * 255)));
  }
  // Same integer-offset exact-mean correction as the weave path, in decoded space.
  const decodedMean = (channel: 0 | 1 | 2, extra = 0): number => {
    let s = 0;
    for (const i of opaque) {
      s += srgbToLinearChannel(Math.max(0, Math.min(255, (out[i * chans + channel] ?? 0) + extra)) / 255);
    }
    return s / opaque.length;
  };
  for (const channel of [0, 1, 2] as const) {
    const target = rgb[channel] ?? 0;
    let best = 0;
    let bestMiss = Math.abs(decodedMean(channel) - target);
    for (let o = -12; o <= 12; o += 1) {
      const miss = Math.abs(decodedMean(channel, o) - target);
      if (miss < bestMiss) {
        bestMiss = miss;
        best = o;
      }
    }
    if (best !== 0) {
      for (const i of opaque) {
        out[i * chans + channel] = Math.max(0, Math.min(255, Math.round((out[i * chans + channel] ?? 0) + best)));
      }
    }
  }
  const mean: RGB = [decodedMean(0), decodedMean(1), decodedMean(2)];
  const encoded = chans === 4 ? encodePngRgba8(out, w, h) : encodePngRgb8(out.subarray(0, w * h * 3), w, h);
  return { bytes: encoded, mean, scale };
}

function parseTarget(spec: string): Target {
  const [material, rgb] = spec.split(":");
  const parts = (rgb ?? "").split(",").map(Number);
  const [r, g, b] = parts;
  if (!material || parts.length !== 3 || r === undefined || g === undefined || b === undefined
    || [r, g, b].some((v) => !Number.isFinite(v) || v < 0 || v > 1)) {
    throw new Error(`bad --target ${spec}: want material:r,g,b with channels in [0,1]`);
  }
  return { material, rgb: [r, g, b] };
}

function parseCylUv(spec: string): CylUv {
  const [meshSubstring, repeats] = spec.split(":");
  const [uRepeat, vRepeat] = (repeats ?? "").split(",").map(Number);
  if (!meshSubstring || uRepeat === undefined || vRepeat === undefined
    || !Number.isFinite(uRepeat) || !Number.isFinite(vRepeat) || uRepeat <= 0 || vRepeat <= 0) {
    throw new Error(`bad --cyl-uv ${spec}: want meshSubstring:uRepeat,vRepeat`);
  }
  return { meshSubstring, uRepeat, vRepeat };
}

function parseArgs(argv: string[]): { glb: string; report: string; targets: Target[]; cylUv: CylUv | null; replace: boolean; renormalize: boolean } {
  let glb = "";
  let report = "";
  const targets: Target[] = [];
  let cylUv: CylUv | null = null;
  let replace = false;
  let renormalize = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--glb") { i += 1; glb = argv[i] ?? ""; }
    else if (arg === "--report") { i += 1; report = argv[i] ?? ""; }
    else if (arg === "--target") { i += 1; targets.push(parseTarget(argv[i] ?? "")); }
    else if (arg === "--cyl-uv") { i += 1; cylUv = parseCylUv(argv[i] ?? ""); }
    else if (arg === "--replace") { replace = true; }
    else if (arg === "--renormalize") { renormalize = true; }
    else throw new Error(`unknown arg ${arg}`);
  }
  if (!glb || !report || targets.length === 0) throw new Error("need --glb, --report and at least one --target");
  if (replace && renormalize) throw new Error("refusing: --replace and --renormalize together would both drop and keep texels");
  return { glb, report, targets, cylUv, replace, renormalize };
}

async function main(): Promise<void> {
  const { glb, report, targets, cylUv, replace, renormalize } = parseArgs(process.argv.slice(2));
  const glbPath = resolve(glb);
  const beforeBytes = readFileSync(glbPath).byteLength;
  const doc: Document = await new NodeIO().read(glbPath);
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  if (!buffer) throw new Error("refusing: GLB has no buffer");

  let uvPrimitives = 0;
  if (cylUv) {
    for (const mesh of root.listMeshes()) {
      if (!mesh.getName().includes(cylUv.meshSubstring)) continue;
      for (const prim of mesh.listPrimitives()) {
        if (prim.getAttribute("TEXCOORD_0")) {
          throw new Error(`refusing: ${mesh.getName()} already carries TEXCOORD_0`);
        }
        const pos = prim.getAttribute("POSITION");
        if (!pos) throw new Error(`refusing: ${mesh.getName()} has no POSITION`);
        const count = pos.getCount();
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        const el: number[] = [0, 0, 0];
        for (let i = 0; i < count; i += 1) {
          pos.getElement(i, el);
          const [x, y, z] = el;
          if (x === undefined || y === undefined || z === undefined) {
            throw new Error(`refusing: ${mesh.getName()} POSITION element ${i} is not VEC3`);
          }
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
        const cx = (minX + maxX) / 2;
        const cz = (minZ + maxZ) / 2;
        const height = Math.max(maxY - minY, 1e-6);
        const uv = new Float32Array(count * 2);
        for (let i = 0; i < count; i += 1) {
          pos.getElement(i, el);
          const [ex, ey, ez] = el;
          if (ex === undefined || ey === undefined || ez === undefined) {
            throw new Error(`refusing: ${mesh.getName()} POSITION element ${i} is not VEC3`);
          }
          const u = (Math.atan2(ex - cx, ez - cz) / (2 * Math.PI) + 0.5) * cylUv.uRepeat;
          const v = ((ey - minY) / height) * cylUv.vRepeat;
          uv[i * 2] = u;
          uv[i * 2 + 1] = v;
        }
        prim.setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(uv).setBuffer(buffer));
        uvPrimitives += 1;
      }
    }
    if (uvPrimitives === 0) throw new Error(`refusing: no mesh matched --cyl-uv ${cylUv.meshSubstring}`);
  }

  const rows: Record<string, unknown>[] = [];
  for (const target of targets) {
    const mat = root.listMaterials().find((m) => m.getName() === target.material);
    if (!mat) throw new Error(`refusing: material ${target.material} not in ${glbPath}`);
    const factorBefore = [...mat.getBaseColorFactor()];
    const alpha = factorBefore[3] ?? 1;
    const existing = mat.getBaseColorTexture();
    let bytes: Uint8Array;
    let mode = "attach";
    let extraRow: Record<string, unknown> = {};
    if (renormalize) {
      // Round 4: keep authored photo texels, fix levels + encoding in linear
      // space. The material MUST already carry a texture; nothing is dropped.
      const oldImg = existing ? existing.getImage() : null;
      if (!oldImg) throw new Error(`refusing: ${target.material} has no texture to renormalize`);
      const out = renormalizePng(target.material, oldImg, target.rgb);
      bytes = out.bytes;
      mode = "renormalize";
      extraRow = {
        renormScale: out.scale.map((v) => Number(v.toFixed(4))),
        previousTextureBytes: oldImg.byteLength,
      };
      const tex = doc.createTexture(`${target.material}_palette_renorm`);
      tex.setImage(bytes);
      tex.setMimeType("image/png");
      mat.setBaseColorTexture(tex);
      if (!root.listMaterials().some((m) => m.getBaseColorTexture() === existing)) {
        existing?.dispose();
      }
    } else {
      if (existing) {
        // Round 4: flat HB-02 fills carry no authored content; --replace drops
        // the dark-encoded fill and attaches a fresh corrected weave. Without
        // the flag a re-run stays a loud no-op rather than a stacked bake.
        if (!replace) throw new Error(`refusing: ${target.material} already textured`);
        const oldImg = existing.getImage();
        const removedBytes = oldImg ? oldImg.byteLength : 0;
        mat.setBaseColorTexture(null);
        if (!root.listMaterials().some((m) => m.getBaseColorTexture() === existing)) {
          existing.dispose();
        }
        mode = "replace";
        extraRow = { removedTextureBytes: removedBytes };
      }
      const woven = weavePng(target.material, target.rgb);
      bytes = woven.bytes;
      const tex = doc.createTexture(`${target.material}_palette_weave`);
      tex.setImage(bytes);
      tex.setMimeType("image/png");
      mat.setBaseColorTexture(tex);
    }
    // HB-02 fold: the texture now carries the palette, so the factor must go
    // to white — otherwise glTF renders factor x texture (colour squared).
    mat.setBaseColorFactor([1, 1, 1, alpha]);
    // Loud refusal when the fold misses: effective (white factor x decoded
    // srgb_to_linear(texel) mean) must equal the resolved palette within
    // 0.01 per channel. Round 4: verified through the SHARED contract reader
    // on the exact bytes the GLB now carries — the same number the tests read.
    const sharedMean = textureChannelMeans(bytes);
    if (!sharedMean) throw new Error(`refusing: ${target.material} encoded texture does not decode`);
    const effective: RGB = [sharedMean[0], sharedMean[1], sharedMean[2]];
    const miss = effective.map((v, i) => Math.abs(v - (target.rgb[i] ?? 0)));
    const worst = Math.max(miss[0] ?? 0, miss[1] ?? 0, miss[2] ?? 0);
    if (worst > 0.01) {
      throw new Error(
        `refusing: ${target.material} fold miss ${miss.map((v) => v.toFixed(4)).join(",")} > 0.01`,
      );
    }
    rows.push({
      material: target.material,
      mode,
      resolvedPalette: [...target.rgb],
      textureBytes: bytes.byteLength,
      textureMean: effective.map((v) => Number(v.toFixed(4))),
      factorBefore: factorBefore.map((v) => Number(v.toFixed(4))),
      factorAfter: [1, 1, 1, Number(alpha.toFixed(4))],
      effective: effective.map((v) => Number(v.toFixed(4))),
      foldMiss: Number(worst.toFixed(5)),
      ...extraRow,
    });
    console.log(`WEAVE_FOLD[${mode}] ${target.material} mean=${effective.map((v) => v.toFixed(4)).join(",")} factor=[1,1,1,${alpha.toFixed(2)}] miss=${worst.toFixed(5)} bytes=${bytes.byteLength}`);
  }

  const tmp = `${glbPath}.weave-tmp.glb`;
  await new NodeIO().write(tmp, doc);
  renameSync(tmp, glbPath);
  const afterBytes = readFileSync(glbPath).byteLength;
  writeFileSync(
    resolve(report),
    `${JSON.stringify({ glb, beforeBytes, afterBytes, uvPrimitives, rows }, null, 2)}\n`,
    "utf8",
  );
  console.log(`WEAVE_STAGE wrote ${glbPath} ${beforeBytes} -> ${afterBytes} bytes, report ${report}`);
}

await main();
