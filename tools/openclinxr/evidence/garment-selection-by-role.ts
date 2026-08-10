/**
 * issue-275 — garment-selection-by-role inspector.
 *
 * Drives the shared hm08 garment selection (`garment-selection-by-role.ts` in the
 * makeclothes pipeline) against the REAL case definition:
 *
 *   - cast roles per hm08 body class come from the actor-casting SSOT
 *     (packages/openclinxr/asset-registry/src/actor-casting.ts) — never hardcoded
 *   - the resolution function maps role -> Anny case-actor preset garmentLayers ->
 *     hm08 upper garment (library .mhclo scrub OR the deterministic cover shell)
 *   - the SHIPPED body-param catalog and the SHIPPED GLBs are read to prove the
 *     production path reflects the resolution (not only the pure function)
 *
 * claimScope: garment-id resolution per hm08 body class and cast role, plus upper-
 * garment presence on the shipped assets.
 * notEvidenceFor: clinical costume realism, garment drape/quality, quest readiness,
 * learner readiness.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import {
  listShippedCastScenarioIds,
  resolveScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";
import {
  hm08BodyClassCastRoles,
  resolveAnnyGarmentLayers,
  resolveHm08UpperGarment,
  type Hm08UpperGarmentSpec,
} from "../asset-pipeline/makeclothes/garment-selection-by-role.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
export const CANDIDATES_DIR = path.join(
  REPO_ROOT,
  "apps/ui-xr/public/xr-assets/humanoids/candidates",
);
export const CATALOG_PATH = path.join(CANDIDATES_DIR, "body-param-catalog.json");

/** Upper-garment name tokens shared with garment-covers-its-region.ts (scrub/shirt/
 * garment/gown). The cover-shell mesh is named makeclothes_library_civilian_shirt_*
 * so it reads as an upper garment on every consumer classifier. */
function isUpperGarmentMeshName(name: string): boolean {
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
  return tokens.some(
    (t) => t === "scrub" || t === "scrubs" || t.includes("shirt") || t === "garment" || t === "gown",
  );
}

export type AnnyRailRow = {
  role: string;
  garmentLayers: string[];
  garmentIds: string[];
};

export type Hm08RailRow = {
  bodyClassId: string;
  /** Cast roles from the actor-casting SSOT (scenarioId/actorId/role). */
  castRoles: Array<{ scenarioId: string; actorId: string; role: string }>;
  resolved: Hm08UpperGarmentSpec;
  /** garmentId in the shipped body-param catalog. */
  catalogGarmentId: string;
  /** garmentMeshName in the shipped body-param catalog. */
  catalogGarmentMeshName: string;
  /** Upper garment mesh names found in the shipped GLB. */
  glbUpperMeshNames: string[];
};

export type GarmentSelectionByRoleReport = {
  annyRail: AnnyRailRow[];
  hm08Rail: Hm08RailRow[];
  hm08TwoBodyClassesDiffer: boolean;
  allBodiesCarryUpperGarment: boolean;
  claimScope: string;
  notEvidenceFor: string[];
};

type CatalogEntry = {
  bodyClassId?: string;
  garmentId?: string;
  garmentMeshName?: string;
};

export async function readShippedBodyParamCatalog(): Promise<CatalogEntry[]> {
  if (!existsSync(CATALOG_PATH)) {
    throw new Error(`body-param catalog missing at ${CATALOG_PATH}`);
  }
  const raw = JSON.parse(await readFile(CATALOG_PATH, "utf8")) as {
    schemaVersion: string;
    entries?: CatalogEntry[];
  };
  if (raw.schemaVersion !== "openclinxr.body-param-catalog.v1") {
    throw new Error(`unexpected body-param catalog schema: ${raw.schemaVersion}`);
  }
  return raw.entries ?? [];
}

async function readGlbUpperMeshes(glbName: string): Promise<string[]> {
  const glbPath = path.join(CANDIDATES_DIR, glbName);
  if (!existsSync(glbPath)) {
    throw new Error(`garment-selection-by-role: missing shipped GLB ${glbPath}`);
  }
  const doc = await new NodeIO().read(glbPath);
  const out: string[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    const name = mesh.getName() || "";
    if (isUpperGarmentMeshName(name)) out.push(name);
  }
  return out;
}

export async function inspectGarmentSelectionByRole(): Promise<GarmentSelectionByRoleReport> {
  const scenarios = listShippedCastScenarioIds();

  // hm08 body classes + their cast roles, from the actor-casting SSOT.
  const castRoles = hm08BodyClassCastRoles({
    scenarios,
    resolveCast: (scenarioId) => resolveScenarioActorCast(scenarioId),
  });

  // Anny rail known-good rows: the role vocabulary the hm08-cast roles exercise,
  // resolved the way the Anny rail does (role -> case-actor preset garmentLayers).
  const annyRoles = Array.from(
    new Set(
      Object.values(castRoles)
        .flat()
        .map((c) => c.role),
    ),
  ).sort();
  const annyRail: AnnyRailRow[] = annyRoles.map((role) => {
    const garmentLayers = resolveAnnyGarmentLayers(role);
    return { role, garmentLayers, garmentIds: [...garmentLayers] };
  });

  // hm08 rail rows: resolution function + shipped catalog + shipped GLBs.
  const catalog = await readShippedBodyParamCatalog();
  const catalogById = new Map<string, CatalogEntry>();
  for (const e of catalog) {
    if (e.bodyClassId) catalogById.set(e.bodyClassId, e);
  }

  const hm08Rail: Hm08RailRow[] = [];
  for (const [bodyClassId, roles] of Object.entries(castRoles).sort()) {
    const primaryRole = roles[0]?.role ?? "";
    const resolved = resolveHm08UpperGarment(primaryRole);
    const entry = catalogById.get(bodyClassId);
    hm08Rail.push({
      bodyClassId,
      castRoles: roles,
      resolved,
      catalogGarmentId: entry?.garmentId ?? "",
      catalogGarmentMeshName: entry?.garmentMeshName ?? "",
      glbUpperMeshNames: await readGlbUpperMeshes(`body-param-${bodyClassId}-library.glb`),
    });
  }

  // Contract (2): two body classes cast into different roles resolve to different ids.
  const ids = hm08Rail.map((r) => r.catalogGarmentId || r.resolved.garmentId);
  const hm08TwoBodyClassesDiffer = new Set(ids).size === ids.length && ids.length >= 2;

  // COUNTERWEIGHT: every generated body still carries an upper garment.
  const allBodiesCarryUpperGarment = hm08Rail.every(
    (r) =>
      Boolean(r.resolved.garmentId)
      && (Boolean(r.catalogGarmentMeshName) || r.glbUpperMeshNames.length > 0),
  );

  return {
    annyRail,
    hm08Rail,
    hm08TwoBodyClassesDiffer,
    allBodiesCarryUpperGarment,
    claimScope: "hm08 upper-garment id resolution from the case definition, per body class and cast role",
    notEvidenceFor: [
      "clinical_costume_realism",
      "garment_drape_or_quality",
      "quest_readiness",
      "learner_readiness",
      "clinical_validity",
    ],
  };
}
