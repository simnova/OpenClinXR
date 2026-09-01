import path from "node:path";
import { factoryStationSchemas } from "../catalog.js";
import { repoRoot } from "../repo-root.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";

const STAGE_REL = "tools/openclinxr/asset-pipeline/makeclothes/fit_stage.py";

export function planClothingConsume(input: unknown): StationPlanResult {
  return planFromCatalog("clothing_consume", input, (value) => ({
    actorId: value["actorId"],
    mhcloPath: value["mhcloPath"],
    bakerId: "makeclothes_fit_stage",
    stageId: "makeclothes_fit_stage",
    stageScript: path.join(repoRoot(), STAGE_REL),
    stageScriptRel: STAGE_REL,
    processIsolation: "fresh_subprocess",
  }));
}

export const clothingConsumeRunner: StationRunner = {
  stationId: "clothing_consume",
  validate: (value) => factoryStationSchemas.clothing_consume["~standard"].validate(value),
  plan: planClothingConsume,
  run: () => {
    throw new Error("clothing_consume.run: spawn Blender via pnpm asset:makeclothes:fit -- --once");
  },
};
