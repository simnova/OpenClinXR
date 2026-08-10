/**
 * #260 — pre-fix measurement: parametric composite vs GLB path for equipment ids
 * that have BOTH a composite parametric builder AND a real-equipment GLB.
 *
 * The defect (#260): PARAMETRIC_KINDS builders emit a COMPOSITE (monitor body +
 * stand). REAL_EQUIPMENT_GLTF_BY_ID substitutes a SINGLE mesh for the whole id,
 * so the stand (here the bedside monitor's pole) is silently dropped and the
 * monitor body lands at floor level.
 *
 * This writes .openclinxr/evidence/issue-260/pre-fix.json with the two-column
 * table: what the parametric builder emits (mesh names, count, per-mesh AABB,
 * total AABB) versus what the GLB path mounts (mesh names, count, per-mesh AABB,
 * total AABB + the world AABB the current mount path produces at the declared
 * placement).
 *
 * Instrument notes:
 *  - parametric side: apps/ui-xr/src/station-equipment-composite-measure.ts —
 *    three.js Box3 after updateMatrixWorld(true) over the runtime's own
 *    buildDeclaredEquipmentGeometry output (the runtime's geometry stack).
 *  - GLB side: gltf-transform NodeIO with node.getWorldMatrix() baked into the
 *    POSITION transform (T × R × S), matching equipment-assembly-integrity.ts.
 *    FAILED INSTRUMENT (known): primitive POSITION min/max without node matrices
 *    reports ~1.0 on every axis for these exports.
 *  - mount path: applies normalizeGltfEquipmentMount semantics — floor
 *    placements (|y| < 0.05) ground the object by its measured local min-Y;
 *    elevated placements stay origin-centered.
 *
 * claimScope: what geometry the two mounting paths produce for a composite id.
 * notEvidenceFor: clinical realism, Quest readiness, asset production readiness.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import {
  REAL_EQUIPMENT_GLTF_BY_ID,
} from "../../../apps/ui-xr/src/station-equipment.js";
import {
  measureParametricComposite,
  type ParametricCompositeMeasure,
} from "../../../apps/ui-xr/src/station-equipment-composite-measure.js";
import {
  computeMeasurementTreeStamp,
  type MeasurementTreeStamp,
} from "./lib/measurement-tree-stamp.js";

const EVIDENCE_DIR = ".openclinxr/evidence/issue-260";
const PRE_FIX_PATH = path.join(EVIDENCE_DIR, "pre-fix.json");

const EQUIPMENT_GLB_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../apps/ui-xr/public/xr-assets/medical-equipment",
);

/** The two ids that have BOTH a composite parametric builder AND a real GLB. */
const SUBJECT_IDS = ["bedside_monitor_equipment", "wall_clock_equipment"] as const;

/** Shipped placements (ed_stroke_alert_handoff_v1 scene-manifest) the runtime uses. */
const DECLARED_PLACEMENTS: Record<string, { x: number; y: number; z: number }> = {
  bedside_monitor_equipment: { x: 0.95, y: 0, z: 0.98 },
  wall_clock_equipment: { x: -2.4, y: 1.55, z: -1.15 },
};

type Aabb = { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
type MeshRow = { name: string; aabb: Aabb; triangles: number };
type SideTable = {
  meshCount: number;
  triangleCount: number;
  totalAabb: Aabb;
  meshes: MeshRow[];
};

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function aabbOf(min: number[], max: number[]): Aabb {
  return {
    min: { x: round3(min[0]), y: round3(min[1]), z: round3(min[2]) },
    max: { x: round3(max[0]), y: round3(max[1]), z: round3(max[2]) },
  };
}

function parametricToSideTable(measure: ParametricCompositeMeasure): SideTable {
  return {
    meshCount: measure.meshCount,
    triangleCount: measure.triangleCount,
    totalAabb: {
      min: { x: measure.totalAabbMin.x, y: measure.totalAabbMin.y, z: measure.totalAabbMin.z },
      max: { x: measure.totalAabbMax.x, y: measure.totalAabbMax.y, z: measure.totalAabbMax.z },
    },
    meshes: measure.meshes.map((m) => ({
      name: m.name,
      aabb: { min: { ...m.aabbMin }, max: { ...m.aabbMax } },
      triangles: m.triangles,
    })),
  };
}

function transformPoint(x: number, y: number, z: number, m: number[]): [number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

/** Measure the GLB file (node world matrices baked) — the GLB path's input. */
async function measureGltbFile(fileName: string): Promise<SideTable> {
  const io = new NodeIO();
  const doc = await io.read(path.join(EQUIPMENT_GLB_DIR, fileName));
  const meshes: MeshRow[] = [];
  let triangleCount = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const visit = (node: import("@gltf-transform/core").Node): void => {
    const mesh = node.getMesh();
    if (mesh) {
      const world = node.getWorldMatrix();
      const mMin = [Infinity, Infinity, Infinity];
      const mMax = [-Infinity, -Infinity, -Infinity];
      let tris = 0;
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const arr = pos.getArray();
        if (!arr) continue;
        const idx = prim.getIndices();
        tris += idx ? Math.floor(idx.getCount() / 3) : Math.floor(pos.getCount() / 3);
        for (let i = 0; i + 2 < arr.length; i += 3) {
          const [x, y, z] = transformPoint(Number(arr[i]), Number(arr[i + 1]), Number(arr[i + 2]), world);
          if (x < mMin[0]) mMin[0] = x;
          if (y < mMin[1]) mMin[1] = y;
          if (z < mMin[2]) mMin[2] = z;
          if (x > mMax[0]) mMax[0] = x;
          if (y > mMax[1]) mMax[1] = y;
          if (z > mMax[2]) mMax[2] = z;
          if (x < min[0]) min[0] = x;
          if (y < min[1]) min[1] = y;
          if (z < min[2]) min[2] = z;
          if (x > max[0]) max[0] = x;
          if (y > max[1]) max[1] = y;
          if (z > max[2]) max[2] = z;
        }
      }
      triangleCount += tris;
      if (mMin[0] !== Infinity) {
        meshes.push({
          name: node.getName() || mesh.getName() || "unnamed",
          aabb: aabbOf(mMin, mMax),
          triangles: tris,
        });
      }
    }
    for (const child of node.listChildren()) visit(child);
  };
  for (const node of doc.getRoot().listNodes()) visit(node);
  return {
    meshCount: meshes.length,
    triangleCount,
    totalAabb: aabbOf(min, max),
    meshes,
  };
}

/** World AABB the current mount path produces at the declared placement. */
function computeMountedWorldAabb(glbLocal: SideTable, placement: { x: number; y: number; z: number }): Aabb {
  const minY = glbLocal.totalAabb.min.y;
  const maxY = glbLocal.totalAabb.max.y;
  const isFloor = Math.abs(placement.y) < 0.05;
  // normalizeGltfEquipmentMount: floor → ground by min-Y; elevated → unchanged.
  const yOffset = isFloor && minY < 0 ? -minY : 0;
  return {
    min: {
      x: round3(glbLocal.totalAabb.min.x + placement.x),
      y: round3(glbLocal.totalAabb.min.y + yOffset + placement.y),
      z: round3(glbLocal.totalAabb.min.z + placement.z),
    },
    max: {
      x: round3(glbLocal.totalAabb.max.x + placement.x),
      y: round3(glbLocal.totalAabb.max.y + yOffset + placement.y),
      z: round3(glbLocal.totalAabb.max.z + placement.z),
    },
  };
}

export async function writeIssue260PreFix(force = false): Promise<{ measuredAgainstCommit: string; table: unknown }> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  if (!force && existsSync(PRE_FIX_PATH)) {
    const existing = JSON.parse(await readFile(PRE_FIX_PATH, "utf8")) as {
      measuredAgainstCommit?: string;
    };
    if (existing.measuredAgainstCommit) return { measuredAgainstCommit: existing.measuredAgainstCommit, table: existing };
  }

  const stamp = computeMeasurementTreeStamp();
  const rows: Array<Record<string, unknown>> = [];
  for (const equipmentId of SUBJECT_IDS) {
    const glbFile = REAL_EQUIPMENT_GLTF_BY_ID[equipmentId];
    const parametric = parametricToSideTable(measureParametricComposite(equipmentId));
    const glb = await measureGltbFile(glbFile);
    const placement = DECLARED_PLACEMENTS[equipmentId];
    const mountedWorld = computeMountedWorldAabb(glb, placement);
    const isFloorPlacement = Math.abs(placement.y) < 0.05;
    const compositeIsBaseOnFloor = parametric.totalAabb.min.y >= -0.05;
    rows.push({
      equipmentId,
      glbFileName: glbFile,
      declaredPlacement: placement,
      parametricComposite: parametric,
      glbPath: {
        ...glb,
        mountedWorldAabbAtDeclaredPlacement: mountedWorld,
      },
      loss: {
        // What the composite emitted that the GLB path no longer mounts.
        // "Stand" loss is only meaningful for a floor-standing composite (base on
        // floor, content above) — for the wall clock (elevated, origin-centered)
        // the parametric meshes are replaced by the GLB as intended, nothing is
        // dropped between floor and content. Stand meshes are those anchored at or
        // near the floor plane (min-Y ≤ 0.1): the base and pole. The bezel/screen
        // content floats above the floor, which is what the GLB body replaces.
        droppedMeshes: isFloorPlacement && compositeIsBaseOnFloor
          ? parametric.meshes
            .filter((m) => m.aabb.min.y <= 0.1)
            .map((m) => m.name)
          : [],
        compositeHeightMeters: round3(parametric.totalAabb.max.y - parametric.totalAabb.min.y),
        glbMountedHeightMeters: round3(mountedWorld.max.y - mountedWorld.min.y),
        compositeContentTopMeters: round3(parametric.totalAabb.max.y),
        glbMountedContentTopMeters: round3(mountedWorld.max.y),
      },
    });
  }

  const payload = {
    schemaVersion: "openclinxr.issue-260.pre-fix.v1",
    kind: "parametric_vs_glb_two_column",
    label: "#260 parametric composite vs GLB path for composite equipment ids",
    measuredAt: new Date().toISOString(),
    measuredAgainstCommit: stamp.head,
    treeStamp: stamp satisfies MeasurementTreeStamp,
    instrument:
      "parametric: apps/ui-xr/src/station-equipment-composite-measure.ts (three.js Box3 after updateMatrixWorld(true) over buildDeclaredEquipmentGeometry). GLB: gltf-transform NodeIO with node.getWorldMatrix() baked (T×R×S) over POSITION. Mount: normalizeGltfEquipmentMount semantics (floor→ground by min-Y, elevated→origin-centered).",
    claimScope:
      "what geometry each mounting path produces for a composite equipment id at its declared placement; which composite meshes are lost on the GLB path.",
    notEvidenceFor: [
      "clinical_realism",
      "quest_readiness",
      "asset_production_readiness",
      "pixel_grade — the orchestrator grades captures; this is a file-level + mount-path measurement",
    ],
    subjects: rows,
  };
  writeFileSync(PRE_FIX_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`issue-260-pre-fix: wrote ${PRE_FIX_PATH} against ${stamp.head}`);
  return { measuredAgainstCommit: stamp.head, table: payload };
}

// Direct invocation: `pnpm exec tsx tools/openclinxr/evidence/issue-260-pre-fix-measure.ts [--force]`
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const force = process.argv.includes("--force");
  void writeIssue260PreFix(force);
}
