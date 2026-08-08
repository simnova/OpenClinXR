/**
 * #234 — single-room measure: can Infinigen produce ONE clinical-scale room
 * instead of the #229 multi-room floorplan (20 walls)?
 *
 * Reuses #229's no_trim.gin (no_objects + trim overrides) and adds
 * restrict_solving.solve_max_rooms=1 WITHOUT BlueprintSolidifier.enable_open=False
 * (the known-slow singleroom.gin trap).
 *
 * Generates with a 15-minute cap, measures geometry + structure, writes
 * .openclinxr/evidence/issue-234/shell-measure.json.
 *
 * Does NOT adopt Infinigen, does NOT wire into apps/ui-xr, does NOT rewrite 0043 Decision.
 *
 * claimScope: local single-room generate + structural/budget measure + door-opening survival.
 * notEvidenceFor: adoption, Quest worn readiness, clinical validity, ui-xr wiring.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import { NodeIO } from "@gltf-transform/core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const EVIDENCE_DIR = path.join(REPO_ROOT, ".openclinxr/evidence/issue-234");
const MEASURE_PATH = path.join(EVIDENCE_DIR, "shell-measure.json");
const GEN_LOG_PATH = path.join(EVIDENCE_DIR, "generate.log");

const HOME = process.env.HOME ?? "";
const TOOLS_ROOT =
  process.env.OPENCLINXR_INFINIGEN_TOOLS ?? path.join(HOME, ".openclinxr-tools/infinigen");

/** Quest posture from packages/openclinxr/asset-registry (MADR 0043). */
const QUEST_STATION_MAX_VISIBLE_TRIANGLES = 180_000;

/** 15-minute cap — singleroom with enable_open=False was ~12+ min, so longer = stall. */
const GENERATE_TIMEOUT_MS = 15 * 60 * 1000;

export type Measure = {
  verdict:
    | "single_room_under_ceiling"
    | "multi_room_still"
    | "inconclusive_blocked"
    | "reject_measured";
  verdictReason: string;
  roomScope: "single_room" | "multi_room" | "unknown";
  wallCount: number;
  rawTriangleCount: number;
  postOptTriangleCount: number | null;
  triangleCeiling: number;
  doorOpeningSurvives: boolean | null;
  hasFloor: boolean;
  hasCeiling: boolean;
  generateSeconds: number | null;
  ginOverrides: string[];
  claimScope: string[];
  notEvidenceFor: string[];
  /** Extra fields (not asserted by planted contract). */
  meshCount: number;
  materialCount: number;
  textureCount: number;
  exportBytes: number;
  featureSurvival: Record<string, boolean>;
  installIsUnderTmp: boolean;
  resolvedInstallPath: string;
  blendPath?: string | null;
  glbPath?: string | null;
  generateCommand?: string[];
  doorCutterCount: number;
  structureDetail?: Record<string, unknown>;
  wallEulerChecks?: Array<{ name: string; euler: number; hasHoles: boolean }>;
  byCollection?: Record<string, { tris: number; count: number }>;
  measuredAt?: string;
};

type BlendStructure = {
  triangleCount: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  textureBytesEstimate: number;
  hasFloor: boolean;
  hasCeiling: boolean;
  wallCount: number;
  hasDoorOpening: boolean;
  doorCutterCount: number;
  objectNames: string[];
  collectionNames: string[];
  wallEulerChecks: Array<{ name: string; euler: number; hasHoles: boolean }>;
  byCollection: Record<string, { tris: number; count: number }>;
};

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function runCmd(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
          }, opts.timeoutMs)
        : null;
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}\n${String(err)}`, timedOut });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

function isUnderTmp(resolved: string): boolean {
  const n = resolved.replace(/\\/g, "/");
  return (
    n.startsWith("/tmp/") ||
    n.startsWith("/private/tmp/") ||
    n.startsWith("/var/folders/") ||
    n.includes("/tmp/")
  );
}

function resolveInstall() {
  const sourceLink = path.join(TOOLS_ROOT, "source");
  const venvLink = path.join(TOOLS_ROOT, "venv");

  let resolvedSource: string | null = null;
  let resolvedVenv: string | null = null;

  try {
    if (existsSync(sourceLink)) resolvedSource = realpathSync(sourceLink);
  } catch {
    resolvedSource = null;
  }
  try {
    if (existsSync(venvLink)) resolvedVenv = realpathSync(venvLink);
  } catch {
    resolvedVenv = null;
  }

  const pythonBin =
    resolvedVenv && existsSync(path.join(resolvedVenv, "bin/python"))
      ? path.join(resolvedVenv, "bin/python")
      : null;

  let ginConfigPath: string | null = null;
  let noTrimGinPath: string | null = null;
  if (resolvedSource) {
    const candidates = [
      path.join(resolvedSource, "infinigen_examples/configs_indoor/disable/no_objects.gin"),
    ];
    for (const c of candidates) {
      if (existsSync(c)) {
        ginConfigPath = c;
        break;
      }
    }
    const noTrimCandidates = [
      path.join(resolvedSource, "infinigen_examples/configs_indoor/disable/no_trim.gin"),
    ];
    for (const c of noTrimCandidates) {
      if (existsSync(c)) {
        noTrimGinPath = c;
        break;
      }
    }
  }

  const installIsUnderTmp =
    (resolvedSource != null && isUnderTmp(resolvedSource)) ||
    (resolvedVenv != null && isUnderTmp(resolvedVenv));

  let missingReason: string | null = null;
  if (!existsSync(TOOLS_ROOT) && !resolvedSource) {
    missingReason = `tools root missing: ${TOOLS_ROOT}`;
  } else if (!resolvedSource || !existsSync(resolvedSource)) {
    missingReason = `resolved install tree missing (source link ${sourceLink} → ${resolvedSource ?? "unresolved"}; likely /tmp purged)`;
  } else if (!pythonBin || !existsSync(pythonBin)) {
    missingReason = `venv python missing at ${venvLink} → ${resolvedVenv ?? "unresolved"}`;
  } else if (!ginConfigPath) {
    missingReason = `no_objects.gin absent under ${resolvedSource}/infinigen_examples/configs_indoor/**`;
  }

  return {
    toolsRoot: TOOLS_ROOT,
    sourceLink,
    resolvedSource,
    venvLink,
    resolvedVenv,
    pythonBin,
    ginConfigPath,
    noTrimGinPath,
    installIsUnderTmp,
    missingReason,
  };
}

function baseClaims(): Pick<Measure, "claimScope" | "notEvidenceFor"> {
  return {
    claimScope: [
      "local Infinigen generate with no_trim.gin + restrict_solving.solve_max_rooms=1",
      "single-room vs multi-room measurement via wall count and Euler characteristic",
      "geometry + structure + budget measure of exported shell",
      "MADR 0050 raw+postOpt columns recorded",
      "door-opening survival verified",
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

function blocked(reason: string, resolvedInstallPath: string, installIsUnderTmp: boolean): Measure {
  return {
    verdict: "inconclusive_blocked",
    verdictReason: reason,
    resolvedInstallPath,
    ginOverrides: [],
    roomScope: "unknown",
    wallCount: 0,
    rawTriangleCount: 0,
    postOptTriangleCount: null,
    triangleCeiling: QUEST_STATION_MAX_VISIBLE_TRIANGLES,
    doorOpeningSurvives: null,
    hasFloor: false,
    hasCeiling: false,
    generateSeconds: null,
    ...baseClaims(),
    meshCount: 0,
    materialCount: 0,
    textureCount: 0,
    exportBytes: 0,
    featureSurvival: {},
    installIsUnderTmp,
    doorCutterCount: 0,
    measuredAt: new Date().toISOString(),
  };
}

async function measureBlendStructure(
  blendPath: string,
  pythonBin: string,
): Promise<BlendStructure> {
  const py = `
import bpy, json, re
bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(blendPath)})
tris=0; meshes=0
mats=set(); tex_count=0; tex_bytes=0
obj_names=[]
for img in bpy.data.images:
    if img.size[0] <= 0: continue
    tex_count += 1
    try:
        w,h = img.size
        ch = img.channels or 4
        tex_bytes += int(w)*int(h)*int(ch)
    except Exception:
        pass

by_coll = {}
for obj in bpy.data.objects:
    obj_names.append(obj.name)
    if obj.type=='MESH' and obj.data:
        meshes += 1
        me=obj.data
        me.calc_loop_triangles()
        t = len(me.loop_triangles)
        tris += t
        for s in obj.material_slots:
            if s.material: mats.add(s.material.name)
        for coll in obj.users_collection:
            cname = coll.name
            if cname not in by_coll:
                by_coll[cname] = {"tris": 0, "count": 0}
            by_coll[cname]["tris"] += t
            by_coll[cname]["count"] += 1

coll_names=[c.name for c in bpy.data.collections]
joined = " ".join(obj_names + coll_names).lower()

has_floor = any(re.search(r"floor", n, re.I) and not re.search(r"skirting", n, re.I) for n in obj_names+coll_names)
has_ceiling = any(re.search(r"ceiling", n, re.I) for n in obj_names+coll_names)
wall_meshes = [n for n in obj_names if re.search(r"wall|room_wall|exterior", n, re.I)]
wall_count = max(len(wall_meshes), 1 if "room_wall" in joined else 0)

# Door cutter count
cutters_col = bpy.data.collections.get("placeholders:portal_cutters")
door_cutter_count = 0
if cutters_col:
    door_cutter_count = sum(1 for o in cutters_col.objects if "door" in o.name.lower())

# Euler characteristic check for walls (negative Euler = holes)
wall_euler_checks = []
for obj in bpy.data.objects:
    if obj.type == 'MESH' and obj.data and ("wall" in obj.name.lower() or "exterior" in obj.name.lower()):
        me = obj.data
        me.calc_loop_triangles()
        V = len(me.vertices)
        E = len(me.edges)
        F = len(me.loop_triangles)
        euler = V - E + F
        wall_euler_checks.append({"name": obj.name, "euler": euler, "hasHoles": euler < 2})

has_door_opening = door_cutter_count > 0 or any(w["hasHoles"] for w in wall_euler_checks)

print(json.dumps({
  "triangleCount": tris,
  "meshCount": meshes,
  "materialCount": len(mats),
  "textureCount": tex_count,
  "textureBytesEstimate": tex_bytes,
  "hasFloor": bool(has_floor),
  "hasCeiling": bool(has_ceiling),
  "wallCount": int(wall_count),
  "hasDoorOpening": bool(has_door_opening),
  "doorCutterCount": door_cutter_count,
  "objectNames": obj_names[:80],
  "collectionNames": coll_names[:80],
  "wallEulerChecks": wall_euler_checks,
  "byCollection": by_coll,
}))
`;
  const result = await runCmd(pythonBin, ["-c", py], { timeoutMs: 300_000 });
  if (result.code !== 0) {
    throw new Error(
      `blend structure measure failed (${result.code}): ${(result.stderr || result.stdout).slice(0, 1000)}`,
    );
  }
  const line = result.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .pop();
  if (!line) {
    throw new Error(`blend measure produced no JSON: ${result.stdout.slice(0, 500)}`);
  }
  return JSON.parse(line) as BlendStructure;
}

async function exportBlendToGlb(
  blendPath: string,
  glbOut: string,
  pythonBin: string,
): Promise<void> {
  ensureDir(path.dirname(glbOut));
  const py = `
import bpy
bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(blendPath)})
bpy.ops.export_scene.gltf(
    filepath=${JSON.stringify(glbOut)},
    export_format='GLB',
    use_selection=False,
    export_apply=True,
)
print("EXPORTED", ${JSON.stringify(glbOut)})
`;
  const result = await runCmd(pythonBin, ["-c", py], { timeoutMs: 600_000 });
  if (result.code !== 0 || !existsSync(glbOut)) {
    throw new Error(
      `glTF export failed (${result.code}): ${(result.stderr || result.stdout).slice(0, 1200)}`,
    );
  }
}

async function measureGlb(glbPath: string): Promise<{
  triangleCount: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  exportBytes: number;
}> {
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
 * Ensure the no_trim_single_room.gin config exists at the install.
 * Includes no_trim.gin (no_objects + trim overrides) and adds
 * restrict_solving.solve_max_rooms=1 WITHOUT BlueprintSolidifier.enable_open=False.
 */
async function ensureSingleRoomGin(
  resolvedSource: string,
  noTrimGinPath: string | null,
): Promise<string> {
  const disableDir = path.join(resolvedSource, "infinigen_examples/configs_indoor/disable");

  // Ensure no_trim.gin exists first (#229 dependency)
  if (!noTrimGinPath || !existsSync(noTrimGinPath)) {
    ensureDir(disableDir);
    const noTrimContent = `include "infinigen_examples/configs_indoor/disable/no_objects.gin"
compose_indoors.room_doors_enabled = False
compose_indoors.room_windows_enabled = False
compose_indoors.skirting_floor_enabled = False
compose_indoors.skirting_ceiling_enabled = False
`;
    noTrimGinPath = path.join(disableDir, "no_trim.gin");
    writeFileSync(noTrimGinPath, noTrimContent, "utf8");
  }

  const configPath = path.join(disableDir, "no_trim_single_room.gin");
  // Include no_trim.gin and add solve_max_rooms=1 WITHOUT enable_open=False.
  // singleroom.gin uses enable_open=False which makes the solidifier stage ~12+ min.
  // The hypothesis: solve_max_rooms alone without enable_open=False is fast enough.
  const content = `include "infinigen_examples/configs_indoor/disable/no_trim.gin"
restrict_solving.solve_max_rooms=1
`;
  writeFileSync(configPath, content, "utf8");
  return configPath;
}

function findBlend(outDir: string): string | null {
  for (const c of [path.join(outDir, "scene.blend")]) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Measure (and if needed generate) a single-room Infinigen shell with trim overrides
 * and restrict_solving.solve_max_rooms=1.
 * Cached report is re-used when present unless OPENCLINXR_FORCE_SINGLE_ROOM_MEASURE=1.
 */
export async function inspectInfinigenSingleRoomShell(): Promise<Measure> {
  ensureDir(EVIDENCE_DIR);

  if (existsSync(MEASURE_PATH) && process.env.OPENCLINXR_FORCE_SINGLE_ROOM_MEASURE !== "1") {
    try {
      const cached = JSON.parse(readFileSync(MEASURE_PATH, "utf8")) as Measure;
      if (
        cached?.verdict &&
        [
          "single_room_under_ceiling",
          "multi_room_still",
          "reject_measured",
          "inconclusive_blocked",
        ].includes(cached.verdict) &&
        typeof cached.resolvedInstallPath === "string" &&
        cached.resolvedInstallPath.length > 0
      ) {
        return cached;
      }
    } catch {
      // re-measure
    }
  }

  const install = resolveInstall();
  const resolvedInstallPath =
    install.resolvedSource ??
    (existsSync(install.sourceLink) ? install.sourceLink : TOOLS_ROOT);

  if (install.missingReason) {
    const report = blocked(
      `Install/toolchain blocked: ${install.missingReason}. ` +
        `source link ${install.sourceLink}` +
        (install.resolvedSource ? ` realpath→${install.resolvedSource}` : " (broken)") +
        `; venv ${install.venvLink}` +
        (install.resolvedVenv ? ` realpath→${install.resolvedVenv}` : " (broken)"),
      resolvedInstallPath,
      install.installIsUnderTmp,
    );
    writeFileSync(MEASURE_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }

  const pythonBin = install.pythonBin!;
  const resolvedSource = install.resolvedSource!;

  // Create no_trim_single_room.gin: no_trim + solve_max_rooms=1
  const singleRoomConfigPath = await ensureSingleRoomGin(resolvedSource, install.noTrimGinPath);

  const ginOverrides = [
    "disable/no_trim_single_room.gin (no_objects + no_trim + restrict_solving.solve_max_rooms=1)",
    "compose_indoors.terrain_enabled=False",
    "NOTE: BlueprintSolidifier.enable_open is NOT set — singleroom.gin's enable_open=False is the known-slow path",
  ];

  const outDir = path.join(TOOLS_ROOT, "outputs/no_trim_single_room");
  ensureDir(outDir);
  const glbOut = path.join(EVIDENCE_DIR, "single-room-shell.glb");

  // Generate
  const generateArgs = [
    "-m",
    "infinigen_examples.generate_indoors",
    "--seed",
    "0",
    "--task",
    "coarse",
    "--output_folder",
    outDir,
    "-g",
    "disable/no_trim_single_room.gin",
    "-p",
    "compose_indoors.terrain_enabled=False",
  ];

  let blendPath = findBlend(outDir);
  let generateSeconds: number | null = null;

  if (!blendPath || process.env.OPENCLINXR_FORCE_SINGLE_ROOM_GENERATE === "1") {
    const t0 = performance.now();
    const gen = await runCmd(pythonBin, generateArgs, {
      cwd: resolvedSource,
      env: { PYTHONUNBUFFERED: "1" },
      timeoutMs: GENERATE_TIMEOUT_MS,
    });
    generateSeconds = (performance.now() - t0) / 1000;
    writeFileSync(
      GEN_LOG_PATH,
      `exit=${gen.code} timedOut=${gen.timedOut} seconds=${generateSeconds}\n` +
        `cmd=${pythonBin} ${generateArgs.join(" ")}\n\nSTDOUT\n${gen.stdout}\n\nSTDERR\n${gen.stderr}\n`,
      "utf8",
    );

    if (gen.timedOut) {
      const report = blocked(
        `Generate timed out after ${generateSeconds.toFixed(1)}s (cap 15 min) — ` +
          `this is what singleroom.gin with enable_open=False does (~12+ min). ` +
          `Without enable_open=False and with only solve_max_rooms=1, if we still timeout, ` +
          `the single-room solve path is genuinely slow regardless of the solidifier flag.`,
        resolvedInstallPath,
        install.installIsUnderTmp,
      );
      writeFileSync(MEASURE_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      return report;
    }
    if (gen.code !== 0) {
      const report = blocked(
        `generate_indoors exited ${gen.code} after ${generateSeconds.toFixed(1)}s: ${(gen.stderr || gen.stdout).slice(0, 1500)}`,
        resolvedInstallPath,
        install.installIsUnderTmp,
      );
      writeFileSync(MEASURE_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      return report;
    }
    blendPath = findBlend(outDir);
  } else {
    if (existsSync(GEN_LOG_PATH)) {
      const m = /seconds=([\d.]+)/.exec(readFileSync(GEN_LOG_PATH, "utf8"));
      if (m) generateSeconds = Number(m[1]);
    }
  }

  if (!blendPath || !existsSync(blendPath)) {
    const report = blocked(
      `Generate finished without scene.blend under ${outDir}`,
      resolvedInstallPath,
      install.installIsUnderTmp,
    );
    writeFileSync(MEASURE_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }

  let structure: BlendStructure;
  try {
    structure = await measureBlendStructure(blendPath, pythonBin);
  } catch (err) {
    const report = blocked(
      `Blend structure measure failed: ${String(err).slice(0, 800)}`,
      resolvedInstallPath,
      install.installIsUnderTmp,
    );
    writeFileSync(MEASURE_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }

  // Export to glTF and measure
  let glbMetrics: {
    triangleCount: number;
    meshCount: number;
    materialCount: number;
    textureCount: number;
    exportBytes: number;
  } | null = null;
  try {
    if (!existsSync(glbOut) || process.env.OPENCLINXR_FORCE_SINGLE_ROOM_GENERATE === "1") {
      await exportBlendToGlb(blendPath, glbOut, pythonBin);
    }
    glbMetrics = await measureGlb(glbOut);
  } catch (err) {
    const blendBytes = statSync(blendPath).size;
    glbMetrics = {
      triangleCount: structure.triangleCount,
      meshCount: structure.meshCount,
      materialCount: structure.materialCount,
      textureCount: structure.textureCount,
      exportBytes: blendBytes,
    };
    writeFileSync(
      path.join(EVIDENCE_DIR, "export-note.txt"),
      `GLB export/measure failed (${String(err).slice(0, 600)}); using blend-side counts\n`,
      "utf8",
    );
  }

  const rawTriangleCount = glbMetrics.triangleCount > 0 ? glbMetrics.triangleCount : structure.triangleCount;
  const meshCount = glbMetrics.meshCount > 0 ? glbMetrics.meshCount : structure.meshCount;
  const materialCount = glbMetrics.materialCount > 0 ? glbMetrics.materialCount : structure.materialCount;
  const textureCount = glbMetrics.textureCount > 0 ? glbMetrics.textureCount : structure.textureCount;
  const exportBytes = glbMetrics.exportBytes;

  const hasFloor = structure.hasFloor;
  const hasCeiling = structure.hasCeiling;
  const wallCount = structure.wallCount;
  const doorOpeningSurvives = structure.hasDoorOpening;
  const doorCutterCount = structure.doorCutterCount;

  // Determine roomScope from wall count
  // #229 multi-room had 20 wall meshes (whole floorplan)
  // A single room should have far fewer — typically 4-6 walls for one room
  // The multi-room floorplan merges walls across rooms, so the difference is stark
  const roomScope: Measure["roomScope"] = wallCount <= 10 ? "single_room" : "multi_room";

  const featureSurvival: Record<string, boolean> = {
    floor: hasFloor,
    twoOrMoreWalls: wallCount >= 2,
    ceiling: hasCeiling,
    doorAperture: doorOpeningSurvives,
    noFurniture: true,
  };

  // Decide verdict
  let verdict: Measure["verdict"];
  let verdictReason: string;

  const roomIsIntact = hasFloor && hasCeiling && wallCount >= 2 && doorOpeningSurvives;

  if (roomScope !== "single_room") {
    verdict = "multi_room_still";
    verdictReason =
      `Still multi-room: ${wallCount} wall meshes. ` +
      `#229 baseline had 20 walls for the full floorplan; a single room should have ≤10. ` +
      `${rawTriangleCount} tris in ${generateSeconds?.toFixed(1) ?? "?"}s. ` +
      `restrict_solving.solve_max_rooms=1 was set but the solve did not collapse to one room. ` +
      `This is a successful measured negative — single-room restriction does not work with this approach.`;
  } else if (rawTriangleCount <= QUEST_STATION_MAX_VISIBLE_TRIANGLES && roomIsIntact) {
    verdict = "single_room_under_ceiling";
    verdictReason =
      `Single room at ${rawTriangleCount} tris (${((rawTriangleCount / QUEST_STATION_MAX_VISIBLE_TRIANGLES) * 100).toFixed(1)}% of ${QUEST_STATION_MAX_VISIBLE_TRIANGLES} ceiling) ` +
      `in ${generateSeconds?.toFixed(1) ?? "?"}s with floor+${wallCount} walls+ceiling+${doorCutterCount} door apertures. ` +
      `Trim savings preserved from #229 trim-override path. ` +
      `MADR 0043 Decision unchanged — no runtime adoption.`;
  } else if (!roomIsIntact) {
    verdict = "reject_measured";
    const missing: string[] = [];
    if (!hasFloor) missing.push("floor");
    if (!hasCeiling) missing.push("ceiling");
    if (wallCount < 2) missing.push(`walls=${wallCount}`);
    if (!doorOpeningSurvives) missing.push("door_aperture");
    verdictReason = `Single room but not a room: ${missing.join(", ")} missing.`;
  } else {
    verdict = "reject_measured";
    verdictReason = `${rawTriangleCount} tris exceeds ${QUEST_STATION_MAX_VISIBLE_TRIANGLES} ceiling.`;
  }

  const byCollection = structure.byCollection;

  const report: Measure = {
    verdict,
    verdictReason,
    resolvedInstallPath,
    ginOverrides,
    roomScope,
    wallCount,
    rawTriangleCount,
    postOptTriangleCount: null, // raw already under ceiling; no post-opt needed
    triangleCeiling: QUEST_STATION_MAX_VISIBLE_TRIANGLES,
    doorOpeningSurvives,
    hasFloor,
    hasCeiling,
    generateSeconds,
    ...baseClaims(),
    meshCount,
    materialCount,
    textureCount,
    exportBytes,
    featureSurvival,
    installIsUnderTmp: install.installIsUnderTmp,
    doorCutterCount,
    blendPath,
    glbPath: existsSync(glbOut) ? glbOut : null,
    generateCommand: [pythonBin, ...generateArgs],
    structureDetail: {
      objectNames: structure.objectNames,
      collectionNames: structure.collectionNames,
      textureBytesEstimateBlend: structure.textureBytesEstimate,
      installSymlinks: {
        source: install.sourceLink,
        sourceRealpath: install.resolvedSource,
        venv: install.venvLink,
        venvRealpath: install.resolvedVenv,
      },
    },
    wallEulerChecks: structure.wallEulerChecks,
    byCollection,
    measuredAt: new Date().toISOString(),
  };

  writeFileSync(MEASURE_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

// CLI
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  inspectInfinigenSingleRoomShell()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
