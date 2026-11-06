import { edChestPainScenario, scenarioDialogueSeedBank, scenarioBank } from "@openclinxr/scenario-fixtures";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";
import { resolveDevStack } from "./dev-stack.js";

// C36 RED (planted by lane manager, 2026-11-06): room state carries what the learner sees of the cast, and the dev stack's doorway is configurable.
// Contract (names are the spec):
//   ActorState gains displayName: string and role: string. A cast station fills them from the scenario actor (displayName, role);
//   an uncast station (client roomOptions.actors) leaves both "". The plain snapshot (client onState) carries both per actor.
//   resolveDevStack reads XR_SYNC_DOORWAY_SECONDS (integer 1-3600, default 1) into examBlueprint.timing.doorwaySeconds; anything else throws
//   `bad-doorway-seconds: XR_SYNC_DOORWAY_SECONDS must be an integer 1-3600 (got "<value>")`.
//   Guard: an utterance-start during the doorway rejects "outside-encounter-phase" (the reason the shell turns into text).
const CHEST = { ...edChestPainScenario, status: "approved" as const, eventSchedule: edChestPainScenario.eventSchedule.map((entry) => ({ ...entry, atSecond: 4 })) };
const blueprint = (doorwaySeconds: number) => ({
  blueprintId: "bp-c36",
  title: "C36 one-slot form",
  stationSlots: [{ slotId: "slot-a", order: 1, label: "A", requiredEnvironmentIds: [], requiredTraceTags: [] }],
  timing: { doorwaySeconds, encounterSeconds: 6, noteSeconds: 1, breakAfterStationOrders: [] },
  requiredTraceTags: [],
  requiredSafetyCriticalTraceTags: [],
});
const servers: EncounterServer[] = [];
const leavers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (leavers.length > 0) await leavers.pop()?.().catch(() => undefined);
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});
const bootServer = createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>;
async function boot(options: Record<string, unknown>): Promise<EncounterServer> {
  const server = await bootServer(options);
  servers.push(server);
  return server;
}
async function join(server: EncounterServer): Promise<{ connection: SyncConnection; last: () => Record<string, unknown> | undefined }> {
  const connection = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
  leavers.push(() => connection.leave());
  let last: Record<string, unknown> | undefined;
  connection.onState((snapshot) => { last = snapshot as unknown as Record<string, unknown>; });
  return { connection, last: () => last };
}
async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
type Actors = Record<string, { displayName?: string; role?: string }>;
const actorsOf = (state: Record<string, unknown> | undefined): Actors => ((state?.["actors"] ?? {}) as Actors);

describe("xr-sync-server C36 room display state", () => {
  it("a cast station publishes each actor's displayName and role from the scenario", async () => {
    const server = await boot({ examBlueprint: blueprint(1), scenarios: [CHEST] });
    const { last } = await join(server);
    await waitFor(() => Object.keys(actorsOf(last())).length === CHEST.actors.length, 5000, "cast roster");
    for (const actor of CHEST.actors) {
      expect(actorsOf(last())[actor.actorId]).toMatchObject({ displayName: actor.displayName, role: actor.role });
    }
    expect(JSON.parse(server.getStateJSON()).actors[CHEST.actors[0]!.actorId]).toMatchObject({ displayName: CHEST.actors[0]!.displayName, role: CHEST.actors[0]!.role });
  }, 20000);

  it("an uncast station leaves displayName and role empty", async () => {
    const server = await boot({ timing: { doorwaySeconds: 1, encounterSeconds: 4, noteSeconds: 1 } });
    const { last } = await join(server);
    await waitFor(() => actorsOf(last())["a1"] !== undefined, 5000, "plain roster");
    expect(actorsOf(last())["a1"]).toMatchObject({ displayName: "", role: "" });
  }, 20000);

  it("known-good: an utterance-start during the doorway rejects outside-encounter-phase", async () => {
    const server = await boot({ examBlueprint: blueprint(4), scenarios: [CHEST] });
    const { connection } = await join(server);
    expect(await connection.sendIntent("utterance-start", {})).toMatchObject({ status: "reject", reason: "outside-encounter-phase" });
  }, 20000);
});

describe("dev stack doorway seconds (C36)", () => {
  const shipped = { scenarioBank, scenarioDialogueSeedBank };
  it("defaults to 1 and reads XR_SYNC_DOORWAY_SECONDS", () => {
    expect(resolveDevStack({}, shipped).examBlueprint.timing.doorwaySeconds).toBe(1);
    expect(resolveDevStack({ XR_SYNC_DOORWAY_SECONDS: "8" }, shipped).examBlueprint.timing.doorwaySeconds).toBe(8);
    expect(resolveDevStack({ XR_SYNC_DOORWAY_SECONDS: "" }, shipped).examBlueprint.timing.doorwaySeconds).toBe(1);
  });
  it.each(["0", "-3", "1.5", "abc", "3601", "08"])("refuses %s", (value) => {
    expect(() => resolveDevStack({ XR_SYNC_DOORWAY_SECONDS: value }, shipped)).toThrow(`bad-doorway-seconds: XR_SYNC_DOORWAY_SECONDS must be an integer 1-3600 (got ${JSON.stringify(value)})`);
  });
});
