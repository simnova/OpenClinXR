/**
 * Vitruvian ORIGINAL-vs-NEW high-resolution comparison instrument.
 *
 * Renders immutable bytes from git and candidate bytes through the product
 * isolated-subject three.js lab. Every sheet is a native 1:1 concatenation;
 * cheek/face close-ups are native crops from larger drawing buffers (never
 * resized). The live page supplies camera, renderer, exposure, and light
 * readback. This tool edits no GLB, shader, material, or lighting rig.
 *
 * Example:
 *   pnpm tsx tools/openclinxr/evidence/skin-realism/vitruvian-compare.ts \
 *     --actor mpfb-ob-patient-aisha --new /path/to/generated-humanoids \
 *     --orig-ref origin/main --out .openclinxr/openclaw/ceo/st-vitcompare/run-eyes
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";
import { chromium, type Page } from "../lib/slotted-playwright.js";
import {
  captureOne,
  decodePng,
  encodePngRgb,
  type LabEvidence,
  sha256File,
} from "./runtime-portrait-capture.js";

type HeadlessBrowser = {
  newPage(options?: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<Page>;
};

type Cli = {
  actors: string[];
  newPath: string;
  origRef: string;
  outDir: string;
  size: number;
  noiseFloorManifest?: string;
};

type Point = { x: number; y: number };
type Rect = { x0: number; y0: number; x1: number; y1: number };
type Mask =
  | { kind: "rects"; rects: Rect[] }
  | { kind: "discs"; discs: Array<{ cx: number; cy: number; r0: number; r1: number }> };

type LiveReadback = {
  renderer: {
    threeRevision: unknown;
    toneMapping: unknown;
    toneMappingExposure: unknown;
    outputColorSpace: unknown;
  };
  lights: unknown;
  productRig: unknown;
  portrait: {
    fovDeg: number;
    fillTarget: number;
    distanceM: number;
    headHeightPx: number;
    headBoxPx: Rect;
    yawDegrees: number;
  } | null;
};

type CaptureEvidence = LabEvidence & {
  frameSpanFraction?: number | null;
  focusRegion?: {
    kind?: string;
    boundsMeters?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  } | null;
  packFraming?: unknown;
};

type Captured = {
  imagePath: string;
  evidence: CaptureEvidence;
  readback: LiveReadback;
  captureSize: number;
};

type RegionStats = {
  pixelCount: number;
  meanSrgb: [number, number, number];
  meanCielabD65: [number, number, number];
  luminanceSd: number;
  highPassEnergySigma2: number;
};

const TOOL_REL = "tools/openclinxr/evidence/skin-realism/vitruvian-compare.ts";
const PUBLIC_GLBS = "apps/ui-xr/public/generated-humanoids";
const RUNTIME_RIG_ID = "ob_triage_room_v1";
const RUNTIME_RIG_REL = `apps/ui-xr/public/xr-assets/lighting/${RUNTIME_RIG_ID}.rig.json`;
const STUDIO_RIG_ID = "vitruvian_studio_key_fill_rim_v1";
const IRIS_DIAMETER_M = 0.012;
const HEAD_FILL_MIN = 0.8;
const IRIS_DIAMETER_MIN_PX = 150;
const CHEEK_PX_PER_MM_MIN = 8;

// Named, stable use of the existing --studio-sheet key/fill/rim mechanism.
// Values are deliberately fixed; G3 reports calibration instead of tuning it.
const STUDIO_RIG = {
  keyAzimuthDeg: 35,
  keyElevationDeg: 35,
  keyIntensity: 2,
  fillIntensity: 0.5,
  hemisphereIntensity: 0.55,
  rimIntensity: 0.5,
  exposure: 1,
  environmentIntensity: 0.3,
} as const;

const LIGHTING = [
  {
    id: "studio",
    rigId: STUDIO_RIG_ID,
    spec: { rigOverride: { studio: STUDIO_RIG, removeDefaultLights: true }, eyeRuntimeShading: false },
  },
  {
    id: "runtime",
    rigId: RUNTIME_RIG_ID,
    // The learner app never applies the lab eye shader, and it refuses the
    // 96-vertex low-poly eyes every shipped actor carries; keep it off here too.
    spec: { productEnvironmentId: RUNTIME_RIG_ID, eyeRuntimeShading: false },
  },
] as const;

function parseCli(argv: string[]): Cli {
  const actors: string[] = [];
  let newPath = "";
  let origRef = "origin/main";
  let outDir = "";
  let size = 2048;
  let noiseFloorManifest: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const take = (): string => {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === "--actor") actors.push(take());
    else if (arg === "--new") newPath = take();
    else if (arg === "--orig-ref") origRef = take();
    else if (arg === "--out") outDir = take();
    else if (arg === "--size") size = Number(take());
    else if (arg === "--noise-floor") noiseFloorManifest = take();
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!actors.length) throw new Error("at least one --actor <id> is required");
  if (!newPath) throw new Error("--new <glb path or directory> is required");
  if (!outDir) throw new Error("--out <directory> is required");
  if (!Number.isInteger(size) || size < 512 || size > 2048) {
    throw new Error("--size must be an integer in 512..2048 (cheek source is rendered at min(4096, 2.4x); 4096 gives ~13.6 px/mm)");
  }
  for (const actor of actors) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(actor)) throw new Error(`unsafe actor id: ${actor}`);
  }
  return { actors: [...new Set(actors)], newPath, origRef, outDir, size, ...(noiseFloorManifest ? { noiseFloorManifest } : {}) };
}

function inside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function quoteArg(value: string): string {
  return /^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

function exactCommand(cwd: string): string {
  return ["pnpm", "tsx", TOOL_REL, ...process.argv.slice(2)]
    .map((v, i) => (i < 3 ? v : quoteArg(path.isAbsolute(v) && inside(cwd, v) ? path.relative(cwd, v) : v)))
    .join(" ");
}

async function gitShow(ref: string, repoPath: string): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const proc = spawn("git", ["show", `${ref}:${repoPath}`], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    proc.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`git show ${ref}:${repoPath} failed (${code ?? "signal"}): ${Buffer.concat(stderr).toString("utf8")}`));
    });
  });
}

async function findActorGlb(root: string, actor: string): Promise<string> {
  const wanted = `${actor}.glb`;
  if (!existsSync(root)) throw new Error(`--new path does not exist: ${root}`);
  const direct = path.resolve(root);
  const directStat = await import("node:fs/promises").then((fs) => fs.stat(direct));
  if (directStat.isFile()) {
    if (path.basename(direct) !== wanted) throw new Error(`--new file ${direct} does not match actor ${actor}`);
    return direct;
  }
  const queue = [direct];
  const matches: string[] = [];
  while (queue.length) {
    const dir = queue.shift()!;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) queue.push(abs);
      else if (entry.isFile() && entry.name === wanted) matches.push(abs);
    }
  }
  if (matches.length !== 1) throw new Error(`expected exactly one ${wanted} under ${direct}; found ${matches.length}`);
  return matches[0]!;
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function stageInputs(cwd: string, cli: Cli): Promise<Array<{
  actor: string;
  repoPath: string;
  original: { abs: string; sha256: string; source: string; servedUrl: string };
  candidate: { abs: string; sha256: string; source: string; servedUrl: string };
}>> {
  const scratch = path.join(cwd, ".openclinxr-local", "vitruvian-compare", `${Date.now()}-${process.pid}`);
  await mkdir(scratch, { recursive: true });
  const staged = [];
  for (const actor of cli.actors) {
    const repoPath = `${PUBLIC_GLBS}/${actor}.glb`;
    const actorDir = path.join(scratch, actor);
    await mkdir(actorDir, { recursive: true });
    const origAbs = path.join(actorDir, "original.glb");
    const newAbs = path.join(actorDir, "new.glb");
    const originalBytes = await gitShow(cli.origRef, repoPath);
    await writeFile(origAbs, originalBytes);
    const candidateSource = await findActorGlb(path.resolve(cwd, cli.newPath), actor);
    await copyFile(candidateSource, newAbs);
    staged.push({
      actor,
      repoPath,
      original: {
        abs: origAbs,
        sha256: sha256Bytes(originalBytes),
        source: `git show ${cli.origRef}:${repoPath}`,
        servedUrl: `/__vitcompare/${actor}/original.glb`,
      },
      candidate: {
        abs: newAbs,
        sha256: sha256File(newAbs),
        source: candidateSource,
        servedUrl: `/__vitcompare/${actor}/new.glb`,
      },
    });
  }
  return staged;
}

function clampRect(rect: Rect, w: number, h: number): Rect {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(rect.x0)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(rect.y0)));
  const x1 = Math.max(x0 + 1, Math.min(w, Math.ceil(rect.x1)));
  const y1 = Math.max(y0 + 1, Math.min(h, Math.ceil(rect.y1)));
  return { x0, y0, x1, y1 };
}

async function writeNativeCrop(inputPath: string, outPath: string, rect: Rect): Promise<Rect> {
  const png = decodePng(inputPath);
  const r = clampRect(rect, png.w, png.h);
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const si = ((r.y0 + y) * png.w + r.x0 + x) * png.chans;
      const di = (y * w + x) * 3;
      rgb[di] = png.data[si]!;
      rgb[di + 1] = png.data[si + 1] ?? png.data[si]!;
      rgb[di + 2] = png.data[si + 2] ?? png.data[si]!;
    }
  }
  await writeFile(outPath, encodePngRgb(w, h, rgb));
  return r;
}

async function copyPngRgb(inputPath: string, outPath: string): Promise<void> {
  const png = decodePng(inputPath);
  await writeNativeCrop(inputPath, outPath, { x0: 0, y0: 0, x1: png.w, y1: png.h });
}

async function writeSideBySide(origPath: string, newPath: string, outPath: string): Promise<void> {
  const a = decodePng(origPath);
  const b = decodePng(newPath);
  if (a.w !== b.w || a.h !== b.h) throw new Error("side-by-side inputs differ in dimensions");
  const rgb = new Uint8Array(a.w * 2 * a.h * 3);
  for (let y = 0; y < a.h; y += 1) {
    for (let x = 0; x < a.w; x += 1) {
      for (const [png, ox] of [[a, 0], [b, a.w]] as const) {
        const si = (y * png.w + x) * png.chans;
        const di = (y * (a.w * 2) + ox + x) * 3;
        rgb[di] = png.data[si]!;
        rgb[di + 1] = png.data[si + 1] ?? png.data[si]!;
        rgb[di + 2] = png.data[si + 2] ?? png.data[si]!;
      }
    }
  }
  await writeFile(outPath, encodePngRgb(a.w * 2, a.h, rgb));
}

async function writeDiffHeatmap(origPath: string, newPath: string, outPath: string): Promise<{ maxChannelDifference: number; changedPixels: number; pixelIdentical: boolean }> {
  const a = decodePng(origPath);
  const b = decodePng(newPath);
  if (a.w !== b.w || a.h !== b.h) throw new Error("diff inputs differ in dimensions");
  const rgb = new Uint8Array(a.w * a.h * 3);
  let max = 0;
  let changedPixels = 0;
  for (let p = 0; p < a.w * a.h; p += 1) {
    const ai = p * a.chans;
    const bi = p * b.chans;
    const dr = Math.abs(a.data[ai]! - b.data[bi]!);
    const dg = Math.abs((a.data[ai + 1] ?? a.data[ai]!) - (b.data[bi + 1] ?? b.data[bi]!));
    const db = Math.abs((a.data[ai + 2] ?? a.data[ai]!) - (b.data[bi + 2] ?? b.data[bi]!));
    const d = Math.max(dr, dg, db);
    if (d > 0) changedPixels += 1;
    max = Math.max(max, d);
    const t = d / 255;
    rgb[p * 3] = Math.round(255 * Math.min(1, t * 4));
    rgb[p * 3 + 1] = Math.round(255 * Math.max(0, Math.min(1, t * 4 - 1)));
    rgb[p * 3 + 2] = Math.round(255 * Math.max(0, Math.min(1, t * 4 - 2)));
  }
  await writeFile(outPath, encodePngRgb(a.w, a.h, rgb));
  return { maxChannelDifference: max, changedPixels, pixelIdentical: changedPixels === 0 };
}

function maskBounds(mask: Mask, w: number, h: number): Rect {
  if (mask.kind === "rects") {
    return clampRect({
      x0: Math.min(...mask.rects.map((r) => r.x0)),
      y0: Math.min(...mask.rects.map((r) => r.y0)),
      x1: Math.max(...mask.rects.map((r) => r.x1)),
      y1: Math.max(...mask.rects.map((r) => r.y1)),
    }, w, h);
  }
  return clampRect({
    x0: Math.min(...mask.discs.map((d) => d.cx - d.r1)),
    y0: Math.min(...mask.discs.map((d) => d.cy - d.r1)),
    x1: Math.max(...mask.discs.map((d) => d.cx + d.r1)),
    y1: Math.max(...mask.discs.map((d) => d.cy + d.r1)),
  }, w, h);
}

function maskHas(mask: Mask, x: number, y: number): boolean {
  if (mask.kind === "rects") return mask.rects.some((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1);
  return mask.discs.some((d) => {
    const r = Math.hypot(x - d.cx, y - d.cy);
    return r >= d.r0 && r < d.r1;
  });
}

function srgbToLab(rgb: [number, number, number]): [number, number, number] {
  const linear = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const x = (0.4124564 * linear[0] + 0.3575761 * linear[1] + 0.1804375 * linear[2]) / 0.95047;
  const y = 0.2126729 * linear[0] + 0.7151522 * linear[1] + 0.072175 * linear[2];
  const z = (0.0193339 * linear[0] + 0.119192 * linear[1] + 0.9503041 * linear[2]) / 1.08883;
  const f = (v: number): number => v > 216 / 24389 ? Math.cbrt(v) : (24389 / 27 * v + 16) / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function gaussianKernel(sigma: number): Float64Array {
  const radius = Math.ceil(3 * sigma);
  const out = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    out[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < out.length; i += 1) out[i] = out[i]! / sum;
  return out;
}

function regionStats(pngPath: string, mask: Mask): RegionStats {
  const png = decodePng(pngPath);
  const bounds = maskBounds(mask, png.w, png.h);
  const kernel = gaussianKernel(2);
  const radius = (kernel.length - 1) / 2;
  const expanded = clampRect({ x0: bounds.x0 - radius, y0: bounds.y0 - radius, x1: bounds.x1 + radius, y1: bounds.y1 + radius }, png.w, png.h);
  const ew = expanded.x1 - expanded.x0;
  const eh = expanded.y1 - expanded.y0;
  const lum = new Float32Array(ew * eh);
  const tmp = new Float32Array(ew * eh);
  const blur = new Float32Array(ew * eh);
  for (let y = 0; y < eh; y += 1) {
    for (let x = 0; x < ew; x += 1) {
      const i = ((expanded.y0 + y) * png.w + expanded.x0 + x) * png.chans;
      const r = png.data[i]!, g = png.data[i + 1] ?? r, b = png.data[i + 2] ?? r;
      lum[y * ew + x] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
  }
  for (let y = 0; y < eh; y += 1) {
    for (let x = 0; x < ew; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += lum[y * ew + Math.max(0, Math.min(ew - 1, x + k))]! * kernel[k + radius]!;
      tmp[y * ew + x] = sum;
    }
  }
  for (let y = 0; y < eh; y += 1) {
    for (let x = 0; x < ew; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += tmp[Math.max(0, Math.min(eh - 1, y + k)) * ew + x]! * kernel[k + radius]!;
      blur[y * ew + x] = sum;
    }
  }
  let n = 0, sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0, shp = 0, shp2 = 0;
  for (let y = bounds.y0; y < bounds.y1; y += 1) {
    for (let x = bounds.x0; x < bounds.x1; x += 1) {
      if (!maskHas(mask, x, y)) continue;
      const i = (y * png.w + x) * png.chans;
      const r = png.data[i]!, g = png.data[i + 1] ?? r, b = png.data[i + 2] ?? r;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const hp = l - blur[(y - expanded.y0) * ew + x - expanded.x0]!;
      n += 1; sr += r; sg += g; sb += b; sl += l; sl2 += l * l; shp += hp; shp2 += hp * hp;
    }
  }
  if (!n) throw new Error("empty metric mask");
  const meanRgb: [number, number, number] = [sr / n, sg / n, sb / n];
  const meanLum = sl / n;
  const meanHp = shp / n;
  return {
    pixelCount: n,
    meanSrgb: meanRgb.map((v) => Math.round(v * 1000) / 1000) as [number, number, number],
    meanCielabD65: srgbToLab(meanRgb).map((v) => Math.round(v * 1000) / 1000) as [number, number, number],
    luminanceSd: Math.round(Math.sqrt(Math.max(0, sl2 / n - meanLum * meanLum)) * 1000) / 1000,
    highPassEnergySigma2: Math.round(Math.max(0, shp2 / n - meanHp * meanHp) * 1_000_000) / 1_000_000,
  };
}

function deltaE76(a: RegionStats, b: RegionStats): number {
  return Math.sqrt(a.meanCielabD65.reduce((sum, v, i) => sum + (v - b.meanCielabD65[i]!) ** 2, 0));
}

function rectFromHead(head: Rect, x0: number, y0: number, x1: number, y1: number): Rect {
  const w = head.x1 - head.x0;
  const h = head.y1 - head.y0;
  return { x0: head.x0 + x0 * w, y0: head.y0 + y0 * h, x1: head.x0 + x1 * w, y1: head.y0 + y1 * h };
}

function skinMasks(head: Rect, cheekFrameSize: number): Record<string, { framing: "face" | "cheek"; mask: Mask; method: string }> {
  return {
    forehead: { framing: "face", mask: { kind: "rects", rects: [rectFromHead(head, 0.30, 0.13, 0.70, 0.30)] }, method: "head-box normalized central forehead" },
    nose: { framing: "face", mask: { kind: "rects", rects: [rectFromHead(head, 0.43, 0.34, 0.57, 0.66)] }, method: "head-box normalized nasal bridge/tip" },
    nasolabial: {
      framing: "face",
      mask: { kind: "rects", rects: [rectFromHead(head, 0.30, 0.61, 0.43, 0.78), rectFromHead(head, 0.57, 0.61, 0.70, 0.78)] },
      method: "paired head-box normalized nasolabial rectangles",
    },
    cheek: {
      framing: "cheek",
      mask: { kind: "rects", rects: [{ x0: cheekFrameSize * 0.18, y0: cheekFrameSize * 0.18, x1: cheekFrameSize * 0.82, y1: cheekFrameSize * 0.82 }] },
      method: "central 64% of native cheek close-up",
    },
  };
}

function detectIrisCenters(pngPath: string, radius: number): [Point, Point] {
  const png = decodePng(pngPath);
  const centers: Point[] = [];
  for (const half of [0, 1]) {
    const priorX = png.w * (half === 0 ? 0.28 : 0.72);
    const priorY = png.h * 0.52;
    let sx = 0, sy = 0, sw = 0;
    const x0 = half * png.w * 0.5;
    const x1 = (half + 1) * png.w * 0.5;
    for (let y = Math.floor(png.h * 0.22); y < Math.ceil(png.h * 0.78); y += 1) {
      for (let x = Math.floor(x0 + radius); x < Math.ceil(x1 - radius); x += 1) {
        const i = (y * png.w + x) * png.chans;
        const r = png.data[i]!, g = png.data[i + 1] ?? r, b = png.data[i + 2] ?? r;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const sat = max > 0 ? (max - min) / max : 0;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const prior = Math.exp(-(((x - priorX) / (png.w * 0.16)) ** 2 + ((y - priorY) / (png.h * 0.18)) ** 2));
        const weight = Math.max(0, 190 - lum) * (0.3 + sat) * prior;
        sx += x * weight; sy += y * weight; sw += weight;
      }
    }
    centers.push(sw > 0 ? { x: sx / sw, y: sy / sw } : { x: priorX, y: priorY });
  }
  return centers as [Point, Point];
}

function eyeMasks(centers: [Point, Point], irisRadius: number): Record<string, { framing: "eyes"; mask: Mask; method: string }> {
  const discs = (r0: number, r1: number): Mask => ({ kind: "discs", discs: centers.map((c) => ({ cx: c.x, cy: c.y, r0, r1 })) });
  return {
    iris: { framing: "eyes", mask: discs(0, irisRadius * 0.82), method: "paired detected iris centers; inner 82% of anatomical 12mm projected radius" },
    "limbus ring": { framing: "eyes", mask: discs(irisRadius * 0.82, irisRadius * 1.08), method: "paired annuli spanning 82%..108% of projected iris radius" },
    sclera: { framing: "eyes", mask: discs(irisRadius * 1.12, irisRadius * 1.75), method: "paired annuli outside limbus, clipped by the eye close-up" },
  };
}

function meanLuminance(pngPath: string, mask: Mask): number {
  const s = regionStats(pngPath, mask);
  return 0.2126 * s.meanSrgb[0] + 0.7152 * s.meanSrgb[1] + 0.0722 * s.meanSrgb[2];
}

function readLive(page: Page): Promise<LiveReadback> {
  return page.evaluate(() => {
    const d = (globalThis as unknown as { __openClinXrIsolatedRuntimeDebug?: Record<string, unknown> }).__openClinXrIsolatedRuntimeDebug;
    if (!d) throw new Error("missing __openClinXrIsolatedRuntimeDebug");
    return {
      renderer: {
        threeRevision: d["threeRevision"],
        toneMapping: d["toneMapping"],
        toneMappingExposure: d["toneMappingExposure"],
        outputColorSpace: d["outputColorSpace"],
      },
      lights: d["lights"],
      productRig: d["productRig"],
      portrait: (d["portrait"] ?? null) as LiveReadback["portrait"],
    };
  });
}

function cameraComparable(a: Captured, b: Captured): void {
  const stable = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) => typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v);
  const ac = a.readback.portrait ?? a.evidence.packFraming;
  const bc = b.readback.portrait ?? b.evidence.packFraming;
  if (stable(ac) !== stable(bc)) throw new Error(`ORIGINAL and NEW did not use the same camera:\nORIGINAL ${stable(ac)}\nNEW ${stable(bc)}`);
}

async function captureVariant(input: {
  page: Page;
  baseUrl: string;
  actor: string;
  variant: "original" | "new";
  lightingSpec: Record<string, unknown>;
  framing: "face" | "eyes" | "cheek";
  captureSize: number;
  imagePath: string;
}): Promise<Captured> {
  const portrait = input.framing !== "eyes";
  const evidence = await captureOne({
    page: input.page,
    baseUrl: input.baseUrl,
    size: input.captureSize,
    imagePath: input.imagePath,
    spec: {
      subjectId: `${input.actor}_${input.variant}_${input.framing}`,
      subjectKind: "glb",
      bodyGlb: `/__vitcompare/${input.actor}/${input.variant}.glb`,
      view: "front",
      focus: input.framing === "eyes" ? "eyes" : "head",
      hideHair: true,
      subjectOnly: true,
      renderSize: input.captureSize,
      skinShadeLoader: true,
      yawDegrees: 0,
      portrait,
      ...input.lightingSpec,
      label: `${input.actor} ${input.variant} ${input.framing}`,
    },
  }) as CaptureEvidence;
  return { imagePath: input.imagePath, evidence, readback: await readLive(input.page), captureSize: input.captureSize };
}

function headBoxAfterCrop(capture: Captured, crop: Rect): Rect {
  const box = capture.readback.portrait?.headBoxPx;
  if (!box) throw new Error("portrait capture has no live headBoxPx");
  return { x0: box.x0 - crop.x0, y0: box.y0 - crop.y0, x1: box.x1 - crop.x0, y1: box.y1 - crop.y0 };
}

function centredCrop(size: number, outSize: number): Rect {
  const pad = Math.floor((size - outSize) / 2);
  return { x0: pad, y0: pad, x1: pad + outSize, y1: pad + outSize };
}

// isolated-subject-lab.ts clamps renderSize to 4096; a larger capture is a resampled
// screenshot with the head box still in 4096-px coordinates.
const LAB_RENDER_SIZE_MAX = 4096;

function cheekCrop(capture: Captured): Rect {
  const head = capture.readback.portrait?.headBoxPx;
  if (!head) throw new Error("cheek capture has no head box");
  // The head box is the whole-head AABB (skull included), so a crop the size of the
  // output frame covered the eyes too. Take 18% of head-box width centred on the
  // image-right cheek, clear of lid, nose and lip on aisha, kevin and family (checked 2026-11-04).
  const outSize = Math.round((head.x1 - head.x0) * 0.18);
  const cx = head.x0 + (head.x1 - head.x0) * 0.70;
  const cy = head.y0 + (head.y1 - head.y0) * 0.74;
  const x0 = Math.floor(cx - outSize / 2);
  const y0 = Math.floor(cy - outSize / 2);
  return { x0, y0, x1: x0 + outSize, y1: y0 + outSize };
}

function metricRecord(orig: RegionStats, candidate: RegionStats): Record<string, unknown> {
  return {
    original: orig,
    new: candidate,
    deltaE76OrigToNew: Math.round(deltaE76(orig, candidate) * 1_000_000) / 1_000_000,
    method: "deltaE76 between region mean sRGB converted to CIELAB D65; luminance SD in encoded sRGB; high-pass energy is residual variance after separable Gaussian sigma=2px",
  };
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const cli = parseCli(process.argv.slice(2));
  const outAbs = path.resolve(cwd, cli.outDir);
  if (!inside(cwd, outAbs)) throw new Error(`--out must remain inside the assigned worktree: ${outAbs}`);
  await mkdir(outAbs, { recursive: true });
  const staged = await stageInputs(cwd, cli);
  const runtimeRigSha256 = sha256File(path.join(cwd, RUNTIME_RIG_REL));
  const inheritedNoiseFloor = cli.noiseFloorManifest
    ? Number((JSON.parse(readFileSync(path.resolve(cwd, cli.noiseFloorManifest), "utf8")) as { gates?: { g1?: { noiseFloorDeltaE76?: unknown } } }).gates?.g1?.noiseFloorDeltaE76)
    : null;
  if (inheritedNoiseFloor != null && !Number.isFinite(inheritedNoiseFloor)) throw new Error("--noise-floor manifest lacks gates.g1.noiseFloorDeltaE76");

  const actorRecords: Array<Record<string, unknown>> = [];
  const manifest: Record<string, unknown> = {
    schemaVersion: "openclinxr.vitruvian-compare.v1",
    tool: TOOL_REL,
    command: exactCommand(cwd),
    cwd,
    origRef: cli.origRef,
    size: cli.size,
    renderer: "product apps/ui-xr isolated-subject three.js lab",
    loaderMode: "skinShadeLoader factory mode; zero skinOverride; zero materialOverrides",
    sheets: "native 1:1 pixels, no resampling or upscaling",
    regionsMethod: "asset-derived live head/eye boxes plus documented normalized masks; identical masks for ORIGINAL and NEW",
    rigs: {
      studio: { rigId: STUDIO_RIG_ID, mechanism: "existing rigOverride.studio key/fill/rim/hemisphere + RoomEnvironment", requested: STUDIO_RIG },
      runtime: { rigId: RUNTIME_RIG_ID, path: RUNTIME_RIG_REL, sha256: runtimeRigSha256, why: "a capture rig brighter than runtime has invented defects; runtime lighting is therefore a co-equal condition" },
    },
    actors: actorRecords,
    gates: {},
    notEvidenceFor: ["clinical_validity", "quest_readiness", "learner_readiness", "exam_equivalence"],
  };
  let server: Awaited<ReturnType<typeof spawnPortlessDevServer>> | null = null;
  const allRegionDeltaEs: Array<{ actor: string; lighting: string; region: string; deltaE76: number }> = [];
  let everyPixelIdentical = true;
  const calibration: Array<{ actor: string; lighting: string; rigId: string; meanFaceLuminance: number }> = [];
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd, readyTimeoutMs: 180_000 });
    const stagedByUrl = new Map(staged.flatMap((s) => [
      [s.original.servedUrl, { bytes: readFileSync(s.original.abs), contentType: "model/gltf-binary" }],
      [s.candidate.servedUrl, { bytes: readFileSync(s.candidate.abs), contentType: "model/gltf-binary" }],
    ]));
    await createLocalComputeServices({
      browserLaunch: chromium.launch.bind(chromium, { headless: true, args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] }),
    }).sceneCapture.withBrowser("skin-realism:vitruvian-compare", async (launched: unknown) => {
      const page = await (launched as HeadlessBrowser).newPage({ viewport: { width: cli.size, height: cli.size }, deviceScaleFactor: 1 });
      await page.route("**/__vitcompare/**", async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        const file = stagedByUrl.get(pathname);
        if (!file) return route.abort();
        return route.fulfill({ body: file.bytes, contentType: file.contentType });
      });
      for (const subject of staged) {
        const actorRecord: Record<string, unknown> = {
          actor: subject.actor,
          glbPath: subject.repoPath,
          original: { ref: cli.origRef, sha256: subject.original.sha256, source: subject.original.source, scratchPath: path.relative(cwd, subject.original.abs) },
          new: { sha256: subject.candidate.sha256, source: subject.candidate.source, scratchPath: path.relative(cwd, subject.candidate.abs) },
          sameBytes: subject.original.sha256 === subject.candidate.sha256,
          lighting: {},
        };
        actorRecords.push(actorRecord);
        for (const lighting of LIGHTING) {
          const lightOut = path.join(outAbs, subject.actor, lighting.id);
          await mkdir(lightOut, { recursive: true });
          const captures: Record<string, { original: Captured; new: Captured; crop: Rect; origPng: string; newPng: string }> = {};
          for (const framing of ["face", "eyes", "cheek"] as const) {
            const frameOut = path.join(lightOut, framing);
            await mkdir(frameOut, { recursive: true });
            const captureSize = framing === "face" ? Math.ceil(cli.size * 0.82 / 0.78) : framing === "cheek" ? Math.min(LAB_RENDER_SIZE_MAX, Math.ceil(cli.size * 2.4)) : cli.size;
            const origSource = path.join(frameOut, ".source-orig.png");
            const newSource = path.join(frameOut, ".source-new.png");
            const original = await captureVariant({ page, baseUrl: server!.url, actor: subject.actor, variant: "original", lightingSpec: lighting.spec, framing, captureSize, imagePath: origSource });
            const candidate = await captureVariant({ page, baseUrl: server!.url, actor: subject.actor, variant: "new", lightingSpec: lighting.spec, framing, captureSize, imagePath: newSource });
            cameraComparable(original, candidate);
            const crop = framing === "eyes" ? { x0: 0, y0: 0, x1: cli.size, y1: cli.size }
              : framing === "face" ? centredCrop(captureSize, cli.size)
              : cheekCrop(original);
            const origPng = path.join(frameOut, "orig.png");
            const newPng = path.join(frameOut, "new.png");
            if (framing === "eyes") {
              await copyPngRgb(origSource, origPng);
              await copyPngRgb(newSource, newPng);
            } else {
              await writeNativeCrop(origSource, origPng, crop);
              await writeNativeCrop(newSource, newPng, crop);
            }
            await writeSideBySide(origPng, newPng, path.join(frameOut, "side-by-side.png"));
            const diff = await writeDiffHeatmap(origPng, newPng, path.join(frameOut, "absolute-diff.png"));
            everyPixelIdentical &&= diff.pixelIdentical;
            captures[framing] = { original, new: candidate, crop, origPng, newPng };
          }

          const face = captures["face"]!;
          const eyes = captures["eyes"]!;
          const cheek = captures["cheek"]!;
          const headBox = headBoxAfterCrop(face.original, face.crop);
          const headHeightFraction = (headBox.y1 - headBox.y0) / cli.size;
          if (headHeightFraction < HEAD_FILL_MIN) throw new Error(`${subject.actor}/${lighting.id}: face head fill ${headHeightFraction.toFixed(4)} < ${HEAD_FILL_MIN}`);
          const headFocus = face.original.evidence.focusRegion;
          const headBounds = headFocus?.boundsMeters;
          if (!headBounds) throw new Error(`${subject.actor}/${lighting.id}: no derived head bounds`);
          const headWidthM = headBounds.max.x - headBounds.min.x;
          const cheekHead = cheek.original.readback.portrait!.headBoxPx;
          const headWidthPx = cheekHead.x1 - cheekHead.x0;
          const cheekPxPerMm = headWidthPx / (headWidthM * 1000);
          if (cheekPxPerMm < CHEEK_PX_PER_MM_MIN) throw new Error(`${subject.actor}/${lighting.id}: cheek ${cheekPxPerMm.toFixed(3)} px/mm < ${CHEEK_PX_PER_MM_MIN}`);

          const eyeBounds = eyes.original.evidence.focusRegion?.boundsMeters;
          const eyeSpan = eyes.original.evidence.frameSpanFraction;
          if (!eyeBounds || typeof eyeSpan !== "number") throw new Error(`${subject.actor}/${lighting.id}: no derived eye bounds/frame span`);
          const eyeBoxWidthM = eyeBounds.max.x - eyeBounds.min.x;
          const eyeBoxHeightM = eyeBounds.max.y - eyeBounds.min.y;
          const projectedEyeWidthPx = eyeSpan * cli.size * (eyeBoxWidthM >= eyeBoxHeightM ? 1 : eyeBoxWidthM / eyeBoxHeightM);
          const irisDiameterPx = projectedEyeWidthPx * IRIS_DIAMETER_M / eyeBoxWidthM;
          if (irisDiameterPx < IRIS_DIAMETER_MIN_PX) throw new Error(`${subject.actor}/${lighting.id}: iris ${irisDiameterPx.toFixed(2)}px < ${IRIS_DIAMETER_MIN_PX}px`);
          const centers = detectIrisCenters(eyes.origPng, irisDiameterPx / 2);
          const masks = { ...skinMasks(headBox, cheek.crop.x1 - cheek.crop.x0), ...eyeMasks(centers, irisDiameterPx / 2) };
          const regionMetrics: Record<string, unknown> = {};
          for (const [region, def] of Object.entries(masks)) {
            const source = captures[def.framing]!;
            const orig = regionStats(source.origPng, def.mask);
            const next = regionStats(source.newPng, def.mask);
            const delta = Math.round(deltaE76(orig, next) * 1_000_000) / 1_000_000;
            const metric = { ...metricRecord(orig, next), framing: def.framing, maskMethod: def.method };
            regionMetrics[region] = metric;
            allRegionDeltaEs.push({ actor: subject.actor, lighting: lighting.id, region, deltaE76: delta });
          }
          const frameRecords: Record<string, unknown> = {};
          for (const framing of ["face", "eyes", "cheek"] as const) {
            const c = captures[framing]!;
            const frameOut = path.dirname(c.origPng);
            const applicable = Object.fromEntries(Object.entries(regionMetrics).filter(([, value]) => (value as { framing: string }).framing === framing));
            const numbers = {
              actor: subject.actor,
              lighting: lighting.id,
              rigId: lighting.rigId,
              framing,
              imageSize: { width: cli.size, height: cli.size },
              nativeSourceSize: c.original.captureSize,
              nativeCrop: c.crop,
              camera: c.original.readback.portrait ?? c.original.evidence.packFraming,
              focusRegion: c.original.evidence.focusRegion,
              rendererReadback: c.original.readback.renderer,
              lightsReadback: c.original.readback.lights,
              productRigReadback: c.original.readback.productRig,
              regions: applicable,
            };
            await writeFile(path.join(frameOut, "numbers.json"), `${JSON.stringify(numbers, null, 2)}\n`, "utf8");
            frameRecords[framing] = {
              directory: path.relative(cwd, frameOut).replaceAll("\\", "/"),
              origSha256: sha256File(c.origPng),
              newSha256: sha256File(c.newPng),
              sideBySideSha256: sha256File(path.join(frameOut, "side-by-side.png")),
              diffSha256: sha256File(path.join(frameOut, "absolute-diff.png")),
              camera: numbers.camera,
              focusRegion: numbers.focusRegion,
            };
          }
          const faceMask = { kind: "rects", rects: [rectFromHead(headBox, 0.22, 0.12, 0.78, 0.82)] } as Mask;
          const faceLuminance = meanLuminance(face.origPng, faceMask);
          calibration.push({ actor: subject.actor, lighting: lighting.id, rigId: lighting.rigId, meanFaceLuminance: Math.round(faceLuminance * 1000) / 1000 });
          (actorRecord["lighting"] as Record<string, unknown>)[lighting.id] = {
            rigId: lighting.rigId,
            rendererReadback: face.original.readback.renderer,
            lightsReadback: face.original.readback.lights,
            productRigReadback: face.original.readback.productRig,
            framingGates: {
              faceHeadHeightFraction: Math.round(headHeightFraction * 1_000_000) / 1_000_000,
              irisDiameterPx: Math.round(irisDiameterPx * 1000) / 1000,
              irisDiameterMethod: "12mm anatomical iris projected through asset-derived eye-box width and live frameSpanFraction",
              cheekPxPerMm: Math.round(cheekPxPerMm * 1000) / 1000,
              cheekPxPerMmMethod: "live projected head-box width px in the cheek capture / asset-derived head width mm; crop is native so scale is preserved",
            },
            frames: frameRecords,
            regions: regionMetrics,
            meanFaceLuminance: Math.round(faceLuminance * 1000) / 1000,
          };
        }
      }
    });
  } finally {
    if (server) await stopPortlessDevServer(server.proc);
  }

  const sameBytes = staged.every((s) => s.original.sha256 === s.candidate.sha256);
  const maxDeltaE = Math.max(0, ...allRegionDeltaEs.map((r) => r.deltaE76));
  const noiseFloor = inheritedNoiseFloor ?? (sameBytes ? maxDeltaE : 0);
  // Same bytes may differ on a few depth-edge pixels (lid silhouette aliasing, 136 px on
  // the first A-vs-A run); the brief treats that as a noise floor. Fail only when the
  // floor itself would hide a change: max region deltaE76 above 1 (below the ~2.3 JND).
  const g1Failure = sameBytes && maxDeltaE > 1
    ? `G1 failed: same GLB bytes differ inside a measured region; max region deltaE76=${maxDeltaE} > 1`
    : null;
  const skinNames = new Set(["forehead", "nose", "nasolabial", "cheek"]);
  const eyeNames = new Set(["iris", "sclera", "limbus ring"]);
  const skinViolations = allRegionDeltaEs.filter((r) => skinNames.has(r.region) && r.deltaE76 > noiseFloor + 1e-9);
  const eyeChanges = allRegionDeltaEs.filter((r) => eyeNames.has(r.region) && r.deltaE76 > noiseFloor + 1e-9);
  const g2Failure = !sameBytes && skinViolations.length
    ? `G2 failed: skin deltas exceed noise floor ${noiseFloor}: ${JSON.stringify(skinViolations)}`
    : !sameBytes && !eyeChanges.length
      ? `G2 failed: no iris/sclera/limbus delta exceeds noise floor ${noiseFloor}`
      : null;

  const calibrationByActor = cli.actors.map((actor) => {
    const studio = calibration.find((r) => r.actor === actor && r.lighting === "studio")!;
    const runtime = calibration.find((r) => r.actor === actor && r.lighting === "runtime")!;
    const ratio = Number(studio.meanFaceLuminance) / Math.max(Number(runtime.meanFaceLuminance), 1e-9);
    return {
      actor,
      studioMeanFaceLuminance: studio.meanFaceLuminance,
      runtimeMeanFaceLuminance: runtime.meanFaceLuminance,
      studioToRuntimeRatio: Math.round(ratio * 1000) / 1000,
      flagStudioExceedsRuntimeByMoreThan2x: ratio > 2,
      action: "report_only_never_auto_tune",
    };
  });
  manifest["gates"] = {
    g1: { sameBytes, pixelIdentical: sameBytes ? everyPixelIdentical : null, maxPerRegionDeltaE76: maxDeltaE, noiseFloorDeltaE76: noiseFloor, inheritedFrom: cli.noiseFloorManifest ?? null },
    g2: { applicable: !sameBytes, skinWithinNoiseFloor: skinViolations.length === 0, skinViolations, eyeRegionsAboveFloor: eyeChanges },
    g3: { calibration: calibrationByActor },
    g4: { packageFileTouched: false, architectureRequiredByBrief: false, rootEvidenceTestAdded: false },
  };
  await writeFile(path.join(outAbs, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (g1Failure) throw new Error(g1Failure);
  if (g2Failure) throw new Error(g2Failure);
  console.log(`vitruvian compare complete: ${path.relative(cwd, path.join(outAbs, "manifest.json"))}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
