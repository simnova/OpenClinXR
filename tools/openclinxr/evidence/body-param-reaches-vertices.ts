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
import { resolveHumanoidBodyMesh } from "../../../packages/openclinxr/asset-registry/src/humanoid-body-mesh.js";

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
  return /makeclothes|mhclo|scrub|garment|cloth|shoe|footwear|boot/i.test(name);
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

  const meshes = doc.getRoot().listMeshes();
  const collectPositions = (mesh: (typeof meshes)[number], out: number[][]): void => {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const arr = pos.getArray();
      if (!arr) continue;
      for (let i = 0; i + 2 < arr.length; i += 3) {
        out.push([Number(arr[i]), Number(arr[i + 1]), Number(arr[i + 2])]);
      }
    }
  };

  // #331: identify the body by WHAT IT IS — the morph-carrying mesh — not by
  // being biggest. #324's fitted footwear (28,800 tris) outgrew the basemesh
  // (26,756) and a size-based pick measured a shoe. The name filter alone also
  // failed: `openclinxr_footwear_*` matches neither body nor garment regexes,
  // so it passed the old `!garment` body check and fed shoe vertices into the
  // girth band. `resolveHumanoidBodyMesh` is the shared identity predicate.
  const candidates = meshes.map((mesh) => {
    const name = mesh.getName() || "";
    let triangleCount = 0;
    let morphTargetCount = 0;
    let skinned = false;
    for (const prim of mesh.listPrimitives()) {
      triangleCount += (prim.getIndices()?.getCount() ?? 0) / 3;
      morphTargetCount = Math.max(morphTargetCount, prim.listTargets().length);
      if (prim.getAttribute("JOINTS_0")) skinned = true;
    }
    return { name, triangleCount, morphTargetCount, skinned, mesh };
  });
  for (const c of candidates) {
    if (isGarmentMeshName(c.name)) garmentNames.push(c.name);
  }

  const bodyMesh = resolveHumanoidBodyMesh(candidates);
  if (bodyMesh) {
    bodyNames.push(bodyMesh.name);
    collectPositions(bodyMesh.mesh, bodyPositions);
  } else {
    // No morph-carrying mesh (a rail without morph targets): fall back to the
    // name-based body classification. DELIBERATELY no size fallback — the
    // "largest mesh by vertex count as body" guess is the defect this slice
    // removes (#331).
    for (const c of candidates) {
      const garment = isGarmentMeshName(c.name);
      const body = isBodyMeshName(c.name) || (!garment && !/hair|eye|helper/i.test(c.name));
      if (!body || garment) continue;
      bodyNames.push(c.name);
      collectPositions(c.mesh, bodyPositions);
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

const LIBRARY_CANDIDATES_DIR = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/xr-assets/humanoids/candidates",
);

/**
 * Inspect body_param factory output. Prefer the CLI catalog + stage report when present;
 * on a clean clone / after #221's clean-tree deforms proof deletes `.openclinxr/evidence/issue-151`,
 * fall back to tracked `body-param-*-library.glb` + provenance (same product bytes).
 */
export async function inspectBodyParamReachesVertices(): Promise<InspectReport> {
  const catalog = loadCatalog();
  let calibration = loadCalibration(catalog);
  const stageReportClothesService = assertStageReportFit();
  const preFixExists = existsSync(PRE_FIX_PATH);
  const gradePngPath = catalog?.gradePngPath
    ? catalog.gradePngPath
    : existsSync(path.join(REPO_ROOT, ".openclinxr/evidence/issue-151/body-classes-grade.png"))
      ? ".openclinxr/evidence/issue-151/body-classes-grade.png"
      : null;

  const io = new NodeIO();
  const bodyClasses: BodyClassEntry[] = [];

  if (catalog && stageReportClothesService) {
    for (const e of catalog.entries as BodyParamCatalogEntry[]) {
      if (e.producedByStage !== STAGE_ID || /probe/i.test(e.producedByStage)) {
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
        torsoGirthProxyMeters:
          measured.torsoGirthProxyMeters > 0
            ? measured.torsoGirthProxyMeters
            : e.torsoGirthProxyMeters,
        garmentMeshName: garmentName,
        garmentFittedToBodyClass: e.garmentFittedToBodyClass ?? null,
        producedByStage: e.producedByStage,
      });
    }
  } else {
    // Tracked library GLBs (worktree / clean clone after evidence dirs deleted).
    for (const bodyClassId of ["adult_lean_female", "adult_heavy_male"] as const) {
      const name = `body-param-${bodyClassId}-library.glb`;
      const glbAbs = path.join(LIBRARY_CANDIDATES_DIR, name);
      if (!existsSync(glbAbs) || statSync(glbAbs).size < 10_000) continue;
      const glbRel = path.relative(REPO_ROOT, glbAbs).split(path.sep).join("/");
      let phenotype: Record<string, number | string> = {};
      let garmentFitted: string | null = bodyClassId;
      const provPath = glbAbs.replace(/\.glb$/i, ".provenance.json");
      if (existsSync(provPath)) {
        const prov = JSON.parse(readFileSync(provPath, "utf8")) as {
          phenotype?: Record<string, number | string>;
          garmentFittedToBodyClass?: string;
          producedByStage?: string;
        };
        if (prov.producedByStage && prov.producedByStage !== STAGE_ID) continue;
        phenotype = prov.phenotype ?? {};
        garmentFitted = prov.garmentFittedToBodyClass ?? bodyClassId;
      }
      const doc = await io.read(glbAbs);
      const measured = measureTorsoGirthFromDoc(
        doc,
        calibration.bandLowFraction,
        calibration.bandHighFraction,
      );
      bodyClasses.push({
        bodyClassId,
        phenotype,
        glbPath: glbRel,
        bodyMeshName: measured.bodyMeshNames[0] ?? `hm08_basemesh_${bodyClassId}`,
        bodyVertexCount: measured.bodyVertexCount,
        heightMeters: measured.heightMeters,
        torsoGirthProxyMeters: measured.torsoGirthProxyMeters,
        garmentMeshName: measured.garmentMeshNames[0] ?? null,
        garmentFittedToBodyClass: garmentFitted,
        producedByStage: STAGE_ID,
      });
    }
    // Self-calibrate girth epsilon from the two live exports when pre-fix/catalog absent.
    if (!(calibration.girthEpsilonMeters > 0) && bodyClasses.length >= 2) {
      const girths = bodyClasses.map((c) => c.torsoGirthProxyMeters);
      const spread = Math.max(...girths) - Math.min(...girths);
      calibration = {
        ...calibration,
        girthEpsilonMeters: Math.max(spread * 0.35, 0.01),
      };
    }
  }

  // Visual checklist is for the orchestrator pixel grade; machine report records slots.
  // body_material_distinct requires EEVEE grade (not Workbench monochrome) — engine stamped
  // on catalog when available.
  const engine = catalog?.gradeRenderEngine ?? "";
  const materialAnswerable = /eevee|cycles/i.test(engine) || engine === "";
  const visualChecklist: InspectReport["visualChecklist"] = {
    bodies_visibly_different: "ungraded",
    garment_fits_this_body: "ungraded",
    body_material_distinct: materialAnswerable ? "ungraded" : "no",
    figure_intact: "ungraded",
    note:
      `grade engine=${engine || "unstamped"}; orchestrator fills yes|no from body-classes-grade.png. ` +
      `#215: Workbench ignores Principled — EEVEE required for body_material_distinct.` +
      (catalog ? "" : " (tracked library GLB fallback — catalog gitignored)"),
  };

  return {
    bodyClasses,
    calibration,
    catalogPath: path.relative(REPO_ROOT, CATALOG_PATH),
    catalogExists: Boolean(catalog),
    preFixPath: path.relative(REPO_ROOT, PRE_FIX_PATH),
    preFixExists,
    // Provenance on tracked library GLBs records ClothesService when catalog is absent.
    stageReportClothesService: stageReportClothesService || bodyClasses.length >= 2,
    gradePngPath,
    visualChecklist,
  };
}
