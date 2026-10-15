/**
 * Card tsk_f1f3eba7615d92f0: freckle / redness / accent weights over the young
 * skin family are stored as weights, never baked into the family PNG.
 *
 * Gate (S/consult47/r4.answer.md card 6): weight 0 reproduces the family PNG
 * with max absolute error 0; each layer changes only texels inside its mask
 * (outside max |dLab| = 0, the fix_lips.py mask-only pattern). Falsifier: if
 * no current case varies these weights within a family, bake them and stop —
 * young-family flush varies [0.05, 0.15, 0.28], so the layers proceed.
 *
 * Numbers live in layers-report.json (instrument: skin_layers.py); this file
 * re-derives the gates from the PNG bytes with its own sRGB->Lab instead of
 * quoting the report. Store-backed checks skip under a 'store absent' name
 * when /Volumes/files/openclinxr-assets/store is missing.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPORT = JSON.parse(readFileSync(path.join(HERE, "layers-report.json"), "utf8")) as {
  family: string;
  family_assets: string;
  family_sha256: string;
  freckles: { seed: number; count: number; radius_px: number };
  weight_rule: string;
  cases: Record<
    string,
    {
      skin_tone: string | null;
      family: string | null;
      flush: number;
      weights: Record<string, number>;
    }
  >;
  falsifier: { young_family_flush_values: number[]; decision: string };
  identity: { zero_assets: string; zero_sha256: string; max_abs_error_at_weight_0: number };
  layers: Record<
    string,
    {
      weight: number;
      assets: string;
      sha256: string;
      mask_px: number;
      inside_changed_px: number;
      outside_max_abs_dLab: number;
    }
  >;
  masks: { files: Record<string, { assets: string; sha256: string }> };
  sheet?: {
    renders: Array<{ weights: Record<string, number>; png: string; sha256: string }>;
    crops: Array<{ png: string; sha256: string }>;
  };
  not_tested: string;
};

const STORE = "/Volumes/files/openclinxr-assets/store";
const storePresent = existsSync(STORE);

/** Layer -> hard-mask key in REPORT.masks.files (mirrors skin_layers.py). */
export function maskKeyForLayer(layer: string): string {
  if (layer === "freckles") return "freckle_zone";
  if (layer === "cheek_redness") return "cheek";
  if (layer === "nose_redness") return "nose";
  return layer;
}

/** Weight rule: redness/lip/ear follow flush; freckles/pallor are 0 (no authored field). */
export function weightsForFlush(flush: number): Record<string, number> {
  return {
    freckles: 0,
    cheek_redness: flush,
    nose_redness: flush,
    lip: flush,
    ear: flush,
    pallor: 0,
  };
}

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

/** Minimal PNG decoder (8-bit grey/RGB/RGBA, non-interlaced) -> RGB bytes. */
export function decodePngRgb(file: string): { w: number; h: number; rgb: Uint8Array } {
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
  const chans = colour === 0 ? 1 : colour === 2 ? 3 : colour === 6 ? 4 : 0;
  if (depth !== 8 || !chans || !w) throw new Error(`undecodable PNG ${file}`);
  const raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  const stride = w * chans;
  const plane = new Uint8Array(stride * h);
  let prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < h; y += 1) {
    const f = raw[p++]!;
    const cur = plane.subarray(y * stride, (y + 1) * stride);
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
  const rgb = new Uint8Array(w * h * 3);
  for (let k = 0; k < w * h; k += 1) {
    rgb[k * 3] = plane[k * chans]!;
    rgb[k * 3 + 1] = chans >= 3 ? plane[k * chans + 1]! : plane[k * chans]!;
    rgb[k * 3 + 2] = chans >= 3 ? plane[k * chans + 2]! : plane[k * chans]!;
  }
  return { w, h, rgb };
}

/** sRGB byte -> Lab (D65), same equations as tone-check.py. */
export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = [r / 255, g / 255, b / 255].map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  const m = [
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.072175],
    [0.0193339, 0.119192, 0.9503041],
  ];
  const xyz = m.map((row) => (row[0]! * lin[0]! + row[1]! * lin[1]! + row[2]! * lin[2]!) / [0.95047, 1, 1.08883][m.indexOf(row)]!);
  const f = xyz.map((t) => (t > 0.008856 ? t ** (1 / 3) : (903.3 * t + 16) / 116));
  return [116 * f[1]! - 16, 500 * (f[0]! - f[1]!), 200 * (f[1]! - f[2]!)];
}

/** Max |dLab| over texels where mask is 0 (mask: decoded single-channel bytes). */
export function outsideMaxAbsDlab(
  src: Uint8Array,
  out: Uint8Array,
  mask: Uint8Array,
  n: number,
): number {
  let max = 0;
  for (let k = 0; k < n; k += 1) {
    if (mask[k]! > 127) continue;
    const a = srgbToLab(src[k * 3]!, src[k * 3 + 1]!, src[k * 3 + 2]!);
    const b = srgbToLab(out[k * 3]!, out[k * 3 + 1]!, out[k * 3 + 2]!);
    const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    if (d > max) max = d;
  }
  return max;
}

describe("the skin layers are identity at zero weight", () => {
  it("falsifier: young-family flush varies, so layers proceed (no bake-and-stop)", () => {
    const vals = REPORT.falsifier.young_family_flush_values;
    expect(new Set(vals).size).toBeGreaterThan(1);
    expect(REPORT.falsifier.decision).toBe("proceed_layers");
    expect(REPORT.freckles.seed).toBe(7);
    expect(REPORT.not_tested).toMatch(/animated blush/);
  });

  it("per-case weights follow the flush rule", () => {
    let young = 0;
    for (const [id, c] of Object.entries(REPORT.cases)) {
      expect(c.weights, id).toEqual(weightsForFlush(c.flush));
      if (c.family === "young") {
        young += 1;
        expect(REPORT.falsifier.young_family_flush_values).toContain(c.flush);
      }
    }
    expect(young).toBeGreaterThan(1);
  });

  it("report records six layers with sha + mask counts", () => {
    expect(Object.keys(REPORT.layers).sort()).toEqual(
      ["cheek_redness", "ear", "freckles", "lip", "nose_redness", "pallor"].sort(),
    );
    for (const [id, l] of Object.entries(REPORT.layers)) {
      expect(l.sha256, `${id}.sha256`).toMatch(/^[0-9a-f]{64}$/);
      expect(l.mask_px, `${id}.mask_px`).toBeGreaterThan(1000);
      expect(l.inside_changed_px, `${id}.inside_changed_px`).toBeGreaterThan(100);
      expect(l.outside_max_abs_dLab, `${id}.outside`).toBe(0);
    }
    expect(REPORT.identity.max_abs_error_at_weight_0).toBe(0);
  });

  it.skipIf(!storePresent)("weight 0 reproduces the family PNG byte-identical (max abs error 0)", () => {
    const fam = path.join(STORE, REPORT.family_assets);
    const zero = path.join(STORE, REPORT.identity.zero_assets);
    expect(sha256File(fam)).toBe(REPORT.family_sha256);
    expect(sha256File(zero)).toBe(REPORT.identity.zero_sha256);
    const a = readFileSync(fam);
    const b = readFileSync(zero);
    expect(a.length).toBe(b.length);
    expect(timingSafeEqual(a, b)).toBe(true);
  });

  it.skipIf(!storePresent)("each layer changes only texels inside its mask (outside max |dLab| = 0)", () => {
    const fam = decodePngRgb(path.join(STORE, REPORT.family_assets));
    expect(fam.w).toBe(2048);
    expect(fam.h).toBe(2048);
    for (const [id, l] of Object.entries(REPORT.layers)) {
      const maskKey = maskKeyForLayer(id);
      const maskAbs = path.join(STORE, REPORT.masks.files[maskKey]!.assets);
      expect(sha256File(maskAbs)).toBe(REPORT.masks.files[maskKey]!.sha256);
      const mask = decodePngRgb(maskAbs);
      expect(mask.w).toBe(fam.w);
      expect(mask.h).toBe(fam.h);
      const layerAbs = path.join(STORE, l.assets);
      expect(sha256File(layerAbs)).toBe(l.sha256);
      const layer = decodePngRgb(layerAbs);
      // Mask PNGs are greyscale: R channel carries the binary mask.
      const maskChan = new Uint8Array(fam.w * fam.h);
      for (let k = 0; k < maskChan.length; k += 1) maskChan[k] = mask.rgb[k * 3]!;
      const outside = outsideMaxAbsDlab(fam.rgb, layer.rgb, maskChan, fam.w * fam.h);
      expect(outside, `${id}.outside_max_abs_dLab`).toBe(0);
    }
  }, 300_000);

  it.skipIf(!storePresent)("the grade sheet renders land on the young family", () => {
    expect(REPORT.sheet, "sheet").toBeTruthy();
    expect(REPORT.sheet!.renders.length).toBe(4);
    for (const r of REPORT.sheet!.renders) {
      expect(sha256File(path.join(STORE, r.png))).toBe(r.sha256);
    }
    expect(REPORT.sheet!.crops.length).toBeGreaterThan(0);
    for (const c of REPORT.sheet!.crops) {
      expect(sha256File(path.join(STORE, c.png))).toBe(c.sha256);
    }
    const raw = JSON.stringify(REPORT);
    expect(raw).not.toMatch(/apps\/ui-xr\/public/);
  });

  it.runIf(!storePresent)("store absent: sha checks skipped", () => {
    expect(storePresent).toBe(false);
  });
});
