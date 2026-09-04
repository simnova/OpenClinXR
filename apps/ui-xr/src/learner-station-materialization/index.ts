import type { LearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";

export const learnerStationMaterializationNotEvidenceFor = [
  "production_asset_readiness",
  "quest_readiness",
  "clinical_validity",
  "scoring_validity",
] as const;

export const learnerStationMaterializationClaimBoundary =
  "learner_station_materialization_not_runtime_readiness" as const;

export type MaterializedStationMemberKind =
  | "actor"
  | "room"
  | "equipment"
  | "motion"
  | "voice"
  | "interaction";

export type MaterializedStationMember = {
  kind: MaterializedStationMemberKind;
  id: string;
  assetId: string | null;
};

export type LearnerStationMaterialization = {
  stationId: string;
  scenarioId: string;
  bundleId: string;
  mounted: true;
  actors: MaterializedStationMember[];
  rooms: MaterializedStationMember[];
  equipment: MaterializedStationMember[];
  motion: MaterializedStationMember[];
  voice: MaterializedStationMember[];
  interactions: MaterializedStationMember[];
  claimBoundary: typeof learnerStationMaterializationClaimBoundary;
  notEvidenceFor: typeof learnerStationMaterializationNotEvidenceFor;
};

/**
 * Project a verified learner bundle into the six station member lists a runtime can mount.
 * Does not load GLBs or claim Quest/production readiness.
 */
export function materializeLearnerStationFromBundle(
  bundle: LearnerRuntimeAssetBundle,
): LearnerStationMaterialization {
  const actors: MaterializedStationMember[] = bundle.actors.map((actor) => ({
    kind: "actor",
    id: actor.actorId,
    assetId: actor.model.assetId,
  }));
  const rooms: MaterializedStationMember[] = [
    {
      kind: "room",
      id: bundle.environment.scenarioAssetId,
      assetId: bundle.environment.assetId,
    },
  ];
  const equipment: MaterializedStationMember[] = bundle.equipment.map((item) => ({
    kind: "equipment",
    id: item.equipmentId,
    assetId: item.model.assetId,
  }));
  const motion: MaterializedStationMember[] = bundle.actors.flatMap((actor) =>
    actor.animationClips.map((clip) => ({
      kind: "motion" as const,
      id: clip.assetId,
      assetId: clip.assetId,
    })),
  );
  const voice: MaterializedStationMember[] = bundle.actors.flatMap((actor) =>
    actor.phonemeMap
      ? [{ kind: "voice" as const, id: actor.phonemeMap.assetId, assetId: actor.phonemeMap.assetId }]
      : [],
  );
  const interactions: MaterializedStationMember[] = [
    ...bundle.uiSurfaces.map((surface) => ({
      kind: "interaction" as const,
      id: surface.surfaceId,
      assetId: surface.schema?.assetId ?? surface.data?.assetId ?? null,
    })),
    ...(bundle.sceneManifest.dialogueTurns ?? []).map((turn, index) => ({
      kind: "interaction" as const,
      id: turn.traceTag || `${turn.actorId}:${index}`,
      assetId: null,
    })),
  ];

  return {
    stationId: bundle.stationId,
    scenarioId: bundle.scenarioId,
    bundleId: bundle.bundleId,
    mounted: true,
    actors,
    rooms,
    equipment,
    motion,
    voice,
    interactions,
    claimBoundary: learnerStationMaterializationClaimBoundary,
    notEvidenceFor: learnerStationMaterializationNotEvidenceFor,
  };
}
