/**
 * Colocated PNG decode + iris-disc measure for the iris-upgrade gate test.
 *
 * Same posture as cornea-env/catchlight-png.js (and skin-shader/png-crop.js):
 * colocated so the test measures render buffers without reaching across the
 * tools/packages boundary by relative path (architecture freeze) and without
 * counting toward xr-scene testInternalImports. Math is identical to
 * catchlight-png.js (decode, L*, saturation, dark-core circle, cluster).
 * Supports 8-bit RGB/RGBA only; the portrait captures are RGB.
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

export function rectFromArray(r: [number, number, number, number]): CropRect {
  return { x0: r[0], y0: r[1], x1: r[2], y1: r[3] };
}

/** Rec.601-ish luminance (same weights as the portrait lit-span measure). */
export function luminance(png: DecodedPng, x: number, y: number): number {
  const i = (y * png.w + x) * png.chans;
  return 0.2126 * png.data[i]! + 0.7152 * png.data[i + 1]! + 0.0722 * png.data[i + 2]!;
}

/**
 * CIELAB L* (0-100, D65) of an sRGB pixel. h1 grades in L* — perceptual
 * units, so a "25-step lift" means the same everywhere unlike 0-255 levels.
 */
export function labLStar(r: number, g: number, b: number): number {
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const y = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 1.0;
  const f = (t: number): number =>
    t > (6 / 29) ** 3 ? t ** (1 / 3) : t / (3 * (6 / 29) ** 2) + 4 / 29;
  return 116 * f(y) - 16;
}

/** L* of a decoded pixel. */
export function luminanceLStar(png: DecodedPng, x: number, y: number): number {
  const i = (y * png.w + x) * png.chans;
  return labLStar(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
}

/** HSV-style saturation (0..1) of a decoded pixel: (max-min)/max. */
export function saturation(png: DecodedPng, x: number, y: number): number {
  const i = (y * png.w + x) * png.chans;
  const mx = Math.max(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
  if (mx === 0) return 0;
  const mn = Math.min(png.data[i]!, png.data[i + 1]!, png.data[i + 2]!);
  return (mx - mn) / mx;
}

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

export type Pixel = { x: number; y: number };

/**
 * Generic 4-connected component containing the seed: every in-rect pixel
 * where `inside(x, y)` holds, reached from the seed. Throws when the seed
 * itself is outside (eye mislocated — fail closed, never a silent empty).
 */
export function connectedWhere(
  rect: CropRect,
  seedX: number,
  seedY: number,
  inside: (x: number, y: number) => boolean,
): Pixel[] {
  const W = rect.x1 - rect.x0;
  const H = rect.y1 - rect.y0;
  if (!inside(seedX, seedY)) {
    throw new Error(`seed (${seedX},${seedY}) is outside the region — eye mislocated`);
  }
  const key = (x: number, y: number): string => `${x},${y}`;
  const seen = new Set<string>([key(seedX, seedY)]);
  const comp: Pixel[] = [];
  const stack: Pixel[] = [{ x: seedX, y: seedY }];
  while (stack.length > 0) {
    const a = stack.pop()!;
    comp.push(a);
    for (const nb of [
      { x: a.x + 1, y: a.y },
      { x: a.x - 1, y: a.y },
      { x: a.x, y: a.y + 1 },
      { x: a.x, y: a.y - 1 },
    ]) {
      if (nb.x < rect.x0 || nb.x >= rect.x1 || nb.y < rect.y0 || nb.y >= rect.y1) continue;
      const k = key(nb.x, nb.y);
      if (seen.has(k) || !inside(nb.x, nb.y)) continue;
      seen.add(k);
      stack.push(nb);
    }
  }
  return comp;
}

/** BFS-dilate a pixel set by D px, clipped to rect. */
export function darkCoreCircle(
  png: DecodedPng,
  rect: CropRect,
  seedX: number,
  seedY: number,
  threshold: number,
): { cx: number; cy: number; r: number; px: number } {
  const comp = connectedWhere(rect, seedX, seedY, (x, y) => luminanceLStar(png, x, y) < threshold);
  const c = centroid(comp);
  let rr = 0;
  for (const p of comp) rr += Math.hypot(p.x - c.x, p.y - c.y);
  return { cx: c.x, cy: c.y, r: (rr / Math.max(comp.length, 1)) * 1.15, px: comp.length };
}

export function centroid(pts: Pixel[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / Math.max(pts.length, 1), y: sy / Math.max(pts.length, 1) };
}

/** Largest 4-connected cluster size inside a pixel set. */
export function largestCluster(pts: Pixel[]): number {
  const set = new Set(pts.map((p) => `${p.x},${p.y}`));
  const seen = new Set<string>();
  let best = 0;
  for (const p of pts) {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) continue;
    let n = 0;
    const q = [p];
    seen.add(k);
    while (q.length > 0) {
      const a = q.pop()!;
      n += 1;
      for (const nb of [`${a.x + 1},${a.y}`, `${a.x - 1},${a.y}`, `${a.x},${a.y + 1}`, `${a.x},${a.y - 1}`]) {
        if (set.has(nb) && !seen.has(nb)) {
          seen.add(nb);
          const [x, y] = nb.split(",").map(Number) as [number, number];
          q.push({ x, y });
        }
      }
    }
    best = Math.max(best, n);
  }
  return best;
}
