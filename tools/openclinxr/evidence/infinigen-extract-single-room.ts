/**
 * #236 — extract single room from multi-room Infinigen shell via post-processing.
 *
 * #234 proved solve_max_rooms=1 does not collapse the floorplan (still 20 walls).
 * This slice extracts ONE enclosed room from #229's existing multi-room trimmed shell
 * by mesh-name selection + Blender export. No re-generate, no singleroom.gin trap.
 *
 * claimScope: post-process extract of largest room from multi-room shell, geometry + structural measure.
 * notEvidenceFor: adoption, Quest worn readiness, clinical validity, ui-xr wiring, decimation.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { NodeIO } from "@gltf-transform/core";
import { decimateGlb, measureGlb as measureGlbRoom } from "./room-decimate.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const EVIDENCE_DIR = path.join(REPO_ROOT, ".openclinxr/evidence/issue-236");
const MEASURE_PATH = path.join(EVIDENCE_DIR, "extract-measure.json");
const EXTRACT_GLB_PATH = path.join(EVIDENCE_DIR, "extracted-single-room.glb");
/** Decimation stage output — MADR 0055 item 2: decimate instead of extract. */
const DECIMATED_GLB_PATH = path.join(
  REPO_ROOT,
  ".openclinxr/evidence/room-decimate/extracted-room-decimated.glb",
);
/** Decimation budget — Quest station posture is 180k; the room lane's net is 250k. */
const DECIMATION_TARGET_TRIANGLES = 150_000;

const HOME = process.env.HOME ?? "";
const TOOLS_ROOT =
  process.env.OPENCLINXR_INFINIGEN_TOOLS ?? path.join(HOME, ".openclinxr-tools/infinigen");

/** Quest posture from packages/openclinxr/asset-registry (MADR 0043). */
const QUEST_STATION_MAX_VISIBLE_TRIANGLES = 180_000;

export type ExtractMeasure = {
  verdict: "single_room_extracted" | "extract_failed_measured" | "inconclusive_blocked";
  verdictReason: string;
  sourceWallCount: number;
  extractedWallCount: number | null;
  rawTriangleCount: number | null;
  hasFloor: boolean;
  hasCeiling: boolean;
  doorOpeningSurvives: boolean | null;
  exportPath: string | null;
  claimScope: string[];
  notEvidenceFor: string[];
  /** Extra fields for the detailed report (not asserted by planted contract). */
  extractedRoomName: string | null;
  blendPath: string | null;
  sourceBlendPath: string | null;
  meshCount: number | null;
  materialCount: number | null;
  exportBytes: number | null;
  sourceTriangleCount: number | null;
  extractSeconds: number | null;
  wallEulerChecks: Array<{ name: string; euler: number; hasHoles: boolean }>;
  measuredAt: string;
  blendVersion: string | null;
  /**
   * Decimation stage (#346, MADR 0055 item 2) — meshoptimizer simplify applied to the
   * extracted room GLB. Null when the stage did not run (blocked earlier in the flow).
   */
  decimationStage: {
    verdict: "decimated" | "skipped_noop" | "failed";
    reason: string;
    inputTris: number | null;
    outputTris: number | null;
    targetTriangles: number;
    outputPath: string;
  } | null;
};

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function baseClaims(): Pick<ExtractMeasure, "claimScope" | "notEvidenceFor"> {
  return {
    claimScope: [
      "post-process single-room extraction from #229 multi-room trimmed shell",
      "mesh-name-based room selection (largest room by triangle count)",
      "structural measure of extracted room (walls, floor, ceiling, door apertures)",
      "MADR 0043 Decision unchanged",
    ],
    notEvidenceFor: [
      "adoption of Infinigen as environmentId-driven runtime source (MADR 0043 Decision stands)",
      "Quest worn readiness",
      "clinical validity or exam equivalence",
      "ui-xr wiring or learner-facing environment selection",
      "decimation / LOD pipeline viability",
    ],
  };
}

function blocked(reason: string): ExtractMeasure {
  return {
    verdict: "inconclusive_blocked",
    verdictReason: reason,
    sourceWallCount: 0,
    extractedWallCount: null,
    rawTriangleCount: null,
    hasFloor: false,
    hasCeiling: false,
    doorOpeningSurvives: null,
    exportPath: null,
    ...baseClaims(),
    extractedRoomName: null,
    blendPath: null,
    sourceBlendPath: null,
    meshCount: null,
    materialCount: null,
    exportBytes: null,
    sourceTriangleCount: null,
    extractSeconds: null,
    wallEulerChecks: [],
    measuredAt: new Date().toISOString(),
    blendVersion: null,
    decimationStage: null,
  };
}

/**
 * Find Blender binary on this system.
 */
function findBlender(): string | null {
  try {
    const result = execSync("which blender", { encoding: "utf8", timeout: 5000 }).trim();
    if (result && existsSync(result)) return result;
  } catch {
    // continue
  }
  const candidates = [
    "/opt/homebrew/bin/blender",
    "/Applications/Blender.app/Contents/MacOS/Blender",
    "/usr/local/bin/blender",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Run a Blender Python script (from a temp file) and return parsed JSON output.
 * The script must print exactly one JSON line to stdout.
 *
 * Uses a temp file rather than inline --python-expr to avoid shell-escaping issues
 * with backslash sequences in Python string literals.
 */
function blenderJson(blenderBin: string, pyScript: string, timeoutMs = 600_000): Record<string, unknown> {
  const tmpScript = path.join(tmpdir(), `ocxr-blender-${randomUUID()}.py`);
  try {
    writeFileSync(tmpScript, pyScript, "utf8");
    const result = execSync(
      `${JSON.stringify(blenderBin)} --background --python ${JSON.stringify(tmpScript)}`,
      { encoding: "utf8", timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 },
    );
    // Find the last JSON-containing line (after Blender preamble)
    const lines = result.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith("{")) {
        try {
          return JSON.parse(line);
        } catch {
          // try the next line up
        }
      }
    }
    throw new Error(`Blender produced no valid JSON. Last 500 chars: ${result.slice(-500)}`);
  } finally {
    try { unlinkSync(tmpScript); } catch { /* best effort */ }
  }
}

/**
 * Extract a single room from a multi-room blend by mesh-name pattern.
 * Returns the extraction report plus writes the GLB.
 */
function extractRoom(
  blenderBin: string,
  blendPath: string,
  glbOut: string,
): {
  roomName: string;
  wallCount: number;
  triangleCount: number;
  meshCount: number;
  materialCount: number;
  hasFloor: boolean;
  hasCeiling: boolean;
  doorOpeningSurvives: boolean;
  wallEulerChecks: Array<{ name: string; euler: number; hasHoles: boolean }>;
  doorCutterCount: number;
  sourceWallCount: number;
  sourceTriangleCount: number;
  allRoomNames: string[];
  blendVersion: string;
} {
  ensureDir(path.dirname(glbOut));

  const py = `
import bpy, json, re, math

bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(blendPath)})

# === DISCOVER ALL ROOMS ===
rooms = {}
for obj in bpy.data.objects:
    if obj.type == 'MESH' and obj.data:
        m = re.match(r'^([\\w][\\w-]*)_(\\d+)/(?:\\d+\\.)?(\\w+)', obj.name)
        if m:
            room = m.group(1)
            if room not in rooms:
                rooms[room] = {"tris": 0, "parts": set()}
            me = obj.data
            me.calc_loop_triangles()
            rooms[room]["tris"] += len(me.loop_triangles)
            rooms[room]["parts"].add(m.group(3))

# Pick the largest room
largest = max(rooms.items(), key=lambda x: x[1]["tris"])
room_name = largest[0]
room_tris = largest[1]["tris"]

# === COUNT SOURCE ROOMS + WALLS ===
all_room_names = sorted(rooms.keys())
source_walls = 0
source_tris = 0
for obj in bpy.data.objects:
    if obj.type == 'MESH' and obj.data:
        m = re.match(r'^([\\w][\\w-]*)_\\d+/', obj.name)
        if m:
            me = obj.data
            me.calc_loop_triangles()
            source_tris += len(me.loop_triangles)
        if m and re.search(r'\\.wall$', obj.name):
            source_walls += 1

# === SELECT ONLY THE TARGET ROOM ===
bpy.ops.object.select_all(action='DESELECT')
extracted_objects = []
for obj in bpy.data.objects:
    if obj.type == 'MESH' and obj.name.startswith(room_name + "_"):
        obj.select_set(True)
        extracted_objects.append(obj)

# === MEASURE EXTRACTED ===
wall_count = sum(1 for o in extracted_objects if re.search(r'\\.wall$', o.name))
has_floor = any(re.search(r'\\.floor$', o.name) for o in extracted_objects)
has_ceiling = any(re.search(r'\\.ceiling$', o.name) for o in extracted_objects)
extracted_mesh_count = len(extracted_objects)
extracted_materials = set()
extracted_tris = 0
wall_euler_checks = []
for obj in extracted_objects:
    me = obj.data
    me.calc_loop_triangles()
    tris = len(me.loop_triangles)
    extracted_tris += tris
    for s in obj.material_slots:
        if s.material:
            extracted_materials.add(s.material.name)
    if re.search(r'\\.wall$', obj.name):
        V = len(me.vertices)
        E = len(me.edges)
        F = tris
        euler = V - E + F
        wall_euler_checks.append({"name": obj.name, "euler": euler, "hasHoles": euler < 2})

# Door aperture detection: Euler check on walls OR portal_cutters near room bounds
door_euler_holes = any(w["hasHoles"] for w in wall_euler_checks)

# Check portal_cutters near the room
door_cutter_count = 0
cutters_col = bpy.data.collections.get("placeholders:portal_cutters")
if cutters_col:
    # Compute room AABB
    room_min = [float('inf')]*3
    room_max = [float('-inf')]*3
    for obj in extracted_objects:
        if obj.type == 'MESH' and obj.data:
            for v in obj.data.vertices:
                w = obj.matrix_world @ v.co
                for i in range(3):
                    room_min[i] = min(room_min[i], w[i])
                    room_max[i] = max(room_max[i], w[i])
    margin = 2.0  # metres
    for obj in cutters_col.objects:
        if "door" in obj.name.lower():
            w = obj.matrix_world.translation
            in_bounds = all(
                room_min[i] - margin <= w[i] <= room_max[i] + margin
                for i in range(3)
            )
            if in_bounds:
                door_cutter_count += 1

door_opening_survives = door_euler_holes or door_cutter_count > 0

# === EXPORT SELECTED ===
bpy.ops.export_scene.gltf(
    filepath=${JSON.stringify(glbOut)},
    export_format='GLB',
    use_selection=True,
    export_apply=True,
)

blend_version = f"{bpy.app.version[0]}.{bpy.app.version[1]}.{bpy.app.version[2]}"

print(json.dumps({
    "roomName": room_name,
    "wallCount": wall_count,
    "triangleCount": extracted_tris,
    "meshCount": extracted_mesh_count,
    "materialCount": len(extracted_materials),
    "hasFloor": has_floor,
    "hasCeiling": has_ceiling,
    "doorOpeningSurvives": door_opening_survives,
    "wallEulerChecks": wall_euler_checks,
    "doorCutterCount": door_cutter_count,
    "sourceWallCount": source_walls,
    "sourceTriangleCount": source_tris,
    "allRoomNames": all_room_names,
    "blendVersion": blend_version,
}))
`;

  const data = blenderJson(blenderBin, py);
  return data as unknown as ReturnType<typeof extractRoom>;
}

/**
 * Measure a GLB file with gltf-transform (NodeIO).
 */
async function measureGlb(glbPath: string): Promise<{
  triangleCount: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  exportBytes: number;
}> {
  const { statSync } = await import("node:fs");
  const bytes = statSync(glbPath).size;
  const document = await new NodeIO().read(glbPath);
  const root = document.getRoot();
  let triangleCount = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) triangleCount += Math.floor(idx.getCount() / 3);
      else {
        const pos = prim.getAttribute("POSITION");
        if (pos) triangleCount += Math.floor(pos.getCount() / 3);
      }
    }
  }
  return {
    triangleCount,
    meshCount: root.listMeshes().length,
    materialCount: root.listMaterials().length,
    textureCount: root.listTextures().length,
    exportBytes: bytes,
  };
}

/**
 * Post-process extract one enclosed room from #229's multi-room Infinigen shell.
 *
 * Uses the #229 trimmed blend (no furniture, no trim) cached on disk.
 * Does NOT re-generate; does NOT use singleroom.gin or solve_max_rooms.
 * Cached report is re-used when present unless OPENCLINXR_FORCE_EXTRACT=1.
 */
export async function inspectInfinigenExtractSingleRoom(): Promise<ExtractMeasure> {
  ensureDir(EVIDENCE_DIR);

  // Return cached measure if present and valid
  if (existsSync(MEASURE_PATH) && process.env.OPENCLINXR_FORCE_EXTRACT !== "1") {
    try {
      const cached = JSON.parse(readFileSync(MEASURE_PATH, "utf8")) as ExtractMeasure;
      if (
        cached?.verdict &&
        ["single_room_extracted", "extract_failed_measured", "inconclusive_blocked"].includes(
          cached.verdict,
        ) &&
        typeof cached.verdictReason === "string" &&
        cached.verdictReason.length > 0
      ) {
        return cached;
      }
    } catch {
      // re-measure
    }
  }

  // Find the #229 trimmed shell blend
  const sourceBlendDir = path.join(TOOLS_ROOT, "outputs/no_trim_override");
  const sourceBlendPath = path.join(sourceBlendDir, "scene.blend");

  if (!existsSync(sourceBlendPath)) {
    const reason = `#229 trimmed blend not found at ${sourceBlendPath}. ` +
      `The multi-room shell must be generated first (run #229's measure, which caches the blend). ` +
      `tools root: ${TOOLS_ROOT}`;
    const report = blocked(reason);
    writeFileSync(MEASURE_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }

  const blenderBin = findBlender();
  if (!blenderBin) {
    const report = blocked("Blender binary not found on this system (checked /opt/homebrew/bin, /Applications)");
    writeFileSync(MEASURE_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }

  // Extract the largest room
  let extraction: ReturnType<typeof extractRoom>;
  const t0 = performance.now();
  try {
    extraction = extractRoom(blenderBin, sourceBlendPath, EXTRACT_GLB_PATH);
  } catch (err) {
    const report = blocked(
      `Blender room extraction failed: ${String(err).slice(0, 1200)}`,
    );
    writeFileSync(MEASURE_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }
  const extractSeconds = (performance.now() - t0) / 1000;

  const exportExists = existsSync(EXTRACT_GLB_PATH);

  // Measure the exported GLB
  let glbMetrics: {
    triangleCount: number;
    meshCount: number;
    materialCount: number;
    textureCount: number;
    exportBytes: number;
  } | null = null;
  if (exportExists) {
    try {
      glbMetrics = await measureGlb(EXTRACT_GLB_PATH);
    } catch (err) {
      // Use Blender-side counts as fallback
      glbMetrics = {
        triangleCount: extraction.triangleCount,
        meshCount: extraction.meshCount,
        materialCount: extraction.materialCount,
        exportBytes: 0,
        textureCount: 0,
      };
    }
  }

  const triangleCount = glbMetrics?.triangleCount ?? extraction.triangleCount;
  const meshCount = glbMetrics?.meshCount ?? extraction.meshCount;
  const materialCount = glbMetrics?.materialCount ?? extraction.materialCount;
  const exportBytes = glbMetrics?.exportBytes ?? 0;

  const hasFloor = extraction.hasFloor;
  const hasCeiling = extraction.hasCeiling;
  const wallCount = extraction.wallCount;
  const doorOpeningSurvives = extraction.doorOpeningSurvives;
  const sourceWallCount = extraction.sourceWallCount;

  // #346 decimation stage (MADR 0055 item 2): meshoptimizer simplify of the extracted
  // room GLB to the room-lane budget. Never gates the extraction verdict — the stage
  // is recorded, and a failure here is a "failed" row, not an extraction failure.
  let decimationStage: ExtractMeasure["decimationStage"] = null;
  if (exportExists) {
    try {
      const result = await decimateGlb(EXTRACT_GLB_PATH, DECIMATED_GLB_PATH, {
        targetTriangles: DECIMATION_TARGET_TRIANGLES,
      });
      const after = await measureGlbRoom(DECIMATED_GLB_PATH);
      decimationStage = {
        verdict: result.ratio >= 1 ? "skipped_noop" : "decimated",
        reason:
          result.ratio >= 1
            ? `source already at ${result.afterTris} tris <= ${DECIMATION_TARGET_TRIANGLES} budget; meshoptimizer no-op`
            : `meshoptimizer simplify ratio ${result.ratio.toFixed(4)} -> ${after.triangleCount.toLocaleString()} tris`,
        inputTris: triangleCount,
        outputTris: after.triangleCount,
        targetTriangles: DECIMATION_TARGET_TRIANGLES,
        outputPath: DECIMATED_GLB_PATH,
      };
    } catch (err) {
      decimationStage = {
        verdict: "failed",
        reason: String(err).slice(0, 800),
        inputTris: triangleCount,
        outputTris: null,
        targetTriangles: DECIMATION_TARGET_TRIANGLES,
        outputPath: DECIMATED_GLB_PATH,
      };
    }
  }

  // Determine verdict
  let verdict: ExtractMeasure["verdict"];
  let verdictReason: string;

  const isSingleRoom =
    extraction.wallCount > 0 &&
    extraction.wallCount < extraction.sourceWallCount &&
    hasFloor &&
    hasCeiling;

  if (!exportExists) {
    verdict = "extract_failed_measured";
    verdictReason =
      `Extraction ran (${extractSeconds.toFixed(1)}s) but GLB was not written to ${EXTRACT_GLB_PATH}. ` +
      `Bedroom meshes identified: ${extraction.wallCount} walls from ${extraction.sourceWallCount} total source walls.`;
  } else if (isSingleRoom) {
    verdict = "single_room_extracted";
    const pct = ((triangleCount / QUEST_STATION_MAX_VISIBLE_TRIANGLES) * 100).toFixed(1);
    verdictReason =
      `Extracted room "${extraction.roomName}" from ${sourceWallCount}-wall multi-room shell ` +
      `in ${extractSeconds.toFixed(1)}s. Result: ${wallCount} walls, ${triangleCount} tris ` +
      `(${pct}% of ${QUEST_STATION_MAX_VISIBLE_TRIANGLES} station ceiling), ` +
      `floor=${hasFloor}, ceiling=${hasCeiling}, door_aperture=${doorOpeningSurvives}. ` +
      `Source rooms: ${extraction.allRoomNames.join(", ")}. ` +
      `MADR 0043 Decision unchanged — no runtime adoption.`;
  } else if (extraction.wallCount === 0) {
    verdict = "extract_failed_measured";
    verdictReason = `No wall meshes matched room "${extraction.roomName}" — extraction produced no walls.`;
  } else {
    verdict = "extract_failed_measured";
    const missing: string[] = [];
    if (extraction.wallCount >= extraction.sourceWallCount) missing.push("wall count not reduced");
    if (!hasFloor) missing.push("no floor");
    if (!hasCeiling) missing.push("no ceiling");
    verdictReason = `Extraction did not produce a valid single room: ${missing.join(", ")}. ` +
      `${extraction.wallCount}/${extraction.sourceWallCount} walls.`;
  }

  const report: ExtractMeasure = {
    verdict,
    verdictReason,
    sourceWallCount,
    extractedWallCount: exportExists ? extraction.wallCount : null,
    rawTriangleCount: exportExists ? triangleCount : null,
    hasFloor,
    hasCeiling,
    doorOpeningSurvives: exportExists ? doorOpeningSurvives : null,
    exportPath: exportExists ? EXTRACT_GLB_PATH : null,
    ...baseClaims(),
    extractedRoomName: extraction.roomName,
    blendPath: EXTRACT_GLB_PATH,
    sourceBlendPath,
    meshCount: exportExists ? meshCount : null,
    materialCount: exportExists ? materialCount : null,
    exportBytes: exportExists ? exportBytes : null,
    sourceTriangleCount: extraction.sourceTriangleCount,
    extractSeconds,
    wallEulerChecks: extraction.wallEulerChecks,
    measuredAt: new Date().toISOString(),
    blendVersion: extraction.blendVersion,
    decimationStage,
  };

  writeFileSync(MEASURE_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

// CLI
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  inspectInfinigenExtractSingleRoom()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
