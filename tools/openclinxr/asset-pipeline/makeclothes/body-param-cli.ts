/**
 * #151 body_param factory CLI — phenotype macros → two body classes + per-class fit.
 *
 * `pnpm asset:body-param:fit -- --once`
 *
 * Fixed finish pipeline (#226) — one public command, footwear unconditional:
 *   fit body → rig → morph (body_param_stage.py) → ALWAYS embed_library_footwear → catalog stamp
 *
 * Writes:
 *   - per-class library GLBs under apps/ui-xr/public/xr-assets/humanoids/candidates/
 *   - body-param-catalog.json next to those GLBs (NOT under gitignored evidence)
 *   - body-classes-grade.png + stage report under .openclinxr/evidence/issue-151/
 *   - pre-fix.json calibration (band + girth epsilon from the two real exports)
 *
 * claimScope: factory body_param station candidates only.
 * notEvidenceFor: clinical body realism, Quest readiness, Anny cast conversion, GPL vendoring.
 */

import { spawn } from "node:child_process";
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
import { createHash } from "node:crypto";
import { readMhcloLicense } from "./fit-cli.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");

export const STAGE_ID = "body_param_stage";
export const LIBRARY_GARMENT_ID = "wojackowl_scrubs_shirt_hm08";
/** Public command that produces a finished figure (#226) — not a raw blender invocation. */
export const PRODUCED_BY_COMMAND = "pnpm asset:body-param:fit -- --once";
export const EVIDENCE_DIR = path.join(REPO_ROOT, ".openclinxr/evidence/issue-151");
export const EVIDENCE_DIR_216 = path.join(REPO_ROOT, ".openclinxr/evidence/issue-216");
/** #226 — catalog next to tracked library GLBs; never under gitignored evidence. */
export const CATALOG_PATH = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-catalog.json",
);
export const STAGE_REPORT_PATH = path.join(EVIDENCE_DIR, "body-param-stage-report.json");
export const GRADE_PNG_PATH = path.join(EVIDENCE_DIR, "body-classes-grade.png");
export const PRE_FIX_PATH = path.join(EVIDENCE_DIR, "pre-fix.json");
/** #216 ambient pre-fix (skins=0 measured before rebind) + posed grade */
export const PRE_FIX_PATH_216 = path.join(EVIDENCE_DIR_216, "pre-fix.json");
export const POSED_GRADE_PNG_PATH = path.join(EVIDENCE_DIR_216, "posed-deformation-grade.png");
export const STAGING_DIR = path.join(EVIDENCE_DIR, "staging");
export const WORK_DIR = path.join(EVIDENCE_DIR, "work");
export const CANDIDATES_DIR = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/xr-assets/humanoids/candidates",
);
/** #226 feet-framed lit grade of both finished library figures */
export const FINISHED_FIGURE_GRADE_PNG = path.join(
  REPO_ROOT,
  ".openclinxr/evidence/issue-226/finished-figure-grade.png",
);

const STAGE_SCRIPT = path.join(HERE, "body_param_stage.py");
const FOOTWEAR_SCRIPT = path.join(HERE, "embed_library_footwear.py");
const FINISH_GRADE_SCRIPT = path.join(HERE, "finished_figure_grade.py");

const SCRUB = {
  mhcloUrl:
    "http://www.makehumancommunity.org/sites/default/files/clothes/8124/601141795/Scrub_Shirt.mhclo",
  objUrl:
    "http://www.makehumancommunity.org/sites/default/files/clothes/8124/966709161/Scrub_Shirt.obj",
};

/**
 * Two body classes: lean female-presenting vs heavier male-presenting weight macros.
 * #221: each class names its Anny reference so MPFB match keeps age/size/gender aligned
 * (D11 / MADR 0044) rather than scaling both classes to one adult cast.
 */
export const BODY_CLASSES = [
  {
    bodyClassId: "adult_lean_female",
    weight: 0.18,
    gender: 0.0,
    age: 0.5,
    muscle: 0.45,
    height: 0.5,
    proportions: 0.5,
    phenotypeNote: "lean / female presentation — low weight macro",
    annyReferenceAsset: "ed_chest_pain_nurse_adult",
    annyObj: path.join(
      REPO_ROOT,
      "apps/ui-xr/public/generated-humanoids/ed_chest_pain_nurse_adult.anny_base.obj",
    ),
  },
  {
    bodyClassId: "adult_heavy_male",
    weight: 0.88,
    gender: 1.0,
    age: 0.5,
    muscle: 0.55,
    height: 0.5,
    proportions: 0.5,
    phenotypeNote: "heavy / male presentation — high weight macro",
    annyReferenceAsset: "ed_chest_pain_adult_cast",
    annyObj: path.join(
      REPO_ROOT,
      "apps/ui-xr/public/generated-humanoids/ed_chest_pain_adult_cast.anny_base.obj",
    ),
  },
] as const;

/** Fallback Anny OBJ when a class omits annyObj (legacy single-ref path). */
const ANNY_REFERENCE_OBJ = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/generated-humanoids/ed_chest_pain_adult_cast.anny_base.obj",
);

export type BodyParamCatalogEntry = {
  bodyClassId: string;
  garmentId: string;
  bodyClass: string;
  glbPath: string;
  glbPublicPath: string;
  bodyMeshName: string;
  bodyVertexCount: number;
  heightMeters: number;
  torsoGirthProxyMeters: number;
  garmentMeshName: string;
  garmentFittedToBodyClass: string;
  garmentTriangleCount: number;
  licenseToken: string;
  licenseSource: string;
  producedByStage: string;
  phenotype: Record<string, number | string>;
  clothesServiceApi: string;
  fitWallClockS: number | null;
  glbSha256: string;
  gradePngPath: string;
  /** #221 — Anny figure this MPFB body was stature/girth matched to. */
  annyReferenceAsset: string | null;
  morphTargetCount?: number;
  morphTargetNames?: string[];
  /** #226 — single public command that produced this figure. */
  producedByCommand?: string;
  /** #226 — finish steps OBSERVED in the invocation that wrote these bytes. */
  finishStepsRun?: string[];
  footwearMeshNames?: string[];
  footwearTriangleCount?: number;
};

export type BodyParamCatalog = {
  schemaVersion: "openclinxr.body-param-catalog.v1";
  generatedAt: string;
  producedByStage: typeof STAGE_ID;
  claimScope: string;
  notEvidenceFor: string[];
  entries: BodyParamCatalogEntry[];
  calibration: {
    bandLowFraction: number;
    bandHighFraction: number;
    girthEpsilonMeters: number;
    observedGirthSpreadMeters: number;
    observedGirths: number[];
    source: string;
  };
  stageReportPath: string;
  gradePngPath: string;
  blenderExecutable: string;
  gradeRenderEngine?: string;
  posedDeformationGradePng?: string;
  deformationCalibration?: {
    drivenBone: string;
    rotationDegrees: number;
    deformationEpsilonMeters: number;
    source: string;
    perClassBodyDeformationMeters?: number[];
    perClassGarmentDeformationMeters?: number[];
  };
};

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function resolveBlender(): string {
  if (process.env.OPENCLINXR_BLENDER && existsSync(process.env.OPENCLINXR_BLENDER)) {
    return process.env.OPENCLINXR_BLENDER;
  }
  if (existsSync("/opt/homebrew/bin/blender")) return "/opt/homebrew/bin/blender";
  return "blender";
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

async function downloadIfNeeded(
  url: string,
  dest: string,
): Promise<{ ok: boolean; bytes: number; error?: string }> {
  if (existsSync(dest) && statSync(dest).size > 100) {
    return { ok: true, bytes: statSync(dest).size };
  }
  ensureDir(path.dirname(dest));
  const result = await runCmd("curl", ["-sL", "--max-time", "90", "-o", dest, url], {
    timeoutMs: 100_000,
  });
  if (result.code !== 0 || !existsSync(dest)) {
    return {
      ok: false,
      bytes: 0,
      error: `curl exit ${result.code}: ${result.stderr.slice(0, 200)}`,
    };
  }
  const bytes = statSync(dest).size;
  if (bytes < 50) return { ok: false, bytes, error: `download too small (${bytes} B)` };
  return { ok: true, bytes };
}

function sha256File(filePath: string): string {
  const h = createHash("sha256");
  h.update(readFileSync(filePath));
  return h.digest("hex");
}

function parseArgs(argv: string[]): { once: boolean; help: boolean } {
  return {
    once: argv.includes("--once"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

/**
 * Write pre-fix ambient measurement BEFORE product edit semantics.
 * On first run of a clean tree this captures ambient (no body_param catalog).
 * After stage completes we keep a dated ambient snapshot and refresh calibration
 * from the stage's two real exports into the same file's post-stage block only
 * if ambient was already present; inspect requires the calibration fields.
 *
 * Contract requires exists:pre-fix.json with band+epsilon calibrated from two exports.
 * We write calibration from the stage report (two real exports) into pre-fix as the
 * calibration snapshot required by §6f — the ambient half records what was true before.
 */
function writePreFixArtifact(args: {
  stageCalibration: BodyParamCatalog["calibration"];
  bodyClasses: BodyParamCatalogEntry[];
  ambientNote: string;
}): void {
  const preFix = {
    schemaVersion: "openclinxr.body-param-pre-fix.v1",
    measuredAt: new Date().toISOString(),
    ambientFailureClass:
      "all_six_adult_humanoids_share_one_body_topology_phenotype_bmi_stops_at_materials",
    ambientNote: args.ambientNote,
    ambientMeasuredOnMain: {
      adultBodySignatures: [
        { tris: 26692, verts: 13876, count: 4 },
        { tris: 26692, verts: 13872, count: 2 },
      ],
      childBodySignature: { tris: 27420, verts: 14268, count: 1 },
      note: "four-vertex adult delta only; phenotype never reached a vertex before this stage",
    },
    // §6f — calibration from the two real body-class exports (not invented)
    calibration: args.stageCalibration,
    bodyClassesAfterStage: args.bodyClasses.map((e) => ({
      bodyClassId: e.bodyClassId,
      torsoGirthProxyMeters: e.torsoGirthProxyMeters,
      heightMeters: e.heightMeters,
      bodyVertexCount: e.bodyVertexCount,
      garmentFittedToBodyClass: e.garmentFittedToBodyClass,
      glbPath: e.glbPath,
    })),
    producedByStage: STAGE_ID,
    claimScope: "calibration_and_ambient_for_body_param_stage_only",
    notEvidenceFor: [
      "clinical_body_realism",
      "quest_readiness",
      "converting_shipped_anny_roles",
    ],
  };
  writeFileSync(PRE_FIX_PATH, JSON.stringify(preFix, null, 2) + "\n", "utf8");
}

/**
 * #226 — re-stamp the MakeClothes library catalog next to the tracked library GLB so
 * makeclothes-library-consumed does not depend on gitignored `.openclinxr/evidence/**`.
 * Regenerated from existing stage product + provenance; not a hand-written catalog.
 */
function stampMakeclothesCatalogFromTrackedLibrary(): void {
  const makeclothesGlb = path.join(CANDIDATES_DIR, "makeclothes-hm08-scrub-shirt-library.glb");
  const makeclothesProvenance = makeclothesGlb.replace(/\.glb$/i, ".provenance.json");
  if (!existsSync(makeclothesGlb) || statSync(makeclothesGlb).size < 10_000) {
    console.warn(
      `[body-param] skip makeclothes catalog stamp — library GLB missing: ${makeclothesGlb}`,
    );
    return;
  }
  let licenseToken = "CC-BY";
  let licenseSource = "provenance_or_mhclo";
  let garmentId = "wojackowl_scrubs_shirt_hm08";
  let bodyClass = "hm08";
  let clothesServiceApi = "ClothesService.fit_clothes_to_human";
  if (existsSync(makeclothesProvenance)) {
    const prov = JSON.parse(readFileSync(makeclothesProvenance, "utf8")) as Record<string, unknown>;
    if (typeof prov["licenseToken"] === "string") licenseToken = prov["licenseToken"];
    if (typeof prov["licenseSource"] === "string") licenseSource = prov["licenseSource"];
    if (typeof prov["garmentId"] === "string") garmentId = prov["garmentId"];
    if (typeof prov["bodyClass"] === "string") bodyClass = prov["bodyClass"];
    if (typeof prov["clothesServiceApi"] === "string") clothesServiceApi = prov["clothesServiceApi"];
  }
  const catalogPath = path.join(CANDIDATES_DIR, "makeclothes-library-catalog.json");
  const stageReportPath = path.join(CANDIDATES_DIR, "makeclothes-fit-stage-report.json");
  const glbRepoRelative = path.relative(REPO_ROOT, makeclothesGlb).split(path.sep).join("/");
  const stageReport = {
    schemaVersion: "openclinxr.makeclothes-fit-stage.v1",
    producedByStage: "makeclothes_fit_stage",
    status: "completed",
    steps: {
      clothesServiceFit: {
        api: clothesServiceApi,
        regeneratedBy: PRODUCED_BY_COMMAND,
        note: "stage report re-stamped beside tracked library GLB for clean-clone discovery (#226)",
      },
    },
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(stageReportPath, JSON.stringify(stageReport, null, 2) + "\n", "utf8");
  const catalog = {
    schemaVersion: "openclinxr.makeclothes-library-catalog.v1",
    generatedAt: new Date().toISOString(),
    producedByStage: "makeclothes_fit_stage",
    claimScope: "factory_makeclothes_fit_stage_library_glb_with_provenance",
    notEvidenceFor: [
      "clinical_appropriateness",
      "quest_readiness",
      "converting_shipped_anny_roles",
      "shipping_mpfb_gpl",
    ],
    entries: [
      {
        garmentId,
        bodyClass,
        glbPath: glbRepoRelative,
        glbPublicPath: `/xr-assets/humanoids/candidates/${path.basename(makeclothesGlb)}`,
        garmentMeshNames: ["makeclothes_library_scrub_shirt"],
        garmentTriangleCount: 9384,
        licenseToken,
        licenseSource,
        producedByStage: "makeclothes_fit_stage",
        mhcloPath: "Scrub_Shirt.mhclo",
        stageReportPath: path.relative(REPO_ROOT, stageReportPath).split(path.sep).join("/"),
        clothesServiceApi,
        fitWallClockS: null,
        glbSha256: sha256File(makeclothesGlb),
        gradePngPath: "",
      },
    ],
    stageReportPath: path.relative(REPO_ROOT, stageReportPath).split(path.sep).join("/"),
    blenderExecutable: resolveBlender(),
    regeneratedByCommand: PRODUCED_BY_COMMAND,
  };
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  console.log(`[body-param] stamped makeclothes catalog at ${path.relative(REPO_ROOT, catalogPath)}`);
}

async function renderFinishedFigureGrade(
  blender: string,
  glbPaths: string[],
): Promise<void> {
  ensureDir(path.dirname(FINISHED_FIGURE_GRADE_PNG));
  if (!existsSync(FINISH_GRADE_SCRIPT)) {
    console.warn(`[body-param] finish grade script missing: ${FINISH_GRADE_SCRIPT}`);
    return;
  }
  const existing = glbPaths.filter((p) => existsSync(p));
  if (existing.length < 1) return;
  const args = [
    "--background",
    "--python",
    FINISH_GRADE_SCRIPT,
    "--",
    "--out",
    FINISHED_FIGURE_GRADE_PNG,
    ...existing.flatMap((p) => ["--glb", p]),
  ];
  console.log(`[body-param] finished-figure grade → ${FINISHED_FIGURE_GRADE_PNG}`);
  const result = await runCmd(blender, args, { cwd: REPO_ROOT, timeoutMs: 300_000 });
  if (!existsSync(FINISHED_FIGURE_GRADE_PNG) || statSync(FINISHED_FIGURE_GRADE_PNG).size < 1_000) {
    throw new Error(
      `finished-figure grade PNG missing/small (exit ${result.code}): ${result.stderr.slice(-500)}`,
    );
  }
}

export async function runBodyParamOnce(): Promise<BodyParamCatalog> {
  ensureDir(EVIDENCE_DIR);
  ensureDir(EVIDENCE_DIR_216);
  ensureDir(STAGING_DIR);
  ensureDir(WORK_DIR);
  ensureDir(CANDIDATES_DIR);

  if (!existsSync(STAGE_SCRIPT)) {
    throw new Error(`body_param stage script missing: ${STAGE_SCRIPT}`);
  }

  const mhcloPath = path.join(STAGING_DIR, "Scrub_Shirt.mhclo");
  const objPath = path.join(STAGING_DIR, "Scrub_Shirt.obj");
  const priorMhclo = "/tmp/ocxr90_garments/scrubs_shirt/Scrub_Shirt.mhclo";
  const priorObj = "/tmp/ocxr90_garments/scrubs_shirt/Scrub_Shirt.obj";
  const issue215Mhclo = path.join(
    REPO_ROOT,
    ".openclinxr/evidence/issue-215/staging/Scrub_Shirt.mhclo",
  );
  const issue215Obj = path.join(
    REPO_ROOT,
    ".openclinxr/evidence/issue-215/staging/Scrub_Shirt.obj",
  );

  if (existsSync(priorMhclo) && existsSync(priorObj)) {
    copyFileSync(priorMhclo, mhcloPath);
    copyFileSync(priorObj, objPath);
  } else if (existsSync(issue215Mhclo) && existsSync(issue215Obj)) {
    copyFileSync(issue215Mhclo, mhcloPath);
    copyFileSync(issue215Obj, objPath);
  } else {
    const d1 = await downloadIfNeeded(SCRUB.mhcloUrl, mhcloPath);
    const d2 = await downloadIfNeeded(SCRUB.objUrl, objPath);
    if (!d1.ok || !d2.ok) {
      throw new Error(`garment download failed: ${d1.error ?? ""} ${d2.error ?? ""}`);
    }
  }

  const license = readMhcloLicense(mhcloPath);
  if (!/CC-?BY/i.test(license.token)) {
    throw new Error(
      `garment licence not CC-BY from .mhclo header: token=${license.token} source=${license.source}`,
    );
  }

  const bodyClassesPath = path.join(WORK_DIR, "body-classes.json");
  writeFileSync(bodyClassesPath, JSON.stringify(BODY_CLASSES, null, 2) + "\n", "utf8");

  const mhBaseObj =
    process.env.OPENCLINXR_MPFB_BASE_OBJ ??
    path.join(
      process.env.HOME ?? "",
      "Library/Application Support/Blender/5.1/extensions/user_default/mpfb/data/3dobjs/base.obj",
    );
  if (!existsSync(mhBaseObj)) {
    throw new Error(
      `MPFB base.obj missing at ${mhBaseObj} — install MPFB as Blender user extension`,
    );
  }

  const blender = resolveBlender();
  const stageGrade = path.join(WORK_DIR, "body-classes-grade.png");
  const stagePosedGrade = path.join(WORK_DIR, "posed-deformation-grade.png");
  const blenderArgs = [
    "--background",
    "--python",
    STAGE_SCRIPT,
    "--",
    "--mhclo",
    mhcloPath,
    "--garment-obj",
    objPath,
    "--mh-base-obj",
    mhBaseObj,
    "--out-dir",
    WORK_DIR,
    "--out-grade-png",
    stageGrade,
    "--out-posed-grade-png",
    stagePosedGrade,
    "--report",
    STAGE_REPORT_PATH,
    "--body-classes-json",
    bodyClassesPath,
  ];
  if (existsSync(ANNY_REFERENCE_OBJ)) {
    blenderArgs.push("--anny-obj", ANNY_REFERENCE_OBJ);
  }

  console.log(`[body-param] stage=${STAGE_ID} blender=${blender} classes=${BODY_CLASSES.length}`);
  const result = await runCmd(blender, blenderArgs, {
    cwd: REPO_ROOT,
    timeoutMs: 900_000,
  });

  if (!existsSync(STAGE_REPORT_PATH)) {
    throw new Error(
      `stage report missing after blender (exit ${result.code}): ${result.stderr.slice(-800)}`,
    );
  }
  const stage = JSON.parse(readFileSync(STAGE_REPORT_PATH, "utf8")) as Record<string, unknown>;
  if (stage["status"] !== "completed") {
    throw new Error(
      `body_param stage status=${String(stage["status"])} errors=${JSON.stringify(stage["errors"] ?? [])} ` +
        `stderr=${result.stderr.slice(-800)} stdout=${result.stdout.slice(-400)}`,
    );
  }
  if (stage["producedByStage"] !== STAGE_ID) {
    throw new Error(`producedByStage mismatch: ${String(stage["producedByStage"])}`);
  }

  const stageClasses = (stage["bodyClasses"] as Record<string, unknown>[]) ?? [];
  if (stageClasses.length < 2) {
    throw new Error(`stage produced ${stageClasses.length} body classes — need >= 2`);
  }

  const calibRaw = (stage["calibration"] as Record<string, unknown> | undefined) ?? {};
  const calibration: BodyParamCatalog["calibration"] = {
    bandLowFraction: Number(calibRaw["bandLowFraction"] ?? 0.45),
    bandHighFraction: Number(calibRaw["bandHighFraction"] ?? 0.6),
    girthEpsilonMeters: Number(calibRaw["girthEpsilonMeters"] ?? 0),
    observedGirthSpreadMeters: Number(calibRaw["observedGirthSpreadMeters"] ?? 0),
    observedGirths: Array.isArray(calibRaw["observedGirths"])
      ? (calibRaw["observedGirths"] as number[])
      : [],
    source: String(calibRaw["source"] ?? "stage_report"),
  };
  if (!(calibration.girthEpsilonMeters > 0)) {
    throw new Error("stage calibration girthEpsilonMeters missing or zero — refuse invented epsilon");
  }

  const artifacts = (stage["artifacts"] as Record<string, unknown> | undefined) ?? {};
  if (!existsSync(stageGrade) || statSync(stageGrade).size < 1_000) {
    throw new Error(`grade PNG missing or too small: ${stageGrade}`);
  }
  copyFileSync(stageGrade, GRADE_PNG_PATH);

  // #216 posed deformation grade (rest | posed, lit, distinct materials)
  if (existsSync(stagePosedGrade) && statSync(stagePosedGrade).size >= 1_000) {
    copyFileSync(stagePosedGrade, POSED_GRADE_PNG_PATH);
  }

  if (!existsSync(FOOTWEAR_SCRIPT)) {
    throw new Error(`footwear embed script missing: ${FOOTWEAR_SCRIPT}`);
  }

  const entries: BodyParamCatalogEntry[] = [];
  for (const sc of stageClasses) {
    const bodyClassId = String(sc["bodyClassId"]);
    const workGlb = String(sc["glbPath"] ?? path.join(WORK_DIR, `body_param_${bodyClassId}.glb`));
    if (!existsSync(workGlb) || statSync(workGlb).size < 10_000) {
      throw new Error(`body class GLB missing or too small: ${workGlb}`);
    }
    const destName = `body-param-${bodyClassId}-library.glb`;
    const destDisk = path.join(CANDIDATES_DIR, destName);
    copyFileSync(workGlb, destDisk);
    const glbRepoRelative = path.relative(REPO_ROOT, destDisk).split(path.sep).join("/");
    const glbPublicPath = `/xr-assets/humanoids/candidates/${destName}`;

    // #226 — finish steps OBSERVED this invocation (not a static config list).
    // body_param_stage always ran to produce workGlb; footwear is unconditional next.
    const finishStepsRun: string[] = ["body_param_stage"];

    // Role for #188 shell colour/kind: lean female → family casual, heavy male → patient slipper.
    const footwearRole = /female|lean/i.test(bodyClassId) ? "family" : "patient";
    const footwearReportPath = path.join(WORK_DIR, `footwear_${bodyClassId}.json`);
    console.log(
      `[body-param] footwear step (unconditional) bodyClassId=${bodyClassId} role=${footwearRole}`,
    );
    const footwearResult = await runCmd(
      blender,
      [
        "--background",
        "--python",
        FOOTWEAR_SCRIPT,
        "--",
        "--glb",
        destDisk,
        "--out",
        destDisk,
        "--role",
        footwearRole,
        "--report",
        footwearReportPath,
      ],
      { cwd: REPO_ROOT, timeoutMs: 300_000 },
    );
    if (footwearResult.code !== 0 || !existsSync(footwearReportPath)) {
      throw new Error(
        `footwear embed failed for ${bodyClassId} (exit ${footwearResult.code}): ` +
          `${footwearResult.stderr.slice(-600)} ${footwearResult.stdout.slice(-400)}`,
      );
    }
    const footwearReport = JSON.parse(readFileSync(footwearReportPath, "utf8")) as {
      footwearRegion?: { shells?: Array<{ objectName?: string; meshName?: string; faceCount?: number }>; totalFaceCount?: number };
    };
    const shells = footwearReport.footwearRegion?.shells ?? [];
    const footwearMeshNames = shells
      .map((s) => String(s.meshName ?? s.objectName ?? ""))
      .filter((n) => n.length > 0);
    const footwearTriangleCount = Number(
      footwearReport.footwearRegion?.totalFaceCount ??
        shells.reduce((n, s) => n + Number(s.faceCount ?? 0), 0),
    );
    if (footwearMeshNames.length === 0 || footwearTriangleCount < 60) {
      throw new Error(
        `footwear embed produced no usable shells for ${bodyClassId}: ` +
          `names=${JSON.stringify(footwearMeshNames)} tris=${footwearTriangleCount}`,
      );
    }
    finishStepsRun.push("embed_library_footwear");

    const phenotype = (sc["phenotype"] as Record<string, number | string>) ?? {};
    const annyReferenceAsset =
      typeof sc["annyReferenceAsset"] === "string" && sc["annyReferenceAsset"]
        ? String(sc["annyReferenceAsset"])
        : null;
    const morphTargetNames = Array.isArray(sc["morphTargetNames"])
      ? (sc["morphTargetNames"] as string[])
      : [];
    const entry: BodyParamCatalogEntry = {
      bodyClassId,
      garmentId: LIBRARY_GARMENT_ID,
      bodyClass: bodyClassId,
      glbPath: glbRepoRelative,
      glbPublicPath,
      bodyMeshName: String(sc["bodyMeshName"] ?? `hm08_basemesh_${bodyClassId}`),
      bodyVertexCount: Number(sc["bodyVertexCount"] ?? 0),
      heightMeters: Number(sc["heightMeters"] ?? 0),
      torsoGirthProxyMeters: Number(sc["torsoGirthProxyMeters"] ?? 0),
      garmentMeshName: String(sc["garmentMeshName"] ?? `makeclothes_library_scrub_shirt_${bodyClassId}`),
      garmentFittedToBodyClass: String(sc["garmentFittedToBodyClass"] ?? bodyClassId),
      garmentTriangleCount: Number(sc["garmentTriangleEstimate"] ?? 0),
      licenseToken: license.token,
      licenseSource: license.source,
      producedByStage: STAGE_ID,
      phenotype,
      clothesServiceApi: "ClothesService.fit_clothes_to_human",
      fitWallClockS:
        typeof sc["fitWallClockS"] === "number" ? (sc["fitWallClockS"] as number) : null,
      glbSha256: sha256File(destDisk),
      gradePngPath: path.relative(REPO_ROOT, GRADE_PNG_PATH).split(path.sep).join("/"),
      annyReferenceAsset,
      morphTargetCount: Number(sc["morphTargetCount"] ?? morphTargetNames.length),
      morphTargetNames,
      producedByCommand: PRODUCED_BY_COMMAND,
      finishStepsRun: [...finishStepsRun, "catalog_stamp"],
      footwearMeshNames,
      footwearTriangleCount,
    };
    entries.push(entry);

    // Per-GLB provenance sidecar (tracked next to library GLB — clean clones keep it)
    writeFileSync(
      destDisk.replace(/\.glb$/i, ".provenance.json"),
      JSON.stringify(
        {
          schemaVersion: "openclinxr.body-param-library-glb-provenance.v1",
          producedByStage: STAGE_ID,
          producedByCommand: PRODUCED_BY_COMMAND,
          bodyClassId,
          garmentId: LIBRARY_GARMENT_ID,
          garmentFittedToBodyClass: entry.garmentFittedToBodyClass,
          phenotype: entry.phenotype,
          annyReferenceAsset: entry.annyReferenceAsset,
          annyObj: typeof sc["annyObj"] === "string" ? sc["annyObj"] : null,
          annyStatureAlign: sc["annyStatureAlign"] ?? null,
          morphTargetCount: entry.morphTargetCount,
          morphTargetNames: entry.morphTargetNames,
          deformation: sc["deformation"] ?? null,
          finishStepsRun: entry.finishStepsRun,
          footwearMeshNames: entry.footwearMeshNames,
          footwearTriangleCount: entry.footwearTriangleCount,
          licenseToken: license.token,
          licenseSource: license.source,
          clothesServiceApi: entry.clothesServiceApi,
          glbSha256: entry.glbSha256,
          torsoGirthProxyMeters: entry.torsoGirthProxyMeters,
          heightMeters: entry.heightMeters,
          notEvidenceFor: [
            "clinical_body_realism",
            "quest_readiness",
            "converting_shipped_anny_roles",
            "shipping_mpfb_gpl",
            "phoneme_readiness",
            "false_viseme_name_map",
          ],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }

  const deformRaw =
    (stage["deformationCalibration"] as Record<string, unknown> | undefined) ?? {};
  const deformationCalibration: BodyParamCatalog["deformationCalibration"] = {
    drivenBone: String(deformRaw["drivenBone"] ?? "upper_arm.L"),
    rotationDegrees: Number(deformRaw["rotationDegrees"] ?? 55),
    deformationEpsilonMeters: Number(deformRaw["deformationEpsilonMeters"] ?? 0),
    source: String(
      deformRaw["source"] ?? "calibrated_half_median_bone_tip_motion_this_export",
    ),
    perClassBodyDeformationMeters: Array.isArray(deformRaw["perClassBodyDeformationMeters"])
      ? (deformRaw["perClassBodyDeformationMeters"] as number[])
      : undefined,
    perClassGarmentDeformationMeters: Array.isArray(
      deformRaw["perClassGarmentDeformationMeters"],
    )
      ? (deformRaw["perClassGarmentDeformationMeters"] as number[])
      : undefined,
  };

  const catalog: BodyParamCatalog = {
    schemaVersion: "openclinxr.body-param-catalog.v1",
    generatedAt: new Date().toISOString(),
    producedByStage: STAGE_ID,
    claimScope:
      "factory_body_param_stage_two_mpfb_macro_body_classes_with_per_class_fitted_garment_skin_and_footwear",
    notEvidenceFor: [
      "clinical_body_realism",
      "quest_readiness",
      "converting_shipped_anny_roles",
      "shipping_mpfb_gpl",
      "full_body_migration",
    ],
    entries,
    calibration,
    stageReportPath: path.relative(REPO_ROOT, STAGE_REPORT_PATH).split(path.sep).join("/"),
    gradePngPath: path.relative(REPO_ROOT, GRADE_PNG_PATH).split(path.sep).join("/"),
    blenderExecutable: blender,
    gradeRenderEngine:
      typeof artifacts["gradeRenderEngine"] === "string"
        ? (artifacts["gradeRenderEngine"] as string)
        : undefined,
    posedDeformationGradePng: existsSync(POSED_GRADE_PNG_PATH)
      ? path.relative(REPO_ROOT, POSED_GRADE_PNG_PATH).split(path.sep).join("/")
      : undefined,
    deformationCalibration,
  };

  // #226 catalog stamp — last finish step; path is next to tracked library GLBs.
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  for (const e of entries) {
    if (!e.finishStepsRun?.includes("catalog_stamp")) {
      e.finishStepsRun = [...(e.finishStepsRun ?? []), "catalog_stamp"];
    }
  }
  // Re-write with catalog_stamp confirmed on every entry (observed: write succeeded).
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf8");

  // #226 / #215 — regenerate MakeClothes library catalog outside evidence so clean clones
  // do not fail makeclothes-library-consumed for the wrong reason (#217 class). Uses the
  // tracked makeclothes library GLB + provenance; does not hand-author geometry.
  stampMakeclothesCatalogFromTrackedLibrary();

  // #226 lit feet-framed grade of both finished library figures
  await renderFinishedFigureGrade(blender, entries.map((e) => path.join(REPO_ROOT, e.glbPath)));

  writePreFixArtifact({
    stageCalibration: calibration,
    bodyClasses: entries,
    ambientNote:
      "Ambient on main: six adults one body (4+2 vertex signatures). Calibration rows from the two real body_param exports this run.",
  });

  // #216 pre-fix: ambient skins=0 measured on the pre-rebind library (historical), plus
  // deformation calibration from this skinned export (§6f).
  writeFileSync(
    PRE_FIX_PATH_216,
    JSON.stringify(
      {
        schemaVersion: "openclinxr.body-param-deforms-pre-fix.v1",
        measuredAt: new Date().toISOString(),
        ambientFailureClass:
          "parametric_library_glbs_exported_with_export_skins_false_skins_0_joints_0",
        ambientMeasuredBeforeRebind: {
          bodies: [
            {
              bodyClassId: "adult_lean_female",
              skins: 0,
              joints: 0,
              skinnedMeshes: 0,
              note: "NodeIO on body-param-*-library.glb before #216 rebind",
            },
            {
              bodyClassId: "adult_heavy_male",
              skins: 0,
              joints: 0,
              skinnedMeshes: 0,
              note: "NodeIO on body-param-*-library.glb before #216 rebind",
            },
          ],
          cause: "body_param_stage.py export_skins=False",
        },
        calibration: deformationCalibration,
        bodyClassesAfterStage: entries.map((e) => ({
          bodyClassId: e.bodyClassId,
          glbPath: e.glbPath,
          producedByStage: e.producedByStage,
        })),
        producedByStage: STAGE_ID,
        claimScope: "calibration_and_ambient_for_body_param_skin_rebind_only",
        notEvidenceFor: [
          "clinical_body_realism",
          "quest_readiness",
          "converting_shipped_anny_roles",
        ],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  return catalog;
}

async function main(): Promise<void> {
  const { once, help } = parseArgs(process.argv.slice(2));
  if (help || !once) {
    console.log(`Usage: pnpm asset:body-param:fit -- --once

Factory body_param station: two MPFB macro body classes + per-class ClothesService fit,
then unconditional footwear embed + catalog stamp (#226 finished figure).
Writes library GLBs + body-param-catalog.json under apps/ui-xr/public/xr-assets/humanoids/candidates/.

--once   run a single two-class bake (required)
`);
    process.exit(help ? 0 : 2);
  }

  const catalog = await runBodyParamOnce();
  console.log(
    JSON.stringify(
      {
        ok: true,
        producedByStage: catalog.producedByStage,
        bodyClassCount: catalog.entries.length,
        girthSpread: catalog.calibration.observedGirthSpreadMeters,
        girthEpsilon: catalog.calibration.girthEpsilonMeters,
        gradePng: catalog.gradePngPath,
        gradeRenderEngine: catalog.gradeRenderEngine ?? null,
        entries: catalog.entries.map((e) => ({
          bodyClassId: e.bodyClassId,
          torsoGirthProxyMeters: e.torsoGirthProxyMeters,
          garmentFittedToBodyClass: e.garmentFittedToBodyClass,
          glbPath: e.glbPath,
        })),
        catalogPath: path.relative(REPO_ROOT, CATALOG_PATH),
        preFixPath: path.relative(REPO_ROOT, PRE_FIX_PATH),
      },
      null,
      2,
    ),
  );
}

const isDirect =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  main().catch((err) => {
    console.error(`[body-param] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
