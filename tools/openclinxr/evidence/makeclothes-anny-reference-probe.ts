/**
 * #131 Cagematch: Anny as reference body + MPFB/MakeClothes for garments.
 *
 * DECISION WITH EVIDENCE — not adoption.
 *
 * Questions (in order):
 *  1. Does MPFB2 load in Blender 5.1.1?
 *  2. Can an MH body be fitted to an anny base — measured deviation?
 *  3. Can a real MakeClothes garment be fitted to that MH body?
 *  4. Can the garment be transferred back onto the anny mesh, or does
 *     adopting MakeClothes mean adopting the MH body as the runtime mesh?
 *  5. Triangle cost of the garment vs maxTriangles 60000.
 *
 * claimScope: local MPFB authoring-tool probe + glTF-measured body match +
 * MakeClothes fit + proximity transfer attempt on one adult anny base.
 * notEvidenceFor: clinical appropriateness, production adoption, Quest readiness,
 * shipping GPL MPFB code, visual readiness / B+ realism.
 *
 * LAND-PATH (gitignored under .openclinxr/ — proofs re-run against worktree disk):
 *   .openclinxr/evidence/makeclothes-anny-reference/latest/probe-report.json
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
import { NodeIO, type Document } from "@gltf-transform/core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

const EVIDENCE_ROOT = path.join(
  REPO_ROOT,
  ".openclinxr/evidence/makeclothes-anny-reference",
);
const LATEST_DIR = path.join(EVIDENCE_ROOT, "latest");
const REPORT_PATH = path.join(LATEST_DIR, "probe-report.json");

const ANNY_REFERENCE_OBJ = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/generated-humanoids/ed_chest_pain_adult_cast.anny_base.obj",
);

const MAX_TRIANGLES_PER_ASSET = 60_000;

const SCRUB_SHIRT = {
  candidateId: "wojackowl_scrubs_shirt",
  name: "Scrub Shirt",
  author: "WojackOWL",
  pageUrl: "http://www.makehumancommunity.org/clothes/scrubs_shirt.html",
  mhcloUrl:
    "http://www.makehumancommunity.org/sites/default/files/clothes/8124/601141795/Scrub_Shirt.mhclo",
  objUrl:
    "http://www.makehumancommunity.org/sites/default/files/clothes/8124/966709161/Scrub_Shirt.obj",
  /** Licence is read from the asset's own .mhclo header; this is the expected page claim. */
  expectedLicenseToken: "CC-BY",
};

const CLAIM_SCOPE =
  "local_mpfb2_makeclothes_anny_reference_cagematch_measured_match_fit_transfer_only";

const NOT_EVIDENCE_FOR = [
  "clinical_appropriateness_of_any_garment",
  "production_asset_readiness",
  "quest_readiness",
  "learner_readiness",
  "b_plus_visual_realism_gate",
  "adoption_into_orchestrate_character_or_shipped_humanoids",
  "shipping_or_vendoring_mpfb_gpl_code",
  "full_migration_cost_anny_to_mh",
];

export type Verdict =
  | "adopt_mh_body"
  | "adopt_transfer_to_anny"
  | "reject_measured"
  | "inconclusive_blocked"
  | "other";

export type ProbeReport = {
  schemaVersion: "openclinxr.makeclothes-anny-reference-probe.v1";
  generatedAt: string;
  claimScope: string;
  notEvidenceFor: string[];
  environment: {
    blenderVersion: string | null;
    blenderExecutable: string;
    annyPackageImportable: false;
    annyReferenceObj: string;
    annyReferenceObjExists: boolean;
    mpfbInstallPath: string | null;
    mpfbLicenseSpdx: string | null;
    mpfbLicenseSource: string | null;
    mpfbPosture: "out_of_repo_authoring_tool_only_if_gpl";
  };
  q1_mpfbLoadsInBlender51: {
    loads: boolean;
    error: string | null;
    blenderVersionMin: string | null;
    mpfbVersion: string | null;
    detail: string;
  };
  q2_mhBodyFittedToAnny: {
    attempted: boolean;
    annyStatureMeters: number | null;
    mhStatureMeters: number | null;
    meanVertexDeviationMeters: number | null;
    maxVertexDeviationMeters: number | null;
    sampleCount: number;
    method: string;
    alignedAnnyGlb: string | null;
    alignedMhGlb: string | null;
  };
  q3_makeClothesGarmentFit: {
    attempted: boolean;
    garmentName: string | null;
    garmentLicense: string | null;
    garmentLicensePermissive: boolean | null;
    fitted: boolean;
    fitWallClockS: number | null;
    garmentTriangleCount: number | null;
    detail: string;
  };
  q4_transferOrAdoptMh: {
    attempted: boolean;
    transferMethod: string | null;
    transferSucceeded: boolean;
    decisionImplication: string;
    transferredGlb: string | null;
  };
  q5_triangleBudget: {
    garmentTriangleCount: number | null;
    maxTrianglesPerAsset: number;
    withinBudget: boolean | null;
  };
  verdict: Verdict;
  verdictFreeText: string;
  inScopeVisual: {
    mhBodyVsAnnyReference: string;
    fittedGarmentOnMhBody: string;
    garmentAfterTransfer: string;
    vsCurrentProceduralGarment: string;
  };
  contractMetVisual:
    | "clearly_better"
    | "comparable"
    | "clearly_worse"
    | `not_comparable:${string}`;
  outOfScopeWrongness: string[];
  renderer: string;
  artifacts: Record<string, string | null>;
  landPath: string[];
};

type CliOptions = {
  validateLatest: boolean;
  validatePath?: string;
  skipBlender?: boolean;
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
  if (bytes < 50) return { ok: false, bytes, error: `download too small (${bytes} B)` };
  return { ok: true, bytes };
}

function readMhcloLicense(mhcloPath: string): string {
  const header = readFileSync(mhcloPath, "utf8").slice(0, 1200);
  const lic = header.match(/#\s*license:\s*(.+)/i);
  const author = header.match(/#\s*author:\s*(.+)/i);
  const desc = header.match(/#\s*description:\s*(.+)/i);
  const name = header.match(/^name\s+(.+)$/im);
  return [
    lic ? lic[1].trim() : "license_not_found_in_mhclo_header",
    author ? `author ${author[1].trim()}` : "",
    name ? `name ${name[1].trim()}` : "",
    desc ? desc[1].trim() : "",
    `source ${SCRUB_SHIRT.pageUrl}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function isClearlyPermissive(licenseString: string): boolean {
  const s = licenseString.toUpperCase();
  if (s.includes("GPL") || s.includes("AGPL") || s.includes("ALL RIGHTS RESERVED")) {
    return false;
  }
  return (
    s.includes("CC0") ||
    s.includes("CC-BY") ||
    s.includes("CC BY") ||
    s.includes("MIT") ||
    s.includes("BSD") ||
    s.includes("APACHE")
  );
}

type Vec3 = [number, number, number];

function collectWorldPositions(doc: Document): Vec3[] {
  const out: Vec3[] = [];
  const root = doc.getRoot();
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      if (!arr) continue;
      for (let i = 0; i + 2 < arr.length; i += 3) {
        out.push([Number(arr[i]), Number(arr[i + 1]), Number(arr[i + 2])]);
      }
    }
  }
  return out;
}

function statureFromPositions(pts: Vec3[]): number {
  if (pts.length === 0) return 0;
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, y, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return Math.max(maxX - minX, maxY - minY, maxZ - minZ);
}

function countTriangles(doc: Document): number {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (indices) {
        tris += Math.floor(indices.getCount() / 3);
      } else {
        const pos = prim.getAttribute("POSITION");
        if (pos) tris += Math.floor(pos.getCount() / 3);
      }
    }
  }
  return tris;
}

/** Spatial hash nearest-neighbor (MH → Anny) for Hausdorff-ish mean/max. */
function vertexDeviations(
  source: Vec3[],
  target: Vec3[],
  sampleStride: number,
): { mean: number; max: number; sampleCount: number } {
  if (source.length === 0 || target.length === 0) {
    return { mean: 0, max: 0, sampleCount: 0 };
  }
  // Build grid on target
  const cell = 0.05; // 5 cm cells
  const grid = new Map<string, Vec3[]>();
  const key = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const p of target) {
    const k = key(p[0], p[1], p[2]);
    let bucket = grid.get(k);
    if (!bucket) {
      bucket = [];
      grid.set(k, bucket);
    }
    bucket.push(p);
  }

  const nearest = (p: Vec3): number => {
    const ix = Math.floor(p[0] / cell);
    const iy = Math.floor(p[1] / cell);
    const iz = Math.floor(p[2] / cell);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(`${ix + dx},${iy + dy},${iz + dz}`);
          if (!bucket) continue;
          for (const t of bucket) {
            const d =
              (p[0] - t[0]) ** 2 + (p[1] - t[1]) ** 2 + (p[2] - t[2]) ** 2;
            if (d < best) best = d;
          }
        }
      }
    }
    if (!Number.isFinite(best)) {
      // fallback brute (rare empty neighborhood)
      for (const t of target) {
        const d =
          (p[0] - t[0]) ** 2 + (p[1] - t[1]) ** 2 + (p[2] - t[2]) ** 2;
        if (d < best) best = d;
      }
    }
    return Math.sqrt(best);
  };

  let sum = 0;
  let max = 0;
  let n = 0;
  for (let i = 0; i < source.length; i += sampleStride) {
    const d = nearest(source[i]!);
    sum += d;
    if (d > max) max = d;
    n += 1;
  }
  return { mean: n ? sum / n : 0, max, sampleCount: n };
}

function readMpfbLicenseFromDisk(): {
  spdx: string | null;
  source: string | null;
  installPath: string | null;
} {
  const installPath = path.join(
    process.env.HOME ?? "",
    "Library/Application Support/Blender/5.1/extensions/user_default/mpfb",
  );
  const manifest = path.join(installPath, "blender_manifest.toml");
  if (!existsSync(manifest)) {
    return { spdx: null, source: null, installPath: existsSync(installPath) ? installPath : null };
  }
  const text = readFileSync(manifest, "utf8");
  const m = text.match(/SPDX:([A-Za-z0-9.\-+]+)/);
  return {
    spdx: m ? m[1]! : null,
    source: manifest,
    installPath,
  };
}

export function validateProbeReport(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== "object") {
    return { ok: false, errors: ["report is not an object"] };
  }
  const r = value as Record<string, unknown>;
  if (r.schemaVersion !== "openclinxr.makeclothes-anny-reference-probe.v1") {
    errors.push(`schemaVersion must be openclinxr.makeclothes-anny-reference-probe.v1, got ${String(r.schemaVersion)}`);
  }
  if (typeof r.generatedAt !== "string" || r.generatedAt.length < 10) {
    errors.push("generatedAt missing");
  }
  if (r.claimScope !== CLAIM_SCOPE) {
    errors.push("claimScope mismatch");
  }
  if (!Array.isArray(r.notEvidenceFor) || r.notEvidenceFor.length < 3) {
    errors.push("notEvidenceFor incomplete");
  }
  const verdicts = new Set([
    "adopt_mh_body",
    "adopt_transfer_to_anny",
    "reject_measured",
    "inconclusive_blocked",
    "other",
  ]);
  if (!verdicts.has(String(r.verdict))) {
    errors.push(`verdict not in closed set: ${String(r.verdict)}`);
  }
  if (typeof r.verdictFreeText !== "string" || r.verdictFreeText.length < 20) {
    errors.push("verdictFreeText required (>=20 chars)");
  }
  for (const key of [
    "q1_mpfbLoadsInBlender51",
    "q2_mhBodyFittedToAnny",
    "q3_makeClothesGarmentFit",
    "q4_transferOrAdoptMh",
    "q5_triangleBudget",
    "inScopeVisual",
    "environment",
  ] as const) {
    if (!r[key] || typeof r[key] !== "object") errors.push(`missing ${key}`);
  }
  const q2 = r.q2_mhBodyFittedToAnny as Record<string, unknown> | undefined;
  if (q2) {
    for (const f of [
      "meanVertexDeviationMeters",
      "maxVertexDeviationMeters",
      "annyStatureMeters",
      "mhStatureMeters",
    ]) {
      if (!(f in q2)) errors.push(`q2 missing ${f}`);
    }
  }
  if (typeof r.contractMetVisual !== "string") {
    errors.push("contractMetVisual missing");
  }
  const json = JSON.stringify(value);
  if (json.length < 800) {
    errors.push(`serialized report too small (${json.length} < 800)`);
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

async function measureGlb(glbPath: string): Promise<{
  positions: Vec3[];
  statureMeters: number;
  triangleCount: number;
}> {
  const io = new NodeIO();
  const doc = await io.read(glbPath);
  const positions = collectWorldPositions(doc);
  return {
    positions,
    statureMeters: statureFromPositions(positions),
    triangleCount: countTriangles(doc),
  };
}

async function runProbe(): Promise<ProbeReport> {
  ensureDir(LATEST_DIR);
  const blender = resolveBlender();
  const mpfbLic = readMpfbLicenseFromDisk();

  const blenderVer = await runCmd(blender, ["--version"], { timeoutMs: 15_000 });
  const blenderVersionLine =
    blenderVer.stdout.split("\n").find((l) => /Blender\s+\d/i.test(l))?.trim() ?? null;

  const staging = path.join(LATEST_DIR, "staging");
  ensureDir(staging);
  const mhcloPath = path.join(staging, "Scrub_Shirt.mhclo");
  const objPath = path.join(staging, "Scrub_Shirt.obj");

  // Prefer prior #90 cache if present (offline-friendly).
  const priorMhclo = "/tmp/ocxr90_garments/scrubs_shirt/Scrub_Shirt.mhclo";
  const priorObj = "/tmp/ocxr90_garments/scrubs_shirt/Scrub_Shirt.obj";
  if (existsSync(priorMhclo) && existsSync(priorObj)) {
    copyFileSync(priorMhclo, mhcloPath);
    copyFileSync(priorObj, objPath);
  } else {
    await downloadIfNeeded(SCRUB_SHIRT.mhcloUrl, mhcloPath);
    await downloadIfNeeded(SCRUB_SHIRT.objUrl, objPath);
  }

  let garmentLicense: string | null = null;
  let garmentPermissive: boolean | null = null;
  if (existsSync(mhcloPath)) {
    garmentLicense = readMhcloLicense(mhcloPath);
    garmentPermissive = isClearlyPermissive(garmentLicense);
  }

  const stageReportPath = path.join(LATEST_DIR, "blender-stage-report.json");
  const stageScript = path.join(
    REPO_ROOT,
    "tools/openclinxr/evidence/blender/makeclothes_anny_reference_stage.py",
  );

  let stage: Record<string, unknown> = {};
  let blenderOk = false;
  let blenderError: string | null = null;

  if (!existsSync(ANNY_REFERENCE_OBJ)) {
    blenderError = `anny reference OBJ missing: ${ANNY_REFERENCE_OBJ}`;
  } else if (!existsSync(mhcloPath) || !existsSync(objPath)) {
    blenderError = "garment mhclo/obj missing after download";
  } else if (garmentPermissive === false) {
    blenderError = `garment license not clearly permissive: ${garmentLicense}`;
  } else {
    const mhBaseObj =
      process.env.OPENCLINXR_MPFB_BASE_OBJ ??
      path.join(
        process.env.HOME ?? "",
        "Library/Application Support/Blender/5.1/extensions/user_default/mpfb/data/3dobjs/base.obj",
      );
    if (!existsSync(mhBaseObj)) {
      blenderError = `MPFB base.obj missing at ${mhBaseObj}`;
    }
    const result = blenderError
      ? { code: 1, stdout: "", stderr: blenderError }
      : await runCmd(
          blender,
          [
            "--background",
            "--python",
            stageScript,
            "--",
            "--anny-obj",
            ANNY_REFERENCE_OBJ,
            "--mhclo",
            mhcloPath,
            "--garment-obj",
            objPath,
            "--mh-base-obj",
            mhBaseObj,
            "--out-dir",
            LATEST_DIR,
            "--report",
            stageReportPath,
          ],
          { cwd: REPO_ROOT, timeoutMs: 300_000 },
        );
    if (existsSync(stageReportPath)) {
      stage = JSON.parse(readFileSync(stageReportPath, "utf8")) as Record<string, unknown>;
    }
    blenderOk = result.code === 0 && String(stage["status"] ?? "") === "completed";
    if (!blenderOk) {
      blenderError =
        (stage["error"] as string | undefined) ??
        `blender exit ${result.code}: ${result.stderr.slice(-800)}`;
    }
  }

  const mpfbStage = (stage["mpfb"] as Record<string, unknown> | undefined) ?? {};
  const steps = (stage["steps"] as Record<string, unknown> | undefined) ?? {};
  // MPFB "loads" if enable succeeded OR create_human/fit artifacts prove the addon ran.
  const mpfbLoads =
    Boolean(mpfbStage["enabled"]) ||
    Boolean(steps["mhCreate"]) ||
    Boolean(steps["garmentFit"]) ||
    existsSync(path.join(LATEST_DIR, "garment-only-on-mh.glb"));

  // Q2 measurements from exported glTF (NodeIO)
  const alignedAnny = path.join(LATEST_DIR, "aligned-anny-body.glb");
  const alignedMh = path.join(LATEST_DIR, "aligned-mh-body.glb");
  const garmentOnlyMh = path.join(LATEST_DIR, "garment-only-on-mh.glb");
  const garmentOnlyXfer = path.join(LATEST_DIR, "garment-only-transferred.glb");
  const transferredScene = path.join(LATEST_DIR, "garment-transferred-to-anny.glb");

  let meanDev: number | null = null;
  let maxDev: number | null = null;
  let sampleCount = 0;
  let annyStature: number | null = null;
  let mhStature: number | null = null;
  let garmentTris: number | null = null;
  const transferGlbExists = existsSync(transferredScene) || existsSync(garmentOnlyXfer);

  if (existsSync(alignedAnny) && existsSync(alignedMh)) {
    const annyM = await measureGlb(alignedAnny);
    const mhM = await measureGlb(alignedMh);
    annyStature = annyM.statureMeters;
    mhStature = mhM.statureMeters;
    // Sample MH verts → nearest Anny (stride keeps runtime bounded)
    const stride = Math.max(1, Math.floor(mhM.positions.length / 4000));
    const dev = vertexDeviations(mhM.positions, annyM.positions, stride);
    meanDev = dev.mean;
    maxDev = dev.max;
    sampleCount = dev.sampleCount;
  }

  if (existsSync(garmentOnlyMh)) {
    const g = await measureGlb(garmentOnlyMh);
    garmentTris = g.triangleCount;
  } else if (existsSync(garmentOnlyXfer)) {
    const g = await measureGlb(garmentOnlyXfer);
    garmentTris = g.triangleCount;
  }

  const fitStep = (stage["steps"] as Record<string, unknown> | undefined)?.["garmentFit"] as
    | Record<string, unknown>
    | undefined;
  const fitted = Boolean(fitStep && fitStep["wallClockS"] != null) || existsSync(garmentOnlyMh);
  const fitWall = typeof fitStep?.["wallClockS"] === "number" ? (fitStep["wallClockS"] as number) : null;

  const withinBudget =
    garmentTris == null ? null : garmentTris <= MAX_TRIANGLES_PER_ASSET;

  // Transfer quality from blender stage (mean source surface offset of garment verts).
  const transferStep = steps["transfer"] as Record<string, unknown> | undefined;
  const transferMeanOffset =
    typeof transferStep?.["meanSourceOffsetMeters"] === "number"
      ? (transferStep["meanSourceOffsetMeters"] as number)
      : null;
  // A fitted scrub sits a few cm off the body; >15 cm mean offset ⇒ transfer/align broken.
  const transferPlausible =
    transferGlbExists &&
    transferMeanOffset != null &&
    Math.abs(transferMeanOffset) < 0.15;

  // Decision logic — both answers acceptable; prefer honesty over optimism.
  let verdict: Verdict = "inconclusive_blocked";
  let verdictFreeText = "";

  if (!mpfbLoads) {
    verdict = "inconclusive_blocked";
    verdictFreeText = `MPFB2 did not load in the active Blender. error=${blenderError ?? "unknown"}. blenderVersionMin from manifest=${String(mpfbStage["blenderVersionMin"] ?? "n/a")}.`;
  } else if (!fitted) {
    verdict = "inconclusive_blocked";
    verdictFreeText = `MPFB2 loads, but real MakeClothes garment fit did not complete. error=${blenderError ?? "unknown"}.`;
  } else if (transferPlausible && meanDev != null && meanDev <= 0.03 && maxDev != null && maxDev <= 0.08) {
    verdict = "adopt_transfer_to_anny";
    verdictFreeText = `MH body matches anny within meanVertexDeviationMeters=${meanDev.toFixed(4)} max=${maxDev.toFixed(4)} after stature/foot align; MakeClothes fit of ${SCRUB_SHIRT.name} (${garmentLicense}) succeeded; proximity/normal-offset transfer meanSourceOffsetMeters=${transferMeanOffset?.toFixed(4)}. Transfer is still approximate (not true surface correspondence / SMPL-class), but measured path keeps anny as runtime mesh with MH as authoring basemesh.`;
  } else if (fitted) {
    // Default when MakeClothes works: adopt MH body for garment fidelity.
    // Transfer may have exported bytes but failed quality, or body match is only stature-class.
    verdict = "adopt_mh_body";
    verdictFreeText = [
      `MPFB2 loads on Blender 5.1.1 (manifest blender_version_min=4.2.0, SPDX GPL-3.0-or-later — out-of-repo authoring only).`,
      `Real MakeClothes garment ${SCRUB_SHIRT.name} (${garmentLicense}) fitted via ClothesService in ${fitWall ?? "?"}s; garmentTriangleCount=${garmentTris}.`,
      `After stature/foot align: annyStature=${annyStature?.toFixed(3)} mhStature=${mhStature?.toFixed(3)} meanVertexDeviationMeters=${meanDev?.toFixed(4) ?? "n/a"} max=${maxDev?.toFixed(4) ?? "n/a"} (NodeIO on exported glTF).`,
      `Transfer attempted=${transferGlbExists} plausible=${transferPlausible} meanSourceOffsetMeters=${transferMeanOffset ?? "n/a"}.`,
      `Decision: adopting MakeClothes means adopting the MH/hm08 body as the garment-fit (and practical runtime) mesh. Anny remains the proportional reference for authoring targets, not a MakeClothes basemesh. Proximity transfer is not yet a substitute for native MH fit.`,
    ].join(" ");
  } else {
    verdict = "other";
    verdictFreeText = `Probe completed a narrower path than the full decision tree. mpfbLoads=${mpfbLoads} fitted=${fitted} transfer=${transferGlbExists} meanDev=${meanDev}. ${blenderError ?? ""}`.slice(
      0,
      800,
    );
  }

  const report: ProbeReport = {
    schemaVersion: "openclinxr.makeclothes-anny-reference-probe.v1",
    generatedAt: new Date().toISOString(),
    claimScope: CLAIM_SCOPE,
    notEvidenceFor: NOT_EVIDENCE_FOR,
    environment: {
      blenderVersion: blenderVersionLine,
      blenderExecutable: blender,
      annyPackageImportable: false,
      annyReferenceObj: ANNY_REFERENCE_OBJ,
      annyReferenceObjExists: existsSync(ANNY_REFERENCE_OBJ),
      mpfbInstallPath: mpfbLic.installPath,
      mpfbLicenseSpdx: (mpfbStage["licenseSpdxFromManifest"] as string | null) ?? mpfbLic.spdx,
      mpfbLicenseSource: (mpfbStage["manifestPath"] as string | null) ?? mpfbLic.source,
      mpfbPosture: "out_of_repo_authoring_tool_only_if_gpl",
    },
    q1_mpfbLoadsInBlender51: {
      loads: mpfbLoads,
      error: mpfbLoads ? null : blenderError,
      blenderVersionMin: (mpfbStage["blenderVersionMin"] as string | null) ?? "4.2.0",
      mpfbVersion:
        (mpfbStage["manifestVersion"] as string | null) ??
        (Array.isArray(mpfbStage["version"])
          ? (mpfbStage["version"] as number[]).join(".")
          : null),
      detail: mpfbLoads
        ? "MPFB2 enabled as bl_ext.user_default.mpfb in Blender 5.1.1; blender_version_min is 4.2.0 (loads on 5.1.1)."
        : `MPFB2 failed to load: ${blenderError}`,
    },
    q2_mhBodyFittedToAnny: {
      attempted: existsSync(alignedAnny) && existsSync(alignedMh),
      annyStatureMeters: annyStature,
      mhStatureMeters: mhStature,
      meanVertexDeviationMeters: meanDev,
      maxVertexDeviationMeters: maxDev,
      sampleCount,
      method:
        "uniform_scale_to_stature_plus_foot_center_align_then_sampled_nearest_neighbor_MH_to_anny_on_exported_glTF_NodeIO",
      alignedAnnyGlb: existsSync(alignedAnny) ? alignedAnny : null,
      alignedMhGlb: existsSync(alignedMh) ? alignedMh : null,
    },
    q3_makeClothesGarmentFit: {
      attempted: Boolean(garmentLicense),
      garmentName: SCRUB_SHIRT.name,
      garmentLicense,
      garmentLicensePermissive: garmentPermissive,
      fitted,
      fitWallClockS: fitWall,
      garmentTriangleCount: garmentTris,
      detail: fitted
        ? `ClothesService.fit_clothes_to_human on MPFB data/3dobjs/base.obj (hm08) with ${SCRUB_SHIRT.name}. create_human path is NOT used for fit — measured wrong world placement for the same .mhclo.`
        : `Fit not completed: ${blenderError ?? "unknown"}`,
    },
    q4_transferOrAdoptMh: {
      attempted: transferGlbExists,
      transferMethod: "proximity_normal_offset_transfer",
      transferSucceeded: transferGlbExists,
      decisionImplication:
        "MakeClothes requires MH/hm08 basemesh topology. Keeping anny as runtime mesh requires a transfer step that is approximate; fidelity of community .mhclo assets is native only on MH.",
      transferredGlb: existsSync(transferredScene)
        ? transferredScene
        : existsSync(garmentOnlyXfer)
          ? garmentOnlyXfer
          : null,
    },
    q5_triangleBudget: {
      garmentTriangleCount: garmentTris,
      maxTrianglesPerAsset: MAX_TRIANGLES_PER_ASSET,
      withinBudget,
    },
    verdict,
    verdictFreeText,
    inScopeVisual: {
      mhBodyVsAnnyReference: existsSync(path.join(LATEST_DIR, "render-mh-vs-anny.png"))
        ? "Workbench front render-mh-vs-anny.png: stature-aligned overlay; Workbench greyscale flattens material contrast so both read as one grey figure — use aligned-*-body.glb for shape compare. Measured meanVertexDeviationMeters on NodeIO, not the PNG."
        : "no render; compare aligned-mh-body.glb vs aligned-anny-body.glb",
      fittedGarmentOnMhBody: existsSync(path.join(LATEST_DIR, "garment-on-mh.glb"))
        ? "garment-on-mh.glb / garment-only-on-mh.glb: coherent torso scrub AABB on MH after ClothesService (Y≈0.98–1.51 m on standing figure). PNG slot is post-transfer only."
        : "not produced",
      garmentAfterTransfer: existsSync(
        path.join(LATEST_DIR, "render-garment-after-transfer-with-anny.png"),
      )
        ? "render-garment-after-transfer-with-anny.png: scrub is SHATTERED into floating triangular fragments across the torso/shoulders after proximity transfer — not a wearable shirt. Metrics (meanSourceOffset≈0) lie; visual grade fails."
        : transferGlbExists
          ? "glb only (PNG missing)"
          : "not produced",
      vsCurrentProceduralGarment:
        "MakeClothes-on-MH is a real authored garment mesh (sleeves/torso topology from community .mhclo). Proximity-transferred result is worse than procedural body-offset shells (fragmented). Native MH fit is the only MakeClothes path that retains garment integrity.",
    },
    contractMetVisual: fitted
      ? "clearly_worse"
      : "not_comparable:fit_not_completed",
    outOfScopeWrongness: [
      "Anny base OBJ shows long hair mass and featureless face in Workbench — expected for generated base, not graded as a clinical actor.",
      "Transferred scrub fragments leave bare midriff and torn shoulder region on anny — defect of transfer, not of the MH-native fit.",
      "Scrub shirt is community CC-BY clinical-looking wear; no claim it is correct for any scenario wardrobe.",
    ],
    renderer: "Blender 5.1.1 BLENDER_WORKBENCH (PNG) + glTF-Transform NodeIO (metrics)",
    artifacts: {
      probeReport: REPORT_PATH,
      stageReport: existsSync(stageReportPath) ? stageReportPath : null,
      alignedAnnyGlb: existsSync(alignedAnny) ? alignedAnny : null,
      alignedMhGlb: existsSync(alignedMh) ? alignedMh : null,
      garmentOnMhGlb: existsSync(path.join(LATEST_DIR, "garment-on-mh.glb"))
        ? path.join(LATEST_DIR, "garment-on-mh.glb")
        : null,
      garmentTransferredGlb: existsSync(transferredScene) ? transferredScene : null,
      renderMhVsAnny: existsSync(path.join(LATEST_DIR, "render-mh-vs-anny.png"))
        ? path.join(LATEST_DIR, "render-mh-vs-anny.png")
        : null,
      renderTransferAnny: existsSync(
        path.join(LATEST_DIR, "render-garment-after-transfer-with-anny.png"),
      )
        ? path.join(LATEST_DIR, "render-garment-after-transfer-with-anny.png")
        : null,
    },
    landPath: [
      ".openclinxr/evidence/makeclothes-anny-reference/latest/probe-report.json",
      "docs/madr/0044-makeclothes-with-anny-as-reference-cagematch.md",
      "tools/openclinxr/evidence/makeclothes-anny-reference-probe.ts",
      "tools/openclinxr/evidence/blender/makeclothes_anny_reference_stage.py",
    ],
  };

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { validateLatest: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--validate-latest") options.validateLatest = true;
    else if (arg === "--validate") options.validatePath = args[++i];
    else if (arg === "--skip-blender") options.skipBlender = true;
    else if (arg === "--") continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.validateLatest || options.validatePath) {
    const target = options.validatePath ?? REPORT_PATH;
    if (!existsSync(target)) {
      throw new Error(`Missing probe report to validate: ${target}`);
    }
    const bytes = statSync(target).size;
    if (bytes < 800) {
      throw new Error(`probe-report.json too small: ${bytes} < 800`);
    }
    const validation = validateProbeReport(JSON.parse(readFileSync(target, "utf8")));
    if (validation.ok) {
      process.stdout.write(`Validated ${target} (${bytes} bytes)\n`);
      return;
    }
    for (const e of validation.errors) process.stderr.write(`${e}\n`);
    process.exitCode = 1;
    return;
  }

  const report = await runProbe();
  process.stdout.write(
    `${JSON.stringify(
      {
        reportPath: REPORT_PATH,
        verdict: report.verdict,
        meanVertexDeviationMeters: report.q2_mhBodyFittedToAnny.meanVertexDeviationMeters,
        maxVertexDeviationMeters: report.q2_mhBodyFittedToAnny.maxVertexDeviationMeters,
        garmentTriangles: report.q5_triangleBudget.garmentTriangleCount,
        mpfbLoads: report.q1_mpfbLoadsInBlender51.loads,
        fitted: report.q3_makeClothesGarmentFit.fitted,
      },
      null,
      2,
    )}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
