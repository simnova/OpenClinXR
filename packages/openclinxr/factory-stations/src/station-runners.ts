import type { ProductionStationId } from "./catalog.js";
import type { StationRunner } from "./runner.js";
import { bodyParamRunner } from "./body_param/run.js";
import { clothingConsumeRunner } from "./clothing_consume/run.js";
import { clothingGenerateRunner } from "./clothing_generate/run.js";
import { dialogueRuntimeRunner } from "./dialogue_runtime/run.js";
import { equipmentGenerateRunner } from "./equipment_generate/run.js";
import { lightingDesignRunner } from "./lighting_design/run.js";
import { lipSyncRunner } from "./lip_sync/run.js";
import { motionRetargetRunner } from "./motion_retarget/run.js";
import { roomGenerateRunner } from "./room_generate/run.js";
import { stagingRunner } from "./staging/run.js";

export const stationRunners: Record<ProductionStationId, StationRunner> = {
  body_param: bodyParamRunner,
  clothing_generate: clothingGenerateRunner,
  clothing_consume: clothingConsumeRunner,
  motion_retarget: motionRetargetRunner,
  lip_sync: lipSyncRunner,
  room_generate: roomGenerateRunner,
  equipment_generate: equipmentGenerateRunner,
  staging: stagingRunner,
  dialogue_runtime: dialogueRuntimeRunner,
  lighting_design: lightingDesignRunner,
};
