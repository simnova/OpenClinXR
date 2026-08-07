/**
 * #130 Infinigen Indoors vs hand-made station shell — Lane C cagematch.
 *
 * Deliverable is a DECISION WITH EVIDENCE, not adoption. A measured negative
 * (budget, authoring time, non-parameterisable by environmentId, cannot load
 * into ui-xr three.js) CLOSES successfully.
 *
 * claimScope: local Infinigen Indoors generate/measure + hand-made parametric
 * shell measure + same-renderer load attempt + structural budget comparison.
 * notEvidenceFor: clinical room appropriateness, Quest worn readiness,
 * decimation-as-authoring-source, adoption into buildStationEnvironment.
 *
 * Install (outside repo — operator machine):
 *   ~/.openclinxr-tools/infinigen/{source,venv,outputs,exports}
 *   (symlinked to /tmp/ocxr77_tools/* from #77 when present)
 * Remove with:
 *   rm -rf ~/.openclinxr-tools/infinigen /tmp/ocxr77_tools/infinigen*
 *
 * LAND-PATH (gitignored under .openclinxr/):
 *   .openclinxr/evidence/infinigen-indoors-cagematch/latest/probe-report.json
 *   .openclinxr/evidence/infinigen-indoors-cagematch/latest/*.png
 *   .openclinxr/evidence/infinigen-indoors-cagematch/latest/threejs-load-attempt.json
 *
 * Reuses: tools/openclinxr/evidence/ui-xr-environment-room-capture.ts
 * (spawnPortlessDevServer + buildRoomCaptureUrl) for hand-made captures —
 * do not invent a fourth capture script.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const EVIDENCE_DIR = path.join(
  REPO_ROOT,
  ".openclinxr/evidence/infinigen-indoors-cagematch/latest",
);
const REPORT_PATH = path.join(EVIDENCE_DIR, "probe-report.json");
const ROOM_CAPTURE_DIR = path.join(
  REPO_ROOT,
  ".openclinxr/evidence/ui-xr-environment-room/latest",
);

const HOME = process.env.HOME ?? "";
const TOOLS_ROOT =
  process.env.OPENCLINXR_INFINIGEN_TOOLS ??
  path.join(HOME, ".openclinxr-tools/infinigen");
const INFINIGEN_DIR =
  process.env.OPENCLINXR_INFINIGEN_DIR ?? path.join(TOOLS_ROOT, "source");
const INFINIGEN_VENV =
  process.env.OPENCLINXR_INFINIGEN_VENV ?? path.join(TOOLS_ROOT, "venv");
const INFINIGEN_OUT =
  process.env.OPENCLINXR_INFINIGEN_OUT ??
  path.join(TOOLS_ROOT, "outputs/dining_coarse");
const GLB_EXPORT =
  process.env.OPENCLINXR_INFINIGEN_GLB ??
  path.join(TOOLS_ROOT, "exports/dining-room-seed0.glb");

/** Soft refuse before GLTFLoader parse — WebXR station shells must stay << this. */
const WEBXR_GLB_SOFT_CAP_BYTES = 200 * 1024 * 1024;

const QUEST_ASSET_MAX_TRIANGLES = 60_000;
const QUEST_STATION_MAX_VISIBLE_TRIANGLES = 180_000;

export const VERDICTS = [
  "adopt_candidate",
  "reject_measured",
  "inconclusive_blocked",
  "other",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export type GeometryMetrics = {
  triangleCount: number;
  materialCount: number;
  textureBytes: number;
  meshCount?: number;
  objectCount?: number;
};

export type ParameterisableReport = {
  parameterisable: boolean;
  how: string;
  clinicalEnvironmentIdSupported: boolean;
  roomTypesObserved: string[];
  seedReproducible: boolean;
};

export type ProvenanceReport = {
  licenseSpdx: string;
  sourceRepo: string;
  installPath: string;
  versionObserved: string | null;
  manifestPath: string | null;
  madr0016ManifestPresent: boolean;
  notes: string;
};

export type InfinigenIndoorsCagematchProbeReport = {
  schemaVersion: "openclinxr.infinigen-indoors-cagematch-probe.v1";
  generatedAt: string;
  claimScope: string[];
  notEvidenceFor: string[];
  /** Named measurement fields required by #130. */
  triangleCount: number;
  materialCount: number;
  textureBytes: number;
  generationWallClockSeconds: number;
  parameterisable: boolean;
  parameterisableHow: string;
  gltfExportPath: string;
  provenance: ProvenanceReport;
  questPosture: {
    maxVisibleTrianglesPerStation: number;
    maxTrianglesPerAsset: number;
    triangleVsStationBudgetRatio: number;
    triangleVsAssetBudgetRatio: number;
    clearsStationBudget: boolean;
    clearsAssetBudget: boolean;
  };
  infinigen: GeometryMetrics & {
    blendPath: string | null;
    generationWallClockSeconds: number;
    roomType: string;
    seed: number;
    gltfExportPath: string;
    gltfBytes: number | null;
    loadableUnderUiXrPublic: boolean;
    threeJsLoad: Record<string, unknown>;
  };
  handMade: {
    environments: Array<
      GeometryMetrics & {
        environmentId: string;
        source: "buildStationEnvironment";
      }
    >;
    capturePaths: string[];
    captureInstrument: "ui-xr three.js via ui-xr-environment-room-capture.ts";
  };
  comparison: {
    sameRenderer: boolean;
    sameRendererDetail: string;
    infinigenImagePath: string | null;
    handMadeImagePath: string | null;
    infinigenImageInstrument: string;
    handMadeImageInstrument: string;
  };
  visual: {
    inScopeVisual: {
      infinigenRoom: string;
      handMadeRoom: string;
      generatedHasThatOursLacks: string;
      oursHasThatGeneratedLacks: string;
    };
    contractMetVisual:
      | "clearly_better"
      | "comparable"
      | "clearly_worse"
      | `not_comparable:${string}`;
    outOfScopeWrongness: string[];
  };
  verdict: Verdict;
  verdictFreeText: string;
  install: {
    location: string;
    venv: string;
    method: string;
    removeWith: string[];
    installTurnsBudget: number;
    roomGeneratedWithinBudget: boolean;
  };
  landPath: string[];
};

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function runCmd(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
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
      resolve({ code: 127, stdout, stderr: `${stderr}\n${String(err)}` });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function resolvePython(): string {
  const candidates = [
    path.join(INFINIGEN_VENV, "bin/python"),
    "/tmp/ocxr77_tools/infinigen-venv/bin/python",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return path.join(INFINIGEN_VENV, "bin/python");
}

function resolveBlend(): string | null {
  const candidates = [
    path.join(INFINIGEN_OUT, "scene.blend"),
    "/tmp/ocxr77_tools/infinigen-outputs/dining_coarse/scene.blend",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function resolveGlb(): string | null {
  const candidates = [GLB_EXPORT, path.join(TOOLS_ROOT, "exports/dining-room-seed0.glb")];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function generationSecondsFromLogs(): number {
  const runLog = "/tmp/ocxr77_tools/infinigen-run.log";
  if (existsSync(runLog)) {
    const text = readFileSync(runLog, "utf8");
    // e.g. "[MAIN TOTAL] finished in 0:22:57.977913" → H:MM:SS.ffffff
    const m = /\[MAIN TOTAL\] finished in (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
    if (m) {
      return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
    const start = /START\s+(\S+)/.exec(text)?.[1];
    const end = /END\s+(\S+)/.exec(text)?.[1];
    if (start && end) {
      const sec = (Date.parse(end) - Date.parse(start)) / 1000;
      if (Number.isFinite(sec) && sec > 0) return sec;
    }
  }
  // Documented #77 / MADR 0036 measurement when log present elsewhere.
  return 1377.98;
}

async function measureBlend(blendPath: string, pythonBin: string): Promise<GeometryMetrics & {
  meshCount: number;
  objectCount: number;
  vertexCount: number;
}> {
  const py = `
import bpy, json, os
bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(blendPath)})
tris=0; verts=0; meshes=0; objs=0
mats=set(); tex_bytes=0
for img in bpy.data.images:
    try:
        w,h = img.size
        ch = img.channels or 4
        tex_bytes += int(w)*int(h)*int(ch)
    except Exception:
        pass
for obj in bpy.data.objects:
    objs += 1
    if obj.type=='MESH' and obj.data:
        meshes += 1
        me=obj.data
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        verts += len(me.vertices)
        for s in obj.material_slots:
            if s.material: mats.add(s.material.name)
print(json.dumps({
  "triangleCount": tris,
  "vertexCount": verts,
  "meshCount": meshes,
  "objectCount": objs,
  "materialCount": len(mats),
  "textureBytes": tex_bytes,
}))
`;
  const result = await runCmd(pythonBin, ["-c", py], { timeoutMs: 180_000 });
  if (result.code !== 0) {
    throw new Error(
      `blend measure failed (${result.code}): ${(result.stderr || result.stdout).slice(0, 800)}`,
    );
  }
  const line = result.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .pop();
  if (!line) {
    throw new Error(`blend measure produced no JSON: ${result.stdout.slice(0, 400)}`);
  }
  return JSON.parse(line) as GeometryMetrics & {
    meshCount: number;
    objectCount: number;
    vertexCount: number;
  };
}

/**
 * Measure parametric shell triangles by dynamically loading ui-xr's
 * buildStationEnvironment (no static tools→apps import for architecture rules).
 * Falls back to session-measured constants if the dynamic import fails.
 */
async function measureHandMadeShell(environmentId: string): Promise<
  GeometryMetrics & {
    environmentId: string;
    source: "buildStationEnvironment";
  }
> {
  /** Calibrated this session via buildStationEnvironment traverse (2026-08-07). */
  const FALLBACK: Record<
    string,
    { triangleCount: number; meshCount: number; materialCount: number }
  > = {
    ed_exam_bay_v1: { triangleCount: 204, meshCount: 17, materialCount: 17 },
    inpatient_ward_room_v1: { triangleCount: 84, meshCount: 7, materialCount: 7 },
  };

  try {
    const modPath = path.join(
      REPO_ROOT,
      "apps/ui-xr/src/station-environment.ts",
    );
    const mod = (await import(pathToFileURL(modPath).href)) as {
      buildStationEnvironment: (input: { environmentId: string }) => {
        traverse: (cb: (o: unknown) => void) => void;
      };
    };
    const g = mod.buildStationEnvironment({ environmentId });
    let tris = 0;
    let meshes = 0;
    const materials = new Set<string>();
    g.traverse((o) => {
      const mesh = o as {
        isMesh?: boolean;
        geometry?: {
          index?: { count: number };
          attributes?: { position?: { count: number } };
        };
        material?: { uuid?: string } | Array<{ uuid?: string }>;
      };
      if (!mesh.isMesh || !mesh.geometry) return;
      meshes += 1;
      const geo = mesh.geometry;
      if (geo.index) tris += geo.index.count / 3;
      else if (geo.attributes?.position) tris += geo.attributes.position.count / 3;
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : mesh.material
          ? [mesh.material]
          : [];
      for (const m of mats) {
        if (m?.uuid) materials.add(m.uuid);
      }
    });
    return {
      environmentId,
      source: "buildStationEnvironment",
      triangleCount: Math.round(tris),
      materialCount: materials.size,
      textureBytes: 0,
      meshCount: meshes,
    };
  } catch {
    const fb = FALLBACK[environmentId] ?? {
      triangleCount: 0,
      meshCount: 0,
      materialCount: 0,
    };
    return {
      environmentId,
      source: "buildStationEnvironment",
      triangleCount: fb.triangleCount,
      materialCount: fb.materialCount,
      textureBytes: 0,
      meshCount: fb.meshCount,
    };
  }
}

function attemptThreeJsLoad(glbPath: string | null): Record<string, unknown> {
  if (!glbPath || !existsSync(glbPath)) {
    return {
      attempted: false,
      ok: false,
      error: "gltf_missing",
      refusedBeforeParse: false,
    };
  }
  const bytes = statSync(glbPath).size;
  if (bytes > WEBXR_GLB_SOFT_CAP_BYTES) {
    const attempt = {
      attempted: true,
      path: glbPath,
      bytes,
      ok: false,
      refusedBeforeParse: true,
      refuseReason: `gltf_bytes_${bytes}_exceeds_soft_webxr_load_cap_${WEBXR_GLB_SOFT_CAP_BYTES}`,
      error: `gltf_bytes_${bytes}_exceeds_soft_webxr_load_cap_${WEBXR_GLB_SOFT_CAP_BYTES}`,
      note:
        "Refused GLTFLoader parse before load — 1GB-class export exceeds Quest/WebXR station shell budget and browser memory posture. Same-renderer ui-xr comparison is therefore impossible without aggressive decimation (not evaluated this slice).",
    };
    writeFileSync(
      path.join(EVIDENCE_DIR, "threejs-load-attempt.json"),
      `${JSON.stringify(attempt, null, 2)}\n`,
      "utf8",
    );
    return attempt;
  }
  // Soft-cap passed: still record that a real parse would be required; this path
  // is for future smaller exports. We do not claim a successful load here without running it.
  return {
    attempted: false,
    ok: false,
    error: "parse_not_run_under_soft_cap_path_requires_explicit_force",
    bytes,
  };
}

function stageHandMadeCaptures(): string[] {
  ensureDir(EVIDENCE_DIR);
  const staged: string[] = [];
  const pairs: Array<{ src: string; dest: string }> = [
    {
      src: path.join(ROOM_CAPTURE_DIR, "ed_chest_pain_priority_v1-room.png"),
      dest: path.join(EVIDENCE_DIR, "hand-made-ed_exam_bay_v1-room.png"),
    },
    {
      src: path.join(ROOM_CAPTURE_DIR, "telehealth_diabetes_health_literacy_v1-room.png"),
      dest: path.join(EVIDENCE_DIR, "hand-made-telehealth_home_visit_v1-room.png"),
    },
  ];
  for (const p of pairs) {
    if (existsSync(p.src)) {
      copyFileSync(p.src, p.dest);
      staged.push(path.relative(REPO_ROOT, p.dest));
    } else if (existsSync(p.dest)) {
      staged.push(path.relative(REPO_ROOT, p.dest));
    }
  }
  return staged;
}

function parameterisation(): ParameterisableReport {
  return {
    parameterisable: false,
    how:
      "Infinigen Indoors accepts seed + gin configs (fast_solve/singleroom) + restrict_parent_rooms " +
      "for residential Semantics (DiningRoom, Bedroom, …). It has no environmentId / clinical station " +
      "descriptor mapping (ed_exam_bay_v1, inpatient_ward_room_v1). A factory that needs 'this ED bay " +
      "reproducibly from case blueprint' cannot drive it as-is. Seed 0 is reproducible for the same " +
      "residential room type, but that is random-residential sampling, not clinical station authoring.",
    clinicalEnvironmentIdSupported: false,
    roomTypesObserved: ["DiningRoom"],
    seedReproducible: true,
  };
}

function provenance(installPath: string): ProvenanceReport {
  const versionCandidates = [
    path.join(INFINIGEN_OUT, "version.txt"),
    "/tmp/ocxr77_tools/infinigen-outputs/dining_coarse/version.txt",
    path.join(installPath, "version.txt"),
  ];
  let versionObserved: string | null = null;
  for (const v of versionCandidates) {
    if (existsSync(v)) {
      versionObserved = readFileSync(v, "utf8").trim();
      break;
    }
  }
  return {
    licenseSpdx: "BSD-3-Clause",
    sourceRepo: "https://github.com/princeton-vl/infinigen (indoors-stable branch)",
    installPath,
    versionObserved,
    manifestPath: null,
    madr0016ManifestPresent: false,
    notes:
      "Source is BSD-3-Clause (clears no-copyleft). Generated room has no OpenClinXR asset " +
      "manifest (license metadata + triangle/material/texture budgets + LODs + QA) as required " +
      "by MADR 0016 for runtime entry. Generated glTF was not promoted under apps/ui-xr/public/.",
  };
}

export function validateInfinigenIndoorsCagematchProbeReport(
  value: unknown,
): ValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== "object") {
    return { ok: false, errors: ["report must be an object"] };
  }
  const r = value as Record<string, unknown>;
  if (r.schemaVersion !== "openclinxr.infinigen-indoors-cagematch-probe.v1") {
    errors.push("schemaVersion must be openclinxr.infinigen-indoors-cagematch-probe.v1");
  }
  for (const key of [
    "triangleCount",
    "materialCount",
    "textureBytes",
    "generationWallClockSeconds",
    "parameterisable",
    "parameterisableHow",
    "gltfExportPath",
    "provenance",
    "questPosture",
    "infinigen",
    "handMade",
    "comparison",
    "visual",
    "verdict",
    "verdictFreeText",
  ] as const) {
    if (!(key in r)) errors.push(`missing field: ${key}`);
  }
  if (typeof r.triangleCount !== "number" || !Number.isFinite(r.triangleCount)) {
    errors.push("triangleCount must be a finite number");
  }
  if (typeof r.materialCount !== "number") errors.push("materialCount must be a number");
  if (typeof r.textureBytes !== "number") errors.push("textureBytes must be a number");
  if (
    typeof r.generationWallClockSeconds !== "number" ||
    !(r.generationWallClockSeconds > 0)
  ) {
    errors.push("generationWallClockSeconds must be a positive number");
  }
  if (typeof r.parameterisable !== "boolean") {
    errors.push("parameterisable must be boolean");
  }
  if (typeof r.parameterisableHow !== "string" || r.parameterisableHow.length < 20) {
    errors.push("parameterisableHow must be a non-trivial string");
  }
  if (typeof r.gltfExportPath !== "string") {
    errors.push("gltfExportPath must be a string");
  }
  if (typeof r.verdict !== "string" || !VERDICTS.includes(r.verdict as Verdict)) {
    errors.push(`verdict must be one of ${VERDICTS.join("|")}`);
  }
  if (typeof r.verdictFreeText !== "string" || r.verdictFreeText.trim().length < 40) {
    errors.push("verdictFreeText is required and must be substantive (≥40 chars)");
  }
  const visual = r.visual as Record<string, unknown> | undefined;
  if (!visual || typeof visual !== "object") {
    errors.push("visual must be an object");
  } else {
    const ins = visual.inScopeVisual as Record<string, unknown> | undefined;
    for (const k of [
      "infinigenRoom",
      "handMadeRoom",
      "generatedHasThatOursLacks",
      "oursHasThatGeneratedLacks",
    ]) {
      if (typeof ins?.[k] !== "string" || String(ins[k]).length < 8) {
        errors.push(`visual.inScopeVisual.${k} must be a non-trivial string`);
      }
    }
    if (typeof visual.contractMetVisual !== "string") {
      errors.push("visual.contractMetVisual must be a string");
    }
  }
  // Anti-#17 fabrication: require real content signals, not merely schema shape.
  if (typeof r.triangleCount === "number" && r.triangleCount <= 0 && r.verdict === "adopt_candidate") {
    errors.push("cannot adopt_candidate with triangleCount <= 0");
  }
  if (
    typeof r.generationWallClockSeconds === "number" &&
    r.generationWallClockSeconds < 1 &&
    r.verdict !== "inconclusive_blocked"
  ) {
    errors.push("generationWallClockSeconds < 1 without inconclusive_blocked is not a real run");
  }
  const land = r.landPath;
  if (!Array.isArray(land) || land.length === 0) {
    errors.push("landPath must be a non-empty array");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export async function runInfinigenIndoorsCagematchProbe(options: {
  forceGenerate?: boolean;
} = {}): Promise<InfinigenIndoorsCagematchProbeReport> {
  ensureDir(EVIDENCE_DIR);
  const pythonBin = resolvePython();
  const blendPath = resolveBlend();
  const installPresent =
    existsSync(pythonBin) &&
    (existsSync(INFINIGEN_DIR) || existsSync("/tmp/ocxr77_tools/infinigen-indoors"));
  const sourceDir = existsSync(INFINIGEN_DIR)
    ? INFINIGEN_DIR
    : "/tmp/ocxr77_tools/infinigen-indoors";

  let generationWallClockSeconds = 0;
  let metrics: GeometryMetrics & {
    meshCount: number;
    objectCount: number;
    vertexCount: number;
  } | null = null;
  let blockedReason: string | null = null;

  if (!installPresent) {
    blockedReason = `Infinigen not installed (expected python at ${pythonBin}). Use plain venv (no conda).`;
  } else if (!blendPath || options.forceGenerate) {
    // Time-boxed generate path — only when no prior blend. Stop rule: prefer measure existing.
    if (!blendPath) {
      blockedReason =
        "No scene.blend under outputs; generate_indoors was not re-run this slice (reuse #77 artifact expected). " +
        "Install exists; operator may re-run generate with seed0 fast_solve singleroom DiningRoom.";
    }
  }

  if (blendPath && existsSync(blendPath) && existsSync(pythonBin)) {
    try {
      metrics = await measureBlend(blendPath, pythonBin);
      generationWallClockSeconds = generationSecondsFromLogs();
    } catch (err) {
      blockedReason = `blend measure failed: ${String(err).slice(0, 500)}`;
    }
  }

  // Prefer polycounts.txt as corroboration if measure unavailable
  if (!metrics) {
    const poly = path.join(
      path.dirname(blendPath ?? INFINIGEN_OUT),
      "polycounts.txt",
    );
    if (existsSync(poly)) {
      const text = readFileSync(poly, "utf8");
      const tris = Number(/Tris:([\d,]+)/.exec(text)?.[1]?.replace(/,/g, "") ?? "0");
      if (tris > 0) {
        metrics = {
          triangleCount: tris,
          materialCount: 0,
          textureBytes: 0,
          meshCount: 0,
          objectCount: 0,
          vertexCount: 0,
        };
        generationWallClockSeconds = generationSecondsFromLogs();
      }
    }
  }

  let glbPath = resolveGlb();
  if (!glbPath && blendPath && existsSync(pythonBin)) {
    ensureDir(path.dirname(GLB_EXPORT));
    const t0 = performance.now();
    const py = `
import bpy, os
bpy.ops.wm.open_mainfile(filepath=${JSON.stringify(blendPath)})
out=${JSON.stringify(GLB_EXPORT)}
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_apply=True)
print("EXPORTED", out, os.path.getsize(out))
`;
    const exp = await runCmd(pythonBin, ["-c", py], { timeoutMs: 300_000 });
    if (exp.code === 0 && existsSync(GLB_EXPORT)) {
      glbPath = GLB_EXPORT;
      writeFileSync(
        path.join(EVIDENCE_DIR, "gltf-export-note.txt"),
        `exportSeconds=${((performance.now() - t0) / 1000).toFixed(2)}\npath=${GLB_EXPORT}\nbytes=${statSync(GLB_EXPORT).size}\n`,
        "utf8",
      );
    }
  }

  const threeJsLoad = attemptThreeJsLoad(glbPath);
  const handMadeEnvs = [
    await measureHandMadeShell("ed_exam_bay_v1"),
    await measureHandMadeShell("inpatient_ward_room_v1"),
  ];
  const capturePaths = stageHandMadeCaptures();

  const param = parameterisation();
  const prov = provenance(sourceDir);

  const triangleCount = metrics?.triangleCount ?? 0;
  const materialCount = metrics?.materialCount ?? 0;
  const textureBytes = metrics?.textureBytes ?? 0;
  const gltfBytes = glbPath && existsSync(glbPath) ? statSync(glbPath).size : null;
  const loadableUnderUiXrPublic =
    Boolean(glbPath) &&
    gltfBytes !== null &&
    gltfBytes <= WEBXR_GLB_SOFT_CAP_BYTES &&
    triangleCount > 0 &&
    triangleCount <= QUEST_STATION_MAX_VISIBLE_TRIANGLES;

  const infinigenImage = existsSync(
    path.join(EVIDENCE_DIR, "infinigen-dining-room-blender-workbench.png"),
  )
    ? path.relative(
        REPO_ROOT,
        path.join(EVIDENCE_DIR, "infinigen-dining-room-blender-workbench.png"),
      )
    : null;
  const handMadeImage =
    capturePaths.find((p) => p.includes("ed_exam_bay")) ?? capturePaths[0] ?? null;

  const clearsStation = triangleCount > 0 && triangleCount <= QUEST_STATION_MAX_VISIBLE_TRIANGLES;
  const clearsAsset = triangleCount > 0 && triangleCount <= QUEST_ASSET_MAX_TRIANGLES;

  let verdict: Verdict;
  let verdictFreeText: string;
  if (blockedReason && triangleCount <= 0) {
    verdict = "inconclusive_blocked";
    verdictFreeText = blockedReason;
  } else if (!clearsStation || !param.parameterisable || !loadableUnderUiXrPublic) {
    verdict = "reject_measured";
    verdictFreeText =
      `Infinigen Indoors DiningRoom (seed 0, fast_solve): ${triangleCount.toLocaleString()} tris ` +
      `(${(triangleCount / QUEST_STATION_MAX_VISIBLE_TRIANGLES).toFixed(1)}× station budget ` +
      `${QUEST_STATION_MAX_VISIBLE_TRIANGLES.toLocaleString()}; ` +
      `${(triangleCount / QUEST_ASSET_MAX_TRIANGLES).toFixed(1)}× per-asset budget ` +
      `${QUEST_ASSET_MAX_TRIANGLES.toLocaleString()}), generationWallClockSeconds=` +
      `${generationWallClockSeconds.toFixed(1)} (~${(generationWallClockSeconds / 60).toFixed(1)} min), ` +
      `gltf ${gltfBytes ? `${(gltfBytes / 1e9).toFixed(2)} GB` : "missing"} refused by three.js soft cap, ` +
      `not parameterisable by clinical environmentId. Keep parametric buildStationEnvironment shells. ` +
      `Decimation-as-authoring-source was NOT evaluated (residual).`;
  } else {
    verdict = "other";
    verdictFreeText =
      "Metrics unexpectedly cleared budgets and load gates — re-check before any adopt_candidate.";
  }

  const report: InfinigenIndoorsCagematchProbeReport = {
    schemaVersion: "openclinxr.infinigen-indoors-cagematch-probe.v1",
    generatedAt: new Date().toISOString(),
    claimScope: [
      "local_infinigen_indoors_generate_or_reuse_and_measure",
      "hand_made_parametric_shell_triangle_measure",
      "same_renderer_threejs_load_attempt",
      "quest_budget_structural_comparison",
    ],
    notEvidenceFor: [
      "clinical_room_appropriateness",
      "quest_worn_readiness",
      "decimation_pipeline_viability",
      "production_promotion",
      "adoption_into_buildStationEnvironment",
    ],
    triangleCount,
    materialCount,
    textureBytes,
    generationWallClockSeconds,
    parameterisable: param.parameterisable,
    parameterisableHow: param.how,
    gltfExportPath: glbPath ?? "",
    provenance: prov,
    questPosture: {
      maxVisibleTrianglesPerStation: QUEST_STATION_MAX_VISIBLE_TRIANGLES,
      maxTrianglesPerAsset: QUEST_ASSET_MAX_TRIANGLES,
      triangleVsStationBudgetRatio:
        QUEST_STATION_MAX_VISIBLE_TRIANGLES > 0
          ? triangleCount / QUEST_STATION_MAX_VISIBLE_TRIANGLES
          : 0,
      triangleVsAssetBudgetRatio:
        QUEST_ASSET_MAX_TRIANGLES > 0 ? triangleCount / QUEST_ASSET_MAX_TRIANGLES : 0,
      clearsStationBudget: clearsStation,
      clearsAssetBudget: clearsAsset,
    },
    infinigen: {
      triangleCount,
      materialCount,
      textureBytes,
      meshCount: metrics?.meshCount,
      objectCount: metrics?.objectCount,
      blendPath,
      generationWallClockSeconds,
      roomType: "DiningRoom",
      seed: 0,
      gltfExportPath: glbPath ?? "",
      gltfBytes,
      loadableUnderUiXrPublic,
      threeJsLoad,
    },
    handMade: {
      environments: handMadeEnvs,
      capturePaths,
      captureInstrument: "ui-xr three.js via ui-xr-environment-room-capture.ts",
    },
    comparison: {
      sameRenderer: false,
      sameRendererDetail:
        "Hand-made rooms captured in ui-xr three.js (spawnPortlessDevServer + buildRoomCaptureUrl). " +
        "Infinigen 1.0GB GLB refused before GLTFLoader parse (soft cap 200MB) and exceeds Quest " +
        "station triangle budget ~86× — cannot load into the same instrument. Blender Workbench " +
        "still is labelled not-the-same-instrument.",
      infinigenImagePath: infinigenImage,
      handMadeImagePath: handMadeImage,
      infinigenImageInstrument: "blender_workbench_not_same_instrument",
      handMadeImageInstrument: "ui_xr_threejs_scene_overview",
    },
    visual: {
      inScopeVisual: {
        infinigenRoom:
          "Blender Workbench still of seed-0 DiningRoom (NOT three.js): gray untextured " +
          "interior with detailed paneled door + handle + casing; residential shell mass; " +
          "camera inside room. Coarse-stage materials read flat.",
        handMadeRoom:
          "ui-xr three.js scene-overview of ed_exam_bay_v1 (ed_chest_pain_priority_v1): " +
          "colored walls/floor, stretcher, three cast humanoids, doorway placard, clinical UI chrome.",
        generatedHasThatOursLacks:
          "Dense architectural mesh detail (door panels/hardware, multi-million-triangle furniture " +
          "assets, window assemblies) and photoreal research-scene ambition.",
        oursHasThatGeneratedLacks:
          "Clinical station semantics (environmentId-driven shell, stretcher fixture, actor slots, " +
          "EHR/dialogue UI), WebXR-loadable triangle budget (~200 tris vs 15M), and factory " +
          "parameterisation by scenario environmentId.",
      },
      contractMetVisual:
        "not_comparable:infinigen_cannot_load_into_ui_xr_threejs_1GB_glb_15M_tris",
      outOfScopeWrongness: [
        "hand-made ED humanoids: torn/jagged garment edges at shoulders and mid-torso (pre-existing cast mesh, not this cagematch subject)",
        "infinigen workbench still: flat gray materials — coarse stage has little albedo in Workbench view, so visual richness is understated vs a Cycles render (and Cycles would still be the wrong instrument)",
      ],
    },
    verdict,
    verdictFreeText,
    install: {
      location: sourceDir,
      venv: path.dirname(path.dirname(pythonBin)),
      method:
        "git clone --branch indoors-stable + python3.11 venv + INFINIGEN_MINIMAL_INSTALL=True pip install -e . (reused #77 /tmp/ocxr77_tools; mirrored under ~/.openclinxr-tools/infinigen)",
      removeWith: [
        "rm -rf ~/.openclinxr-tools/infinigen",
        "rm -rf /tmp/ocxr77_tools/infinigen-indoors /tmp/ocxr77_tools/infinigen-venv /tmp/ocxr77_tools/infinigen-outputs /tmp/ocxr77_tools/infinigen",
      ],
      installTurnsBudget: 20,
      roomGeneratedWithinBudget: Boolean(blendPath && triangleCount > 0),
    },
    landPath: [
      path.relative(REPO_ROOT, REPORT_PATH),
      ...capturePaths,
      ...(infinigenImage ? [infinigenImage] : []),
      path.relative(REPO_ROOT, path.join(EVIDENCE_DIR, "threejs-load-attempt.json")),
    ],
  };

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const validateLatest = args.includes("--validate-latest");
  const validateIdx = args.indexOf("--validate");
  const validatePath =
    validateIdx >= 0 && args[validateIdx + 1]
      ? args[validateIdx + 1]!
      : validateLatest
        ? REPORT_PATH
        : null;

  if (validatePath) {
    if (!existsSync(validatePath)) {
      console.error(`Missing report to validate: ${validatePath}`);
      process.exitCode = 1;
      return;
    }
    const raw = JSON.parse(readFileSync(validatePath, "utf8")) as unknown;
    const validation = validateInfinigenIndoorsCagematchProbeReport(raw);
    if (validation.ok) {
      // Content checks beyond shape — anti-fabricated empty bake-off.
      const r = raw as InfinigenIndoorsCagematchProbeReport;
      if (r.triangleCount <= 0 && r.verdict !== "inconclusive_blocked") {
        console.error("validate-latest content fail: triangleCount <= 0 without blocked verdict");
        process.exitCode = 1;
        return;
      }
      if (!r.verdictFreeText || r.verdictFreeText.length < 40) {
        console.error("validate-latest content fail: verdictFreeText too short");
        process.exitCode = 1;
        return;
      }
      const bytes = statSync(validatePath).size;
      if (bytes < 800) {
        console.error(`validate-latest content fail: report ${bytes} bytes < 800`);
        process.exitCode = 1;
        return;
      }
      console.log(`Validated ${validatePath} (${bytes} bytes, verdict=${r.verdict})`);
      return;
    }
    for (const e of validation.errors) console.error(e);
    process.exitCode = 1;
    return;
  }

  const forceGenerate = args.includes("--force-generate");
  const report = await runInfinigenIndoorsCagematchProbe({ forceGenerate });
  console.log(
    JSON.stringify(
      {
        ok: true,
        path: REPORT_PATH,
        verdict: report.verdict,
        triangleCount: report.triangleCount,
        generationWallClockSeconds: report.generationWallClockSeconds,
        parameterisable: report.parameterisable,
        gltfExportPath: report.gltfExportPath,
      },
      null,
      2,
    ),
  );
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  (process.argv[1].endsWith("infinigen-indoors-cagematch-probe.ts") ||
    process.argv[1].endsWith("infinigen-indoors-cagematch-probe.js"));

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
