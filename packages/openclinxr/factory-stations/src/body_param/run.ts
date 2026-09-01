import path from "node:path";
import { factoryStationSchemas } from "../catalog.js";
import { repoRoot } from "../repo-root.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";

const STAGE_REL = "tools/openclinxr/asset-pipeline/makeclothes/body_param_stage.py";

export function planBodyParam(input: unknown): StationPlanResult {
  return planFromCatalog("body_param", input, (value) => ({
    actorId: value["actorId"],
    ageYears: value["ageYears"],
    sex: value["sex"],
    heightCm: value["heightCm"],
    garmentLayers: value["garmentLayers"],
    bakerId: "body_param_stage",
    stageId: "body_param_stage",
    stageScript: path.join(repoRoot(), STAGE_REL),
    stageScriptRel: STAGE_REL,
    processIsolation: "fresh_subprocess",
  }));
}

export const bodyParamRunner: StationRunner = {
  stationId: "body_param",
  validate: (value) => factoryStationSchemas.body_param["~standard"].validate(value),
  plan: planBodyParam,
  run: () => {
    throw new Error("body_param.run: spawn Blender via pnpm asset:body-param:fit -- --once");
  },
};
