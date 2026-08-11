/**
 * #215 MakeClothes factory fit CLI — clothing station consumption path.
 *
 * `pnpm asset:makeclothes:fit -- --once`
 *
 * Invokes ClothesService via tools/openclinxr/asset-pipeline/makeclothes/fit_stage.py
 * (Blender user-extension MPFB, not vendored). Writes:
 *   - library GLB under apps/ui-xr/public/xr-assets/humanoids/candidates/
 *   - catalog + stage report next to that GLB (tracked candidates/ — clean clones keep them)
 *   - fitted-garment-grade.png under .openclinxr/evidence/issue-215/ (grade only)
 *
 * Anti-cheat: this is a real stage, not a wrapper that copies the cagematch probe output.
 * Inspect (makeclothes-library-consumed.ts) may only trust entries this command stamps.
 *
 * claimScope: factory library production + provenance.
 * notEvidenceFor: clinical wardrobe, Quest readiness, Anny cast conversion, GPL vendoring.
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
// #275 — single source of truth for the factory's FALLBACK upper garment identity.
import { HM08_UPPER_GARMENT_FALLBACK_MESH_PREFIX } from "./garment-selection-by-role.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");

export const STAGE_ID = "makeclothes_fit_stage";
export const LIBRARY_GARMENT_ID = "wojackowl_scrubs_shirt_hm08";
export const LIBRARY_GLB_BASENAME = "makeclothes-hm08-scrub-shirt-library.glb";
export const LIBRARY_GLB_PUBLIC_PATH =
  `/xr-assets/humanoids/candidates/${LIBRARY_GLB_BASENAME}`;
export const LIBRARY_GLB_DISK = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/xr-assets/humanoids/candidates",
  LIBRARY_GLB_BASENAME,
);
export const EVIDENCE_DIR = path.join(REPO_ROOT, ".openclinxr/evidence/issue-215");
/** #226 — catalog must NOT live under gitignored evidence (clean-clone / #217 class). */
export const CATALOG_PATH = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/xr-assets/humanoids/candidates/makeclothes-library-catalog.json",
);
export const STAGE_REPORT_PATH = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/xr-assets/humanoids/candidates/makeclothes-fit-stage-report.json",
);
export const GRADE_PNG_PATH = path.join(EVIDENCE_DIR, "fitted-garment-grade.png");
export const STAGING_DIR = path.join(EVIDENCE_DIR, "staging");

const SCRUB = {
  candidateId: "wojackowl_scrubs_shirt",
  name: "Scrub Shirt",
  author: "WojackOWL",
  pageUrl: "http://www.makehumancommunity.org/clothes/scrubs_shirt.html",
  mhcloUrl:
    "http://www.makehumancommunity.org/sites/default/files/clothes/8124/601141795/Scrub_Shirt.mhclo",
  objUrl:
    "http://www.makehumancommunity.org/sites/default/files/clothes/8124/966709161/Scrub_Shirt.obj",
  expectedLicenseToken: "CC-BY",
};

const ANNY_REFERENCE_OBJ = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/generated-humanoids/ed_chest_pain_adult_cast.anny_base.obj",
);

const STAGE_SCRIPT = path.join(HERE, "fit_stage.py");

export type LibraryCatalogEntry = {
  garmentId: string;
  bodyClass: string;
  glbPath: string;
  glbPublicPath: string;
  garmentMeshNames: string[];
  garmentTriangleCount: number;
  licenseToken: string;
  licenseSource: string;
  producedByStage: string;
  mhcloPath: string;
  stageReportPath: string;
  clothesServiceApi: string;
  fitWallClockS: number | null;
  glbSha256: string;
  gradePngPath: string;
};

export type LibraryCatalog = {
  schemaVersion: "openclinxr.makeclothes-library-catalog.v1";
  generatedAt: string;
  producedByStage: typeof STAGE_ID;
  claimScope: string;
  notEvidenceFor: string[];
  entries: LibraryCatalogEntry[];
  stageReportPath: string;
  blenderExecutable: string;
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

/**
 * Licence token + source string from the asset's own .mhclo header (not the download page).
 *
 * Community .mhclo headers use several shapes (#215 scrub uses `# license: CC-BY`;
 * Cortu pants pack uses `# Cortu Johnstone - CC0`; some use `# license CC0` without colon).
 * Only the .mhclo header is authoritative — MakeClothes-exported .obj often stamps AGPL3
 * for the *tool*, which must not be mistaken for the garment licence.
 */
export function readMhcloLicense(mhcloPath: string): {
  token: string;
  source: string;
  rawHeader: string;
} {
  const header = readFileSync(mhcloPath, "utf8").slice(0, 1600);
  const licColon = header.match(/#\s*license:\s*(.+)/i);
  const licSpace = header.match(/#\s*license\s+(CC0|CC-?BY[^\n]*)/i);
  // e.g. "# Cortu Johnstone - CC0"
  const authorDashCc = header.match(
    /#\s*([^\n]*?)\s*[-–—]\s*(CC0|CC-?BY(?:\s*[0-9.]+)?(?:\s*[^#\n]*)?)\s*$/im,
  );
  const anyCc = header.match(/\b(CC0|CC-?BY(?:\s*[0-9.]+)?|public\s+domain)\b/i);
  const author = header.match(/#\s*author:\s*(.+)/i);

  let token = "license_not_found_in_mhclo_header";
  if (licColon) token = licColon[1]!.trim();
  else if (licSpace) token = licSpace[1]!.trim();
  else if (authorDashCc) token = authorDashCc[2]!.trim();
  else if (anyCc) token = anyCc[1]!.trim();

  const source = [
    `mhclo_header:${path.basename(mhcloPath)}`,
    `license=${token}`,
    author
      ? `author=${author[1]!.trim()}`
      : authorDashCc
        ? `author=${authorDashCc[1]!.trim()}`
        : "",
    `path=${mhcloPath}`,
  ]
    .filter(Boolean)
    .join("; ");
  return { token, source, rawHeader: header };
}

/** Permitted factory wardrobe tokens (copyleft refused regardless of convenience). */
export function isPermittedGarmentLicense(token: string): boolean {
  return /cc0|cc-?by|public\s*domain/i.test(token) && !/agpl|gpl(?!\s*font)/i.test(token);
}

/**
 * #220 lower-body garment candidates examined for find-or-stop.
 * Licence is always re-read from the local .mhclo header when the file exists —
 * never invented. Remote pack URLs may 404; local staging is the factory input.
 */
export type LowerGarmentCandidateRecord = {
  garmentId: string;
  sourceUrl: string;
  /** Local relative path when staged; empty if never downloaded. */
  localMhcloRel: string;
  localObjRel: string;
  /** Preference notes for selection among multiple CC0 options. */
  selectionNote: string;
};

export const LOWER_GARMENT_CANDIDATES: LowerGarmentCandidateRecord[] = [
  {
    garmentId: "cortu_cargo_pants",
    // #310 — source acquired from the makehumancommunity pants01 CC0 pack (author Cortu
    // Johnstone) and cached under the tracked provider cache. Cached as `cargo_pants.mhclo`
    // (the asset's internal name; the pack's original filename is `cortu_cargo_pants.mhclo`).
    // Ledger row: `makehuman-pants01` (2026-08-11).
    sourceUrl:
      "https://static.makehumancommunity.org/assets/assetpacks/pants01.html (CC0 pack; cortu_cargo_pants by Cortu Johnstone; cached: .openclinxr-local/provider-cache/garments/sources/makehuman-pants01/cortu_cargo_pants/)",
    localMhcloRel:
      ".openclinxr-local/provider-cache/garments/sources/makehuman-pants01/cortu_cargo_pants/cargo_pants.mhclo",
    localObjRel:
      ".openclinxr-local/provider-cache/garments/sources/makehuman-pants01/cortu_cargo_pants/cargo_pants.obj",
    selectionNote: "full-length cargo pants; clinical/scrub-adjacent silhouette preferred",
  },
  {
    garmentId: "cortu_jeans_shorts",
    sourceUrl:
      "https://static.makehumancommunity.org/assets/assetpacks/pants01.html (CC0 pack; cortu_jeans_shorts by Cortu Johnstone; pack acquired 2026-08-11, shorts not cached)",
    localMhcloRel: "",
    localObjRel: "",
    selectionNote: "shorts (above-knee) — rejected when cargo pants available",
  },
  {
    garmentId: "toigo_wool_pants",
    sourceUrl:
      "https://static.makehumancommunity.org/assets/assetpacks/pants01.html (CC0 pack; toigo_wool_pants by MargaretToigo; pack acquired 2026-08-11, wool pants not cached)",
    localMhcloRel: "",
    localObjRel: "",
    selectionNote: "wool texture not clinical/scrub style",
  },
  {
    garmentId: "toigo_harem_pants",
    sourceUrl:
      "https://static.makehumancommunity.org/assets/assetpacks/pants01.html (CC0 pack; toigo_harem_pants by MargaretToigo; pack acquired 2026-08-11, harem pants not cached)",
    localMhcloRel: "",
    localObjRel: "",
    selectionNote: "harem style not clinical",
  },
];

export const LIBRARY_LOWER_GARMENT_ID = "cortu_cargo_pants_hm08";
export const LIBRARY_LOWER_MESH_PREFIX = "makeclothes_library_cargo_pants";

export type ExaminedLowerGarment = {
  garmentId: string;
  sourceUrl: string;
  licenseToken: string;
  accepted: boolean;
  rejectionReason: string | null;
  localMhcloPath: string | null;
  localObjPath: string | null;
};

/**
 * Find-or-stop search: re-read every candidate's .mhclo header when present.
 * Accepts the first permitted full-length lower garment (CC0 / CC-BY).
 * Does NOT invent asset ids — unstaged candidates record license_not_found and reject.
 */
export function examineLowerGarmentCandidates(repoRoot: string = REPO_ROOT): ExaminedLowerGarment[] {
  const out: ExaminedLowerGarment[] = [];
  let acceptedOne = false;
  for (const c of LOWER_GARMENT_CANDIDATES) {
    const mhcloAbs = c.localMhcloRel ? path.join(repoRoot, c.localMhcloRel) : "";
    const objAbs = c.localObjRel ? path.join(repoRoot, c.localObjRel) : "";
    const hasFiles =
      Boolean(mhcloAbs) &&
      existsSync(mhcloAbs) &&
      Boolean(objAbs) &&
      existsSync(objAbs) &&
      statSync(mhcloAbs).size > 50 &&
      statSync(objAbs).size > 50;

    if (!hasFiles) {
      out.push({
        garmentId: c.garmentId,
        sourceUrl: c.sourceUrl,
        licenseToken: "license_not_found_in_mhclo_header",
        accepted: false,
        rejectionReason:
          "asset not present locally and remote asset_packs/pants01 URL returned 404 — cannot invent a licence token without the .mhclo header",
        localMhcloPath: null,
        localObjPath: null,
      });
      continue;
    }

    const license = readMhcloLicense(mhcloAbs);
    const permitted = isPermittedGarmentLicense(license.token);
    const isShorts = /short/i.test(c.garmentId);
    let accepted = false;
    let rejectionReason: string | null = null;
    if (!permitted) {
      rejectionReason = `licence "${license.token}" is not CC0/CC-BY (copyleft or unknown refused)`;
    } else if (isShorts) {
      rejectionReason =
        "shorts (above-knee) — cargo pants preferred as primary full-length lower garment";
    } else if (acceptedOne) {
      rejectionReason = "another permitted full-length lower garment already accepted";
    } else if (/wool|harem/i.test(c.garmentId) && /cargo/i.test(LIBRARY_LOWER_GARMENT_ID)) {
      rejectionReason = c.selectionNote;
    } else {
      accepted = true;
      acceptedOne = true;
    }

    out.push({
      garmentId: c.garmentId,
      sourceUrl: c.sourceUrl,
      licenseToken: license.token,
      accepted,
      rejectionReason,
      localMhcloPath: mhcloAbs,
      localObjPath: objAbs,
    });
  }
  return out;
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

export async function runMakeclothesFitOnce(): Promise<LibraryCatalog> {
  ensureDir(EVIDENCE_DIR);
  ensureDir(STAGING_DIR);
  ensureDir(path.dirname(LIBRARY_GLB_DISK));

  if (!existsSync(STAGE_SCRIPT)) {
    throw new Error(`fit stage script missing: ${STAGE_SCRIPT}`);
  }

  const mhcloPath = path.join(STAGING_DIR, "Scrub_Shirt.mhclo");
  const objPath = path.join(STAGING_DIR, "Scrub_Shirt.obj");
  const priorMhclo = "/tmp/ocxr90_garments/scrubs_shirt/Scrub_Shirt.mhclo";
  const priorObj = "/tmp/ocxr90_garments/scrubs_shirt/Scrub_Shirt.obj";
  if (existsSync(priorMhclo) && existsSync(priorObj)) {
    copyFileSync(priorMhclo, mhcloPath);
    copyFileSync(priorObj, objPath);
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

  const mhBaseObj =
    process.env.OPENCLINXR_MPFB_BASE_OBJ ??
    path.join(
      process.env.HOME ?? "",
      "Library/Application Support/Blender/5.1/extensions/user_default/mpfb/data/3dobjs/base.obj",
    );
  if (!existsSync(mhBaseObj)) {
    throw new Error(`MPFB base.obj missing at ${mhBaseObj} — install MPFB as Blender user extension`);
  }

  const blender = resolveBlender();
  const tmpGlb = path.join(EVIDENCE_DIR, "work", LIBRARY_GLB_BASENAME);
  const tmpGrade = path.join(EVIDENCE_DIR, "work", "fitted-garment-grade.png");
  ensureDir(path.dirname(tmpGlb));

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
    "--out-glb",
    tmpGlb,
    "--out-grade-png",
    tmpGrade,
    "--report",
    STAGE_REPORT_PATH,
    // #275 — authoritative mesh name from the shared selection module; the Python
    // argparse default is only a raw-invocation fallback.
    "--garment-mesh-name",
    HM08_UPPER_GARMENT_FALLBACK_MESH_PREFIX,
  ];
  if (existsSync(ANNY_REFERENCE_OBJ)) {
    blenderArgs.push("--anny-obj", ANNY_REFERENCE_OBJ);
  }

  const result = await runCmd(blender, blenderArgs, {
    cwd: REPO_ROOT,
    timeoutMs: 600_000,
  });

  if (!existsSync(STAGE_REPORT_PATH)) {
    throw new Error(
      `stage report missing after blender (exit ${result.code}): ${result.stderr.slice(-600)}`,
    );
  }
  const stage = JSON.parse(readFileSync(STAGE_REPORT_PATH, "utf8")) as Record<string, unknown>;
  if (stage["status"] !== "completed") {
    throw new Error(
      `fit stage status=${String(stage["status"])} errors=${JSON.stringify(stage["errors"] ?? [])} ` +
        `stderr=${result.stderr.slice(-600)}`,
    );
  }
  const steps = (stage["steps"] as Record<string, unknown> | undefined) ?? {};
  const fitStep = steps["clothesServiceFit"] as Record<string, unknown> | undefined;
  if (!fitStep || fitStep["api"] !== "ClothesService.fit_clothes_to_human") {
    throw new Error(
      "fit stage did not record ClothesService.fit_clothes_to_human — refusing probe-copy cheat",
    );
  }
  if (stage["producedByStage"] !== STAGE_ID) {
    throw new Error(`producedByStage mismatch: ${String(stage["producedByStage"])}`);
  }
  if (!existsSync(tmpGlb) || statSync(tmpGlb).size < 10_000) {
    throw new Error(`library GLB missing or too small: ${tmpGlb}`);
  }
  if (!existsSync(tmpGrade) || statSync(tmpGrade).size < 1_000) {
    throw new Error(`grade PNG missing or too small: ${tmpGrade}`);
  }

  // Promote into runtime-resolvable candidates path + evidence grade path
  copyFileSync(tmpGlb, LIBRARY_GLB_DISK);
  copyFileSync(tmpGrade, GRADE_PNG_PATH);

  // #275 — the scrub shirt is the factory FALLBACK upper garment, not a hardcoded
  // exclusive. This single-library station IS the fallback library (a library GLB,
  // not a case-driven per-class fit); the case-driven selection lives in the
  // body-param rail. The default is sourced from the shared constant.
  const garmentMeshNames = Array.isArray(stage["garmentMeshNames"])
    ? (stage["garmentMeshNames"] as string[])
    : [
        String(
          fitStep["garmentMeshName"] ?? HM08_UPPER_GARMENT_FALLBACK_MESH_PREFIX,
        ),
      ];
  const garmentTriangleCount =
    typeof fitStep["garmentTriangleEstimate"] === "number"
      ? (fitStep["garmentTriangleEstimate"] as number)
      : 0;
  const fitWallClockS =
    typeof fitStep["wallClockS"] === "number" ? (fitStep["wallClockS"] as number) : null;

  // Relative glbPath for catalog (repo-relative) — inspect resolves against REPO_ROOT
  const glbRepoRelative = path.relative(REPO_ROOT, LIBRARY_GLB_DISK).split(path.sep).join("/");

  const entry: LibraryCatalogEntry = {
    garmentId: LIBRARY_GARMENT_ID,
    bodyClass: "hm08",
    glbPath: glbRepoRelative,
    glbPublicPath: LIBRARY_GLB_PUBLIC_PATH,
    garmentMeshNames,
    garmentTriangleCount,
    licenseToken: license.token,
    licenseSource: license.source,
    producedByStage: STAGE_ID,
    mhcloPath: path.relative(REPO_ROOT, mhcloPath).split(path.sep).join("/"),
    stageReportPath: path.relative(REPO_ROOT, STAGE_REPORT_PATH).split(path.sep).join("/"),
    clothesServiceApi: "ClothesService.fit_clothes_to_human",
    fitWallClockS,
    glbSha256: sha256File(LIBRARY_GLB_DISK),
    gradePngPath: path.relative(REPO_ROOT, GRADE_PNG_PATH).split(path.sep).join("/"),
  };

  const catalog: LibraryCatalog = {
    schemaVersion: "openclinxr.makeclothes-library-catalog.v1",
    generatedAt: new Date().toISOString(),
    producedByStage: STAGE_ID,
    claimScope:
      "factory_makeclothes_fit_stage_one_cc_by_scrub_on_hm08_library_glb_with_provenance",
    notEvidenceFor: [
      "clinical_appropriateness",
      "quest_readiness",
      "converting_shipped_anny_roles",
      "shipping_mpfb_gpl",
      "full_body_migration",
    ],
    entries: [entry],
    stageReportPath: path.relative(REPO_ROOT, STAGE_REPORT_PATH).split(path.sep).join("/"),
    blenderExecutable: blender,
  };

  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf8");

  // Provenance sidecar next to the GLB
  const provenancePath = LIBRARY_GLB_DISK.replace(/\.glb$/i, ".provenance.json");
  writeFileSync(
    provenancePath,
    JSON.stringify(
      {
        schemaVersion: "openclinxr.makeclothes-library-glb-provenance.v1",
        producedByStage: STAGE_ID,
        garmentId: LIBRARY_GARMENT_ID,
        bodyClass: "hm08",
        licenseToken: license.token,
        licenseSource: license.source,
        mhcloBasename: path.basename(mhcloPath),
        clothesServiceApi: "ClothesService.fit_clothes_to_human",
        glbSha256: entry.glbSha256,
        generatedAt: catalog.generatedAt,
        notEvidenceFor: catalog.notEvidenceFor,
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
    console.log(`Usage: pnpm asset:makeclothes:fit -- --once

Factory clothing station: fit one CC-BY .mhclo onto hm08 via ClothesService and
write a library GLB + catalog under apps/ui-xr/public/xr-assets/humanoids/candidates/.

--once   run a single fit (required; no batch mode yet)
`);
    process.exit(help ? 0 : 2);
  }

  console.log(`[makeclothes-fit] stage=${STAGE_ID} starting…`);
  const catalog = await runMakeclothesFitOnce();
  const e = catalog.entries[0]!;
  console.log(
    JSON.stringify(
      {
        ok: true,
        producedByStage: catalog.producedByStage,
        garmentId: e.garmentId,
        glbPath: e.glbPath,
        garmentTriangleCount: e.garmentTriangleCount,
        licenseToken: e.licenseToken,
        licenseSource: e.licenseSource,
        fitWallClockS: e.fitWallClockS,
        catalogPath: path.relative(REPO_ROOT, CATALOG_PATH),
        gradePng: path.relative(REPO_ROOT, GRADE_PNG_PATH),
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
    console.error(`[makeclothes-fit] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
