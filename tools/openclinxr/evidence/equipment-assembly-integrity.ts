/**
 * #168 — real equipment GLB assembly integrity.
 *
 * Primary evidence was a render: the ECG cart is not one object (body/screen/shelf float
 * above grounded casters). Whole-document AABB self-checks cannot see that class of defect.
 *
 * Measurements come from the EXPORTED glTF with **world matrices baked** (T × R × S via
 * node.getWorldMatrix() → POSITION). Contact/adjacency only — no topology predicate.
 *
 * Ground plane: each asset's own lowest part worldMin.y (not scene y=0). A different choice
 * would mis-grade a whole object that sits on a non-zero deck.
 *
 * Tolerance: MAX_VERTICAL_GAP_METERS = 0.08 admits ordinary part seams; a metre of air fails.
 *
 * Scope: REAL_EQUIPMENT_GLTF_BY_ID entries (runtime-mounted real GLBs), not every file that
 * may appear later in the directory.
 *
 * claimScope: placement assembly of real equipment GLBs + PROVENANCE ledger honesty.
 * notEvidenceFor: clinical device realism, generative equipment (#164), Quest readiness.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { NodeIO, type Node as GltfNode } from "@gltf-transform/core";
import {
  REAL_EQUIPMENT_GLTF_BY_ID,
  parametricEquipmentKindCount,
} from "../../../apps/ui-xr/src/station-equipment.js";

/** Admits ordinary part seams; a metre of air is not a tolerance question. */
export const MAX_ASSEMBLY_GAP_METERS = 0.08;

const MEDICAL_EQUIPMENT_DIR = path.resolve(
  process.cwd(),
  "apps/ui-xr/public/xr-assets/medical-equipment",
);
const PROVENANCE_PATH = path.join(MEDICAL_EQUIPMENT_DIR, "PROVENANCE.md");

export type PartPlacement = {
  name: string;
  worldMin: { x: number; y: number; z: number };
  worldMax: { x: number; y: number; z: number };
};

export type EquipmentAssembly = {
  equipmentId: string;
  assetPath: string;
  parts: PartPlacement[];
  /** Lowest world Y across all parts — the asset's own ground contact. */
  groundY: number;
  /**
   * Largest vertical air gap between a part's bottom and the nearest part below it
   * among pairs whose XZ footprints overlap within tolerance (stacked contact).
   * Lateral mounts (pump on a pole) do not inflate this — they are scored via adjacency.
   */
  largestVerticalGapMeters: number;
  /** Parts with no 3D adjacency edge to any other part. */
  disconnectedPartNames: string[];
  /** True when the touch-graph is a single non-empty connected component. */
  isAssembled: boolean;
};

export type EquipmentAssemblyIntegrityReport = {
  real: EquipmentAssembly[];
  parametricKindCount: number;
  provenanceDeclaredCount: number;
  provenancePresentCount: number;
  provenanceDeclaredNames: string[];
  provenancePresentNames: string[];
};

function transformPoint(x: number, y: number, z: number, m: number[]): [number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

function measurePartWorldAabb(node: GltfNode): PartPlacement | null {
  const mesh = node.getMesh();
  if (!mesh) return null;
  const world = node.getWorldMatrix();
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let has = false;
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    if (!pos) continue;
    const arr = pos.getArray();
    if (!arr) continue;
    for (let i = 0; i + 2 < arr.length; i += 3) {
      const [x, y, z] = transformPoint(Number(arr[i]), Number(arr[i + 1]), Number(arr[i + 2]), world);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
      has = true;
    }
  }
  if (!has) return null;
  return {
    name: node.getName() || mesh.getName() || "unnamed",
    worldMin: { x: minX, y: minY, z: minZ },
    worldMax: { x: maxX, y: maxY, z: maxZ },
  };
}

function collectParts(node: GltfNode, into: PartPlacement[]): void {
  const part = measurePartWorldAabb(node);
  if (part) into.push(part);
  for (const child of node.listChildren()) collectParts(child, into);
}

/** Axis-aligned separation distances (0 when intervals overlap). */
function aabbSeparation(a: PartPlacement, b: PartPlacement): { x: number; y: number; z: number } {
  const sepX = Math.max(0, Math.max(a.worldMin.x - b.worldMax.x, b.worldMin.x - a.worldMax.x));
  const sepY = Math.max(0, Math.max(a.worldMin.y - b.worldMax.y, b.worldMin.y - a.worldMax.y));
  const sepZ = Math.max(0, Math.max(a.worldMin.z - b.worldMax.z, b.worldMin.z - a.worldMax.z));
  return { x: sepX, y: sepY, z: sepZ };
}

/** Chebyshev separation — parts "touch" when all axes are within tolerance. */
function partsAdjacent(a: PartPlacement, b: PartPlacement, tolerance: number): boolean {
  const sep = aabbSeparation(a, b);
  return Math.max(sep.x, sep.y, sep.z) <= tolerance;
}

function xzFootprintsOverlap(a: PartPlacement, b: PartPlacement, tolerance: number): boolean {
  const sep = aabbSeparation(a, b);
  return sep.x <= tolerance && sep.z <= tolerance;
}

function analyzeParts(parts: PartPlacement[], tolerance = MAX_ASSEMBLY_GAP_METERS): {
  groundY: number;
  largestVerticalGapMeters: number;
  disconnectedPartNames: string[];
  isAssembled: boolean;
} {
  if (parts.length === 0) {
    return {
      groundY: 0,
      largestVerticalGapMeters: 0,
      disconnectedPartNames: [],
      isAssembled: false,
    };
  }

  const groundY = Math.min(...parts.map((p) => p.worldMin.y));

  // Touch graph (3D adjacency within tolerance) — computed first so lateral supports count.
  const n = parts.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (partsAdjacent(parts[i]!, parts[j]!, tolerance)) {
        adj[i]!.push(j);
        adj[j]!.push(i);
      }
    }
  }

  // Vertical air gap: for each part, nearest *support* among XZ-overlapping peers.
  // A peer that Y-overlaps and is 3D-adjacent is lateral support (gap 0) — e.g. a keyboard
  // shelf bolted to the cabinet front is not "floating above the casters".
  // A peer strictly below contributes its stack gap. Take the nearest support per part,
  // then the largest of those nearest gaps across parts.
  let largestVerticalGapMeters = 0;
  for (let ui = 0; ui < n; ui += 1) {
    const upper = parts[ui]!;
    let nearestSupportGap: number | null = null;
    for (let li = 0; li < n; li += 1) {
      if (ui === li) continue;
      const lower = parts[li]!;
      if (!xzFootprintsOverlap(upper, lower, tolerance)) continue;
      let gap: number;
      if (lower.worldMax.y > upper.worldMin.y + 1e-9) {
        // Y ranges overlap (or lower is above). Only counts if already 3D-adjacent.
        if (!adj[ui]!.includes(li)) continue;
        gap = 0;
      } else {
        gap = upper.worldMin.y - lower.worldMax.y;
      }
      if (nearestSupportGap === null || gap < nearestSupportGap) nearestSupportGap = gap;
    }
    if (nearestSupportGap !== null) {
      largestVerticalGapMeters = Math.max(largestVerticalGapMeters, nearestSupportGap);
    }
  }

  const seen = new Set<number>();
  const components: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    if (seen.has(i)) continue;
    const stack = [i];
    const comp: number[] = [];
    seen.add(i);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const nxt of adj[cur]!) {
        if (!seen.has(nxt)) {
          seen.add(nxt);
          stack.push(nxt);
        }
      }
    }
    components.push(comp);
  }

  // Orphans: parts with degree 0 when there are multiple parts.
  const disconnectedPartNames =
    n <= 1
      ? []
      : parts.filter((_, i) => adj[i]!.length === 0).map((p) => p.name);

  const isAssembled = n > 0 && components.length === 1 && disconnectedPartNames.length === 0;

  return { groundY, largestVerticalGapMeters, disconnectedPartNames, isAssembled };
}

export async function inspectEquipmentGlbAssembly(input: {
  equipmentId: string;
  glbFileName: string;
  equipmentDir?: string;
}): Promise<EquipmentAssembly> {
  const dir = input.equipmentDir ? path.resolve(input.equipmentDir) : MEDICAL_EQUIPMENT_DIR;
  const abs = path.join(dir, input.glbFileName);
  if (!existsSync(abs)) {
    throw new Error(`inspectEquipmentGlbAssembly: missing GLB ${abs}`);
  }
  const document = await new NodeIO().read(abs);
  const parts: PartPlacement[] = [];
  for (const scene of document.getRoot().listScenes()) {
    for (const root of scene.listChildren()) collectParts(root, parts);
  }
  if (parts.length === 0) {
    for (const node of document.getRoot().listNodes()) collectParts(node, parts);
  }
  const stats = analyzeParts(parts);
  return {
    equipmentId: input.equipmentId,
    assetPath: path.relative(process.cwd(), abs).split(path.sep).join("/"),
    parts,
    ...stats,
  };
}

/** Parse PROVENANCE.md backtick-quoted `*.glb` declarations. */
export function parseProvenanceGlbDeclarations(markdown: string): string[] {
  const names = new Set<string>();
  const re = /`([A-Za-z0-9._-]+\.glb)`/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    names.add(match[1]!);
  }
  return [...names].sort();
}

function listPresentEquipmentGlbs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f: string) => f.endsWith(".glb"))
    .sort();
}

/**
 * Inspect every REAL_EQUIPMENT_GLTF_BY_ID entry (enumerated from the map, not a hard-coded list)
 * plus PROVENANCE declared-vs-present honesty and parametric fallback count.
 */
export async function inspectEquipmentAssemblyIntegrity(options?: {
  equipmentDir?: string;
  provenancePath?: string;
}): Promise<EquipmentAssemblyIntegrityReport> {
  const equipmentDir = options?.equipmentDir
    ? path.resolve(options.equipmentDir)
    : MEDICAL_EQUIPMENT_DIR;
  const provenancePath = options?.provenancePath
    ? path.resolve(options.provenancePath)
    : PROVENANCE_PATH;

  const real: EquipmentAssembly[] = [];
  for (const [equipmentId, glbFileName] of Object.entries(REAL_EQUIPMENT_GLTF_BY_ID)) {
    real.push(
      await inspectEquipmentGlbAssembly({
        equipmentId,
        glbFileName,
        equipmentDir,
      }),
    );
  }
  real.sort((a, b) => a.equipmentId.localeCompare(b.equipmentId));

  const provenanceMarkdown = existsSync(provenancePath)
    ? readFileSync(provenancePath, "utf8")
    : "";
  const provenanceDeclaredNames = parseProvenanceGlbDeclarations(provenanceMarkdown);
  const provenancePresentNames = listPresentEquipmentGlbs(equipmentDir).filter((name) =>
    provenanceDeclaredNames.includes(name),
  );

  return {
    real,
    parametricKindCount: parametricEquipmentKindCount(),
    provenanceDeclaredCount: provenanceDeclaredNames.length,
    provenancePresentCount: provenancePresentNames.length,
    provenanceDeclaredNames,
    provenancePresentNames,
  };
}

/** SHA-256 hex of a file — used when updating PROVENANCE after regen. */
export function sha256File(absPath: string): string {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}
