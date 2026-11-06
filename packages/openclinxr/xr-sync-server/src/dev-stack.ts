import type { ExamBlueprint, Scenario } from "@openclinxr/shared-schemas";

export const DEFAULT_DEV_SCENARIO_ID = "ed_chest_pain_priority_v1";
export const DEFAULT_DEV_ENCOUNTER_SECONDS = 900;
export const DEFAULT_DEV_DOORWAY_SECONDS = 1;

export interface DevStackShipped {
  scenarioBank: readonly Scenario[];
  scenarioDialogueSeedBank: readonly { scenarioId: string }[];
}

export interface DevStack {
  scenarioId: string;
  actorCount: number;
  examBlueprint: ExamBlueprint;
  scenarios: Scenario[];
  dialogueSeeds: readonly { scenarioId: string }[];
}

export function resolveDevStack(env: Record<string, string | undefined>, shipped: DevStackShipped): DevStack {
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates bracket access on env.
  const rawId = env["XR_SYNC_SCENARIO"];
  const id = rawId !== undefined && rawId !== "" ? rawId : DEFAULT_DEV_SCENARIO_ID;
  const seedIds = new Set(shipped.scenarioDialogueSeedBank.map((entry) => entry.scenarioId));
  const known = shipped.scenarioBank.filter((candidate) => seedIds.has(candidate.scenarioId));
  const knownIds = known.map((candidate) => candidate.scenarioId);
  const scenario = known.find((entry) => entry.scenarioId === id);
  if (scenario === undefined) {
    throw new Error(`unknown-scenario: ${JSON.stringify(id)} (known: ${knownIds.join(", ")})`);
  }
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates bracket access on env.
  const raw = env["XR_SYNC_ENCOUNTER_SECONDS"];
  let seconds = DEFAULT_DEV_ENCOUNTER_SECONDS;
  if (raw !== undefined && raw !== "") {
    if (!/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 86400) {
      throw new Error(
        `bad-encounter-seconds: XR_SYNC_ENCOUNTER_SECONDS must be an integer 1-86400 (got ${JSON.stringify(raw)})`,
      );
    }
    seconds = Number(raw);
  }
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates bracket access on env.
  const rawDoorway = env["XR_SYNC_DOORWAY_SECONDS"];
  let doorwaySeconds = DEFAULT_DEV_DOORWAY_SECONDS;
  if (rawDoorway !== undefined && rawDoorway !== "") {
    if (!/^[1-9][0-9]{0,3}$/.test(rawDoorway) || Number(rawDoorway) > 3600) {
      throw new Error(
        `bad-doorway-seconds: XR_SYNC_DOORWAY_SECONDS must be an integer 1-3600 (got ${JSON.stringify(rawDoorway)})`,
      );
    }
    doorwaySeconds = Number(rawDoorway);
  }
  const examBlueprint: ExamBlueprint = {
    blueprintId: `bp-dev-${id}`,
    title: `Dev stack: ${scenario.title}`,
    stationSlots: [
      {
        slotId: "slot-a",
        order: 1,
        label: scenario.title,
        requiredEnvironmentIds: [],
        requiredTraceTags: [],
      },
    ],
    timing: { doorwaySeconds, encounterSeconds: seconds, noteSeconds: 60, breakAfterStationOrders: [] },
    requiredTraceTags: [],
    requiredSafetyCriticalTraceTags: [],
  };
  // Local dev only: shipped scenarios may still be drafts, so they are castable to approved here.
  const scenarios: Scenario[] = [{ ...scenario, status: "approved" }];
  return {
    scenarioId: id,
    actorCount: scenario.actors.length,
    examBlueprint,
    scenarios,
    dialogueSeeds: shipped.scenarioDialogueSeedBank,
  };
}
