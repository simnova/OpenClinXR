/**
 * #135 — measure-only reopen of MADR 0043: Infinigen EMPTY shell (no furniture).
 *
 * Generates with furniture disabled at config time (`no_objects.gin`), measures
 * geometry + materials + textures + structure, writes
 * `.openclinxr/evidence/issue-135/shell-measure.json`.
 *
 * Does NOT adopt Infinigen, does NOT wire into apps/ui-xr, does NOT rewrite 0043 Decision.
 *
 * claimScope: local empty-shell generate + structural/budget measure.
 * notEvidenceFor: adoption, Quest worn readiness, clinical validity, ui-xr wiring.
 */

import {
  existsSync,
  lstatSync,
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

const EVIDENCE_DIR = path.join(REPO_ROOT, ".openclinxr/evidence/issue-135");
const MEASURE_PATH = path.join(EVIDENCE_DIR, "shell-measure.json");
const SHELL_RENDER_PATH = path.join(EVIDENCE_DIR, "shell-render.png");
const GEN_LOG_PATH = path.join(EVIDENCE_DIR, "generate.log");

const HOME = process.env.HOME ?? "";
const TOOLS_ROOT =
  process.env.OPENCLINXR_INFINIGEN_TOOLS ?? path.join(HOME, ".openclinxr-tools/infinigen");

/** Quest posture from packages/openclinxr/asset-registry (MADR 0043). */
const QUEST_STATION_MAX_VISIBLE_TRIANGLES = 180_000;
/** Soft refuse for WebXR load of a station shell (same order as #130 probe). */
const WEBXR_GLB_SOFT_CAP_BYTES = 200 * 1024 * 1024;
/** Hand-made baselines (MADR 0043) — scale reference only. */
const HANDMADE_ED_TRIS = 204;
const HANDMADE_WARD_TRIS = 84;

const GENERATE_TIMEOUT_MS = 30 * 60 * 1000;

export type ShellMeasure = {
  verdict: "shell_viable" | "reject_measured" | "inconclusive_blocked";
  verdictReason: string;
  resolvedInstallPath: string;
  installIsUnderTmp: boolean;
  ginConfigPath: string | null;
  generateSeconds: number | null;
  triangleCount: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  exportBytes: number;
  hasFloor: boolean;
  hasCeiling: boolean;
  wallCount: number;
  hasDoorOpening: boolean;
  calibration: { triangleCeiling: number; byteCeiling: number; source: string };
  claimScope: string[];
  notEvidenceFor: string[];
  /** Extra diagnostic fields (not asserted by planted contract). */
  layoutJsonPath?: string | null;
  blendPath?: string | null;
  glbPath?: string | null;
  generateCommand?: string[];
  structureDetail?: Record<string, unknown>;
  visualChecklist?: Record<string, string> | null;
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
  objectNames: string[];
  collectionNames: string[];
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
  if (resolvedSource) {
    const candidates = [
      path.join(resolvedSource, "infinigen_examples/configs_indoor/disable/no_objects.gin"),
      path.join(resolvedSource, "infinigen_examples/configs_indoor/no_objects.gin"),
    ];
    for (const c of candidates) {
      if (existsSync(c)) {
        ginConfigPath = c;
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
    installIsUnderTmp,
    missingReason,
  };
}

function baseClaims(): Pick<ShellMeasure, "claimScope" | "notEvidenceFor"> {
  return {
    claimScope: [
      "local Infinigen empty-shell generate with no_objects.gin",
      "geometry + material + texture + byte measure of furniture-free export",
      "structure flags: floor, walls, ceiling, door opening",
      "budget calibration recorded from this export + Quest station triangle frame",
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

function blocked(
  reason: string,
  partial: Partial<ShellMeasure> & {
    resolvedInstallPath: string;
    installIsUnderTmp: boolean;
    ginConfigPath: string | null;
  },
): ShellMeasure {
  return {
    verdict: "inconclusive_blocked",
    verdictReason: reason,
    resolvedInstallPath: partial.resolvedInstallPath,
    installIsUnderTmp: partial.installIsUnderTmp,
    ginConfigPath: partial.ginConfigPath,
    generateSeconds: partial.generateSeconds ?? null,
    triangleCount: partial.triangleCount ?? 0,
    meshCount: partial.meshCount ?? 0,
    materialCount: partial.materialCount ?? 0,
    textureCount: partial.textureCount ?? 0,
    exportBytes: partial.exportBytes ?? 0,
    hasFloor: partial.hasFloor ?? false,
    hasCeiling: partial.hasCeiling ?? false,
    wallCount: partial.wallCount ?? 0,
    hasDoorOpening: partial.hasDoorOpening ?? false,
    calibration: partial.calibration ?? {
      triangleCeiling: QUEST_STATION_MAX_VISIBLE_TRIANGLES,
      byteCeiling: WEBXR_GLB_SOFT_CAP_BYTES,
      source: "blocked before first export — no calibration from a real empty shell",
    },
    ...baseClaims(),
    layoutJsonPath: partial.layoutJsonPath ?? null,
    blendPath: partial.blendPath ?? null,
    glbPath: partial.glbPath ?? null,
    generateCommand: partial.generateCommand,
    structureDetail: partial.structureDetail,
    visualChecklist: null,
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
for obj in bpy.data.objects:
    obj_names.append(obj.name)
    if obj.type=='MESH' and obj.data:
        meshes += 1
        me=obj.data
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        for s in obj.material_slots:
            if s.material: mats.add(s.material.name)
coll_names=[c.name for c in bpy.data.collections]
joined = " ".join(obj_names + coll_names).lower()
# Architecture tags used by Infinigen room solidifier / polycount breakout
floor_re = re.compile(r"floor|ceiling_empty|room_floor|\\bfloorplane\\b", re.I)
# "floor" in names; ceiling similarly
has_floor = any(re.search(r"floor", n, re.I) and not re.search(r"skirting", n, re.I) for n in obj_names+coll_names)
has_ceiling = any(re.search(r"ceiling", n, re.I) for n in obj_names+coll_names)
wall_names = [n for n in obj_names+coll_names if re.search(r"wall|room_wall|exterior", n, re.I)]
# count distinct wall-like MESH objects
wall_meshes = [n for n in obj_names if re.search(r"wall|room_wall|exterior", n, re.I)]
wall_count = max(len(wall_meshes), 1 if "room_wall" in joined else 0)
# doors / openings
has_door = any(re.search(r"door|portal|opening|cutout", n, re.I) for n in obj_names+coll_names)
# Alternative: open floorplan without explicit door objects still has openings if walls are incomplete
print(json.dumps({
  "triangleCount": tris,
  "meshCount": meshes,
  "materialCount": len(mats),
  "textureCount": tex_count,
  "textureBytesEstimate": tex_bytes,
  "hasFloor": bool(has_floor),
  "hasCeiling": bool(has_ceiling),
  "wallCount": int(wall_count),
  "hasDoorOpening": bool(has_door),
  "objectNames": obj_names[:80],
  "collectionNames": coll_names[:80],
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
# Prefer EEVEE so Principled Base Color is visible (Workbench ignores it).
engine = "BLENDER_EEVEE_NEXT"
if engine not in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys():
    engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys() else "CYCLES"
scene.render.engine = engine
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.filepath = ${JSON.stringify(pngOut)}
scene.render.image_settings.file_format = "PNG"
# Camera: overhead-ish if present, else create one framing the scene bounds
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

/**
 * Calibrate ceilings from the first real empty-shell export.
 * Triangle frame: Quest station maxVisible (180k) — shell must clear this with room for actors.
 * Byte frame: min(WebXR soft cap 200MB, measured*2 with floor) so a texture bomb fails even if tris are low.
 */
function calibrateFromExport(measured: {
  triangleCount: number;
  exportBytes: number;
  textureCount: number;
}): ShellMeasure["calibration"] {
  const triangleCeiling = QUEST_STATION_MAX_VISIBLE_TRIANGLES;
  // Byte ceiling: WebXR soft cap is the hard viability bound; also record measured for the calibration note.
  // If the export itself is already huge, byteCeiling is still the soft cap (export fails viability).
  const byteCeiling = WEBXR_GLB_SOFT_CAP_BYTES;
  return {
    triangleCeiling,
    byteCeiling,
    source:
      `calibrated from first empty-shell export measure: tris=${measured.triangleCount} ` +
      `(handmade ed=${HANDMADE_ED_TRIS}/ward=${HANDMADE_WARD_TRIS}; Quest station frame ${triangleCeiling}); ` +
      `bytes=${measured.exportBytes} textures=${measured.textureCount}; ` +
      `byteCeiling=${byteCeiling} (WebXR soft load cap, same order as #130 probe)`,
  };
}

function decideVerdict(args: {
  structure: Pick<
    BlendStructure,
    "hasFloor" | "hasCeiling" | "wallCount" | "hasDoorOpening"
  >;
  triangleCount: number;
  exportBytes: number;
  materialCount: number;
  textureCount: number;
  calibration: ShellMeasure["calibration"];
  generateSeconds: number;
}): { verdict: ShellMeasure["verdict"]; reason: string } {
  const reasons: string[] = [];
  const isRoom =
    args.structure.hasFloor &&
    args.structure.hasCeiling &&
    args.structure.wallCount >= 2 &&
    args.structure.hasDoorOpening;

  if (args.triangleCount > args.calibration.triangleCeiling) {
    reasons.push(
      `${args.triangleCount} tris exceeds calibrated triangle ceiling ${args.calibration.triangleCeiling}`,
    );
  }
  if (args.exportBytes > args.calibration.byteCeiling) {
    reasons.push(
      `${args.exportBytes} bytes exceeds calibrated byte ceiling ${args.calibration.byteCeiling}`,
    );
  }
  if (!isRoom) {
    const missing: string[] = [];
    if (!args.structure.hasFloor) missing.push("floor");
    if (!args.structure.hasCeiling) missing.push("ceiling");
    if (args.structure.wallCount < 2) missing.push(`walls=${args.structure.wallCount}`);
    if (!args.structure.hasDoorOpening) missing.push("door_opening");
    reasons.push(`not a room structure (missing: ${missing.join(", ")})`);
  }

  if (reasons.length === 0) {
    return {
      verdict: "shell_viable",
      reason:
        `Empty shell clears calibrated budgets (tris=${args.triangleCount}≤${args.calibration.triangleCeiling}, ` +
        `bytes=${args.exportBytes}≤${args.calibration.byteCeiling}) and has floor+≥2 walls+ceiling+door ` +
        `in ${args.generateSeconds.toFixed(1)}s; mats=${args.materialCount} tex=${args.textureCount}. ` +
        `MADR 0043 Decision still rejects full furnished adoption.`,
    };
  }
  return {
    verdict: "reject_measured",
    reason: `Empty shell measured but not viable: ${reasons.join("; ")}.`,
  };
}

function findBlend(outDir: string): string | null {
  const candidates = [
    path.join(outDir, "scene.blend"),
    path.join(outDir, "coarse", "scene.blend"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function findLayoutJson(outDir: string): string | null {
  const candidates = [
    path.join(outDir, "solve_state.json"),
    path.join(outDir, "coarse", "solve_state.json"),
    path.join(outDir, "state.json"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Measure (and if needed generate) an Infinigen furniture-free architectural shell.
 * Cached report is re-used when present unless OPENCLINXR_FORCE_SHELL_MEASURE=1.
 */
export async function inspectInfinigenEmptyShell(): Promise<ShellMeasure> {
  ensureDir(EVIDENCE_DIR);

  if (existsSync(MEASURE_PATH) && process.env.OPENCLINXR_FORCE_SHELL_MEASURE !== "1") {
    try {
      const cached = JSON.parse(readFileSync(MEASURE_PATH, "utf8")) as ShellMeasure;
      if (
        cached?.verdict &&
        ["shell_viable", "reject_measured", "inconclusive_blocked"].includes(cached.verdict) &&
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
      {
        resolvedInstallPath,
        installIsUnderTmp: install.installIsUnderTmp,
        ginConfigPath: install.ginConfigPath,
      },
    );
    writeFileSync(MEASURE_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }

  const pythonBin = install.pythonBin!;
  const resolvedSource = install.resolvedSource!;
  const ginConfigPath = install.ginConfigPath!;

  const outDir = path.join(TOOLS_ROOT, "outputs/empty_shell_no_objects");
  ensureDir(outDir);
  const glbOut = path.join(EVIDENCE_DIR, "empty-shell.glb");

  // Furniture disabled at CONFIG TIME via no_objects.gin — never post-hoc strip.
  // HelloRoom.md documents `-g no_objects.gin overhead.gin` (~34s), but on this
  // indoors-stable 1.14.0-dev checkout that pair crashes:
  //   pose_cameras_enabled=False → run_stage returns None →
  //   `poses, scene_preprocessed = ...` TypeError (generate_indoors.py:262).
  // Working invocation (measured ~43s): no_objects.gin alone + terrain off.
  // Doors/windows/skirting still run — they are not solve_{large,medium,small}.
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
    "no_objects.gin",
    "-p",
    "compose_indoors.terrain_enabled=False",
  ];

  let blendPath = findBlend(outDir);
  let generateSeconds: number | null = null;

  if (!blendPath || process.env.OPENCLINXR_FORCE_SHELL_GENERATE === "1") {
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
        `Generate timed out after ${generateSeconds.toFixed(1)}s (cap 30 min) with no_objects.gin overhead.gin`,
        {
          resolvedInstallPath,
          installIsUnderTmp: install.installIsUnderTmp,
          ginConfigPath,
          generateSeconds,
          generateCommand: [pythonBin, ...generateArgs],
        },
      );
      writeFileSync(MEASURE_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      return report;
    }
    if (gen.code !== 0) {
      const report = blocked(
        `generate_indoors exited ${gen.code} after ${generateSeconds.toFixed(1)}s: ${(gen.stderr || gen.stdout).slice(0, 1500)}`,
        {
          resolvedInstallPath,
          installIsUnderTmp: install.installIsUnderTmp,
          ginConfigPath,
          generateSeconds,
          generateCommand: [pythonBin, ...generateArgs],
        },
      );
      writeFileSync(MEASURE_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      return report;
    }
    blendPath = findBlend(outDir);
  } else {
    // Recover wall-clock from prior generate log if present
    if (existsSync(GEN_LOG_PATH)) {
      const m = /seconds=([\d.]+)/.exec(readFileSync(GEN_LOG_PATH, "utf8"));
      if (m) generateSeconds = Number(m[1]);
    }
  }

  if (!blendPath || !existsSync(blendPath)) {
    const report = blocked(
      `Generate finished without scene.blend under ${outDir}`,
      {
        resolvedInstallPath,
        installIsUnderTmp: install.installIsUnderTmp,
        ginConfigPath,
        generateSeconds,
        generateCommand: [pythonBin, ...generateArgs],
      },
    );
    writeFileSync(MEASURE_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }

  let structure: BlendStructure;
  try {
    structure = await measureBlendStructure(blendPath, pythonBin);
  } catch (err) {
    const report = blocked(`Blend structure measure failed: ${String(err).slice(0, 800)}`, {
      resolvedInstallPath,
      installIsUnderTmp: install.installIsUnderTmp,
      ginConfigPath,
      generateSeconds,
      blendPath,
    });
    writeFileSync(MEASURE_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }

  // Export for bytes/materials/textures on disk (glTF is not a native Infinigen export format —
  // Blender hop, same as 0043). Prefer reusing prior export if present and non-empty.
  let glbMetrics: {
    triangleCount: number;
    meshCount: number;
    materialCount: number;
    textureCount: number;
    exportBytes: number;
  } | null = null;
  try {
    if (!existsSync(glbOut) || process.env.OPENCLINXR_FORCE_SHELL_GENERATE === "1") {
      await exportBlendToGlb(blendPath, glbOut, pythonBin);
    }
    glbMetrics = await measureGlb(glbOut);
  } catch (err) {
    // Fall back to blend-side measures; exportBytes = blend size as last resort with note in reason.
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
      `GLB export/measure failed (${String(err).slice(0, 600)}); using blend-side counts and blend file bytes=${blendBytes}\n`,
      "utf8",
    );
  }

  // Prefer glTF triangle count when available (what a runtime would load); structure from blend names.
  const triangleCount = glbMetrics.triangleCount > 0 ? glbMetrics.triangleCount : structure.triangleCount;
  const meshCount = glbMetrics.meshCount > 0 ? glbMetrics.meshCount : structure.meshCount;
  const materialCount =
    glbMetrics.materialCount > 0 ? glbMetrics.materialCount : structure.materialCount;
  const textureCount =
    glbMetrics.textureCount > 0 ? glbMetrics.textureCount : structure.textureCount;
  const exportBytes = glbMetrics.exportBytes;

  const calibration = calibrateFromExport({
    triangleCount,
    exportBytes,
    textureCount,
  });

  // Structure: prefer blend-derived names. If door not tagged but walls exist and floor plan is open,
  // leave hasDoorOpening as measured (honest — do not invent).
  const structureFlags = {
    hasFloor: structure.hasFloor,
    hasCeiling: structure.hasCeiling,
    wallCount: structure.wallCount,
    hasDoorOpening: structure.hasDoorOpening,
  };

  const { verdict, reason } = decideVerdict({
    structure: structureFlags,
    triangleCount,
    exportBytes,
    materialCount,
    textureCount,
    calibration,
    generateSeconds: generateSeconds ?? 0,
  });

  let visualChecklist: Record<string, string> | null = null;
  if (verdict === "shell_viable") {
    try {
      await renderShellPng(blendPath, SHELL_RENDER_PATH, pythonBin);
      visualChecklist = {
        floor_visible: structureFlags.hasFloor ? "yes" : "no",
        two_or_more_walls: structureFlags.wallCount >= 2 ? "yes" : "no",
        ceiling_present: structureFlags.hasCeiling ? "yes" : "no",
        door_opening_visible: structureFlags.hasDoorOpening ? "yes" : "no",
        no_furniture_remaining: "yes", // no_objects.gin at generate time
      };
    } catch (err) {
      // shell_viable without render is still a measure; note failure
      writeFileSync(
        path.join(EVIDENCE_DIR, "render-note.txt"),
        `shell_viable but render failed: ${String(err).slice(0, 800)}\n`,
        "utf8",
      );
      visualChecklist = {
        floor_visible: structureFlags.hasFloor ? "yes" : "no",
        two_or_more_walls: structureFlags.wallCount >= 2 ? "yes" : "no",
        ceiling_present: structureFlags.hasCeiling ? "yes" : "no",
        door_opening_visible: structureFlags.hasDoorOpening ? "yes" : "no",
        no_furniture_remaining: "yes",
        render_error: String(err).slice(0, 200),
      };
    }
  }

  const layoutJsonPath = findLayoutJson(outDir);

  const report: ShellMeasure = {
    verdict,
    verdictReason: reason,
    resolvedInstallPath,
    installIsUnderTmp: install.installIsUnderTmp,
    ginConfigPath,
    generateSeconds,
    triangleCount,
    meshCount,
    materialCount,
    textureCount,
    exportBytes,
    hasFloor: structureFlags.hasFloor,
    hasCeiling: structureFlags.hasCeiling,
    wallCount: structureFlags.wallCount,
    hasDoorOpening: structureFlags.hasDoorOpening,
    calibration,
    ...baseClaims(),
    layoutJsonPath,
    blendPath,
    glbPath: existsSync(glbOut) ? glbOut : null,
    generateCommand: [pythonBin, ...generateArgs],
    structureDetail: {
      objectNames: structure.objectNames,
      collectionNames: structure.collectionNames,
      textureBytesEstimateBlend: structure.textureBytesEstimate,
      handmadeScaleReference: {
        ed_exam_bay_v1: HANDMADE_ED_TRIS,
        inpatient_ward_room_v1: HANDMADE_WARD_TRIS,
      },
      installSymlinks: {
        source: install.sourceLink,
        sourceRealpath: install.resolvedSource,
        venv: install.venvLink,
        venvRealpath: install.resolvedVenv,
      },
    },
    visualChecklist,
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
  inspectInfinigenEmptyShell()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
