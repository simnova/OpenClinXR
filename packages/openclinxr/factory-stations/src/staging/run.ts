import { factoryStationSchemas } from "../catalog.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";

export function planStaging(input: unknown): StationPlanResult {
  return planFromCatalog("staging", input, (value) => ({
    actorId: value["actorId"],
    supportSurface: value["supportSurface"],
    plantOffsetMeters: value["plantOffsetMeters"],
    bakerId: "actor_placement",
    adapter: "generatedActorPlacement",
    adapterModule: "packages/openclinxr/asset-registry/src/actor-placement.ts",
  }));
}

export const stagingRunner: StationRunner = {
  stationId: "staging",
  validate: (value) => factoryStationSchemas.staging["~standard"].validate(value),
  plan: planStaging,
  run: () => {
    throw new Error("staging.run: in-process generatedActorPlacement; tests must call plan()");
  },
};
