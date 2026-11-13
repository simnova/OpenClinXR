import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

const timing = { doorwaySeconds: 4, encounterSeconds: 20, noteSeconds: 3 };

function blueprint(readyTimeoutSeconds = 10): Record<string, unknown> {
  return {
    blueprintId: "xs-ready-phase-clock",
    title: "XS ready phase clock",
    stationSlots: [{ slotId: "slot-a", order: 1, label: "A", requiredEnvironmentIds: [], requiredTraceTags: [] }],
    timing: { ...timing, readyTimeoutSeconds, breakAfterStationOrders: [] },
    requiredTraceTags: [],
    requiredSafetyCriticalTraceTags: [],
  };
}

const wait = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await wait(10);
  }
}

async function boot(): Promise<{ server: EncounterServer; connection: SyncConnection }> {
  const server = await (createEncounterServer as (options: Record<string, unknown>) => Promise<EncounterServer>)({ examBlueprint: blueprint() });
  const connection = await connect(server.url, { roomOptions: { actors: ["a1"] } }, true);
  return { server, connection };
}

const phases = (server: EncounterServer) => server.getConversationTrace().events
  .filter((event) => event.kind === "phase-changed")
  .map((event) => event.phase);

describe("XS-READY phase clock latch", () => {
  it("RED1: attaching a timed station leaves the full doorway duration dormant with no phase trace", async () => {
    const { server, connection } = await boot();
    try {
      await wait(100);
      expect(JSON.parse(server.getStateJSON())).toMatchObject({ phase: "doorway", phaseRemainingS: 4, stationStarted: false });
      expect(phases(server)).toEqual([]);
    } finally {
      await connection.leave().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });

  it.each([0, 2890, 2733, 2560])("RED2/RED3: ready after %d ms enters encounter exactly four seconds later", async (lag) => {
    const { server, connection } = await boot();
    try {
      await wait(lag);
      connection.sendReady();
      await waitFor(() => phases(server).includes("encounter"), 5000, "encounter after ready");
      const at = server.getProbeStats().phaseChangedAtMs;
      expect((at["encounter"] ?? 0) - (at["doorway"] ?? 0)).toBeGreaterThanOrEqual(3900);
      expect((at["encounter"] ?? 0) - (at["doorway"] ?? 0)).toBeLessThanOrEqual(4200);
    } finally {
      await connection.leave().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  }, 12000);

  it("C2: start is idempotent so ready and timeout cannot create a second schedule", async () => {
    const { server, connection } = await boot();
    try {
      connection.sendReady();
      connection.sendReady();
      await waitFor(() => phases(server).includes("doorway"), 1000, "doorway after ready");
      await wait(50);
      expect(phases(server).filter((phase) => phase === "doorway")).toHaveLength(1);
      expect(server.getConversationTrace().events.filter((event) => event.kind === "station-ready")).toHaveLength(1);
    } finally {
      await connection.leave().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });
});
