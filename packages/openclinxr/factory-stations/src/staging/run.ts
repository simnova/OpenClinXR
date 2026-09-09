import { factoryStationSchemas } from "../catalog.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";

export function planStaging(input: unknown): StationPlanResult {
  return planFromCatalog("staging", input, (value) => {
    const plantOffsetMeters = value["plantOffsetMeters"] as { x: number; y: number; z: number } | undefined;
    return {
      actorId: value["actorId"],
      supportSurface: value["supportSurface"],
      plantOffsetMeters: plantOffsetMeters ?? { x: 0, y: 0, z: 0 },
      bakerId: "actor_placement",
      adapter: "generatedActorPlacement",
      adapterModule: "packages/openclinxr/asset-registry/src/actor-placement.ts",
    };
  });
}

export function runStaging(
  input: unknown,
  options: { placement?: unknown } = {},
): Record<string, unknown> {
  const planned = planStaging(input);
  if (planned.issues !== undefined) {
    throw new Error(planned.issues.map((issue) => issue.message).join("; "));
  }
  return {
    ...planned.plan,
    status: "adapted",
    placement: options.placement ?? null,
  };
}

export const stagingRunner: StationRunner = {
  stationId: "staging",
  validate: (value) => factoryStationSchemas.staging["~standard"].validate(value),
  plan: planStaging,
  run: (value) => runStaging(value),
};
