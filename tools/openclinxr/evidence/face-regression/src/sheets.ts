/**
 * Sheet writer: one sheet per case/view with a row per region. Each row carries
 * the golden crop, the current crop and the per-pixel CIEDE2000 heatmap crop.
 * Crops are native pixels (no resampling) — the row height is the region bbox
 * height. Region bboxes and heatmap PNGs both come from src/regions.py (its
 * metrics JSON); this module derives no anatomy and does no colour math.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng } from "../../decode-png.js";
import type { RegionBounds } from "./metrics.js";
import { encodePngRgb } from "./png.js";

type Rgb = Uint8Array;

type Img = { w: number; h: number; r: Uint8Array; g: Uint8Array; b: Uint8Array };

function crop(bounds: RegionBounds, img: Img): { w: number; h: number; rgb: Rgb } {
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
  outPng: string;
  regions: string[];
  /** Per-region bbox from the regions.py metrics JSON (crop source). */
  bounds: Record<string, RegionBounds>;
  /** Per-region full-image dE heatmap PNG written by regions.py. */
  heatmaps: Record<string, string>;
}): void {
  const golden = decodePng(readFileSync(input.goldenPng));
  const current = decodePng(readFileSync(input.currentPng));
  if (!golden || !current) throw new Error("face-regression sheet: undecodable PNG");
  const heats: Record<string, Img> = {};
  for (const region of input.regions) {
    const path = input.heatmaps[region];
    if (!path) throw new Error(`face-regression sheet: no heatmap for region ${region}`);
    const decoded = decodePng(readFileSync(path));
    if (!decoded) throw new Error(`face-regression sheet: undecodable heatmap ${path}`);
    heats[region] = decoded;
  }
  let totalW = 0;
  let totalH = 0;
  const rowH: Record<string, number> = {};
  for (const region of input.regions) {
    const b = input.bounds[region];
    if (!b) throw new Error(`face-regression sheet: no bbox for region ${region}`);
    rowH[region] = Math.max(1, b.y1 - b.y0);
    totalW = Math.max(totalW, Math.max(1, b.x1 - b.x0) * 3);
    totalH += rowH[region]! + 4;
  }
  const sheet = { w: Math.max(1, totalW), h: Math.max(1, totalH), rgb: new Uint8Array(Math.max(1, totalW) * Math.max(1, totalH) * 3) };
  let y = 0;
  for (const region of input.regions) {
    const b = input.bounds[region]!;
    const g = crop(b, golden);
    const c = crop(b, current);
    const hm = crop(b, heats[region]!);
    blit(sheet, g, 0, y, g.w, rowH[region]!);
    blit(sheet, c, g.w, y, c.w, rowH[region]!);
    blit(sheet, hm, g.w * 2, y, hm.w, rowH[region]!);
    y += rowH[region]! + 4;
  }
  writeFileSync(input.outPng, encodePngRgb(sheet.w, sheet.h, sheet.rgb));
}
