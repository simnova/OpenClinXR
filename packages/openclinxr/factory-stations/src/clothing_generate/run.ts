import { factoryStationSchemas } from "../catalog.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";

export function planClothingGenerate(input: unknown): StationPlanResult {
  return planFromCatalog("clothing_generate", input, (value) => ({
    actorId: value["actorId"],
    garmentToken: value["garmentToken"],
    bakerId: "garment_selection_by_role",
    adapter: "resolveHm08UpperGarment",
    adapterModule: "tools/openclinxr/asset-pipeline/makeclothes/garment-selection-by-role.ts",
  }));
}

export const clothingGenerateRunner: StationRunner = {
  stationId: "clothing_generate",
  validate: (value) => factoryStationSchemas.clothing_generate["~standard"].validate(value),
  plan: planClothingGenerate,
  run: () => {
    throw new Error("clothing_generate.run: phenotype.garmentLayers via garment-selection-by-role");
  },
};
