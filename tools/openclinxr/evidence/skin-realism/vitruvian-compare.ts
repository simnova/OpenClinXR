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
import { pathToFileURL } from "node:url";
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
import { gitBlobSha, pngFrameSize, resolveCaptureCardOutcome, resolveCardCropBox, withRecordedSubjectCrop } from "./vitruvian-grey-card.js";

class PageFaultError extends Error {
  override name = "PageFaultError";
}

type HeadlessBrowser = {
  newPage(options?: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<Page>;
};

type Cli = {
  actors: string[];
  newPath: string;
  origRef: string;
  origFile?: string;
  outDir: string;
  size: number;
  region: "head" | "forearm" | "neck" | "shin" | "forearm-close" | "neck-close";
  boxes?: string;
  noiseFloorManifest?: string;
  greyCard: boolean;
  greyCardPlacement?: string;
  greyCardPosition?: "neck" | "chest_side";
  greyCardCamera?: "card";
  lightToggle: boolean;
  scenarioId: string;
  productEnvironmentId: string;
  patientYawFrom?: string;
  skinOverride?: { kind: "lambert"; albedo: number };
  skinSpecular?: "off";
};

export type PatientYawOverride = {
  source: string;
  yawRadians: number;
};

type GreyCardPlacement = {
  source: string;
  position: "neck" | "chest_side";
  patientRootMatrix: number[];
  cameraDistanceMeters: number;
};

type CardLab = {
  srgbMedian: [number, number, number];
  rawMedianLab: [number, number, number];
  pixelCount: number;
};

type Point = { x: number; y: number };
type Rect = { x0: number; y0: number; x1: number; y1: number };
type Mask = ({ excludeRects?: Rect[] } & (
  | { kind: "rects"; rects: Rect[] }
  | { kind: "discs"; discs: Array<{ cx: number; cy: number; r0: number; r1: number }> }
  | { kind: "bitmap"; w: number; h: number; bits: Uint8Array }
));

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
  packFraming?: {
    packCamera?: {
      fov: number;
      distance: number;
      position: { x: number; y: number; z: number };
      target: { x: number; y: number; z: number };
    } | null;
  };
  greyCard?: {
    projectedBoxPx: Rect;
    worldTransform: Record<string, unknown>;
    [key: string]: unknown;
  };
};

type Captured = {
  imagePath: string;
  evidence: CaptureEvidence;
  readback: LiveReadback;
  captureSize: number;
  instrumentation?: {
    /** null when a region pass (no card camera) framed the card fully outside the capture. */
    cardLab: CardLab | null;
    cardOffFrame?: boolean;
    lightToggle: unknown[];
    restoreCheck: Record<string, unknown> | null;
    patientMaterials: unknown[];
    skinMaterialRows: unknown[];
  };
};

type RegionStats = {
  pixelCount: number;
  meanSrgb: [number, number, number];
  meanCielabD65: [number, number, number];
  luminanceSd: number;
  highPassEnergySigma2: number;
};

type PatchGeometry = {
  meanNormal: [number, number, number];
  cosKey: number;
  cardNormal: [number, number, number];
  cardCosKey: number;
  vertexCount: number;
};

const TOOL_REL = "tools/openclinxr/evidence/skin-realism/vitruvian-compare.ts";
const PUBLIC_GLBS = "apps/ui-xr/public/generated-humanoids";
const DEFAULT_SCENARIO_ID = "ob_headache_preeclampsia_triage_v1";
const DEFAULT_RUNTIME_RIG_ID = "ob_triage_room_v1";
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

function lightingConditions(cli: Cli, patientYawOverride: PatientYawOverride | null) {
  return [
    {
      id: "studio",
      rigId: STUDIO_RIG_ID,
      spec: { rigOverride: { studio: STUDIO_RIG, removeDefaultLights: true }, eyeRuntimeShading: false },
    },
    {
      id: "runtime",
      rigId: cli.productEnvironmentId,
      spec: {
        productEnvironmentId: cli.productEnvironmentId,
        productScenarioId: cli.scenarioId,
        ...(patientYawOverride ? { productPatientYawOverride: patientYawOverride } : {}),
        eyeRuntimeShading: false,
      },
    },
  ] as const;
}

export function parseCli(argv: string[]): Cli {
  const actors: string[] = [];
  let newPath = "";
  let origRef = "origin/main";
  let outDir = "";
  let size = 2048;
  let region: Cli["region"] = "head";
  let boxes: string | undefined;
  let origFile: string | undefined;
  let noiseFloorManifest: string | undefined;
  let greyCard = false;
  let greyCardPlacement: string | undefined;
  let greyCardPosition: Cli["greyCardPosition"];
  let greyCardCamera: Cli["greyCardCamera"];
  let lightToggle = false;
  let scenarioId = DEFAULT_SCENARIO_ID;
  let productEnvironmentId = DEFAULT_RUNTIME_RIG_ID;
  let patientYawFrom: string | undefined;
  let skinOverride: Cli["skinOverride"];
  let skinSpecular: Cli["skinSpecular"];
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
    else if (arg === "--boxes") boxes = take();
    else if (arg === "--orig-file") origFile = take();
    else if (arg === "--grey-card") greyCard = true;
    else if (arg === "--grey-card-placement") greyCardPlacement = take();
    else if (arg === "--grey-card-position") {
      const value = take();
      if (value !== "neck" && value !== "chest_side") throw new Error(`--grey-card-position must be neck or chest_side (got ${value})`);
      greyCardPosition = value;
    }
    else if (arg === "--grey-card-camera") {
      const value = take();
      if (value !== "card") throw new Error(`--grey-card-camera must be card (got ${value})`);
      greyCardCamera = value;
    }
    else if (arg === "--light-toggle") lightToggle = true;
    else if (arg === "--scenario-id") scenarioId = take();
    else if (arg === "--product-environment-id") productEnvironmentId = take();
    else if (arg === "--patient-yaw-from") patientYawFrom = take();
    else if (arg === "--skin-override") {
      const value = take();
      const match = /^lambert:(.+)$/u.exec(value);
      const albedo = Number(match?.[1]);
      if (!match || !Number.isFinite(albedo) || albedo <= 0 || albedo > 1) {
        throw new Error(`--skin-override must be lambert:<linear albedo in (0,1]> (got ${value})`);
      }
      skinOverride = { kind: "lambert", albedo };
    }
    else if (arg === "--skin-specular") {
      const value = take();
      if (value !== "off") throw new Error(`--skin-specular must be off (got ${value})`);
      skinSpecular = value;
    }
    else if (arg === "--region") {
      const value = take();
      if (value !== "head" && value !== "forearm" && value !== "neck" && value !== "shin" && value !== "forearm-close" && value !== "neck-close") {
        throw new Error(`--region must be head, forearm, neck, shin, forearm-close, or neck-close (got ${value})`);
      }
      region = value;
    }
    else if (arg === "--noise-floor") noiseFloorManifest = take();
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!actors.length) throw new Error("at least one --actor <id> is required");
  if (!newPath) throw new Error("--new <glb path or directory> is required");
  if (!outDir) throw new Error("--out <directory> is required");
  if (!Number.isInteger(size) || size < 512 || size > 2048) {
    throw new Error("--size must be an integer in 512..2048 (cheek source is rendered at min(4096, 2.4x); 4096 gives ~13.6 px/mm)");
  }
  if (region !== "head" && region !== "forearm-close" && region !== "neck-close" && !boxes) {
    throw new Error("--region forearm|neck|shin requires --boxes <bodyboxes.json>");
  }
  for (const actor of actors) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(actor)) throw new Error(`unsafe actor id: ${actor}`);
  }
  if ((greyCardPlacement == null) !== (greyCardPosition == null)) throw new Error("--grey-card-placement and --grey-card-position must be supplied together");
  if ((greyCardPlacement || lightToggle) && !greyCard) throw new Error("--grey-card-placement and --light-toggle require --grey-card");
  if (greyCardCamera && (!greyCardPlacement || !greyCardPosition)) throw new Error("--grey-card-camera card requires --grey-card-placement and --grey-card-position");
  if (patientYawFrom && !greyCardPlacement) throw new Error("--patient-yaw-from requires --grey-card-placement");
  if (skinOverride && skinSpecular) throw new Error("--skin-override and --skin-specular are mutually exclusive");
  return {
    actors: [...new Set(actors)], newPath, origRef, outDir, size, region, greyCard, lightToggle, scenarioId, productEnvironmentId,
    ...(boxes ? { boxes } : {}), ...(origFile ? { origFile } : {}), ...(noiseFloorManifest ? { noiseFloorManifest } : {}),
    ...(greyCardPlacement ? { greyCardPlacement } : {}), ...(greyCardPosition ? { greyCardPosition } : {}), ...(greyCardCamera ? { greyCardCamera } : {}),
    ...(patientYawFrom ? { patientYawFrom } : {}),
    ...(skinOverride ? { skinOverride } : {}), ...(skinSpecular ? { skinSpecular } : {}),
  };
}

/** The factory's body-skin material contract; anchored to avoid eyes and hidden body partitions. */
export function isSkinMaterialName(name: string): boolean {
  return /^mpfb_skin_/iu.test(name);
}

export function greybodyManifestFields(cli: Pick<Cli, "skinOverride" | "skinSpecular">): {
  skinOverride: string | null;
  skinSpecular: "off" | null;
} {
  return {
    skinOverride: cli.skinOverride ? `lambert:${cli.skinOverride.albedo}` : null,
    skinSpecular: cli.skinSpecular ?? null,
  };
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
    // st-vitbody G4: --orig-file overrides the git-show bytes with a scratch file.
    const originalBytes = cli.origFile
      ? readFileSync(path.resolve(cwd, cli.origFile))
      : await gitShow(cli.origRef, repoPath);
    await writeFile(origAbs, originalBytes);
    const candidateSource = await findActorGlb(path.resolve(cwd, cli.newPath), actor);
    await copyFile(candidateSource, newAbs);
    staged.push({
      actor,
      repoPath,
      original: {
        abs: origAbs,
        sha256: sha256Bytes(originalBytes),
        source: cli.origFile ? `file ${cli.origFile}` : `git show ${cli.origRef}:${repoPath}`,
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
  if (mask.kind === "bitmap") return clampRect({ x0: 0, y0: 0, x1: mask.w, y1: mask.h }, w, h);
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
  if (mask.excludeRects?.some((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1)) return false;
  if (mask.kind === "bitmap") {
    if (x < 0 || y < 0 || x >= mask.w || y >= mask.h) return false;
    return mask.bits[y * mask.w + x] === 1;
  }
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

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
}

function cardMedianLab(pngPath: string, box: Rect): CardLab {
  const png = decodePng(pngPath);
  const inset = Math.max(2, Math.floor(Math.min(box.x1 - box.x0, box.y1 - box.y0) * 0.12));
  const channels: [number[], number[], number[]] = [[], [], []];
  for (let y = Math.max(0, box.y0 + inset); y < Math.min(png.h, box.y1 - inset); y += 1) {
    for (let x = Math.max(0, box.x0 + inset); x < Math.min(png.w, box.x1 - inset); x += 1) {
      const index = (y * png.w + x) * png.chans;
      channels[0].push(png.data[index] ?? 0);
      channels[1].push(png.data[index + 1] ?? png.data[index] ?? 0);
      channels[2].push(png.data[index + 2] ?? png.data[index] ?? 0);
    }
  }
  if (!channels[0].length) throw new Error(`empty card box ${JSON.stringify(box)}`);
  const srgbMedian: [number, number, number] = [median(channels[0]), median(channels[1]), median(channels[2])];
  return { srgbMedian, rawMedianLab: srgbToLab(srgbMedian), pixelCount: channels[0].length };
}

function readGreyCardPlacement(cwd: string, cli: Cli): GreyCardPlacement | null {
  if (!cli.greyCardPlacement || !cli.greyCardPosition) return null;
  const absolute = path.resolve(cwd, cli.greyCardPlacement);
  const report = JSON.parse(readFileSync(absolute, "utf8")) as {
    app?: Record<string, { worldTransform?: { patientRootMatrix?: unknown; cameraDistanceMeters?: unknown } }>;
  };
  const worldTransform = report.app?.[cli.greyCardPosition]?.worldTransform;
  const matrix = worldTransform?.patientRootMatrix;
  if (!Array.isArray(matrix) || matrix.length !== 16 || !matrix.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error(`${cli.greyCardPlacement} has no finite app.${cli.greyCardPosition}.worldTransform.patientRootMatrix[16]`);
  }
  const cameraDistanceMeters = worldTransform?.cameraDistanceMeters;
  if (typeof cameraDistanceMeters !== "number" || !Number.isFinite(cameraDistanceMeters) || cameraDistanceMeters <= 0) {
    throw new Error(`${cli.greyCardPlacement} has no positive app.${cli.greyCardPosition}.worldTransform.cameraDistanceMeters`);
  }
  return { source: cli.greyCardPlacement, position: cli.greyCardPosition, patientRootMatrix: matrix as number[], cameraDistanceMeters };
}

export function patientYawFromSceneDump(
  sceneDump: { tagged?: unknown },
  source: string,
): PatientYawOverride {
  const tagged = Array.isArray(sceneDump.tagged) ? sceneDump.tagged : [];
  const primaryPatients = tagged.filter(
    (entry): entry is { slotKind: "primary_patient"; matrixWorld?: unknown } =>
      typeof entry === "object" && entry !== null && (entry as { slotKind?: unknown }).slotKind === "primary_patient",
  );
  const [primaryPatient] = primaryPatients;
  if (primaryPatients.length !== 1 || primaryPatient === undefined) {
    throw new Error(`${source} has ${primaryPatients.length} primary_patient roots; expected exactly 1`);
  }
  const matrix = primaryPatient.matrixWorld;
  if (!Array.isArray(matrix) || matrix.length !== 16 || !matrix.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error(`${source} primary_patient root has no finite matrixWorld[16]`);
  }
  return {
    source,
    yawRadians: Math.atan2(matrix[8] ?? Number.NaN, matrix[0] ?? Number.NaN),
  };
}

function readPatientYawOverride(cwd: string, cli: Cli): PatientYawOverride | null {
  if (!cli.patientYawFrom) return null;
  const sceneDump = JSON.parse(readFileSync(path.resolve(cwd, cli.patientYawFrom), "utf8")) as {
    tagged?: unknown;
  };
  return patientYawFromSceneDump(sceneDump, cli.patientYawFrom);
}

function instrumentOnly(cli: Cli): Record<string, unknown> {
  return {
    ...greybodyManifestFields(cli),
    ...(cli.patientYawFrom
      ? { instrumentOnly: "lab root yaw taken from app run scene-dump (idle sway is wall-clock driven)" }
      : {}),
  };
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

function skinMasks(head: Rect, cheekSubject: Rect): Record<string, { framing: "face" | "cheek"; mask: Mask; method: string }> {
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
      mask: { kind: "rects", rects: [rectFromHead(cheekSubject, 0.18, 0.18, 0.82, 0.82)] },
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

// 0.5 px is 1/6400 of the 3195 px head box; 1e-4 m is 0.017% of the 0.606 m portrait distance.
const CAMERA_PX_TOL = 0.5;
const CAMERA_M_TOL = 1e-4;
// grey-card cameraDistanceRatio is a constant over focusTargetDistanceMeters, so it inherits CAMERA_M_TOL:
// 1e-4 m / 0.606 m x 4.44 = 7.3e-4.
const CAMERA_RATIO_TOL = 7.3e-4;
export function cameraWithinTolerance(a: unknown, b: unknown, key = ""): boolean {
  if (typeof a === "number" && typeof b === "number") {
    const tol = /Px$/.test(key) ? CAMERA_PX_TOL : /(M|Meters)$/.test(key) ? CAMERA_M_TOL : key === "cameraDistanceRatio" ? CAMERA_RATIO_TOL : 1e-6;
    return Math.abs(a - b) <= tol;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join("\u0000") !== kb.join("\u0000")) return false;
    // keys inside a *Px object (headBoxPx.x0 ...) inherit the pixel tolerance
    return ka.every((k) => cameraWithinTolerance((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], /Px$/.test(key) ? `${k}Px` : k));
  }
  return a === b;
}

function cameraComparable(a: Captured, b: Captured): void {
  const stable = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) => typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v);
  const ac = a.readback.portrait ?? a.evidence.packFraming;
  const bc = b.readback.portrait ?? b.evidence.packFraming;
  // ORIGINAL and NEW are different GLBs, so the live portrait framing (fit to each mesh) can differ by float
  // noise: measured 2e-6 m distance and 0.008 px box (greybody warm_light neck-close card, 2026-11-10).
  // Pixel fields may differ by CAMERA_PX_TOL, metre fields by CAMERA_M_TOL; everything else stays equal at 1e-6.
  if (!cameraWithinTolerance(ac, bc)) throw new Error(`ORIGINAL and NEW did not use the same camera:\nORIGINAL ${stable(ac)}\nNEW ${stable(bc)}`);
  const comparableCard = (card: CaptureEvidence["greyCard"]): unknown => {
    if (!card) return null;
    // The lab root's object name carries the capture side (original/new); placement equality is about geometry.
    const { patientMaterials: _patientMaterials, skinMaterialRows: _skinMaterialRows, labPatientRoot: _labPatientRoot, placement, ...geometry } = card;
    if (!placement) return geometry;
    const { labPatientRootName: _labPatientRootName, ...placementGeometry } = placement as Record<string, unknown>;
    return { ...geometry, placement: placementGeometry };
  };
  if (!cameraWithinTolerance(comparableCard(a.evidence.greyCard), comparableCard(b.evidence.greyCard))) {
    throw new Error(`ORIGINAL and NEW did not use the same grey-card placement:\nORIGINAL ${stable(a.evidence.greyCard)}\nNEW ${stable(b.evidence.greyCard)}`);
  }
}

export async function runGreyCardHookIfEnabled<T>(enabled: boolean, hook: () => Promise<T>): Promise<T | null> {
  return enabled ? await hook() : null;
}

async function injectHarnessGreyCard(page: Page, evidence: CaptureEvidence, placement: GreyCardPlacement | null, cameraMode: Cli["greyCardCamera"]): Promise<CaptureEvidence["greyCard"]> {
  const declaredCamera = evidence.packFraming?.packCamera;
  if (!declaredCamera) throw new Error("grey card requires evidence.packFraming.packCamera");
  return await page.evaluate(async ({ expected, placementInput, requestedCameraMode }) => {
    type V = { constructor: new (x?: number, y?: number, z?: number) => V; x: number; y: number; z: number; set: (x: number, y: number, z: number) => V; copy: (v: V) => V; sub: (v: V) => V; normalize: () => V; multiplyScalar: (n: number) => V; add: (v: V) => V; distanceTo: (v: V) => number; dot: (v: V) => number; unproject: (camera: unknown) => V; applyQuaternion: (q: unknown) => V; applyMatrix4: (m: unknown) => V; project: (camera: unknown) => V; toArray: () => number[] };
    type Q = { toArray: () => number[] };
    type Matrix = { clone: () => Matrix; invert: () => Matrix; multiply: (matrix: Matrix) => Matrix; fromArray: (elements: number[]) => Matrix; decompose: (position: V, quaternion: Q, scale: V) => void; toArray: () => number[] };
    type Node = { constructor: new (geometry: Geometry, material: Material) => Node; name?: string; parent?: Node | null; geometry?: { constructor: new () => Geometry; attributes?: { position?: { constructor: new (array: Float32Array, itemSize: number) => unknown } } }; material?: Material | Material[]; position: V; quaternion: Q; scale: V; matrixWorld: Matrix; userData: Record<string, unknown>; castShadow: boolean; receiveShadow: boolean; frustumCulled?: boolean; lookAt: (v: V) => void; updateMatrixWorld: (force: boolean) => void; traverse?: (fn: (node: Node) => void) => void };
    type Geometry = { setAttribute: (name: string, attribute: unknown) => void; computeBoundingSphere: () => void; constructor: new () => Geometry };
    type Material = { name?: string; isMeshStandardMaterial?: boolean; envMapIntensity?: number; color?: { setRGB: (r: number, g: number, b: number) => void }; emissive?: { setRGB: (r: number, g: number, b: number) => void }; roughness?: number; metalness?: number; map?: unknown; normalMap?: unknown; emissiveMap?: unknown; needsUpdate?: boolean; constructor: new (params?: Record<string, unknown>) => Material };
    type Scene = Node & { add: (node: Node) => void; traverse: (fn: (node: Node) => void) => void; onAfterRender?: (...args: unknown[]) => void };
    type Camera = Node & { fov: number; aspect: number; updateProjectionMatrix: () => void };
    type Renderer = { domElement: { width: number; height: number }; getContext: () => { RGBA: number; UNSIGNED_BYTE: number; readPixels: (x: number, y: number, w: number, h: number, format: number, type: number, pixels: Uint8Array) => void } };
    const g = globalThis as unknown as {
      __openClinXrIsolatedSceneRoot?: Node;
      __openClinXrIsolatedRenderFrame?: () => void;
      __openClinXrIsolatedRuntimeDebug?: { portrait?: { distanceM?: number; fovDeg?: number } | null };
    };
    // Portrait / close framings use framePortraitCamera, not the pack camera; the lab
    // publishes that solve's distance in its runtime debug record.
    const portraitDistance = g.__openClinXrIsolatedRuntimeDebug?.portrait?.distanceM;
    const root = g.__openClinXrIsolatedSceneRoot;
    const render = g.__openClinXrIsolatedRenderFrame;
    const scene = root?.parent as Scene | null | undefined;
    if (!root || !scene?.traverse || !render) throw new Error("isolated lab card hooks unavailable");

    let renderer: Renderer | null = null;
    let camera: Camera | null = null;
    const priorAfterRender = scene.onAfterRender;
    scene.onAfterRender = (...args: unknown[]) => {
      renderer = args[0] as Renderer;
      camera = args[2] as Camera;
      if (typeof priorAfterRender === "function") priorAfterRender(...args);
    };
    render();
    if (priorAfterRender) scene.onAfterRender = priorAfterRender;
    else delete scene.onAfterRender;
    if (!renderer || !camera) throw new Error("render hook did not expose renderer/camera");
    const liveRenderer = renderer as Renderer;
    const liveCamera = camera as Camera;
    const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.002;
    if (typeof portraitDistance === "number") {
      if (!near(liveCamera.fov, g.__openClinXrIsolatedRuntimeDebug?.portrait?.fovDeg ?? Number.NaN)) throw new Error("live camera fov disagrees with the portrait framing record");
    } else if (!near(liveCamera.fov, expected.fov)
      || !near(liveCamera.position.x, expected.position.x)
      || !near(liveCamera.position.y, expected.position.y)
      || !near(liveCamera.position.z, expected.position.z)) {
      throw new Error("live camera disagrees with evidence.packFraming.packCamera");
    }

    let templateMesh: Node | null = null;
    let skinMaterial: Material | null = null;
    scene.traverse((node) => {
      const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      // Any Mesh supplies the geometry/attribute constructors; the Mesh class itself is taken below.
      const flags = node as unknown as { isMesh?: boolean; isSkinnedMesh?: boolean; isInstancedMesh?: boolean; isBatchedMesh?: boolean };
      if (!templateMesh && flags.isMesh && !flags.isInstancedMesh && !flags.isBatchedMesh && node.geometry?.attributes?.position) templateMesh = node;
      for (const material of materials) {
        if (!skinMaterial && material?.isMeshStandardMaterial && /skin|body/i.test(`${node.name ?? ""} ${material.name ?? ""}`)) skinMaterial = material;
      }
    });
    const foundTemplate = templateMesh as Node | null;
    const foundSkin = skinMaterial as Material | null;
    if (!foundSkin) throw new Error("no skin material in the page for the card's envMapIntensity");
    void foundTemplate;

    const width = liveRenderer.domElement.width;
    const height = liveRenderer.domElement.height;
    const gl = liveRenderer.getContext();
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const sizePx = Math.ceil(width * 0.065);
    const margin = Math.ceil(width * 0.012);
    const candidates: Array<[number, number]> = [
      [margin, margin], [width - margin - sizePx, margin],
      [margin, height - margin - sizePx], [width - margin - sizePx, height - margin - sizePx],
      [Math.floor((width - sizePx) / 2), margin], [Math.floor((width - sizePx) / 2), height - margin - sizePx],
    ];
    const clear = (cx0: number, cy0: number): boolean => {
      for (let y = Math.max(0, cy0 - 3); y < Math.min(height, cy0 + sizePx + 3); y += 1) {
        const glY = height - 1 - y;
        for (let x = Math.max(0, cx0 - 3); x < Math.min(width, cx0 + sizePx + 3); x += 1) {
          const i = (glY * width + x) * 4;
          if (Math.abs((pixels[i] ?? 0) - 0x18) + Math.abs((pixels[i + 1] ?? 0) - 0x21) + Math.abs((pixels[i + 2] ?? 0) - 0x1d) > 36) return false;
        }
      }
      return true;
    };
    const chosen = candidates.find(([x, y]) => clear(x, y));
    if (!chosen) throw new Error("no background-only >=6% card placement");
    const [x0, y0] = chosen;

    const VectorCtor = liveCamera.position.constructor;
    const depth = typeof portraitDistance === "number"
      ? portraitDistance
      : liveCamera.position.distanceTo(new VectorCtor(expected.target.x, expected.target.y, expected.target.z));
    const visibleHeight = 2 * depth * Math.tan((liveCamera.fov * Math.PI) / 360);
    const visibleWidth = visibleHeight * liveCamera.aspect;
    const sizeMeters = visibleWidth * sizePx / width;
    const ndcX = ((x0 + sizePx / 2) / width) * 2 - 1;
    const ndcY = 1 - ((y0 + sizePx / 2) / height) * 2;
    const ray = new VectorCtor(ndcX, ndcY, 0.5).unproject(liveCamera).sub(liveCamera.position).normalize();
    const forward = new VectorCtor(0, 0, -1).applyQuaternion(liveCamera.quaternion).normalize();
    const alongRay = depth / Math.max(ray.dot(forward), 1e-9);

    // Build the card from the page's own three.js module: Vite serves it at one deps URL, and
    // importing that exact URL returns the same module instance the lab renders with.
    // The deps entry three.js re-exports the shared chunk under the public names; prefer it, else derive it
    // from the chunk URL (same directory, same ?v= hash).
    const resourceNames = performance.getEntriesByType("resource").map((entry) => entry.name);
    const chunkUrl = resourceNames.find((name) => /\/\.vite\/deps\/three\.module[^/]*\.js/.test(name));
    const threeUrl = resourceNames.find((name) => /\/\.vite\/deps\/three\.js(\?|$)/.test(name))
      ?? (chunkUrl ? chunkUrl.replace(/three\.module[^/?]*\.js/, "three.js") : undefined);
    if (!threeUrl) throw new Error("page three.js module URL not found in resource timing");
    const THREE = await import(/* @vite-ignore */ threeUrl) as {
      PlaneGeometry: new (w: number, h: number) => Geometry;
      MeshStandardMaterial: new (params?: Record<string, unknown>) => Material;
      Mesh: new (geometry: Geometry, material: Material) => Node & { frustumCulled: boolean };
      Color: new () => { setRGB: (r: number, g: number, b: number, colorSpace?: string) => unknown };
      Matrix4: new () => Matrix;
      LinearSRGBColorSpace: string;
    };
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(0.18, 0.18, 0.18, THREE.LinearSRGBColorSpace),
      roughness: 1,
      metalness: 0,
      envMapIntensity: foundSkin.envMapIntensity ?? 1,
    });
    material.name = "openclinxr_18_percent_grey_card_material";
    const MeshCtor = THREE.Mesh;
    const card = new MeshCtor(geometry, material);
    card.frustumCulled = false;
    card.name = "openclinxr_18_percent_grey_card";
    card.position.copy(liveCamera.position).add(ray.multiplyScalar(alongRay));
    card.scale.set(sizeMeters, sizeMeters, 1);
    card.lookAt(liveCamera.position);
    let placementRecord: Record<string, unknown> = { mode: "background_screen_spot" };
    if (placementInput) {
      root.updateMatrixWorld(true);
      const patientRootFrame = new THREE.Matrix4().fromArray(placementInput.patientRootMatrix);
      const targetWorld = root.matrixWorld.clone().multiply(patientRootFrame);
      const targetLocal = scene.matrixWorld.clone().invert().multiply(targetWorld);
      targetLocal.decompose(card.position, card.quaternion, card.scale);
      placementRecord = {
        mode: "app_patient_root_frame",
        source: placementInput.source,
        position: placementInput.position,
        labPatientRootName: root.name ?? "",
        patientRootMatrix: placementInput.patientRootMatrix,
      };
    }
    card.castShadow = false;
    card.receiveShadow = true;
    card.userData["openClinXrGreyCard"] = true;
    scene.add(card);
    card.updateMatrixWorld(true);
    if (requestedCameraMode === "card") {
      if (!placementInput) throw new Error("grey-card camera needs app patient-root placement");
      const normal = new VectorCtor(0, 0, 1).applyQuaternion(card.quaternion).normalize();
      // The app card is lookAt(app camera), so +z is the side the app measured. Flipping toward the
      // lab camera put the camera behind the single-sided card (peds chest_side: 33% lit, no card).
      liveCamera.position.copy(card.position).add(normal.multiplyScalar(placementInput.cameraDistanceMeters));
      liveCamera.lookAt(card.position);
      liveCamera.updateProjectionMatrix();
      liveCamera.updateMatrixWorld(true);
    }
    render();

    const corners = [new VectorCtor(-0.5, -0.5, 0), new VectorCtor(0.5, -0.5, 0), new VectorCtor(-0.5, 0.5, 0), new VectorCtor(0.5, 0.5, 0)]
      .map((corner) => corner.applyMatrix4(card.matrixWorld).project(liveCamera));
    const px = corners.map((p) => ({ x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2 }));
    const normal = new VectorCtor(0, 0, 1).applyQuaternion(card.quaternion).normalize();
    const toCamera = new VectorCtor().copy(liveCamera.position).sub(card.position).normalize();
    const patientMaterials: unknown[] = [];
    root.traverse?.((node) => {
      const flags = node as unknown as { isMesh?: boolean };
      if (!flags.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      for (const entry of materials as Array<Material & { type?: string; color?: { getHexString?: () => string }; userData?: Record<string, unknown> }>) {
        patientMaterials.push({
          meshName: node.name ?? "",
          materialName: entry.name ?? "",
          materialType: entry.type ?? "",
          colorHex: entry.color?.getHexString ? `#${entry.color.getHexString()}` : null,
          mapPresent: Boolean(entry.map),
          openClinXrMaterialPolicy: entry.userData?.["openClinXrMaterialPolicy"] ?? null,
        });
      }
    });
    return {
      projectedBoxPx: {
        x0: Math.max(0, Math.floor(Math.min(...px.map((p) => p.x)))),
        y0: Math.max(0, Math.floor(Math.min(...px.map((p) => p.y)))),
        x1: Math.min(width, Math.ceil(Math.max(...px.map((p) => p.x)))),
        y1: Math.min(height, Math.ceil(Math.max(...px.map((p) => p.y)))),
      },
      worldTransform: { position: card.position.toArray(), quaternion: card.quaternion.toArray(), scale: card.scale.toArray(), matrix: card.matrixWorld.toArray() },
      sizeMeters: placementInput ? card.scale.x : sizeMeters,
      focusTargetDistanceMeters: depth,
      cameraDistanceRatio: card.position.distanceTo(liveCamera.position) / depth,
      facingCameraDegrees: Math.acos(Math.min(1, Math.max(-1, normal.dot(toCamera)))) * 180 / Math.PI,
      linearReflectance: 0.18,
      srgbEncoded: 0.4613,
      roughness: 1,
      metalness: 0,
      envMapIntensity: material.envMapIntensity ?? 1,
      preCardPixelsClear: placementInput ? null : true,
      cameraPoseField: "evidence.packFraming.packCamera",
      greyCardCamera: requestedCameraMode === "card"
        ? { mode: "fixed_card_normal", distanceSource: "app.<position>.worldTransform.cameraDistanceMeters", distanceMeters: placementInput?.cameraDistanceMeters }
        : { mode: "lab_framing" },
      placement: placementRecord,
      labPatientRoot: { objectName: root.name ?? "", source: "globalThis.__openClinXrIsolatedSceneRoot" },
      patientMaterials,
      skinMaterialRows: patientMaterials.filter((row) => /skin|body/i.test(JSON.stringify(row))),
    };
  }, { expected: declaredCamera, placementInput: placement, requestedCameraMode: cameraMode }) as CaptureEvidence["greyCard"];
}

async function screenshotLabCanvas(page: Page, imagePath: string): Promise<void> {
  const canvas = page.locator("#isolated-subject-capture-canvas");
  if (await canvas.count()) await canvas.screenshot({ path: imagePath });
  else await page.screenshot({ path: imagePath });
}

async function runLabLightToggle(page: Page, baselinePath: string, box: Rect, baseline: CardLab): Promise<{
  lightToggle: unknown[];
  restoreCheck: Record<string, unknown>;
}> {
  const lights = await page.evaluate(() => {
    type V = { clone: () => V; applyMatrix4: (matrix: unknown) => V; toArray: () => number[] };
    type Matrix = { clone: () => Matrix; invert: () => Matrix };
    type Node = { name?: string; type?: string; visible?: boolean; userData: Record<string, unknown>; matrixWorld: Matrix; getWorldPosition: (target: V) => V; position: V; updateMatrixWorld: (force: boolean) => void; parent?: Scene | null };
    type Scene = Node & { traverse: (fn: (node: Node) => void) => void };
    const g = globalThis as unknown as { __openClinXrIsolatedSceneRoot?: Node; __openClinXrIsolatedRenderFrame?: () => void };
    const root = g.__openClinXrIsolatedSceneRoot;
    const scene = root?.parent;
    if (!root || !scene?.traverse || !g.__openClinXrIsolatedRenderFrame) throw new Error("isolated lab light hooks unavailable");
    root.updateMatrixWorld(true);
    const inverseRoot = root.matrixWorld.clone().invert();
    const VectorCtor = root.position.constructor as new () => V;
    const found: Array<{ node: Node; type: string; role: string | null; color: string; intensity: number; worldPosition: number[]; patientRootPosition: number[] }> = [];
    scene.traverse((node) => {
      const light = node as Node & { intensity?: unknown; color?: { getHexString?: () => string } };
      if (typeof light.intensity !== "number" || !light.color?.getHexString || light.visible === false) return;
      const world = light.getWorldPosition(new VectorCtor());
      found.push({
        node,
        type: light.type ?? "",
        role: (light.userData["openClinXrLightingRigRole"] ?? light.userData["openClinXrStationInteriorLightingRole"] ?? null) as string | null,
        color: `#${light.color.getHexString()}`,
        intensity: light.intensity,
        worldPosition: world.toArray(),
        patientRootPosition: world.clone().applyMatrix4(inverseRoot).toArray(),
      });
    });
    found.sort((a, b) => (a.role ?? "").localeCompare(b.role ?? "") || a.type.localeCompare(b.type) || a.worldPosition[0]! - b.worldPosition[0]! || a.worldPosition[1]! - b.worldPosition[1]! || a.worldPosition[2]! - b.worldPosition[2]!);
    return found.map(({ node, ...record }, index) => {
      node.userData["openClinXrGreyCardLightToggleIndex"] = index;
      return { index, ...record };
    });
  });
  const setVisible = async (index: number | null, visible: boolean): Promise<boolean> => await page.evaluate(({ lightIndex, nextVisible }) => {
    type Node = { visible?: boolean; userData?: Record<string, unknown> };
    const g = globalThis as unknown as { __openClinXrIsolatedSceneRoot?: { parent?: { traverse: (fn: (node: Node) => void) => void } }; __openClinXrIsolatedRenderFrame?: () => void };
    const scene = g.__openClinXrIsolatedSceneRoot?.parent;
    if (!scene?.traverse || !g.__openClinXrIsolatedRenderFrame) throw new Error("isolated lab light hooks unavailable");
    let found = lightIndex == null;
    scene.traverse((node) => {
      const tagged = node.userData?.["openClinXrGreyCardLightToggleIndex"];
      if (typeof tagged !== "number") return;
      if (lightIndex == null || tagged === lightIndex) {
        node.visible = nextVisible;
        if (tagged === lightIndex) found = true;
      }
    });
    if (!found) throw new Error(`light toggle index ${String(lightIndex)} disappeared`);
    g.__openClinXrIsolatedRenderFrame();
    let allVisible = true;
    scene.traverse((node) => {
      if (typeof node.userData?.["openClinXrGreyCardLightToggleIndex"] === "number" && node.visible !== true) allVisible = false;
    });
    return allVisible;
  }, { lightIndex: index, nextVisible: visible });

  const lightToggle: unknown[] = [];
  for (const light of lights) {
    try {
      await setVisible(light.index, false);
      const togglePath = `${baselinePath}.light-${String(light.index).padStart(2, "0")}-off.png`;
      await screenshotLabCanvas(page, togglePath);
      const cardLab = cardMedianLab(togglePath, box);
      lightToggle.push({ ...light, cardLab, dLstar: baseline.rawMedianLab[0] - cardLab.rawMedianLab[0] });
    } finally {
      await setVisible(light.index, true);
    }
  }
  const allLightsVisible = await setVisible(null, true);
  if (!allLightsVisible) throw new Error("not every lab light was visible after the toggle sweep");
  const restorePath = `${baselinePath}.restore-check.png`;
  await screenshotLabCanvas(page, restorePath);
  const restoredLab = cardMedianLab(restorePath, box);
  const deltaLstar = Math.abs(baseline.rawMedianLab[0] - restoredLab.rawMedianLab[0]);
  if (deltaLstar > 0.1) throw new Error(`lab restore check changed L* by ${deltaLstar}, above 0.1`);
  return { lightToggle, restoreCheck: { png: path.relative(process.cwd(), restorePath), allLightsVisible, cardLab: restoredLab, deltaLstar } };
}

async function applyGreybodyControlIfEnabled(
  page: Page,
  control: {
    skinOverride?: Cli["skinOverride"] | undefined;
    skinSpecular?: Cli["skinSpecular"] | undefined;
  },
): Promise<{ skinMaterialCount: number; materialNames: string[] } | null> {
  if (!control.skinOverride && !control.skinSpecular) return null;
  const applied = await page.evaluate(async ({ override, specular }) => {
    type Color = { setRGB: (r: number, g: number, b: number, colorSpace?: string) => unknown; set: (value: number) => unknown };
    type Material = {
      name: string;
      type?: string;
      isMeshStandardMaterial?: boolean;
      isMeshPhysicalMaterial?: boolean;
      map?: unknown;
      normalMap?: unknown;
      roughnessMap?: unknown;
      aoMap?: unknown;
      bumpMap?: unknown;
      displacementMap?: unknown;
      emissiveMap?: unknown;
      lightMap?: unknown;
      envMap?: unknown;
      emissive?: Color;
      onBeforeCompile?: (shader: { fragmentShader: string }, renderer: unknown) => void;
      customProgramCacheKey?: () => string;
      needsUpdate?: boolean;
      dispose?: () => void;
    };
    type Node = { material?: Material | Material[]; traverse?: (fn: (node: Node) => void) => void };
    const g = globalThis as unknown as {
      __openClinXrIsolatedSceneRoot?: Node;
      __openClinXrIsolatedRenderFrame?: () => void;
    };
    const root = g.__openClinXrIsolatedSceneRoot;
    const render = g.__openClinXrIsolatedRenderFrame;
    if (!root?.traverse || !render) throw new Error("isolated lab grey-body hooks unavailable");
    const matches = (material: Material): boolean => /^mpfb_skin_/iu.test(material.name ?? "");
    const unique = new Set<Material>();
    root.traverse((node) => {
      const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      for (const material of materials) if (matches(material)) unique.add(material);
    });
    if (unique.size === 0) throw new Error("grey-body control found 0 skin materials; refusing capture");

    if (override) {
      const resourceNames = performance.getEntriesByType("resource").map((entry) => entry.name);
      const chunkUrl = resourceNames.find((name) => /\/\.vite\/deps\/three\.module[^/]*\.js/u.test(name));
      const threeUrl = resourceNames.find((name) => /\/\.vite\/deps\/three\.js(\?|$)/u.test(name))
        ?? (chunkUrl ? chunkUrl.replace(/three\.module[^/?]*\.js/u, "three.js") : undefined);
      if (!threeUrl) throw new Error("page three.js module URL not found for grey-body control");
      const THREE = await import(/* @vite-ignore */ threeUrl) as {
        MeshLambertMaterial: new () => Material & { color: Color };
        LinearSRGBColorSpace: string;
      };
      const replacements = new Map<Material, Material>();
      for (const source of unique) {
        const next = new THREE.MeshLambertMaterial();
        next.name = source.name;
        next.color.setRGB(override.albedo, override.albedo, override.albedo, THREE.LinearSRGBColorSpace);
        next.map = null;
        next.normalMap = null;
        next.roughnessMap = null;
        next.aoMap = null;
        next.bumpMap = null;
        next.displacementMap = null;
        next.emissiveMap = null;
        next.lightMap = null;
        next.envMap = null;
        next.emissive?.set(0);
        next.needsUpdate = true;
        replacements.set(source, next);
      }
      root.traverse((node) => {
        if (Array.isArray(node.material)) node.material = node.material.map((material) => replacements.get(material) ?? material);
        else if (node.material) node.material = replacements.get(node.material) ?? node.material;
      });
    } else if (specular === "off") {
      for (const material of unique) {
        if (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) {
          throw new Error(`skin material ${material.name} is ${material.type ?? "unknown"}; no separable specular term`);
        }
        const priorCacheKey = material.customProgramCacheKey?.bind(material);
        const installedKey = priorCacheKey?.() ?? "";
        if (!installedKey.startsWith("openclinxr-skin-shade:")) {
          throw new Error(`skin material ${material.name} has no separable OPENCLINXR skin-shade specular term`);
        }
        const priorCompile = material.onBeforeCompile?.bind(material);
        material.onBeforeCompile = (shader, renderer) => {
          priorCompile?.(shader, renderer);
          const marker = "#include <lights_fragment_end>";
          if (!shader.fragmentShader.includes(marker)) {
            throw new Error(`skin material ${material.name} shader lacks lights_fragment_end`);
          }
          shader.fragmentShader = shader.fragmentShader.replace(
            marker,
            `${marker}\nreflectedLight.directSpecular = vec3(0.0);\nreflectedLight.indirectSpecular = vec3(0.0);`,
          );
        };
        material.customProgramCacheKey = () => `${installedKey}:greybody-specular-off`;
        material.needsUpdate = true;
      }
    }
    render();
    return { skinMaterialCount: unique.size, materialNames: [...unique].map((material) => material.name).sort() };
  }, { override: control.skinOverride ?? null, specular: control.skinSpecular ?? null });
  console.log(`grey-body control found ${applied.skinMaterialCount} skin material(s): ${applied.materialNames.join(", ")}`);
  return applied;
}

async function measurePatchGeometry(
  page: Page,
  mask: Mask,
  crop: Rect,
): Promise<PatchGeometry> {
  const serialMask = mask.kind === "bitmap"
    ? { ...mask, bits: Array.from(mask.bits) }
    : mask;
  return await page.evaluate(({ measuredMask, cropPx }) => {
    type V = {
      x: number; y: number; z: number;
      add: (v: V) => V; sub: (v: V) => V; subVectors: (a: V, b: V) => V;
      cross: (v: V) => V; normalize: () => V; multiplyScalar: (n: number) => V;
      dot: (v: V) => number; lengthSq: () => number; applyMatrix4: (m: unknown) => V;
      applyQuaternion: (q: unknown) => V; transformDirection: (m: unknown) => V; project: (camera: unknown) => V; toArray: () => number[];
      copy: (v: V) => V; set: (x: number, y: number, z: number) => V;
      constructor: new (x?: number, y?: number, z?: number) => V;
    };
    type Attribute = { count: number };
    type Index = { count: number; getX: (i: number) => number };
    type Material = { name?: string };
    type Node = {
      name?: string;
      material?: Material | Material[];
      geometry?: { attributes?: { position?: Attribute }; index?: Index | null };
      matrixWorld: unknown;
      quaternion?: unknown;
      position: V;
      target?: Node;
      intensity?: number;
      userData?: Record<string, unknown>;
      isSkinnedMesh?: boolean;
      isDirectionalLight?: boolean;
      isSpotLight?: boolean;
      isPointLight?: boolean;
      getVertexPosition?: (index: number, target: V) => V;
      getWorldPosition?: (target: V) => V;
      traverse?: (fn: (node: Node) => void) => void;
    };
    type Camera = Node;
    type Renderer = { domElement: { width: number; height: number } };
    const g = globalThis as unknown as {
      __openClinXrIsolatedSceneRoot?: Node;
      __openClinXrIsolatedRenderFrame?: () => void;
    };
    const root = g.__openClinXrIsolatedSceneRoot;
    const render = g.__openClinXrIsolatedRenderFrame;
    const scene = root?.position ? (root as unknown as { parent?: Node }).parent : undefined;
    if (!root?.traverse || !scene?.traverse || !render) throw new Error("patch-geometry hooks unavailable");
    let renderer: Renderer | null = null;
    let camera: Camera | null = null;
    const sceneWithHook = scene as Node & { onAfterRender?: (...args: unknown[]) => void };
    const priorAfterRender = sceneWithHook.onAfterRender;
    sceneWithHook.onAfterRender = (...args: unknown[]) => {
      renderer = args[0] as Renderer;
      camera = args[2] as Camera;
      priorAfterRender?.(...args);
    };
    render();
    if (priorAfterRender) sceneWithHook.onAfterRender = priorAfterRender;
    else delete sceneWithHook.onAfterRender;
    if (!renderer || !camera) throw new Error("patch-geometry render hook did not expose renderer/camera");
    const liveRenderer = renderer as Renderer;
    const liveCamera = camera as Camera;
    const VectorCtor = liveCamera.position.constructor;
    const insideMask = (x: number, y: number): boolean => {
      const localX = x - cropPx.x0;
      const localY = y - cropPx.y0;
      if (measuredMask.excludeRects?.some((r) => localX >= r.x0 && localX < r.x1 && localY >= r.y0 && localY < r.y1)) return false;
      if (measuredMask.kind === "bitmap") {
        const ix = Math.floor(localX), iy = Math.floor(localY);
        return ix >= 0 && iy >= 0 && ix < measuredMask.w && iy < measuredMask.h && measuredMask.bits[iy * measuredMask.w + ix] === 1;
      }
      if (measuredMask.kind === "rects") return measuredMask.rects.some((r) => localX >= r.x0 && localX < r.x1 && localY >= r.y0 && localY < r.y1);
      return measuredMask.discs.some((d) => {
        const radius = Math.hypot(localX - d.cx, localY - d.cy);
        return radius >= d.r0 && radius < d.r1;
      });
    };
    const width = liveRenderer.domElement.width;
    const height = liveRenderer.domElement.height;
    const selected = new Set<string>();
    const weightedNormal = new VectorCtor();
    const centroid = new VectorCtor();
    let selectedWeight = 0;
    root.traverse((node) => {
      const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      if (!materials.some((material) => /^mpfb_skin_/iu.test(material.name ?? ""))) return;
      const position = node.geometry?.attributes?.position;
      const getVertex = node.getVertexPosition?.bind(node);
      if (!position || !getVertex) return;
      const index = node.geometry?.index ?? null;
      const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
      const local = [new VectorCtor(), new VectorCtor(), new VectorCtor()];
      for (let triangle = 0; triangle < triangleCount; triangle += 1) {
        const ids = [0, 1, 2].map((corner) => index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner);
        const world = ids.map((id, corner) => getVertex(id, local[corner]!).applyMatrix4(node.matrixWorld));
        const faceWeighted = new VectorCtor().subVectors(world[1]!, world[0]!).cross(new VectorCtor().subVectors(world[2]!, world[0]!));
        if (faceWeighted.lengthSq() <= 1e-20) continue;
        for (let corner = 0; corner < 3; corner += 1) {
          const projected = new VectorCtor().copy(world[corner]!).project(liveCamera);
          const px = (projected.x + 1) * width / 2;
          const py = (1 - projected.y) * height / 2;
          if (!insideMask(px, py)) continue;
          const key = `${node.name ?? "skin"}:${ids[corner]}`;
          if (!selected.has(key)) {
            selected.add(key);
            centroid.add(world[corner]!);
          }
          weightedNormal.add(faceWeighted);
          selectedWeight += Math.sqrt(faceWeighted.lengthSq());
        }
      }
    });
    if (selected.size === 0 || selectedWeight <= 0 || weightedNormal.lengthSq() <= 1e-20) {
      throw new Error("patch-geometry mask selected 0 skin vertices");
    }
    centroid.multiplyScalar(1 / selected.size);
    weightedNormal.normalize();
    let card: Node | null = null;
    let exactKeyLight: Node | null = null;
    let fallbackKeyLight: Node | null = null;
    scene.traverse((node) => {
      if (node.userData?.["openClinXrGreyCard"] === true) card = node;
      const role = node.userData?.["openClinXrLightingRigRole"] ?? node.userData?.["openClinXrStationInteriorLightingRole"];
      const supportedLight = node.isDirectionalLight || node.isSpotLight || node.isPointLight;
      if (!exactKeyLight && role === "key" && supportedLight) exactKeyLight = node;
      if (!fallbackKeyLight && /(^|_)key($|_)/iu.test(node.name ?? "") && supportedLight) fallbackKeyLight = node;
    });
    const foundCard = card as Node | null;
    const foundKey = (exactKeyLight ?? fallbackKeyLight) as Node | null;
    if (!foundCard) throw new Error("patch-geometry grey card unavailable");
    if (!foundKey) throw new Error("patch-geometry key light unavailable");
    const cardNormal = new VectorCtor(0, 0, 1).transformDirection(foundCard.matrixWorld).normalize();
    const lightPosition = foundKey.getWorldPosition ? foundKey.getWorldPosition(new VectorCtor()) : new VectorCtor().copy(foundKey.position);
    const directionAt = (point: V): V => {
      if (foundKey.isDirectionalLight && foundKey.target) {
        const targetPosition = foundKey.target.getWorldPosition ? foundKey.target.getWorldPosition(new VectorCtor()) : new VectorCtor().copy(foundKey.target.position);
        return new VectorCtor().subVectors(lightPosition, targetPosition).normalize();
      }
      return new VectorCtor().subVectors(lightPosition, point).normalize();
    };
    const patchDirection = directionAt(centroid);
    const cardPosition = foundCard.getWorldPosition ? foundCard.getWorldPosition(new VectorCtor()) : new VectorCtor().copy(foundCard.position);
    const cardDirection = directionAt(cardPosition);
    return {
      meanNormal: weightedNormal.toArray() as [number, number, number],
      cosKey: weightedNormal.dot(patchDirection),
      cardNormal: cardNormal.toArray() as [number, number, number],
      cardCosKey: cardNormal.dot(cardDirection),
      vertexCount: selected.size,
    };
  }, { measuredMask: serialMask, cropPx: crop });
}

async function captureVariant(input: {
  page: Page;
  baseUrl: string;
  actor: string;
  variant: "original" | "new";
  lightingSpec: Record<string, unknown>;
  framing: "face" | "eyes" | "cheek" | "forearm" | "neck" | "shin" | "forearm-close" | "neck-close";
  captureSize: number;
  imagePath: string;
  greyCard: boolean;
  greyCardPlacement: GreyCardPlacement | null;
  greyCardCamera: Cli["greyCardCamera"];
  lightToggle: boolean;
  skinOverride?: Cli["skinOverride"];
  skinSpecular?: Cli["skinSpecular"];
}): Promise<Captured> {
  const spec = buildCaptureSpec(input);
  let evidence = await captureOne({
    page: input.page,
    baseUrl: input.baseUrl,
    size: input.captureSize,
    imagePath: input.imagePath,
    spec,
  }) as CaptureEvidence;
  const greybody = await applyGreybodyControlIfEnabled(input.page, input);
  if (greybody) await screenshotLabCanvas(input.page, input.imagePath);
  if (input.greyCard) {
    const greyCard = await runGreyCardHookIfEnabled(true, () => injectHarnessGreyCard(input.page, evidence, input.greyCardPlacement, input.greyCardCamera));
    if (!greyCard) throw new Error("enabled grey-card hook did not run");
    evidence = { ...evidence, greyCard };
    await screenshotLabCanvas(input.page, input.imagePath);
    // A region pass keeps the card hook but not its camera, so the card may sit off frame
    // (forearm). Record that; a card-camera pass still refuses an empty box.
    const frame = pngFrameSize(readFileSync(input.imagePath));
    if (resolveCaptureCardOutcome(greyCard.projectedBoxPx, frame, input.greyCardCamera === "card") === "off_frame") {
      return {
        imagePath: input.imagePath,
        evidence,
        readback: await readLive(input.page),
        captureSize: input.captureSize,
        instrumentation: {
          cardLab: null,
          cardOffFrame: true,
          lightToggle: [],
          restoreCheck: null,
          patientMaterials: (greyCard["patientMaterials"] as unknown[]) ?? [],
          skinMaterialRows: (greyCard["skinMaterialRows"] as unknown[]) ?? [],
        },
      };
    }
    const cardLab = cardMedianLab(input.imagePath, greyCard.projectedBoxPx);
    const toggled = input.lightToggle
      ? await runLabLightToggle(input.page, input.imagePath, greyCard.projectedBoxPx, cardLab)
      : { lightToggle: [], restoreCheck: null };
    return {
      imagePath: input.imagePath,
      evidence,
      readback: await readLive(input.page),
      captureSize: input.captureSize,
      instrumentation: {
        cardLab,
        ...toggled,
        patientMaterials: (greyCard["patientMaterials"] as unknown[]) ?? [],
        skinMaterialRows: (greyCard["skinMaterialRows"] as unknown[]) ?? [],
      },
    };
  }
  return { imagePath: input.imagePath, evidence, readback: await readLive(input.page), captureSize: input.captureSize };
}

export function buildCaptureSpec(input: {
  actor: string;
  variant: "original" | "new";
  lightingSpec: Record<string, unknown>;
  framing: "face" | "eyes" | "cheek" | "forearm" | "neck" | "shin" | "forearm-close" | "neck-close";
  captureSize: number;
  greyCard: boolean;
}): Record<string, unknown> {
  const isBody = input.framing === "forearm" || input.framing === "neck" || input.framing === "shin";
  const isClose = input.framing === "forearm-close" || input.framing === "neck-close";
  const portrait = (!isBody && input.framing !== "eyes") || isClose;
  return {
    subjectId: `${input.actor}_${input.variant}_${input.framing}`,
    subjectKind: "glb",
    bodyGlb: `/__vitcompare/${input.actor}/${input.variant}.glb`,
    view: "front",
    ...(!isBody && !isClose && input.framing !== "eyes" ? { focus: "head" as const }
      : !isBody && !isClose ? { focus: "eyes" as const }
      : isClose ? { focus: input.framing === "forearm-close" ? "forearm" as const : "neck" as const }
      : {}),
    hideHair: true,
    subjectOnly: true,
    renderSize: input.captureSize,
    skinShadeLoader: true,
    yawDegrees: 0,
    ...(portrait ? { portrait } : {}),
    ...input.lightingSpec,
    label: `${input.actor} ${input.variant} ${input.framing}`,
  };
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

function unionRect(a: Rect, b: Rect): Rect {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

function greyCardBoxAfterCrop(capture: Captured, crop: Rect): Rect | null {
  const box = capture.evidence.greyCard?.projectedBoxPx;
  if (!box) return null;
  const x0 = Math.max(box.x0, crop.x0), y0 = Math.max(box.y0, crop.y0);
  const x1 = Math.min(box.x1, crop.x1), y1 = Math.min(box.y1, crop.y1);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0: x0 - crop.x0, y0: y0 - crop.y0, x1: x1 - crop.x0, y1: y1 - crop.y0 };
}

function greyCardManifest(capture: Captured, crop: Rect): Record<string, unknown> | null {
  if (!capture.evidence.greyCard) return null;
  const { box: greyCardBoxPx, offFrame } = resolveCardCropBox(greyCardBoxAfterCrop(capture, crop), capture.instrumentation?.cardOffFrame === true);
  return {
    greyCardBoxPx,
    ...(offFrame ? { greyCardOffFrame: true } : {}),
    greyCardSourceBoxPx: capture.evidence.greyCard.projectedBoxPx,
    greyCardWorldTransform: capture.evidence.greyCard.worldTransform,
    greyCard: capture.evidence.greyCard,
    ...(capture.instrumentation ?? {}),
  };
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

// st-vitbody S6: lit-subject test. Background is the lab flat BG #18211d;
// the >36 threshold mirrors isolated-subject-lab.ts.
function isLitPixel(r: number, g: number, b: number): boolean {
  return Math.abs(r - 0x18) + Math.abs(g - 0x21) + Math.abs(b - 0x1d) > 36;
}

// st-vitbody S6: native body-region crops from an asset-derived boxes file
// (E/compare/bodyboxes.json: stored POSITIONs of dominant-joint verts
// projected through the manifest packCamera; bind-pose render verified to
// ±9px against the lit silhouette). Same box applies to ORIGINAL and NEW
// (identical geometry, identical camera), so placement cannot bias ORIG-vs-NEW.
function bodyCrop(captureSize: number, boxesPath: string, region: "forearm" | "neck" | "shin"): { crop: Rect; method: string } {
  const boxes = JSON.parse(readFileSync(path.resolve(process.cwd(), boxesPath), "utf8")) as {
    size: number; method: string; forearm: Rect; neck: Rect; shin: Rect;
  };
  if (boxes.size !== captureSize) throw new Error(`--boxes size ${boxes.size} != capture size ${captureSize}`);
  const box = boxes[region];
  if (!box) throw new Error(`--boxes ${boxesPath} lacks region ${region}`);
  const crop = { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 };
  const w = crop.x1 - crop.x0, h = crop.y1 - crop.y0;
  if (w < 64 || h < 64) throw new Error(`${region} box too small: ${w}x${h}`);
  return { crop, method: `${boxes.method}; boxes file ${boxesPath}` };
}

// Gate + metric mask: lit pixels of the ORIGINAL crop (background excluded
// from stats; the identical mask on NEW inherits the verdict — same
// geometry, same lighting, per-pixel differences ~0). Misplaced boxes trip
// the <20% lit alarm; fully empty boxes trip regionStats' empty-mask throw.
// A close crop fills the frame with the subject, so < 20% lit means the box missed it. Under
// --grey-card-camera card the frame holds the card beside the torso on dark ground, so the frame
// fraction says nothing; the gate is on the card itself: >= 90% of its box must be lit pixels.
const LIT_FRACTION_MIN_CLOSE = 0.2;
const CARD_BOX_LIT_FRACTION_MIN = 0.9;
type LitGate = { kind: "close" } | { kind: "card_camera" };
function litBitmap(cropPath: string, region: string, greyCardBoxPx: Rect | null, gate: LitGate = { kind: "close" }): { mask: Mask; litFraction: number; cardGate?: { cardBoxLitFraction: number; cardBoxPx: number; framePx: number } } {
  const png = decodePng(cropPath);
  const bits = new Uint8Array(png.w * png.h);
  let lit = 0, cardPx = 0, cardLit = 0;
  for (let y = 0; y < png.h; y += 1) {
    for (let x = 0; x < png.w; x += 1) {
      const i = (y * png.w + x) * png.chans;
      const cr = png.data[i]!, cg = png.data[i + 1] ?? cr, cb = png.data[i + 2] ?? cr;
      const inCard = greyCardBoxPx != null && x >= greyCardBoxPx.x0 && x < greyCardBoxPx.x1 && y >= greyCardBoxPx.y0 && y < greyCardBoxPx.y1;
      if (inCard) {
        cardPx += 1;
        if (isLitPixel(cr, cg, cb)) cardLit += 1;
      } else if (isLitPixel(cr, cg, cb)) {
        bits[y * png.w + x] = 1;
        lit += 1;
      }
    }
  }
  const framePx = png.w * png.h;
  const frac = lit / framePx;
  const mask: Mask = { kind: "bitmap", w: png.w, h: png.h, bits };
  if (gate.kind === "card_camera") {
    if (!greyCardBoxPx || cardPx === 0) throw new Error(`${region} card-camera frame has no grey-card box`);
    const cardBoxLitFraction = cardLit / cardPx;
    if (cardBoxLitFraction < CARD_BOX_LIT_FRACTION_MIN) throw new Error(`${region} card box only ${(cardBoxLitFraction * 100).toFixed(1)}% lit (< ${CARD_BOX_LIT_FRACTION_MIN * 100}%) — the card camera missed the card`);
    return { mask, litFraction: frac, cardGate: { cardBoxLitFraction, cardBoxPx: cardPx, framePx } };
  }
  if (frac < LIT_FRACTION_MIN_CLOSE) throw new Error(`${region} crop only ${(frac * 100).toFixed(1)}% lit — box misses the subject`);
  return { mask, litFraction: frac };
}

// Debug overlay: ORIGINAL whole-body source with the crop box painted red.
async function writeCropOverlay(sourcePath: string, crop: Rect, outPath: string): Promise<void> {
  const png = decodePng(sourcePath);
  const rgb = new Uint8Array(png.w * png.h * 3);
  for (let p = 0; p < png.w * png.h; p += 1) {
    const i = p * png.chans;
    rgb[p * 3] = png.data[i]!;
    rgb[p * 3 + 1] = png.data[i + 1] ?? png.data[i]!;
    rgb[p * 3 + 2] = png.data[i + 2] ?? png.data[i]!;
  }
  const r = clampRect(crop, png.w, png.h);
  for (let x = r.x0; x < r.x1; x += 1) {
    for (const y of [r.y0, r.y0 + 1, r.y0 + 2, r.y1 - 1, r.y1 - 2, r.y1 - 3]) {
      if (y < 0 || y >= png.h) continue;
      const di = (y * png.w + x) * 3;
      rgb[di] = 255; rgb[di + 1] = 0; rgb[di + 2] = 0;
    }
  }
  for (let y = r.y0; y < r.y1; y += 1) {
    for (const x of [r.x0, r.x0 + 1, r.x0 + 2, r.x1 - 1, r.x1 - 2, r.x1 - 3]) {
      if (x < 0 || x >= png.w) continue;
      const di = (y * png.w + x) * 3;
      rgb[di] = 255; rgb[di + 1] = 0; rgb[di + 2] = 0;
    }
  }
  await writeFile(outPath, encodePngRgb(png.w, png.h, rgb));
}

function metricRecord(orig: RegionStats, candidate: RegionStats): Record<string, unknown> {
  return {
    original: orig,
    new: candidate,
    deltaE76OrigToNew: Math.round(deltaE76(orig, candidate) * 1_000_000) / 1_000_000,
    method: "deltaE76 between region mean sRGB converted to CIELAB D65; luminance SD in encoded sRGB; high-pass energy is residual variance after separable Gaussian sigma=2px",
  };
}

// st-vitbody S6: whole-body 4096 capture + asset-derived native crop for one
// body region. Returns records shaped like the head path's lighting entry.
async function captureBodyRegion(input: {
  page: Page;
  serverUrl: string;
  subject: { actor: string; original: { servedUrl: string }; candidate: { servedUrl: string } };
  lighting: { id: string; rigId: string; spec: Record<string, unknown> };
  lightOut: string;
  cli: Cli;
}): Promise<{
  pixelIdentical: boolean;
  regionDeltas: Array<{ actor: string; lighting: string; region: string; deltaE76: number }>;
  calibration: { actor: string; lighting: string; rigId: string; meanFaceLuminance: number };
  lightingRecord: Record<string, unknown>;
}> {
  const region = input.cli.region as "forearm" | "neck" | "shin";
  const frameOut = path.join(input.lightOut, region);
  await mkdir(frameOut, { recursive: true });
  const captureSize = LAB_RENDER_SIZE_MAX;
  const origSource = path.join(frameOut, ".source-orig.png");
  const newSource = path.join(frameOut, ".source-new.png");
  const placement = readGreyCardPlacement(process.cwd(), input.cli);
  const original = await captureVariant({ page: input.page, baseUrl: input.serverUrl, actor: input.subject.actor, variant: "original", lightingSpec: input.lighting.spec, framing: region, captureSize, imagePath: origSource, greyCard: input.cli.greyCard, greyCardPlacement: placement, greyCardCamera: input.cli.greyCardCamera, lightToggle: input.cli.lightToggle, skinOverride: input.cli.skinOverride, skinSpecular: input.cli.skinSpecular });
  const candidate = await captureVariant({ page: input.page, baseUrl: input.serverUrl, actor: input.subject.actor, variant: "new", lightingSpec: input.lighting.spec, framing: region, captureSize, imagePath: newSource, greyCard: input.cli.greyCard, greyCardPlacement: placement, greyCardCamera: input.cli.greyCardCamera, lightToggle: false, skinOverride: input.cli.skinOverride, skinSpecular: input.cli.skinSpecular });
  cameraComparable(original, candidate);
  const { crop: subjectCrop, method } = bodyCrop(captureSize, input.cli.boxes!, region);
  const crop = original.evidence.greyCard
    ? unionRect(subjectCrop, original.evidence.greyCard.projectedBoxPx)
    : subjectCrop;
  const origPng = path.join(frameOut, "orig.png");
  const newPng = path.join(frameOut, "new.png");
  const clampedOrig = await writeNativeCrop(origSource, origPng, crop);
  const clampedNew = await writeNativeCrop(newSource, newPng, crop);
  if (clampedOrig.x1 - clampedOrig.x0 !== clampedNew.x1 - clampedNew.x0 ||
      clampedOrig.y1 - clampedOrig.y0 !== clampedNew.y1 - clampedNew.y0) {
    throw new Error(`${input.subject.actor}/${input.lighting.id}/${region}: crop clamped differently on ORIGINAL vs NEW`);
  }
  await writeCropOverlay(origSource, crop, path.join(frameOut, "crop-box.png"));
  await writeSideBySide(origPng, newPng, path.join(frameOut, "side-by-side.png"));
  const diff = await writeDiffHeatmap(origPng, newPng, path.join(frameOut, "absolute-diff.png"));
  const cardRecord = greyCardManifest(original, clampedOrig);
  const cardBox = (cardRecord?.["greyCardBoxPx"] as Rect | undefined) ?? null;
  const { mask: fullMask, litFraction: litFrac } = litBitmap(origPng, region, cardBox);
  const orig = regionStats(origPng, fullMask);
  const next = regionStats(newPng, fullMask);
  const delta = Math.round(deltaE76(orig, next) * 1_000_000) / 1_000_000;
  const metric = { ...metricRecord(orig, next), framing: region, maskMethod: `${method}; lit-bitmap mask from ORIGINAL crop (bg excluded, same mask on NEW)` };
  const patchGeometry = (input.cli.skinOverride || input.cli.skinSpecular) && !input.cli.greyCardCamera
    ? await measurePatchGeometry(input.page, fullMask, clampedNew)
    : null;
  const numbers = withRecordedSubjectCrop({
    actor: input.subject.actor,
    lighting: input.lighting.id,
    rigId: input.lighting.rigId,
    framing: region,
    imageSize: { width: clampedOrig.x1 - clampedOrig.x0, height: clampedOrig.y1 - clampedOrig.y0 },
    nativeSourceSize: captureSize,
    nativeCrop: clampedOrig,
    cropLitFraction: Math.round(litFrac * 10000) / 10000,
    camera: original.readback.portrait ?? original.evidence.packFraming,
    focusRegion: original.evidence.focusRegion,
    rendererReadback: original.readback.renderer,
    lightsReadback: original.readback.lights,
    productRigReadback: original.readback.productRig,
    ...instrumentOnly(input.cli),
    regions: { [region]: metric },
    ...(patchGeometry ? { patchGeometry } : {}),
    ...(cardRecord ?? {}),
  }, clampedOrig, subjectCrop);
  await writeFile(path.join(frameOut, "numbers.json"), `${JSON.stringify(numbers, null, 2)}\n`, "utf8");
  const cropLuminance = meanLuminance(origPng, fullMask);
  return {
    pixelIdentical: diff.pixelIdentical,
    regionDeltas: [{ actor: input.subject.actor, lighting: input.lighting.id, region, deltaE76: delta }],
    calibration: { actor: input.subject.actor, lighting: input.lighting.id, rigId: input.lighting.rigId, meanFaceLuminance: Math.round(cropLuminance * 1000) / 1000 },
    lightingRecord: {
      rigId: input.lighting.rigId,
      rendererReadback: original.readback.renderer,
      lightsReadback: original.readback.lights,
      productRigReadback: original.readback.productRig,
      framingGates: { region, boxesFile: input.cli.boxes, cropLitFraction: Math.round(litFrac * 10000) / 10000, cropPixels: (clampedOrig.x1 - clampedOrig.x0) * (clampedOrig.y1 - clampedOrig.y0) },
      frames: {
        [region]: {
          directory: path.relative(process.cwd(), frameOut).replaceAll("\\", "/"),
          origSha256: sha256File(origPng),
          newSha256: sha256File(newPng),
          sideBySideSha256: sha256File(path.join(frameOut, "side-by-side.png")),
          diffSha256: sha256File(path.join(frameOut, "absolute-diff.png")),
          camera: numbers.camera,
          focusRegion: original.evidence.focusRegion,
          ...(patchGeometry ? { patchGeometry } : {}),
          ...(cardRecord ?? {}),
        },
      },
      regions: { [region]: metric },
      meanFaceLuminance: Math.round(cropLuminance * 1000) / 1000,
    },
  };
}

// st-vitbody r4: native body close-up through the portrait path. The lab frames
// the asset-derived region box (forearm_box / neck_close_box focusRegion) with
// the same framePortraitCamera solve the head path uses (fov 24, 78% fill) —
// no second camera path. The full 4096 frame IS the sheet (native 1:1, no crop,
// no resampling). px/mm comes from the asset-derived box metres and the live
// projected box px, the same construction as the cheek gate.
const CLOSE_PX_PER_MM_MIN = 10;

async function captureCloseRegion(input: {
  page: Page;
  serverUrl: string;
  subject: { actor: string; original: { servedUrl: string }; candidate: { servedUrl: string } };
  lighting: { id: string; rigId: string; spec: Record<string, unknown> };
  lightOut: string;
  cli: Cli;
}): Promise<{
  pixelIdentical: boolean;
  regionDeltas: Array<{ actor: string; lighting: string; region: string; deltaE76: number }>;
  calibration: { actor: string; lighting: string; rigId: string; meanFaceLuminance: number };
  lightingRecord: Record<string, unknown>;
}> {
  const region = input.cli.region as "forearm-close" | "neck-close";
  const frameOut = path.join(input.lightOut, region);
  await mkdir(frameOut, { recursive: true });
  const captureSize = LAB_RENDER_SIZE_MAX;
  const origSource = path.join(frameOut, ".source-orig.png");
  const newSource = path.join(frameOut, ".source-new.png");
  const placement = readGreyCardPlacement(process.cwd(), input.cli);
  const original = await captureVariant({ page: input.page, baseUrl: input.serverUrl, actor: input.subject.actor, variant: "original", lightingSpec: input.lighting.spec, framing: region, captureSize, imagePath: origSource, greyCard: input.cli.greyCard, greyCardPlacement: placement, greyCardCamera: input.cli.greyCardCamera, lightToggle: input.cli.lightToggle, skinOverride: input.cli.skinOverride, skinSpecular: input.cli.skinSpecular });
  const candidate = await captureVariant({ page: input.page, baseUrl: input.serverUrl, actor: input.subject.actor, variant: "new", lightingSpec: input.lighting.spec, framing: region, captureSize, imagePath: newSource, greyCard: input.cli.greyCard, greyCardPlacement: placement, greyCardCamera: input.cli.greyCardCamera, lightToggle: false, skinOverride: input.cli.skinOverride, skinSpecular: input.cli.skinSpecular });
  cameraComparable(original, candidate);
  const wantKind = region === "forearm-close" ? "forearm_box" : "neck_close_box";
  const focusBounds = original.evidence.focusRegion && "boundsMeters" in original.evidence.focusRegion
    ? (original.evidence.focusRegion as { kind?: string; boundsMeters: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } })
    : null;
  if (!focusBounds || (focusBounds as { kind?: string }).kind !== wantKind || !focusBounds.boundsMeters) {
    throw new Error(`${input.subject.actor}/${input.lighting.id}/${region}: expected lab focusRegion ${wantKind}, got ${JSON.stringify(original.evidence.focusRegion)}`);
  }
  const boxPx = original.readback.portrait?.headBoxPx;
  if (!boxPx) throw new Error(`${input.subject.actor}/${input.lighting.id}/${region}: close capture has no live projected box`);
  const widthM = focusBounds.boundsMeters.max.x - focusBounds.boundsMeters.min.x;
  const heightM = focusBounds.boundsMeters.max.y - focusBounds.boundsMeters.min.y;
  if (!(widthM > 0) || !(heightM > 0)) throw new Error(`${input.subject.actor}/${input.lighting.id}/${region}: degenerate focus box metres`);
  const widthPx = boxPx.x1 - boxPx.x0;
  const heightPx = boxPx.y1 - boxPx.y0;
  const closePxPerMm = widthPx / (widthM * 1000);
  const closePxPerMmHeight = heightPx / (heightM * 1000);
  if (closePxPerMm < CLOSE_PX_PER_MM_MIN) {
    throw new Error(`${input.subject.actor}/${input.lighting.id}/${region}: close-up ${closePxPerMm.toFixed(3)} px/mm < ${CLOSE_PX_PER_MM_MIN} (max reached with the portrait focus mechanism; st-vitbody r4 X1)`);
  }
  const origPng = path.join(frameOut, "orig.png");
  const newPng = path.join(frameOut, "new.png");
  await copyPngRgb(origSource, origPng);
  await copyPngRgb(newSource, newPng);
  await writeSideBySide(origPng, newPng, path.join(frameOut, "side-by-side.png"));
  const diff = await writeDiffHeatmap(origPng, newPng, path.join(frameOut, "absolute-diff.png"));
  const fullCrop = { x0: 0, y0: 0, x1: captureSize, y1: captureSize };
  const cardRecord = greyCardManifest(original, fullCrop);
  const cardBox = (cardRecord?.["greyCardBoxPx"] as Rect | undefined) ?? null;
  const { mask: fullMask, litFraction: litFrac, cardGate } = litBitmap(origPng, region, cardBox, input.cli.greyCardCamera === "card" ? { kind: "card_camera" } : { kind: "close" });
  const orig = regionStats(origPng, fullMask);
  const next = regionStats(newPng, fullMask);
  const delta = Math.round(deltaE76(orig, next) * 1_000_000) / 1_000_000;
  const patchGeometry = (input.cli.skinOverride || input.cli.skinSpecular) && !input.cli.greyCardCamera
    ? await measurePatchGeometry(input.page, fullMask, fullCrop)
    : null;
  const numbers = withRecordedSubjectCrop({
    actor: input.subject.actor,
    lighting: input.lighting.id,
    rigId: input.lighting.rigId,
    framing: region,
    imageSize: { width: captureSize, height: captureSize },
    nativeSourceSize: captureSize,
    nativeCrop: null,
    cropLitFraction: Math.round(litFrac * 10000) / 10000,
    ...(cardGate ? { litGate: "card_camera_card_box", cardBoxLitFraction: Math.round(cardGate.cardBoxLitFraction * 10000) / 10000, cardBoxPx: cardGate.cardBoxPx, framePx: cardGate.framePx, cardBoxFrameFraction: Math.round((cardGate.cardBoxPx / cardGate.framePx) * 10000) / 10000 } : { litGate: "close_crop_frame_fraction" }),
    closePxPerMm: Math.round(closePxPerMm * 1000) / 1000,
    closePxPerMmHeight: Math.round(closePxPerMmHeight * 1000) / 1000,
    closePxPerMmMethod: "live projected region-box width px in the close capture / asset-derived region width mm (height cross-check beside it); native frame, no resampling or cropping",
    camera: original.readback.portrait ?? original.evidence.packFraming,
    focusRegion: original.evidence.focusRegion,
    rendererReadback: original.readback.renderer,
    lightsReadback: original.readback.lights,
    productRigReadback: original.readback.productRig,
    ...instrumentOnly(input.cli),
    regions: { [region]: { ...metricRecord(orig, next), framing: region, maskMethod: "lit-bitmap mask from ORIGINAL close frame (bg excluded, same mask on NEW)" } },
    ...(patchGeometry ? { patchGeometry } : {}),
    ...(cardRecord ?? {}),
  }, fullCrop, fullCrop);
  await writeFile(path.join(frameOut, "numbers.json"), `${JSON.stringify(numbers, null, 2)}\n`, "utf8");
  const cropLuminance = meanLuminance(origPng, fullMask);
  return {
    pixelIdentical: diff.pixelIdentical,
    regionDeltas: [{ actor: input.subject.actor, lighting: input.lighting.id, region, deltaE76: delta }],
    calibration: { actor: input.subject.actor, lighting: input.lighting.id, rigId: input.lighting.rigId, meanFaceLuminance: Math.round(cropLuminance * 1000) / 1000 },
    lightingRecord: {
      rigId: input.lighting.rigId,
      rendererReadback: original.readback.renderer,
      lightsReadback: original.readback.lights,
      productRigReadback: original.readback.productRig,
      framingGates: {
        region,
        closePxPerMm: Math.round(closePxPerMm * 1000) / 1000,
        closePxPerMmHeight: Math.round(closePxPerMmHeight * 1000) / 1000,
        closePxPerMmMethod: numbers.closePxPerMmMethod,
        captureSize,
        cropLitFraction: Math.round(litFrac * 10000) / 10000,
        cropPixels: captureSize * captureSize,
      },
      frames: {
        [region]: {
          directory: path.relative(process.cwd(), frameOut).replaceAll("\\", "/"),
          origSha256: sha256File(origPng),
          newSha256: sha256File(newPng),
          sideBySideSha256: sha256File(path.join(frameOut, "side-by-side.png")),
          diffSha256: sha256File(path.join(frameOut, "absolute-diff.png")),
          camera: numbers.camera,
          focusRegion: original.evidence.focusRegion,
          ...(patchGeometry ? { patchGeometry } : {}),
          ...(cardRecord ?? {}),
        },
      },
      regions: numbers.regions,
      meanFaceLuminance: Math.round(cropLuminance * 1000) / 1000,
    },
  };
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const cli = parseCli(process.argv.slice(2));
  const outAbs = path.resolve(cwd, cli.outDir);
  if (!inside(cwd, outAbs)) throw new Error(`--out must remain inside the assigned worktree: ${outAbs}`);
  await mkdir(outAbs, { recursive: true });
  const staged = await stageInputs(cwd, cli);
  const runtimeRigRel = `apps/ui-xr/public/xr-assets/lighting/${cli.productEnvironmentId}.rig.json`;
  const runtimeRigSha256 = sha256File(path.join(cwd, runtimeRigRel));
  const patientYawOverride = readPatientYawOverride(cwd, cli);
  const lightingConditionsForRun = lightingConditions(cli, patientYawOverride);
  const inheritedNoiseFloor = cli.noiseFloorManifest
    ? Number((JSON.parse(readFileSync(path.resolve(cwd, cli.noiseFloorManifest), "utf8")) as { gates?: { g1?: { noiseFloorDeltaE76?: unknown } } }).gates?.g1?.noiseFloorDeltaE76)
    : null;
  if (inheritedNoiseFloor != null && !Number.isFinite(inheritedNoiseFloor)) throw new Error("--noise-floor manifest lacks gates.g1.noiseFloorDeltaE76");

  const actorRecords: Array<Record<string, unknown>> = [];
  const manifest: Record<string, unknown> = {
    schemaVersion: "openclinxr.vitruvian-compare.v1",
    tool: TOOL_REL,
    // The runner re-captures a key when any of these differs from `git hash-object` on the tree.
    toolBlobShas: {
      "vitruvian-compare.ts": gitBlobSha(readFileSync(new URL(import.meta.url))),
      "vitruvian-grey-card.ts": gitBlobSha(readFileSync(new URL("./vitruvian-grey-card.ts", import.meta.url))),
    },
    command: exactCommand(cwd),
    cwd,
    origRef: cli.origRef,
    size: cli.size,
    region: cli.region,
    greyCard: cli.greyCard
      ? {
          enabled: true,
          metricExclusion: "every metric mask subtracts greyCardBoxPx; lab pre-renders and accepts only a background-only placement",
          ...(cli.greyCardPlacement ? { placementSource: cli.greyCardPlacement, position: cli.greyCardPosition } : {}),
          ...(cli.greyCardCamera ? { camera: { mode: "fixed_card_normal", distanceSource: "app.<position>.worldTransform.cameraDistanceMeters" } } : {}),
          ...(cli.lightToggle ? { lightToggle: true, order: "role,type,worldPosition.x,y,z" } : {}),
        }
      : { enabled: false },
    renderer: "product apps/ui-xr isolated-subject three.js lab",
    loaderMode: cli.skinOverride
      ? "skinShadeLoader factory mode; page-only MeshLambertMaterial skin override; zero product materialOverrides"
      : cli.skinSpecular
        ? "skinShadeLoader factory mode; page-only skin specular ablation; shipped maps retained"
        : "skinShadeLoader factory mode; zero skinOverride; zero materialOverrides",
    sheets: "native 1:1 pixels, no resampling or upscaling",
    regionsMethod: cli.region === "head"
      ? "asset-derived live head/eye boxes plus documented normalized masks; identical masks for ORIGINAL and NEW"
      : cli.region === "forearm-close" || cli.region === "neck-close"
        ? `body close-up ${cli.region}: lab portrait solve (fov 24, 78% fill) on the asset-derived region box (dominant-joint verts, no 2D crop); identical camera and full frame for ORIGINAL and NEW`
        : `body region ${cli.region}: crop box from asset-derived ${cli.boxes} (dominant-joint verts projected through manifest packCamera, bind-pose verified); identical box for ORIGINAL and NEW`,
    rigs: {
      studio: { rigId: STUDIO_RIG_ID, mechanism: "existing rigOverride.studio key/fill/rim/hemisphere + RoomEnvironment", requested: STUDIO_RIG },
      runtime: { rigId: cli.productEnvironmentId, scenarioId: cli.scenarioId, path: runtimeRigRel, sha256: runtimeRigSha256, why: "a capture rig brighter than runtime has invented defects; runtime lighting is therefore a co-equal condition" },
    },
    actors: actorRecords,
    gates: {},
    notEvidenceFor: ["clinical_validity", "quest_readiness", "learner_readiness", "exam_equivalence"],
    ...instrumentOnly(cli),
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
    const pageFaults: string[] = [];
    await createLocalComputeServices({
      browserLaunch: chromium.launch.bind(chromium, { headless: true, args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] }),
    }).sceneCapture.withBrowser("skin-realism:vitruvian-compare", async (launched: unknown) => {
      const page = await (launched as HeadlessBrowser).newPage({ viewport: { width: cli.size, height: cli.size }, deviceScaleFactor: 1 });
      // tsx keeps function names by wrapping them in __name(); the card hook's page.evaluate bodies carry those calls.
      if (cli.greyCard || cli.skinOverride || cli.skinSpecular) await (page as unknown as { addInitScript(script: string): Promise<void> }).addInitScript("globalThis.__name = globalThis.__name || ((target) => target);");
      // A shader compile/link failure only reaches the page console; the frames still write and
      // the skin silently stops drawing (st-vitbody3 r2 street, r4d smoothstep(int)). Fail the run.
      page.on("console", (message) => {
        if (message.type() === "error") pageFaults.push(`console.error: ${message.text().slice(0, 2000)}`);
      });
      page.on("pageerror", (error) => pageFaults.push(`pageerror: ${error.message.slice(0, 2000)}`));
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
          original: { ref: cli.origFile ?? cli.origRef, sha256: subject.original.sha256, source: subject.original.source, scratchPath: path.relative(cwd, subject.original.abs) },
          new: { sha256: subject.candidate.sha256, source: subject.candidate.source, scratchPath: path.relative(cwd, subject.candidate.abs) },
          sameBytes: subject.original.sha256 === subject.candidate.sha256,
          lighting: {},
        };
        actorRecords.push(actorRecord);
        for (const lighting of lightingConditionsForRun) {
          const lightOut = path.join(outAbs, subject.actor, lighting.id);
          await mkdir(lightOut, { recursive: true });
          const captures: Record<string, { original: Captured; new: Captured; crop: Rect; subjectCrop: Rect; origPng: string; newPng: string }> = {};
          if (cli.region === "forearm-close" || cli.region === "neck-close") {
            const close = await captureCloseRegion({ page, serverUrl: server!.url, subject, lighting, lightOut, cli });
            everyPixelIdentical &&= close.pixelIdentical;
            for (const r of close.regionDeltas) allRegionDeltaEs.push(r);
            calibration.push(close.calibration);
            (actorRecord["lighting"] as Record<string, unknown>)[lighting.id] = close.lightingRecord;
            continue;
          }
          if (cli.region !== "head") {
            const body = await captureBodyRegion({ page, serverUrl: server!.url, subject, lighting, lightOut, cli });
            everyPixelIdentical &&= body.pixelIdentical;
            for (const r of body.regionDeltas) allRegionDeltaEs.push(r);
            calibration.push(body.calibration);
            (actorRecord["lighting"] as Record<string, unknown>)[lighting.id] = body.lightingRecord;
            continue;
          }
          for (const framing of ["face", "eyes", "cheek"] as const) {
            const frameOut = path.join(lightOut, framing);
            await mkdir(frameOut, { recursive: true });
            const captureSize = framing === "face" ? Math.ceil(cli.size * 0.82 / 0.78) : framing === "cheek" ? Math.min(LAB_RENDER_SIZE_MAX, Math.ceil(cli.size * 2.4)) : cli.size;
            const origSource = path.join(frameOut, ".source-orig.png");
            const newSource = path.join(frameOut, ".source-new.png");
            const placement = readGreyCardPlacement(cwd, cli);
            const original = await captureVariant({ page, baseUrl: server!.url, actor: subject.actor, variant: "original", lightingSpec: lighting.spec, framing, captureSize, imagePath: origSource, greyCard: cli.greyCard && framing !== "eyes", greyCardPlacement: placement, greyCardCamera: cli.greyCardCamera, lightToggle: cli.lightToggle && framing !== "eyes", skinOverride: cli.skinOverride, skinSpecular: cli.skinSpecular });
            const candidate = await captureVariant({ page, baseUrl: server!.url, actor: subject.actor, variant: "new", lightingSpec: lighting.spec, framing, captureSize, imagePath: newSource, greyCard: cli.greyCard && framing !== "eyes", greyCardPlacement: placement, greyCardCamera: cli.greyCardCamera, lightToggle: false, skinOverride: cli.skinOverride, skinSpecular: cli.skinSpecular });
            cameraComparable(original, candidate);
            const subjectCrop = framing === "eyes" ? { x0: 0, y0: 0, x1: cli.size, y1: cli.size }
              : framing === "face" ? centredCrop(captureSize, cli.size)
              : cheekCrop(original);
            const crop = original.evidence.greyCard
              ? unionRect(subjectCrop, original.evidence.greyCard.projectedBoxPx)
              : subjectCrop;
            const origPng = path.join(frameOut, "orig.png");
            const newPng = path.join(frameOut, "new.png");
            if (framing === "eyes" && !cli.greyCard) {
              await copyPngRgb(origSource, origPng);
              await copyPngRgb(newSource, newPng);
            } else {
              await writeNativeCrop(origSource, origPng, crop);
              await writeNativeCrop(newSource, newPng, crop);
            }
            await writeSideBySide(origPng, newPng, path.join(frameOut, "side-by-side.png"));
            const diff = await writeDiffHeatmap(origPng, newPng, path.join(frameOut, "absolute-diff.png"));
            everyPixelIdentical &&= diff.pixelIdentical;
            captures[framing] = { original, new: candidate, crop, subjectCrop, origPng, newPng };
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
          const cheekSubject = {
            x0: cheek.subjectCrop.x0 - cheek.crop.x0,
            y0: cheek.subjectCrop.y0 - cheek.crop.y0,
            x1: cheek.subjectCrop.x1 - cheek.crop.x0,
            y1: cheek.subjectCrop.y1 - cheek.crop.y0,
          };
          const masks = { ...skinMasks(headBox, cheekSubject), ...eyeMasks(centers, irisDiameterPx / 2) };
          const regionMetrics: Record<string, unknown> = {};
          for (const [region, def] of Object.entries(masks)) {
            const source = captures[def.framing]!;
            const cardBox = greyCardBoxAfterCrop(source.original, source.crop);
            def.mask.excludeRects = cardBox ? [cardBox] : [];
            const orig = regionStats(source.origPng, def.mask);
            const next = regionStats(source.newPng, def.mask);
            const delta = Math.round(deltaE76(orig, next) * 1_000_000) / 1_000_000;
            const metric = { ...metricRecord(orig, next), framing: def.framing, maskMethod: def.method };
            regionMetrics[region] = metric;
            allRegionDeltaEs.push({ actor: subject.actor, lighting: lighting.id, region, deltaE76: delta });
          }
          const cheekPatchGeometry = cli.skinOverride || cli.skinSpecular
            ? await measurePatchGeometry(page, masks["cheek"]!.mask, cheek.crop)
            : null;
          const frameRecords: Record<string, unknown> = {};
          for (const framing of ["face", "eyes", "cheek"] as const) {
            const c = captures[framing]!;
            const frameOut = path.dirname(c.origPng);
            const applicable = Object.fromEntries(Object.entries(regionMetrics).filter(([, value]) => (value as { framing: string }).framing === framing));
            const numbers = withRecordedSubjectCrop({
              actor: subject.actor,
              lighting: lighting.id,
              rigId: lighting.rigId,
              framing,
              imageSize: { width: c.crop.x1 - c.crop.x0, height: c.crop.y1 - c.crop.y0 },
              nativeSourceSize: c.original.captureSize,
              nativeCrop: c.crop,
              camera: c.original.readback.portrait ?? c.original.evidence.packFraming,
              focusRegion: c.original.evidence.focusRegion,
              rendererReadback: c.original.readback.renderer,
              lightsReadback: c.original.readback.lights,
              productRigReadback: c.original.readback.productRig,
              ...instrumentOnly(cli),
              regions: applicable,
              ...(framing === "cheek" && cheekPatchGeometry ? { patchGeometry: cheekPatchGeometry } : {}),
              ...(greyCardManifest(c.original, c.crop) ?? {}),
            }, c.crop, c.subjectCrop);
            await writeFile(path.join(frameOut, "numbers.json"), `${JSON.stringify(numbers, null, 2)}\n`, "utf8");
            frameRecords[framing] = {
              directory: path.relative(cwd, frameOut).replaceAll("\\", "/"),
              origSha256: sha256File(c.origPng),
              newSha256: sha256File(c.newPng),
              sideBySideSha256: sha256File(path.join(frameOut, "side-by-side.png")),
              diffSha256: sha256File(path.join(frameOut, "absolute-diff.png")),
              camera: numbers.camera,
              focusRegion: numbers.focusRegion,
              ...(framing === "cheek" && cheekPatchGeometry ? { patchGeometry: cheekPatchGeometry } : {}),
              ...(greyCardManifest(c.original, c.crop) ?? {}),
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
    if (pageFaults.length > 0) {
      throw new PageFaultError(
        `page reported ${pageFaults.length} error(s) during capture (shader compile/link or script); frames are not evidence:\n${pageFaults.slice(0, 5).join("\n---\n")}`,
      );
    }
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
  const g2Failure = cli.region !== "head" || cli.origFile ? null
    : !sameBytes && skinViolations.length
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

// Exit codes: 1 = a gate (G2 etc.) refused the frames; PAGE_FAULT_EXIT_CODE = the page itself
// errored (shader compile/link, script), so the frames are not evidence. A sweep that is red on
// G2 by design must not read the same as a broken shader.
const PAGE_FAULT_EXIT_CODE = 3;

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = error instanceof PageFaultError ? PAGE_FAULT_EXIT_CODE : 1;
  });
}
