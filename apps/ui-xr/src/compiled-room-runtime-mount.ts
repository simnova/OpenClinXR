/**
 * Map encounter-materialization / learner runtime bundle environment onto the
 * station shell. Fixture local shells stay parametric; identity must match
 * `room:<environmentId>` or the compiled URL is refused.
 *
 * claimScope: simulated_actor_or_factory_behavior
 * notEvidenceFor: clinical validity, licensure, exam equivalence, Quest readiness
 */

import type { EncounterRuntimeAsset } from "@openclinxr/asset-registry/runtime-bundles";
import { resolveRuntimeAssetUrl } from "@openclinxr/asset-registry/runtime-bundles";
import type { Group } from "three";
import {
  applyCompiledRoomReadinessOrFallback,
  fallbackCompiledRoomLoadFailure,
} from "./compiled-room-runtime.js";
import {
  resolveStationEnvironment,
  type BuildStationEnvironmentInput,
} from "./station-environment.js";

export type CompiledRoomRuntimeIdentity = {
  compiledRoomAssetUrl: string;
  compileNodeId: string;
};

export function compileNodeIdForEnvironment(environmentId: string): string {
  return `room:${environmentId.trim()}`;
}

/**
 * Fail-closed: no URL, blocked review, public fixture, or identity mismatch
 * returns null so the parametric shell remains the learner fallback.
 */
export function resolveCompiledRoomFromRuntimeEnvironment(input: {
  environmentId: string;
  environment: EncounterRuntimeAsset;
}): CompiledRoomRuntimeIdentity | null {
  const environmentId = input.environmentId.trim();
  if (!environmentId) return null;
  const compileNodeId = compileNodeIdForEnvironment(environmentId);
  const url = resolveRuntimeAssetUrl(input.environment).trim();
  if (!url) return null;
  if (input.environment.kind !== "environment_model") return null;
  if (input.environment.reviewStatus === "blocked") return null;
  if (input.environment.blob.storeKind === "app_public_fixture") return null;
  const identityTokens = [
    input.environment.assetId,
    input.environment.scenarioAssetId,
    ...input.environment.provenanceRefs,
  ];
  const identityOk = identityTokens.some(
    (token) => token === compileNodeId || token.includes(environmentId),
  );
  if (!identityOk) return null;
  return { compiledRoomAssetUrl: url, compileNodeId };
}

export async function mountStationEnvironmentForRuntime(input: {
  environmentId: string;
  environment: EncounterRuntimeAsset;
  loadGltf?: BuildStationEnvironmentInput["loadGltf"];
}): Promise<Group> {
  const compiled = resolveCompiledRoomFromRuntimeEnvironment(input);
  if (!compiled) {
    return resolveStationEnvironment({ environmentId: input.environmentId });
  }
  try {
    const loaded = await resolveStationEnvironment({
      environmentId: input.environmentId,
      compiledRoomAssetUrl: compiled.compiledRoomAssetUrl,
      compileNodeId: compiled.compileNodeId,
      ...(input.loadGltf ? { loadGltf: input.loadGltf } : {}),
    });
    return applyCompiledRoomReadinessOrFallback({
      compiled: loaded,
      environmentId: input.environmentId,
      compileNodeId: compiled.compileNodeId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "compiled room load failed";
    return fallbackCompiledRoomLoadFailure({
      environmentId: input.environmentId,
      compileNodeId: compiled.compileNodeId,
      message,
    });
  }
}
