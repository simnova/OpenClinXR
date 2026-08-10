/**
 * #272 — garment region coverage of the shipped body-param library figures.
 *
 * Drives the shared pure-numpy predicate `garment_coverage.py` (the same module the
 * `body_param_stage.py` factory gate imports) against the SHIPPED library GLBs under
 * `apps/ui-xr/public/xr-assets/humanoids/candidates/`.
 *
 * Measured defect (#272): the spouse's lower garment is
 * `makeclothes_library_cargo_pants_adult_lean_female` at 392 triangles / 211
 * position-welded vertices / 32 open boundary edges — a sparse partial shell. It covers
 * ~71% of the leg region's outward surface (the rest is bare skin through the gaps →
 * "translucent legs"), while the same body's scrub shirt (9,384 tris, closed shell)
 * reads as a proper garment. `ClothesService.fit_clothes_to_human` never alters garment
 * topology (it only repositions vertices per the mhclo mapping), so the 392-triangle
 * trouser is the source asset's own geometry, not something the fit "emitted".
 *
 * claimScope: coverage of a body region by a garment surface — factory gate + evidence.
 * notEvidenceFor: garment quality/aesthetics, clinical wardrobe, Quest readiness,
 * cloth physics, animation deformation (a sparse shell may cover statically and tear
 * under motion; the stage fallback replaces it regardless when below threshold).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Accessor, type Mesh } from "@gltf-transform/core";

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");

export const CANDIDATES_DIR = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/xr-assets/humanoids/candidates",
);
export const COVERAGE_MODULE = path.join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/garment_coverage.py",
);

/** Cloth standoff the factory applies so garments sit OUTSIDE the skin (meters). */
export const CLOTH_STANDOFF_M = 0.015;
/** Leg-band ankle floor: shoes/feet begin below this (body-min-Y + ankle offset). */
export const ANKLE_OFFSET_M = 0.10;

/**
 * Garment-name classification by underscore/snake-case tokens. The original bare
 * /cloth/ arm matched the "makeCLOTHes_…" prefix of EVERY library garment mesh, so
 * upperGarmentMeshName reported the trousers' name while the measured geometry stayed
 * correct (the classification else-if chain caught cargo pants as `lower` first).
 * Token sets dodge both substring accidents: no boundary between "library_cargo",
 * and no "cloth" token in "makeclothes".
 */
function garmentNameTokens(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
}
function isLowerGarmentName(name: string): boolean {
  const t = garmentNameTokens(name);
  return t.some((tok) => tok.includes("pant") || tok.includes("trouser"));
}
function isUpperGarmentName(name: string): boolean {
  const t = garmentNameTokens(name);
  return t.some((tok) => tok === "scrub" || tok === "scrubs" || tok.includes("shirt") || tok === "garment" || tok === "gown");
}

export type CoverageRow = {
  garmentLabel: string;
  regionBandY: [number, number];
  regionFaceCount: number;
  sampledFaceCount: number;
  outwardRaycastCoverage: number;
  garmentBoundaryEdges: number;
  garmentAdherence: number;
  verdict: "covers" | "does_not_cover";
  reason: string;
};

export type FigureCoverage = {
  bodyClassId: string;
  glbPath: string;
  lowerGarmentMeshName: string | null;
  lowerGarmentTriangleCount: number;
  upperGarmentMeshName: string | null;
  upperGarmentTriangleCount: number;
  lower: CoverageRow | null;
  upper: CoverageRow | null;
};

export type Report = {
  figures: FigureCoverage[];
  coverShell: {
    label: string;
    vertexCount: number;
    faceCount: number;
    coverage: CoverageRow;
  } | null;
  claimScope: string;
  notEvidenceFor: string[];
};

type MeshGeometry = { position: number[]; indices: number[]; triangles: number };

function meshData(mesh: Mesh): MeshGeometry {
  const position: number[] = [];
  const indices: number[] = [];
  let triangles = 0;
  const tmp: number[] = [0, 0, 0];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION") as Accessor | null;
    const idx = prim.getIndices();
    if (!pos || !idx) continue;
    const base = position.length / 3;
    for (let i = 0; i < pos.getCount(); i += 1) {
      pos.getElement(i, tmp);
      position.push(tmp[0]!, tmp[1]!, tmp[2]!);
    }
    for (let i = 0; i < idx.getCount(); i += 1) {
      indices.push(idx.getScalar(i) + base);
    }
    triangles += Math.floor(idx.getCount() / 3);
  }
  return { position, indices, triangles };
}

function bounds(position: number[]): { min: [number, number, number]; max: [number, number, number] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      const v = position[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min: min as [number, number, number], max: max as [number, number, number] };
}

async function runPython(args: string[], label: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("python3", args, {
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
      env: process.env,
    });
    return stdout;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    throw new Error(
      `garment_coverage.py failed for ${label} (exit ${e.code}): ${String(e.stderr ?? e).slice(-800)}`,
    );
  }
}

async function runCoverageReport(args: {
  body: MeshGeometry;
  garment: MeshGeometry;
  bandLo: number;
  bandHi: number;
  label: string;
  tmpDir: string;
}): Promise<CoverageRow> {
  const bodyPath = path.join(args.tmpDir, `body-${args.label}.json`);
  const garmentPath = path.join(args.tmpDir, `garment-${args.label}.json`);
  const outPath = path.join(args.tmpDir, `report-${args.label}.json`);
  await Promise.all([
    writeFile(bodyPath, JSON.stringify(args.body)),
    writeFile(garmentPath, JSON.stringify(args.garment)),
  ]);
  await runPython(
    [
      COVERAGE_MODULE,
      "--mode",
      "coverage-report",
      "--body",
      bodyPath,
      "--garment",
      garmentPath,
      "--band-lo",
      String(args.bandLo),
      "--band-hi",
      String(args.bandHi),
      "--label",
      args.label,
      "--out",
      outPath,
    ],
    args.label,
  );
  return JSON.parse(await readFile(outPath, "utf8")) as CoverageRow;
}

async function runCoverShell(args: {
  body: MeshGeometry;
  bandLo: number;
  bandHi: number;
  label: string;
  tmpDir: string;
}): Promise<{ shell: MeshGeometry; vertexCount: number; faceCount: number }> {
  const bodyPath = path.join(args.tmpDir, `shell-body-${args.label}.json`);
  const garmentOut = path.join(args.tmpDir, `shell-${args.label}.json`);
  const outPath = path.join(args.tmpDir, `shell-report-${args.label}.json`);
  await writeFile(bodyPath, JSON.stringify(args.body));
  await runPython(
    [
      COVERAGE_MODULE,
      "--mode",
      "cover-shell",
      "--body",
      bodyPath,
      "--band-lo",
      String(args.bandLo),
      "--band-hi",
      String(args.bandHi),
      "--standoff",
      String(CLOTH_STANDOFF_M),
      "--label",
      args.label,
      "--garment-out",
      garmentOut,
      "--out",
      outPath,
    ],
    `cover-shell-${args.label}`,
  );
  const shellRaw = JSON.parse(await readFile(garmentOut, "utf8")) as {
    position: number[];
    indices: number[];
  };
  const shell: MeshGeometry = {
    position: shellRaw.position,
    indices: shellRaw.indices,
    triangles: Math.floor(shellRaw.indices.length / 3),
  };
  const summary = JSON.parse(await readFile(outPath, "utf8")) as {
    vertexCount?: number;
    faceCount?: number;
  };
  return {
    shell,
    vertexCount: Number(summary.vertexCount ?? 0),
    faceCount: Number(summary.faceCount ?? 0),
  };
}

async function loadFigureMeshes(
  io: NodeIO,
  glbName: string,
): Promise<{ body: MeshGeometry; lower: MeshGeometry | null; upper: MeshGeometry | null; meshNames: string[] }> {
  const glbPath = path.join(CANDIDATES_DIR, glbName);
  if (!existsSync(glbPath)) {
    throw new Error(`garment-covers-its-region: missing shipped GLB ${glbPath}`);
  }
  const doc = await io.read(glbPath);
  let body: MeshGeometry | null = null;
  let lower: MeshGeometry | null = null;
  let upper: MeshGeometry | null = null;
  const meshNames: string[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    if (/basemesh/i.test(name)) {
      meshNames.push(name);
      if (!body) body = meshData(mesh);
    } else if (isLowerGarmentName(name)) {
      meshNames.push(name);
      if (!lower) lower = meshData(mesh);
    } else if (isUpperGarmentName(name)) {
      meshNames.push(name);
      if (!upper) upper = meshData(mesh);
    }
  }
  if (!body) throw new Error(`garment-covers-its-region: no basemesh in ${glbName}`);
  return { body, lower, upper, meshNames };
}

export async function inspectGarmentCoversItsRegion(): Promise<Report> {
  const io = new NodeIO();
  const glbNames = [
    "body-param-adult_lean_female-library.glb",
    "body-param-adult_heavy_male-library.glb",
  ];

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "issue-272-cov-"));
  const figures: FigureCoverage[] = [];
  try {
    for (const glbName of glbNames) {
    const { body, lower, upper, meshNames } = await loadFigureMeshes(io, glbName);
    const bodyClassId = glbName.replace(/^body-param-/, "").replace(/-library\.glb$/, "");
    const bodyBounds = bounds(body.position);
    const hemY = upper ? bounds(upper.position).min[1] : bodyBounds.max[1] * 0.55;
    const ankleY = bodyBounds.min[1] + ANKLE_OFFSET_M;

    const row: FigureCoverage = {
      bodyClassId,
      glbPath: path.join("apps/ui-xr/public/xr-assets/humanoids/candidates", glbName),
      lowerGarmentMeshName: meshNames.find((n) => isLowerGarmentName(n)) ?? null,
      lowerGarmentTriangleCount: lower?.triangles ?? 0,
      upperGarmentMeshName: meshNames.find((n) => isUpperGarmentName(n)) ?? null,
      upperGarmentTriangleCount: upper?.triangles ?? 0,
      lower: null,
      upper: null,
    };

    if (lower) {
      row.lower = await runCoverageReport({
        body,
        garment: lower,
        bandLo: ankleY,
        bandHi: hemY,
        label: `${bodyClassId}-lower`,
        tmpDir,
      });
    }
    if (upper) {
      const u = bounds(upper.position);
      row.upper = await runCoverageReport({
        body,
        garment: upper,
        bandLo: u.min[1] + 0.02,
        bandHi: u.max[1] - 0.02,
        label: `${bodyClassId}-upper`,
        tmpDir,
      });
    }
    figures.push(row);
  }

  // Deterministic fallback: body-derived cover shell on the female body (the spouse's
  // class), measured on the same predicate the stage uses to accept/reject garments.
  let coverShell: Report["coverShell"] = null;
  if (figures[0]) {
    const female = await loadFigureMeshes(io, glbNames[0]!);
    const fb = bounds(female.body.position);
    const hemY = female.upper ? bounds(female.upper.position).min[1] : fb.max[1] * 0.55;
    const ankleY = fb.min[1] + ANKLE_OFFSET_M;
    const run = await runCoverShell({
      body: female.body,
      bandLo: ankleY,
      bandHi: hemY,
      label: "female",
      tmpDir,
    });
    const coverage = await runCoverageReport({
      body: female.body,
      garment: run.shell,
      bandLo: ankleY,
      bandHi: hemY,
      label: "cover-shell",
      tmpDir,
    });
    coverShell = {
      label: "procedural_lower_cover_shell",
      vertexCount: run.vertexCount,
      faceCount: run.faceCount,
      coverage,
    };
  }

  return {
    figures,
    coverShell,
    claimScope: "coverage of the body region a garment claims, on shipped library GLBs",
    notEvidenceFor: [
      "clinical_validity",
      "garment_quality_or_aesthetics",
      "quest_readiness",
      "learner_readiness",
      "cloth_physics_or_deformation",
    ],
  };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
