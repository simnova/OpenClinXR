import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

const servers: EncounterServer[] = [];
const clients: SyncConnection[] = [];

afterEach(async () => {
  while (clients.length > 0) await clients.pop()?.leave().catch(() => undefined);
  while (servers.length > 0) await servers.pop()?.close().catch(() => undefined);
});

function blueprint(readyTimeoutSeconds: number): Record<string, unknown> {
  return {
    blueprintId: "xs-ready-test",
    title: "XS ready",
    stationSlots: [{ slotId: "slot-a", order: 1, label: "A", requiredEnvironmentIds: [], requiredTraceTags: [] }],
    timing: { doorwaySeconds: 1, encounterSeconds: 2, noteSeconds: 1, readyTimeoutSeconds, breakAfterStationOrders: [] },
    requiredTraceTags: [],
    requiredSafetyCriticalTraceTags: [],
  };
}

async function boot(timeout: number): Promise<EncounterServer> {
  const server = await (createEncounterServer as (options: Record<string, unknown>) => Promise<EncounterServer>)({ examBlueprint: blueprint(timeout) });
  servers.push(server);
  return server;
}

async function join(server: EncounterServer, role = "learner"): Promise<SyncConnection> {
  const connection = await connect(server.url, { roomOptions: { role, actors: ["a1"] } }, true);
  clients.push(connection);
  return connection;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const kinds = (server: EncounterServer) => server.getConversationTrace().events.map((event) => event.kind);

describe("XS-READY room ready handler", () => {
  it("C1/C1b: observer ready is traced and ignored; first learner starts once and later learners cannot restart", async () => {
    const server = await boot(2);
    const observer = await join(server, "observer");
    observer.sendReady();
    await wait(30);
    expect(kinds(server)).toContain("ready-ignored");
    expect(kinds(server)).not.toContain("phase-changed");

    const first = await join(server);
    first.sendReady();
    await wait(30);
    await first.leave(false);
    await first.reconnect();
    await wait(30);
    const second = await join(server);
    second.sendReady();
    await wait(30);
    expect(kinds(server).filter((kind) => kind === "station-ready")).toHaveLength(1);
    expect(kinds(server).filter((kind) => kind === "phase-changed")).toEqual(["phase-changed"]);
  });

  it("C2/T3: timeout starts once, emits ready-timeout exactly once, and a late ready cannot add a station-ready", async () => {
    const server = await boot(0.05);
    const learner = await join(server);
    await wait(120);
    expect(kinds(server).filter((kind) => kind === "ready-timeout")).toHaveLength(1);
    expect(kinds(server).filter((kind) => kind === "phase-changed")).toHaveLength(1);
    learner.sendReady();
    await wait(30);
    expect(kinds(server).filter((kind) => kind === "ready-timeout")).toHaveLength(1);
    expect(kinds(server)).not.toContain("station-ready");
  });
});
