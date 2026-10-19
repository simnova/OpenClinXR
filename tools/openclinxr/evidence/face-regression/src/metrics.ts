/**
 * Region metrics for the whole-face regression check.
 *
 * Each region is measured from the GOLDEN render's landmark mask applied to
 * both images:
 *   - mean CIEDE2000 dE over the masked pixels (the colour move);
 *   - SSIM on L* over the masked pixels (the structure move);
 *   - mean landmark displacement in px between the two landmark sets
 *     (reported, never gated).
 *
 * The production CLI path uses regions.py (spawned, same formulas); this
 * implementation is what the contract test drives and what the sheet writer
 * uses for the per-pixel dE heatmap. decodePng is the shared evidence decoder,
 * imported, not copied.
 */
import { readFileSync } from "node:fs";
import { decodePng, type DecodedPng } from "../../decode-png.js";
import { REGION_LANDMARKS, REGION_ORDER, regionMasks, type Landmark } from "./regions.js";

export type RegionMetric = {
  region: string;
  dE: number;
  ssimL: number;
  landmarkDispPx: number;
  pixels: number;
};

function readPng(path: string): DecodedPng {
  const decoded = decodePng(readFileSync(path));
  if (!decoded) throw new Error(`face-regression: undecodable PNG ${path}`);
  return decoded;
}

export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = (R * 0.2126729 + G * 0.7151522 + B * 0.072175) / 1.0;
  const Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const DEG = Math.PI / 180;

/** CIEDE2000 colour difference (Sharma et al. 2005 reference formula). */
export function ciede2000(lab1: [number, number, number], lab2: [number, number, number]): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = C1p === 0 ? 0 : (Math.atan2(b1, a1p) / DEG + 360) % 360;
  const h2p = C2p === 0 ? 0 : (Math.atan2(b2, a2p) / DEG + 360) % 360;
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * DEG) / 2);
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbarp += hbarp < 360 ? 360 : -360;
    hbarp /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * DEG) +
    0.24 * Math.cos(2 * hbarp * DEG) +
    0.32 * Math.cos((3 * hbarp + 6) * DEG) -
    0.2 * Math.cos((4 * hbarp - 63) * DEG);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dTheta * DEG) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

/** Mean CIEDE2000 over the masked pixels; returns 0 for an empty mask. */
export function meanDE2000(a: DecodedPng, b: DecodedPng, mask: Uint8Array): { dE: number; pixels: number } {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const lab1 = srgbToLab(a.r[i]!, a.g[i]!, a.b[i]!);
    const lab2 = srgbToLab(b.r[i]!, b.g[i]!, b.b[i]!);
    sum += ciede2000(lab1, lab2);
    n += 1;
  }
  return { dE: n ? sum / n : 0, pixels: n };
}

/** Single-window SSIM on the L* channel over the masked pixels (1.0 identical). */
export function ssimL(a: DecodedPng, b: DecodedPng, mask: Uint8Array): number {
  const la = new Float64Array(mask.length);
  const lb = new Float64Array(mask.length);
  let n = 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    la[i] = srgbToLab(a.r[i]!, a.g[i]!, a.b[i]!)[0];
    lb[i] = srgbToLab(b.r[i]!, b.g[i]!, b.b[i]!)[0];
    ma += la[i]!;
    mb += lb[i]!;
    n += 1;
  }
  if (n === 0) return 1;
  ma /= n;
  mb /= n;
  let va = 0;
  let vb = 0;
  let cov = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const da = la[i]! - ma;
    const db = lb[i]! - mb;
    va += da * da;
    vb += db * db;
    cov += da * db;
  }
  va /= n;
  vb /= n;
  cov /= n;
  const L = 100;
  const K1 = 0.01;
  const K2 = 0.03;
  const C1 = (K1 * L) ** 2;
  const C2 = (K2 * L) ** 2;
  const num = (2 * ma * mb + C1) * (2 * cov + C2);
  const den = (ma * ma + mb * mb + C1) * (va + vb + C2);
  return den === 0 ? 1 : num / den;
}

export function measureRegions(input: {
  goldenPng: string;
  currentPng: string;
  goldenLandmarks: Landmark[];
  currentLandmarks?: Landmark[];
  regions?: string[];
}): RegionMetric[] {
  const golden = readPng(input.goldenPng);
  const current = readPng(input.currentPng);
  if (golden.w !== current.w || golden.h !== current.h) {
    throw new Error(`face-regression: dimension mismatch ${input.goldenPng} ${golden.w}x${golden.h} vs ${input.currentPng} ${current.w}x${current.h}`);
  }
  const masks = regionMasks(input.goldenLandmarks, golden.w, golden.h);
  const currentLms = input.currentLandmarks ?? input.goldenLandmarks;
  const wanted = input.regions ?? REGION_ORDER;
  const out: RegionMetric[] = [];
  for (const region of wanted) {
    const mask = masks[region];
    const idxs = REGION_LANDMARKS[region];
    if (!mask || !idxs) continue;
    const { dE, pixels } = meanDE2000(golden, current, mask);
    let disp = 0;
    for (const i of idxs) {
      const g = input.goldenLandmarks[i];
      const c = currentLms[i];
      if (g && c) disp += Math.hypot(g[0] - c[0], g[1] - c[1]);
    }
    disp = idxs.length ? disp / idxs.length : 0;
    out.push({ region, dE, ssimL: ssimL(golden, current, mask), landmarkDispPx: disp, pixels });
  }
  return out;
}
