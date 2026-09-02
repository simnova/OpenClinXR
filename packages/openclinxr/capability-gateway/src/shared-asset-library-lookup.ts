import type {
  EncounterExecutableAssetGenerationRequest,
  EncounterGenerationWorkOrderTargetKind,
  EncounterSharedAssetLibraryReusePolicy,
} from "./asset-generation-jobs.js";

export function buildSharedAssetLibraryReusePolicy(
  request: Pick<EncounterExecutableAssetGenerationRequest, "targetAssetStore">,
  lookupKey: string,
): EncounterSharedAssetLibraryReusePolicy {
  return {
    lookupKey,
    lookupKeySource: "encounter_definition_semantic_requirements",
    sharedLibraryRefs: {
      blobPrefix: `blob://${request.targetAssetStore.containerName}/shared-encounter-assets/${lookupKey}/`,
      mongooseCollectionName: "shared_encounter_asset_library",
    },
    lruCache: {
      enabled: true,
      maxEntries: 500,
      evictionPolicy: "least_recently_used",
      reuseRequiresEvidenceGateCompatibility: true,
      updateRecencyOnHit: true,
    },
    cacheDisposition: "lookup_before_generate",
  };
}

/** Use compile recipe cacheKey when supplied; never hash the semantic join. */
export function resolveSharedAssetLibraryLookupKey(
  request: EncounterExecutableAssetGenerationRequest,
  input: {
    targetKind: EncounterGenerationWorkOrderTargetKind;
    actorRole?: string;
    semanticInputs: string[];
  },
): string {
  const compileCacheKey = compileRecipeCacheKeyFromRequest(request, input.targetKind, input.actorRole);
  if (compileCacheKey) return compileCacheKey;
  return buildSharedAssetLibraryLookupKey({
    scenarioId: request.scenarioId,
    targetKind: input.targetKind,
    ...(input.actorRole ? { actorRole: input.actorRole } : {}),
    semanticInputs: input.semanticInputs,
  });
}

function compileRecipeCacheKeyFromRequest(
  request: EncounterExecutableAssetGenerationRequest,
  targetKind: EncounterGenerationWorkOrderTargetKind,
  actorRole?: string,
): string | undefined {
  const keys = request.recipeCacheKeys;
  if (!keys) return undefined;
  const candidates: string[] = [];
  if (actorRole) {
    candidates.push(`${targetKind}::${actorRole}`, `${targetKind}:${actorRole}`);
  }
  candidates.push(targetKind);
  for (const candidate of candidates) {
    const value = keys[candidate];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function buildSharedAssetLibraryLookupKey(input: {
  scenarioId: string;
  targetKind: EncounterGenerationWorkOrderTargetKind;
  actorRole?: string;
  semanticInputs: string[];
}): string {
  return safeWorkOrderSegment([
    input.targetKind,
    input.actorRole ?? "scenario",
    ...input.semanticInputs,
  ].join("__"));
}

function safeWorkOrderSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "actor";
}
