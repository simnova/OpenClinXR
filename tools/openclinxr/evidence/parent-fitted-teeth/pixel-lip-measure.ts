/**
 * Pixel lip measure from rendered isolated-viseme stills (lip-bones2 slice).
 *
 * WHY: the landmark-corner width instrument (extreme-x oris-dominant verts
 * projected headlessly) reported attempt-1 bone narrowing of O -17.7% / U
 * -16.1% vs E, while the coordinator's grade of the rendered front stills
 * showed the visible opening the SAME width before|after (plus more lower
 * teeth on O). The archived attempt-1 raw.json even carries off-canvas
 * landmark projections (34-view corners at x -1600; front central boxes
 * spanning y 279-1094 on a 1024 canvas), so the landmark width describes a
 * projection the camera never drew. This module measures the stills
 * themselves: segment the visible mouth (dark aperture + vermilion/lip-red
 * vs surrounding skin, thresholds calibrated from the rest-pose still of
 * the SAME render) and report outer lip width (commissure to commissure),
 * aperture width/height, and lip-centre forward from the 3/4 silhouette.
 *
 * COORDINATE CONVENTION: top-origin RGB buffers (row 0 = image top, as PNG
 * decoders and ffmpeg rgb24 emit). x/y in px. Still size is asserted
 * 1024x1024 (the isolated pack stills).
 *
 * Rest-pose calibration (sil still of the same render; measured 2026-10-07):
 * skin cheek L (x60-160 y350-450) mean R135.4 G106.0 B80.1, redness 29.3;
 * skin cheek R mean R184.6 G138.7 B105.7, redness 45.9; aperture patch
 * (x430-590 y440-480) mean 27.5 sd 13.7; lower-lip patch redness excess
 * ~+8..+20 over local skin. Rules: darkT = apertureMean + 1.5*apertureSd
 * clamped [40,60] (=48 on this render); redT = clamp(lipRedxsMedian/2, 6, 12);
 * gumT = redT*2 + 6; tooth rule reused from tooth-pixel-split (mean>148,
 * |r-g|<16, |g-b|<16, 140<r<220); bgT34 = dark-cluster median + 25
 * clamped [45,70] (=53 on this render).
 *
 * The old landmark metric is kept (isolated-viseme-measure.ts still emits
 * widthPx/aperturePx) but nothing gates on it; the lip-bone gate reads the
 * pixel columns in pixel-lip-measure.json.
 *
 * Run: pnpm exec tsx tools/openclinxr/evidence/parent-fitted-teeth/pixel-lip-validate.ts
 */

export type RgbImage = {
  rgb: Uint8Array;
  w: number;
  h: number;
};

export type PixelLipThresholds = {
  schemaVersion: "openclinxr.pixel-lip-measure.v1";
  darkT: number;
  redT: number;
  gumT: number;
  bgT34: number;
  restStats: {
    skinL: { r: number; g: number; b: number };
    skinR: { r: number; g: number; b: number };
    apertureMean: number;
    apertureSd: number;
    lipRedxsMedian: number;
    bg34Median: number;
  };
};

/** Mouth-band search window (front view, top-origin px on 1024 canvas). */
export const FRONT_BAND = { x0: 150, x1: 875, y0: 380, y1: 620 } as const;
/** Per-row skin reference columns (same row, inside the face at all band rows). */
const SKIN_L = { x0: 150, x1: 210 };
const SKIN_R = { x0: 814, x1: 874 };
/** Aperture-height scan columns (mouth centre). */
const APERTURE_COLS = { x0: 462, x1: 562, step: 4 } as const;
/** 3/4 silhouette bands. */
const PROFILE34 = {
  lipY0: 400, lipY1: 520, anchorY0: 120, anchorY1: 180, x0: 120, x1: 600, step: 4,
} as const;
/** Philtrum-lump proxy bands. Front band sits on the philtrum skin between
 * the nose base and the upper-vermilion shadow (sil phil mean 124.4 vs
 * cheek 118.7: plain lit skin, so a bone-driven forward bulge reads as a
 * shadow-band luminance drop). 34 rows cover philtrum height: the O pose
 * with upper-midline push reads ~7px forward of E there while lip height
 * reads ~1px behind. */
export const PHILTRUM_BAND = { x0: 462, x1: 562, y0: 360, y1: 400 } as const;
const PHILTRUM34 = { y0: 380, y1: 400, step: 4 } as const;

function mean(values: number[]): number {
  if (values.length === 0) throw new Error("empty-sample");
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sd(values: number[], m: number): number {
  if (values.length < 2) return 0;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) * (b - m), 0) / (values.length - 1));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

function pxAt(img: RgbImage, x: number, y: number): [number, number, number] {
  const p = (y * img.w + x) * 3;
  return [img.rgb[p] ?? 0, img.rgb[p + 1] ?? 0, img.rgb[p + 2] ?? 0];
}

function patchMeans(img: RgbImage, x0: number, x1: number, y0: number, y1: number): { r: number; g: number; b: number } {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const [r, g, b] = pxAt(img, x, y);
      rs.push(r);
      gs.push(g);
      bs.push(b);
    }
  }
  return { r: mean(rs), g: mean(gs), b: mean(bs) };
}

/** Per-row skin reference means from the same row's cheek columns. */
function rowSkinRefs(img: RgbImage, y: number): { l: [number, number, number]; r: [number, number, number] } {
  const collect = (x0: number, x1: number): [number, number, number] => {
    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];
    for (let x = x0; x < x1; x += 2) {
      const [r, g, b] = pxAt(img, x, y);
      rs.push(r);
      gs.push(g);
      bs.push(b);
    }
    return [mean(rs), mean(gs), mean(bs)];
  };
  return { l: collect(SKIN_L.x0, SKIN_L.x1), r: collect(SKIN_R.x0, SKIN_R.x1) };
}

/** Local skin estimate at x by lerping the row's cheek references. */
function localSkin(
  l: [number, number, number],
  r: [number, number, number],
  x: number,
): [number, number, number] {
  const t = Math.max(0, Math.min(1, (x - 180) / (844 - 180)));
  return [l[0] + (r[0] - l[0]) * t, l[1] + (r[1] - l[1]) * t, l[2] + (r[2] - l[2]) * t];
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Calibrate thresholds from the rest-pose (sil) stills of the same render.
 * Throws on wrong canvas size so a reframed render refuses by measurement.
 */
export function calibratePixelLipThresholds(restFront: RgbImage, rest34: RgbImage): PixelLipThresholds {
  for (const [name, img] of [["restFront", restFront], ["rest34", rest34]] as const) {
    if (img.w !== 1024 || img.h !== 1024) throw new Error(`pixel-lip-canvas:${name}:${img.w}x${img.h}`);
    if (img.rgb.length < img.w * img.h * 3) throw new Error(`pixel-lip-short:${name}`);
  }
  const skinL = patchMeans(restFront, 60, 160, 350, 450);
  const skinR = patchMeans(restFront, 860, 960, 350, 450);
  const apMeans: number[] = [];
  for (let y = 440; y < 480; y += 2) {
    for (let x = 430; x < 590; x += 2) {
      const [r, g, b] = pxAt(restFront, x, y);
      apMeans.push((r + g + b) / 3);
    }
  }
  const apertureMean = mean(apMeans);
  const apertureSd = sd(apMeans, apertureMean);
  // Lip-patch redness excess over per-pixel local skin on the rest still.
  const redxs: number[] = [];
  for (let y = 540; y < 640; y += 3) {
    const refs = rowSkinRefs(restFront, y);
    for (let x = 430; x < 590; x += 3) {
      const [r, g, b] = pxAt(restFront, x, y);
      const s = localSkin(refs.l, refs.r, x);
      redxs.push(r - g - (s[0] - s[1]));
    }
  }
  const lipRedxsMedian = median(redxs);
  // 3/4 background level: dark cluster of top/left samples on the rest still.
  const bgSamples: number[] = [];
  for (let y = 0; y < 120; y += 6) {
    for (const x of [10, 30, 50, 70, 90, 110]) {
      const [r, g, b] = pxAt(rest34, x, y);
      bgSamples.push((r + g + b) / 3);
    }
  }
  for (let y = 300; y < 700; y += 10) {
    for (const x of [5, 15, 25, 35]) {
      const [r, g, b] = pxAt(rest34, x, y);
      bgSamples.push((r + g + b) / 3);
    }
  }
  const darkCluster = bgSamples.filter((m) => m < 80);
  if (darkCluster.length === 0) throw new Error("pixel-lip-nobg34");
  const bg34Median = median(darkCluster);
  const darkT = Math.round(clamp(apertureMean + 1.5 * apertureSd, 40, 60));
  const redT = Math.round(clamp(lipRedxsMedian / 2, 6, 12));
  return {
    schemaVersion: "openclinxr.pixel-lip-measure.v1",
    darkT,
    redT,
    gumT: redT * 2 + 6,
    bgT34: Math.round(clamp(bg34Median + 25, 45, 70)),
    restStats: { skinL, skinR, apertureMean, apertureSd, lipRedxsMedian, bg34Median },
  };
}

export function isToothPixel(r: number, g: number, b: number): boolean {
  const m = (r + g + b) / 3;
  return m > 148 && Math.abs(r - g) < 16 && Math.abs(g - b) < 16 && r > 140 && r < 220;
}

export type PixelLipFront = {
  outerWidthPx: number;
  outerY: number;
  apertureWidthPx: number;
  apertureY: number;
  apertureHeightPx: number;
  hwRatio: number;
};

type RowMasks = { mouth: boolean[]; apert: boolean[] };

function classifyRow(
  img: RgbImage,
  y: number,
  t: PixelLipThresholds,
): RowMasks {
  const refs = rowSkinRefs(img, y);
  const mouth: boolean[] = [];
  const apert: boolean[] = [];
  for (let x = FRONT_BAND.x0; x <= FRONT_BAND.x1; x += 1) {
    const [r, g, b] = pxAt(img, x, y);
    const m = (r + g + b) / 3;
    const s = localSkin(refs.l, refs.r, x);
    const redxs = r - g - (s[0] - s[1]);
    const tooth = isToothPixel(r, g, b);
    const dark = m < t.darkT;
    const verm = !tooth && !dark && redxs > t.redT;
    const gum = !tooth && !dark && redxs > t.gumT;
    mouth.push(dark || tooth || verm);
    apert.push(dark || tooth || gum);
  }
  return { mouth, apert };
}

/** Longest true-run containing the mouth centre column (x 512). */
function centerRun(row: boolean[]): { width: number; x0: number; x1: number } {
  const cx = 512 - FRONT_BAND.x0;
  if (!row[cx]) return { width: 0, x0: 0, x1: 0 };
  let a = cx;
  while (a > 0 && row[a - 1]) a -= 1;
  let b = cx;
  while (b < row.length - 1 && row[b + 1]) b += 1;
  return { width: b - a + 1, x0: a + FRONT_BAND.x0, x1: b + FRONT_BAND.x0 };
}

/** Front-still mouth measurement: outer lip width + aperture w/h. */
export function measurePixelLipFront(still: RgbImage, t: PixelLipThresholds): PixelLipFront {
  if (still.w !== 1024 || still.h !== 1024) throw new Error(`pixel-lip-canvas:front:${still.w}x${still.h}`);
  const rows = new Map<number, RowMasks>();
  for (let y = FRONT_BAND.y0; y <= FRONT_BAND.y1; y += 1) rows.set(y, classifyRow(still, y, t));
  let outer = { width: 0, y: 0 };
  let ap = { width: 0, y: 0 };
  for (const [y, masks] of rows) {
    const o = centerRun(masks.mouth).width;
    if (o > outer.width) outer = { width: o, y };
    const w = centerRun(masks.apert).width;
    if (w > ap.width) ap = { width: w, y };
  }
  let apertureHeightPx = 0;
  for (let x = APERTURE_COLS.x0; x <= APERTURE_COLS.x1; x += APERTURE_COLS.step) {
    let cur = 0;
    let best = 0;
    for (let y = FRONT_BAND.y0; y <= FRONT_BAND.y1; y += 1) {
      if (rows.get(y)?.apert[x - FRONT_BAND.x0]) {
        cur += 1;
        best = Math.max(best, cur);
      } else cur = 0;
    }
    apertureHeightPx = Math.max(apertureHeightPx, best);
  }
  return {
    outerWidthPx: outer.width,
    outerY: outer.y,
    apertureWidthPx: ap.width,
    apertureY: ap.y,
    apertureHeightPx,
    hwRatio: ap.width > 0 ? Math.round((apertureHeightPx / ap.width) * 1000) / 1000 : 0,
  };
}

export type PixelLipForward = {
  lipX: number;
  lipY: number;
  anchorX: number;
  forwardPx: number;
};

function firstEdgeX(img: RgbImage, y: number, bgT: number): number | null {
  for (let x = PROFILE34.x0; x < PROFILE34.x1; x += 1) {
    const [r, g, b] = pxAt(img, x, y);
    if ((r + g + b) / 3 > bgT) return x;
  }
  return null;
}

/**
 * 3/4-still lip forward: foremost lip-silhouette x vs the rigid forehead
 * anchor (min over band rows; forehead redness/silhouette is viseme-stable
 * to ~2px). Positive forwardPx shift vs E = lips moved toward the camera.
 */
export function measurePixelLipForward(still34: RgbImage, t: PixelLipThresholds): PixelLipForward {
  if (still34.w !== 1024 || still34.h !== 1024) throw new Error(`pixel-lip-canvas:34:${still34.w}x${still34.h}`);
  let lipX = Infinity;
  let lipY = 0;
  for (let y = PROFILE34.lipY0; y <= PROFILE34.lipY1; y += PROFILE34.step) {
    const x = firstEdgeX(still34, y, t.bgT34);
    if (x !== null && x < lipX) {
      lipX = x;
      lipY = y;
    }
  }
  let anchorX = Infinity;
  for (let y = PROFILE34.anchorY0; y <= PROFILE34.anchorY1; y += PROFILE34.step) {
    const x = firstEdgeX(still34, y, t.bgT34);
    if (x !== null && x < anchorX) anchorX = x;
  }
  if (!Number.isFinite(lipX) || !Number.isFinite(anchorX)) throw new Error("pixel-lip-no-silhouette");
  return { lipX, lipY, anchorX, forwardPx: anchorX - lipX };
}

/**
 * Philtrum-lump proxy, front view: mean luminance over the philtrum band.
 * Compare same-viseme before/after a bone change (probe base row vs table
 * row): a forward-bulging philtrum casts a shadow band, so the lump reads
 * as a bone-driven luminance drop. Not compared vs E (pose shadow position
 * differs by viseme: E phil 91.7 vs sil 124.4 on the same render).
 */
export function measurePhiltrumBand(still: RgbImage): number {
  if (still.w !== 1024 || still.h !== 1024) throw new Error(`pixel-lip-canvas:front:${still.w}x${still.h}`);
  let sum = 0;
  let n = 0;
  for (let y = PHILTRUM_BAND.y0; y <= PHILTRUM_BAND.y1; y += 2) {
    for (let x = PHILTRUM_BAND.x0; x <= PHILTRUM_BAND.x1; x += 2) {
      const [r, g, b] = pxAt(still, x, y);
      sum += (r + g + b) / 3;
      n += 1;
    }
  }
  return Math.round((sum / n) * 10) / 10;
}

/**
 * Philtrum-lump proxy, 3/4 view: mean silhouette x over philtrum-height
 * rows. A midline bulge pushes these rows forward (smaller x) while the
 * lip-height rows stay put; report alongside lipX so the push location is
 * visible (upper push vs vermilion push).
 */
export function measurePhiltrumSilhouette(still34: RgbImage, t: PixelLipThresholds): number {
  if (still34.w !== 1024 || still34.h !== 1024) throw new Error(`pixel-lip-canvas:34:${still34.w}x${still34.h}`);
  let sum = 0;
  let n = 0;
  for (let y = PHILTRUM34.y0; y <= PHILTRUM34.y1; y += PHILTRUM34.step) {
    const x = firstEdgeX(still34, y, t.bgT34);
    if (x === null) throw new Error("pixel-lip-no-silhouette");
    sum += x;
    n += 1;
  }
  return Math.round((sum / n) * 10) / 10;
}

/**
 * Destructive probe op: squeeze the mouth band horizontally by `factor`
 * about x 512 (bilinear), edge-extending the flanks so the canvas keeps
 * its size. A truthful width ruler must report ~factor on the result.
 */
export function squeezeMouthBand(img: RgbImage, factor: number): RgbImage {
  const { x0, y0 } = { x0: FRONT_BAND.x0, y0: FRONT_BAND.y0 };
  const bw = FRONT_BAND.x1 - FRONT_BAND.x0 + 1;
  const bh = FRONT_BAND.y1 - FRONT_BAND.y0 + 1;
  const cx = 512 - x0;
  const out = new Uint8Array(img.rgb);
  const sample = (fx: number, y: number): [number, number, number] => {
    const x = clamp(fx, 0, bw - 1);
    const i0 = Math.floor(x);
    const i1 = Math.min(bw - 1, i0 + 1);
    const f = x - i0;
    const [r0, g0, b0] = pxAt(img, x0 + i0, y);
    const [r1, g1, b1] = pxAt(img, x0 + i1, y);
    return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
  };
  for (let y = y0; y < y0 + bh; y += 1) {
    for (let i = 0; i < bw; i += 1) {
      const src = cx + (i - cx) / factor;
      const [r, g, b] = sample(src, y);
      const p = (y * img.w + (x0 + i)) * 3;
      out[p] = Math.round(r);
      out[p + 1] = Math.round(g);
      out[p + 2] = Math.round(b);
    }
  }
  return { rgb: out, w: img.w, h: img.h };
}
