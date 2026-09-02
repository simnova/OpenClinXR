/**
 * #588 — the seated peds parent: chair placement, pelvis contact, garment surface coverage.
 *
 * MEASURE-FIRST instrument for the three pixel observations on the seated parent
 * (`peds_asthma_parent_anxiety_v1`, `parent_tara_johnson_v1`). No mechanism is asserted
 * here; the artifact answers three questions with numbers:
 *
 *   (a) does a chair / seat surface resolve under this actor at all, and where is it
 *   (b) is her pelvis in contact with it, and by how much does it miss if not
 *   (c) what fraction of her body surface is covered by garment geometry, measured
 *       against a KNOWN-GOOD actor (the fully-scrubbed nurse in the same station)
 *
 * DEAD ORACLES (orchestrator-measured, not re-derived here):
 *   1. garment PRESENCE is vacuous — 5,518 tris of shirt+trousers ship on this actor
 *   2. base-colour CONTRAST is vacuous — skin colour lives in a texture; baseColorFactor
 *      is [1,1,1,1]. Effective colour = texture mean × baseColorFactor, never factor alone.
 *   3. nearest-VERTEX coverage does not separate suspect from known-good (28.1% vs 29.3%)
 *      and 29% is implausible for full scrubs — that implementation is itself suspect.
 *   4. a-patients-clothes-are-not-the-colour-of-her-skin.test.ts:41 compares every
 *      garment against a HARDCODED skin [201,177,163] — NOT this actor's population.
 *      This probe measures against the actor's OWN skin. That contract is not edited here.
 *
 * INSTRUMENT for (c): the proven pure-numpy outward-raycast predicate
 * (`asset-pipeline/makeclothes/garment_coverage.py`, #272) — point-to-SURFACE along the
 * body normal, hit-tested against garment triangles within the ray tolerance band. This is
 * the tree's proven replacement for the dead nearest-vertex instrument; it separates the
 * 392-tri sparse trouser (~71% leg coverage) from the 9,384-tri closed scrub shirt. It is
 * run over the SHIPPED GLBs (bind pose) for both actors in one invocation so the numbers
 * share a reference. The live scene supplies (a)/(b) and the head-artifact search.
 *
 * claimScope: chair presence + pelvis-to-seat gap + garment surface coverage + garment-vs-
 *   own-skin CIELAB dE for the peds parent, with the nurse as the same-run reference.
 * notEvidenceFor: pose naturalness, seat-height appropriateness, clinical plausibility,
 *   garment aesthetics, other stations, whether 0.45 m is the right seat height.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Document, type Mesh } from "@gltf-transform/core";
import { chromium, type Page } from "playwright";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "./lib/portless-server.js";
import {
  ROOM_CAPTURE_MODE,
  buildRoomCaptureUrl,
  readLivePostureGeometryFromPage,
  waitForStationShell,
} from "./ui-xr-environment-room-capture.js";
import { waitForSceneAssetsSettled } from "./declared-actors-rendered.js";
import { withTreeStamp, type MeasurementTreeStamp } from "./lib/measurement-tree-stamp.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
export const ARTIFACT_PATH = path.join(HERE, "seated-parent-placement.json");

export const SCENARIO_ID = "peds_asthma_parent_anxiety_v1";
export const PARENT_ACTOR_ID = "parent_tara_johnson_v1";
export const KNOWN_GOOD_ACTOR_ID = "nurse_kevin_lee_v1";
/** The runtime loads the parent from the motion-bind GLB (humanoid-runtime-asset-url.ts:80). */
export const PARENT_GLB = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb",
);
export const NURSE_GLB = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb",
);
export const COVERAGE_MODULE = path.join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/garment_coverage.py",
);

/** Search box half-extent around the head bone — probe constant, NOT a gate. */
export const HEAD_SEARCH_RADIUS_M = 0.12;
/** Ankle floor: shoes/feet begin below body-min-Y + this (same constant as #272). */
export const ANKLE_OFFSET_M = 0.10;
/** Ray tolerance the coverage predicate uses (garment_coverage.py). */
export const RAY_TOLERANCE_M = 0.06;

export type ChairFacts = {
  present: boolean;
  slotId: string | null;
  worldX: number | null;
  worldZ: number | null;
  seatTopWorldY: number | null;
  seatHeightMeters: number | null;
};

export type ParentLiveFacts = {
  actorId: string;
  declaredPosture: string | null;
  slotWorldX: number | null;
  slotWorldZ: number | null;
  pelvisWorldY: number | null;
  pelvisBoneName: string | null;
  lowestSupportBoneWorldY: number | null;
  footClearanceAboveFloor: number | null;
  lowestVertexY: number;
  framesAdvanced: number;
  headBoneWorldY: number | null;
  hairMeshWorldAabb: { min: [number, number, number]; max: [number, number, number] } | null;
};

export type HeadIntersectionRow = {
  meshName: string;
  actorId: string | null;
  fixtureSlotId: string | null;
  triangles: number;
  visible: boolean | null;
  worldAabb: { min: [number, number, number]; max: [number, number, number] } | null;
};

export type CoverageRow = {
  garmentLabel: string;
  garmentMeshName: string;
  triangleCount: number;
  regionBandY: [number, number];
  regionFaceCount: number;
  sampledFaceCount: number;
  outwardRaycastCoverage: number;
  garmentBoundaryEdges: number;
  garmentAdherence: number;
  rayToleranceMeters: number;
  verdict: string;
  reason: string;
};

export type FigureCoverage = {
  actorId: string;
  assetBasename: string;
  upperGarmentMeshName: string | null;
  upperGarmentTriangleCount: number;
  lowerGarmentMeshName: string | null;
  lowerGarmentTriangleCount: number;
  upper: CoverageRow | null;
  lower: CoverageRow | null;
  /** (upperCov*upperFaces + lowerCov*lowerFaces) / (upperFaces + lowerFaces) over the claimed regions. */
  combinedBodyClothedFraction: number | null;
};

export type EffectiveColour = {
  /** sRGB mean of the material's base colour texture (1.0 when no texture) × baseColorFactor. */
  effectiveRgb: [number, number, number] | null;
  textureMeanRgb: [number, number, number] | null;
  baseColorFactor: [number, number, number] | null;
  rgbDistanceVsOwnSkin: number | null;
  cieLabDEVsOwnSkin: number | null;
};

export type ColourFigure = {
  actorId: string;
  assetBasename: string;
  skin: EffectiveColour & { skinTextureBytes: number | null };
  garments: Array<{
    meshName: string;
    triangleCount: number;
    colour: EffectiveColour;
  }>;
};

export type SeatedParentPlacementReport = {
  schemaVersion: "openclinxr.seated-parent-placement.v1";
  kind: "seated_parent_placement";
  label: string;
  generatedAt: string;
  treeStamp: MeasurementTreeStamp;
  scenarioId: string;
  environmentId: string;
  answers: {
    chairResolves: { yesNo: "yes" | "no"; note: string };
    pelvisContact: { yesNo: "yes" | "no"; note: string };
    garmentSurfaceCoverage: { yesNo: "yes" | "no"; note: string };
  };
  liveScene: {
    chair: ChairFacts;
    parent: ParentLiveFacts;
    knownGoodActorId: string;
    headIntersections: {
      /** meshes whose world AABB intersects the parent's hair-mesh world AABB */
      hairAabb: HeadIntersectionRow[];
      /** meshes whose world AABB intersects a ±HEAD_SEARCH_RADIUS_M box around the head bone */
      headBoneBox: HeadIntersectionRow[];
    };
  };
  garmentCoverage: {
    instrument: string;
    figures: FigureCoverage[];
  };
  effectiveColour: {
    figures: ColourFigure[];
  };
  claimScope: string[];
  notEvidenceFor: string[];
};

type MeshGeometry = { position: number[]; indices: number[]; triangles: number };

const execFileAsync = promisify(execFile);

/** Concatenate every primitive of a mesh (same shape as #272's meshData). */
function meshData(mesh: Mesh): MeshGeometry {
  const position: number[] = [];
  const indices: number[] = [];
  let triangles = 0;
  const tmp: number[] = [0, 0, 0];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION") as { getCount(): number; getElement(i: number, t: number[]): void } | null;
    const idx = prim.getIndices();
    if (!pos) continue;
    const base = position.length / 3;
    for (let i = 0; i < pos.getCount(); i += 1) {
      pos.getElement(i, tmp);
      position.push(tmp[0]!, tmp[1]!, tmp[2]!);
    }
    if (idx) {
      for (let i = 0; i < idx.getCount(); i += 1) {
        indices.push(idx.getScalar(i) + base);
      }
      triangles += Math.floor(idx.getCount() / 3);
    } else {
      for (let i = 0; i < pos.getCount(); i += 1) indices.push(i + base);
      triangles += Math.floor(pos.getCount() / 3);
    }
  }
  return { position, indices, triangles };
}

function bounds(position: number[]): { min: [number, number, number]; max: [number, number, number] } {
  const min = [Infinity, Infinity, Infinity] as [number, number, number];
  const max = [-Infinity, -Infinity, -Infinity] as [number, number, number];
  for (let i = 0; i < position.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      const v = position[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max };
}

function garmentNameTokens(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
}
function isLowerGarmentName(name: string): boolean {
  const t = garmentNameTokens(name);
  return t.some((tok) => tok.includes("pant") || tok.includes("trouser"));
}
function isUpperGarmentName(name: string): boolean {
  const t = garmentNameTokens(name);
  return t.some((tok) => tok === "scrub" || tok === "scrubs" || tok.includes("shirt") || tok === "garment" || tok === "gown");
}

async function loadFigureMeshes(
  io: NodeIO,
  glbPath: string,
): Promise<{ body: MeshGeometry; bodyMeshName: string; lower: MeshGeometry | null; upper: MeshGeometry | null; meshNames: string[] }> {
  if (!existsSync(glbPath)) throw new Error(`seated-parent-placement: missing shipped GLB ${glbPath}`);
  const doc = await io.read(glbPath);
  let body: MeshGeometry | null = null;
  let bodyMeshName = "";
  let lower: MeshGeometry | null = null;
  let upper: MeshGeometry | null = null;
  const meshNames: string[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    if (/_body$/.test(name) && !body) {
      bodyMeshName = name;
      body = meshData(mesh);
    } else if (isLowerGarmentName(name)) {
      meshNames.push(name);
      if (!lower) lower = meshData(mesh);
    } else if (isUpperGarmentName(name)) {
      meshNames.push(name);
      if (!upper) upper = meshData(mesh);
    }
  }
  if (!body) throw new Error(`seated-parent-placement: no _body mesh in ${glbPath}`);
  return { body, bodyMeshName, lower, upper, meshNames };
}

async function runCoverageReport(args: {
  body: MeshGeometry;
  garment: MeshGeometry;
  bandLo: number;
  bandHi: number;
  label: string;
  tmpDir: string;
}): Promise<CoverageRow> {
  const bodyPath = path.join(args.tmpDir, `body-${args.label}.json`);
  const garmentPath = path.join(args.tmpDir, `garment-${args.label}.json`);
  const outPath = path.join(args.tmpDir, `report-${args.label}.json`);
  await Promise.all([
    writeFile(bodyPath, JSON.stringify({ position: args.body.position, indices: args.body.indices })),
    writeFile(garmentPath, JSON.stringify({ position: args.garment.position, indices: args.garment.indices })),
  ]);
  let stdout: string;
  try {
    const res = await execFileAsync("python3", [
      COVERAGE_MODULE,
      "--mode",
      "coverage-report",
      "--body",
      bodyPath,
      "--garment",
      garmentPath,
      "--band-lo",
      String(args.bandLo),
      "--band-hi",
      String(args.bandHi),
      "--label",
      args.label,
      "--out",
      outPath,
    ], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    stdout = res.stdout;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    throw new Error(`garment_coverage.py failed for ${args.label} (exit ${e.code}): ${String(e.stderr ?? e).slice(-800)}`);
  }
  void stdout;
  return JSON.parse(readFileSync(outPath, "utf8")) as CoverageRow;
}

/** PNG decode → mean sRGB over non-transparent texels (same inflate+paeth reader as lib/png-region-luminance). */
function meanRgbOfPng(bytes: Uint8Array): { rgb: [number, number, number]; samples: number } | null {
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

  function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }

  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let p = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let samples = 0;
  const step = Math.max(1, Math.floor(Math.max(w, h) / 512));
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
    if (y % step !== 0) {
      prev.set(cur);
      continue;
    }
    for (let x = 0; x < w; x += step) {
      const i = x * chans;
      const alpha = chans >= 4 ? cur[i + 3]! : 255;
      if (alpha < 8) continue;
      const r = chans >= 3 ? cur[i]! : cur[i]!;
      const g = chans >= 3 ? cur[i + 1]! : cur[i]!;
      const b2 = chans >= 3 ? cur[i + 2]! : cur[i]!;
      sumR += r;
      sumG += g;
      sumB += b2;
      samples += 1;
    }
    prev.set(cur);
  }
  if (samples === 0) return null;
  return {
    rgb: [sumR / samples, sumG / samples, sumB / samples],
    samples,
  };
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(rgb: [number, number, number]): { L: number; a: number; b: number } {
  const r = srgbToLinear(rgb[0]!);
  const g = srgbToLinear(rgb[1]!);
  const b = srgbToLinear(rgb[2]!);
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const fx = X / 0.95047;
  const fy = Y / 1.0;
  const fz = Z / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx2 = f(fx);
  const fy2 = f(fy);
  const fz2 = f(fz);
  return { L: 116 * fy2 - 16, a: 500 * (fx2 - fy2), b: 200 * (fy2 - fz2) };
}

function dE76(a: { L: number; a: number; b: number }, b: { L: number; a: number; b: number }): number {
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

function materialBaseColour(mesh: Mesh): { factor: [number, number, number] | null; textureBytes: number | null } {
  let factor: [number, number, number] | null = null;
  let textureBytes: number | null = null;
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    if (!mat) continue;
    const f = mat.getBaseColorFactor();
    if (f && !factor) factor = [f[0]!, f[1]!, f[2]!];
    const tex = mat.getBaseColorTexture();
    if (tex && textureBytes === null) {
      const img = tex.getImage();
      textureBytes = img ? (img as Uint8Array).byteLength : 0;
    }
  }
  return { factor, textureBytes };
}

function effectiveColourOf(
  mesh: Mesh,
): { effective: [number, number, number] | null; textureMean: [number, number, number] | null; factor: [number, number, number] | null } {
  const { factor, textureBytes } = materialBaseColour(mesh);
  let textureMean: [number, number, number] | null = null;
  if (textureBytes !== null && textureBytes > 0) {
    // Find the actual image bytes for the base colour texture and decode its mean RGB.
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const tex = mat?.getBaseColorTexture();
      const img = tex?.getImage();
      if (img) {
        const u8 = img as Uint8Array;
        const mean = meanRgbOfPng(new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength));
        if (mean) {
          textureMean = [mean.rgb[0]! / 255, mean.rgb[1]! / 255, mean.rgb[2]! / 255];
          break;
        }
      }
    }
  }
  const f = factor ?? [1, 1, 1];
  const tm = textureMean ?? [1, 1, 1];
  const effective: [number, number, number] = [
    Math.min(1, tm[0]! * f[0]!),
    Math.min(1, tm[1]! * f[1]!),
    Math.min(1, tm[2]! * f[2]!),
  ];
  return { effective, textureMean, factor };
}

async function measureGarmentCoverage(io: NodeIO): Promise<FigureCoverage[]> {
  const figures: FigureCoverage[] = [];
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "issue-588-cov-"));
  try {
    const targets: Array<{ actorId: string; glbPath: string }> = [
      { actorId: PARENT_ACTOR_ID, glbPath: PARENT_GLB },
      { actorId: KNOWN_GOOD_ACTOR_ID, glbPath: NURSE_GLB },
    ];
    for (const target of targets) {
      const { body, lower, upper, meshNames } = await loadFigureMeshes(io, target.glbPath);
      const bodyBounds = bounds(body.position);
      const label = target.actorId.replace(/_v1$/u, "");
      const row: FigureCoverage = {
        actorId: target.actorId,
        assetBasename: path.basename(target.glbPath),
        upperGarmentMeshName: meshNames.find((n) => isUpperGarmentName(n)) ?? null,
        upperGarmentTriangleCount: upper?.triangles ?? 0,
        lowerGarmentMeshName: meshNames.find((n) => isLowerGarmentName(n)) ?? null,
        lowerGarmentTriangleCount: lower?.triangles ?? 0,
        upper: null,
        lower: null,
        combinedBodyClothedFraction: null,
      };
      if (lower) {
        const hemY = upper ? bounds(upper.position).min[1] : bodyBounds.max[1] * 0.55;
        const ankleY = bodyBounds.min[1] + ANKLE_OFFSET_M;
        row.lower = await runCoverageReport({
          body,
          garment: lower,
          bandLo: ankleY,
          bandHi: hemY,
          label: `${label}-lower`,
          tmpDir,
        });
      }
      if (upper) {
        const u = bounds(upper.position);
        row.upper = await runCoverageReport({
          body,
          garment: upper,
          bandLo: u.min[1] + 0.02,
          bandHi: u.max[1] - 0.02,
          label: `${label}-upper`,
          tmpDir,
        });
      }
      const faces = [row.upper, row.lower].filter((c): c is CoverageRow => c !== null);
      if (faces.length > 0) {
        const totalFaces = faces.reduce((t, c) => t + c.regionFaceCount, 0);
        row.combinedBodyClothedFraction = totalFaces > 0
          ? faces.reduce((t, c) => t + c.outwardRaycastCoverage * c.regionFaceCount, 0) / totalFaces
          : null;
      }
      figures.push(row);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
  return figures;
}

async function measureEffectiveColour(io: NodeIO): Promise<ColourFigure[]> {
  const figures: ColourFigure[] = [];
  for (const target of [{ actorId: PARENT_ACTOR_ID, glbPath: PARENT_GLB }, { actorId: KNOWN_GOOD_ACTOR_ID, glbPath: NURSE_GLB }]) {
    const doc = await io.read(target.glbPath);
    let skinMesh: Mesh | null = null;
    const garmentMeshes: Array<{ mesh: Mesh; name: string; triangles: number }> = [];
    for (const mesh of doc.getRoot().listMeshes()) {
      const name = mesh.getName() || "";
      const tris = meshData(mesh).triangles;
      if (/_body$/.test(name) && !skinMesh) skinMesh = mesh;
      else if (isUpperGarmentName(name) || isLowerGarmentName(name)) garmentMeshes.push({ mesh, name, triangles: tris });
    }
    const skinCol = skinMesh ? effectiveColourOf(skinMesh) : null;
    const skinTextureBytes = skinMesh ? materialBaseColour(skinMesh).textureBytes : null;
    const skinEffective = skinCol?.effective ?? null;
    const skinLab = skinEffective ? rgbToLab(skinEffective) : null;
    const garments: ColourFigure["garments"] = [];
    for (const g of garmentMeshes) {
      const col = effectiveColourOf(g.mesh);
      const eff = col.effective ?? null;
      const lab = eff ? rgbToLab(eff) : null;
      garments.push({
        meshName: g.name,
        triangleCount: g.triangles,
        colour: {
          effectiveRgb: eff,
          textureMeanRgb: col.textureMean,
          baseColorFactor: col.factor,
          rgbDistanceVsOwnSkin: eff && skinEffective ? rgbDistance(eff, skinEffective) : null,
          cieLabDEVsOwnSkin: lab && skinLab ? dE76(lab, skinLab) : null,
        },
      });
    }
    figures.push({
      actorId: target.actorId,
      assetBasename: path.basename(target.glbPath),
      skin: {
        effectiveRgb: skinEffective,
        textureMeanRgb: skinCol?.textureMean ?? null,
        baseColorFactor: skinCol?.factor ?? null,
        rgbDistanceVsOwnSkin: null,
        cieLabDEVsOwnSkin: null,
        skinTextureBytes,
      },
      garments,
    });
  }
  return figures;
}

type PageLiveFacts = {
  framesAdvanced: number;
  environmentId: string;
  chair: {
    slotId: string;
    worldX: number;
    worldZ: number;
    seatTopWorldY: number | null;
    seatHeightMeters: number | null;
  } | null;
  parent: {
    slotWorldX: number;
    slotWorldZ: number;
    pelvisWorldY: number | null;
    pelvisBoneName: string | null;
    lowestSupportBoneWorldY: number | null;
    headBoneWorldY: number | null;
    hairMeshWorldAabb: { min: [number, number, number]; max: [number, number, number] } | null;
  } | null;
  hairAabbIntersections: HeadIntersectionRow[];
  headBoneBoxIntersections: HeadIntersectionRow[];
};

/** One page evaluation collecting chair + parent pelvis/slot/head + head-region intersections. Plain-JS body. */
async function readLiveFactsFromPage(page: Page): Promise<PageLiveFacts> {
  return page.evaluate(`(() => {
    const HEAD_RADIUS = ${HEAD_SEARCH_RADIUS_M};
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const framesAdvanced = (win.__openClinXrFrameStats && win.__openClinXrFrameStats.framesObserved) || 0;
    const empty = { framesAdvanced: framesAdvanced, environmentId: "", chair: null, parent: null,
      hairAabbIntersections: [], headBoneBoxIntersections: [] };
    if (!scene || typeof scene.traverse !== "function") return empty;

    function worldPos(obj) {
      obj.updateMatrixWorld && obj.updateMatrixWorld(true);
      const e = (obj.matrixWorld && obj.matrixWorld.elements) || [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
      return { x: e[12] || 0, y: e[13] || 0, z: e[14] || 0 };
    }

    function meshWorldAabb(obj) {
      try {
        const geo = obj.geometry;
        if (!geo) return null;
        geo.computeBoundingBox && geo.computeBoundingBox();
        if (!geo.boundingBox) return null;
        // Skinned mesh: pose each vertex through the skeleton before the world matrix.
        const sk = obj.isSkinnedMesh && obj.skeleton ? obj.skeleton : null;
        const posAttr = geo.attributes && geo.attributes.position;
        if (!posAttr) return null;
        const idx = geo.index;
        const n = idx ? idx.count : posAttr.count;
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        const bm = obj.bindMatrix ? obj.bindMatrix.elements : null;
        const bmi = obj.bindMatrixInverse ? obj.bindMatrixInverse.elements : null;
        const mm = (obj.matrixWorld && obj.matrixWorld.elements) || null;
        const boneMats = sk ? sk.boneMatrices : null;
        const sIdxArr = sk && geo.attributes.skinIndex ? geo.attributes.skinIndex.array : null;
        const sWgtArr = sk && geo.attributes.skinWeight ? geo.attributes.skinWeight.array : null;
        const posArr = posAttr.array;
        const idxArr = idx ? idx.array : null;
        const step = Math.max(1, Math.floor(n / 4000));
        for (let v = 0; v < n; v += step) {
          const vi = idxArr ? idxArr[v] : v;
          let lx = posArr[vi * 3], ly = posArr[vi * 3 + 1], lz = posArr[vi * 3 + 2];
          if (sk && boneMats && sIdxArr && sWgtArr && bm && bmi) {
            // bindMatrix * local  (column-major 4x4)
            const bx = bm[0]*lx + bm[4]*ly + bm[8]*lz + bm[12];
            const by = bm[1]*lx + bm[5]*ly + bm[9]*lz + bm[13];
            const bz = bm[2]*lx + bm[6]*ly + bm[10]*lz + bm[14];
            let sx = 0, sy = 0, sz = 0;
            for (let k = 0; k < 4; k++) {
              // skinIndex/skinWeight are itemSize-4 attributes: joint k of vertex vi
              // lives at component vi*4+k (raw array index).
              const boneIndex = sIdxArr[vi * 4 + k];
              const w = sWgtArr[vi * 4 + k];
              if (w === 0) continue;
              const o = boneIndex * 16;
              if (o + 15 >= boneMats.length) continue;
              const px = boneMats[o+0]*bx + boneMats[o+4]*by + boneMats[o+8]*bz + boneMats[o+12];
              const py = boneMats[o+1]*bx + boneMats[o+5]*by + boneMats[o+9]*bz + boneMats[o+13];
              const pz = boneMats[o+2]*bx + boneMats[o+6]*by + boneMats[o+10]*bz + boneMats[o+14];
              sx += w * px; sy += w * py; sz += w * pz;
            }
            lx = bmi[0]*sx + bmi[4]*sy + bmi[8]*sz + bmi[12];
            ly = bmi[1]*sx + bmi[5]*sy + bmi[9]*sz + bmi[13];
            lz = bmi[2]*sx + bmi[6]*sy + bmi[10]*sz + bmi[14];
          }
          if (mm) {
            const wx = mm[0]*lx + mm[4]*ly + mm[8]*lz + mm[12];
            const wy = mm[1]*lx + mm[5]*ly + mm[9]*lz + mm[13];
            const wz = mm[2]*lx + mm[6]*ly + mm[10]*lz + mm[14];
            lx = wx; ly = wy; lz = wz;
          }
          if (lx < minX) minX = lx; if (ly < minY) minY = ly; if (lz < minZ) minZ = lz;
          if (lx > maxX) maxX = lx; if (ly > maxY) maxY = ly; if (lz > maxZ) maxZ = lz;
        }
        if (!isFinite(minX)) return null;
        return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
      } catch (e) {
        return null;
      }
    }

    function aabbIntersect(a, b) {
      return a && b && a.min[0] <= b.max[0] && a.max[0] >= b.min[0]
        && a.min[1] <= b.max[1] && a.max[1] >= b.min[1]
        && a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
    }

    function actorIdOf(obj) {
      let cur = obj;
      while (cur) {
        const ud = cur.userData || {};
        if (typeof ud.openClinXrActorId === "string" && ud.openClinXrActorId.length > 0) return ud.openClinXrActorId;
        cur = cur.parent;
      }
      return null;
    }

    function slotIdOf(obj) {
      let cur = obj;
      while (cur) {
        const ud = cur.userData || {};
        if (typeof ud.fixtureSlotId === "string" && ud.fixtureSlotId.length > 0) return ud.fixtureSlotId;
        cur = cur.parent;
      }
      return null;
    }

    // ---- chair ----
    let chair = null;
    let environmentId = "";
    scene.traverse(function (obj) {
      const ud = obj.userData || {};
      if (!environmentId && typeof ud.environmentId === "string" && ud.environmentId.length > 0) environmentId = ud.environmentId;
      if (chair) return;
      const slotId = ud.fixtureSlotId;
      if (typeof slotId !== "string" || slotId.indexOf("_chair") !== slotId.length - 6) return;
      if (!ud.seatHeightMeters && !obj.children || obj.children.length === 0) return;
      const pos = worldPos(obj);
      let seatTop = null;
      obj.traverse(function (child) {
        if (seatTop !== null) return;
        if (typeof child.name === "string" && child.name.indexOf(".seat") === child.name.length - 5) {
          const bb = meshWorldAabb(child);
          if (bb) seatTop = bb.max[1];
        }
      });
      chair = { slotId: slotId, worldX: pos.x, worldZ: pos.z, seatTopWorldY: seatTop,
        seatHeightMeters: typeof ud.seatHeightMeters === "number" ? ud.seatHeightMeters : null };
    });

    // ---- actor roots (posture-tagged, outermost) ----
    const tagged = [];
    scene.traverse(function (object) {
      const p = object.userData && object.userData.openClinXrActorPosture;
      if (p === "standing" || p === "seated" || p === "supine") tagged.push(object);
    });
    const roots = tagged.filter(function (root) {
      let hasTaggedDescendant = false;
      if (typeof root.traverse === "function") {
        root.traverse(function (child) {
          if (child === root) return;
          const p = child.userData && child.userData.openClinXrActorPosture;
          if (p === "standing" || p === "seated" || p === "supine") hasTaggedDescendant = true;
        });
      }
      return !hasTaggedDescendant;
    });

    function ancestorFact(root, key) {
      let p = root;
      let depth = 0;
      while (p && depth < 8) {
        const v = p.userData && p.userData[key];
        if (v !== undefined && v !== null && !(typeof v === "string" && v.length === 0)) return v;
        p = p.parent;
        depth++;
      }
      return null;
    }

    function isBone(obj) { return obj.isBone === true || obj.type === "Bone"; }

    let parent = null;
    for (let r = 0; r < roots.length; r++) {
      const root = roots[r];
      const actorId = ancestorFact(root, "openClinXrActorId");
      if (actorId !== "${PARENT_ACTOR_ID}") continue;
      const slotPos = worldPos(root);
      const pelvisWorldY = { value: null };
      const pelvisName = { value: null };
      const lowestSupport = { value: null };
      const headBoneY = { value: null };
      let hairAabb = null;
      root.updateMatrixWorld && root.updateMatrixWorld(true);
      root.traverse(function (obj) {
        if (isBone(obj)) {
          const name = (obj.name || "").toLowerCase();
          const wy = worldPos(obj).y;
          if (name === "head" && headBoneY.value === null) headBoneY.value = wy;
          const isPelvisish = name.indexOf("pelvis") >= 0 || name.indexOf("hips") >= 0;
          if (isPelvisish) {
            if (pelvisName.value === null || name.length < pelvisName.value.length) {
              pelvisName.value = name;
              pelvisWorldY.value = wy;
            }
          }
          if (/foot|shin|lowerleg|calf|ankle/.test(name)) {
            if (lowestSupport.value === null || wy < lowestSupport.value) lowestSupport.value = wy;
          }
        }
        if (obj.isMesh && !hairAabb) {
          const n = (obj.name || "").toLowerCase();
          if (n.indexOf("hair") >= 0 && n.indexOf("eyebrow") < 0 && n.indexOf("eyelash") < 0) {
            hairAabb = meshWorldAabb(obj);
          }
        }
      });
      parent = {
        slotWorldX: slotPos.x,
        slotWorldZ: slotPos.z,
        pelvisWorldY: pelvisWorldY.value,
        pelvisBoneName: pelvisName.value,
        lowestSupportBoneWorldY: lowestSupport.value,
        headBoneWorldY: headBoneY.value,
        hairMeshWorldAabb: hairAabb
      };
    }

    // ---- head-region intersections ----
    const hairAabbIntersections = [];
    const headBoneBoxIntersections = [];
    const parentAid = "${PARENT_ACTOR_ID}";
    let headBox = null;
    if (parent && parent.headBoneWorldY !== null) {
      const hx = parent.slotWorldX;
      const hy = parent.headBoneWorldY;
      const hz = parent.slotWorldZ;
      headBox = { min: [hx - HEAD_RADIUS, hy - HEAD_RADIUS, hz - HEAD_RADIUS],
                  max: [hx + HEAD_RADIUS, hy + HEAD_RADIUS, hz + HEAD_RADIUS] };
    }
    scene.traverse(function (obj) {
      if (!(obj.isMesh || obj.isSkinnedMesh)) return;
      const aid = actorIdOf(obj);
      if (aid === parentAid) return;
      const name = obj.name || "";
      if (!name && !slotIdOf(obj)) return;
      const bb = meshWorldAabb(obj);
      if (!bb) return;
      let tris = 0;
      if (obj.geometry && obj.geometry.index) tris = Math.floor(obj.geometry.index.count / 3);
      else if (obj.geometry && obj.geometry.attributes && obj.geometry.attributes.position) {
        tris = Math.floor(obj.geometry.attributes.position.count / 3);
      }
      const row = { meshName: name, actorId: aid, fixtureSlotId: slotIdOf(obj), triangles: tris,
        visible: obj.visible !== false, worldAabb: bb };
      if (parent && parent.hairMeshWorldAabb && aabbIntersect(bb, parent.hairMeshWorldAabb)) {
        hairAabbIntersections.push(row);
      }
      if (headBox && aabbIntersect(bb, headBox)) {
        headBoneBoxIntersections.push(row);
      }
    });

    return { framesAdvanced: framesAdvanced, environmentId: environmentId, chair: chair, parent: parent,
      hairAabbIntersections: hairAabbIntersections, headBoneBoxIntersections: headBoneBoxIntersections };
  })()`) as Promise<PageLiveFacts>;
}

async function waitForHumanoidsAndFrames(page: Page, minFrames: number, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    ({ minFrames: need }) => {
      const win = window as unknown as {
        __openClinXrFrameStats?: { framesObserved?: number };
        __openClinXrDebugScene?: {
          traverse?: (cb: (o: { isSkinnedMesh?: boolean }) => void) => void;
        };
      };
      const frames = win.__openClinXrFrameStats?.framesObserved ?? 0;
      if (frames < need) return false;
      const scene = win.__openClinXrDebugScene;
      if (!scene?.traverse) return false;
      let skinned = 0;
      scene.traverse((object) => {
        if (object.isSkinnedMesh) skinned += 1;
      });
      return skinned >= 1;
    },
    { minFrames },
    { timeout: timeoutMs },
  );
}

async function measureLive(input: {
  baseUrl?: string;
  label: string;
}): Promise<{ environmentId: string; chair: ChairFacts; parent: ParentLiveFacts; headIntersections: SeatedParentPlacementReport["liveScene"]["headIntersections"] }> {
  let server: PortlessDevServer | undefined;
  let ownedServer = false;
  try {
    const baseUrl =
      input.baseUrl
      ?? (await (async () => {
        ownedServer = true;
        server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
        return server.url;
      })());

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        process.stdout.write(`seated-parent-placement: goto ${SCENARIO_ID}\n`);
        const url = buildRoomCaptureUrl(baseUrl, SCENARIO_ID, ROOM_CAPTURE_MODE);
        await page.goto(url, { waitUntil: "load", timeout: 180_000 });
        await waitForStationShell(page, 180_000);
        await waitForHumanoidsAndFrames(page, 8, 180_000);
        await waitForSceneAssetsSettled(page, 60_000);
        await page.waitForTimeout(900);

        const live = await readLivePostureGeometryFromPage(page);
        const facts = await readLiveFactsFromPage(page);
        const sid = live.scenarioId || SCENARIO_ID;

        const postureRow = live.actors.find((a) => a.actorId === PARENT_ACTOR_ID);
        const parent: ParentLiveFacts = {
          actorId: PARENT_ACTOR_ID,
          declaredPosture: String(postureRow?.declaredPosture ?? facts.parent ? "seated" : "unknown"),
          slotWorldX: facts.parent?.slotWorldX ?? null,
          slotWorldZ: facts.parent?.slotWorldZ ?? null,
          pelvisWorldY: facts.parent?.pelvisWorldY ?? null,
          pelvisBoneName: facts.parent?.pelvisBoneName ?? null,
          lowestSupportBoneWorldY: facts.parent?.lowestSupportBoneWorldY ?? null,
          footClearanceAboveFloor: facts.parent?.lowestSupportBoneWorldY == null
            ? null
            : facts.parent.lowestSupportBoneWorldY - 0,
          lowestVertexY: postureRow?.lowestVertexY ?? Number.NaN,
          framesAdvanced: postureRow?.framesAdvanced ?? facts.framesAdvanced,
          headBoneWorldY: facts.parent?.headBoneWorldY ?? null,
          hairMeshWorldAabb: facts.parent?.hairMeshWorldAabb ?? null,
        };
        const chair: ChairFacts = facts.chair
          ? {
              present: true,
              slotId: facts.chair.slotId,
              worldX: facts.chair.worldX,
              worldZ: facts.chair.worldZ,
              seatTopWorldY: facts.chair.seatTopWorldY,
              seatHeightMeters: facts.chair.seatHeightMeters,
            }
          : { present: false, slotId: null, worldX: null, worldZ: null, seatTopWorldY: null, seatHeightMeters: null };

        return {
          environmentId: facts.environmentId || "",
          chair,
          parent,
          headIntersections: {
            hairAabb: facts.hairAabbIntersections,
            headBoneBox: facts.headBoneBoxIntersections,
          },
        };
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    if (ownedServer && server) {
      try {
        await stopPortlessDevServer(server.proc);
      } catch {
        // ignore
      }
    }
  }
}

export async function inspectSeatedParentPlacement(input?: {
  baseUrl?: string;
  label?: string;
}): Promise<SeatedParentPlacementReport> {
  const io = new NodeIO();
  const [live, coverage, colour] = await Promise.all([
    measureLive({ baseUrl: input?.baseUrl, label: input?.label ?? "measure" }),
    measureGarmentCoverage(io),
    measureEffectiveColour(io),
  ]);

  const parentCov = coverage.find((f) => f.actorId === PARENT_ACTOR_ID) ?? null;
  const nurseCov = coverage.find((f) => f.actorId === KNOWN_GOOD_ACTOR_ID) ?? null;
  const parentCol = colour.find((f) => f.actorId === PARENT_ACTOR_ID) ?? null;
  const nurseCol = colour.find((f) => f.actorId === KNOWN_GOOD_ACTOR_ID) ?? null;

  const chairResolves: SeatedParentPlacementReport["answers"]["chairResolves"] = live.chair.present
    ? {
        yesNo: "yes",
        note: `chair ${live.chair.slotId} world (${live.chair.worldX?.toFixed(3)}, ${live.chair.worldZ?.toFixed(3)}) seatTopY=${live.chair.seatTopWorldY?.toFixed(3) ?? "n/a"} seatH=${live.chair.seatHeightMeters?.toFixed(3) ?? "n/a"}; parent slot (${live.parent.slotWorldX?.toFixed(3)}, ${live.parent.slotWorldZ?.toFixed(3)})`,
      }
    : { yesNo: "no", note: "no _chair fixture mesh found in the live scene" };

  const pelvisContact: SeatedParentPlacementReport["answers"]["pelvisContact"] = (() => {
    const p = live.parent.pelvisWorldY;
    const s = live.chair.seatTopWorldY;
    if (p === null || s === null) {
      return { yesNo: "no", note: `pelvisY=${p} seatTopY=${s} — one landmark missing` };
    }
    const gap = p - s;
    return gap >= 0
      ? { yesNo: "yes", note: `pelvisY=${p.toFixed(3)} seatTopY=${s.toFixed(3)} gap=${gap.toFixed(3)} m (at or above seat top)` }
      : { yesNo: "no", note: `pelvisY=${p.toFixed(3)} is ${(-gap).toFixed(3)} m BELOW seatTopY=${s.toFixed(3)} — sitting through the chair` };
  })();

  const garmentSurfaceCoverage: SeatedParentPlacementReport["answers"]["garmentSurfaceCoverage"] = (() => {
    const p = parentCov?.combinedBodyClothedFraction ?? null;
    const n = nurseCov?.combinedBodyClothedFraction ?? null;
    if (p === null || n === null) {
      return { yesNo: "no", note: `parent combined=${p} nurse combined=${n} — coverage incomplete` };
    }
    return {
      yesNo: p >= 0.9 ? "yes" : "no",
      note: `parent combined body-surface clothed fraction=${(p * 100).toFixed(1)}% vs nurse reference=${(n * 100).toFixed(1)}% (outward-raycast, tol ${RAY_TOLERANCE_M} m)`,
    };
  })();

  const report = withTreeStamp({
    schemaVersion: "openclinxr.seated-parent-placement.v1" as const,
    kind: "seated_parent_placement" as const,
    label: input?.label ?? "measure",
    generatedAt: new Date().toISOString(),
    scenarioId: SCENARIO_ID,
    environmentId: live.environmentId,
    answers: { chairResolves, pelvisContact, garmentSurfaceCoverage },
    liveScene: {
      chair: live.chair,
      parent: live.parent,
      knownGoodActorId: KNOWN_GOOD_ACTOR_ID,
      headIntersections: live.headIntersections,
    },
    garmentCoverage: {
      instrument:
        "outward-raycast point-to-surface coverage (garment_coverage.py #272 predicate) over the shipped GLBs, "
        + "per claimed body region; combined = coverage weighted by region face count",
      figures: coverage,
    },
    effectiveColour: {
      figures: colour,
    },
    claimScope: [
      "chair_presence_and_position_live",
      "pelvis_to_seat_top_gap_live",
      "garment_surface_coverage_parent_vs_nurse_same_run",
      "garment_effective_colour_vs_own_skin_cie_lab_dE",
    ],
    notEvidenceFor: [
      "pose_naturalness",
      "seat_height_appropriateness",
      "garment_aesthetics",
      "clinical_plausibility",
      "other_stations",
      "quest_readiness",
    ],
  }) satisfies SeatedParentPlacementReport;

  await writeFile(ARTIFACT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`seated-parent-placement: wrote ${ARTIFACT_PATH}\n`);
  return report;
}

const isDirectRun =
  typeof process.argv[1] === "string"
  && (process.argv[1].endsWith("seated-parent-placement.ts")
    || process.argv[1].endsWith("seated-parent-placement.js"));

if (isDirectRun) {
  const args = process.argv.slice(2);
  let label = "cli";
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--label" && args[i + 1]) label = args[++i]!;
  }
  inspectSeatedParentPlacement({ label }).then((report) => {
    process.stdout.write(
      `answers: chair=${report.answers.chairResolves.yesNo} pelvis=${report.answers.pelvisContact.yesNo} coverage=${report.answers.garmentSurfaceCoverage.yesNo}\n`,
    );
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
