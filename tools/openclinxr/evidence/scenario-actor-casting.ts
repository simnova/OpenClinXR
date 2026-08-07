/**
 * #85 scenario-actor casting inspector.
 *
 * Reports declared age band (from scenario role rules) + resolved asset path from the
 * casting SSOT, with stature measured from the asset geometry and provenance scenarioId
 * read from the asset's provenance JSON — never invented by the casting code.
 *
 * claimScope: age-appropriate cast resolution + same-scenario provenance.
 * notEvidenceFor: clinical likeness, clothing quality, seated posture anatomy.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import {
  type DeclaredAgeBand,
  resolveScenarioActorCast,
  type ScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";

export type CastEntry = {
  actorId: string;
  declaredAgeBand: DeclaredAgeBand;
  resolvedAssetPath: string;
  /** Read from the asset's own geometry — the world-Y extent of its skinned mesh. */
  assetStatureMeters: number;
  /** Read from the asset's recorded provenance, not from the casting code. */
  assetProvenanceScenarioId: string;
};

export type ScenarioCastingReport = {
  scenarioId: string;
  actors: CastEntry[];
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function measureAssetStatureMeters(assetPath: string): Promise<number> {
  const abs = path.isAbsolute(assetPath) ? assetPath : path.join(repoRoot, assetPath);
  const doc = await new NodeIO().read(abs);
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      for (let i = 0; i < pos.getCount(); i++) {
        const v = [0, 0, 0];
        pos.getElement(i, v);
        minY = Math.min(minY, v[1]);
        maxY = Math.max(maxY, v[1]);
        minZ = Math.min(minZ, v[2]);
        maxZ = Math.max(maxZ, v[2]);
      }
    }
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    throw new Error(`measureAssetStatureMeters: no mesh positions in ${assetPath}`);
  }
  // Prefer Y-up height; if the mesh is laid along Z (bind bug class), take max extent.
  const hy = maxY - minY;
  const hz = maxZ - minZ;
  return Math.max(hy, hz);
}

async function readProvenanceScenarioId(provenanceManifestPath: string): Promise<string> {
  const abs = path.isAbsolute(provenanceManifestPath)
    ? provenanceManifestPath
    : path.join(repoRoot, provenanceManifestPath);
  const raw = await readFile(abs, "utf8");
  const json = JSON.parse(raw) as { scenarioId?: unknown };
  if (typeof json.scenarioId !== "string" || json.scenarioId.length === 0) {
    throw new Error(`provenance missing scenarioId: ${provenanceManifestPath}`);
  }
  return json.scenarioId;
}

async function toCastEntry(cast: ScenarioActorCast): Promise<CastEntry> {
  const [assetStatureMeters, assetProvenanceScenarioId] = await Promise.all([
    measureAssetStatureMeters(cast.assetPath),
    readProvenanceScenarioId(cast.provenanceManifestPath),
  ]);
  return {
    actorId: cast.actorId,
    declaredAgeBand: cast.declaredAgeBand,
    resolvedAssetPath: cast.assetPath,
    assetStatureMeters,
    assetProvenanceScenarioId,
  };
}

/**
 * Inspect casting for a scenario. Signature matches planted contracts (#85).
 */
export async function inspectScenarioCasting(input: {
  scenarioId: string;
}): Promise<ScenarioCastingReport> {
  const cast = resolveScenarioActorCast(input.scenarioId);
  if (cast.length === 0) {
    throw new Error(`inspectScenarioCasting: no casting table for scenario ${input.scenarioId}`);
  }
  const actors = await Promise.all(cast.map((entry) => toCastEntry(entry)));
  return { scenarioId: input.scenarioId, actors };
}
