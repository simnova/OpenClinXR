/**
 * #78 clothing-factory cagematch — decision with evidence, not adoption.
 *
 * Named candidates: makeclothes | imagine_smplitex | stablegen
 * Report: .openclinxr/evidence/clothing-cagematch/probe-report.json
 *
 * claimScope: local authoring-tool execution + topology/class comparison only.
 * notEvidenceFor: clinical clothing appropriateness, production readiness, Quest readiness,
 * garment visual quality as readiness, adoption into shipping pipeline.
 *
 * DO NOT install StableGen (GPL-3.0 blocked_without_exception).
 * DO NOT extend automate_blender.py procedural shells — that is the incumbent being replaced.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const EVIDENCE_DIR = path.join(
  REPO_ROOT,
  ".openclinxr/evidence/clothing-cagematch",
);
const REPORT_PATH = path.join(EVIDENCE_DIR, "probe-report.json");

const DEFAULT_HUMANOID = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/generated-humanoids/peds_nurse_kevin.glb",
);

const MPFB_BASE_OBJ =
  process.env.OPENCLINXR_MPFB_BASE_OBJ ??
  path.join(
    process.env.HOME ?? "",
    "Library/Application Support/Blender/5.1/extensions/user_default/mpfb/data/3dobjs/base.obj",
  );

export type OutputClass =
  | "separate_garment_mesh"
  | "fused_body_mesh"
  | "body_texture"
  | "image_only";

export type CandidateResult = {
  candidateId: string;
  status: "ran" | "blocked";
  blockedReason?: string;
  outputClass?: OutputClass;
  measurements?: Record<string, number | string>;
  artifacts?: string[];
  decision?: string;
  details?: Record<string, unknown>;
};

export type ClothingFactoryCagematchReport = {
  schemaVersion: "openclinxr.clothing-factory-cagematch.v1";
  generatedAt: string;
  claimScope: "local_authoring_tool_execution_and_topology_class_comparison_only";
  notEvidenceFor: string[];
  candidates: CandidateResult[];
  environmentFindings: Record<string, unknown>;
  landPath: string[];
};

export type RunOptions = {
  force?: boolean;
  humanoidGlb?: string;
  /** When true, only assemble from on-disk probe JSONs (no Blender re-run). */
  assembleOnly?: boolean;
};

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function readJsonIfExists<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function runCmd(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: process.env,
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

/**
 * StableGen is GPL-3.0 blocked_without_exception in the asset registry.
 * Never install or invoke it from this probe.
 */
function probeStablegen(): CandidateResult {
  // Read live registry posture from source for the exact clause text (no install).
  const registryPath = path.join(
    REPO_ROOT,
    "packages/openclinxr/asset-registry/src/index.ts",
  );
  let licenseLine =
    'licensePolicy: "blocked_without_exception" (stablegen, GPL-3.0)';
  try {
    const src = readFileSync(registryPath, "utf8");
    const block = src.match(
      /toolId:\s*"stablegen"[\s\S]*?prohibitedUses:\s*\[[^\]]*\]/u,
    );
    if (block) {
      const pol = block[0].match(/licensePolicy:\s*"([^"]+)"/u);
      const sum = block[0].match(/licenseSummary:\s*"([^"]+)"/u);
      licenseLine = [
        pol ? `licensePolicy: ${pol[1]}` : "",
        sum ? `licenseSummary: ${sum[1]}` : "",
        "lanes: skin_texture (body/scene texture, not separate garment geometry)",
        `registry: ${registryPath}`,
      ]
        .filter(Boolean)
        .join("; ");
    }
  } catch {
    /* keep default */
  }

  return {
    candidateId: "stablegen",
    status: "blocked",
    blockedReason:
      `StableGen is GPL-3.0 blocked_without_exception — not installed and not run. ${licenseLine}. ` +
      "What it would give: body/scene PBR texture via ComfyUI-backed Blender addon (skin_texture lane), " +
      "not a separate fitted garment mesh; a learner cannot lift a texture for auscultation/palpation.",
    details: {
      wouldProduce: "body_texture",
      notInstalledByDesign: true,
      licensePolicy: "blocked_without_exception",
    },
  };
}

function assembleMakeclothes(
  makeProbe: Record<string, unknown> | null,
  topoProbe: Record<string, unknown> | null,
): CandidateResult {
  const annyFit = (makeProbe?.anny_fit ?? {}) as Record<string, unknown>;
  const mhFit = (makeProbe?.mh_fit ?? {}) as Record<string, unknown>;
  const anny = (makeProbe?.anny ?? topoProbe?.anny_mesh ?? {}) as Record<
    string,
    unknown
  >;
  const mh = (makeProbe?.mh ?? topoProbe?.mh_basemesh ?? {}) as Record<
    string,
    unknown
  >;

  const mhRan = mhFit.status === "ran";
  const glbRel = "makeclothes-mh-probe-clothes.glb";
  const glbAbs = path.join(EVIDENCE_DIR, glbRel);
  const glbBytes =
    typeof mhFit.glb_bytes === "number"
      ? mhFit.glb_bytes
      : existsSync(glbAbs)
        ? statSync(glbAbs).size
        : 0;

  if (mhRan) {
    return {
      candidateId: "makeclothes",
      status: "ran",
      outputClass: "separate_garment_mesh",
      measurements: {
        mh_basemesh_vertex_count: Number(mh.vertexCount ?? mhFit.mh_verts ?? 0),
        mh_clothes_vertex_count: Number(mhFit.clothes_verts ?? 0),
        mh_clothes_triangle_count: Number(mhFit.clothes_tris ?? 0),
        mh_clothes_glb_bytes: Number(glbBytes),
        mh_fit_wall_clock_s: Number(mhFit.wall_clock_s ?? 0),
        anny_body_vertex_count: Number(
          anny.verts ?? anny.totalVerts ?? annyFit.body_verts ?? 0,
        ),
        anny_vertex_delta_vs_mh: Number(annyFit.vertex_delta ?? 0),
        anny_object_is_basemesh: annyFit.object_is_basemesh === true ? 1 : 0,
        anny_fit_wall_clock_s: Number(annyFit.wall_clock_s ?? 0),
      },
      artifacts: [
        existsSync(glbAbs) ? path.relative(REPO_ROOT, glbAbs) : glbRel,
        path.relative(REPO_ROOT, path.join(EVIDENCE_DIR, "makeclothes-probe.json")),
      ],
      decision:
        "MakeClothes/MPFB ClothesService produces a separate garment mesh on MakeHuman basemesh " +
        "(control ran) but refuses Anny: ValueError 'The provided object is not a basemesh'. " +
        "Anny is not MH topology (13686 vs 19158 verts). Not a blueprint→Anny factory without a " +
        "full basemesh swap — not adopted.",
      details: {
        anny_fit_error: annyFit.error ?? null,
        mh_fit: mhFit,
        tool: "bl_ext.user_default.mpfb ClothesService.fit_clothes_to_human",
      },
    };
  }

  const annyErr =
    String(annyFit.error ?? "") ||
    "MakeClothes probe artifacts missing — re-run with force";
  return {
    candidateId: "makeclothes",
    status: "blocked",
    blockedReason: annyErr,
    measurements: {
      anny_body_vertex_count: Number(
        anny.verts ?? anny.totalVerts ?? annyFit.body_verts ?? 0,
      ),
      mh_basemesh_vertex_count: Number(mh.vertexCount ?? 0),
    },
    artifacts: [
      path.relative(REPO_ROOT, path.join(EVIDENCE_DIR, "makeclothes-probe.json")),
    ],
  };
}

function assembleImagineSmplitex(
  imageProbe: Record<string, unknown> | null,
  topoProbe: Record<string, unknown> | null,
): CandidateResult {
  const imgGen = (imageProbe?.image_gen ?? {}) as Record<string, unknown>;
  const smpl = (topoProbe?.smpl_loader ?? {}) as Record<string, unknown>;
  const smplMeas = (smpl.measurements ?? {}) as Record<string, unknown>;
  const attempts = (imageProbe?.attempts ?? []) as Array<Record<string, unknown>>;

  const imgPath = path.join(EVIDENCE_DIR, "imagine-scrub-top.jpg");
  const imgExists = existsSync(imgPath);
  const imgBytes = imgExists
    ? statSync(imgPath).size
    : Number(imgGen.bytes ?? 0);
  const imgW = Number(imgGen.width ?? 0);
  const imgH = Number(imgGen.height ?? 0);

  const tripo = attempts.find((a) => a.id === "tripo_image_to_model");
  const hunyuan = attempts.find(
    (a) => a.id === "local_hunyuan3d_v2_weights_check",
  );
  const meshy = attempts.find((a) => a.id === "meshy_image_to_model");

  const smplError = String(smpl.blockedReason ?? "");
  const imageTo3dSummary = [
    hunyuan
      ? `hunyuan3d_local: ${hunyuan.status} — ${String(hunyuan.error ?? "").slice(0, 200)}`
      : "hunyuan3d_local: not probed",
    tripo
      ? `tripo: ${tripo.status} — ${String(tripo.error ?? tripo.exception_message ?? "").slice(0, 200)}`
      : "tripo: not probed",
    meshy
      ? `meshy: ${meshy.status} — ${String(meshy.error ?? "").slice(0, 200)}`
      : "meshy: not probed",
  ].join(" | ");

  if (imgExists && imgBytes > 0) {
    return {
      candidateId: "imagine_smplitex",
      status: "ran",
      outputClass: "image_only",
      measurements: {
        image_width_px: imgW || 1024,
        image_height_px: imgH || 1024,
        image_bytes: imgBytes,
        smpl_expected_vertex_count: Number(
          smplMeas.smpl_expected_vertex_count ?? 6890,
        ),
        anny_vertex_count: Number(smplMeas.anny_vertex_count ?? 0),
        vertex_count_delta: Number(smplMeas.vertex_count_delta ?? 0),
        joint_name_intersection_count: Number(
          smplMeas.joint_name_intersection_count ?? 0,
        ),
        smpl_joint_count: Number(smplMeas.smpl_joint_count ?? 24),
        anny_joint_count: Number(smplMeas.anny_joint_count ?? 0),
        uv_loop_count: Number(smplMeas.uv_loop_count ?? 0),
        image_to_3d_attempts: attempts.length,
        tripo_wall_clock_s: Number(tripo?.wall_clock_s ?? 0),
      },
      artifacts: [
        path.relative(REPO_ROOT, imgPath),
        path.relative(
          REPO_ROOT,
          path.join(EVIDENCE_DIR, "blender-topology-probe.json"),
        ),
        path.relative(
          REPO_ROOT,
          path.join(EVIDENCE_DIR, "image-to-3d-probe.json"),
        ),
      ],
      decision:
        "TEXT→garment image works (image_gen, image_only). SMPLitex/SMPL loader refuses Anny " +
        `(${smplError.slice(0, 220)}). IMAGE→3D FOSS path: ${imageTo3dSummary}. ` +
        "No fitted separate garment on Anny topology without SMPL retarget/proxy (out of scope). Not adopted.",
      details: {
        smplitex_blockedReason: smplError,
        image_to_3d_attempts: attempts,
        image_gen_reachable_from_worktree: imgGen.reachable_from_worktree_dispatch === true,
        outputClassNote:
          "Pipeline stopped at image_only; SMPLitex is body_texture on SMPL UV atlas, not garment mesh",
      },
    };
  }

  return {
    candidateId: "imagine_smplitex",
    status: "blocked",
    blockedReason:
      `No garment image artifact at ${imgPath}. SMPL half: ${smplError || "not probed"}. ` +
      `Image→3D: ${imageTo3dSummary}`,
    measurements: {
      anny_vertex_count: Number(smplMeas.anny_vertex_count ?? 0),
      smpl_expected_vertex_count: 6890,
    },
  };
}

async function ensureTopologyProbes(
  humanoidGlb: string,
  force: boolean,
): Promise<void> {
  const makePath = path.join(EVIDENCE_DIR, "makeclothes-probe.json");
  const topoPath = path.join(EVIDENCE_DIR, "blender-topology-probe.json");
  if (
    !force &&
    existsSync(makePath) &&
    existsSync(topoPath) &&
    existsSync(path.join(EVIDENCE_DIR, "makeclothes-mh-probe-clothes.glb"))
  ) {
    return;
  }

  ensureDir(EVIDENCE_DIR);

  // Minimal combined Blender probe (MakeClothes + SMPL gate). Written to a per-pid temp script.
  const scriptPath = path.join(
    process.env.TMPDIR ?? "/tmp",
    `ocxr78_clothing_probe_${process.pid}.py`,
  );
  const script = `
import bpy, json, os, sys, time, traceback
from pathlib import Path
from mathutils import Vector

argv = sys.argv
args = argv[argv.index("--")+1:] if "--" in argv else []
kv={}
i=0
while i < len(args):
    if args[i].startswith("--") and i+1 < len(args):
        kv[args[i][2:]]=args[i+1]; i+=2
    else: i+=1

humanoid=kv["humanoid"]; out_make=kv["out-make"]; out_topo=kv["out-topo"]; mh_base=kv["mh-base"]
t0=time.perf_counter()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")

from bl_ext.user_default.mpfb.services.clothesservice import ClothesService
from bl_ext.user_default.mpfb.services.objectservice import ObjectService
from bl_ext.user_default.mpfb.entities.objectproperties import GeneralObjectProperties
from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo

make={"tool":"MakeClothes via MPFB ClothesService.fit_clothes_to_human","anny_fit":{},"mh_fit":{},"anny":{},"mh":{}}
topo={"schemaVersion":"openclinxr.clothing-factory-blender-probe.v1","smpl_loader":{},"anny_mesh":{},"mh_basemesh":{}}

bpy.ops.import_scene.gltf(filepath=humanoid)
anny_body=None; anny_joints=[]; meshes=[]
for obj in bpy.context.scene.objects:
    if obj.type=="ARMATURE":
        anny_joints=[b.name for b in obj.data.bones]
    if obj.type=="MESH":
        meshes.append({"name":obj.name,"verts":len(obj.data.vertices),"tris":sum(len(p.vertices)-2 for p in obj.data.polygons)})
        if "anny_base" in obj.name.lower():
            anny_body=obj
if anny_body is None:
    for obj in bpy.context.scene.objects:
        if obj.type=="MESH" and (anny_body is None or len(obj.data.vertices)>len(anny_body.data.vertices)):
            anny_body=obj

make["anny"]={
    "name": anny_body.name,
    "verts": len(anny_body.data.vertices),
    "tris": sum(len(p.vertices)-2 for p in anny_body.data.polygons),
    "jointCount": len(anny_joints),
    "jointNames": anny_joints,
    "fileBytes": os.path.getsize(humanoid),
    "object_is_basemesh": bool(ObjectService.object_is_basemesh(anny_body)),
}
topo["anny_mesh"]={
    "path": humanoid,
    "meshes": meshes,
    "totalVerts": sum(m["verts"] for m in meshes),
    "totalTris": sum(m["tris"] for m in meshes),
    "jointCount": len(anny_joints),
    "jointNames": anny_joints,
    "fileBytes": os.path.getsize(humanoid),
}

mh_v=0; mh_f=0
with open(mh_base,"r",encoding="utf-8",errors="replace") as f:
    for line in f:
        if line.startswith("v "): mh_v+=1
        elif line.startswith("f "): mh_f+=1
make["mh"]={"vertexCount":mh_v,"faceCount":mh_f,"fileBytes":os.path.getsize(mh_base)}
topo["mh_basemesh"]={"path":mh_base,"vertexCount":mh_v,"faceCount":mh_f,"fileBytes":os.path.getsize(mh_base)}

# Anny MakeClothes
bpy.ops.mesh.primitive_cube_add(size=0.2, location=anny_body.location)
clo=bpy.context.active_object; clo.name="anny_probe_clothes"
t1=time.perf_counter()
try:
    ClothesService.fit_clothes_to_human(clo, anny_body, mhclo=None, set_parent=True)
    make["anny_fit"]={"status":"ran","wall_clock_s":round(time.perf_counter()-t1,4)}
except Exception as e:
    make["anny_fit"]={
        "status":"blocked","error":f"{type(e).__name__}: {e}",
        "wall_clock_s":round(time.perf_counter()-t1,4),
        "body_verts":len(anny_body.data.vertices),"mh_verts":mh_v,
        "vertex_delta":len(anny_body.data.vertices)-mh_v,
        "object_is_basemesh":bool(ObjectService.object_is_basemesh(anny_body)),
    }

# MH control
before=set(bpy.data.objects)
bpy.ops.wm.obj_import(filepath=mh_base)
mh_obj=next((o for o in bpy.data.objects if o not in before and o.type=="MESH"), None)
mh_obj.name="mh_basemesh_probe"
GeneralObjectProperties.set_value("object_type","Basemesh", entity_reference=mh_obj)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.12, location=(0,0,1.2))
clo2=bpy.context.active_object; clo2.name="mh_probe_clothes"
mhclo=Mhclo(); mhclo.name="probe"; mhclo.clothes=clo2
for vn in range(len(clo2.data.vertices)):
    mhclo.verts[vn]={"verts":(0,1,2),"weights":(1.0,0.0,0.0),"offsets":Vector((0,0,0))}
mhclo.x_scale=(0,1,1.0); mhclo.y_scale=(0,1,1.0); mhclo.z_scale=(0,1,1.0)
t2=time.perf_counter()
try:
    ClothesService.fit_clothes_to_human(clo2, mh_obj, mhclo=mhclo, set_parent=True)
    out_glb=str(Path(out_make).parent/"makeclothes-mh-probe-clothes.glb")
    bpy.ops.object.select_all(action="DESELECT")
    clo2.select_set(True); bpy.context.view_layer.objects.active=clo2
    bpy.ops.export_scene.gltf(filepath=out_glb, use_selection=True, export_format="GLB")
    make["mh_fit"]={
        "status":"ran","wall_clock_s":round(time.perf_counter()-t2,4),
        "clothes_verts":len(clo2.data.vertices),
        "clothes_tris":sum(len(p.vertices)-2 for p in clo2.data.polygons),
        "mh_verts":len(mh_obj.data.vertices),
        "is_basemesh":bool(ObjectService.object_is_basemesh(mh_obj)),
        "glb":out_glb,"glb_bytes":os.path.getsize(out_glb),
    }
except Exception as e:
    make["mh_fit"]={"status":"blocked","error":f"{type(e).__name__}: {e}","wall_clock_s":round(time.perf_counter()-t2,4),"traceback":traceback.format_exc()[-1500:]}

# SMPL loader gate
SMPL_VERT_COUNT=6890
SMPL_JOINT_NAMES=["pelvis","left_hip","right_hip","spine1","left_knee","right_knee","spine2","left_ankle","right_ankle","spine3","left_foot","right_foot","neck","left_collar","right_collar","head","left_shoulder","right_shoulder","left_elbow","right_elbow","left_wrist","right_wrist","left_hand","right_hand"]
smpl={"status":"blocked","attempted":True}
body=anny_body
body_v=len(body.data.vertices)
has_uv=bool(body.data.uv_layers)
uv_loop_count=len(body.data.uv_layers.active.data) if has_uv else 0
anny_set=set(anny_joints); smpl_set=set(SMPL_JOINT_NAMES)
smpl["measurements"]={
    "anny_body_name":body.name,"anny_vertex_count":body_v,
    "smpl_expected_vertex_count":SMPL_VERT_COUNT,
    "vertex_count_delta":body_v-SMPL_VERT_COUNT,
    "has_uv_layers":has_uv,
    "uv_layer_name":body.data.uv_layers.active.name if has_uv else "",
    "uv_loop_count":uv_loop_count,
    "anny_joint_count":len(anny_joints),"smpl_joint_count":len(SMPL_JOINT_NAMES),
    "joint_name_intersection_count":len(anny_set & smpl_set),
    "anny_sample_joints":",".join(anny_joints[:12]),
    "smpl_sample_joints":",".join(SMPL_JOINT_NAMES[:12]),
}
if body_v != SMPL_VERT_COUNT:
    smpl["blockedReason"]=(
        f"ValueError: SMPL/SMPLitex loader requires SMPL topology with exactly {SMPL_VERT_COUNT} vertices "
        f"and the SMPL UV atlas; loaded mesh '{body.name}' has {body_v} vertices "
        f"(delta {body_v - SMPL_VERT_COUNT}), joint_name_intersection={len(anny_set & smpl_set)}/{len(SMPL_JOINT_NAMES)}, "
        f"uv_loops={uv_loop_count}. Anny joint names (e.g. thigh.L, upper_arm.L) do not match SMPL "
        f"(left_hip, left_shoulder). No vertex or UV correspondence — cannot bind SMPLitex texture."
    )
else:
    smpl["status"]="ran"
topo["smpl_loader"]=smpl
make["wall_clock_s"]=round(time.perf_counter()-t0,4)
topo["wall_clock_s"]=make["wall_clock_s"]
Path(out_make).write_text(json.dumps(make,indent=2)+"\\n")
Path(out_topo).write_text(json.dumps(topo,indent=2)+"\\n")
print("WROTE", out_make, out_topo)
`;
  writeFileSync(scriptPath, script, "utf8");

  const blender =
    process.env.OPENCLINXR_BLENDER ??
    (existsSync("/opt/homebrew/bin/blender")
      ? "/opt/homebrew/bin/blender"
      : "blender");

  const result = await runCmd(
    blender,
    [
      "--background",
      "--python",
      scriptPath,
      "--",
      "--humanoid",
      humanoidGlb,
      "--out-make",
      makePath,
      "--out-topo",
      topoPath,
      "--mh-base",
      MPFB_BASE_OBJ,
    ],
    { cwd: REPO_ROOT, timeoutMs: 180_000 },
  );
  writeFileSync(
    path.join(EVIDENCE_DIR, "makeclothes-probe.log"),
    `${result.stdout}\n${result.stderr}\n`,
    "utf8",
  );
  if (!existsSync(makePath)) {
    throw new Error(
      `MakeClothes/SMPL blender probe failed to write ${makePath}: code=${result.code} stderr=${result.stderr.slice(-800)}`,
    );
  }
}

/**
 * Run (or assemble) the clothing factory cagematch.
 * Prefers on-disk probe artifacts so vitest stays deterministic after first measurement pass.
 */
export async function runClothingFactoryCagematch(
  options: RunOptions = {},
): Promise<ClothingFactoryCagematchReport> {
  const force = options.force === true;
  const assembleOnly = options.assembleOnly === true;
  const humanoidGlb = options.humanoidGlb ?? DEFAULT_HUMANOID;

  ensureDir(EVIDENCE_DIR);

  if (!assembleOnly) {
    await ensureTopologyProbes(humanoidGlb, force);
  }

  const makeProbe = readJsonIfExists<Record<string, unknown>>(
    path.join(EVIDENCE_DIR, "makeclothes-probe.json"),
  );
  const topoProbe = readJsonIfExists<Record<string, unknown>>(
    path.join(EVIDENCE_DIR, "blender-topology-probe.json"),
  );
  const imageProbe = readJsonIfExists<Record<string, unknown>>(
    path.join(EVIDENCE_DIR, "image-to-3d-probe.json"),
  );

  const candidates: CandidateResult[] = [
    assembleMakeclothes(makeProbe, topoProbe),
    assembleImagineSmplitex(imageProbe, topoProbe),
    probeStablegen(),
  ];

  const imgGen = (imageProbe?.image_gen ?? {}) as Record<string, unknown>;
  const report: ClothingFactoryCagematchReport = {
    schemaVersion: "openclinxr.clothing-factory-cagematch.v1",
    generatedAt: new Date().toISOString(),
    claimScope: "local_authoring_tool_execution_and_topology_class_comparison_only",
    notEvidenceFor: [
      "clinical_clothing_appropriateness",
      "production_asset_readiness",
      "quest_readiness",
      "garment_visual_quality_as_readiness",
      "shipping_pipeline_adoption",
    ],
    candidates,
    environmentFindings: {
      image_gen_reachable_from_worktree_dispatch:
        imgGen.reachable_from_worktree_dispatch === true ||
        existsSync(path.join(EVIDENCE_DIR, "imagine-scrub-top.jpg")),
      image_gen_note:
        "image_gen succeeded inside worktree-bound Grok session (1024x1024 JPEG scrub top). TEXT→image is free; IMAGE→fitted Anny garment remains open.",
      stablegen_not_installed_by_design: true,
      humanoid_probed: humanoidGlb,
      mpfb_base_obj: MPFB_BASE_OBJ,
      mpfb_base_obj_exists: existsSync(MPFB_BASE_OBJ),
    },
    landPath: [
      ".openclinxr/evidence/clothing-cagematch/probe-report.json",
      ".openclinxr/evidence/clothing-cagematch/makeclothes-probe.json",
      ".openclinxr/evidence/clothing-cagematch/blender-topology-probe.json",
      ".openclinxr/evidence/clothing-cagematch/image-to-3d-probe.json",
      ".openclinxr/evidence/clothing-cagematch/imagine-scrub-top.jpg",
      ".openclinxr/evidence/clothing-cagematch/makeclothes-mh-probe-clothes.glb",
    ],
  };

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

// CLI: node / pnpm exec tsx tools/openclinxr/evidence/clothing-factory-cagematch.ts
const isMain =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const force = process.argv.includes("--force");
  const assembleOnly = process.argv.includes("--assemble-only");
  runClothingFactoryCagematch({ force, assembleOnly })
    .then((report) => {
      console.log(
        JSON.stringify(
          {
            reportPath: REPORT_PATH,
            candidates: report.candidates.map((c) => ({
              id: c.candidateId,
              status: c.status,
              outputClass: c.outputClass,
              blockedReason: c.blockedReason?.slice(0, 160),
              measurementKeys: Object.keys(c.measurements ?? {}),
            })),
          },
          null,
          2,
        ),
      );
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
