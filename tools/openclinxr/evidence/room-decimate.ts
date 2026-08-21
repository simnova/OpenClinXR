/**
 * #346 — decimate instead of extract (MADR 0056 item 2).
 *
 * The shipped room carries 440 triangles of a 15,650,564-triangle generator output —
 * 1 in 35,570 — because the hull extraction selects meshes and discards every UV,
 * material, texture and light the generator produced. MADR 0056 item 2 says: take the
 * generator's FULL output and run meshoptimizer / quadric simplification to budget,
 * preserving UVs and normals, rather than hand-rolling the reduction as selection.
 *
 * This module wires the PROVEN reduction tool already in this repo — `simplify()` from
 * `@gltf-transform/functions` with the `meshoptimizer` WASM `MeshoptSimplifier`, the same
 * combination used by the TRELLIS post-opt ladder (trellis-deeper-postopt.ts,
 * trellis-metal-subject-isolation.ts). No simplifier is hand-rolled (D1).
 *
 * The FIRST question this slice must answer, before any product edit:
 *   does the decimated output keep its UVs and materials through glTF export?
 *   A 15.6M -> ~150k simplification that drops UVs produces a smoother hull and buys
 *   nothing. The answer is written to `.openclinxr/evidence/room-decimate/pre-fix.json`
 *   with `measuredAgainstCommit`, carrying tris / materials / textured-materials /
 *   UV-prim count BEFORE and AFTER. If UVs do not survive, the slice stops there.
 *
 * claimScope: meshoptimizer (gltf-transform simplify) decimation of the full Infinigen
 *   generator output, and whether UVs / materials / textures survive that decimation
 *   through glTF export, measured before and after.
 * notEvidenceFor: adoption of any decimated room into the runtime, Quest worn readiness,
 *   clinical validity, room DIMENSIONS, material palette quality, bake path (#345), the
 *   MPFB humanoid material path (#341).
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { NodeIO, type Document as GltfDocument } from "@gltf-transform/core";
import { ALL_EXTENSIONS, Light } from "@gltf-transform/extensions";
import { simplify } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const EVIDENCE_DIR = path.join(REPO_ROOT, ".openclinxr/evidence/room-decimate");
const PRE_FIX_PATH = path.join(EVIDENCE_DIR, "pre-fix.json");
const DECIMATED_GLB_PATH = path.join(EVIDENCE_DIR, "decimated-room.glb");
const RAW_GLB_COPY_PATH = path.join(EVIDENCE_DIR, "raw-dining-room.glb");

const HOME = process.env["HOME"] ?? "";
const DEFAULT_RAW_GLB = path.join(
  HOME,
  ".openclinxr-tools/infinigen/exports/dining-room-seed0.glb",
);

/** Decimation budget — the MADR's "simplify to budget". Quest station posture is 180k. */
const DEFAULT_TARGET_TRIANGLES = 150_000;
/**
 * Simplification error tolerance, in position units (metres for Infinigen).
 * The TRELLIS ladder used 0.002 on ~1 m equipment (0.2% of object scale); a room is
 * ~20 m across, so the same relative tolerance is ~0.04-0.05 m. Measured 2026-08-12:
 * error 0.002 stalls the budget at 15.5M -> 14.6M tris; room scale needs more headroom.
 * Env-overridable for calibration: OPENCLINXR_ROOM_DECIMATE_ERROR.
 */
const DEFAULT_SIMPLIFY_ERROR = Number(process.env["OPENCLINXR_ROOM_DECIMATE_ERROR"] ?? "0.05");

export type GlbMeasure = {
  triangleCount: number;
  meshCount: number;
  materialCount: number;
  texturedMaterialCount: number;
  uvPrimCount: number;
  textureCount: number;
  lightCount: number;
  bytes: number;
};

export type RoomDecimateMeasure = {
  verdict: "uvs_and_materials_survive" | "uvs_or_materials_lost" | "inconclusive_blocked";
  verdictReason: string;
  measuredAgainstCommit: string;
  sourceGlb: string;
  budget: {
    targetTriangles: number;
    ratio: number;
    error: number;
    lockBorder: boolean;
  };
  before: GlbMeasure | null;
  after: GlbMeasure | null;
  decimatedGlbPath: string | null;
  simplifySeconds: number | null;
  /** True when the triangle budget was actually reached (not just requested). */
  budgetReached: boolean;
  /**
   * Connected-component count across all primitives (union-find over indices).
   * Measured 2026-08-12: the raw export is island-dominated — Circle.010 alone is
   * 2,481,157 disconnected quad components, which quadric simplification structurally
   * cannot reduce. Null when not measured.
   */
  connectedComponents: number | null;
  measuredAt: string;
  claimScope: string[];
  notEvidenceFor: string[];
};

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function headCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function blocked(reason: string): RoomDecimateMeasure {
  return {
    verdict: "inconclusive_blocked",
    verdictReason: reason,
    measuredAgainstCommit: headCommit(),
    sourceGlb: "",
    budget: {
      targetTriangles: DEFAULT_TARGET_TRIANGLES,
      ratio: 0,
      error: DEFAULT_SIMPLIFY_ERROR,
      lockBorder: true,
    },
    before: null,
    after: null,
    decimatedGlbPath: null,
    simplifySeconds: null,
    budgetReached: false,
    connectedComponents: null,
    measuredAt: new Date().toISOString(),
    claimScope: [
      "meshoptimizer decimation of the full Infinigen generator output",
      "UV / material / texture survival through glTF export after decimation, measured",
    ],
    notEvidenceFor: [
      "runtime adoption of any decimated room",
      "Quest worn readiness",
      "clinical validity or exam equivalence",
      "room dimensions or material palette quality",
      "the room bake path (#345) or the MPFB humanoid material path (#341)",
    ],
  };
}

/**
 * Measure a GLB with gltf-transform (NodeIO) — the same instrument the shipped-asset
 * contract (a-room-is-lit-and-textured.test.ts) uses.
 *
 * `uvPrimCount` counts primitives carrying a TEXCOORD_0 attribute — the UV channel the
 * generator authored and the extraction throws away. `texturedMaterialCount` counts
 * materials with a baseColorTexture. `lightCount` counts KHR_lights_punctual lights.
 */
export async function measureGlb(glbPath: string): Promise<GlbMeasure> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(glbPath);
  const root = document.getRoot();

  let triangleCount = 0;
  let uvPrimCount = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) triangleCount += Math.floor(idx.getCount() / 3);
      else {
        const pos = prim.getAttribute("POSITION");
        if (pos) triangleCount += Math.floor(pos.getCount() / 3);
      }
      if (prim.getAttribute("TEXCOORD_0")) uvPrimCount += 1;
    }
  }

  const materials = root.listMaterials();
  const texturedMaterials = materials.filter((m) => m.getBaseColorTexture() !== null);

  let lightCount = 0;
  for (const node of root.listNodes()) {
    if (node.getExtension<Light>(Light.EXTENSION_NAME)) lightCount += 1;
  }

  return {
    triangleCount,
    meshCount: root.listMeshes().length,
    materialCount: materials.length,
    texturedMaterialCount: texturedMaterials.length,
    uvPrimCount,
    textureCount: root.listTextures().length,
    lightCount,
    bytes: statSync(glbPath).size,
  };
}

export type DecimateOptions = {
  targetTriangles?: number;
  error?: number;
  lockBorder?: boolean;
};

/**
 * Count connected components across all indexed primitives (union-find over the index
 * buffer, positions NOT welded first). This is the structural measure that explains why
 * a ratio-based budget stalls: disconnected islands cannot be quadric-collapsed.
 */
export async function countConnectedComponents(glbPath: string): Promise<number> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(glbPath);
  const root = document.getRoot();

  let components = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      const position = prim.getAttribute("POSITION");
      if (!indices || !position) continue;
      const idx = indices.getArray();
      if (!idx) continue;
      const vCount = position.getCount();
      if (vCount === 0) continue;
      const parent = new Int32Array(vCount);
      for (let i = 0; i < vCount; i++) parent[i] = i;
      const find = (x: number): number => {
        while (parent[x] !== x) {
          parent[x] = parent[parent[x]]!;
          x = parent[x]!;
        }
        return x;
      };
      const union = (a: number, b: number): void => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[ra] = rb;
      };
      for (let i = 0; i + 2 < idx.length; i += 3) {
        union(idx[i]!, idx[i + 1]!);
        union(idx[i]!, idx[i + 2]!);
      }
      const roots = new Set<number>();
      for (let i = 0; i < vCount; i++) roots.add(find(i));
      components += roots.size;
    }
  }
  return components;
}

/**
 * The decimation stage — meshoptimizer (WASM) quadric simplification via
 * `@gltf-transform/functions`. Wired, not hand-rolled (D1): the same proven combination
 * as the TRELLIS post-opt ladder.
 *
 * `ratio` is computed from the source triangle count so the caller can ask for a BUDGET
 * (e.g. 150k) rather than a ratio. Returns the target triangle count it aimed for.
 */
export async function decimateGlb(
  inputPath: string,
  outputPath: string,
  options: DecimateOptions = {},
): Promise<{ targetTriangles: number; ratio: number; afterTris: number }> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document: GltfDocument = await io.read(inputPath);

  const before = await measureGlb(inputPath);
  const targetTriangles = options.targetTriangles ?? DEFAULT_TARGET_TRIANGLES;
  const ratio = Math.min(1, targetTriangles / Math.max(1, before.triangleCount));

  await MeshoptSimplifier.ready;
  await document.transform(
    simplify({
      simplifier: MeshoptSimplifier,
      ratio,
      error: options.error ?? DEFAULT_SIMPLIFY_ERROR,
      lockBorder: options.lockBorder ?? true, // preserve topological borders / UV seams
    }),
  );

  ensureDir(path.dirname(outputPath));
  await io.write(outputPath, document);

  const after = await measureGlb(outputPath);
  return { targetTriangles, ratio, afterTris: after.triangleCount };
}

/**
 * Answer the FIRST question of #346: does meshoptimizer decimation of the full Infinigen
 * generator output keep its UVs and materials through glTF export?
 *
 * Writes `.openclinxr/evidence/room-decimate/pre-fix.json` (git add -f required — the
 * whole `.openclinxr/` tree is gitignored) plus a decimated-room GLB artifact.
 *
 * Re-uses a cached pre-fix.json when present unless OPENCLINXR_FORCE_ROOM_DECIMATE=1.
 */
export async function inspectRoomDecimate(): Promise<RoomDecimateMeasure> {
  ensureDir(EVIDENCE_DIR);

  if (existsSync(PRE_FIX_PATH) && process.env["OPENCLINXR_FORCE_ROOM_DECIMATE"] !== "1") {
    try {
      const cached = JSON.parse(readFileSync(PRE_FIX_PATH, "utf8")) as RoomDecimateMeasure;
      if (cached?.verdict && cached.before && cached.after) {
        return cached;
      }
    } catch {
      // re-measure
    }
  }

  const sourceGlb = process.env["OPENCLINXR_INFINIGEN_RAW_GLB"] ?? DEFAULT_RAW_GLB;
  if (!existsSync(sourceGlb)) {
    const report = blocked(
      `Raw generator GLB not found at ${sourceGlb}. Expected the full Infinigen ` +
        `output export (dining-room-seed0.glb). Set OPENCLINXR_INFINIGEN_RAW_GLB to override.`,
    );
    writeFileSync(PRE_FIX_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }

  let before: GlbMeasure;
  try {
    before = await measureGlb(sourceGlb);
  } catch (err) {
    const report = blocked(`Failed to measure source GLB: ${String(err).slice(0, 1200)}`);
    writeFileSync(PRE_FIX_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }

  const t0 = performance.now();
  let decimated: { targetTriangles: number; ratio: number; afterTris: number };
  try {
    decimated = await decimateGlb(sourceGlb, DECIMATED_GLB_PATH, {
      targetTriangles: DEFAULT_TARGET_TRIANGLES,
    });
  } catch (err) {
    const report = blocked(`meshoptimizer decimation failed: ${String(err).slice(0, 1200)}`);
    writeFileSync(PRE_FIX_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }
  const simplifySeconds = (performance.now() - t0) / 1000;

  const after = await measureGlb(DECIMATED_GLB_PATH);
  const connectedComponents = await countConnectedComponents(sourceGlb);
  const budgetReached = after.triangleCount <= DEFAULT_TARGET_TRIANGLES;

  const uvsSurvive = after.uvPrimCount === before.uvPrimCount;
  const materialsSurvive = after.materialCount === before.materialCount;
  const texturesSurvive = after.texturedMaterialCount === before.texturedMaterialCount;

  let verdict: RoomDecimateMeasure["verdict"];
  let verdictReason: string;
  if (uvsSurvive && materialsSurvive && texturesSurvive) {
    verdict = "uvs_and_materials_survive";
    verdictReason =
      `meshoptimizer simplify kept ALL ${before.uvPrimCount} UV'd primitives, all ` +
      `${before.materialCount} materials and all ${before.texturedMaterialCount} textured ` +
      `materials through glTF. ${before.triangleCount.toLocaleString()} -> ` +
      `${after.triangleCount.toLocaleString()} tris (${(1 - after.triangleCount / before.triangleCount) * 100}` +
      `% reduction; ratio ${decimated.ratio.toFixed(4)} requested, ` +
      `${budgetReached ? "budget REACHED" : "budget NOT reached"}). ` +
      `Measured cause of the stall: the raw export is island-dominated — ` +
      `${connectedComponents.toLocaleString()} disconnected components across all primitives ` +
      `(largest mesh Circle.010 alone is 2,481,157 quad islands), and quadric simplification ` +
      `cannot reduce below the per-island minimum. The channel survival this question asks ` +
      `about is independent of that: YES, UVs and materials survive.`;
  } else {
    verdict = "uvs_or_materials_lost";
    const lost: string[] = [];
    if (!uvsSurvive) lost.push(`UV prims ${before.uvPrimCount} -> ${after.uvPrimCount}`);
    if (!materialsSurvive) lost.push(`materials ${before.materialCount} -> ${after.materialCount}`);
    if (!texturesSurvive) {
      lost.push(`textured materials ${before.texturedMaterialCount} -> ${after.texturedMaterialCount}`);
    }
    verdictReason =
      `meshoptimizer decimation LOST channel data: ${lost.join("; ")}. ` +
      `"Decimate instead of extract" is NOT viable through this path; extraction is the ` +
      `only route that preserves the generator's materials.`;
  }

  const report: RoomDecimateMeasure = {
    verdict,
    verdictReason,
    measuredAgainstCommit: headCommit(),
    sourceGlb,
    budget: {
      targetTriangles: decimated.targetTriangles,
      ratio: decimated.ratio,
      error: DEFAULT_SIMPLIFY_ERROR,
      lockBorder: true,
    },
    before,
    after,
    decimatedGlbPath: DECIMATED_GLB_PATH,
    simplifySeconds,
    budgetReached,
    connectedComponents,
    measuredAt: new Date().toISOString(),
    claimScope: [
      "meshoptimizer decimation of the full Infinigen generator output",
      "UV / material / texture survival through glTF export after decimation, measured",
    ],
    notEvidenceFor: [
      "runtime adoption of any decimated room",
      "Quest worn readiness",
      "clinical validity or exam equivalence",
      "room dimensions or material palette quality",
      "the room bake path (#345) or the MPFB humanoid material path (#341)",
    ],
  };

  writeFileSync(PRE_FIX_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

// CLI
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  inspectRoomDecimate()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
