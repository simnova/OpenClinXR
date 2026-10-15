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
  const W = rect.x1 - rect.x0;
  const H = rect.y1 - rect.y0;
  const inside = new Uint8Array(W * H);
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x0 + W; x += 1) {
      if (luminance(png, x, y) < threshold) inside[(y - rect.y0) * W + (x - rect.x0)] = 1;
    }
  }
  const seedIdx = (seedY - rect.y0) * W + (seedX - rect.x0);
  if (!inside[seedIdx]) throw new Error(`globe seed (${seedX},${seedY}) is not dark — eye mislocated`);
  const seen = new Uint8Array(W * H);
  const comp: Array<[number, number]> = [];
  const stack: Array<[number, number]> = [[seedX - rect.x0, seedY - rect.y0]];
  seen[seedIdx] = 1;
  while (stack.length > 0) {
    const [ax, ay] = stack.pop()!;
    comp.push([ax, ay]);
    for (const [nx, ny] of [[ax + 1, ay], [ax - 1, ay], [ax, ay + 1], [ax, ay - 1]] as const) {
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      if (!inside[ny * W + nx] || seen[ny * W + nx]) continue;
      seen[ny * W + nx] = 1;
      stack.push([nx, ny]);
    }
  }
  const dist = new Map<string, number>();
  const queue: Array<[number, number]> = [...comp];
  for (const [ax, ay] of comp) dist.set(`${ax},${ay}`, 0);
  const dilated = new Set<string>(dist.keys());
  while (queue.length > 0) {
    const [ax, ay] = queue.shift()!;
    const d = dist.get(`${ax},${ay}`)!;
    if (d >= dilation) continue;
    for (const [nx, ny] of [[ax + 1, ay], [ax - 1, ay], [ax, ay + 1], [ax, ay - 1]] as const) {
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const k = `${nx},${ny}`;
      if (dist.has(k)) continue;
      dist.set(k, d + 1);
      dilated.add(k);
      queue.push([nx, ny]);
    }
  }
  return [...dilated].map((k) => {
    const [ax, ay] = k.split(",").map(Number) as [number, number];
    return { x: ax + rect.x0, y: ay + rect.y0 };
  });
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
