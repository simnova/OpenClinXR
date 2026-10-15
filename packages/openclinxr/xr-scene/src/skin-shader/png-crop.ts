/**
 * Minimal PNG decode + crop diff for the skin-shader gate test.
 *
 * Colocated (not exported from the package entrypoint) so the gate test can
 * measure render buffers without reaching across the package boundary into
 * tools/. Supports 8-bit RGB/RGBA only — the portrait captures are RGB(A).
 */

import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";

export type DecodedPng = { w: number; h: number; chans: number; data: Uint8Array };

export function decodePngFile(file: string): DecodedPng {
  const bytes = readFileSync(file);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let w = 0;
  let h = 0;
  let depth = 0;
  let colour = -1;
  const idat: Uint8Array[] = [];
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
      depth = bytes[off + 16]!;
      colour = bytes[off + 17]!;
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(off + 8, off + 8 + len));
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  const chans = colour === 0 ? 1 : colour === 2 ? 3 : colour === 4 ? 2 : colour === 6 ? 4 : 0;
  if (depth !== 8 || !chans || !w) throw new Error(`undecodable PNG ${file}`);
  const raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  const stride = w * chans;
  const out = new Uint8Array(stride * h);
  let prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < h; y += 1) {
    const f = raw[p++]!;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const rb = raw[p + x]!;
      const a = x >= chans ? cur[x - chans]! : 0;
      const b = prev[x]!;
      const c = x >= chans ? prev[x - chans]! : 0;
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
    prev = cur;
  }
  return { w, h, chans, data: out };
}

export type CropRect = { x0: number; y0: number; x1: number; y1: number };

/** Pixels in rect whose per-channel abs diff exceeds tol on any of RGB. */
export function countChangedPx(a: DecodedPng, b: DecodedPng, rect: CropRect, tol = 0): number {
  if (a.w !== b.w || a.h !== b.h) throw new Error("crop diff dimension mismatch");
  const c = Math.min(a.chans, b.chans, 3);
  let n = 0;
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      for (let ch = 0; ch < c; ch += 1) {
        if (Math.abs(a.data[(y * a.w + x) * a.chans + ch]! - b.data[(y * b.w + x) * b.chans + ch]!) > tol) {
          n += 1;
          break;
        }
      }
    }
  }
  return n;
}
