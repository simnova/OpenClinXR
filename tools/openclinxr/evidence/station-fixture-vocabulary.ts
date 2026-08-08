/**
 * #186 — station fixture vocabulary inspector (tools entry).
 *
 * Delegates to apps/ui-xr builders so `three` resolves under the ui-xr package.
 * Enumerates ENVIRONMENT_SHELL_DESCRIPTORS dynamically — never a hardcoded list.
 *
 * claimScope: fixture role uniqueness + identity geometry multi-mesh (not generic box).
 * notEvidenceFor: clinical staging validity, Quest readiness, generated room assets.
 */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENVIRONMENT_SHELL_DESCRIPTORS,
} from "../../../packages/openclinxr/asset-registry/src/environment-descriptors.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const generatedRoot = path.join(repoRoot, "apps/ui-xr/public/xr-assets/generated");

export type EnvironmentRow = {
  environmentId: string;
  fixtureSlotIds: string[];
  builtFixtureKinds: string[];
  meshesPerRole: Record<string, number>;
  duplicateRoles: string[];
  undifferentiatedPropIds: string[];
};

export type StationFixtureVocabularyReport = {
  environments: EnvironmentRow[];
  fixtureKindVocabulary: string[];
  claimScope: string;
  notEvidenceFor: string[];
};

async function loadEquipmentByEnvironment(): Promise<Record<string, string[]>> {
  const byEnv: Record<string, string[]> = {};
  if (!existsSync(generatedRoot)) return byEnv;
  let entries: string[] = [];
  try {
    entries = (await readdir(generatedRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return byEnv;
  }
  for (const scenarioId of entries) {
    const manifestPath = path.join(generatedRoot, scenarioId, "scene-manifest.v1.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const raw = JSON.parse(await readFile(manifestPath, "utf8")) as {
        environmentId?: string;
        equipmentPlacements?: Record<string, unknown>;
        equipment?: Array<{ equipmentId?: string }>;
      };
      const envId = raw.environmentId;
      if (!envId || !(envId in ENVIRONMENT_SHELL_DESCRIPTORS)) continue;
      const ids = new Set(byEnv[envId] ?? []);
      for (const id of Object.keys(raw.equipmentPlacements ?? {})) ids.add(id);
      for (const row of raw.equipment ?? []) {
        if (row.equipmentId) ids.add(row.equipmentId);
      }
      byEnv[envId] = [...ids].sort();
    } catch {
      /* ignore */
    }
  }
  return byEnv;
}

/**
 * Measure fixture vocabulary across all shipped environment shells.
 */
export async function inspectStationFixtureVocabulary(): Promise<StationFixtureVocabularyReport> {
  const equipmentByEnvironment = await loadEquipmentByEnvironment();
  // Dynamic import keeps three resolution inside apps/ui-xr.
  const mod = await import("../../../apps/ui-xr/src/station-fixture-vocabulary-inspect.js");
  return mod.inspectStationFixtureVocabulary({ equipmentByEnvironment });
}
