/**
 * #215 inspect — factory consumed a fitted MakeClothes library garment.
 *
 * Reads ONLY what `pnpm asset:makeclothes:fit -- --once` wrote:
 *   .openclinxr/evidence/issue-215/library-catalog.json
 *   + the stage report and GLB paths stamped in that catalog
 *
 * Does NOT treat the cagematch probe under makeclothes-anny-reference/ as a library entry.
 * Does NOT invent producedByStage strings — the CLI stamps them.
 *
 * Runtime resolution is mirrored from apps/ui-xr/src/main.ts (static path table) so we
 * do not boot the full app for this contract.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import {
  CATALOG_PATH,
  STAGE_ID,
  type LibraryCatalog,
  type LibraryCatalogEntry,
} from "../asset-pipeline/makeclothes/fit-cli.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const MAIN_TS = path.join(REPO_ROOT, "apps/ui-xr/src/main.ts");

export type LibraryEntry = {
  garmentId: string;
  bodyClass: string;
  glbPath: string;
  garmentMeshNames: string[];
  garmentTriangleCount: number;
  licenseToken: string;
  licenseSource: string;
  producedByStage: string;
};

export type InspectReport = {
  entries: LibraryEntry[];
  comparatorResolvedPaths: { comparatorId: string; resolvedPath: string }[];
  catalogPath: string;
  catalogExists: boolean;
  stageReportClothesService: boolean;
};

function countMeshTriangles(
  doc: Awaited<ReturnType<NodeIO["read"]>>,
  meshNameFilter: (name: string) => boolean,
): { names: string[]; triangles: number } {
  const names: string[] = [];
  let triangles = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    if (!meshNameFilter(name)) continue;
    names.push(name);
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (indices) triangles += Math.floor(indices.getCount() / 3);
      else {
        const pos = prim.getAttribute("POSITION");
        if (pos) triangles += Math.floor(pos.getCount() / 3);
      }
    }
  }
  return { names, triangles };
}

function isGarmentMeshName(name: string): boolean {
  // Fitted library garments are named by the fit stage — never openclinxr_real_garment_*.
  if (/openclinxr_real_garment_/i.test(name)) return false;
  return /makeclothes|mhclo|scrub|garment|cloth/i.test(name);
}

/**
 * Parse comparator → public path from main.ts without executing the app.
 * Matches lines like:
 *   if (humanoidSourceComparator === "reom_local_fitted_garment_patient" ...
 *     return '/xr-assets/humanoids/candidates/….glb';
 */
export function parseComparatorPathsFromMain(source: string): {
  comparatorId: string;
  resolvedPath: string;
}[] {
  const out: { comparatorId: string; resolvedPath: string }[] = [];
  // Pair each comparator string compare with the next return of a candidates glb path
  const re =
    /humanoidSourceComparator\s*===\s*"([a-z0-9_]+)"[\s\S]{0,400}?return\s+['"](\/xr-assets\/humanoids\/candidates\/[^'"]+\.glb)['"]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push({ comparatorId: m[1]!, resolvedPath: m[2]! });
  }
  return out;
}

function loadCatalog(): LibraryCatalog | null {
  if (!existsSync(CATALOG_PATH)) return null;
  const raw = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as LibraryCatalog;
  if (raw.schemaVersion !== "openclinxr.makeclothes-library-catalog.v1") {
    throw new Error(`unexpected catalog schemaVersion: ${String(raw.schemaVersion)}`);
  }
  if (raw.producedByStage !== STAGE_ID) {
    throw new Error(
      `catalog producedByStage "${raw.producedByStage}" is not the factory stage "${STAGE_ID}"`,
    );
  }
  return raw;
}

function assertStageReportIsFit(entry: LibraryCatalogEntry): boolean {
  const reportPath = path.join(REPO_ROOT, entry.stageReportPath);
  if (!existsSync(reportPath)) return false;
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>;
  if (report["producedByStage"] !== STAGE_ID) return false;
  if (report["status"] !== "completed") return false;
  const steps = (report["steps"] as Record<string, unknown> | undefined) ?? {};
  const fit = steps["clothesServiceFit"] as Record<string, unknown> | undefined;
  return fit?.["api"] === "ClothesService.fit_clothes_to_human";
}

/**
 * Inspect library consumption. Only returns entries the fit CLI catalogued AND whose
 * stage report proves ClothesService ran. Re-measures garment meshes from the GLB.
 */
export async function inspectMakeclothesLibraryConsumed(): Promise<InspectReport> {
  const catalog = loadCatalog();
  const mainSource = existsSync(MAIN_TS) ? readFileSync(MAIN_TS, "utf8") : "";
  const comparatorResolvedPaths = parseComparatorPathsFromMain(mainSource);

  if (!catalog) {
    return {
      entries: [],
      comparatorResolvedPaths,
      catalogPath: path.relative(REPO_ROOT, CATALOG_PATH),
      catalogExists: false,
      stageReportClothesService: false,
    };
  }

  const entries: LibraryEntry[] = [];
  let stageReportClothesService = false;

  for (const e of catalog.entries) {
    if (e.producedByStage !== STAGE_ID || /probe/i.test(e.producedByStage)) {
      continue;
    }
    if (!assertStageReportIsFit(e)) {
      continue;
    }
    stageReportClothesService = true;

    const glbAbs = path.join(REPO_ROOT, e.glbPath);
    if (!existsSync(glbAbs) || statSync(glbAbs).size < 10_000) {
      continue;
    }

    const io = new NodeIO();
    const doc = await io.read(glbAbs);
    // Prefer live mesh measure; fall back to catalog triangle estimate if name filter misses
    const measured = countMeshTriangles(doc, isGarmentMeshName);
    const catalogNames = e.garmentMeshNames.filter((n) => !/openclinxr_real_garment_/i.test(n));
    let garmentMeshNames = measured.names.length > 0 ? measured.names : catalogNames;
    let garmentTriangleCount =
      measured.triangles > 0 ? measured.triangles : e.garmentTriangleCount;

    // If filters found nothing, scan all non-body meshes by triangle volume
    if (garmentMeshNames.length === 0 || garmentTriangleCount < 500) {
      const all = countMeshTriangles(doc, (n) => !/hm08|basemesh|body|skin|anny/i.test(n));
      if (all.triangles >= 500) {
        garmentMeshNames = all.names;
        garmentTriangleCount = all.triangles;
      }
    }

    entries.push({
      garmentId: e.garmentId,
      bodyClass: e.bodyClass,
      glbPath: e.glbPath,
      garmentMeshNames,
      garmentTriangleCount,
      licenseToken: e.licenseToken,
      licenseSource: e.licenseSource,
      producedByStage: e.producedByStage,
    });
  }

  return {
    entries,
    comparatorResolvedPaths,
    catalogPath: path.relative(REPO_ROOT, CATALOG_PATH),
    catalogExists: true,
    stageReportClothesService,
  };
}
