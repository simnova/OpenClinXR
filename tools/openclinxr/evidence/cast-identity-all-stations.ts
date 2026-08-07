/**
 * #102 cast-identity inspector — every shipped scenario, identity by content hash.
 *
 * claimScope: within-scenario distinct resolved GLB content; age-compatible pool reuse.
 * notEvidenceFor: clinical likeness, wardrobe quality, sex presentation from names,
 * production/Quest readiness.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listShippedCastScenarioIds,
  resolveScenarioActorCast,
  type ScenarioActorCast,
} from "../../../packages/openclinxr/asset-registry/src/actor-casting.js";

export type RoleAsset = {
  scenarioId: string;
  actorId: string;
  resolvedAssetPath: string;
  /** Content hash of the resolved GLB — never the assetId string. */
  assetContentHash: string;
  /**
   * Scenario id recorded on the asset's generation provenance when it matches this
   * role's station, OR null when the role reuses an age-compatible pool body that
   * was generated for another station (cross-scenario reuse is expected with 6 bodies).
   * Incompatible reuse (e.g. child mesh on an adult role) surfaces the foreign
   * generation scenarioId so the contract fails.
   */
  assetProvenanceScenarioId: string | null;
};

export type CastIdentityAcrossStationsReport = {
  scenarios: string[];
  roles: RoleAsset[];
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function absFromRepo(relOrAbs: string): string {
  return path.isAbsolute(relOrAbs) ? relOrAbs : path.join(repoRoot, relOrAbs);
}

async function sha256File(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

async function readGenerationScenarioId(provenanceManifestPath: string): Promise<string | null> {
  const abs = absFromRepo(provenanceManifestPath);
  if (!existsSync(abs)) return null;
  try {
    const raw = JSON.parse(await readFile(abs, "utf8")) as { scenarioId?: unknown };
    return typeof raw.scenarioId === "string" && raw.scenarioId.length > 0 ? raw.scenarioId : null;
  } catch {
    return null;
  }
}

function isChildAsset(entry: ScenarioActorCast): boolean {
  return entry.assetPath.includes("peds_patient_child") || entry.runtimeAssetPath.includes("peds_patient_child");
}

/**
 * Map generation provenance → inspect field.
 * Same-station generation keeps its scenarioId. Age-compatible pool reuse across
 * stations reports null (not a false generation claim). Age-incompatible assignment
 * reports the foreign generation id so contracts catch peds-child-as-adult etc.
 */
function provenanceForRole(
  roleScenarioId: string,
  entry: ScenarioActorCast,
  generationScenarioId: string | null,
): string | null {
  if (generationScenarioId === null) return null;
  if (generationScenarioId === roleScenarioId) return generationScenarioId;

  const childAsset = isChildAsset(entry);
  const childRole = entry.declaredAgeBand === "child";

  // Compatible pool reuse: adult body ↔ adult role, child body ↔ child role.
  if (childAsset === childRole) return null;

  // Incompatible (child mesh on adult role, or adult mesh forced onto child band).
  return generationScenarioId;
}

async function roleAsset(scenarioId: string, entry: ScenarioActorCast): Promise<RoleAsset> {
  const abs = absFromRepo(entry.assetPath);
  if (!existsSync(abs)) {
    throw new Error(`inspectCastIdentityAcrossStations: missing GLB ${entry.assetPath}`);
  }
  const [assetContentHash, generationScenarioId] = await Promise.all([
    sha256File(abs),
    readGenerationScenarioId(entry.provenanceManifestPath),
  ]);
  return {
    scenarioId,
    actorId: entry.actorId,
    resolvedAssetPath: entry.assetPath,
    assetContentHash,
    assetProvenanceScenarioId: provenanceForRole(scenarioId, entry, generationScenarioId),
  };
}

/**
 * Enumerate every castable shipped scenario (from scenarioBank via casting SSOT)
 * and resolve each humanoid role's asset content hash + provenance posture.
 */
export async function inspectCastIdentityAcrossStations(): Promise<CastIdentityAcrossStationsReport> {
  const scenarios = listShippedCastScenarioIds();
  const roles: RoleAsset[] = [];

  for (const scenarioId of scenarios) {
    const cast = resolveScenarioActorCast(scenarioId);
    for (const entry of cast) {
      roles.push(await roleAsset(scenarioId, entry));
    }
  }

  return { scenarios, roles };
}
