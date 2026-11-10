import { readFileSync } from "node:fs";
import { createEncounterServer, type EncounterServer } from "./index.js";
import { afterEach, describe, expect, it } from "vitest";

// C56 RED: the synced server calls the shared last-station rule; its other behaviour is unchanged.
function blueprint(breakAfterStationOrders: number[]): Record<string, unknown> {
  return {
    blueprintId: "bp-fixture-c56",
    title: "Fixture two-station form",
    stationSlots: [
      { slotId: "slot-a", order: 1, label: "Fixture A", requiredEnvironmentIds: [], requiredTraceTags: [] },
      { slotId: "slot-b", order: 2, label: "Fixture B", requiredEnvironmentIds: [], requiredTraceTags: [] },
    ],
    timing: { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 1, breakSeconds: 2, breakAfterStationOrders },
    requiredTraceTags: [],
    requiredSafetyCriticalTraceTags: [],
  };
}
const boot = createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>;
const servers: EncounterServer[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});

describe("the synced server shares the last-station break rule", () => {
  it("CW1: exam-blueprint.ts imports effectiveBreakAfterStationOrders from shared-schemas and keeps no length - 1 rule", () => {
    const source = readFileSync(new URL("./exam-blueprint.ts", import.meta.url), "utf8");
    expect(source).toMatch(/import\s*\{[^}]*\beffectiveBreakAfterStationOrders\b[^}]*\}\s*from\s*"@openclinxr\/shared-schemas"/);
    expect(source).not.toMatch(/length\s*-\s*1/);
  });

  it("CW3: an order that is not a station order still refuses boot naming examBlueprint", async () => {
    await expect(boot({ examBlueprint: blueprint([5]) })).rejects.toThrow(/examBlueprint.*not a stationSlot order/);
  });

  it("CW4: a break order equal to the max station order still boots with no error", async () => {
    const server = await boot({ examBlueprint: blueprint([2]) });
    servers.push(server);
    expect(server.url).toMatch(/^wss?:/);
  });
});
