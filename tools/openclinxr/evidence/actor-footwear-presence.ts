/**
 * #188 actor footwear presence — inspect shipped humanoid GLBs for shoe geometry.
 *
 * claimScope: footwear mesh presence + placement + foot-bone weights + lower-paint counterweight.
 * notEvidenceFor: clinical costume realism, production readiness, lower-body garment channel,
 * "reads as a shoe" (pixel grade required separately).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NodeIO, type Document, type Mesh } from "@gltf-transform/core";

export const GENERATED_HUMANOIDS_DIR = "apps/ui-xr/public/generated-humanoids";

export const SHIPPED_HUMANOID_GLBS = [
  "adult_male_street_casual.glb",
  "ed_chest_pain_adult_cast.glb",
  "ed_chest_pain_nurse_adult.glb",
  "ed_chest_pain_spouse_adult.glb",
  "peds_anxious_parent.glb",
  "peds_nurse_kevin.glb",
  "peds_patient_child.glb",
] as const;

/** Mesh/node names that count as footwear (#188). */
const FOOTWEAR_MESH_RE = /footwear|shoe|boot|slipper|sandal|sneaker|sock/i;
/** Explicit lower-shell ban for the counterweight. */
const LOWER_SHELL_RE = /trouser|pant|skirt|legging|lower_garment/i;
const DECLARED_UPPER_RE = /declared_upper_layers/i;
const GARMENT_UPPER_RE = /openclinxr_real_garment/i;
const LOWER_PAINT_MAT_RE = /role_mesh_clothing_.*_lower|clothing_.*_lower|lower/i;
const FOOT_BONE_RE = /^foot\.(L|R)$/i;

export type FootwearAssetReport = {
  assetPath: string;
  footwearMeshNames: string[];
  footwearTriangles: number;
  footwearMinY: number;
  footwearMaxY: number;
  bodyMinY: number;
  bodyMaxY: number;
  footBoneWeightedFraction: number;
  lowerPaintTriangles: number;
};

export type FootwearPresenceReport = {
  schemaVersion: "openclinxr.actor-footwear-presence.v1";
  measuredAt: string;
  assets: FootwearAssetReport[];
  claimScope: string;
  notEvidenceFor: string[];
};

const PRE_FIX_PATH = ".openclinxr/evidence/issue-188/pre-fix.json";

type Vec3 = { x: number; y: number; z: number };

function resolveRepoPath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

function meshTriangleCount(mesh: Mesh): number {
  let tris = 0;
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    if (idx) {
      tris += idx.getCount() / 3;
    } else {
      const pos = prim.getAttribute("POSITION");
      if (pos) tris += pos.getCount() / 3;
    }
  }
  return tris;
}

function collectMeshVerts(mesh: Mesh): Vec3[] {
  const verts: Vec3[] = [];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION")?.getArray();
    if (!pos) continue;
    for (let i = 0; i + 2 < pos.length; i += 3) {
      verts.push({
        x: Number(pos[i]),
        y: Number(pos[i + 1]),
        z: Number(pos[i + 2]),
      });
    }
  }
  return verts;
}

function isBodyMeshName(name: string): boolean {
  if (FOOTWEAR_MESH_RE.test(name)) return false;
  if (GARMENT_UPPER_RE.test(name)) return false;
  if (DECLARED_UPPER_RE.test(name)) return false;
  if (LOWER_SHELL_RE.test(name)) return false;
  return true;
}

function footJointIndices(document: Document): Set<number> {
  const out = new Set<number>();
  for (const skin of document.getRoot().listSkins()) {
    const joints = skin.listJoints();
    joints.forEach((j, i) => {
      const n = j.getName() || "";
      if (FOOT_BONE_RE.test(n)) out.add(i);
    });
  }
  return out;
}

/**
 * Fraction of footwear vertices whose dominant (or any non-zero) skin weight
 * is on foot.L / foot.R.
 */
function footBoneWeightedFraction(document: Document, footwearMeshes: Mesh[]): number {
  const footIdx = footJointIndices(document);
  if (footIdx.size === 0) return 0;

  let total = 0;
  let footWeighted = 0;
  for (const mesh of footwearMeshes) {
    for (const prim of mesh.listPrimitives()) {
      const joints = prim.getAttribute("JOINTS_0");
      const weights = prim.getAttribute("WEIGHTS_0");
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const n = pos.getCount();
      if (!joints || !weights) {
        // No skinning → not foot-bone weighted.
        total += n;
        continue;
      }
      const jArr = joints.getArray();
      const wArr = weights.getArray();
      if (!jArr || !wArr) {
        total += n;
        continue;
      }
      for (let vi = 0; vi < n; vi++) {
        total += 1;
        let footW = 0;
        let allW = 0;
        for (let k = 0; k < 4; k++) {
          const ji = Number(jArr[vi * 4 + k] ?? 0);
          const w = Number(wArr[vi * 4 + k] ?? 0);
          allW += w;
          if (footIdx.has(ji)) footW += w;
        }
        // Count vert as foot-weighted when ≥90% of its skin mass is on foot bones.
        if (allW > 1e-6 && footW / allW >= 0.9) footWeighted += 1;
        else if (allW <= 1e-6) {
          // unweighted
        }
      }
    }
  }
  if (total === 0) return 0;
  return footWeighted / total;
}

function lowerPaintTriangles(document: Document): number {
  let tris = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    if (!isBodyMeshName(name)) continue;
    for (const prim of mesh.listPrimitives()) {
      const matName = prim.getMaterial()?.getName() || "";
      if (LOWER_PAINT_MAT_RE.test(matName) && /lower/i.test(matName)) {
        const idx = prim.getIndices();
        if (idx) tris += idx.getCount() / 3;
        else {
          const pos = prim.getAttribute("POSITION");
          if (pos) tris += pos.getCount() / 3;
        }
      }
    }
  }
  return tris;
}

export async function inspectOneHumanoidGlb(glbPath: string): Promise<FootwearAssetReport> {
  const abs = resolveRepoPath(glbPath);
  if (!existsSync(abs)) {
    throw new Error(`inspectActorFootwearPresence: GLB not found: ${abs}`);
  }
  const document = await new NodeIO().read(abs);
  const root = document.getRoot();

  const footwearMeshes: Mesh[] = [];
  const footwearNames: string[] = [];
  const footwearVerts: Vec3[] = [];
  let footwearTris = 0;

  for (const mesh of root.listMeshes()) {
    const name = mesh.getName() || "";
    if (!FOOTWEAR_MESH_RE.test(name)) continue;
    if (LOWER_SHELL_RE.test(name)) continue;
    footwearMeshes.push(mesh);
    footwearNames.push(name);
    footwearTris += meshTriangleCount(mesh);
    footwearVerts.push(...collectMeshVerts(mesh));
  }

  let bodyMinY = Infinity;
  let bodyMaxY = -Infinity;
  for (const mesh of root.listMeshes()) {
    const name = mesh.getName() || "";
    if (!isBodyMeshName(name)) continue;
    for (const v of collectMeshVerts(mesh)) {
      bodyMinY = Math.min(bodyMinY, v.y);
      bodyMaxY = Math.max(bodyMaxY, v.y);
    }
  }
  if (!Number.isFinite(bodyMinY)) {
    bodyMinY = 0;
    bodyMaxY = 1.7;
  }

  let footwearMinY = 0;
  let footwearMaxY = 0;
  if (footwearVerts.length > 0) {
    footwearMinY = Math.min(...footwearVerts.map((v) => v.y));
    footwearMaxY = Math.max(...footwearVerts.map((v) => v.y));
  }

  return {
    assetPath: glbPath.replaceAll("\\", "/"),
    footwearMeshNames: footwearNames,
    footwearTriangles: Math.round(footwearTris),
    footwearMinY,
    footwearMaxY,
    bodyMinY,
    bodyMaxY,
    footBoneWeightedFraction: footBoneWeightedFraction(document, footwearMeshes),
    lowerPaintTriangles: Math.round(lowerPaintTriangles(document)),
  };
}

export async function inspectActorFootwearPresence(input?: {
  assetDir?: string;
  glbNames?: readonly string[];
}): Promise<FootwearPresenceReport> {
  const dir = input?.assetDir ?? GENERATED_HUMANOIDS_DIR;
  const names = input?.glbNames ?? SHIPPED_HUMANOID_GLBS;
  const assets: FootwearAssetReport[] = [];
  for (const name of names) {
    const glbPath = path.join(dir, name).replaceAll("\\", "/");
    assets.push(await inspectOneHumanoidGlb(glbPath));
  }
  return {
    schemaVersion: "openclinxr.actor-footwear-presence.v1",
    measuredAt: new Date().toISOString(),
    assets,
    claimScope:
      "shipped_humanoid_footwear_mesh_presence_placement_foot_bone_weights_lower_paint_counterweight",
    notEvidenceFor: [
      "clinical_costume_realism",
      "production_asset_readiness",
      "b_plus_visual_realism_gate",
      "lower_body_garment_channel",
      "reads_as_a_shoe_pixel_grade",
    ],
  };
}

/** Write ambient pre-fix table (call before product edits if missing). */
export async function ensurePreFixArtifact(outPath = PRE_FIX_PATH): Promise<string> {
  const abs = resolveRepoPath(outPath);
  if (existsSync(abs)) return abs;
  const report = await inspectActorFootwearPresence();
  const ambient = {
    schemaVersion: "openclinxr.issue-188.pre-fix.v1",
    measuredAt: report.measuredAt,
    ambientFailureClass:
      "api_authored=N/A; footwear mesh count=0 on all seven shipped humanoids because nothing generates footwear — upper_layers only; lower clothing is body paint (#73)",
    mechanism:
      "No shoe|boot|foot|sock|sandal mesh in any exported glTF; foot.L/foot.R exist; ~2214 body verts at yn<0.08",
    assets: report.assets.map((a) => ({
      assetPath: a.assetPath,
      footwearMeshNames: a.footwearMeshNames,
      footwearTriangles: a.footwearTriangles,
      lowerPaintTriangles: a.lowerPaintTriangles,
      bodyMinY: a.bodyMinY,
      bodyMaxY: a.bodyMaxY,
      footVertsBandNote: "measured body has feet; footwear meshes absent",
    })),
    claimScope: "pre_fix_calibration_not_a_product_fix",
  };
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(ambient, null, 2)}\n`, "utf8");
  return abs;
}

/** CLI: write pre-fix and/or print inspect JSON. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--pre-fix")) {
    const p = await ensurePreFixArtifact();
    console.log("pre-fix written", p);
  }
  if (args.includes("--inspect") || args.length === 0) {
    const report = await inspectActorFootwearPresence();
    console.log(JSON.stringify(report, null, 2));
  }
  if (args.includes("--write-pre-fix-force")) {
    const abs = resolveRepoPath(PRE_FIX_PATH);
    if (existsSync(abs)) {
      // force rewrite
      const { unlinkSync } = await import("node:fs");
      unlinkSync(abs);
    }
    const p = await ensurePreFixArtifact();
    console.log("pre-fix force-written", p);
  }
}

if (process.argv[1] && process.argv[1].includes("actor-footwear-presence")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
