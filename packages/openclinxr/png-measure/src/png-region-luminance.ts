import { inflateSync } from "node:zlib";

/**
 * Region-aware PNG luminance reader.
 *
 * The decode below is lifted from the local `luminanceSd` in
 * `a-room-has-contact-shadows.test.ts:107`, which its own comment calls "the same reader as the AO and
 * face probes" — i.e. it is already copied into at least three test files. This module exists so the
 * fourth consumer imports instead of copying (D1), and adds the two things a black-frame check needs
 * that the local copies do not have: a sub-RECTANGLE, and a non-black SHARE alongside the spread.
 *
 * FOLLOW-UP, not done here: `a-room-has-contact-shadows.test.ts`,
 * `a-locked-clinical-colour-survives-its-garment-texture.test.ts` and `a-graded-capture-resolves-the-face.test.ts`
 * still carry their own copies. Migrating them is a separate slice — this one is additive on purpose so
 * it cannot regress three passing contracts.
 *
 * Supports 8-bit greyscale / RGB / greyscale+alpha / RGBA, non-interlaced — which is what every capture
 * in this repo writes. Returns null for anything else rather than guessing.
 */

export type RegionFractions = {
  /** Fractions of width/height, 0..1. Defaults to the whole image. */
  left?: number;
  top?: number;
  width?: number;
  height?: number;
};

export type RegionLuminance = {
  width: number;
  height: number;
  /** Sampled texel count. */
  samples: number;
  mean: number;
  sd: number;
  /** Percentage of sampled texels brighter than `blackLuma`. */
  nonBlackPct: number;
  /** Median luma of sampled texels (0..255). */
  median: number;
  /** 90th-percentile luma of sampled texels (0..255). */
  p90: number;
};

/** Rec.709 luma of one texel. */
function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode a PNG and summarise luminance over a rectangular region.
 *
 * `step` subsamples in both axes — a full 1440x900 decode is cheap but the caller usually wants a
 * summary, and stepping keeps a contract's runtime in milliseconds.
 */
export function regionLuminance(
  bytes: Uint8Array,
  region: RegionFractions = {},
  options: { blackLuma?: number; step?: number } = {},
): RegionLuminance | null {
  const blackLuma = options.blackLuma ?? 12;
  const step = Math.max(1, options.step ?? 6);
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;

  let w = 0;
  let h = 0;
  let depth = 0;
  let colour = -1;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  let off = 8;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8);
      h = dv.getUint32(off + 12);
      depth = bytes[off + 16]!;
      colour = bytes[off + 17]!;
      interlace = bytes[off + 20]!;
    } else if (type === "IDAT") idat.push(bytes.subarray(off + 8, off + 8 + len));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || w === 0 || h === 0) return null;
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

  const x0 = Math.max(0, Math.floor((region.left ?? 0) * w));
  const y0 = Math.max(0, Math.floor((region.top ?? 0) * h));
  const x1 = Math.min(w, x0 + Math.floor((region.width ?? 1) * w));
  const y1 = Math.min(h, y0 + Math.floor((region.height ?? 1) * h));

  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  const hist = new Uint32Array(256);
  let samples = 0;
  let sum = 0;
  let sumSq = 0;
  let nonBlack = 0;
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[p + i]!;
      const a = i >= chans ? cur[i - chans]! : 0;
      const b = prev[i]!;
      const c = i >= chans ? prev[i - chans]! : 0;
      cur[i] =
        filter === 0 ? x
        : filter === 1 ? (x + a) & 0xff
        : filter === 2 ? (x + b) & 0xff
        : filter === 3 ? (x + ((a + b) >> 1)) & 0xff
        : (x + paeth(a, b, c)) & 0xff;
    }
    p += stride;
    if (y >= y0 && y < y1 && (y - y0) % step === 0) {
      for (let x = x0; x < x1; x += step) {
        const i = x * chans;
        const l = chans >= 3 ? luma(cur[i]!, cur[i + 1]!, cur[i + 2]!) : cur[i]!;
        const li = Math.max(0, Math.min(255, Math.round(l)));
        hist[li]! += 1;
        samples += 1;
        sum += l;
        sumSq += l * l;
        if (l > blackLuma) nonBlack += 1;
      }
    }
    prev.set(cur);
  }
  if (samples === 0) return null;
  const mean = sum / samples;
  let median = 0;
  let p90 = 0;
  let cum = 0;
  let medianSet = false;
  const half = samples / 2;
  const nineTen = samples * 0.9;
  for (let v = 0; v < 256; v++) {
    cum += hist[v]!;
    if (!medianSet && cum >= half) {
      median = v;
      medianSet = true;
    }
    if (cum >= nineTen) {
      p90 = v;
      break;
    }
  }
  return {
    width: w,
    height: h,
    samples,
    mean,
    sd: Math.sqrt(Math.max(0, sumSq / samples - mean * mean)),
    nonBlackPct: (100 * nonBlack) / samples,
    median,
    p90,
  };
}

/**
 * Whether a captured frame rendered ANYTHING, independent of exposure.
 *
 * `nonBlackPct` bounds one end only — a blank WHITE frame scores 100.0 and passes every
 * brightness-floor gate. Variance separates "rendered nothing" from "rendered something" at either
 * end, because a uniform frame has almost none whatever it weighs.
 *
 * ## DERIVATION (2026-08-22) — every number anchored on ambient evidence, none fitted to clear an
 * observation. All sd figures use the sampling below (viewport region, step 6), the same protocol
 * that produced the historical numbers:
 *
 *   evidence                                                   | viewport sd
 *   ------------------------------------------------------------|------------
 *   REAL uniform failure: black peds capture, recorded in the   |      4.9
 *     a-station-capture-is-not-a-black-frame.test.ts header     |
 *   Dimmest TEXTURED fixture (textured-dim.png, #172)           |     17.36
 *   Dimmest REAL shipped capture of 15 stations                 |     36.01
 *     (ed_stroke_alert_handoff_v1, measured 2026-08-22)         |
 *
 * Ceiling = geometric midpoint of the BINDING pair: sqrt(4.9 x 17.36) = **9.22** — equal-ratio
 * separation from both sides (1.88x above the real uniform frame, 1.88x below the dimmest textured
 * evidence). The ambient floor sits 3.9x above the ceiling, so no real station is near it.
 *
 * Rejected treatments, probed on the #172 fixtures: brightness-only misclassifies textured-dim
 * (clause 4 of the uniform contract refuses it); widening nonBlackPct to bite at both ends
 * misclassifies textured-lit-no-dark-pixels, which mirrors the REAL healthy telehealth capture at
 * nonBlackPct 100.0 (clause 5 refuses it). Variance misclassifies neither.
 *
 * claimScope: whether the frame is UNIFORM, i.e. renders nothing.
 * notEvidenceFor: whether a non-uniform frame looks correct, or why any frame came out uniform.
 */
export type CaptureFrameClass = {
  uniform: boolean;
  /** Viewport-region luminance sd the verdict derives from. */
  sd: number;
  nonBlackPct: number;
};

/** Matches the station-capture contract's viewport: left 68%, excluding top strip and status bar. */
const VIEWPORT_REGION: RegionFractions = { left: 0, top: 0.1, width: 0.68, height: 0.8 };

/** Derived above: geometric midpoint of the binding pair (real uniform 4.9 vs dimmest textured 17.36). */
export const UNIFORM_SD_CEILING = 9.22;

/**
 * Classify a capture PNG. Returns null when the bytes are not a decodable 8-bit non-interlaced
 * greyscale/RGB(A) image (same rules as `regionLuminance`) — callers must treat null as
 * undetermined, never as healthy or broken.
 */
export function classifyCaptureFrame(bytes: Uint8Array): CaptureFrameClass | null {
  const r = regionLuminance(bytes, VIEWPORT_REGION, { blackLuma: 12, step: 6 });
  if (!r) return null;
  return { uniform: r.sd <= UNIFORM_SD_CEILING, sd: r.sd, nonBlackPct: r.nonBlackPct };
}
