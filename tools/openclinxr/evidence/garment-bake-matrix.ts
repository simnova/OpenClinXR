/**
 * #195 — Blender garment coefficient bake-matrix harness.
 *
 * Clothing is a parameter of the human bake (automate_blender.py apply_role_clothing_material_regions
 * → _build_body_surface_derived_garment). This harness:
 *  1. Uses a FIXED tracked *.anny_base.obj (no anny regen → no stub trap)
 *  2. Sweeps hardcoded shell coefficients via rebake_role_wardrobe_blender_only.py matrix-variant
 *  3. Measures geometry from the EXPORTED glTF (NodeIO), not Blender
 *  4. Emits garment-ledger.json + labelled contact sheets for orchestrator grading
 *
 * Decisions (commit-named):
 *  - Body: peds_nurse_kevin.anny_base.obj (adult male tracked base used by ED/street rebakes)
 *  - Parametrisation: JSON coeff-overrides file on rebake CLI (reproducible; REJECTED env-only)
 *  - Render: export GLB then software orthographic PNG cells (REJECTED Blender-only stills —
 *    export path is the only way to see the continuity trap; REJECTED full ui-xr boot)
 *  - Sweeps: bot_y_fraction, sleeve_along_fraction, front_opening_rad @ 5 values each on
 *    open_cardigan (cardigan 0.31 is the fixture-artifact hem). Ranges are exploratory — not targets.
 *  - Shipping coefficients UNCHANGED (counterweight); overrides are bake-matrix only.
 *
 * claimScope: geometry ledger + contact sheets for garment coefficient parameter space.
 * notEvidenceFor: clinical validity, visual quality grade (orchestrator grades sheets),
 * Quest readiness, correct hem choice, production wardrobe.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { NodeIO, type Document } from "@gltf-transform/core";
import { chromium } from "playwright";
import { buildContactSheet } from "./isolated-subject-harness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

/**
 * Garment bakes are OPT-IN. Each `matrix-variant` spawns a headless Blender for one coefficient
 * variant, and the harness sweeps a matrix of them — minutes of CPU per variant, hours per sweep.
 *
 * MEASURED 2026-08-11: a broad `vitest` run over `tools/openclinxr/evidence` started this sweep as a
 * side effect and drove machine load to 60 on an M1 Max. It kept respawning a fresh Blender per
 * variant after the dispatching worker was killed, because the orphaned vitest runner owned the loop.
 * A worker whose contract touched two files showed eight modified and hours of Blender it never
 * intended to run.
 *
 * So the bake refuses unless explicitly asked for. This is a COST gate, not a correctness gate — the
 * sweep is real work and still runs on demand:
 *
 *     OPENCLINXR_RUN_GARMENT_BAKES=1 pnpm exec vitest run tools/openclinxr/evidence/garment-bake-matrix.test.ts
 */
export const GARMENT_BAKES_ENV = "OPENCLINXR_RUN_GARMENT_BAKES";

export function garmentBakesEnabled(): boolean {
  return process.env[GARMENT_BAKES_ENV] === "1";
}

export const ISSUE_EVIDENCE_DIR = ".openclinxr/evidence/issue-195";
/** #197 decision + after-column (hem fix + sleeve chain). Reuses the same harness. */
export const ISSUE_197_DIR = ".openclinxr/evidence/issue-197";
/** #200: gown sleeve pin over redefined arm_len — sweep gown, not cardigan. */
export const ISSUE_200_DIR = ".openclinxr/evidence/issue-200";
export const PRE_FIX_PATH = path.join(ISSUE_EVIDENCE_DIR, "pre-fix.json");
export const ISSUE_197_PRE_FIX_PATH = path.join(ISSUE_197_DIR, "pre-fix.json");
export const ISSUE_200_PRE_FIX_PATH = path.join(ISSUE_200_DIR, "pre-fix.json");
export const LEDGER_PATH = path.join(ISSUE_EVIDENCE_DIR, "garment-ledger.json");
export const HEM_SHEET_PATH = path.join(ISSUE_EVIDENCE_DIR, "hem-sweep-sheet.png");
export const SLEEVE_SHEET_PATH = path.join(ISSUE_EVIDENCE_DIR, "sleeve-sweep-sheet.png");
export const OPENING_SHEET_PATH = path.join(ISSUE_EVIDENCE_DIR, "opening-sweep-sheet.png");
export const HEM_SWEEP_AFTER_PATH = path.join(ISSUE_197_DIR, "hem-sweep-after.png");
export const SLEEVE_DIAGNOSIS_PATH = path.join(ISSUE_197_DIR, "sleeve-diagnosis.json");
export const GOWN_SLEEVE_SHEET_PATH = path.join(ISSUE_200_DIR, "gown-sleeve-sweep-sheet.png");
export const GOWN_SLEEVE_LEDGER_PATH = path.join(ISSUE_200_DIR, "gown-sleeve-ledger.json");

/** Fixed body — decision recorded in pre-fix + report. */
export const BODY_BASE = "peds_nurse_kevin.anny_base.obj";
export const GARMENT_LAYERS = ["open_cardigan"] as const;
/** #200 gown sweep layers (same fixed body as cardigan matrix). */
export const GOWN_GARMENT_LAYERS = ["hospital_gown"] as const;

/**
 * Exploratory ranges — not design targets. Include shipping values.
 * #197: cardigan shipping bot_y is 0.42 (was 0.31). Sweep still includes 0.31 so before/after
 * sit on one sheet.
 */
export const BOT_Y_SWEEP = [0.22, 0.28, 0.31, 0.36, 0.42] as const;
/** Full shoulder→wrist chain; 1.0 must reach the wrist after the #197 segment extension. */
export const SLEEVE_ALONG_SWEEP = [0.55, 0.72, 0.85, 0.92, 1.0] as const;
export const FRONT_OPENING_SWEEP = [0.0, 0.35, 0.65, 0.95, 1.2] as const;
/**
 * #200 gown sleeve_along_fraction sweep on the FULL shoulder→wrist chain.
 * Include shipping 0.72 (saturates at arm terminus) plus shorter exam-gown candidates.
 * NOT design targets — orchestrator grades the sheet.
 */
export const GOWN_SLEEVE_ALONG_SWEEP = [0.35, 0.42, 0.50, 0.55, 0.72] as const;

/** Shipped GLBs used to measure role sleeve reach (issue #200 instrument). */
export const SHIPPED_SLEEVE_ACTORS = [
  {
    garmentKind: "hospital_gown",
    actorGlb: "apps/ui-xr/public/generated-humanoids/ed_chest_pain_adult_cast.glb",
  },
  {
    garmentKind: "open_cardigan",
    actorGlb: "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb",
  },
  {
    garmentKind: "scrub",
    actorGlb: "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb",
  },
] as const;

/** Arm landmarks (body AABB fractions) — must match automate_blender.py #197 chain. */
export const ARM_LANDMARKS = {
  shoulder: { xFrac: 0.18, yFrac: 0.74 },
  elbow: { xFrac: 0.34, yFrac: 0.58 },
  wrist: { xFrac: 0.48, yFrac: 0.42 },
} as const;

const GARMENT_MESH_RE = /openclinxr_real_garment/i;
const DECLARED_RE = /declared_upper_layers/i;
const REBAKE_SCRIPT = path.join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/anny/rebake_role_wardrobe_blender_only.py",
);

export type VariantRow = {
  variantId: string;
  param: string;
  value: number;
  garmentKind: string;
  triangles: number;
  worldAabb: { min: [number, number, number]; max: [number, number, number] };
  hemY: number;
  /**
   * LEGACY radial field kept for ledger continuity (#195). NOT distal progress along the arm —
   * do not use for "long sleeve". Prefer cuffAlongBoneT / cuffArcLengthM.
   */
  sleeveExtent: number;
  /**
   * #197: max along-bone t of outer-shell sleeve verts on shoulder→elbow→wrist polyline
   * (0 at shoulder, 1 at wrist). Formula: project nearest garment sleeve vert onto the chain;
   * t = cumArc / fullArmLen.
   */
  cuffAlongBoneT: number;
  /** Arc length (m) from shoulder to measured cuff along the same polyline. */
  cuffArcLengthM: number;
  /** elbow | forearm | wrist — coarse band from cuffAlongBoneT. */
  sleeveReaches: "elbow" | "forearm" | "wrist" | "upper_arm";
  connectedComponents: number;
  enclosesBody: boolean;
  glbPath: string;
  cellImagePath?: string;
};

export type ShippedSleeveReach = {
  garmentKind: string;
  actorGlb: string;
  sleeveEndsAtYFrac: number;
  lateralVertexCount: number;
  bodyHeightM: number;
};

export type GarmentBakeMatrixReport = {
  bodyBase: string;
  shippedCoefficients: {
    name: string;
    value: number;
    producedHemY?: number;
    producedSleeveExtent?: number;
  }[];
  variants: VariantRow[];
  sweeps: { param: string; values: number[] }[];
  contactSheetPaths: string[];
  continuityRebakesSpent: number;
  claimScope: string;
  notEvidenceFor: string[];
  geometryMoved: "yes" | "no" | `partially:${string}`;
  shellEnclosesBody: "all" | `some:${string}`;
  bakePath: "blender_only_rebake" | `other:${string}`;
  coefficientsSwept: string[];
  valuesPerSweep: number;
  /**
   * #200: lowest body-height fraction of garment verts beyond 0.22 lateral on shipped GLBs.
   * Formula: min_y of |x−cx| ≥ body_width×0.22 → (y − body_min_y) / body_height.
   * Higher y_frac = shorter sleeve (cuff higher on the arm).
   */
  shippedSleeveReach: ShippedSleeveReach[];
  gownSleeveSweep?: {
    value: number;
    cuffAlongBoneT: number;
    cuffArcLengthM: number;
    sleeveEndsAtYFrac: number;
    sleeveReaches: string;
    triangles: number;
  }[];
  reportSummary: {
    coefficients_swept: string;
    values_per_sweep: number;
    geometry_moved: string;
    shell_encloses_body: string;
    continuity_rebakes_spent: string;
    bake_path: string;
  };
};

let cachedReport: GarmentBakeMatrixReport | null = null;

function absEvidence(...parts: string[]): string {
  return path.join(REPO_ROOT, ...parts);
}

function ensureDir(p: string): void {
  mkdirSync(path.dirname(p), { recursive: true });
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir(filePath);
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readShippedCoefficientsFromSource(): {
  name: string;
  value: number;
}[] {
  const src = readFileSync(
    path.join(REPO_ROOT, "tools/openclinxr/asset-pipeline/anny/automate_blender.py"),
    "utf8",
  );
  const must = [
    // #197: cardigan hem pin is now 0.42 (was 0.31). Counterweight updated ONLY for this value.
    { name: "cardigan_bot_y_fraction", re: /bot_y = body_min_y \+ body_height \* (0\.42)/ },
    { name: "gown_bot_y_fraction", re: /bot_y = body_min_y \+ body_height \* (0\.32)/ },
    { name: "cardigan_sleeve_along_fraction", re: /sleeve_along = arm_len \* (0\.92)/ },
    // #200: gown sleeve fraction is DECIDED from the gown sweep sheet (was 0.72 pin over full chain
    // that saturated at the arm terminus next to the cardigan). Regex accepts the shipping number
    // in the gown branch only — see gown block `sleeve_along = arm_len * <n>` before cardigan 0.92.
    {
      name: "gown_sleeve_along_fraction",
      re: /if kind == "gown":[\s\S]*?sleeve_along = arm_len \* (0\.\d+)/,
    },
    { name: "cardigan_front_opening_rad", re: /front_opening_rad = (0\.95)/ },
    { name: "cloth_offset_base", re: /cloth_offset = \((0\.010)/ },
    { name: "neck_y_fraction", re: /neck_y = body_min_y \+ body_height \* (0\.84)/ },
  ] as const;
  const out: { name: string; value: number }[] = [];
  for (const row of must) {
    const m = row.re.exec(src);
    if (!m) {
      throw new Error(`shipping coefficient ${row.name} not found in automate_blender.py — counterweight cannot run`);
    }
    out.push({ name: row.name, value: Number(m[1]) });
  }
  return out;
}

type MeshStats = {
  name: string;
  triangles: number;
  positions: Float32Array;
  indices: Uint32Array | null;
};

function collectMeshes(document: Document): MeshStats[] {
  const out: MeshStats[] = [];
  for (const mesh of document.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    for (const prim of mesh.listPrimitives()) {
      const posAttr = prim.getAttribute("POSITION");
      const arr = posAttr?.getArray();
      if (!arr || arr.length < 9) continue;
      const idxAttr = prim.getIndices();
      const idxArr = idxAttr?.getArray();
      const indices = idxArr
        ? new Uint32Array(Array.from(idxArr, (v) => Number(v)))
        : null;
      const triangles = indices
        ? Math.floor(indices.length / 3)
        : Math.floor(arr.length / 9);
      out.push({
        name,
        triangles,
        positions: new Float32Array(Array.from(arr, (v) => Number(v))),
        indices,
      });
    }
  }
  return out;
}

function aabbOf(positions: Float32Array): {
  min: [number, number, number];
  max: [number, number, number];
} {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

/** Position-merged connected components at 5dp across garment primitives only. */
function countPositionMergedComponents(meshes: MeshStats[]): number {
  const keyToIndex = new Map<string, number>();
  const parent: number[] = [];
  const quant = (v: number) => v.toFixed(5);
  const ensure = (x: number, y: number, z: number): number => {
    const key = `${quant(x)},${quant(y)},${quant(z)}`;
    let idx = keyToIndex.get(key);
    if (idx === undefined) {
      idx = parent.length;
      parent.push(idx);
      keyToIndex.set(key, idx);
    }
    return idx;
  };
  const find = (a: number): number => {
    let x = a;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (const mesh of meshes) {
    const pos = mesh.positions;
    const triCount = mesh.indices
      ? Math.floor(mesh.indices.length / 3)
      : Math.floor(pos.length / 9);
    for (let t = 0; t < triCount; t += 1) {
      const i0 = mesh.indices ? mesh.indices[t * 3]! : t * 3;
      const i1 = mesh.indices ? mesh.indices[t * 3 + 1]! : t * 3 + 1;
      const i2 = mesh.indices ? mesh.indices[t * 3 + 2]! : t * 3 + 2;
      const a = ensure(pos[i0 * 3]!, pos[i0 * 3 + 1]!, pos[i0 * 3 + 2]!);
      const b = ensure(pos[i1 * 3]!, pos[i1 * 3 + 1]!, pos[i1 * 3 + 2]!);
      const c = ensure(pos[i2 * 3]!, pos[i2 * 3 + 1]!, pos[i2 * 3 + 2]!);
      unite(a, b);
      unite(a, c);
    }
  }
  if (parent.length === 0) return 0;
  const roots = new Set<number>();
  for (let i = 0; i < parent.length; i += 1) roots.add(find(i));
  return roots.size;
}

function sleeveExtentOf(positions: Float32Array, aabb: { min: [number, number, number]; max: [number, number, number] }): number {
  // LEGACY radial instrument (#195) — max √(dx²+dz²) above mid-Y. NOT along-arm. Kept for ledger.
  const midY = (aabb.min[1] + aabb.max[1]) / 2;
  const cx = (aabb.min[0] + aabb.max[0]) / 2;
  const cz = (aabb.min[2] + aabb.max[2]) / 2;
  let maxR = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const y = positions[i + 1]!;
    if (y < midY) continue;
    const dx = positions[i]! - cx;
    const dz = positions[i + 2]! - cz;
    maxR = Math.max(maxR, Math.hypot(dx, dz));
  }
  return maxR;
}

type Vec3 = [number, number, number];

function armLandmarksFromBody(bodyAabb: {
  min: [number, number, number];
  max: [number, number, number];
}): { shoulder: Vec3; elbow: Vec3; wrist: Vec3; fullLen: number; upperLen: number; forearmLen: number } {
  const bw = Math.max(bodyAabb.max[0] - bodyAabb.min[0], 0.05);
  const bh = Math.max(bodyAabb.max[1] - bodyAabb.min[1], 0.2);
  const cx = (bodyAabb.min[0] + bodyAabb.max[0]) / 2;
  const cz = (bodyAabb.min[2] + bodyAabb.max[2]) / 2;
  const minY = bodyAabb.min[1];
  const pt = (xFrac: number, yFrac: number): Vec3 => [
    cx + bw * xFrac,
    minY + bh * yFrac,
    cz,
  ];
  const shoulder = pt(ARM_LANDMARKS.shoulder.xFrac, ARM_LANDMARKS.shoulder.yFrac);
  const elbow = pt(ARM_LANDMARKS.elbow.xFrac, ARM_LANDMARKS.elbow.yFrac);
  const wrist = pt(ARM_LANDMARKS.wrist.xFrac, ARM_LANDMARKS.wrist.yFrac);
  const dist = (a: Vec3, b: Vec3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const upperLen = dist(shoulder, elbow) || 0.25;
  const forearmLen = dist(elbow, wrist) || 0.25;
  return { shoulder, elbow, wrist, fullLen: upperLen + forearmLen, upperLen, forearmLen };
}

/**
 * Project outer-shell sleeve verts onto shoulder→elbow→wrist polyline.
 * cuffAlongBoneT = max cumArc / fullArmLen among lateral sleeve candidates.
 * Formula (named, not free English):
 *   for each garment vert with |x-cx| >= body_width*0.20 and y > elbow.y - 0.05:
 *     project onto segments [shoulder,elbow] and [elbow,wrist];
 *     cum = arc to closest; t = cum / fullLen;
 *   cuffAlongBoneT = max t
 */
function cuffAlongBoneOf(
  positions: Float32Array,
  bodyAabb: { min: [number, number, number]; max: [number, number, number] },
): {
  cuffAlongBoneT: number;
  cuffArcLengthM: number;
  sleeveReaches: "elbow" | "forearm" | "wrist" | "upper_arm";
  landmarks: ReturnType<typeof armLandmarksFromBody>;
} {
  const lm = armLandmarksFromBody(bodyAabb);
  const bw = Math.max(bodyAabb.max[0] - bodyAabb.min[0], 0.05);
  const cx = (bodyAabb.min[0] + bodyAabb.max[0]) / 2;
  const trueSleeveLat = bw * 0.20;
  const chain: Vec3[] = [lm.shoulder, lm.elbow, lm.wrist];

  const project = (p: Vec3): { d: number; cum: number } => {
    let bestD = Infinity;
    let bestCum = 0;
    let cum = 0;
    for (let i = 0; i < chain.length - 1; i += 1) {
      const a = chain[i]!;
      const b = chain[i + 1]!;
      const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1e-9;
      const t = Math.max(
        0,
        Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / ab2),
      );
      const cxp = a[0] + ab[0] * t;
      const cyp = a[1] + ab[1] * t;
      const czp = a[2] + ab[2] * t;
      const d = Math.hypot(p[0] - cxp, p[1] - cyp, p[2] - czp);
      const segLen = Math.sqrt(ab2);
      if (d < bestD) {
        bestD = d;
        bestCum = cum + t * segLen;
      }
      cum += segLen;
    }
    return { d: bestD, cum: bestCum };
  };

  let maxCum = 0;
  let nCandidates = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    // Outer shell only: far-lateral true sleeve; skip torso shell near mid-line.
    if (Math.abs(x - cx) < trueSleeveLat) continue;
    if (y < lm.wrist[1] - 0.08) continue;
    // Landmarks are authored on +X; fold right sleeve onto left by abs lateral.
    const pFold: Vec3 = [cx + Math.abs(x - cx), y, z];
    const { d, cum } = project(pFold);
    if (d > 0.18) continue; // not near the arm chain
    nCandidates += 1;
    if (cum > maxCum) maxCum = cum;
  }

  const full = lm.fullLen || 0.25;
  const t = nCandidates === 0 ? 0 : Math.min(1, maxCum / full);
  const sleeveReaches: "elbow" | "forearm" | "wrist" | "upper_arm" =
    t >= 0.90 ? "wrist" : t >= 0.55 ? "forearm" : t >= 0.40 ? "elbow" : "upper_arm";

  return {
    cuffAlongBoneT: t,
    cuffArcLengthM: maxCum,
    sleeveReaches,
    landmarks: lm,
  };
}

/**
 * Shell encloses body (exported glTF): not a floating band.
 * Open cardigans need not be watertight — require torso-band Y overlap, co-located centre,
 * and garment half-width covering most of body half-width.
 */
function shellEnclosesBody(
  garmentAabb: { min: [number, number, number]; max: [number, number, number] },
  bodyAabb: { min: [number, number, number]; max: [number, number, number] },
  triangles: number,
): boolean {
  if (triangles < 24) return false;
  const bodyH = bodyAabb.max[1] - bodyAabb.min[1];
  if (bodyH < 0.2) return false;
  const torsoLo = bodyAabb.min[1] + bodyH * 0.35;
  const torsoHi = bodyAabb.min[1] + bodyH * 0.85;
  const yOverlap = garmentAabb.max[1] > torsoLo && garmentAabb.min[1] < torsoHi;
  const bodyCx = (bodyAabb.min[0] + bodyAabb.max[0]) / 2;
  const bodyCz = (bodyAabb.min[2] + bodyAabb.max[2]) / 2;
  const gCx = (garmentAabb.min[0] + garmentAabb.max[0]) / 2;
  const gCz = (garmentAabb.min[2] + garmentAabb.max[2]) / 2;
  const centerOk = Math.hypot(gCx - bodyCx, gCz - bodyCz) < bodyH * 0.28;
  const gHalfW = (garmentAabb.max[0] - garmentAabb.min[0]) / 2;
  const bHalfW = Math.max((bodyAabb.max[0] - bodyAabb.min[0]) / 2, 0.05);
  const widthOk = gHalfW >= bHalfW * 0.50;
  const heightOk = (garmentAabb.max[1] - garmentAabb.min[1]) >= bodyH * 0.10;
  return yOverlap && centerOk && widthOk && heightOk;
}

export async function measureExportedGarmentGlb(glbPath: string): Promise<{
  triangles: number;
  worldAabb: { min: [number, number, number]; max: [number, number, number] };
  hemY: number;
  sleeveExtent: number;
  cuffAlongBoneT: number;
  cuffArcLengthM: number;
  sleeveReaches: "elbow" | "forearm" | "wrist" | "upper_arm";
  connectedComponents: number;
  enclosesBody: boolean;
  garmentMeshes: MeshStats[];
  bodyAabb: { min: [number, number, number]; max: [number, number, number] };
}> {
  const abs = path.isAbsolute(glbPath) ? glbPath : path.join(REPO_ROOT, glbPath);
  if (!existsSync(abs)) {
    throw new Error(`measureExportedGarmentGlb: missing ${abs}`);
  }
  const document = await new NodeIO().read(abs);
  const meshes = collectMeshes(document);
  const garments = meshes.filter(
    (m) => GARMENT_MESH_RE.test(m.name) && !DECLARED_RE.test(m.name),
  );
  const bodyish = meshes.filter(
    (m) =>
      !GARMENT_MESH_RE.test(m.name)
      && !DECLARED_RE.test(m.name)
      && !/hair|eye|tooth|lash|brow/i.test(m.name),
  );

  if (garments.length === 0) {
    throw new Error(`no openclinxr_real_garment* mesh in ${abs}`);
  }

  // Merge garment primitives into one position buffer for hem/sleeve.
  let totalTris = 0;
  const allPos: number[] = [];
  for (const g of garments) {
    totalTris += g.triangles;
    for (let i = 0; i < g.positions.length; i += 1) allPos.push(g.positions[i]!);
  }
  const gPos = new Float32Array(allPos);
  const worldAabb = aabbOf(gPos);
  const hemY = worldAabb.min[1];
  const sleeveExtent = sleeveExtentOf(gPos, worldAabb);
  const connectedComponents = countPositionMergedComponents(garments);

  let bodyAabb: { min: [number, number, number]; max: [number, number, number] };
  if (bodyish.length > 0) {
    const bPos: number[] = [];
    for (const b of bodyish) {
      for (let i = 0; i < b.positions.length; i += 1) bPos.push(b.positions[i]!);
    }
    bodyAabb = aabbOf(new Float32Array(bPos));
  } else {
    // Fallback: expand garment AABB slightly as body proxy (should not happen on full bake).
    bodyAabb = {
      min: [worldAabb.min[0] * 0.9, worldAabb.min[1] - 0.2, worldAabb.min[2] * 0.9],
      max: [worldAabb.max[0] * 0.9, worldAabb.max[1] + 0.2, worldAabb.max[2] * 0.9],
    };
  }

  const cuff = cuffAlongBoneOf(gPos, bodyAabb);

  return {
    triangles: totalTris,
    worldAabb,
    hemY,
    sleeveExtent,
    cuffAlongBoneT: cuff.cuffAlongBoneT,
    cuffArcLengthM: cuff.cuffArcLengthM,
    sleeveReaches: cuff.sleeveReaches,
    connectedComponents,
    enclosesBody: shellEnclosesBody(worldAabb, bodyAabb, totalTris),
    garmentMeshes: garments,
    bodyAabb,
  };
}

/**
 * #200 instrument — lowest body-height fraction of garment verts beyond lateral band.
 * Formula: for garment verts with |x−cx| ≥ body_width×0.22:
 *   y_frac = (y − body_min_y) / body_height; report min y_frac.
 * Higher = shorter sleeve (cuff sits higher on the arm surface).
 */
export async function measureSleeveEndsAtYFrac(glbPath: string): Promise<{
  sleeveEndsAtYFrac: number;
  lateralVertexCount: number;
  bodyHeightM: number;
}> {
  const abs = path.isAbsolute(glbPath) ? glbPath : path.join(REPO_ROOT, glbPath);
  if (!existsSync(abs)) {
    throw new Error(`measureSleeveEndsAtYFrac: missing ${abs}`);
  }
  const document = await new NodeIO().read(abs);
  const meshes = collectMeshes(document);
  const garments = meshes.filter(
    (m) => GARMENT_MESH_RE.test(m.name) && !DECLARED_RE.test(m.name),
  );
  const bodyish = meshes.filter(
    (m) =>
      !GARMENT_MESH_RE.test(m.name)
      && !DECLARED_RE.test(m.name)
      && !/hair|eye|tooth|lash|brow/i.test(m.name),
  );
  if (garments.length === 0) {
    throw new Error(`measureSleeveEndsAtYFrac: no garment mesh in ${abs}`);
  }
  const bPos: number[] = [];
  for (const b of bodyish) {
    for (let i = 0; i < b.positions.length; i += 1) bPos.push(b.positions[i]!);
  }
  if (bPos.length < 9) {
    throw new Error(`measureSleeveEndsAtYFrac: no body mesh in ${abs}`);
  }
  const bodyAabb = aabbOf(new Float32Array(bPos));
  const bh = Math.max(bodyAabb.max[1] - bodyAabb.min[1], 0.2);
  const bw = Math.max(bodyAabb.max[0] - bodyAabb.min[0], 0.05);
  const cx = (bodyAabb.min[0] + bodyAabb.max[0]) / 2;
  const lat = bw * 0.22;
  let minYFrac = Infinity;
  let n = 0;
  for (const g of garments) {
    const pos = g.positions;
    for (let i = 0; i + 2 < pos.length; i += 3) {
      const x = pos[i]!;
      const y = pos[i + 1]!;
      if (Math.abs(x - cx) < lat) continue;
      const yf = (y - bodyAabb.min[1]) / bh;
      if (yf < minYFrac) minYFrac = yf;
      n += 1;
    }
  }
  if (n === 0 || !Number.isFinite(minYFrac)) {
    throw new Error(`measureSleeveEndsAtYFrac: no lateral garment verts in ${abs}`);
  }
  return { sleeveEndsAtYFrac: minYFrac, lateralVertexCount: n, bodyHeightM: bh };
}

/** Measure gown / cardigan / scrub sleeve terminus on shipped role GLBs. */
export async function measureShippedSleeveReach(): Promise<ShippedSleeveReach[]> {
  const out: ShippedSleeveReach[] = [];
  for (const row of SHIPPED_SLEEVE_ACTORS) {
    const m = await measureSleeveEndsAtYFrac(row.actorGlb);
    out.push({
      garmentKind: row.garmentKind,
      actorGlb: row.actorGlb,
      sleeveEndsAtYFrac: m.sleeveEndsAtYFrac,
      lateralVertexCount: m.lateralVertexCount,
      bodyHeightM: m.bodyHeightM,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Software orthographic PNG (no WebGL) — same genus as #194 generator-sweep
// ---------------------------------------------------------------------------

function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function encodePngRgba(width: number, height: number, rgba: Buffer): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function renderMeshesSoftware(
  meshes: MeshStats[],
  width: number,
  height: number,
  label: string,
): Buffer {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const m of meshes) {
    const a = aabbOf(m.positions);
    minX = Math.min(minX, a.min[0]); minY = Math.min(minY, a.min[1]); minZ = Math.min(minZ, a.min[2]);
    maxX = Math.max(maxX, a.max[0]); maxY = Math.max(maxY, a.max[1]); maxZ = Math.max(maxZ, a.max[2]);
  }
  const spanX = Math.max(maxX - minX, 0.2) * 1.12;
  const spanY = Math.max(maxY - minY, 0.2) * 1.12;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = Math.min(width / spanX, (height - 28) / spanY);

  const rgba = Buffer.alloc(width * height * 4, 0);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = 0x18;
    rgba[i * 4 + 1] = 0x21;
    rgba[i * 4 + 2] = 0x1d;
    rgba[i * 4 + 3] = 255;
  }
  const zbuf = new Float32Array(width * height);
  zbuf.fill(-Infinity);

  const put = (px: number, py: number, z: number, r: number, g: number, b: number) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const idx = py * width + px;
    if (z < zbuf[idx]!) return;
    zbuf[idx] = z;
    const o = idx * 4;
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
  };

  const project = (wx: number, wy: number, wz: number) => {
    const sx = Math.round((wx - cx) * scale + width / 2);
    const sy = Math.round(height - 28 - ((wy - cy) * scale + (height - 28) / 2));
    return { sx, sy, z: -wz };
  };

  // Body: grey; garment: rose/teal by name
  for (const mesh of meshes) {
    const isGarment = GARMENT_MESH_RE.test(mesh.name) && !DECLARED_RE.test(mesh.name);
    const r = isGarment ? 0x9e : 0x9c;
    const g = isGarment ? 0x48 : 0xa3;
    const b = isGarment ? 0x61 : 0xaf;
    const pos = mesh.positions;
    const triCount = mesh.indices
      ? Math.floor(mesh.indices.length / 3)
      : Math.floor(pos.length / 9);
    // Subsample dense meshes for speed
    const step = triCount > 8000 ? 2 : 1;
    for (let t = 0; t < triCount; t += step) {
      const i0 = mesh.indices ? mesh.indices[t * 3]! : t * 3;
      const i1 = mesh.indices ? mesh.indices[t * 3 + 1]! : t * 3 + 1;
      const i2 = mesh.indices ? mesh.indices[t * 3 + 2]! : t * 3 + 2;
      const p0 = project(pos[i0 * 3]!, pos[i0 * 3 + 1]!, pos[i0 * 3 + 2]!);
      const p1 = project(pos[i1 * 3]!, pos[i1 * 3 + 1]!, pos[i1 * 3 + 2]!);
      const p2 = project(pos[i2 * 3]!, pos[i2 * 3 + 1]!, pos[i2 * 3 + 2]!);
      const minPx = Math.max(0, Math.min(p0.sx, p1.sx, p2.sx));
      const maxPx = Math.min(width - 1, Math.max(p0.sx, p1.sx, p2.sx));
      const minPy = Math.max(0, Math.min(p0.sy, p1.sy, p2.sy));
      const maxPy = Math.min(height - 1, Math.max(p0.sy, p1.sy, p2.sy));
      const area = (p1.sx - p0.sx) * (p2.sy - p0.sy) - (p2.sx - p0.sx) * (p1.sy - p0.sy);
      if (area === 0) continue;
      for (let y = minPy; y <= maxPy; y += 1) {
        for (let x = minPx; x <= maxPx; x += 1) {
          const w0 = (p1.sx - x) * (p2.sy - y) - (p2.sx - x) * (p1.sy - y);
          const w1 = (p2.sx - x) * (p0.sy - y) - (p0.sx - x) * (p2.sy - y);
          const w2 = (p0.sx - x) * (p1.sy - y) - (p1.sx - x) * (p2.sy - y);
          if (w0 < 0 !== area < 0 && w0 !== 0) continue;
          if (w1 < 0 !== area < 0 && w1 !== 0) continue;
          if (w2 < 0 !== area < 0 && w2 !== 0) continue;
          const a = Math.abs(area);
          const z = (w0 * p0.z + w1 * p1.z + w2 * p2.z) / a;
          put(x, y, z, r, g, b);
        }
      }
    }
  }

  const labelBytes = Buffer.from(label.slice(0, 72), "utf8");
  for (let i = 0; i < Math.min(labelBytes.length, width); i += 1) {
    const o = i * 4;
    rgba[o] = 0xe8; rgba[o + 1] = 0xf5; rgba[o + 2] = 0xef; rgba[o + 3] = 255;
  }
  return encodePngRgba(width, height, rgba);
}

async function writeContactSheetFromCells(
  cells: Array<{ imagePath: string; label: string }>,
  outPath: string,
  columns: number,
): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await buildContactSheet({ page, cells, outPath, columns, cellWidth: 480, cellHeight: 360 });
    return outPath;
  } finally {
    await browser.close();
  }
}

function bakeVariant(input: {
  variantId: string;
  param: string;
  value: number;
  overrides: Record<string, number>;
  outDir: string;
  /** #197: invalidate #195 cache so hem/sleeve changes re-bake. */
  force?: boolean;
  /** Default open_cardigan; #200 gown sweep uses hospital_gown. */
  garmentLayers?: readonly string[];
}): string {
  const glbPath = path.join(input.outDir, `${input.variantId}.glb`);
  if (
    !input.force
    && existsSync(glbPath)
    && existsSync(glbPath.replace(/\.glb$/, ".measure.json"))
  ) {
    // Cache hit from prior partial run
    return glbPath;
  }
  const layers = input.garmentLayers ?? GARMENT_LAYERS;
  const workDir = path.join(input.outDir, `_work_${input.variantId}`);
  const relGlb = path.relative(REPO_ROOT, glbPath);
  const args = [
    REBAKE_SCRIPT,
    "matrix-variant",
    "--body-base",
    BODY_BASE,
    "--garment-layers",
    layers.join(","),
    "--actor-role",
    "patient",
    "--output-glb",
    relGlb,
    "--coeff-overrides",
    JSON.stringify(input.overrides),
    "--work-dir",
    path.relative(REPO_ROOT, workDir),
  ];
  console.log(
    `[garment-bake-matrix] baking ${input.variantId}`,
    layers.join(","),
    JSON.stringify(input.overrides),
  );
  if (!garmentBakesEnabled()) {
    throw new Error(
      `Refusing to bake garment variant "${input.variantId}": each variant spawns a headless Blender `
      + `and the matrix sweeps many of them. Set ${GARMENT_BAKES_ENV}=1 to run bakes deliberately. `
      + `This guard exists because a broad vitest sweep started the matrix as a side effect and drove `
      + `machine load to 60 (2026-08-11).`,
    );
  }
  const result = spawnSync("python3", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 700_000,
    env: { ...process.env, OPENCLINXR_WORKER: "1" },
  });
  if (result.status !== 0) {
    const tail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.slice(-4000);
    throw new Error(
      `matrix-variant failed for ${input.variantId} status=${result.status}\n${tail}`,
    );
  }
  if (!existsSync(glbPath)) {
    throw new Error(`matrix-variant did not write ${glbPath}`);
  }
  const bytes = readFileSync(glbPath).byteLength;
  if (bytes < 1_000_000) {
    throw new Error(`stub trap: ${glbPath} is ${bytes} B`);
  }
  return glbPath;
}

/** Ensure pre-fix exists. Does not overwrite an existing pre-fix (before-column). */
export function ensurePreFixArtifact(): string {
  const out = absEvidence(PRE_FIX_PATH);
  if (existsSync(out)) return out;
  // Reconstruct from source + any already-baked shipping GLB if pre-fix was deleted.
  const shipped = readShippedCoefficientsFromSource();
  const payload = {
    schemaVersion: "openclinxr.garment-bake-matrix.pre-fix.v1",
    measuredAt: new Date().toISOString(),
    reconstructed: true,
    bodyBaseChosen: `apps/ui-xr/public/generated-humanoids/${BODY_BASE}`,
    shippedCoefficients: shipped,
    claimScope: "pre-fix shipped garment coefficients (#195)",
    notEvidenceFor: ["clinical_validity", "quest_readiness", "visual_quality_grade"],
  };
  writeJson(out, payload);
  return out;
}

/**
 * #200 pre-fix: record ambient sleeve reach BEFORE any gown coefficient change.
 * Does not overwrite — before-column is immutable once written.
 */
export async function ensureIssue200PreFixArtifact(): Promise<string> {
  const out = absEvidence(ISSUE_200_PRE_FIX_PATH);
  if (existsSync(out)) return out;
  const reach = await measureShippedSleeveReach();
  const shipped = readShippedCoefficientsFromSource();
  const gownPin = shipped.find((c) => c.name === "gown_sleeve_along_fraction")?.value;
  const cardPin = shipped.find((c) => c.name === "cardigan_sleeve_along_fraction")?.value;
  const payload = {
    schemaVersion: "openclinxr.garment-coeff-issue-200.pre-fix.v1",
    measuredAt: new Date().toISOString(),
    ambientFailureClass:
      "gown_sleeve_along_fraction pinned at 0.72 over full shoulder→wrist arm_len (~0.65 m) "
      + "after #197 redefined the denominator from shoulder→elbow (~0.33 m); "
      + "absolute sleeve ≈ 0.47 m saturates at body arm-surface terminus next to cardigan 0.92. "
      + "Scrub (unpinned, rescaled to 0.22) remains short — pin caused the regression.",
    mechanism:
      "Pinning a ratio does not pin an outcome when the slice may redefine the denominator. "
      + "gown 0.72×0.33≈0.24 m (upper arm) → 0.72×0.65≈0.47 m (past elbow into terminus).",
    shippedCoefficients: shipped,
    gownSleeveAlongFractionAtMeasure: gownPin,
    cardiganSleeveAlongFractionAtMeasure: cardPin,
    shippedSleeveReach: reach,
    gownVsCardiganDeltaYFrac: (() => {
      const g = reach.find((r) => r.garmentKind === "hospital_gown")?.sleeveEndsAtYFrac;
      const c = reach.find((r) => r.garmentKind === "open_cardigan")?.sleeveEndsAtYFrac;
      return g != null && c != null ? Math.abs(g - c) : null;
    })(),
    claimScope: "pre-fix shipped sleeve reach on role GLBs (#200)",
    notEvidenceFor: [
      "clinical_validity",
      "quest_readiness",
      "visual_quality_grade",
      "correct_gown_sleeve_length_choice",
    ],
  };
  writeJson(out, payload);
  return out;
}

async function bakeAndMeasureVariant(job: {
  variantId: string;
  param: string;
  value: number;
  overrides: Record<string, number>;
  outDir: string;
  garmentLayers?: readonly string[];
  garmentKind: string;
}): Promise<VariantRow> {
  const glbPath = bakeVariant({
    variantId: job.variantId,
    param: job.param,
    value: job.value,
    overrides: job.overrides,
    outDir: job.outDir,
    force: false,
    garmentLayers: job.garmentLayers,
  });
  const measure = await measureExportedGarmentGlb(glbPath);
  const yReach = await measureSleeveEndsAtYFrac(glbPath);
  const cellPath = path.join(job.outDir, `${job.variantId}_cell.png`);
  const document = await new NodeIO().read(glbPath);
  const allMeshes = collectMeshes(document);
  const png = renderMeshesSoftware(
    allMeshes,
    480,
    360,
    `${job.param}=${job.value}`,
  );
  writeFileSync(cellPath, png);
  writeJson(path.join(job.outDir, `${job.variantId}.measure.json`), {
    triangles: measure.triangles,
    hemY: measure.hemY,
    sleeveExtent: measure.sleeveExtent,
    cuffAlongBoneT: measure.cuffAlongBoneT,
    cuffArcLengthM: measure.cuffArcLengthM,
    sleeveReaches: measure.sleeveReaches,
    sleeveEndsAtYFrac: yReach.sleeveEndsAtYFrac,
    connectedComponents: measure.connectedComponents,
    enclosesBody: measure.enclosesBody,
    worldAabb: measure.worldAabb,
  });
  return {
    variantId: job.variantId,
    param: job.param,
    value: job.value,
    garmentKind: job.garmentKind,
    triangles: measure.triangles,
    worldAabb: measure.worldAabb,
    hemY: measure.hemY,
    sleeveExtent: measure.sleeveExtent,
    cuffAlongBoneT: measure.cuffAlongBoneT,
    cuffArcLengthM: measure.cuffArcLengthM,
    sleeveReaches: measure.sleeveReaches,
    connectedComponents: measure.connectedComponents,
    enclosesBody: measure.enclosesBody,
    glbPath: path.relative(REPO_ROOT, glbPath),
    cellImagePath: path.relative(REPO_ROOT, cellPath),
  };
}

export async function inspectGarmentBakeMatrix(): Promise<GarmentBakeMatrixReport> {
  if (cachedReport) return cachedReport;

  ensurePreFixArtifact();
  await ensureIssue200PreFixArtifact();
  const preFix = JSON.parse(readFileSync(absEvidence(PRE_FIX_PATH), "utf8")) as {
    shippedCoefficients?: Array<{
      name: string;
      value: number;
      producedHemY?: number;
      producedSleeveExtent?: number;
    }>;
  };

  // Counterweight: re-read shipping source (must still match planted values).
  const fromSource = readShippedCoefficientsFromSource();
  const shippedCoefficients = fromSource.map((c) => {
    const pref = preFix.shippedCoefficients?.find((p) => p.name === c.name);
    return {
      name: c.name,
      value: c.value,
      producedHemY: pref?.producedHemY,
      producedSleeveExtent: pref?.producedSleeveExtent,
    };
  });

  // #197: force re-bake under a new variant dir so stale #195 cache cannot green a wrong hem.
  const outDir = absEvidence(ISSUE_197_DIR, "variants");
  mkdirSync(outDir, { recursive: true });

  const sweeps: { param: string; values: number[] }[] = [
    { param: "bot_y_fraction", values: [...BOT_Y_SWEEP] },
    { param: "sleeve_along_fraction", values: [...SLEEVE_ALONG_SWEEP] },
    { param: "front_opening_rad", values: [...FRONT_OPENING_SWEEP] },
  ];

  const jobs: Array<{
    variantId: string;
    param: string;
    value: number;
    overrides: Record<string, number>;
  }> = [];
  for (const sweep of sweeps) {
    for (const value of sweep.values) {
      const tag = String(value).replace(".", "p");
      jobs.push({
        variantId: `${sweep.param}_${tag}`,
        param: sweep.param,
        value,
        overrides: { [sweep.param]: value },
      });
    }
  }

  // Sequential bakes (Blender is heavy; parallel would thrash M1 shared memory).
  // Continuity budget: we do not rebake on Blender-vs-export disagreement — measure export only.
  const continuityRebakesSpent = 0;
  const variants: VariantRow[] = [];

  for (const job of jobs) {
    variants.push(
      await bakeAndMeasureVariant({
        ...job,
        outDir,
        garmentKind: "open_front",
      }),
    );
  }

  // #200: gown sleeve sweep on hospital_gown (same fixed body). Independent of cardigan matrix.
  const gownOutDir = absEvidence(ISSUE_200_DIR, "variants");
  mkdirSync(gownOutDir, { recursive: true });
  const gownVariants: VariantRow[] = [];
  for (const value of GOWN_SLEEVE_ALONG_SWEEP) {
    const tag = String(value).replace(".", "p");
    gownVariants.push(
      await bakeAndMeasureVariant({
        variantId: `gown_sleeve_along_${tag}`,
        param: "gown_sleeve_along_fraction",
        value,
        overrides: { sleeve_along_fraction: value },
        outDir: gownOutDir,
        garmentLayers: GOWN_GARMENT_LAYERS,
        garmentKind: "hospital_gown",
      }),
    );
  }

  // Geometry moved? Prefer cuffAlongBoneT for sleeve sweep (radial sleeveExtent is wrong instrument).
  const movedParams: string[] = [];
  const stuckParams: string[] = [];
  for (const sweep of sweeps) {
    const rows = variants.filter((v) => v.param === sweep.param);
    const sig = new Set(
      rows.map((v) =>
        sweep.param === "sleeve_along_fraction"
          ? `${v.triangles}|${v.cuffAlongBoneT.toFixed(3)}|${v.cuffArcLengthM.toFixed(3)}`
          : `${v.triangles}|${v.hemY.toFixed(4)}|${v.sleeveExtent.toFixed(4)}`,
      ),
    );
    if (sig.size > 1) movedParams.push(sweep.param);
    else stuckParams.push(sweep.param);
  }
  const geometryMoved: GarmentBakeMatrixReport["geometryMoved"] =
    stuckParams.length === 0
      ? "yes"
      : movedParams.length === 0
        ? "no"
        : `partially:${stuckParams.join(",")}`;

  const detached = variants.filter((v) => !v.enclosesBody);
  const shellEnclosesBody: GarmentBakeMatrixReport["shellEnclosesBody"] =
    detached.length === 0
      ? "all"
      : `some:${detached.map((d) => d.variantId).join(",")}`;

  // Contact sheets
  const hemCells = variants
    .filter((v) => v.param === "bot_y_fraction")
    .map((v) => ({
      imagePath: absEvidence(v.cellImagePath!),
      label: `bot_y_frac=${v.value} hemY=${v.hemY.toFixed(3)} tris=${v.triangles}`,
    }));
  const sleeveCells = variants
    .filter((v) => v.param === "sleeve_along_fraction")
    .map((v) => ({
      imagePath: absEvidence(v.cellImagePath!),
      label: `sleeve_along=${v.value} t=${v.cuffAlongBoneT.toFixed(2)} ${v.sleeveReaches} tris=${v.triangles}`,
    }));
  const openingCells = variants
    .filter((v) => v.param === "front_opening_rad")
    .map((v) => ({
      imagePath: absEvidence(v.cellImagePath!),
      label: `opening=${v.value} hemY=${v.hemY.toFixed(3)} tris=${v.triangles}`,
    }));

  const hemSheet = absEvidence(HEM_SHEET_PATH);
  const sleeveSheet = absEvidence(SLEEVE_SHEET_PATH);
  const openingSheet = absEvidence(OPENING_SHEET_PATH);
  const hemAfter = absEvidence(HEM_SWEEP_AFTER_PATH);
  const gownSleeveSheet = absEvidence(GOWN_SLEEVE_SHEET_PATH);
  await writeContactSheetFromCells(hemCells, hemSheet, 3);
  await writeContactSheetFromCells(sleeveCells, sleeveSheet, 3);
  await writeContactSheetFromCells(openingCells, openingSheet, 3);
  // #197 contract artifact — same hem sheet after the coefficient fix.
  await writeContactSheetFromCells(hemCells, hemAfter, 3);

  // #200 gown sleeve contact sheet — each cell labelled with fraction + measured reach.
  const gownSleeveCells: Array<{ imagePath: string; label: string }> = [];
  for (const v of gownVariants) {
    const yfPath = path.join(gownOutDir, `${v.variantId}.measure.json`);
    let yf = Number.NaN;
    if (existsSync(yfPath)) {
      try {
        yf = (JSON.parse(readFileSync(yfPath, "utf8")) as { sleeveEndsAtYFrac?: number })
          .sleeveEndsAtYFrac ?? Number.NaN;
      } catch {
        yf = Number.NaN;
      }
    }
    gownSleeveCells.push({
      imagePath: absEvidence(v.cellImagePath!),
      label:
        `gown_sleeve=${v.value} t=${v.cuffAlongBoneT.toFixed(2)} `
        + `y_frac=${Number.isFinite(yf) ? yf.toFixed(3) : "?"} ${v.sleeveReaches}`,
    });
  }
  await writeContactSheetFromCells(gownSleeveCells, gownSleeveSheet, 3);

  const contactSheetPaths = [
    path.relative(REPO_ROOT, hemSheet),
    path.relative(REPO_ROOT, sleeveSheet),
    path.relative(REPO_ROOT, openingSheet),
    path.relative(REPO_ROOT, hemAfter),
    path.relative(REPO_ROOT, gownSleeveSheet),
  ];

  const sleeveRows = variants.filter((v) => v.param === "sleeve_along_fraction");
  const shippingSleeve = sleeveRows.find((v) => Math.abs(v.value - 0.92) < 1e-6);
  const maxSleeve = sleeveRows.find((v) => Math.abs(v.value - 1.0) < 1e-6);
  const maxT = Math.max(0, ...sleeveRows.map((v) => v.cuffAlongBoneT));
  const canReachWrist = maxT >= 0.9;
  writeJson(absEvidence(SLEEVE_DIAGNOSIS_PATH), {
    schemaVersion: "openclinxr.garment-coeff-issue-197.sleeve-diagnosis.v1",
    mechanism:
      "Pre-#197 arm_len = shoulder→elbow only; t_max=clamp(sleeve_along/arm_len,0.05,1.0); "
      + "cuff = shoulder+(elbow−shoulder)*t_max so fraction 1.0 was the elbow. "
      + "Post-#197 arm_len = shoulder→elbow→wrist polyline (hand y_frac=0.42, matching armature limb_at); "
      + "cuff walks the chain; fraction 1.0 is the wrist in authoring math. "
      + "Measured body surface: lateral arm span collapses below y_frac≈0.58 (elbow band maxLat~0.53, "
      + "y_frac 0.50 maxLat~0.17) — Anny body mesh has little/no forearm surface to offset. "
      + "Body-surface-derived shells (#121) therefore saturate near mid-forearm even at fraction 1.0.",
    segmentExtendedPastElbow: true,
    longSleeveMeans: "wrist (ulnar-head / hand landmark) — authoring intent",
    sleeveCanReachWrist: canReachWrist
      ? "yes"
      : "no:body_mesh_arm_surface_ends_near_elbow; need forearm surface on the base or a welded distal sleeve extension (rejected free tube class from #121)",
    saturatesAt:
      "body arm-surface terminus (~mid-forearm / elbow band), not the sleeve_along coefficient clamp",
    maxCuffAlongBoneTObserved: maxT,
    rejected: [
      "keep elbow-only segment definition without documenting the body-surface bound — the math must name the wrist so the coefficient space is honest",
      "force wrist length with detached sleeve tubes — reintroduces the #121 continuity failure class",
      "radial sleeveExtent as long-sleeve instrument — lateral reach, not distal progress",
    ],
    shortSleeveRescale:
      "scrub/tshirt/casual fractions reduced (~0.22/0.30/0.28 of full chain) so absolute sleeve_along stays upper-arm after arm_len doubled; cardigan 0.92 counterweight pin unchanged; gown 0.72 pin was #197 residual then #200 set gown to 0.42 (exam upper-arm) from gown-sleeve-sweep-sheet",
    landmarks: {
      shoulder: ARM_LANDMARKS.shoulder,
      elbow: ARM_LANDMARKS.elbow,
      wrist: ARM_LANDMARKS.wrist,
      formula: {
        cuffAlongBoneT:
          "max over outer-shell sleeve verts (|x-cx|>=body_width*0.20) of (cumArc on shoulder→elbow→wrist) / fullArmLen",
        cuffArcLengthM: "same cumArc in metres",
        sleeve_along: "arm_len_full * sleeve_along_fraction (metres along polyline)",
      },
    },
    perVariant: sleeveRows.map((v) => ({
      variantId: v.variantId,
      sleeve_along_fraction: v.value,
      cuffAlongBoneT: v.cuffAlongBoneT,
      cuffArcLengthM: v.cuffArcLengthM,
      sleeveReaches: v.sleeveReaches,
      triangles: v.triangles,
    })),
    shippingCardigan: shippingSleeve
      ? {
          sleeve_along_fraction: 0.92,
          cuffAlongBoneT: shippingSleeve.cuffAlongBoneT,
          sleeveReaches: shippingSleeve.sleeveReaches,
        }
      : null,
    fraction1: maxSleeve
      ? {
          sleeve_along_fraction: 1.0,
          cuffAlongBoneT: maxSleeve.cuffAlongBoneT,
          sleeveReaches: maxSleeve.sleeveReaches,
        }
      : null,
    claimScope: "cuff landmark chain after #197 segment extension + body-surface bound",
    notEvidenceFor: ["clinical_validity", "quest_readiness", "visual_quality_grade"],
  });

  // #200: live sleeve reach on shipped role GLBs (after any gown coefficient change + rebake).
  const shippedSleeveReach = await measureShippedSleeveReach();

  const gownSleeveSweep = gownVariants.map((v) => {
    const yfPath = path.join(gownOutDir, `${v.variantId}.measure.json`);
    let yf = Number.NaN;
    if (existsSync(yfPath)) {
      try {
        yf = (JSON.parse(readFileSync(yfPath, "utf8")) as { sleeveEndsAtYFrac?: number })
          .sleeveEndsAtYFrac ?? Number.NaN;
      } catch {
        yf = Number.NaN;
      }
    }
    return {
      value: v.value,
      cuffAlongBoneT: v.cuffAlongBoneT,
      cuffArcLengthM: v.cuffArcLengthM,
      sleeveEndsAtYFrac: yf,
      sleeveReaches: v.sleeveReaches,
      triangles: v.triangles,
    };
  });

  writeJson(absEvidence(GOWN_SLEEVE_LEDGER_PATH), {
    schemaVersion: "openclinxr.garment-coeff-issue-200.gown-sleeve-ledger.v1",
    bodyBase: BODY_BASE,
    garmentLayers: [...GOWN_GARMENT_LAYERS],
    sweep: [...GOWN_SLEEVE_ALONG_SWEEP],
    variants: gownSleeveSweep,
    shippedSleeveReach,
    gownVsCardiganDeltaYFrac: (() => {
      const g = shippedSleeveReach.find((r) => r.garmentKind === "hospital_gown")?.sleeveEndsAtYFrac;
      const c = shippedSleeveReach.find((r) => r.garmentKind === "open_cardigan")?.sleeveEndsAtYFrac;
      return g != null && c != null ? Math.abs(g - c) : null;
    })(),
    claimScope: "gown sleeve_along_fraction sweep + shipped role reach (#200)",
    notEvidenceFor: [
      "clinical_validity",
      "quest_readiness",
      "visual_quality_grade",
      "correct_gown_sleeve_length_choice",
    ],
  });

  const report: GarmentBakeMatrixReport = {
    bodyBase: `apps/ui-xr/public/generated-humanoids/${BODY_BASE}`,
    shippedCoefficients,
    variants,
    sweeps,
    contactSheetPaths,
    continuityRebakesSpent,
    claimScope:
      "garment coefficient bake-matrix ledger + contact sheets on fixed Anny base (#195/#197/#200)",
    notEvidenceFor: [
      "clinical_validity",
      "quest_readiness",
      "visual_quality_grade",
      "correct_hem_length_choice",
      "correct_gown_sleeve_length_choice",
      "production_wardrobe",
    ],
    geometryMoved,
    shellEnclosesBody,
    bakePath: "blender_only_rebake",
    coefficientsSwept: sweeps.map((s) => s.param),
    valuesPerSweep: BOT_Y_SWEEP.length,
    shippedSleeveReach,
    gownSleeveSweep,
    reportSummary: {
      coefficients_swept: sweeps.map((s) => s.param).join(","),
      values_per_sweep: BOT_Y_SWEEP.length,
      geometry_moved: geometryMoved,
      shell_encloses_body: shellEnclosesBody,
      continuity_rebakes_spent: `${continuityRebakesSpent} of 2`,
      bake_path: "blender_only_rebake",
    },
  };

  writeJson(absEvidence(LEDGER_PATH), {
    schemaVersion: "openclinxr.garment-bake-matrix.ledger.v1",
    ...report,
    contentHash: createHash("sha256")
      .update(
        JSON.stringify(
          variants.map((v) => [
            v.variantId,
            v.triangles,
            v.hemY,
            v.cuffAlongBoneT,
            v.sleeveExtent,
          ]),
        ),
      )
      .digest("hex")
      .slice(0, 16),
  });

  cachedReport = report;
  return report;
}

/** #200 only: pre-fix + gown sleeve sweep + sheet (no cardigan matrix). */
export async function runGownSleeveSweepOnly(): Promise<{
  preFixPath: string;
  sheetPath: string;
  gownSleeveSweep: NonNullable<GarmentBakeMatrixReport["gownSleeveSweep"]>;
  shippedSleeveReach: ShippedSleeveReach[];
}> {
  const preFixPath = await ensureIssue200PreFixArtifact();
  const gownOutDir = absEvidence(ISSUE_200_DIR, "variants");
  mkdirSync(gownOutDir, { recursive: true });
  const gownVariants: VariantRow[] = [];
  for (const value of GOWN_SLEEVE_ALONG_SWEEP) {
    const tag = String(value).replace(".", "p");
    gownVariants.push(
      await bakeAndMeasureVariant({
        variantId: `gown_sleeve_along_${tag}`,
        param: "gown_sleeve_along_fraction",
        value,
        overrides: { sleeve_along_fraction: value },
        outDir: gownOutDir,
        garmentLayers: GOWN_GARMENT_LAYERS,
        garmentKind: "hospital_gown",
      }),
    );
  }
  const gownSleeveSweep = gownVariants.map((v) => {
    const yfPath = path.join(gownOutDir, `${v.variantId}.measure.json`);
    let yf = Number.NaN;
    if (existsSync(yfPath)) {
      try {
        yf = (JSON.parse(readFileSync(yfPath, "utf8")) as { sleeveEndsAtYFrac?: number })
          .sleeveEndsAtYFrac ?? Number.NaN;
      } catch {
        yf = Number.NaN;
      }
    }
    return {
      value: v.value,
      cuffAlongBoneT: v.cuffAlongBoneT,
      cuffArcLengthM: v.cuffArcLengthM,
      sleeveEndsAtYFrac: yf,
      sleeveReaches: v.sleeveReaches,
      triangles: v.triangles,
    };
  });
  const gownSleeveSheet = absEvidence(GOWN_SLEEVE_SHEET_PATH);
  const gownSleeveCells = gownVariants.map((v, i) => ({
    imagePath: absEvidence(v.cellImagePath!),
    label:
      `gown_sleeve=${v.value} t=${v.cuffAlongBoneT.toFixed(2)} `
      + `y_frac=${gownSleeveSweep[i]!.sleeveEndsAtYFrac.toFixed(3)} ${v.sleeveReaches}`,
  }));
  await writeContactSheetFromCells(gownSleeveCells, gownSleeveSheet, 3);
  const shippedSleeveReach = await measureShippedSleeveReach();
  writeJson(absEvidence(GOWN_SLEEVE_LEDGER_PATH), {
    schemaVersion: "openclinxr.garment-coeff-issue-200.gown-sleeve-ledger.v1",
    bodyBase: BODY_BASE,
    garmentLayers: [...GOWN_GARMENT_LAYERS],
    sweep: [...GOWN_SLEEVE_ALONG_SWEEP],
    variants: gownSleeveSweep,
    shippedSleeveReach,
    sheetPath: path.relative(REPO_ROOT, gownSleeveSheet),
    claimScope: "gown sleeve_along_fraction sweep only (#200)",
    notEvidenceFor: [
      "clinical_validity",
      "quest_readiness",
      "visual_quality_grade",
      "correct_gown_sleeve_length_choice",
    ],
  });
  return {
    preFixPath: path.relative(REPO_ROOT, preFixPath),
    sheetPath: path.relative(REPO_ROOT, gownSleeveSheet),
    gownSleeveSweep,
    shippedSleeveReach,
  };
}

// CLI: pnpm exec tsx tools/openclinxr/evidence/garment-bake-matrix.ts [--gown-only]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gownOnly = process.argv.includes("--gown-only");
  const run = gownOnly
    ? runGownSleeveSweepOnly().then((r) => {
        console.log(JSON.stringify({
          mode: "gown-only",
          preFix: r.preFixPath,
          sheet: r.sheetPath,
          sweep: r.gownSleeveSweep,
          shippedSleeveReach: r.shippedSleeveReach,
        }, null, 2));
      })
    : inspectGarmentBakeMatrix().then((r) => {
        console.log(JSON.stringify(r.reportSummary, null, 2));
        console.log("variants", r.variants.length);
        console.log("sheets", r.contactSheetPaths);
        console.log("shippedSleeveReach", r.shippedSleeveReach);
      });
  run.catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
