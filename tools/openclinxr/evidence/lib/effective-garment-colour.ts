/**
 * effective-garment-colour.ts — one shared factor x texture-mean reader.
 *
 * Fleet convention since HB-02 (22ec335a5): the fold moved every garment
 * baseColorFactor into its baseColorTexture and reset factors to white, so a
 * bare factor reads white on textured garments and the shipped colour is the
 * EFFECTIVE colour (factor x per-channel texture mean). Untextured garments
 * keep the bare factor; non-PNG images (authored JPEG originals, e.g. the
 * tight-jeans diffuse) fall back to the bare factor — conservative for every
 * floor that consumes this.
 *
 * Extracted from a-declared-fabric-palette-reaches-the-shipped-garment.test.ts
 * (its file-local textureChannelMeans + factor x mean read, byte-identical
 * logic); garment-palette-role-source.ts imports this module instead of a
 * second implementation. Per-channel PNG decode over opaque texels, no
 * subsampling.
 */

import { inflateSync } from "node:zlib";

export type RGB3 = [number, number, number];

/** Per-channel mean of a PNG's opaque texels (full decode, no subsampling),
 * or null when the image is absent or not a decodable 8-bit PNG. */
export function textureChannelMeans(bytes: Uint8Array): RGB3 | null {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  let w = 0;
  let h = 0;
  let depth = 0;
  let colour = -1;
  const idat: Uint8Array[] = [];
  let off = 8;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(
      bytes[off + 4] ?? 0,
      bytes[off + 5] ?? 0,
      bytes[off + 6] ?? 0,
      bytes[off + 7] ?? 0,
    );
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
  if (depth !== 8 || !chans || !w) return null;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  } catch {
    return null;
  }
  const stride = w * chans;
  if (raw.length < (stride + 1) * h) return null;
  let prev = new Uint8Array(stride);
  let p = 0;
  const sums = [0, 0, 0];
  let n = 0;
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
    for (let x = 0; x < w; x += 1) {
      const i = x * chans;
      if (chans === 4 && (cur[i + 3] ?? 255) < 128) continue;
      sums[0] = (sums[0] ?? 0) + (cur[i] ?? 0);
      sums[1] = (sums[1] ?? 0) + (cur[i + 1] ?? cur[i] ?? 0);
      sums[2] = (sums[2] ?? 0) + (cur[i + 2] ?? cur[i] ?? 0);
      n += 1;
    }
    prev = Uint8Array.from(cur);
  }
  if (!n) return null;
  return [(sums[0] ?? 0) / n / 255, (sums[1] ?? 0) / n / 255, (sums[2] ?? 0) / n / 255];
}

/** Effective shipped colour: factor x per-channel texture mean when a
 * decodable texture is present, otherwise the bare factor. Channels are the
 * first three of the glTF baseColorFactor. */
export function effectiveBaseColorFactor(
  factor: readonly number[],
  image: Uint8Array | null,
): RGB3 {
  const means = image ? textureChannelMeans(image) : null;
  if (!means) {
    return [factor[0] ?? 1, factor[1] ?? 1, factor[2] ?? 1];
  }
  return [(factor[0] ?? 1) * means[0], (factor[1] ?? 1) * means[1], (factor[2] ?? 1) * means[2]];
}
