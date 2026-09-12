/**
 * Minimal PNG decoder (node:zlib inflate) for evidence contracts.
 *
 * Extracted from `skin-atlas-has-subsurface-not-occlusion.test.ts` (D1 / #537) so
 * multiple contracts can share one proven decoder — do not add `sharp` / pngjs.
 *
 * Returns per-pixel luminance in 0..255 (same scale as the original in-test helper).
 */
import { inflateSync } from "node:zlib";

export type DecodedPng = {
  w: number;
  h: number;
  lum: Float32Array;
  /** Per-pixel R in 0..255. Greyscale images copy the single channel into r=g=b. */
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  /**
   * True when every decoded pixel has R === G === B (or the image is single-channel).
   *
   * Load-bearing for occlusion maps: three.js reads AO from ONE channel, so a statistic over
   * the luminance mix (0.299R + 0.587G + 0.114B) describes what the runtime consumes ONLY when
   * the map is greyscale. A caller asserting on `lum` for an AO map must also assert this, or
   * it is measuring a channel nobody reads.
   */
  greyscale: boolean;
};

export function decodePng(bytes: Uint8Array): DecodedPng | null {
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
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    const body = bytes.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
      depth = bytes[off + 16]!;
      colour = bytes[off + 17]!;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8 || w === 0 || h === 0) return null;
  const chans = colour === 0 ? 1 : colour === 2 ? 3 : colour === 4 ? 2 : colour === 6 ? 4 : 0;
  if (chans === 0) return null;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  } catch {
    return null;
  }
  const stride = w * chans;
  if (raw.length < (stride + 1) * h) return null;

  const lum = new Float32Array(w * h);
  const rCh = new Uint8Array(w * h);
  const gCh = new Uint8Array(w * h);
  const bCh = new Uint8Array(w * h);
  let greyscale = true;
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < h; y += 1) {
    const filter = raw[p++]!;
    for (let x = 0; x < stride; x += 1) {
      const rb = raw[p + x]!;
      const a = x >= chans ? cur[x - chans]! : 0;
      const b = prev[x]!;
      const c = x >= chans ? prev[x - chans]! : 0;
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
      cur[x] = v & 0xff;
    }
    p += stride;
    for (let x = 0; x < w; x += 1) {
      const i = x * chans;
      const R = chans >= 3 ? cur[i]! : cur[i]!;
      const G = chans >= 3 ? cur[i + 1]! : cur[i]!;
      const B = chans >= 3 ? cur[i + 2]! : cur[i]!;
      if (chans >= 3 && (R !== G || R !== B)) greyscale = false;
      const pix = y * w + x;
      rCh[pix] = R;
      gCh[pix] = G;
      bCh[pix] = B;
      lum[pix] = 0.299 * R + 0.587 * G + 0.114 * B;
    }
    prev.set(cur);
  }
  return { w, h, lum, r: rCh, g: gCh, b: bCh, greyscale };
}
