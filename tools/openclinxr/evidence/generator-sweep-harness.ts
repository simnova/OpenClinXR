/**
 * #194 / #198 — in-process generator sweep harness for the two pure three.js builders.
 *
 * Subjects:
 *  - equipment: resolveEquipmentGeometry(id) — parametric builder OR real GLB when
 *    REAL_EQUIPMENT_GLTF_BY_ID declares one (#198 path honesty; sync-only was a harness
 *    artefact that over-reported 2 of 19 "fallbacks").
 *  - rooms: buildStationEnvironment({ environmentId, optional dimension overrides })
 *
 * NOT in this slice: Blender human bake / clothing (clothing is a parameter of the
 * human bake at automate_blender.py:3077, not a peer generator).
 *
 * Decisions (commit-named):
 *  - Import builders from apps/ui-xr (REJECTED package extract — larger, no second consumer yet).
 *  - three resolved via ui-xr node_modules path (tools/ cannot import package "three").
 *  - Render path: pure Node software orthographic projection (REJECTED Vite/ui-xr boot;
 *    REJECTED headless_three/WebGL — no `gl` package; Playwright only for contact-sheet
 *    HTML composite reuse of buildContactSheet).
 *  - Room params swept: roomWidthMeters {4,7,10}, roomHeightMeters {2.0,2.65,3.4} on
 *    ed_exam_bay_v1. roomDepthMeters also measured (ledger + sheet) but NOT listed as a
 *    formal sweep: doorway framing pins maxZ≈0.95 so the planted max-AABB signature is
 *    blind to depth alone (tris unchanged for BoxGeometry scale). REJECTED multi-env as
 *    "param sweep" — confounds fixture lists with dimensions.
 *  - Fallback rows: explicit resolvedToFallback=true from userData.openClinXrEquipmentSource
 *    (REJECTED signature-only 3/56 — clearer, harder to game by renaming).
 *  - #198 GLB path: load once into a module cache via GLTFLoader.parse(ArrayBuffer)
 *    (REJECTED re-parse every inspect — 1.52 s runtime is a feature; cache keeps it).
 *  - #198 support surfaces: separate builders in station-equipment-support-surfaces.ts
 *    (REJECTED shared parameterised bed/stretcher — silhouette collapse risk).
 *
 * claimScope: geometry ledger + contact sheets for the two in-process generators.
 * notEvidenceFor: clinical validity, visual quality grade (orchestrator grades sheets),
 * Quest readiness, garment/body generation.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";
// three is not a root dep — resolve from ui-xr (same pattern as in-process builder imports).
import {
  Box3,
  Color,
  Group,
  Mesh,
  Vector3,
  type MeshStandardMaterial,
  type Object3D,
} from "../../../apps/ui-xr/node_modules/three/build/three.module.js";
import { GLTFLoader } from "../../../apps/ui-xr/node_modules/three/examples/jsm/loaders/GLTFLoader.js";
import { ENVIRONMENT_SHELL_DESCRIPTORS } from "../../../packages/openclinxr/asset-registry/src/environment-descriptors.js";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/index.js";
import {
  buildDeclaredEquipmentGeometry,
  buildGenericClinicalEquipmentFallback,
  countEquipmentGeometry,
  REAL_EQUIPMENT_GLTF_BY_ID,
} from "../../../apps/ui-xr/src/station-equipment.js";
import { buildStationEnvironment } from "../../../apps/ui-xr/src/station-environment.js";
import { buildContactSheet } from "./isolated-subject-harness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
export const ISSUE_EVIDENCE_DIR = ".openclinxr/evidence/issue-194";
/** #198 product evidence (support-surface builders + honest path ledger). */
export const ISSUE_198_EVIDENCE_DIR = ".openclinxr/evidence/issue-198";
/** #202 product evidence — full equipment-generator distinctness. */
export const ISSUE_202_EVIDENCE_DIR = ".openclinxr/evidence/issue-202";
export const PRE_FIX_PATH = path.join(ISSUE_202_EVIDENCE_DIR, "pre-fix.json");
/** #198 frozen before-column (support surfaces only); retained for that slice's residual. */
export const PRE_FIX_198_PATH = path.join(ISSUE_198_EVIDENCE_DIR, "pre-fix.json");
export const EQUIPMENT_LEDGER_PATH = path.join(ISSUE_EVIDENCE_DIR, "equipment-ledger.json");
export const ROOM_LEDGER_PATH = path.join(ISSUE_EVIDENCE_DIR, "room-ledger.json");
export const EQUIPMENT_SHEET_PATH = path.join(ISSUE_EVIDENCE_DIR, "equipment-sheet.png");
export const EQUIPMENT_SHEET_AFTER_PATH = path.join(ISSUE_202_EVIDENCE_DIR, "equipment-sheet-after.png");
export const EQUIPMENT_SHEET_AFTER_198_PATH = path.join(ISSUE_198_EVIDENCE_DIR, "equipment-sheet-after.png");
export const ROOM_SWEEP_SHEET_PATH = path.join(ISSUE_EVIDENCE_DIR, "room-sweep-sheet.png");

/**
 * Ids that were still the 56-triangle grey pole after #198 (#202 pre-fix freeze).
 * Measured on main before family builders landed — do not re-derive.
 */
const GREY_POLE_RESIDUAL_IDS = new Set([
  "12_lead_ecg_machine_equipment",
  "abdominal_exam_light_equipment",
  "antipyretic_tray_equipment",
  "digital_thermometer_equipment",
  "ehr_screen_equipment",
  "glucometer_review_equipment",
  "hydration_supplies_equipment",
  "iv_pole_equipment",
  "lab_results_panel_equipment",
  "observation_station_equipment",
  "oxygen_nasal_cannula_equipment",
  "safe_room_chair_equipment",
  "surgical_consult_phone_equipment",
  "tablet_visit_equipment",
]);

const MEDICAL_EQUIPMENT_DIR = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/xr-assets/medical-equipment",
);

/** GLB groups cached once per process — keeps ~1.5 s harness runtime. */
const gltfGroupCache = new Map<string, Group>();

/** Support surfaces whose pre-fix rows freeze the fallback silhouette (#198). */
const SUPPORT_SURFACE_IDS = new Set([
  "hospital_bed_equipment",
  "stretcher_equipment",
  "side_rails_equipment",
]);

const SWEEP_ENV = "ed_exam_bay_v1";
const WIDTH_SWEEP = [4, 7, 10] as const;
const HEIGHT_SWEEP = [2.0, 2.65, 3.4] as const;
/** Depth variants for fixture-track diagnosis + sheet; not a formal contract sweep (maxZ pinned). */
const DEPTH_SWEEP = [2.5, 3.45, 5] as const;

export type ResolvedSource = "gltf" | "parametric" | "fallback";

export type LedgerRow = {
  subjectId: string;
  subjectFamily: "equipment" | "room";
  params: Record<string, number | string | boolean>;
  meshCount: number;
  /** Alias of meshCount — formula field name from the instrument contract. */
  partCount: number;
  triangles: number;
  partNames: string[];
  worldAabb: { min: [number, number, number]; max: [number, number, number] };
  /**
   * footprintExtent = worldAabb.max - worldAabb.min (per axis).
   * Extent, not a single-sided max — max alone is pinned by extreme geometry (§10o).
   */
  footprintExtent: [number, number, number];
  /**
   * deckHeightM = max(Y) over meshes whose name matches deck/mattress/seat/top.
   * null when no deck-like part exists (e.g. side rails, wall clock).
   */
  deckHeightM: number | null;
  /**
   * silhouetteKey = `${partCount}|${triangles}|${footprintExtent.map(v => v.toFixed(2))}`
   */
  silhouetteKey: string;
  distinctMaterialColors: number;
  connectedComponents: number;
  resolvedToFallback: boolean;
  /** Path identity: which production path produced this geometry. */
  resolvedSource: ResolvedSource;
  /**
   * Named family when the id is parametric via a shared family builder (#202).
   * Undefined only for GLB or deliberately generic residual (none after #202).
   */
  family?: string;
  /** Fixture world positions (rooms only) — for track-vs-constant diagnosis. */
  fixtureWorldPositions?: Array<{ slotId: string; x: number; y: number; z: number }>;
};

export type GeneratorSweepReport = {
  ledger: LedgerRow[];
  sweeps: { subjectId: string; param: string; values: (number | string)[] }[];
  contactSheetPaths: string[];
  claimScope: string;
  notEvidenceFor: string[];
  fixturesTrackRoomDimensions: "yes" | "no" | "partially:width" | "partially:depth" | "partially:none";
  renderPath: "other:software_orthographic";
  reportSummary: {
    equipment_ids_swept: string;
    ids_resolving_to_fallback: number;
    environments_swept: string;
    room_params_swept: string[];
    fixtures_track_room_dimensions: string;
    render_path: string;
    distinct_geometry_across_range: string;
  };
};

let cachedReport: GeneratorSweepReport | null = null;

function absEvidence(...parts: string[]): string {
  return path.join(REPO_ROOT, ...parts);
}

/** Dynamically enumerate declared equipment ids from what ships — never a literal list. */
export function listDeclaredEquipmentIds(): string[] {
  const ids = new Set<string>();
  // scenarioBank.equipment is human labels; ids live on assetNeeds with type equipment.
  for (const scenario of scenarioBank) {
    for (const row of scenario.assetNeeds ?? []) {
      const id = row.assetId;
      if (typeof id === "string" && id.endsWith("_equipment")) ids.add(id);
      if (row.assetType === "equipment" && typeof id === "string") ids.add(id);
    }
  }
  const generatedRoot = path.join(REPO_ROOT, "apps/ui-xr/public/xr-assets/generated");
  if (existsSync(generatedRoot)) {
    for (const name of readdirSync(generatedRoot)) {
      for (const file of ["scene-manifest.v1.json", "learner-runtime-bundle.v1.json"] as const) {
        const manifestPath = path.join(generatedRoot, name, file);
        if (!existsSync(manifestPath)) continue;
        const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as {
          equipmentPlacements?: Record<string, unknown>;
          equipment?: Array<{ equipmentId?: string } | string>;
        };
        for (const id of Object.keys(raw.equipmentPlacements ?? {})) {
          if (id.endsWith("_equipment")) ids.add(id);
        }
        for (const row of raw.equipment ?? []) {
          const id = typeof row === "string" ? row : row.equipmentId;
          if (typeof id === "string" && id.endsWith("_equipment")) ids.add(id);
        }
      }
    }
  }
  for (const id of Object.keys(REAL_EQUIPMENT_GLTF_BY_ID)) ids.add(id);
  return [...ids].sort();
}

/** Dynamically enumerate environment ids from the shipped descriptor table. */
export function listEnvironmentIds(): string[] {
  return Object.keys(ENVIRONMENT_SHELL_DESCRIPTORS).sort();
}

function materialColorKey(mesh: Mesh): string | null {
  const mat = mesh.material;
  if (!mat || Array.isArray(mat)) return null;
  const std = mat as MeshStandardMaterial;
  if (std.color && typeof std.color.getHex === "function") {
    return std.color.getHexString();
  }
  return null;
}

/**
 * Position-merged connected components at 5dp (across all meshes in the group).
 * Index-based multi-material islands are not surface breaks (§6t / #121).
 */
function countPositionMergedComponents(root: Object3D): number {
  const keyToIndex = new Map<string, number>();
  const positions: Array<[number, number, number]> = [];
  const faces: number[][] = [];

  const quant = (v: number) => v.toFixed(5);
  const ensureVert = (x: number, y: number, z: number): number => {
    const key = `${quant(x)},${quant(y)},${quant(z)}`;
    let idx = keyToIndex.get(key);
    if (idx === undefined) {
      idx = positions.length;
      positions.push([x, y, z]);
      keyToIndex.set(key, idx);
    }
    return idx;
  };

  root.updateMatrixWorld(true);
  root.traverse((obj: Object3D) => {
    if (!(obj instanceof Mesh) || !obj.geometry) return;
    const geo = obj.geometry;
    const pos = geo.getAttribute("position");
    if (!pos) return;
    const index = geo.index;
    const v = new Vector3();
    const localFaces: number[][] = [];
    if (index) {
      for (let i = 0; i + 2 < index.count; i += 3) {
        const tri: number[] = [];
        for (let k = 0; k < 3; k += 1) {
          const vi = index.getX(i + k);
          v.fromBufferAttribute(pos, vi);
          v.applyMatrix4(obj.matrixWorld);
          tri.push(ensureVert(v.x, v.y, v.z));
        }
        localFaces.push(tri);
      }
    } else {
      for (let i = 0; i + 2 < pos.count; i += 3) {
        const tri: number[] = [];
        for (let k = 0; k < 3; k += 1) {
          v.fromBufferAttribute(pos, i + k);
          v.applyMatrix4(obj.matrixWorld);
          tri.push(ensureVert(v.x, v.y, v.z));
        }
        localFaces.push(tri);
      }
    }
    for (const f of localFaces) faces.push(f);
  });

  const n = positions.length;
  if (n === 0) return 0;
  const parent = Array.from({ length: n }, (_, i) => i);
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
  for (const f of faces) {
    for (let i = 1; i < f.length; i += 1) unite(f[0]!, f[i]!);
  }
  const roots = new Set<number>();
  for (let i = 0; i < n; i += 1) roots.add(find(i));
  return roots.size;
}

function collectPartNames(root: Object3D): string[] {
  const names: string[] = [];
  root.traverse((obj: Object3D) => {
    if (obj instanceof Mesh && obj.name) names.push(obj.name);
  });
  return names.sort();
}

function collectDistinctColors(root: Object3D): number {
  const colors = new Set<string>();
  root.traverse((obj: Object3D) => {
    if (!(obj instanceof Mesh)) return;
    const key = materialColorKey(obj);
    if (key) colors.add(key);
  });
  return colors.size;
}

function worldAabb(root: Object3D): { min: [number, number, number]; max: [number, number, number] } {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
}

/** footprintExtent = worldAabb.max − worldAabb.min (vector, not scalar). */
function footprintExtentOf(
  aabb: { min: [number, number, number]; max: [number, number, number] },
): [number, number, number] {
  return [
    aabb.max[0]! - aabb.min[0]!,
    aabb.max[1]! - aabb.min[1]!,
    aabb.max[2]! - aabb.min[2]!,
  ];
}

/**
 * deckHeightM = max(Y) over the primitive whose name matches the deck/top part.
 * Matches mattress_deck, mattress, deck, seat, top (case-insensitive).
 */
function deckHeightMOf(root: Object3D): number | null {
  root.updateMatrixWorld(true);
  let maxY = -Infinity;
  let found = false;
  root.traverse((obj: Object3D) => {
    if (!(obj instanceof Mesh) || !obj.name) return;
    const n = obj.name.toLowerCase();
    if (!/(mattress|deck|seat|top)/u.test(n)) return;
    if (/push_bar|headboard|footboard|rail|post|bar|leg|caster|wheel|column|cross/u.test(n)) {
      // Prefer true deck surfaces; skip structural names that also match loosely.
      if (!/(mattress|deck|seat)/u.test(n)) return;
    }
    const box = new Box3().setFromObject(obj);
    if (Number.isFinite(box.max.y) && box.max.y > maxY) {
      maxY = box.max.y;
      found = true;
    }
  });
  return found ? maxY : null;
}

/** silhouetteKey = partCount|triangles|footprintExtent.map(v => v.toFixed(2)) */
export function computeSilhouetteKey(
  partCount: number,
  triangles: number,
  extent: [number, number, number],
): string {
  return `${partCount}|${triangles}|${extent.map((v) => v.toFixed(2)).join(",")}`;
}

function sourceFromUserData(root: Object3D): ResolvedSource {
  const raw = root.userData?.openClinXrEquipmentSource;
  if (raw === "gltf" || raw === "parametric" || raw === "fallback") return raw;
  return "fallback";
}

function familyFromUserData(root: Object3D): string | undefined {
  const raw = root.userData?.openClinXrEquipmentFamily;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/**
 * Load a real equipment GLB via GLTFLoader.parse (Node-safe ArrayBuffer path).
 * Cached once per absolute path for the process lifetime.
 */
async function loadGltfEquipmentGroup(equipmentId: string, gltfFileName: string): Promise<Group> {
  const abs = path.join(MEDICAL_EQUIPMENT_DIR, gltfFileName);
  const cached = gltfGroupCache.get(abs);
  if (cached) {
    // Clone so matrix/userData mutations per measure do not poison the cache.
    const clone = cached.clone(true) as Group;
    clone.userData = { ...cached.userData };
    return clone;
  }
  if (!existsSync(abs)) {
    throw new Error(`declared GLB missing for ${equipmentId}: ${abs}`);
  }
  const buf = readFileSync(abs);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const loader = new GLTFLoader();
  const gltf = await new Promise<{ scene: Object3D }>((resolve, reject) => {
    loader.parse(
      arrayBuffer,
      path.dirname(abs) + path.sep,
      (result: { scene: Object3D }) => resolve(result),
      (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
  const root = new Group();
  root.name = `openclinxr.equipment.${equipmentId}`;
  root.add(gltf.scene);
  root.userData.openClinXrEquipmentId = equipmentId;
  root.userData.openClinXrEquipmentSource = "gltf";
  root.userData.openClinXrRuntimeEquipmentAssetId = equipmentId;
  root.userData.openClinXrGltfFileName = gltfFileName;
  root.userData.openClinXrEquipmentFamily = "gltf";
  root.userData.openClinXrAffordances = ["selectable_equipment_reference", "clinical_workflow_cue"];
  gltfGroupCache.set(abs, root);
  const clone = root.clone(true) as Group;
  clone.userData = { ...root.userData };
  return clone;
}

/**
 * Production-honest equipment resolve: GLB when declared and present, else parametric builder.
 * This is what planStationEquipmentMounts + the learner mount path intend.
 */
export async function resolveEquipmentGeometry(equipmentId: string): Promise<Group> {
  const gltfFile = REAL_EQUIPMENT_GLTF_BY_ID[equipmentId];
  if (gltfFile) {
    const abs = path.join(MEDICAL_EQUIPMENT_DIR, gltfFile);
    if (existsSync(abs)) {
      return loadGltfEquipmentGroup(equipmentId, gltfFile);
    }
  }
  return buildDeclaredEquipmentGeometry(equipmentId);
}

function measureGroup(
  root: Group,
  input: {
    subjectId: string;
    subjectFamily: "equipment" | "room";
    params: Record<string, number | string | boolean>;
    resolvedToFallback: boolean;
    resolvedSource?: ResolvedSource;
    family?: string;
  },
): LedgerRow {
  const counts = countEquipmentGeometry(root);
  const aabb = worldAabb(root);
  const extent = footprintExtentOf(aabb);
  const partCount = counts.meshCount;
  const fixtureWorldPositions: LedgerRow["fixtureWorldPositions"] = [];
  if (input.subjectFamily === "room") {
    for (const child of root.children) {
      const slotId = child.userData?.fixtureSlotId as string | undefined;
      if (!slotId) continue;
      child.updateMatrixWorld(true);
      const p = new Vector3();
      child.getWorldPosition(p);
      fixtureWorldPositions.push({
        slotId,
        x: Number(p.x.toFixed(4)),
        y: Number(p.y.toFixed(4)),
        z: Number(p.z.toFixed(4)),
      });
    }
    fixtureWorldPositions.sort((a, b) => a.slotId.localeCompare(b.slotId));
  }
  const resolvedSource: ResolvedSource =
    input.resolvedSource
    ?? (input.subjectFamily === "equipment" ? sourceFromUserData(root) : "parametric");
  const family =
    input.family
    ?? (input.subjectFamily === "equipment" ? familyFromUserData(root) : undefined);
  return {
    subjectId: input.subjectId,
    subjectFamily: input.subjectFamily,
    params: input.params,
    meshCount: counts.meshCount,
    partCount,
    triangles: counts.triangleCount,
    partNames: collectPartNames(root),
    worldAabb: aabb,
    footprintExtent: extent,
    deckHeightM: input.subjectFamily === "equipment" ? deckHeightMOf(root) : null,
    silhouetteKey: computeSilhouetteKey(partCount, counts.triangleCount, extent),
    distinctMaterialColors: collectDistinctColors(root),
    connectedComponents: countPositionMergedComponents(root),
    resolvedToFallback: input.resolvedToFallback,
    resolvedSource,
    ...(family ? { family } : {}),
    ...(fixtureWorldPositions.length > 0 ? { fixtureWorldPositions } : {}),
  };
}

// ---------------------------------------------------------------------------
// Software orthographic render (no WebGL, no Vite)
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

/** Orthographic front-ish view: project world X/Y into a labelled PNG. */
function renderGroupSoftware(root: Object3D, width: number, height: number, label: string): Buffer {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  const size = new Vector3();
  box.getSize(size);
  const center = new Vector3();
  box.getCenter(center);
  const pad = 0.12;
  const spanX = Math.max(size.x, 0.2) * (1 + pad);
  const spanY = Math.max(size.y, 0.2) * (1 + pad);
  const scale = Math.min(width / spanX, (height - 28) / spanY);

  const rgba = Buffer.alloc(width * height * 4, 0);
  // background
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
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = 255;
  };

  const project = (wx: number, wy: number, wz: number) => {
    const sx = Math.round((wx - center.x) * scale + width / 2);
    const sy = Math.round(height - 28 - ((wy - center.y) * scale + (height - 28) / 2));
    // slight depth from Z for occlusion
    return { sx, sy, z: -wz };
  };

  const v0 = new Vector3();
  const v1 = new Vector3();
  const v2 = new Vector3();
  const color = new Color();

  root.traverse((obj: Object3D) => {
    if (!(obj instanceof Mesh) || !obj.geometry) return;
    const mat = obj.material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
    if (mat && !Array.isArray(mat) && mat.color) color.copy(mat.color);
    else color.setHex(0x9ca3af);
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    const geo = obj.geometry;
    const pos = geo.getAttribute("position");
    if (!pos) return;
    const index = geo.index;
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
    for (let t = 0; t < triCount; t += 1) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      v0.fromBufferAttribute(pos, i0).applyMatrix4(obj.matrixWorld);
      v1.fromBufferAttribute(pos, i1).applyMatrix4(obj.matrixWorld);
      v2.fromBufferAttribute(pos, i2).applyMatrix4(obj.matrixWorld);
      const p0 = project(v0.x, v0.y, v0.z);
      const p1 = project(v1.x, v1.y, v1.z);
      const p2 = project(v2.x, v2.y, v2.z);
      // barycentric raster
      const minX = Math.max(0, Math.min(p0.sx, p1.sx, p2.sx));
      const maxX = Math.min(width - 1, Math.max(p0.sx, p1.sx, p2.sx));
      const minY = Math.max(0, Math.min(p0.sy, p1.sy, p2.sy));
      const maxY = Math.min(height - 1, Math.max(p0.sy, p1.sy, p2.sy));
      const area = (p1.sx - p0.sx) * (p2.sy - p0.sy) - (p2.sx - p0.sx) * (p1.sy - p0.sy);
      if (area === 0) continue;
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const w0 = (p1.sx - x) * (p2.sy - y) - (p2.sx - x) * (p1.sy - y);
          const w1 = (p2.sx - x) * (p0.sy - y) - (p0.sx - x) * (p2.sy - y);
          const w2 = (p0.sx - x) * (p1.sy - y) - (p1.sx - x) * (p0.sy - y);
          if (w0 < 0 !== area < 0 && w0 !== 0) continue;
          if (w1 < 0 !== area < 0 && w1 !== 0) continue;
          if (w2 < 0 !== area < 0 && w2 !== 0) continue;
          const a = Math.abs(area);
          const z = (w0 * p0.z + w1 * p1.z + w2 * p2.z) / a;
          put(x, y, z, r, g, b);
        }
      }
    }
  });

  // crude label band (top 28px already reserved visually via projection)
  const labelBytes = Buffer.from(label.slice(0, 64), "utf8");
  for (let i = 0; i < Math.min(labelBytes.length, width); i += 1) {
    const ch = labelBytes[i]!;
    // paint a simple 1-row hash pattern as a marker that label data is present
    const o = i * 4;
    rgba[o] = 0xe8;
    rgba[o + 1] = 0xf5;
    rgba[o + 2] = 0xef;
    rgba[o + 3] = 255;
    void ch;
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

function ensureDir(p: string): void {
  mkdirSync(path.dirname(p), { recursive: true });
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir(filePath);
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/**
 * Write pre-fix.json for #202.
 *
 * Freezes the #198 residual: the fourteen grey-pole ids are measured with
 * buildGenericClinicalEquipmentFallback even after family builders land. Deck
 * collisions (exam_table / post_op_bed / pediatric_stretcher) and
 * iv_pump / fetal_monitor are measured via the honest resolve path at the
 * moment of writing — when pre-fix is first written before product edits
 * those paths still collide; once builders land, only the frozen pole set
 * remains ambient-false. Callers must write pre-fix before product edits.
 */
export async function writePreFixArtifact(): Promise<string> {
  const equipmentIds = listDeclaredEquipmentIds();
  const equipment: Array<Record<string, unknown>> = [];
  for (const id of equipmentIds) {
    let group: Group;
    if (GREY_POLE_RESIDUAL_IDS.has(id) || SUPPORT_SURFACE_IDS.has(id)) {
      // Before-column freeze: poles + the support surfaces #198 fixed from poles.
      group = buildGenericClinicalEquipmentFallback(id);
    } else {
      group = await resolveEquipmentGeometry(id);
    }
    const row = measureGroup(group, {
      subjectId: id,
      subjectFamily: "equipment",
      params: {},
      resolvedToFallback: sourceFromUserData(group) === "fallback",
      resolvedSource: sourceFromUserData(group),
      family: familyFromUserData(group),
    });
    equipment.push({
      equipmentId: id,
      resolvedSource: row.resolvedSource,
      resolvedBuilder: row.resolvedSource,
      family: row.family ?? null,
      meshCount: row.meshCount,
      partCount: row.partCount,
      triangles: row.triangles,
      footprintExtent: row.footprintExtent,
      deckHeightM: row.deckHeightM,
      silhouetteKey: row.silhouetteKey,
      resolvedToFallback: row.resolvedToFallback,
    });
  }
  const environments = listEnvironmentIds().map((id) => {
    const group = buildStationEnvironment({ environmentId: id });
    const counts = countEquipmentGeometry(group);
    const aabb = worldAabb(group);
    return {
      environmentId: id,
      meshCount: counts.meshCount,
      triangles: counts.triangleCount,
      roomWidthMeters: group.userData.roomWidthMeters,
      roomDepthMeters: group.userData.roomDepthMeters,
      roomHeightMeters: group.userData.roomHeightMeters,
      aabb,
    };
  });
  const fallbackCount = equipment.filter((e) => e.resolvedToFallback === true).length;
  const payload = {
    schemaVersion: "openclinxr.generator-sweep.pre-fix.v1",
    measuredAt: new Date().toISOString(),
    mechanism:
      "resolveEquipmentGeometry (GLB|parametric) with fourteen grey-pole residual ids + three support-surface ids frozen as buildGenericClinicalEquipmentFallback for the #202 before-column",
    ambientFailureClass:
      "equipment: 14 ids identical 56-triangle grey pole; exam_table/post_op_bed/pediatric_stretcher shared deck; iv_pump/fetal_monitor shared cart; rooms: fixture slots are descriptor constants",
    equipmentCount: equipment.length,
    environmentCount: environments.length,
    fallbackCount,
    equipment,
    environments,
    claimScope: "pre-fix enumeration of in-process generator outputs (#202)",
    notEvidenceFor: ["clinical_validity", "quest_readiness", "visual_quality_grade"],
  };
  const out = absEvidence(PRE_FIX_PATH);
  writeJson(out, payload);
  return out;
}

function diagnoseFixtureTracking(widthRows: LedgerRow[], depthRows: LedgerRow[]): GeneratorSweepReport["fixturesTrackRoomDimensions"] {
  // Fixtures track width if their world X changes when roomWidth changes (relative to half-width).
  // Hand-picked constants → same absolute XYZ across width/depth variants.
  const slotXs = (rows: LedgerRow[]) => {
    const bySlot = new Map<string, number[]>();
    for (const row of rows) {
      for (const f of row.fixtureWorldPositions ?? []) {
        const list = bySlot.get(f.slotId) ?? [];
        list.push(f.x);
        bySlot.set(f.slotId, list);
      }
    }
    return bySlot;
  };
  const slotZs = (rows: LedgerRow[]) => {
    const bySlot = new Map<string, number[]>();
    for (const row of rows) {
      for (const f of row.fixtureWorldPositions ?? []) {
        const list = bySlot.get(f.slotId) ?? [];
        list.push(f.z);
        bySlot.set(f.slotId, list);
      }
    }
    return bySlot;
  };
  const spread = (vals: number[]) => Math.max(...vals) - Math.min(...vals);
  const widthSlots = slotXs(widthRows);
  const depthSlots = slotZs(depthRows);
  let widthMoves = 0;
  let widthTotal = 0;
  for (const vals of widthSlots.values()) {
    widthTotal += 1;
    if (spread(vals) > 0.05) widthMoves += 1;
  }
  let depthMoves = 0;
  let depthTotal = 0;
  for (const vals of depthSlots.values()) {
    depthTotal += 1;
    if (spread(vals) > 0.05) depthMoves += 1;
  }
  const widthTracks = widthTotal > 0 && widthMoves / widthTotal > 0.5;
  const depthTracks = depthTotal > 0 && depthMoves / depthTotal > 0.5;
  if (widthTracks && depthTracks) return "yes";
  if (!widthTracks && !depthTracks) return "no";
  if (widthTracks) return "partially:width";
  if (depthTracks) return "partially:depth";
  return "partially:none";
}

/**
 * Sweep equipment + rooms, write ledger + contact sheets, return report.
 * Idempotent cache for multi-contract suite.
 */
export async function inspectGeneratorSweep(): Promise<GeneratorSweepReport> {
  if (cachedReport) return cachedReport;

  if (!existsSync(absEvidence(PRE_FIX_PATH))) {
    await writePreFixArtifact();
  }

  const evidenceDir = absEvidence(ISSUE_EVIDENCE_DIR);
  mkdirSync(evidenceDir, { recursive: true });
  const evidence198Dir = absEvidence(ISSUE_198_EVIDENCE_DIR);
  mkdirSync(evidence198Dir, { recursive: true });
  const evidence202Dir = absEvidence(ISSUE_202_EVIDENCE_DIR);
  mkdirSync(evidence202Dir, { recursive: true });
  const cellDir = path.join(evidenceDir, "cells");
  mkdirSync(cellDir, { recursive: true });

  const ledger: LedgerRow[] = [];
  const sweeps: GeneratorSweepReport["sweeps"] = [];

  // --- Equipment: every declared id once (honest GLB | parametric | fallback) ---
  const equipmentIds = listDeclaredEquipmentIds();
  const equipmentCells: Array<{ imagePath: string; label: string }> = [];
  for (const id of equipmentIds) {
    const group = await resolveEquipmentGeometry(id);
    const source = sourceFromUserData(group);
    const family = familyFromUserData(group);
    const row = measureGroup(group, {
      subjectId: id,
      subjectFamily: "equipment",
      params: {},
      resolvedToFallback: source === "fallback",
      resolvedSource: source,
      family,
    });
    ledger.push(row);
    const cellPath = path.join(cellDir, `eq_${id}.png`);
    writeFileSync(cellPath, renderGroupSoftware(group, 480, 360, id));
    equipmentCells.push({
      imagePath: cellPath,
      label: `${id} ${row.triangles}t ${source}${family ? ` ${family}` : ""}`,
    });
  }

  // --- Rooms: every environment once at descriptor defaults ---
  const envIds = listEnvironmentIds();
  const roomCells: Array<{ imagePath: string; label: string }> = [];
  for (const id of envIds) {
    const group = buildStationEnvironment({ environmentId: id });
    const row = measureGroup(group, {
      subjectId: id,
      subjectFamily: "room",
      params: {
        roomWidthMeters: Number(group.userData.roomWidthMeters),
        roomDepthMeters: Number(group.userData.roomDepthMeters),
        roomHeightMeters: Number(group.userData.roomHeightMeters),
      },
      resolvedToFallback: Boolean(group.userData.environmentFallbackActive),
    });
    ledger.push(row);
    const cellPath = path.join(cellDir, `room_${id}.png`);
    writeFileSync(cellPath, renderGroupSoftware(group, 480, 360, id));
    roomCells.push({
      imagePath: cellPath,
      label: `${id} w=${row.params.roomWidthMeters}`,
    });
  }

  // --- Parameter sweeps on one environment (dimensions override) ---
  const widthRows: LedgerRow[] = [];
  for (const w of WIDTH_SWEEP) {
    const group = buildStationEnvironment({
      environmentId: SWEEP_ENV,
      roomWidthMeters: w,
    });
    const row = measureGroup(group, {
      subjectId: SWEEP_ENV,
      subjectFamily: "room",
      params: {
        roomWidthMeters: w,
        roomDepthMeters: Number(group.userData.roomDepthMeters),
        roomHeightMeters: Number(group.userData.roomHeightMeters),
        sweep: "roomWidthMeters",
      },
      resolvedToFallback: false,
    });
    ledger.push(row);
    widthRows.push(row);
    const cellPath = path.join(cellDir, `sweep_w_${w}.png`);
    writeFileSync(cellPath, renderGroupSoftware(group, 480, 360, `${SWEEP_ENV} w=${w}`));
    roomCells.push({ imagePath: cellPath, label: `width=${w}m ${row.triangles}t` });
  }
  sweeps.push({
    subjectId: SWEEP_ENV,
    param: "roomWidthMeters",
    values: [...WIDTH_SWEEP],
  });

  const heightRows: LedgerRow[] = [];
  for (const h of HEIGHT_SWEEP) {
    const group = buildStationEnvironment({
      environmentId: SWEEP_ENV,
      roomHeightMeters: h,
    });
    const row = measureGroup(group, {
      subjectId: SWEEP_ENV,
      subjectFamily: "room",
      params: {
        roomWidthMeters: Number(group.userData.roomWidthMeters),
        roomDepthMeters: Number(group.userData.roomDepthMeters),
        roomHeightMeters: h,
        sweep: "roomHeightMeters",
      },
      resolvedToFallback: false,
    });
    ledger.push(row);
    heightRows.push(row);
    const cellPath = path.join(cellDir, `sweep_h_${String(h).replace(".", "_")}.png`);
    writeFileSync(cellPath, renderGroupSoftware(group, 480, 360, `${SWEEP_ENV} h=${h}`));
    roomCells.push({ imagePath: cellPath, label: `height=${h}m ${row.triangles}t` });
  }
  sweeps.push({
    subjectId: SWEEP_ENV,
    param: "roomHeightMeters",
    values: [...HEIGHT_SWEEP],
  });

  // Depth measured for fixture-track diagnosis (Z) + sheet; not a formal sweeps[] entry.
  const depthRows: LedgerRow[] = [];
  for (const d of DEPTH_SWEEP) {
    const group = buildStationEnvironment({
      environmentId: SWEEP_ENV,
      roomDepthMeters: d,
    });
    const row = measureGroup(group, {
      subjectId: SWEEP_ENV,
      subjectFamily: "room",
      params: {
        roomWidthMeters: Number(group.userData.roomWidthMeters),
        roomDepthMeters: d,
        roomHeightMeters: Number(group.userData.roomHeightMeters),
        measure: "roomDepthMeters",
      },
      resolvedToFallback: false,
    });
    ledger.push(row);
    depthRows.push(row);
    const cellPath = path.join(cellDir, `sweep_d_${String(d).replace(".", "_")}.png`);
    writeFileSync(cellPath, renderGroupSoftware(group, 480, 360, `${SWEEP_ENV} d=${d}`));
    roomCells.push({ imagePath: cellPath, label: `depth=${d}m minZ=${row.worldAabb.min[2].toFixed(2)}` });
  }

  const fixturesTrack = diagnoseFixtureTracking(widthRows, depthRows);

  // Distinct geometry check for report summary (same signature as planted contract).
  const widthSigs = new Set(
    widthRows.map((r) => `${r.triangles}|${r.worldAabb.max.map((v) => v.toFixed(3)).join(",")}`),
  );
  const heightSigs = new Set(
    heightRows.map((r) => `${r.triangles}|${r.worldAabb.max.map((v) => v.toFixed(3)).join(",")}`),
  );
  const distinct =
    widthSigs.size > 1 && heightSigs.size > 1
      ? "yes"
      : widthSigs.size > 1
        ? "partially:roomWidthMeters"
        : heightSigs.size > 1
          ? "partially:roomHeightMeters"
          : "no";

  const eqSheetAbs = absEvidence(EQUIPMENT_SHEET_PATH);
  const eqSheetAfterAbs = absEvidence(EQUIPMENT_SHEET_AFTER_PATH);
  const eqSheetAfter198Abs = absEvidence(EQUIPMENT_SHEET_AFTER_198_PATH);
  const roomSheetAbs = absEvidence(ROOM_SWEEP_SHEET_PATH);
  await writeContactSheetFromCells(equipmentCells, eqSheetAbs, 5);
  // #202 after sheet — same framing/cells as the primary equipment sheet.
  writeFileSync(eqSheetAfterAbs, readFileSync(eqSheetAbs));
  // Keep #198 path warm for residual contracts that still name it.
  mkdirSync(path.dirname(eqSheetAfter198Abs), { recursive: true });
  writeFileSync(eqSheetAfter198Abs, readFileSync(eqSheetAbs));
  // Room sheet: prefer sweep cells + a sample of envs (cap for readability)
  const roomSheetCells = [
    ...roomCells.filter((c) =>
      c.label.startsWith("width=")
      || c.label.startsWith("height=")
      || c.label.startsWith("depth=")),
    ...roomCells.filter((c) =>
      !c.label.startsWith("width=")
      && !c.label.startsWith("height=")
      && !c.label.startsWith("depth=")).slice(0, 6),
  ];
  await writeContactSheetFromCells(roomSheetCells, roomSheetAbs, 4);

  const equipmentLedger = {
    schemaVersion: "openclinxr.generator-sweep.equipment-ledger.v1",
    generatedAt: new Date().toISOString(),
    rows: ledger.filter((r) => r.subjectFamily === "equipment"),
    claimScope: "in-process equipment builder geometry ledger",
    notEvidenceFor: ["clinical_device_realism", "quest_readiness", "visual_quality_grade"],
  };
  const roomLedger = {
    schemaVersion: "openclinxr.generator-sweep.room-ledger.v1",
    generatedAt: new Date().toISOString(),
    rows: ledger.filter((r) => r.subjectFamily === "room"),
    sweeps,
    fixturesTrackRoomDimensions: fixturesTrack,
    claimScope: "in-process room builder geometry ledger + dimension sweep",
    notEvidenceFor: ["clinical_layout_validity", "quest_readiness", "visual_quality_grade"],
  };
  writeJson(absEvidence(EQUIPMENT_LEDGER_PATH), equipmentLedger);
  writeJson(absEvidence(ROOM_LEDGER_PATH), roomLedger);

  const fallbackCount = new Set(
    ledger.filter((r) => r.subjectFamily === "equipment" && r.resolvedToFallback).map((r) => r.subjectId),
  ).size;

  const report: GeneratorSweepReport = {
    ledger,
    sweeps,
    contactSheetPaths: [EQUIPMENT_SHEET_PATH, ROOM_SWEEP_SHEET_PATH, EQUIPMENT_SHEET_AFTER_PATH],
    claimScope:
      "in-process sweep of resolveEquipmentGeometry (GLB|parametric|fallback) + buildStationEnvironment; geometry ledger is the contract surface; sheets are for human grade only",
    notEvidenceFor: [
      "clinical_validity",
      "quest_readiness",
      "visual_quality_as_pass_fail",
      "garment_or_body_generation",
    ],
    fixturesTrackRoomDimensions: fixturesTrack,
    renderPath: "other:software_orthographic",
    reportSummary: {
      equipment_ids_swept: `${equipmentIds.length} of ${equipmentIds.length}`,
      ids_resolving_to_fallback: fallbackCount,
      environments_swept: `${envIds.length} of ${envIds.length}`,
      room_params_swept: ["roomWidthMeters", "roomHeightMeters", "roomDepthMeters(measured-not-formal)"],
      fixtures_track_room_dimensions: fixturesTrack,
      render_path: "other:software_orthographic",
      distinct_geometry_across_range: distinct,
    },
  };

  writeJson(path.join(evidenceDir, "sweep-report.json"), {
    ...report,
    contentHash: createHash("sha256").update(JSON.stringify(ledger)).digest("hex").slice(0, 16),
  });

  cachedReport = report;
  return report;
}

/** CLI: one command per subject family writing fixed paths. */
async function main(argv: readonly string[]): Promise<number> {
  const family = argv.includes("--family")
    ? argv[argv.indexOf("--family") + 1]
    : "all";
  if (family === "pre-fix") {
    const out = await writePreFixArtifact();
    console.log(`wrote ${out}`);
    return 0;
  }
  if (!existsSync(absEvidence(PRE_FIX_PATH))) {
    const out = await writePreFixArtifact();
    console.log(`wrote ${out}`);
  }
  const report = await inspectGeneratorSweep();
  console.log(JSON.stringify(report.reportSummary, null, 2));
  console.log("contact sheets:", report.contactSheetPaths.join(", "));
  return 0;
}

const isDirect =
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
