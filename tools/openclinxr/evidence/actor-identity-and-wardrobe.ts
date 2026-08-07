/**
 * #96 + #94 actor identity + wardrobe inspector.
 *
 * Identity is compared by resolved asset *content* hash (not assetId string).
 * Garment claim requires declaration (realGarmentRegionFromPhenotype) and geometry
 * to agree: region non-null implies a real-garment mesh whose triangle count is
 * reported as realGarmentRegionFaceCount.
 *
 * claimScope: role→asset content distinguishability + declared garment geometry presence.
 * notEvidenceFor: clinical costume realism, drape quality, production/quest readiness.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { resolveScenarioActorCast } from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";

export type ActorAsset = {
  actorId: string;
  resolvedAssetPath: string;
  /** Content hash of the resolved GLB — identity by bytes, not by assetId string. */
  assetContentHash: string;
  garmentMeshNames: string[];
  garmentTriangleCounts: number[];
  /** Triangle count of the mesh named by realGarmentRegionFromPhenotype; null if no region. */
  realGarmentRegionFaceCount: number | null;
};

export type ActorIdentityWardrobeReport = {
  scenarioId: string;
  actors: ActorAsset[];
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const REAL_GARMENT_RE = /openclinxr_real_garment_/i;
const DECLARED_MARKER_RE = /declared_upper_layers/i;

function absFromRepo(relOrAbs: string): string {
  return path.isAbsolute(relOrAbs) ? relOrAbs : path.join(repoRoot, relOrAbs);
}

async function sha256File(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

function primitiveTriangleCount(prim: {
  getIndices: () => { getCount: () => number } | null;
  getAttribute: (name: string) => { getCount: () => number } | null;
}): number {
  const indices = prim.getIndices();
  if (indices) return Math.floor(indices.getCount() / 3);
  const pos = prim.getAttribute("POSITION");
  if (pos) return Math.floor(pos.getCount() / 3);
  return 0;
}

async function inspectGlbMeshes(glbPath: string): Promise<{
  garmentMeshNames: string[];
  garmentTriangleCounts: number[];
  meshTriByName: Map<string, number>;
}> {
  const document = await new NodeIO().read(glbPath);
  const root = document.getRoot();
  const garmentMeshNames: string[] = [];
  const garmentTriangleCounts: number[] = [];
  const meshTriByName = new Map<string, number>();

  for (const mesh of root.listMeshes()) {
    const name = mesh.getName() || "";
    let tris = 0;
    for (const prim of mesh.listPrimitives()) {
      tris += primitiveTriangleCount(prim);
    }
    meshTriByName.set(name, (meshTriByName.get(name) ?? 0) + tris);
    if (REAL_GARMENT_RE.test(name)) {
      garmentMeshNames.push(name);
      garmentTriangleCounts.push(tris);
    }
  }

  // Also scan node names that carry garment tags when mesh names are blank/renamed.
  for (const node of root.listNodes()) {
    const n = node.getName() || "";
    if (!REAL_GARMENT_RE.test(n)) continue;
    if (garmentMeshNames.includes(n)) continue;
    const mesh = node.getMesh();
    if (!mesh) continue;
    let tris = 0;
    for (const prim of mesh.listPrimitives()) {
      tris += primitiveTriangleCount(prim);
    }
    garmentMeshNames.push(n);
    garmentTriangleCounts.push(tris);
    meshTriByName.set(n, (meshTriByName.get(n) ?? 0) + tris);
  }

  return { garmentMeshNames, garmentTriangleCounts, meshTriByName };
}

async function realGarmentRegionFaceCountFromReport(
  assetPath: string,
  meshTriByName: Map<string, number>,
): Promise<number | null> {
  const reportPath = assetPath.replace(/\.glb$/u, "_rigging_report.json");
  const abs = absFromRepo(reportPath);
  if (!existsSync(abs)) return null;
  try {
    const raw = JSON.parse(await readFile(abs, "utf8")) as {
      realGarmentRegionFromPhenotype?: { meshName?: unknown; faceCount?: unknown } | null;
      roleClothingMaterialRegions?: {
        realGarmentRegion?: { meshName?: unknown; faceCount?: unknown } | null;
      };
    };
    const region =
      raw.realGarmentRegionFromPhenotype
      ?? raw.roleClothingMaterialRegions?.realGarmentRegion
      ?? null;
    if (!region || typeof region !== "object") return null;

    const meshName = typeof region.meshName === "string" ? region.meshName : "";
    // Declaration present: face count must come from actual geometry of that mesh
    // (or any real garment mesh if the named mesh was remapped on export). Report
    // faceCount is Blender poly count (often quads); identity/wardrobe contracts
    // compare against GLB triangle counts in the peer band.
    if (meshName && meshTriByName.has(meshName)) {
      return meshTriByName.get(meshName)!;
    }
    for (const [name, tris] of meshTriByName) {
      if (REAL_GARMENT_RE.test(name) && !DECLARED_MARKER_RE.test(name) && tris > 0) {
        return tris;
      }
    }
    // Region declared but no geometry → null (the naked-child failure class).
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve each cast actor for a scenario, hash the GLB content, and inventory
 * real-garment meshes + phenotype region face count agreement.
 */
export async function inspectActorIdentityAndWardrobe(input: {
  scenarioId: string;
}): Promise<ActorIdentityWardrobeReport> {
  const cast = resolveScenarioActorCast(input.scenarioId);
  if (cast.length === 0) {
    return { scenarioId: input.scenarioId, actors: [] };
  }

  const actors: ActorAsset[] = [];
  for (const entry of cast) {
    const abs = absFromRepo(entry.assetPath);
    if (!existsSync(abs)) {
      throw new Error(`inspectActorIdentityAndWardrobe: missing GLB ${entry.assetPath}`);
    }
    const assetContentHash = await sha256File(abs);
    const { garmentMeshNames, garmentTriangleCounts, meshTriByName } = await inspectGlbMeshes(abs);
    const realGarmentRegionFaceCount = await realGarmentRegionFaceCountFromReport(
      entry.assetPath,
      meshTriByName,
    );
    actors.push({
      actorId: entry.actorId,
      resolvedAssetPath: entry.assetPath,
      assetContentHash,
      garmentMeshNames,
      garmentTriangleCounts,
      realGarmentRegionFaceCount,
    });
  }

  return { scenarioId: input.scenarioId, actors };
}
