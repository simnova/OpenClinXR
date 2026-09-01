import { factoryStationSchemas } from "../catalog.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";

export function planLipSync(input: unknown): StationPlanResult {
  return planFromCatalog("lip_sync", input, (value) => ({
    actorId: value["actorId"],
    visemeBank: value["visemeBank"],
    bakerId: "rhubarb",
    tool: "rhubarb",
    exportFormat: "json",
    processIsolation: "fresh_subprocess",
    network: false,
  }));
}

export const lipSyncRunner: StationRunner = {
  stationId: "lip_sync",
  validate: (value) => factoryStationSchemas.lip_sync["~standard"].validate(value),
  plan: planLipSync,
  run: () => {
    throw new Error("lip_sync.run: spawn rhubarb via dark-factory runLipSyncStation");
  },
};
