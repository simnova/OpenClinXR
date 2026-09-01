import path from "node:path";
import { factoryStationSchemas } from "../catalog.js";
import { repoRoot } from "../repo-root.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";

const STAGE_REL = "tools/openclinxr/asset-pipeline/makeclothes/motion_bind_stage.py";

export function planMotionRetarget(input: unknown): StationPlanResult {
  return planFromCatalog("motion_retarget", input, (value) => ({
    actorId: value["actorId"],
    clipId: value["clipId"],
    bakerId: "motion_bind_stage",
    stageId: "motion_bind_stage",
    stageScript: path.join(repoRoot(), STAGE_REL),
    stageScriptRel: STAGE_REL,
    adapter: "@openclinxr/motion-compiler",
    processIsolation: "fresh_subprocess",
  }));
}

export const motionRetargetRunner: StationRunner = {
  stationId: "motion_retarget",
  validate: (value) => factoryStationSchemas.motion_retarget["~standard"].validate(value),
  plan: planMotionRetarget,
  run: () => {
    throw new Error("motion_retarget.run: spawn via pnpm asset:motion-bind -- --once");
  },
};
