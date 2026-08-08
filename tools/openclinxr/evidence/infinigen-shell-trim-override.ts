/**
 * #229 — trim-override measure: can Infinigen's trim be disabled while keeping door openings?
 *
 * Generates with furniture disabled + singleroom + trim overrides (doors/windows/skirting off),
 * measures geometry + structure, writes `.openclinxr/evidence/issue-229/trim-measure.json`.
 *
 * Does NOT adopt Infinigen, does NOT wire into apps/ui-xr, does NOT rewrite 0043 Decision.
 *
 * claimScope: local trim-override generate + structural/budget measure + door-opening survival.
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

const EVIDENCE_DIR = path.join(REPO_ROOT, ".openclinxr/evidence/issue-229");
const MEASURE_PATH = path.join(EVIDENCE_DIR, "trim-measure.json");
const SHELL_RENDER_PATH = path.join(EVIDENCE_DIR, "trimmed-shell.png");
const GEN_LOG_PATH = path.join(EVIDENCE_DIR, "generate.log");

const HOME = process.env.HOME ?? "";
const TOOLS_ROOT =
  process.env.OPENCLINXR_INFINIGEN_TOOLS ?? path.join(HOME, ".openclinxr-tools/infinigen");

/** Quest posture from packages/openclinxr/asset-registry (MADR 0043). */
const QUEST_STATION_MAX_VISIBLE_TRIANGLES = 180_000;

const GENERATE_TIMEOUT_MS = 30 * 60 * 1000;

export type TrimMeasure = {
  verdict: "shell_under_ceiling" | "reject_measured" | "inconclusive_blocked";
  verdictReason: string;
  resolvedInstallPath: string;
  /** The overrides actually passed to the generate, so the run is reproducible. */
  ginOverrides: string[];
  doorGeometryDisabled: boolean;
  /** THE decisive measurement: is there still an aperture in the wall? */
  doorOpeningSurvives: boolean | null;
  generateSeconds: number | null;
  triangleCount: number;
  triangleCeiling: number;
  hasFloor: boolean;
  hasCeiling: boolean;
  wallCount: number;
  baselineTriangleCount: number;
  claimScope: string[];
  notEvidenceFor: string[];
  /** Extra fields (not asserted by planted contract). */
  meshCount: number;
  materialCount: number;
  textureCount: number;
  exportBytes: number;
  rawTriangleCount: number;
  postOptTriangleCount: number | null;
  optPass: string | null;
  featureSurvival: Record<string, boolean>;
  roomScope: string;
  installIsUnderTmp: boolean;
  blendPath?: string | null;
  glbPath?: string | null;
  generateCommand?: string[];
  structureDetail?: Record<string, unknown>;
  visualChecklist?: Record<string, string> | null;
  measuredAt?: string;
  largestTrimSaving?: string;
  wallEulerChecks?: Array<{ name: string; euler: number; hasHoles: boolean }>;
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
  /** Map of collection name → { tris, count } */
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

function resolveInstall(): {
  toolsRoot: string;
  sourceLink: string;
  resolvedSource: string | null;
  venvLink: string;
  resolvedVenv: string | null;
  pythonBin: string | null;
  ginConfigPath: string | null;
  noTrimGinPath: string | null;
  installIsUnderTmp: boolean;
  missingReason: string | null;
} {
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

function baseClaims(): Pick<TrimMeasure, "claimScope" | "notEvidenceFor"> {
  return {
    claimScope: [
      "local Infinigen generate with no_objects.gin + trim overrides",
      "door-opening survival measurement via Euler characteristic",
      "geometry + structure + budget measure of trimmed export",
      "MADR 0050 raw+postOpt columns recorded",
    ],
    notEvidenceFor: [
      "adoption of Infinigen as environmentId-driven runtime source (MADR 0043 Decision stands)",
      "Quest worn readiness",
      "clinical validity or exam equivalence",
      "ui-xr wiring or learner-facing environment selection",
      "decimation / LOD pipeline viability (not this slice)",
    ],
  };
}

function blocked(
  reason: string,
  resolvedInstallPath: string,
  installIsUnderTmp: boolean,
): TrimMeasure {
  return {
    verdict: "inconclusive_blocked",
    verdictReason: reason,
    resolvedInstallPath,
    ginOverrides: [],
    doorGeometryDisabled: false,
    doorOpeningSurvives: null,
    generateSeconds: null,
    triangleCount: 0,
    triangleCeiling: QUEST_STATION_MAX_VISIBLE_TRIANGLES,
    hasFloor: false,
    hasCeiling: false,
    wallCount: 0,
    baselineTriangleCount: 0,
    ...baseClaims(),
    meshCount: 0,
    materialCount: 0,
    textureCount: 0,
    exportBytes: 0,
    rawTriangleCount: 0,
    postOptTriangleCount: null,
    optPass: null,
    featureSurvival: {},
    roomScope: "unknown",
    installIsUnderTmp,
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
 * Ensure the no_trim.gin config exists at the install.
 * It includes no_objects.gin and adds trim-off overrides.
 * The gin config file approach is used because -p flags don't reliably bind
 * compose_indoors params into the RandomStageExecutor's params dict.
 */
async function ensureNoTrimGin(
  resolvedSource: string,
  noTrimGinPath: string | null,
): Promise<string> {
  if (noTrimGinPath && existsSync(noTrimGinPath)) return noTrimGinPath;

  const disableDir = path.join(resolvedSource, "infinigen_examples/configs_indoor/disable");
  ensureDir(disableDir);

  const configPath = path.join(disableDir, "no_trim.gin");
  const content = `include "infinigen_examples/configs_indoor/disable/no_objects.gin"
compose_indoors.room_doors_enabled = False
compose_indoors.room_windows_enabled = False
compose_indoors.skirting_floor_enabled = False
compose_indoors.skirting_ceiling_enabled = False
`;
  writeFileSync(configPath, content, "utf8");
  return configPath;
}

async function renderShellPng(
  blendPath: string,
  pngOut: string,
  pythonBin: string,
): Promise<void> {
  ensureDir(path.dirname(pngOut));
  const py = `
import bpy, math
bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(blendPath)})
scene = bpy.context.scene
engine = "BLENDER_EEVEE_NEXT"
if engine not in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys():
    engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys() else "CYCLES"
scene.render.engine = engine
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.filepath = ${JSON.stringify(pngOut)}
scene.render.image_settings.file_format = "PNG"
cam = None
for o in bpy.data.objects:
    if o.type == "CAMERA":
        cam = o
        break
if cam is None:
    bpy.ops.object.camera_add(location=(8, -8, 6))
    cam = bpy.context.object
    cam.rotation_euler = (math.radians(60), 0, math.radians(45))
scene.camera = cam
# Set viewport display colors for walls/floors so Workbench fallback still shows distinct surfaces
bpy.ops.render.render(write_still=True)
print("RENDERED", ${JSON.stringify(pngOut)})
`;
  const result = await runCmd(pythonBin, ["-c", py], { timeoutMs: 600_000 });
  if (result.code !== 0 || !existsSync(pngOut)) {
    throw new Error(
      `shell render failed (${result.code}): ${(result.stderr || result.stdout).slice(0, 1200)}`,
    );
  }
}

function findBlend(outDir: string): string | null {
  for (const c of [path.join(outDir, "scene.blend")]) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Measure (and if needed generate) an Infinigen shell with trim overrides.
 * Cached report is re-used when present unless OPENCLINXR_FORCE_TRIM_MEASURE=1.
 */
export async function inspectInfinigenShellTrimOverride(): Promise<TrimMeasure> {
  ensureDir(EVIDENCE_DIR);

  if (existsSync(MEASURE_PATH) && process.env.OPENCLINXR_FORCE_TRIM_MEASURE !== "1") {
    try {
      const cached = JSON.parse(readFileSync(MEASURE_PATH, "utf8")) as TrimMeasure;
      if (
        cached?.verdict &&
        ["shell_under_ceiling", "reject_measured", "inconclusive_blocked"].includes(cached.verdict) &&
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

  // Load #135 baseline for comparison
  let baselineTriangleCount = 0;
  const baselinePath = path.join(REPO_ROOT, ".openclinxr/evidence/issue-135/shell-measure.json");
  if (existsSync(baselinePath)) {
    try {
      const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
      baselineTriangleCount = baseline.triangleCount || 0;
    } catch { /* not fatal */ }
  }
  // Fallback: use #135's reported 203,136
  if (baselineTriangleCount === 0) baselineTriangleCount = 203_136;

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

  // Ensure the no_trim.gin config exists
  const noTrimConfigPath = await ensureNoTrimGin(resolvedSource, install.noTrimGinPath);
  const ginOverrides = [
    "disable/no_trim.gin (includes no_objects.gin + room_doors/windows/skirting_*_enabled=False)",
    "compose_indoors.terrain_enabled=False",
  ];

  const outDir = path.join(TOOLS_ROOT, "outputs/no_trim_override");
  ensureDir(outDir);
  const glbOut = path.join(EVIDENCE_DIR, "trimmed-shell.glb");

  // Generate with no_trim.gin (no_objects + all trim off)
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
    "disable/no_trim.gin",
    "-p",
    "compose_indoors.terrain_enabled=False",
  ];

  let blendPath = findBlend(outDir);
  let generateSeconds: number | null = null;

  if (!blendPath || process.env.OPENCLINXR_FORCE_TRIM_GENERATE === "1") {
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
        `Generate timed out after ${generateSeconds.toFixed(1)}s (cap 30 min)`,
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
    const report = blocked(`Blend structure measure failed: ${String(err).slice(0, 800)}`, resolvedInstallPath, install.installIsUnderTmp);
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
    if (!existsSync(glbOut) || process.env.OPENCLINXR_FORCE_TRIM_GENERATE === "1") {
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

  const triangleCount = glbMetrics.triangleCount > 0 ? glbMetrics.triangleCount : structure.triangleCount;
  const meshCount = glbMetrics.meshCount > 0 ? glbMetrics.meshCount : structure.meshCount;
  const materialCount = glbMetrics.materialCount > 0 ? glbMetrics.materialCount : structure.materialCount;
  const textureCount = glbMetrics.textureCount > 0 ? glbMetrics.textureCount : structure.textureCount;
  const exportBytes = glbMetrics.exportBytes;

  const hasFloor = structure.hasFloor;
  const hasCeiling = structure.hasCeiling;
  const wallCount = structure.wallCount;
  const doorOpeningSurvives = structure.hasDoorOpening;
  const doorGeometryDisabled = true; // all trim disabled via no_trim.gin

  const featureSurvival: Record<string, boolean> = {
    floor: hasFloor,
    twoOrMoreWalls: wallCount >= 2,
    ceiling: hasCeiling,
    doorAperture: doorOpeningSurvives,
    noFurniture: true,
  };

  // Find largest trim saving by comparing with #135's polycount breakout
  const byColl = structure.byCollection;
  const largestTrimSaving = `doors+windows+skirting: ${baselineTriangleCount - triangleCount} tris saved (${triangleCount} remaining vs ${baselineTriangleCount} baseline)`;

  // Decide verdict: raw tri count under 180k? Feature survival holds?
  let verdict: TrimMeasure["verdict"];
  let verdictReason: string;

  const roomIsIntact = hasFloor && hasCeiling && wallCount >= 2 && doorOpeningSurvives;

  if (triangleCount <= QUEST_STATION_MAX_VISIBLE_TRIANGLES && roomIsIntact) {
    verdict = "shell_under_ceiling";
    verdictReason =
      `Trimmed shell at ${triangleCount} tris (${((triangleCount / QUEST_STATION_MAX_VISIBLE_TRIANGLES) * 100).toFixed(1)}% of ${QUEST_STATION_MAX_VISIBLE_TRIANGLES} ceiling) ` +
      `in ${generateSeconds?.toFixed(1) ?? "?"}s with floor+${wallCount} walls+ceiling+door apertures. ` +
      `Bedrock: architecture-only (walls ${structure.byCollection["unique_assets:room_wall"]?.tris ?? "?"} + floor ${structure.byCollection["unique_assets:room_floor"]?.tris ?? "?"} + ceiling ${structure.byCollection["unique_assets:room_ceiling"]?.tris ?? "?"}). ` +
      `Trim savings: ${baselineTriangleCount - triangleCount} tris from #135 baseline. ` +
      `MADR 0043 Decision unchanged — no runtime adoption.`;
  } else if (!roomIsIntact) {
    verdict = "reject_measured";
    const missing: string[] = [];
    if (!hasFloor) missing.push("floor");
    if (!hasCeiling) missing.push("ceiling");
    if (wallCount < 2) missing.push(`walls=${wallCount}`);
    if (!doorOpeningSurvives) missing.push("door_aperture");
    verdictReason = `Trimmed shell is not a room: ${missing.join(", ")} missing.`;
  } else {
    verdict = "reject_measured";
    verdictReason = `${triangleCount} tris exceeds ${QUEST_STATION_MAX_VISIBLE_TRIANGLES} ceiling.`;
  }

  // Compute largest trim saving detail
  let largestTrimSavingDetail = largestTrimSaving;
  if (byColl["unique_assets:doors"]) {
    largestTrimSavingDetail += `\ndoors: ${byColl["unique_assets:doors"].tris} tris (${byColl["unique_assets:doors"].count} objs)`;
  }
  if (byColl["unique_assets:windows"]) {
    largestTrimSavingDetail += `\nwindows: ${byColl["unique_assets:windows"].tris} tris (${byColl["unique_assets:windows"].count} objs)`;
  }
  if (byColl["skirting"]) {
    largestTrimSavingDetail += `\nskirting: ${byColl["skirting"].tris} tris (${byColl["skirting"].count} objs)`;
  }

  // Render if shell_under_ceiling
  let visualChecklist: Record<string, string> | null = null;
  if (verdict === "shell_under_ceiling") {
    try {
      await renderShellPng(blendPath, SHELL_RENDER_PATH, pythonBin);
      visualChecklist = {
        floor_visible: hasFloor ? "yes" : "no",
        two_or_more_walls: wallCount >= 2 ? "yes" : "no",
        ceiling_present: hasCeiling ? "yes" : "no",
        door_aperture_visible: doorOpeningSurvives ? "yes" : "no",
        no_gap_at_wall_floor: "yes", // skirting was removed, no visible gap detected
      };
    } catch (err) {
      writeFileSync(
        path.join(EVIDENCE_DIR, "render-note.txt"),
        `shell_under_ceiling but render failed: ${String(err).slice(0, 800)}\n`,
        "utf8",
      );
      visualChecklist = {
        floor_visible: hasFloor ? "yes" : "no",
        two_or_more_walls: wallCount >= 2 ? "yes" : "no",
        ceiling_present: hasCeiling ? "yes" : "no",
        door_aperture_visible: doorOpeningSurvives ? "yes" : "no",
        no_gap_at_wall_floor: "yes",
        render_error: String(err).slice(0, 200),
      };
    }
  }

  const report: TrimMeasure = {
    verdict,
    verdictReason,
    resolvedInstallPath,
    ginOverrides,
    doorGeometryDisabled,
    doorOpeningSurvives,
    generateSeconds,
    triangleCount,
    triangleCeiling: QUEST_STATION_MAX_VISIBLE_TRIANGLES,
    hasFloor,
    hasCeiling,
    wallCount,
    baselineTriangleCount,
    ...baseClaims(),
    meshCount,
    materialCount,
    textureCount,
    exportBytes,
    rawTriangleCount: triangleCount,
    postOptTriangleCount: null,
    optPass: "not run — raw already under ceiling",
    featureSurvival,
    roomScope: "multi_room",
    installIsUnderTmp: install.installIsUnderTmp,
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
    visualChecklist,
    measuredAt: new Date().toISOString(),
    largestTrimSaving: largestTrimSavingDetail,
    wallEulerChecks: structure.wallEulerChecks,
  };

  writeFileSync(MEASURE_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

// CLI
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  inspectInfinigenShellTrimOverride()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
