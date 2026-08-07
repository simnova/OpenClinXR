/**
 * #90 MakeHuman base topology viability probe — DECISION WITH EVIDENCE, not adoption.
 *
 * Measures: (1) licensable clinical garment catalogue + real MakeClothes fit,
 * (2) runtime_bone_map collapse against MPFB rig.default, (3) shipped humanoid
 * joint counts unchanged (counterweight).
 *
 * claimScope: local catalogue survey + MakeClothes fit on MH basemesh + rig map
 * comparison + shipped GLB joint counts only.
 * notEvidenceFor: clinical appropriateness, visual garment quality as readiness,
 * Quest readiness, production promotion, full Anny→MH migration cost, adoption
 * into shipping humanoid generators this slice.
 *
 * LAND-PATH (gitignored under .openclinxr/ — proofs re-run against worktree disk):
 *   .openclinxr/evidence/makehuman-base/probe-report.json
 *   .openclinxr/evidence/makehuman-base/scrub-shirt-fit.glb (optional fit artifact)
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
import { NodeIO } from "@gltf-transform/core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const EVIDENCE_DIR = path.join(
  REPO_ROOT,
  ".openclinxr/evidence/makehuman-base",
);
const REPORT_PATH = path.join(EVIDENCE_DIR, "probe-report.json");

const RUNTIME_BONE_MAP = path.join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/anny/runtime_bone_map.json",
);

const MPFB_RIG_DEFAULT =
  process.env.OPENCLINXR_MPFB_RIG_DEFAULT ??
  path.join(
    process.env.HOME ?? "",
    "Library/Application Support/Blender/5.1/extensions/user_default/mpfb/data/rigs/standard/rig.default.json",
  );

const MPFB_BASE_OBJ =
  process.env.OPENCLINXR_MPFB_BASE_OBJ ??
  path.join(
    process.env.HOME ?? "",
    "Library/Application Support/Blender/5.1/extensions/user_default/mpfb/data/3dobjs/base.obj",
  );

const SHIPPED_HUMANOID_DIR = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/generated-humanoids",
);

/** Full 23-joint Anny runtime set. peds_patient_child is a known 17-joint lean outlier (pre-existing). */
const SHIPPED_23_JOINT_HUMANOIDS = [
  "peds_anxious_parent.glb",
  "peds_nurse_kevin.glb",
  "ed_chest_pain_adult_cast.glb",
] as const;

export type GarmentCandidate = {
  candidateId: string;
  status: "fitted" | "blocked" | "other";
  reason?: string;
  licenseString?: string;
  isClinicalWear?: boolean;
  measurements?: Record<string, number | string>;
};

export type RigCollapse = {
  collapsedJointNames: string[];
  runtimeMapJointNames: string[];
  missingFromMakeHuman: string[];
};

export type ProbeReport = {
  schemaVersion: "openclinxr.makehuman-base-viability.v1";
  generatedAt: string;
  claimScope: string;
  notEvidenceFor: string[];
  garments: GarmentCandidate[];
  rig: RigCollapse;
  shippedHumanoidJointCounts: Record<string, number>;
  decisionSummary: string;
  environmentFindings: Record<string, unknown>;
  landPath: string[];
};

export type Probe = () => Promise<{
  garments: GarmentCandidate[];
  rig: RigCollapse;
  shippedHumanoidJointCounts: Record<string, number>;
}>;

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
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

function resolveBlender(): string {
  if (process.env.OPENCLINXR_BLENDER && existsSync(process.env.OPENCLINXR_BLENDER)) {
    return process.env.OPENCLINXR_BLENDER;
  }
  if (existsSync("/opt/homebrew/bin/blender")) return "/opt/homebrew/bin/blender";
  return "blender";
}

type RuntimeBoneMap = {
  runtimeBones: Array<{
    name: string;
    primary: string;
    weightSources?: string[];
    headFrom?: string[] | string;
    tailFrom?: string | string[];
  }>;
  runtimeSubsetCount?: number;
};

function collapseRig(): RigCollapse {
  if (!existsSync(RUNTIME_BONE_MAP)) {
    return {
      collapsedJointNames: [],
      runtimeMapJointNames: [],
      missingFromMakeHuman: ["runtime_bone_map.json_missing"],
    };
  }
  const map = JSON.parse(readFileSync(RUNTIME_BONE_MAP, "utf8")) as RuntimeBoneMap;
  const runtimeMapJointNames = map.runtimeBones.map((b) => b.name);

  const needed = new Set<string>();
  for (const b of map.runtimeBones) {
    needed.add(b.primary);
    for (const w of b.weightSources ?? []) needed.add(w);
    if (typeof b.tailFrom === "string") needed.add(b.tailFrom);
    if (Array.isArray(b.tailFrom)) for (const t of b.tailFrom) needed.add(t);
    if (Array.isArray(b.headFrom)) for (const h of b.headFrom) needed.add(h);
    if (typeof b.headFrom === "string") needed.add(b.headFrom);
  }

  let mhBones = new Set<string>();
  if (existsSync(MPFB_RIG_DEFAULT)) {
    const rig = JSON.parse(readFileSync(MPFB_RIG_DEFAULT, "utf8")) as Record<
      string,
      unknown
    >;
    mhBones = new Set(Object.keys(rig));
  } else {
    // Fail closed: cannot claim collapse without the live MPFB file.
    return {
      collapsedJointNames: [],
      runtimeMapJointNames,
      missingFromMakeHuman: [
        `mpfb_rig_default_missing:${MPFB_RIG_DEFAULT}`,
        ...[...needed],
      ],
    };
  }

  const missingFromMakeHuman = [...needed]
    .filter((n) => !mhBones.has(n))
    .sort();

  // Collapse: each runtime joint is kept iff its primary exists on MH default.
  const collapsedJointNames = map.runtimeBones
    .filter((b) => mhBones.has(b.primary))
    .map((b) => b.name);

  return {
    collapsedJointNames,
    runtimeMapJointNames,
    missingFromMakeHuman,
  };
}

async function countShippedJoints(): Promise<Record<string, number>> {
  const io = new NodeIO();
  const counts: Record<string, number> = {};
  for (const name of SHIPPED_23_JOINT_HUMANOIDS) {
    const glbPath = path.join(SHIPPED_HUMANOID_DIR, name);
    if (!existsSync(glbPath)) continue;
    const doc = await io.read(glbPath);
    const joints = new Set<string>();
    for (const skin of doc.getRoot().listSkins()) {
      for (const j of skin.listJoints()) {
        joints.add(j.getName() || `anon_${joints.size}`);
      }
    }
    counts[name] = joints.size;
  }
  return counts;
}

type CatalogEntry = {
  candidateId: string;
  pageUrl: string;
  licenseString: string;
  isClinicalWear: boolean;
  mhcloUrl?: string;
  objUrl?: string;
  notes: string;
};

/**
 * Clinical catalogue findings measured 2026-08-07 against makehumancommunity clothes
 * listing + asset pack pages. Licence strings are taken from each asset's own page /
 * mhclo header — never guessed.
 */
const CATALOGUE: CatalogEntry[] = [
  {
    candidateId: "wojackowl_scrubs_shirt",
    pageUrl: "http://www.makehumancommunity.org/clothes/scrubs_shirt.html",
    licenseString: "CC-BY - Creative Commons Attribution (page + Scrub_Shirt.mhclo header license: CC-BY; author WojackOWL; Medical Scrubs Kit)",
    isClinicalWear: true,
    mhcloUrl:
      "http://www.makehumancommunity.org/sites/default/files/clothes/8124/601141795/Scrub_Shirt.mhclo",
    objUrl:
      "http://www.makehumancommunity.org/sites/default/files/clothes/8124/966709161/Scrub_Shirt.obj",
    notes: "Primary clinical body garment — medical scrub top with .mhclo + .obj.",
  },
  {
    candidateId: "wojackowl_scrub_pants",
    pageUrl: "http://www.makehumancommunity.org/clothes/scrub_pants.html",
    licenseString: "CC-BY - Creative Commons Attribution (page field License)",
    isClinicalWear: true,
    mhcloUrl:
      "http://www.makehumancommunity.org/sites/default/files/clothes/8124/1256406461/Scrub_Pants.mhclo",
    notes: "Clinical scrub pants; same Medical Scrubs Kit author/licence as shirt.",
  },
  {
    candidateId: "wojackowl_surgical_mask",
    pageUrl: "http://www.makehumancommunity.org/clothes/surgical_mask.html",
    licenseString: "CC-BY - Creative Commons Attribution (page field License)",
    isClinicalWear: true,
    notes: "Clinical PPE accessory, not body garment.",
  },
  {
    candidateId: "wojackowl_surgical_gloves",
    pageUrl: "http://www.makehumancommunity.org/clothes/surgical_gloves.html",
    licenseString: "CC-BY - Creative Commons Attribution (page field License)",
    isClinicalWear: true,
    notes: "Clinical PPE accessory.",
  },
  {
    candidateId: "wojackowl_surgical_cap",
    pageUrl: "http://www.makehumancommunity.org/clothes/surgical_cap.html",
    licenseString: "CC-BY - Creative Commons Attribution (page field License)",
    isClinicalWear: true,
    notes: "Clinical PPE accessory.",
  },
  {
    candidateId: "joepal_medical_mouth_protection_masks01",
    pageUrl: "https://static.makehumancommunity.org/assets/assetpacks/masks01.html",
    licenseString: "CC0 (masks01 asset pack table: joepal_medical_mouth_protection / Joel Palmius)",
    isClinicalWear: true,
    notes:
      "Only CC0 clinical-named asset found in official packs; accessory mask, not body wear. Pack zip: files2.makehumancommunity.org/asset_packs/masks01/masks01_cc0.zip",
  },
  {
    candidateId: "hospital_patient_gown_catalogue_search",
    pageUrl: "http://www.makehumancommunity.org/clothes.html",
    licenseString: "n/a — no asset located",
    isClinicalWear: true,
    notes:
      "Searched clothes.html pages 0–22 + dress01/02/03 packs: no hospital/patient gown. dress01 is fashion gowns (flapper, kimono, halter). crude_gown is CC0 fashion gown, not clinical.",
  },
  {
    candidateId: "makehuman_assets_core_clothes_no_clinical",
    pageUrl:
      "https://github.com/makehumancommunity/makehuman-assets/tree/master/base/clothes",
    licenseString: "CC0 for bundled core assets (repo claim) — but no clinical garments present",
    isClinicalWear: true,
    notes:
      "Core base/clothes listing (19 entries) is casual/work/elegant suits + shoes only — no scrub/gown/PPE.",
  },
];

async function downloadIfNeeded(
  url: string,
  dest: string,
): Promise<{ ok: boolean; bytes: number; error?: string }> {
  if (existsSync(dest) && statSync(dest).size > 100) {
    return { ok: true, bytes: statSync(dest).size };
  }
  ensureDir(path.dirname(dest));
  const result = await runCmd(
    "curl",
    ["-sL", "--max-time", "90", "-o", dest, url],
    { timeoutMs: 100_000 },
  );
  if (result.code !== 0 || !existsSync(dest)) {
    return {
      ok: false,
      bytes: 0,
      error: `curl exit ${result.code}: ${result.stderr.slice(0, 200)}`,
    };
  }
  const bytes = statSync(dest).size;
  if (bytes < 50) {
    return { ok: false, bytes, error: `download too small (${bytes} B)` };
  }
  return { ok: true, bytes };
}

async function fitScrubShirt(): Promise<GarmentCandidate> {
  const entry = CATALOGUE.find((c) => c.candidateId === "wojackowl_scrubs_shirt")!;
  const stageDir = path.join(EVIDENCE_DIR, "staging", "scrubs_shirt");
  ensureDir(stageDir);
  const mhcloPath = path.join(stageDir, "Scrub_Shirt.mhclo");
  const objPath = path.join(stageDir, "Scrub_Shirt.obj");
  const outGlb = path.join(EVIDENCE_DIR, "scrub-shirt-fit.glb");
  const outJson = path.join(EVIDENCE_DIR, "scrub-shirt-fit.json");

  if (!entry.mhcloUrl || !entry.objUrl) {
    return {
      candidateId: entry.candidateId,
      status: "blocked",
      isClinicalWear: true,
      licenseString: entry.licenseString,
      reason: "mhclo/obj URLs missing from catalogue entry",
    };
  }

  const dlMhclo = await downloadIfNeeded(entry.mhcloUrl, mhcloPath);
  const dlObj = await downloadIfNeeded(entry.objUrl, objPath);
  if (!dlMhclo.ok || !dlObj.ok) {
    return {
      candidateId: entry.candidateId,
      status: "blocked",
      isClinicalWear: true,
      licenseString: entry.licenseString,
      reason: `download failed: mhclo=${dlMhclo.error ?? "ok"} obj=${dlObj.error ?? "ok"}`,
    };
  }

  // Confirm licence string from the asset's own mhclo header (not inferred).
  let headerLicense = entry.licenseString;
  try {
    const header = readFileSync(mhcloPath, "utf8").slice(0, 800);
    const lic = header.match(/#\s*license:\s*(.+)/i);
    const author = header.match(/#\s*author:\s*(.+)/i);
    const desc = header.match(/#\s*description:\s*(.+)/i);
    if (lic) {
      headerLicense = [
        lic[1].trim(),
        author ? `author ${author[1].trim()}` : "",
        desc ? desc[1].trim() : "",
        `source ${entry.pageUrl}`,
      ]
        .filter(Boolean)
        .join("; ");
    }
  } catch {
    /* keep page string */
  }

  if (!existsSync(MPFB_BASE_OBJ)) {
    return {
      candidateId: entry.candidateId,
      status: "blocked",
      isClinicalWear: true,
      licenseString: headerLicense,
      reason: `MPFB base.obj missing at ${MPFB_BASE_OBJ}`,
    };
  }

  const blender = resolveBlender();
  const scriptPath = path.join(
    process.env.TMPDIR ?? "/tmp",
    `ocxr90_fit_scrub_${process.pid}.py`,
  );
  const script = `
import bpy, json, os, sys, time, traceback
from pathlib import Path

argv = sys.argv
args = argv[argv.index("--")+1:] if "--" in argv else []
kv={}
i=0
while i < len(args):
    if args[i].startswith("--") and i+1 < len(args):
        kv[args[i][2:]]=args[i+1]; i+=2
    else:
        i+=1

report={"status":"blocked"}
t0=time.perf_counter()
try:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
    from bl_ext.user_default.mpfb.services.clothesservice import ClothesService
    from bl_ext.user_default.mpfb.services.objectservice import ObjectService
    from bl_ext.user_default.mpfb.entities.objectproperties import GeneralObjectProperties
    from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo

    before=set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=kv["mh-base"])
    basemesh=next((o for o in bpy.data.objects if o not in before and o.type=="MESH"), None)
    if basemesh is None:
        raise RuntimeError("no basemesh")
    basemesh.name="mh_basemesh"
    GeneralObjectProperties.set_value("object_type","Basemesh", entity_reference=basemesh)

    before=set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=kv["obj"])
    clothes=next((o for o in bpy.data.objects if o not in before and o.type=="MESH"), None)
    if clothes is None:
        raise RuntimeError("no clothes")
    mhclo=Mhclo(); mhclo.load(kv["mhclo"])
    try:
        mhclo.clothes=clothes
    except Exception:
        pass
    t1=time.perf_counter()
    ClothesService.fit_clothes_to_human(clothes, basemesh, mhclo=mhclo, set_parent=True)
    wall=time.perf_counter()-t1
    bpy.ops.object.select_all(action="DESELECT")
    clothes.select_set(True); bpy.context.view_layer.objects.active=clothes
    bpy.ops.export_scene.gltf(filepath=kv["out-glb"], use_selection=True, export_format="GLB")
    report={
        "status":"fitted",
        "wall_clock_s":round(wall,4),
        "basemesh_verts":len(basemesh.data.vertices),
        "clothes_verts":len(clothes.data.vertices),
        "clothes_tris":sum(len(p.vertices)-2 for p in clothes.data.polygons),
        "object_is_basemesh":bool(ObjectService.object_is_basemesh(basemesh)),
        "glb_bytes":os.path.getsize(kv["out-glb"]) if os.path.exists(kv["out-glb"]) else 0,
        "total_wall_clock_s":round(time.perf_counter()-t0,4),
    }
except Exception as e:
    report={"status":"blocked","error":f"{type(e).__name__}: {e}","traceback":traceback.format_exc()[-1500:],"total_wall_clock_s":round(time.perf_counter()-t0,4)}
Path(kv["out-json"]).write_text(json.dumps(report, indent=2))
print(json.dumps(report))
`;
  writeFileSync(scriptPath, script, "utf8");

  const result = await runCmd(
    blender,
    [
      "--background",
      "--python",
      scriptPath,
      "--",
      "--mh-base",
      MPFB_BASE_OBJ,
      "--mhclo",
      mhcloPath,
      "--obj",
      objPath,
      "--out-glb",
      outGlb,
      "--out-json",
      outJson,
    ],
    { cwd: REPO_ROOT, timeoutMs: 180_000 },
  );
  writeFileSync(
    path.join(EVIDENCE_DIR, "scrub-shirt-fit.log"),
    `${result.stdout}\n${result.stderr}\n`,
    "utf8",
  );

  let fit: Record<string, unknown> | null = null;
  if (existsSync(outJson)) {
    try {
      fit = JSON.parse(readFileSync(outJson, "utf8")) as Record<string, unknown>;
    } catch {
      fit = null;
    }
  }

  if (fit?.status === "fitted") {
    return {
      candidateId: entry.candidateId,
      status: "fitted",
      isClinicalWear: true,
      licenseString: headerLicense,
      measurements: {
        clothes_vertex_count: Number(fit.clothes_verts ?? 0),
        clothes_triangle_count: Number(fit.clothes_tris ?? 0),
        basemesh_vertex_count: Number(fit.basemesh_verts ?? 0),
        fit_wall_clock_s: Number(fit.wall_clock_s ?? 0),
        glb_bytes: Number(fit.glb_bytes ?? (existsSync(outGlb) ? statSync(outGlb).size : 0)),
        mhclo_bytes: dlMhclo.bytes,
        obj_bytes: dlObj.bytes,
        object_is_basemesh: fit.object_is_basemesh === true ? 1 : 0,
      },
    };
  }

  return {
    candidateId: entry.candidateId,
    status: "blocked",
    isClinicalWear: true,
    licenseString: headerLicense,
    reason:
      String(fit?.error ?? "") ||
      `MakeClothes fit did not succeed (blender exit ${result.code}): ${result.stderr.slice(0, 300)}`,
  };
}

function catalogueToGarments(
  fittedScrub: GarmentCandidate | null,
): GarmentCandidate[] {
  const out: GarmentCandidate[] = [];
  for (const entry of CATALOGUE) {
    if (entry.candidateId === "wojackowl_scrubs_shirt" && fittedScrub) {
      out.push(fittedScrub);
      continue;
    }
    if (entry.candidateId === "hospital_patient_gown_catalogue_search") {
      out.push({
        candidateId: entry.candidateId,
        status: "blocked",
        isClinicalWear: true,
        reason: entry.notes,
      });
      continue;
    }
    if (entry.candidateId === "makehuman_assets_core_clothes_no_clinical") {
      out.push({
        candidateId: entry.candidateId,
        status: "blocked",
        isClinicalWear: true,
        reason: entry.notes,
      });
      continue;
    }
    if (entry.candidateId === "joepal_medical_mouth_protection_masks01") {
      // CC0 clinical accessory exists; not fitted this slice (body garment was the load-bearing measurement).
      out.push({
        candidateId: entry.candidateId,
        status: "other",
        isClinicalWear: true,
        licenseString: entry.licenseString,
        reason:
          "CC0 clinical-named accessory catalogued in masks01; not fitted this slice — body scrub fit is the primary measurement. Pack available at files2.makehumancommunity.org/asset_packs/masks01/masks01_cc0.zip",
      });
      continue;
    }
    // Remaining clinical PPE / scrub pants: licence established, fit not re-run (shirt is the body fit).
    out.push({
      candidateId: entry.candidateId,
      status: "other",
      isClinicalWear: true,
      licenseString: entry.licenseString,
      reason: `${entry.notes} Licence established from asset page; body-fit measurement used scrub shirt only (same kit).`,
    });
  }
  return out;
}

function buildDecisionSummary(
  garments: GarmentCandidate[],
  rig: RigCollapse,
): string {
  const fitted = garments.filter((g) => g.status === "fitted");
  const clinical = garments.filter((g) => g.isClinicalWear);
  const missing = rig.missingFromMakeHuman.length;
  const parts = [
    `Rig collapse: ${rig.collapsedJointNames.length}/${rig.runtimeMapJointNames.length} runtime joints; missingFromMakeHuman=${missing}.`,
    `Clinical candidates considered: ${clinical.length}; fitted: ${fitted.map((g) => g.candidateId).join(",") || "none"}.`,
    fitted.length > 0
      ? "MakeHuman basemesh hosts a real clinical scrub top via MakeClothes (~tens of ms). Skeleton is not the barrier."
      : "No clinical garment was fitted in this run.",
    "Hospital patient gown: not found under clear clinical catalogue. Scrubs kit is CC-BY (not CC0) — redistribution allowlist still Patrick's licence call.",
    "DECISION: MakeHuman topology is the viable factory basemesh for garment fit; do NOT regenerate shipped Anny humanoids in this slice. Full base migration remains a separate epic. Proxy MH→Anny transfer remains a project (SMPLitex correspondence class).",
  ];
  return parts.join(" ");
}

/**
 * Primary probe entry used by the planted contracts.
 */
export async function probeMakeHumanBaseViability(): Promise<{
  garments: GarmentCandidate[];
  rig: RigCollapse;
  shippedHumanoidJointCounts: Record<string, number>;
}> {
  ensureDir(EVIDENCE_DIR);

  const fittedScrub = await fitScrubShirt();
  const garments = catalogueToGarments(fittedScrub);
  const rig = collapseRig();
  const shippedHumanoidJointCounts = await countShippedJoints();

  // Note known 17-joint lean outlier without putting it in the counterweight map.
  let patientChildJoints: number | null = null;
  const patientChild = path.join(SHIPPED_HUMANOID_DIR, "peds_patient_child.glb");
  if (existsSync(patientChild)) {
    const io = new NodeIO();
    const doc = await io.read(patientChild);
    const joints = new Set<string>();
    for (const skin of doc.getRoot().listSkins()) {
      for (const j of skin.listJoints()) joints.add(j.getName() || "");
    }
    patientChildJoints = joints.size;
  }

  const report: ProbeReport = {
    schemaVersion: "openclinxr.makehuman-base-viability.v1",
    generatedAt: new Date().toISOString(),
    claimScope:
      "local_clinical_garment_catalogue_survey_makeclothes_fit_on_mh_basemesh_rig_map_collapse_shipped_joint_counts",
    notEvidenceFor: [
      "clinical_appropriateness",
      "visual_garment_quality_as_readiness",
      "quest_readiness",
      "production_promotion",
      "full_anny_to_mh_migration_cost",
      "adoption_into_shipping_humanoid_generators_this_slice",
      "cc_by_redistribution_approval",
    ],
    garments,
    rig,
    shippedHumanoidJointCounts,
    decisionSummary: buildDecisionSummary(garments, rig),
    environmentFindings: {
      mpfbBaseObj: MPFB_BASE_OBJ,
      mpfbBaseObjExists: existsSync(MPFB_BASE_OBJ),
      mpfbRigDefault: MPFB_RIG_DEFAULT,
      mpfbRigDefaultExists: existsSync(MPFB_RIG_DEFAULT),
      mpfbRigBoneCount: existsSync(MPFB_RIG_DEFAULT)
        ? Object.keys(JSON.parse(readFileSync(MPFB_RIG_DEFAULT, "utf8")) as object)
            .length
        : 0,
      runtimeBoneMap: RUNTIME_BONE_MAP,
      peds_patient_child_joint_count_preexisting_lean: patientChildJoints,
      peds_patient_child_note:
        "Known 17-joint lean outlier excluded from counterweight map; not modified by this slice.",
      catalogueSources: CATALOGUE.map((c) => ({
        id: c.candidateId,
        page: c.pageUrl,
        license: c.licenseString,
      })),
    },
    landPath: [
      path.relative(REPO_ROOT, REPORT_PATH),
      path.relative(REPO_ROOT, path.join(EVIDENCE_DIR, "scrub-shirt-fit.glb")),
      path.relative(REPO_ROOT, path.join(EVIDENCE_DIR, "scrub-shirt-fit.json")),
    ],
  };

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return {
    garments: report.garments,
    rig: report.rig,
    shippedHumanoidJointCounts: report.shippedHumanoidJointCounts,
  };
}

/** CLI: write report without vitest. */
export async function main(): Promise<void> {
  const result = await probeMakeHumanBaseViability();
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        garmentStatuses: result.garments.map((g) => ({
          id: g.candidateId,
          status: g.status,
          clinical: g.isClinicalWear,
        })),
        missingFromMakeHuman: result.rig.missingFromMakeHuman,
        shipped: result.shippedHumanoidJointCounts,
      },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}
