/**
 * #151 inspect — phenotype (MPFB macros) reaches vertices; per-body fitted garments.
 *
 * Reads ONLY what `pnpm asset:body-param:fit -- --once` wrote:
 *   .openclinxr/evidence/issue-151/body-param-catalog.json
 *   + stage report + per-class GLBs + pre-fix calibration
 *
 * Re-measures torso girth from the exported glTF (not metadata).
 * Does NOT treat the cagematch probe as a library entry.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import {
  CATALOG_PATH,
  PRE_FIX_PATH,
  STAGE_ID,
  STAGE_REPORT_PATH,
  type BodyParamCatalog,
  type BodyParamCatalogEntry,
} from "../asset-pipeline/makeclothes/body-param-cli.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

export type BodyClassEntry = {
  bodyClassId: string;
  phenotype: Record<string, number | string>;
  glbPath: string;
  bodyMeshName: string;
  bodyVertexCount: number;
  heightMeters: number;
  /** Radial extent of body vertices inside the calibrated torso band, from the exported glTF. */
  torsoGirthProxyMeters: number;
  garmentMeshName: string | null;
  garmentFittedToBodyClass: string | null;
  producedByStage: string;
};

export type InspectReport = {
  bodyClasses: BodyClassEntry[];
  calibration: {
    bandLowFraction: number;
    bandHighFraction: number;
    girthEpsilonMeters: number;
  };
  catalogPath: string;
  catalogExists: boolean;
  preFixPath: string;
  preFixExists: boolean;
  stageReportClothesService: boolean;
  gradePngPath: string | null;
  visualChecklist: {
    bodies_visibly_different: "yes" | "no" | "ungraded";
    garment_fits_this_body: "yes" | "no" | "ungraded";
    body_material_distinct: "yes" | "no" | "ungraded";
    figure_intact: "yes" | "no" | "ungraded";
    note: string;
  };
};

function isBodyMeshName(name: string): boolean {
  return /hm08|basemesh|body|skin/i.test(name) && !/garment|scrub|makeclothes|cloth/i.test(name);
}

function isGarmentMeshName(name: string): boolean {
  if (/openclinxr_real_garment_/i.test(name)) return false;
  return /makeclothes|mhclo|scrub|garment|cloth/i.test(name);
}

/**
 * Torso girth proxy from glTF positions: max radial distance from band centroid
 * of body-mesh vertices whose Y falls in [lo,hi] fractions of mesh height.
 * glTF Y-up after export_yup=True.
 */
export function measureTorsoGirthFromDoc(
  doc: Awaited<ReturnType<NodeIO["read"]>>,
  bandLowFraction: number,
  bandHighFraction: number,
): {
  torsoGirthProxyMeters: number;
  heightMeters: number;
  bodyVertexCount: number;
  bodyMeshNames: string[];
  garmentMeshNames: string[];
} {
  const bodyNames: string[] = [];
  const garmentNames: string[] = [];
  const bodyPositions: number[][] = [];

  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    const garment = isGarmentMeshName(name);
    const body = isBodyMeshName(name) || (!garment && !/hair|eye|helper/i.test(name));
    if (garment) garmentNames.push(name);
    if (!body || garment) continue;
    bodyNames.push(name);
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      if (!arr) continue;
      for (let i = 0; i + 2 < arr.length; i += 3) {
        bodyPositions.push([Number(arr[i]), Number(arr[i + 1]), Number(arr[i + 2])]);
      }
    }
  }

  // Fallback: largest mesh by vertex count as body if name filter missed
  if (bodyPositions.length < 500) {
    bodyNames.length = 0;
    bodyPositions.length = 0;
    let bestCount = 0;
    let bestName = "";
    let bestPos: number[][] = [];
    for (const mesh of doc.getRoot().listMeshes()) {
      const name = mesh.getName() || "";
      if (isGarmentMeshName(name)) continue;
      const pts: number[][] = [];
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const arr = pos.getArray();
        if (!arr) continue;
        for (let i = 0; i + 2 < arr.length; i += 3) {
          pts.push([Number(arr[i]), Number(arr[i + 1]), Number(arr[i + 2])]);
        }
      }
      if (pts.length > bestCount) {
        bestCount = pts.length;
        bestName = name;
        bestPos = pts;
      }
    }
    if (bestPos.length > 0) {
      bodyNames.push(bestName);
      bodyPositions.push(...bestPos);
    }
  }

  if (bodyPositions.length === 0) {
    return {
      torsoGirthProxyMeters: 0,
      heightMeters: 0,
      bodyVertexCount: 0,
      bodyMeshNames: bodyNames,
      garmentMeshNames: garmentNames,
    };
  }

  // Y-up: height along Y
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const p of bodyPositions) {
    ymin = Math.min(ymin, p[1]!);
    ymax = Math.max(ymax, p[1]!);
  }
  const height = ymax - ymin;
  const lo = ymin + bandLowFraction * height;
  const hi = ymin + bandHighFraction * height;
  const band = bodyPositions.filter((p) => p[1]! >= lo && p[1]! <= hi);
  if (band.length === 0) {
    return {
      torsoGirthProxyMeters: 0,
      heightMeters: height,
      bodyVertexCount: bodyPositions.length,
      bodyMeshNames: bodyNames,
      garmentMeshNames: garmentNames,
    };
  }
  const cx = band.reduce((s, p) => s + p[0]!, 0) / band.length;
  const cz = band.reduce((s, p) => s + p[2]!, 0) / band.length;
  let maxR = 0;
  for (const p of band) {
    const r = Math.hypot(p[0]! - cx, p[2]! - cz);
    if (r > maxR) maxR = r;
  }

  return {
    torsoGirthProxyMeters: maxR,
    heightMeters: height,
    bodyVertexCount: bodyPositions.length,
    bodyMeshNames: bodyNames,
    garmentMeshNames: garmentNames,
  };
}

function loadCatalog(): BodyParamCatalog | null {
  if (!existsSync(CATALOG_PATH)) return null;
  const raw = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as BodyParamCatalog;
  if (raw.schemaVersion !== "openclinxr.body-param-catalog.v1") {
    throw new Error(`unexpected catalog schemaVersion: ${String(raw.schemaVersion)}`);
  }
  if (raw.producedByStage !== STAGE_ID) {
    throw new Error(
      `catalog producedByStage "${raw.producedByStage}" is not the factory stage "${STAGE_ID}"`,
    );
  }
  return raw;
}

function assertStageReportFit(): boolean {
  if (!existsSync(STAGE_REPORT_PATH)) return false;
  const report = JSON.parse(readFileSync(STAGE_REPORT_PATH, "utf8")) as Record<string, unknown>;
  if (report["producedByStage"] !== STAGE_ID) return false;
  if (report["status"] !== "completed") return false;
  const classes = (report["bodyClasses"] as Record<string, unknown>[] | undefined) ?? [];
  return classes.every(
    (c) => c["clothesServiceApi"] === "ClothesService.fit_clothes_to_human",
  );
}

function loadCalibration(
  catalog: BodyParamCatalog | null,
): { bandLowFraction: number; bandHighFraction: number; girthEpsilonMeters: number } {
  // Prefer pre-fix (contract exists: + §6f snapshot)
  if (existsSync(PRE_FIX_PATH)) {
    const pre = JSON.parse(readFileSync(PRE_FIX_PATH, "utf8")) as {
      calibration?: {
        bandLowFraction?: number;
        bandHighFraction?: number;
        girthEpsilonMeters?: number;
      };
    };
    const c = pre.calibration;
    if (c && typeof c.girthEpsilonMeters === "number" && c.girthEpsilonMeters > 0) {
      return {
        bandLowFraction: Number(c.bandLowFraction ?? 0.45),
        bandHighFraction: Number(c.bandHighFraction ?? 0.6),
        girthEpsilonMeters: c.girthEpsilonMeters,
      };
    }
  }
  if (catalog?.calibration?.girthEpsilonMeters) {
    return {
      bandLowFraction: catalog.calibration.bandLowFraction,
      bandHighFraction: catalog.calibration.bandHighFraction,
      girthEpsilonMeters: catalog.calibration.girthEpsilonMeters,
    };
  }
  return { bandLowFraction: 0.45, bandHighFraction: 0.6, girthEpsilonMeters: 0 };
}

/**
 * Inspect body_param factory output. Only returns entries the CLI catalogued AND whose
 * stage report proves ClothesService ran per class. Re-measures torso girth from GLB.
 */
export async function inspectBodyParamReachesVertices(): Promise<InspectReport> {
  const catalog = loadCatalog();
  const calibration = loadCalibration(catalog);
  const stageReportClothesService = assertStageReportFit();
  const preFixExists = existsSync(PRE_FIX_PATH);
  const gradePngPath = catalog?.gradePngPath
    ? catalog.gradePngPath
    : existsSync(path.join(REPO_ROOT, ".openclinxr/evidence/issue-151/body-classes-grade.png"))
      ? ".openclinxr/evidence/issue-151/body-classes-grade.png"
      : null;

  if (!catalog) {
    return {
      bodyClasses: [],
      calibration,
      catalogPath: path.relative(REPO_ROOT, CATALOG_PATH),
      catalogExists: false,
      preFixPath: path.relative(REPO_ROOT, PRE_FIX_PATH),
      preFixExists,
      stageReportClothesService: false,
      gradePngPath,
      visualChecklist: {
        bodies_visibly_different: "ungraded",
        garment_fits_this_body: "ungraded",
        body_material_distinct: "ungraded",
        figure_intact: "ungraded",
        note: "no catalog — stage has not run",
      },
    };
  }

  const io = new NodeIO();
  const bodyClasses: BodyClassEntry[] = [];

  for (const e of catalog.entries as BodyParamCatalogEntry[]) {
    if (e.producedByStage !== STAGE_ID || /probe/i.test(e.producedByStage)) {
      continue;
    }
    if (!stageReportClothesService) {
      continue;
    }

    const glbAbs = path.join(REPO_ROOT, e.glbPath);
    if (!existsSync(glbAbs) || statSync(glbAbs).size < 10_000) {
      continue;
    }

    const doc = await io.read(glbAbs);
    const measured = measureTorsoGirthFromDoc(
      doc,
      calibration.bandLowFraction,
      calibration.bandHighFraction,
    );

    const garmentName =
      measured.garmentMeshNames[0] ??
      (e.garmentMeshName && !/openclinxr_real_garment_/i.test(e.garmentMeshName)
        ? e.garmentMeshName
        : null);

    bodyClasses.push({
      bodyClassId: e.bodyClassId,
      phenotype: e.phenotype ?? {},
      glbPath: e.glbPath,
      bodyMeshName: measured.bodyMeshNames[0] ?? e.bodyMeshName,
      bodyVertexCount:
        measured.bodyVertexCount > 0 ? measured.bodyVertexCount : e.bodyVertexCount,
      heightMeters: measured.heightMeters > 0 ? measured.heightMeters : e.heightMeters,
      // Prefer live glTF measure; catalog is fallback only if measure fails
      torsoGirthProxyMeters:
        measured.torsoGirthProxyMeters > 0
          ? measured.torsoGirthProxyMeters
          : e.torsoGirthProxyMeters,
      garmentMeshName: garmentName,
      garmentFittedToBodyClass: e.garmentFittedToBodyClass ?? null,
      producedByStage: e.producedByStage,
    });
  }

  // Visual checklist is for the orchestrator pixel grade; machine report records slots.
  // body_material_distinct requires EEVEE grade (not Workbench monochrome) — engine stamped
  // on catalog when available.
  const engine = catalog.gradeRenderEngine ?? "";
  const materialAnswerable = /eevee|cycles/i.test(engine) || engine === "";
  const visualChecklist: InspectReport["visualChecklist"] = {
    bodies_visibly_different: "ungraded",
    garment_fits_this_body: "ungraded",
    body_material_distinct: materialAnswerable ? "ungraded" : "no",
    figure_intact: "ungraded",
    note:
      `grade engine=${engine || "unstamped"}; orchestrator fills yes|no from body-classes-grade.png. ` +
      `#215: Workbench ignores Principled — EEVEE required for body_material_distinct.`,
  };

  return {
    bodyClasses,
    calibration,
    catalogPath: path.relative(REPO_ROOT, CATALOG_PATH),
    catalogExists: true,
    preFixPath: path.relative(REPO_ROOT, PRE_FIX_PATH),
    preFixExists,
    stageReportClothesService,
    gradePngPath,
    visualChecklist,
  };
}
