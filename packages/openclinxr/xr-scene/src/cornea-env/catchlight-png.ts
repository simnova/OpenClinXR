/**
 * Minimal PNG decode + crop diff + globe silhouette/blob for the cornea
 * catch-light gate test.
 *
 * Colocated (not exported from the package entrypoint and imported by
 * nothing reachable from it) so the gate test can measure render buffers
 * without counting toward testInternalImports — the same posture as
 * skin-shader/png-crop.js. Supports 8-bit RGB/RGBA only; the portrait
 * captures are RGB.
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

/** Mean L* over a rect. */
export function meanLStar(png: DecodedPng, rect: CropRect): number {
  let sum = 0;
  let n = 0;
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      sum += luminanceLStar(png, x, y);
      n += 1;
    }
  }
  return sum / Math.max(n, 1);
}

/** Mean L* over an explicit pixel set. */
export function meanLStarOf(png: DecodedPng, pts: Pixel[]): number {
  let sum = 0;
  for (const p of pts) sum += luminanceLStar(png, p.x, p.y);
  return sum / Math.max(pts.length, 1);
}

/** Median L* over an explicit pixel set. */
export function medianLStarOf(png: DecodedPng, pts: Pixel[]): number {
  const vals = pts.map((p) => luminanceLStar(png, p.x, p.y)).sort((m, n) => m - n);
  return vals[Math.floor(vals.length / 2)]!;
}

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

/** Mean absolute luminance difference over a rect (0-255 scale). */
export function meanAbsLumaDiff(a: DecodedPng, b: DecodedPng, rect: CropRect): number {
  if (a.w !== b.w || a.h !== b.h) throw new Error("crop diff dimension mismatch");
  let sum = 0;
  let n = 0;
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      sum += Math.abs(luminance(a, x, y) - luminance(b, x, y));
      n += 1;
    }
  }
  return sum / Math.max(n, 1);
}

/** q-th quantile (0..1) of luminance over a rect. */
export function luminanceQuantile(png: DecodedPng, rect: CropRect, q: number): number {
  const vals: number[] = [];
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) vals.push(luminance(png, x, y));
  }
  vals.sort((m, n) => m - n);
  return vals[Math.min(vals.length - 1, Math.floor(vals.length * q))]!;
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
export function dilatePixels(pts: Pixel[], rect: CropRect, D: number): Pixel[] {
  const key = (x: number, y: number): string => `${x},${y}`;
  const dist = new Map<string, number>();
  const queue: Pixel[] = [];
  for (const p of pts) {
    const k = key(p.x, p.y);
    if (dist.has(k)) continue;
    dist.set(k, 0);
    queue.push(p);
  }
  while (queue.length > 0) {
    const a = queue.shift()!;
    const d = dist.get(key(a.x, a.y))!;
    if (d >= D) continue;
    for (const nb of [
      { x: a.x + 1, y: a.y },
      { x: a.x - 1, y: a.y },
      { x: a.x, y: a.y + 1 },
      { x: a.x, y: a.y - 1 },
    ]) {
      if (nb.x < rect.x0 || nb.x >= rect.x1 || nb.y < rect.y0 || nb.y >= rect.y1) continue;
      const k = key(nb.x, nb.y);
      if (dist.has(k)) continue;
      dist.set(k, d + 1);
      queue.push(nb);
    }
  }
  return [...dist.keys()].map((k) => {
    const [x, y] = k.split(",").map(Number) as [number, number];
    return { x, y };
  });
}
/**
 * Globe silhouette: the connected luminance<threshold component containing
 * the iris seed (the eye opening: iris + pupil + lash-bounded dark zone),
 * BFS-dilated by `dilation` px to include the scleral rim where the
 * catch-light lands (the upper sclera renders ~220, above any dark-only
 * threshold). Returned in image coordinates, clipped to `rect`.
 */
export function globeSilhouette(
  png: DecodedPng,
  rect: CropRect,
  seedX: number,
  seedY: number,
  threshold: number,
  dilation: number,
): Pixel[] {
  const core = connectedWhere(rect, seedX, seedY, (x, y) => luminance(png, x, y) < threshold);
  if (core.length === 0) throw new Error(`globe seed (${seedX},${seedY}) is not dark — eye mislocated`);
  return dilatePixels(core, rect, dilation);
}

/**
 * h1 diff spot: the connected L*-delta >= minDelta component containing the
 * max-delta pixel in the crop (D = lit − unlit per pixel). A catch-light is
 * one contiguous specular spot, not scattered glaze.
 */
export function diffSpot(
  lit: DecodedPng,
  unlit: DecodedPng,
  rect: CropRect,
  minDelta: number,
): { spot: Pixel[]; maxDelta: number; maxPixel: Pixel } {
  if (lit.w !== unlit.w || lit.h !== unlit.h) throw new Error("spot diff dimension mismatch");
  const delta = new Map<string, number>();
  let maxDelta = -Infinity;
  let maxPixel: Pixel = { x: rect.x0, y: rect.y0 };
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      const d = luminanceLStar(lit, x, y) - luminanceLStar(unlit, x, y);
      delta.set(`${x},${y}`, d);
      if (d > maxDelta) {
        maxDelta = d;
        maxPixel = { x, y };
      }
    }
  }
  const seen = new Set<string>();
  const spot: Pixel[] = [];
  const queue: Pixel[] = [maxPixel];
  seen.add(`${maxPixel.x},${maxPixel.y}`);
  while (queue.length > 0) {
    const a = queue.pop()!;
    if ((delta.get(`${a.x},${a.y}`) ?? -Infinity) < minDelta) continue;
    spot.push(a);
    for (const nb of [
      { x: a.x + 1, y: a.y },
      { x: a.x - 1, y: a.y },
      { x: a.x, y: a.y + 1 },
      { x: a.x, y: a.y - 1 },
    ]) {
      const k = `${nb.x},${nb.y}`;
      if (nb.x < rect.x0 || nb.x >= rect.x1 || nb.y < rect.y0 || nb.y >= rect.y1 || seen.has(k)) continue;
      seen.add(k);
      queue.push(nb);
    }
  }
  return { spot, maxDelta, maxPixel };
}

/**
 * h1 dark-core circle: connected L* < threshold component containing the
 * seed (pupil + dark inner iris), with centroid + mean radial distance x
 * 1.15 as the projected iris circle. A conservative inner bound of the
 * brown iris disc (which extends ~1.6x wider); centroid-inside and
 * area-fraction bars only get easier on the full disc.
 */
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

/**
 * Catch-light blob: silhouette pixels brighter than the face-crop p99 in
 * the lit render AND lifted by more than minDelta over the unlit render.
 * The delta guard keeps static bright skin possibly swallowed by the
 * dilation from counting as a highlight.
 */
export function highlightBlob(
  lit: DecodedPng,
  unlit: DecodedPng,
  silhouette: Pixel[],
  faceP99: number,
  minDelta: number,
): Pixel[] {
  return silhouette.filter(
    (p) => luminance(lit, p.x, p.y) > faceP99 && luminance(lit, p.x, p.y) - luminance(unlit, p.x, p.y) > minDelta,
  );
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
