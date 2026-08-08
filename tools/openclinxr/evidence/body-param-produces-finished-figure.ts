/**
 * #226 inspect — one public command produces a FINISHED library figure.
 *
 * Reads ONLY what `pnpm asset:body-param:fit -- --once` wrote:
 *   - apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-*-library.glb
 *   - apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-catalog.json
 *   - makeclothes-library-catalog.json (same candidates dir; not under evidence)
 * Re-measures footwear/garment/joints/morphs from the GLBs. Re-reads Anny humanoids
 * so #188 footwear cannot silently regress.
 *
 * claimScope: finished library figure pipeline edge (footwear + catalog outside evidence).
 * notEvidenceFor: clinical costume realism, quest readiness, Anny rail conversion.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import {
  CATALOG_PATH,
  PRODUCED_BY_COMMAND,
  STAGE_ID,
  type BodyParamCatalog,
  type BodyParamCatalogEntry,
} from "../asset-pipeline/makeclothes/body-param-cli.js";
import {
  CATALOG_PATH as MAKECLOTHES_CATALOG_PATH,
} from "../asset-pipeline/makeclothes/fit-cli.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const CANDIDATES_DIR = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/xr-assets/humanoids/candidates",
);
const GENERATED_HUMANOIDS_DIR = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/generated-humanoids",
);

export type FinishedFigure = {
  bodyClassId: string;
  glbPath: string;
  producedByCommand: string;
  finishStepsRun: string[];
  footwearMeshNames: string[];
  footwearTriangleCount: number;
  garmentMeshName: string | null;
  jointCount: number;
  morphTargetCount: number;
};

export type InspectReport = {
  figures: FinishedFigure[];
  annyFootwearIntact: Array<{ assetId: string; footwearTriangleCount: number }>;
  catalogEntries: Array<{ garmentId: string; bodyClassId: string; resolvedGlbPath: string }>;
  catalogSource: string;
};

function isFootwearName(name: string): boolean {
  return /footwear|shoe|slipper|boot|sandal|sneaker|sock/i.test(name);
}

function isGarmentName(name: string): boolean {
  if (isFootwearName(name)) return false;
  if (/openclinxr_real_garment_/i.test(name)) return false;
  return /makeclothes|mhclo|scrub|garment|cloth/i.test(name);
}

function meshStats(doc: Awaited<ReturnType<NodeIO["read"]>>): {
  footwearMeshNames: string[];
  footwearTriangleCount: number;
  garmentMeshName: string | null;
  jointCount: number;
  morphTargetCount: number;
} {
  const footwearMeshNames: string[] = [];
  let footwearTriangleCount = 0;
  let garmentMeshName: string | null = null;
  let morphTargetCount = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    let tris = 0;
    let morphs = 0;
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (indices) tris += Math.floor(indices.getCount() / 3);
      morphs += prim.listTargets().length;
    }
    morphTargetCount += morphs;
    if (isFootwearName(name)) {
      footwearMeshNames.push(name);
      footwearTriangleCount += tris;
    } else if (isGarmentName(name) && garmentMeshName === null) {
      garmentMeshName = name;
    }
  }
  const jointCount = doc
    .getRoot()
    .listSkins()
    .reduce((n, s) => n + s.listJoints().length, 0);
  return {
    footwearMeshNames,
    footwearTriangleCount,
    garmentMeshName,
    jointCount,
    morphTargetCount,
  };
}

function loadBodyParamCatalog(): BodyParamCatalog | null {
  if (!existsSync(CATALOG_PATH)) return null;
  const raw = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as BodyParamCatalog;
  if (raw.schemaVersion !== "openclinxr.body-param-catalog.v1") {
    throw new Error(`unexpected body-param catalog schema: ${String(raw.schemaVersion)}`);
  }
  if (raw.producedByStage !== STAGE_ID) {
    throw new Error(
      `body-param catalog producedByStage "${raw.producedByStage}" ≠ "${STAGE_ID}"`,
    );
  }
  return raw;
}

function resolveLibraryGlbs(catalog: BodyParamCatalog | null): Array<{
  bodyClassId: string;
  glbAbs: string;
  glbRel: string;
  entry: BodyParamCatalogEntry | null;
}> {
  if (catalog && catalog.entries.length > 0) {
    return catalog.entries.map((e) => ({
      bodyClassId: e.bodyClassId,
      glbAbs: path.join(REPO_ROOT, e.glbPath),
      glbRel: e.glbPath,
      entry: e,
    }));
  }
  // Fallback: discover tracked library GLBs by name (catalog may be missing mid-debug).
  if (!existsSync(CANDIDATES_DIR)) return [];
  return readdirSync(CANDIDATES_DIR)
    .filter((n) => /^body-param-.*-library\.glb$/i.test(n))
    .map((n) => {
      const bodyClassId = n
        .replace(/^body-param-/i, "")
        .replace(/-library\.glb$/i, "");
      const glbAbs = path.join(CANDIDATES_DIR, n);
      return {
        bodyClassId,
        glbAbs,
        glbRel: path.relative(REPO_ROOT, glbAbs).split(path.sep).join("/"),
        entry: null,
      };
    });
}

async function measureAnnyFootwear(): Promise<
  Array<{ assetId: string; footwearTriangleCount: number }>
> {
  if (!existsSync(GENERATED_HUMANOIDS_DIR)) return [];
  const glbs = readdirSync(GENERATED_HUMANOIDS_DIR).filter((n) => n.endsWith(".glb"));
  const io = new NodeIO();
  const out: Array<{ assetId: string; footwearTriangleCount: number }> = [];
  for (const name of glbs) {
    const abs = path.join(GENERATED_HUMANOIDS_DIR, name);
    if (statSync(abs).size < 50_000) continue;
    try {
      const doc = await io.read(abs);
      const stats = meshStats(doc);
      out.push({
        assetId: name.replace(/\.glb$/i, ""),
        footwearTriangleCount: stats.footwearTriangleCount,
      });
    } catch {
      // skip unreadable
    }
  }
  return out;
}

function loadCatalogEntries(): {
  entries: Array<{ garmentId: string; bodyClassId: string; resolvedGlbPath: string }>;
  catalogSource: string;
} {
  // Prefer body-param catalog (pipeline-regenerated, not under evidence).
  if (existsSync(CATALOG_PATH)) {
    const raw = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as BodyParamCatalog;
    const entries = (raw.entries ?? []).map((e) => ({
      garmentId: e.garmentId,
      bodyClassId: e.bodyClassId,
      resolvedGlbPath: e.glbPath,
    }));
    return {
      entries,
      catalogSource: path.relative(REPO_ROOT, CATALOG_PATH).split(path.sep).join("/"),
    };
  }
  // MakeClothes catalog also lives next to candidates after #226.
  if (existsSync(MAKECLOTHES_CATALOG_PATH)) {
    const raw = JSON.parse(readFileSync(MAKECLOTHES_CATALOG_PATH, "utf8")) as {
      entries?: Array<{ garmentId?: string; bodyClass?: string; glbPath?: string }>;
    };
    const entries = (raw.entries ?? []).map((e) => ({
      garmentId: String(e.garmentId ?? ""),
      bodyClassId: String(e.bodyClass ?? ""),
      resolvedGlbPath: String(e.glbPath ?? ""),
    }));
    return {
      entries,
      catalogSource: path
        .relative(REPO_ROOT, MAKECLOTHES_CATALOG_PATH)
        .split(path.sep)
        .join("/"),
    };
  }
  return { entries: [], catalogSource: "missing" };
}

/**
 * Inspect finished library figures produced by the body-param finish pipeline.
 */
export async function inspectBodyParamProducesFinishedFigure(): Promise<InspectReport> {
  const catalog = loadBodyParamCatalog();
  const library = resolveLibraryGlbs(catalog);
  const io = new NodeIO();
  const figures: FinishedFigure[] = [];

  for (const row of library) {
    if (!existsSync(row.glbAbs) || statSync(row.glbAbs).size < 10_000) {
      continue;
    }
    const doc = await io.read(row.glbAbs);
    const stats = meshStats(doc);
    const entry = row.entry;
    figures.push({
      bodyClassId: row.bodyClassId,
      glbPath: row.glbRel,
      producedByCommand: entry?.producedByCommand ?? PRODUCED_BY_COMMAND,
      finishStepsRun: entry?.finishStepsRun ?? [],
      footwearMeshNames:
        stats.footwearMeshNames.length > 0
          ? stats.footwearMeshNames
          : (entry?.footwearMeshNames ?? []),
      footwearTriangleCount:
        stats.footwearTriangleCount > 0
          ? stats.footwearTriangleCount
          : Number(entry?.footwearTriangleCount ?? 0),
      garmentMeshName: stats.garmentMeshName ?? entry?.garmentMeshName ?? null,
      jointCount: stats.jointCount,
      morphTargetCount: stats.morphTargetCount,
    });
  }

  const annyFootwearIntact = await measureAnnyFootwear();
  const { entries: catalogEntries, catalogSource } = loadCatalogEntries();

  return {
    figures,
    annyFootwearIntact,
    catalogEntries,
    catalogSource,
  };
}
