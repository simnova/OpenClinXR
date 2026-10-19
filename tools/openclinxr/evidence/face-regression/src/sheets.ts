/**
 * Sheet writer: one sheet per case/view with a row per region. Each row carries
 * the golden crop, the current crop and a per-pixel CIEDE2000 heatmap. Crops
 * are native pixels (no resampling) — the row height is the region bbox height.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng } from "../../decode-png.js";
import { buildRegionPolygons, type Landmark } from "./regions.js";
import { ciede2000, srgbToLab } from "./metrics.js";
import { encodePngRgb } from "./png.js";

type Rgb = Uint8Array;

function crop(bounds: { x0: number; y0: number; x1: number; y1: number }, img: { w: number; h: number; r: Uint8Array; g: Uint8Array; b: Uint8Array }): { w: number; h: number; rgb: Rgb } {
  const w = Math.max(1, bounds.x1 - bounds.x0);
  const h = Math.max(1, bounds.y1 - bounds.y0);
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(img.w - 1, Math.max(0, bounds.x0 + x));
      const sy = Math.min(img.h - 1, Math.max(0, bounds.y0 + y));
      const si = sy * img.w + sx;
      const di = (y * w + x) * 3;
      rgb[di] = img.r[si]!;
      rgb[di + 1] = img.g[si]!;
      rgb[di + 2] = img.b[si]!;
    }
  }
  return { w, h, rgb };
}

/** CIEDE2000 heatmap: 0 -> black, >= 10 -> red. */
function heatmap(golden: ReturnType<typeof decodePng> & object, current: ReturnType<typeof decodePng> & object, bounds: { x0: number; y0: number; x1: number; y1: number }): { w: number; h: number; rgb: Rgb } {
  const w = Math.max(1, bounds.x1 - bounds.x0);
  const h = Math.max(1, bounds.y1 - bounds.y0);
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(golden.w - 1, Math.max(0, bounds.x0 + x));
      const sy = Math.min(golden.h - 1, Math.max(0, bounds.y0 + y));
      const si = sy * golden.w + sx;
      const dE = ciede2000(
        srgbToLab(golden.r[si]!, golden.g[si]!, golden.b[si]!),
        srgbToLab(current.r[si]!, current.g[si]!, current.b[si]!),
      );
      const t = Math.min(1, dE / 10);
      const di = (y * w + x) * 3;
      rgb[di] = Math.round(255 * t);
      rgb[di + 1] = Math.round(255 * Math.max(0, t - 0.5) * 2);
      rgb[di + 2] = 0;
    }
  }
  return { w, h, rgb };
}

function blit(dst: { w: number; h: number; rgb: Rgb }, src: { w: number; h: number; rgb: Rgb }, atX: number, atY: number, dw: number, dh: number): void {
  for (let y = 0; y < src.h && y < dh; y += 1) {
    for (let x = 0; x < src.w && x < dw; x += 1) {
      const dx = atX + x;
      const dy = atY + y;
      if (dx < 0 || dy < 0 || dx >= dst.w || dy >= dst.h) continue;
      const si = (y * src.w + x) * 3;
      const di = (dy * dst.w + dx) * 3;
      dst.rgb[di] = src.rgb[si]!;
      dst.rgb[di + 1] = src.rgb[si + 1]!;
      dst.rgb[di + 2] = src.rgb[si + 2]!;
    }
  }
}

export function writeRegionSheet(input: {
  goldenPng: string;
  currentPng: string;
  goldenLandmarks: Landmark[];
  outPng: string;
  regions: string[];
}): void {
  const golden = decodePng(readFileSync(input.goldenPng));
  const current = decodePng(readFileSync(input.currentPng));
  if (!golden || !current) throw new Error("face-regression sheet: undecodable PNG");
  const polys = buildRegionPolygons(input.goldenLandmarks);
  const bounds: Record<string, { x0: number; y0: number; x1: number; y1: number }> = {};
  let totalW = 0;
  let totalH = 0;
  const rowH: Record<string, number> = {};
  for (const region of input.regions) {
    const poly = polys[region];
    if (!poly || poly.length < 3) continue;
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const b = {
      x0: Math.max(0, Math.floor(Math.min(...xs))),
      y0: Math.max(0, Math.floor(Math.min(...ys))),
      x1: Math.min(golden.w, Math.ceil(Math.max(...xs))),
      y1: Math.min(golden.h, Math.ceil(Math.max(...ys))),
    };
    bounds[region] = b;
    rowH[region] = Math.max(1, b.y1 - b.y0);
    totalW = Math.max(totalW, Math.max(1, b.x1 - b.x0) * 3);
    totalH += rowH[region]! + 4;
  }
  const sheet = { w: Math.max(1, totalW), h: Math.max(1, totalH), rgb: new Uint8Array(Math.max(1, totalW) * Math.max(1, totalH) * 3) };
  let y = 0;
  for (const region of input.regions) {
    const b = bounds[region];
    if (!b) continue;
    const g = crop(b, golden);
    const c = crop(b, current);
    const hm = heatmap(golden, current, b);
    blit(sheet, g, 0, y, g.w, rowH[region]!);
    blit(sheet, c, g.w, y, c.w, rowH[region]!);
    blit(sheet, hm, g.w * 2, y, hm.w, rowH[region]!);
    y += rowH[region]! + 4;
  }
  writeFileSync(input.outPng, encodePngRgb(sheet.w, sheet.h, sheet.rgb));
}
