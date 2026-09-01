import path from "node:path";
import { factoryStationSchemas } from "../catalog.js";
import { repoRoot } from "../repo-root.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";

const ALBEDO_REL = "tools/openclinxr/asset-pipeline/environment/room-albedo-ao-bake.py";
const OCCLUSION_REL = "tools/openclinxr/asset-pipeline/environment/room-occlusion-bake.py";

export function planRoomGenerate(input: unknown): StationPlanResult {
  const root = repoRoot();
  return planFromCatalog("room_generate", input, (value) => ({
    environmentId: value["environmentId"],
    infinigenPrompt: value["infinigenPrompt"],
    seed: value["seed"],
    layoutVariant: value["layoutVariant"],
    bakerId: "room_environment",
    albedoScriptRel: ALBEDO_REL,
    occlusionScriptRel: OCCLUSION_REL,
    albedoScript: path.join(root, ALBEDO_REL),
    occlusionScript: path.join(root, OCCLUSION_REL),
    processIsolation: "fresh_subprocess",
  }));
}

export const roomGenerateRunner: StationRunner = {
  stationId: "room_generate",
  validate: (value) => factoryStationSchemas.room_generate["~standard"].validate(value),
  plan: planRoomGenerate,
  run: () => {
    throw new Error("room_generate.run: spawn Blender via pnpm factory:rooms:bake");
  },
};
