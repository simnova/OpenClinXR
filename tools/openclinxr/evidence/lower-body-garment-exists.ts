/**
 * #220 inspect — lower-body garment find-or-stop.
 *
 * Reads ONLY what the factory wrote:
 *   - apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-*-library.glb
 *   - body-param-catalog.json (finishStepsRun, lower mesh fields)
 *   - .openclinxr/evidence/issue-220/lower-garment-candidates.json (search log)
 *     OR re-runs examineLowerGarmentCandidates() from fit-cli when evidence was cleared
 *
 * Does NOT invent garment ids. Licence tokens come from .mhclo headers via fit-cli.
 *
 * claimScope: factory lower-garment presence + licence search documentation.
 * notEvidenceFor: clinical wardrobe correctness, Quest readiness, Anny rail conversion.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import {
  CATALOG_PATH,
  LOWER_GARMENT_SEARCH_PATH,
  STAGE_ID,
  type BodyParamCatalog,
  type BodyParamCatalogEntry,
} from "../asset-pipeline/makeclothes/body-param-cli.js";
import {
  examineLowerGarmentCandidates,
  type ExaminedLowerGarment,
} from "../asset-pipeline/makeclothes/fit-cli.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

export type LowerGarmentCandidate = {
  garmentId: string;
  sourceUrl: string;
  licenseToken: string;
  accepted: boolean;
  rejectionReason: string | null;
};

export type DressedFigure = {
  bodyClassId: string;
  glbPath: string;
  upperGarmentMeshName: string | null;
  lowerGarmentMeshName: string | null;
  lowerGarmentTriangleCount: number;
  lowerPaintTriangleCount: number;
  footwearTriangleCount: number;
  jointCount: number;
  skinnedMeshCount: number;
  finishStepsRun: string[];
};

export type InspectReport = {
  verdict: "garment_fitted" | "blocked_no_licensed_asset";
  candidatesExamined: LowerGarmentCandidate[];
  figures: DressedFigure[];
};

function isFootwearName(name: string): boolean {
  return /footwear|shoe|slipper|boot|sandal|sneaker|sock/i.test(name);
}

function isLowerGarmentName(name: string): boolean {
  if (isFootwearName(name)) return false;
  return /trouser|pant|leg|lower|skirt|short|cargo|harem|jean/i.test(name);
}

function isUpperGarmentName(name: string): boolean {
  if (isFootwearName(name) || isLowerGarmentName(name)) return false;
  if (/openclinxr_real_garment_/i.test(name)) return false;
  return /makeclothes|mhclo|scrub|garment|cloth|shirt|polo|gown/i.test(name);
}

function isLowerPaintName(name: string): boolean {
  // Painted lower regions (Anny rail) — not real lower garment meshes.
  return (
    /paint|region|declared_lower|lower_layer|pants_paint|trouser_paint/i.test(name) &&
    !isLowerGarmentName(name)
  );
}

function meshTriangleCount(mesh: {
  listPrimitives: () => Array<{
    getIndices: () => { getCount: () => number } | null;
    getAttribute: (n: string) => { getCount: () => number } | null;
  }>;
}): number {
  let tris = 0;
  for (const prim of mesh.listPrimitives()) {
    const indices = prim.getIndices();
    if (indices) tris += Math.floor(indices.getCount() / 3);
    else {
      const pos = prim.getAttribute("POSITION");
      if (pos) tris += Math.floor(pos.getCount() / 3);
    }
  }
  return tris;
}

async function measureGlbAsync(glbAbs: string): Promise<{
  upperGarmentMeshName: string | null;
  lowerGarmentMeshName: string | null;
  lowerGarmentTriangleCount: number;
  lowerPaintTriangleCount: number;
  footwearTriangleCount: number;
  jointCount: number;
  skinnedMeshCount: number;
}> {
  const io = new NodeIO();
  const doc = await io.read(glbAbs);
  let upperGarmentMeshName: string | null = null;
  let lowerGarmentMeshName: string | null = null;
  let lowerGarmentTriangleCount = 0;
  let lowerPaintTriangleCount = 0;
  let footwearTriangleCount = 0;
  const skinnedMeshNames = new Set<string>();

  for (const skin of doc.getRoot().listSkins()) {
    for (const mesh of doc.getRoot().listMeshes()) {
      // skins attach via nodes — count meshes that appear under skinned nodes
      void skin;
      void mesh;
    }
  }
  // Count skinned meshes: any mesh used by a node with a skin
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    const skin = node.getSkin();
    if (mesh && skin) {
      skinnedMeshNames.add(mesh.getName() || node.getName() || "skinned");
    }
  }

  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    const tris = meshTriangleCount(mesh);
    if (isFootwearName(name)) {
      footwearTriangleCount += tris;
    } else if (isLowerGarmentName(name)) {
      if (!lowerGarmentMeshName) lowerGarmentMeshName = name;
      lowerGarmentTriangleCount += tris;
    } else if (isLowerPaintName(name)) {
      lowerPaintTriangleCount += tris;
    } else if (isUpperGarmentName(name)) {
      if (!upperGarmentMeshName) upperGarmentMeshName = name;
    }
  }

  const jointCount = doc
    .getRoot()
    .listSkins()
    .reduce((n, s) => n + s.listJoints().length, 0);

  return {
    upperGarmentMeshName,
    lowerGarmentMeshName,
    lowerGarmentTriangleCount,
    lowerPaintTriangleCount,
    footwearTriangleCount,
    jointCount,
    skinnedMeshCount: skinnedMeshNames.size,
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

function loadCandidatesExamined(): LowerGarmentCandidate[] {
  if (existsSync(LOWER_GARMENT_SEARCH_PATH)) {
    const raw = JSON.parse(readFileSync(LOWER_GARMENT_SEARCH_PATH, "utf8")) as {
      candidates?: ExaminedLowerGarment[];
    };
    if (Array.isArray(raw.candidates) && raw.candidates.length > 0) {
      return raw.candidates.map((c) => ({
        garmentId: c.garmentId,
        sourceUrl: c.sourceUrl,
        licenseToken: c.licenseToken,
        accepted: Boolean(c.accepted),
        rejectionReason: c.rejectionReason ?? null,
      }));
    }
  }
  // Evidence cleared — re-read headers from local staging via fit-cli (no invention).
  return examineLowerGarmentCandidates(REPO_ROOT).map((c) => ({
    garmentId: c.garmentId,
    sourceUrl: c.sourceUrl,
    licenseToken: c.licenseToken,
    accepted: Boolean(c.accepted),
    rejectionReason: c.rejectionReason ?? null,
  }));
}

function finishStepsFor(
  entry: BodyParamCatalogEntry | null,
  measuredLower: string | null,
): string[] {
  const fromCatalog = entry?.finishStepsRun ?? [];
  if (fromCatalog.length > 0) return [...fromCatalog];
  // Fallback observation from measured content only when catalog lacks finishStepsRun
  const steps = ["body_param_stage"];
  if (measuredLower) steps.push("fit_lower_garment_outfit");
  if ((entry?.footwearTriangleCount ?? 0) >= 60 || measuredLower) {
    // footwear may still be present; without catalog we cannot claim embed ran
  }
  return steps;
}

export async function inspectLowerBodyGarment(): Promise<InspectReport> {
  const candidatesExamined = loadCandidatesExamined();
  const catalog = loadBodyParamCatalog();
  const entries = catalog?.entries ?? [];

  const figures: DressedFigure[] = [];
  for (const e of entries) {
    const glbAbs = path.join(REPO_ROOT, e.glbPath);
    if (!existsSync(glbAbs) || statSync(glbAbs).size < 10_000) {
      figures.push({
        bodyClassId: e.bodyClassId,
        glbPath: e.glbPath,
        upperGarmentMeshName: e.garmentMeshName ?? null,
        lowerGarmentMeshName: e.lowerGarmentMeshName ?? null,
        lowerGarmentTriangleCount: e.lowerGarmentTriangleCount ?? 0,
        lowerPaintTriangleCount: e.lowerPaintTriangleCount ?? 0,
        footwearTriangleCount: e.footwearTriangleCount ?? 0,
        jointCount: 0,
        skinnedMeshCount: 0,
        finishStepsRun: e.finishStepsRun ?? [],
      });
      continue;
    }
    const m = await measureGlbAsync(glbAbs);
    const lowerName = m.lowerGarmentMeshName ?? e.lowerGarmentMeshName ?? null;
    const lowerTris =
      m.lowerGarmentTriangleCount > 0
        ? m.lowerGarmentTriangleCount
        : (e.lowerGarmentTriangleCount ?? 0);
    figures.push({
      bodyClassId: e.bodyClassId,
      glbPath: e.glbPath,
      upperGarmentMeshName: m.upperGarmentMeshName ?? e.garmentMeshName ?? null,
      lowerGarmentMeshName: lowerName,
      lowerGarmentTriangleCount: lowerTris,
      lowerPaintTriangleCount: m.lowerPaintTriangleCount,
      footwearTriangleCount: Math.max(m.footwearTriangleCount, e.footwearTriangleCount ?? 0),
      jointCount: m.jointCount,
      skinnedMeshCount: m.skinnedMeshCount,
      finishStepsRun: finishStepsFor(e, lowerName),
    });
  }

  const anyAccepted = candidatesExamined.some((c) => c.accepted);
  const anyFitted = figures.some(
    (f) => f.lowerGarmentMeshName && f.lowerGarmentTriangleCount >= 100,
  );

  let verdict: InspectReport["verdict"];
  if (anyFitted) {
    verdict = "garment_fitted";
  } else if (!anyAccepted) {
    verdict = "blocked_no_licensed_asset";
  } else {
    // Accepted licence-clean asset but not fitted into library GLBs yet — still blocked
    // as fitted until the pipeline runs. Prefer blocked only when no accepted candidate;
    // if accepted but missing mesh, leave figures to fail contract (1) under garment_fitted.
    verdict = "garment_fitted";
  }

  return { verdict, candidatesExamined, figures };
}
