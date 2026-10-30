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

import { repoRoot } from "@openclinxr/factory-station-core/runner";
/** Relocated evidence: skin sources stay under tools/ (S4); anchor via the repo-root helper (S5). */
const HERE = path.join(repoRoot(), "tools/openclinxr/asset-pipeline/skin/families");
const REPORT = JSON.parse(readFileSync(path.join(HERE, "layers-report.json"), "utf8")) as {
  family: string;
  family_assets: string;
  family_sha256: string;
  freckles: {
    seed: number;
    texels_per_mm: { value: number; expression: string; measured_over: string };
    known_good: string;
    med: {
      count: number;
      nose_centers: number;
      cheek_side1: number;
      cheek_side2: number;
      diam_mm_min: number;
      diam_mm_max: number;
      peak_halfmm_bin_share: number;
      blobs: Array<{
        y: number;
        x: number;
        diam_mm: number;
        r_tex: number;
        axis_q: number;
        theta_deg: number;
        site: string;
      }>;
    };
    sweep: Record<string, { count: number; assets: string; sha256: string }>;
  };
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
  h1?: {
    skin_rule: string;
    skinmask_assets: string;
    skinmask_sha256: string;
    renders: Array<{ id: string; png: string; sha256: string }>;
    crops: Array<{ png: string; sha256: string; size_px: number[] }>;
    p1: { before: number; after: number };
    p2: {
      center_col: number;
      floor: number;
      before: { max_step: number; max_step_row0: number; pass: boolean };
      after: { max_step: number; pass: boolean };
      series_rows: number[];
      series_dL: number[];
    };
    p3: { patches: Record<string, { before: number; after: number }> };
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

  it.skipIf(!storePresent)("H1 P1: pallor covers whole skin in the render (>= 0.95)", () => {
    expect(REPORT.h1, "h1").toBeTruthy();
    const h1 = REPORT.h1!;
    const skinAbs = path.join(STORE, h1.skinmask_assets);
    expect(sha256File(skinAbs)).toBe(h1.skinmask_sha256);
    const skinPx = decodePngRgb(skinAbs);
    const zero = decodePngRgb(path.join(STORE, "skin-layers/skinlay-zero-front.png"));
    expect(skinPx.w).toBe(zero.w);
    const pal = decodePngRgb(path.join(STORE, "skin-layers/h1/h1-pallor06-front.png"));
    const cheek = decodePngRgb(path.join(STORE, "skin-layers/skinlay-cheek06-front.png"));
    const freck = decodePngRgb(path.join(STORE, "skin-layers/h1/h1-freck-med-front.png"));
    const n = zero.w * zero.h;
    // Re-derive the skin set: lit background-excluded pixels responding in any
    // non-lip layer render; must match the stored mask.
    let maskMatch = 0;
    let skinN = 0;
    let changed = 0;
    let litN = 0;
    for (let k = 0; k < n; k += 1) {
      const bg =
        Math.abs(zero.rgb[k * 3]! - 0x18) +
          Math.abs(zero.rgb[k * 3 + 1]! - 0x21) +
          Math.abs(zero.rgb[k * 3 + 2]! - 0x1d) <=
        36;
      if (bg) {
        expect(skinPx.rgb[k * 3]).toBe(0);
        continue;
      }
      litN += 1;
      const dl = (img: Uint8Array): number =>
        srgbToLab(img[k * 3]!, img[k * 3 + 1]!, img[k * 3 + 2]!)[0] -
        srgbToLab(zero.rgb[k * 3]!, zero.rgb[k * 3 + 1]!, zero.rgb[k * 3 + 2]!)[0];
      const isSkin =
        Math.abs(dl(pal.rgb)) > 0.5 || Math.abs(dl(cheek.rgb)) > 0.5 || Math.abs(dl(freck.rgb)) > 0.5;
      if (skinPx.rgb[k * 3]! > 127 === isSkin) maskMatch += 1;
      if (isSkin) {
        skinN += 1;
        if (Math.abs(dl(pal.rgb)) > 1) changed += 1;
      }
    }
    expect(maskMatch, "skinmask agreement").toBe(litN);
    const frac = changed / Math.max(skinN, 1);
    expect(skinN).toBeGreaterThan(100000);
    expect(frac, "P1").toBeGreaterThanOrEqual(0.95);
    expect(Math.abs(frac - h1.p1.after), "P1 matches report").toBeLessThan(0.01);
  }, 300_000);

  it.skipIf(!storePresent)("H1 P2: no seam on the centre line (before fails, after passes)", () => {
    const h1 = REPORT.h1!;
    const zero = decodePngRgb(path.join(STORE, "skin-layers/skinlay-zero-front.png"));
    const palBefore = decodePngRgb(path.join(STORE, "skin-layers/skinlay-pallor06-front.png"));
    const palAfter = decodePngRgb(path.join(STORE, "skin-layers/h1/h1-pallor06-front.png"));
    const rows = h1.p2.series_rows;
    const col = h1.p2.center_col;
    const dlAt = (img: Uint8Array, r: number): number => {
      const acc: number[] = [];
      for (let c = col - 8; c <= col + 8; c += 1) {
        const k = r * zero.w + c;
        acc.push(
          srgbToLab(img[k * 3]!, img[k * 3 + 1]!, img[k * 3 + 2]!)[0] -
            srgbToLab(zero.rgb[k * 3]!, zero.rgb[k * 3 + 1]!, zero.rgb[k * 3 + 2]!)[0],
        );
      }
      acc.sort((a, b) => a - b);
      return acc[8]!;
    };
    for (const [img, rep, wantPass, spot] of [
      [palBefore.rgb, h1.p2.before, false, false],
      [palAfter.rgb, h1.p2.after, true, true],
    ] as const) {
      const vals = rows.map((r) => dlAt(img, r));
      // Spot-check the stored (after) series, then gate the re-derived changes.
      if (spot) {
        for (const i of [0, Math.floor(rows.length / 2), rows.length - 1]) {
          expect(vals[i]!, `series[${i}]`).toBeCloseTo(h1.p2.series_dL[i]!, 2);
        }
      }
      const ch = vals.slice(1).map((v, i) => Math.abs(v - vals[i]!));
      const sorted = [...ch].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)]!;
      const mx = Math.max(...ch);
      const thr = Math.max(2 * med, h1.p2.floor);
      expect(mx <= thr, `P2 mx=${mx.toFixed(3)} thr=${thr.toFixed(3)}`).toBe(wantPass);
      expect(rep.pass).toBe(wantPass);
    }
    // The before failure sits on the old forehead seam (full-render rows ~439-451).
    expect(h1.p2.before.max_step_row0).toBeGreaterThanOrEqual(435);
    expect(h1.p2.before.max_step_row0).toBeLessThanOrEqual(455);
  }, 300_000);

  it.skipIf(!storePresent)("H1 P3: cheek strength not weakened (after >= before)", () => {
    for (const p of Object.values(REPORT.h1!.p3.patches)) {
      expect(p.after, "P3").toBeGreaterThanOrEqual(p.before);
    }
  });

  it.skipIf(!storePresent)("H1 F1/F2: seeded freckles on nose+cheeks, 1-4mm span, no dominant size", () => {
    const f = REPORT.freckles;
    expect(f.seed).toBe(7);
    expect(f.known_good).toMatch(/no known-good/);
    expect(f.texels_per_mm.value).toBeCloseTo(2.269, 3);
    expect(f.texels_per_mm.expression).toMatch(/sqrt\(50766\.1\/9864\.2\)/);
    const blobs = f.med.blobs;
    expect(blobs.length).toBe(f.med.count);
    const nose = blobs.filter((b) => b.site === "nose");
    const s1 = blobs.filter((b) => b.site === "cheek" && b.y < 1058.5);
    const s2 = blobs.filter((b) => b.site === "cheek" && b.y >= 1058.5);
    expect(nose.length, "F1 nose").toBeGreaterThanOrEqual(10);
    expect(nose.length).toBe(f.med.nose_centers);
    expect(s1.length).toBeGreaterThanOrEqual(10);
    expect(s2.length).toBeGreaterThanOrEqual(10);
    const diams = blobs.map((b) => b.diam_mm);
    expect(Math.min(...diams), "F2 min").toBeLessThanOrEqual(1.5);
    expect(Math.max(...diams), "F2 max").toBeGreaterThanOrEqual(4.0);
    const bins = new Map<number, number>();
    for (const d of diams) {
      const bin = Math.floor(d * 2) / 2;
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }
    const peak = Math.max(...bins.values()) / blobs.length;
    expect(peak, "F2 no dominant size").toBeLessThanOrEqual(0.4);
    expect(f.med.peak_halfmm_bin_share).toBeCloseTo(peak, 3);
    // r_tex follows diam_mm * texels_per_mm / 2 up to the noise perturbation.
    for (const b of blobs) {
      const want = (b.diam_mm * f.texels_per_mm.value) / 2;
      expect(Math.abs(b.r_tex - want) / want, `r_tex ${b.x},${b.y}`).toBeLessThan(0.6);
      expect(b.axis_q).toBeGreaterThanOrEqual(0.65);
      expect(b.axis_q).toBeLessThanOrEqual(1.0);
    }
    // Spot-check: blob centres actually darken the med atlas PNG.
    const fam = decodePngRgb(path.join(STORE, REPORT.family_assets));
    const med = decodePngRgb(path.join(STORE, REPORT.layers.freckles.assets));
    const check = [...nose.slice(0, 5), ...s1.slice(0, 5)];
    for (const b of check) {
      const k = b.y * fam.w + b.x;
      const dL =
        srgbToLab(med.rgb[k * 3]!, med.rgb[k * 3 + 1]!, med.rgb[k * 3 + 2]!)[0] -
        srgbToLab(fam.rgb[k * 3]!, fam.rgb[k * 3 + 1]!, fam.rgb[k * 3 + 2]!)[0];
      expect(dL, `blob darkening ${b.x},${b.y}`).toBeLessThan(-2);
    }
  }, 300_000);

  it.skipIf(!storePresent)("H1 sweep renders land side by side (no winner picked)", () => {
    expect(REPORT.h1!.renders.length).toBe(4);
    for (const r of REPORT.h1!.renders) {
      expect(sha256File(path.join(STORE, r.png))).toBe(r.sha256);
    }
    for (const c of REPORT.h1!.crops) {
      expect(sha256File(path.join(STORE, c.png))).toBe(c.sha256);
    }
    expect(Object.keys(REPORT.freckles.sweep).sort()).toEqual(["high", "low", "med"].sort());
    for (const s of Object.values(REPORT.freckles.sweep)) {
      expect(sha256File(path.join(STORE, s.assets))).toBe(s.sha256);
    }
    const raw = JSON.stringify(REPORT);
    expect(raw).not.toMatch(/apps\/ui-xr\/public/);
  });

  it.runIf(!storePresent)("store absent: sha checks skipped", () => {
    expect(storePresent).toBe(false);
  });
});
