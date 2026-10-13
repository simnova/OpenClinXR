/**
 * Replayable reference-set record: resolve frozen picks by sha, refuse
 * anything else. Pure node (fs/path/crypto/zlib only). This module starts
 * no subprocess and never touches the network; the replay path is
 * file reads plus sha256 only.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import { inflateSync } from "node:zlib";
import path from "node:path";

export const SCHEMA_VERSION = 1;
export const KINDS = ["goal_front", "goal_yaw", "face_tile",
  "scalp_island", "eye_texture", "brow_band"] as const;
export type Kind = (typeof KINDS)[number];

/** Relative |out-ref|/ref on w/h: accepted picks drift 0.7-2.1%. */
export const ASPECT_TOLERANCE = 0.03;
/** Grayscale std below this is a placeholder/solid fill, never texture. */
export const FLAT_STD_MIN = 2.0;
export const MIN_DIM = 8;

/** sRGB triples from the repo factory (S/skins/pick.py:12). */
export const TONE_TOKENS: Record<string, [number, number, number]> = {
  warm_light: [0.78, 0.62, 0.52],
  warm_medium: [0.66, 0.5, 0.4],
};
export const FACECORE_BOX = { x0: 0.35, y0: 0.32, x1: 0.65, y1: 0.6 };
/** dLab bar from the accepted Aisha goal-front (see toneFlagSource). */
export const TONE_FLAG_THRESHOLD = 10.7;
export const TONE_FLAG_SOURCE =
  "dLab 10.63 = accepted Aisha goal-front face-core box mean Lab vs " +
  "warm_light token Lab (D65 sRGB, S/skins/pick.py:12); bar 10.7";

export type ReferenceEntry = {
  prompt: string;
  generator: string;
  created: string;
  reference_input: {
    store_relpath: string | null; sha256: string | null;
    size: [number, number] | null; note: string | null;
  };
  output: { store_relpath: string; sha256: string; size: [number, number] };
  lock: unknown;
  acceptance: { grader: string; verdict: string; source: string };
  tone?: ToneReport;
  rejected: Array<Record<string, unknown>>;
};

export type Manifest = {
  version: number;
  tone_flag: { threshold_dLab: number; source: string };
  cases: Record<string, {
    phenotype_tone?: string; references: Record<string, ReferenceEntry>;
  }>;
};

export type ToneReport = {
  phenotype_tone: string; goal_facecore_lab: [number, number, number];
  token_lab: [number, number, number]; distance_dLab: number;
  threshold_dLab: number; threshold_source: string; flagged: boolean;
};

export function loadManifest(manifestPath: string): Manifest {
  let parsed: Manifest;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  } catch {
    throw new Error(`REFUSE_SCHEMA ${manifestPath} unreadable: refuse`);
  }
  if (parsed.version !== SCHEMA_VERSION || !parsed.cases) {
    throw new Error(`REFUSE_SCHEMA ${manifestPath} version drift: refuse`);
  }
  return parsed;
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function shaEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Resolve one entry to an absolute path; refuse missing/mismatch. */
export function resolveEntry(storeRoot: string, caseId: string,
  kind: string, entry: ReferenceEntry): string {
  const rel = entry.output?.store_relpath;
  const want = entry.output?.sha256;
  if (!rel || !want) {
    throw new Error(`REFUSE_MISSING case ${caseId} kind ${kind}: no ` +
      `stored output record: refuse (no placeholder)`);
  }
  const abs = path.join(storeRoot, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`REFUSE_MISSING case ${caseId} kind ${kind}: ` +
      `${rel} absent under store root: refuse (no placeholder)`);
  }
  const actual = sha256File(abs);
  if (!shaEqual(actual, want)) {
    throw new Error(`REFUSE_SHA_MISMATCH case ${caseId} kind ${kind}: ` +
      `${rel} sha ${actual.slice(0, 16)} != expected ` +
      `${want.slice(0, 16)}: refuse`);
  }
  return abs;
}

/** Replay a case: kind -> absolute path. Refuses, never synthesizes. */
export function replayCase(manifest: Manifest, caseId: string,
  storeRoot: string): Record<string, string> {
  const c = manifest.cases[caseId];
  if (!c) {
    throw new Error(`REFUSE_MISSING case ${caseId}: no record: ` +
      `refuse (no placeholder)`);
  }
  const out: Record<string, string> = {};
  for (const [kind, entry] of Object.entries(c.references)) {
    out[kind] = resolveEntry(storeRoot, caseId, kind, entry);
  }
  return out;
}

/** Minimal PNG IHDR reader (store files and fixtures are PNG). */
export function readPngDims(pngPath: string): { width: number; height: number } {
  const buf = fs.readFileSync(pngPath);
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`REFUSE_NOT_IMAGE ${path.basename(pngPath)} ` +
      `is not a PNG: refuse`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Coarse flatness: std of decompressed pixel bytes (filter bytes out). */
export function idatStd(pngPath: string): number {
  const buf = fs.readFileSync(pngPath);
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`REFUSE_NOT_IMAGE ${path.basename(pngPath)} ` +
      `is not a PNG: refuse`);
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24] ?? 0;
  const colorType = buf[25] ?? 0;
  if (bitDepth !== 8 || ![0, 2, 4, 6].includes(colorType)) {
    throw new Error(`REFUSE_NOT_IMAGE ${path.basename(pngPath)} ` +
      `unsupported PNG flavor (need 8-bit gray/truecolor): refuse`);
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType] ?? 0;
  if (!bpp) {
    throw new Error(`REFUSE_NOT_IMAGE ${path.basename(pngPath)} ` +
      `unsupported PNG flavor (need 8-bit gray/truecolor): refuse`);
  }
  const chunks: Buffer[] = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") chunks.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  if (!chunks.length) {
    throw new Error(`REFUSE_NOT_IMAGE ${path.basename(pngPath)} ` +
      `has no pixel data: refuse`);
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * bpp + 1;
  // Full PNG unfilter: raw scanline bytes are filter-polluted (a solid
  // fill encodes as filter tags plus zeros/deltas), so reconstruct
  // pixels first; flatness is measured on pixels, not code bytes.
  const px = Buffer.alloc(width * height * bpp);
  const prev = Buffer.alloc(width * bpp);
  let prow = 0;
  for (let rowOff = 0; rowOff + stride <= raw.length; rowOff += stride, prow++) {
    const tag = raw[rowOff] ?? 0;
    const cur = Buffer.alloc(width * bpp);
    for (let i = 0; i < width * bpp; i++) {
      const v = raw[rowOff + 1 + i] ?? 0;
      const a = i >= bpp ? (cur[i - bpp] ?? 0) : 0;
      const b = prev[i] ?? 0;
      const c = i >= bpp ? (prev[i - bpp] ?? 0) : 0;
      let r: number;
      if (tag === 0) r = v;
      else if (tag === 1) r = v + a;
      else if (tag === 2) r = v + b;
      else if (tag === 3) r = v + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[i] = r & 0xff;
    }
    cur.copy(px, prow * width * bpp);
    cur.copy(prev);
  }
  const vals: number[] = Array.from(px);
  if (!vals.length) {
    throw new Error(`REFUSE_NOT_IMAGE ${path.basename(pngPath)} ` +
      `has no pixel data: refuse`);
  }
  const n = vals.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += vals[i] ?? 0;
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += ((vals[i] ?? 0) - mean) ** 2;
  return Math.sqrt(v / n);
}

export function aspectOk(refW: number, refH: number,
  outW: number, outH: number): boolean {
  const drift = Math.abs(outW / outH - refW / refH) / (refW / refH);
  return drift <= ASPECT_TOLERANCE;
}

/**
 * Validate a candidate output against its reference input before record.
 * Throws REFUSE_FLAT / REFUSE_ASPECT / REFUSE_NOT_IMAGE.
 */
export function validateNewImage(refPath: string | null,
  outPath: string): { width: number; height: number } {
  const { width, height } = readPngDims(outPath);
  if (width < MIN_DIM || height < MIN_DIM) {
    throw new Error(`REFUSE_NOT_IMAGE ${path.basename(outPath)} ` +
      `is ${width}x${height} (min ${MIN_DIM}): refuse`);
  }
  const std = idatStd(outPath);
  if (std < FLAT_STD_MIN) {
    throw new Error(`REFUSE_FLAT ${path.basename(outPath)} scanline ` +
      `std ${std.toFixed(2)} < ${FLAT_STD_MIN} (placeholder/flat ` +
      `fill): refuse`);
  }
  if (refPath) {
    const ref = readPngDims(refPath);
    if (!aspectOk(ref.width, ref.height, width, height)) {
      const drift = Math.abs(width / height - ref.width / ref.height) /
        (ref.width / ref.height);
      throw new Error(`REFUSE_ASPECT ${path.basename(outPath)} ` +
        `${width}x${height} vs reference ${path.basename(refPath)} ` +
        `${ref.width}x${ref.height} (rel aspect drift ` +
        `${drift.toFixed(3)} > ${ASPECT_TOLERANCE}): refuse`);
    }
  }
  return { width, height };
}

function srgbToLab01(r: number, g: number, b: number): [number, number, number] {
  const f = (c: number): number => c <= 0.04045 ? c / 12.92
    : ((c + 0.055) / 1.055) ** 2.4;
  const R = f(r), G = f(g), B = f(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
  const Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
  const t = (v: number): number => v > 0.008856 ? Math.cbrt(v)
    : (903.3 * v + 16) / 116;
  const fx = t(X), fy = t(Y), fz = t(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Flag bar check on Lab means (pure math; image sampling lives in py). */
export function toneFlag(toneName: string,
  goalLab: [number, number, number]): ToneReport {
  const tok = TONE_TOKENS[toneName];
  if (!tok) throw new Error(`REFUSE_SCHEMA unknown tone ${toneName}: refuse`);
  const tokenLab = srgbToLab01(tok[0], tok[1], tok[2]);
  const d = Math.sqrt(goalLab.reduce((s, v, i) => {
    const t = tokenLab[i] ?? 0;
    return s + (v - t) ** 2;
  }, 0));
  const dist = Math.round(d * 100) / 100;
  const lab0 = tokenLab[0] ?? 0;
  const lab1 = tokenLab[1] ?? 0;
  const lab2 = tokenLab[2] ?? 0;
  return {
    phenotype_tone: toneName,
    goal_facecore_lab: goalLab, token_lab: [
      Math.round(lab0 * 100) / 100,
      Math.round(lab1 * 100) / 100,
      Math.round(lab2 * 100) / 100],
    distance_dLab: dist, threshold_dLab: TONE_FLAG_THRESHOLD,
    threshold_source: TONE_FLAG_SOURCE, flagged: dist > TONE_FLAG_THRESHOLD,
  };
}
