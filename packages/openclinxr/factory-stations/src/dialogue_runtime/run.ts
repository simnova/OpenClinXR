import { factoryStationSchemas } from "../catalog.js";
import { planFromCatalog, type StationPlanResult, type StationRunner } from "../runner.js";

export function planDialogueRuntime(input: unknown): StationPlanResult {
  return planFromCatalog("dialogue_runtime", input, (value) => ({
    actorId: value["actorId"],
    openingUtterance: value["openingUtterance"],
    policyId: value["policyId"],
    bakerId: "dialogue_policy",
    adapter: "createDefaultConversationPolicy",
    adapterModule: "packages/openclinxr/conversation-policy/src/index.ts",
    bakePathLlm: false,
  }));
}

export const dialogueRuntimeRunner: StationRunner = {
  stationId: "dialogue_runtime",
  validate: (value) => factoryStationSchemas.dialogue_runtime["~standard"].validate(value),
  plan: planDialogueRuntime,
  run: () => {
    throw new Error("dialogue_runtime.run: conversation-policy adapter; no bake-path LLM");
  },
};
