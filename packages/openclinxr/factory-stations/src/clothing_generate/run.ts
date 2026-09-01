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

export function runClothingGenerate(
  input: unknown,
  options: { garmentId?: string; garmentLayers?: string[] } = {},
): Record<string, unknown> {
  const planned = planClothingGenerate(input);
  if ("issues" in planned) {
    throw new Error(planned.issues.map((issue) => issue.message).join("; "));
  }
  return {
    ...planned.plan,
    status: "adapted",
    bakePathLlm: false,
    garmentId: options.garmentId ?? planned.plan["garmentToken"],
    garmentLayers: options.garmentLayers ?? [String(planned.plan["garmentToken"])],
  };
}

export const clothingGenerateRunner: StationRunner = {
  stationId: "clothing_generate",
  validate: (value) => factoryStationSchemas.clothing_generate["~standard"].validate(value),
  plan: planClothingGenerate,
  run: (value) => runClothingGenerate(value),
};
