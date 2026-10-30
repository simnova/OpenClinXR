import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C7 RED (planted by root, 2026-10-30): multi-station rotation for a Step 2 CS-style exam.
// Contract (names are the spec):
//   createEncounterServer({ timing, stations: ["station-1", "station-2"] }) (SERVER config only)
//   state.stationId / state.stationIndex / state.stationCount sync to clients
//     (no stations -> stationId "", stationIndex 0, stationCount 0: C6 behaviour, no rotation)
//   a learner's first join always lands in stations[0]; client roomOptions.stationId/stationIndex ignored
//   when a station reaches "closed", the server moves each connected learner to the next station's
//     room (server-issued seat reservation; the client consumes it, it never picks a station);
//     the same SyncConnection keeps working: sendIntent goes to the new room
//   after the last station closes there is no further rotation
//   SyncConnection.onState keeps firing across rotation; EncounterSnapshot gains stationId
//   each station persists its own trace file in traceDir with a top-level stationId; phase-changed
//     events and turns stay in the station where they happened
// Illustrative test timing (1/1/1 s) keeps the suite short; it is not a product value.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 1 };
const STATIONS = ["station-1", "station-2"];
// One station is 3 s on TIMING; a two-station session closes in ~6 s plus rotation. 15 s bounds it
// with margin for a loaded host (pre-push runs under worker load, memory pre-push-tests-time-out).
const SESSION_TIMEOUT_MS = 15000;

interface C7State {
  phase: string;
  stationId?: string;
  stationIndex?: number;
  stationCount?: number;
}
interface PersistedTrace {
  stationId?: string;
  events: Array<{ kind: string; phase?: string; sessionId?: unknown }>;
  turns: Array<{ turnId: number; end: string }>;
}
type Snapshot = { stationId?: string; phase: string };

const servers: EncounterServer[] = [];
const leavers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  while (leavers.length > 0) {
    try {
      await leavers.pop()?.();
    } catch {
      // best-effort
    }
  }
  while (servers.length > 0) {
    try {
      await servers.pop()?.close();
    } catch {
      // best-effort
    }
  }
});

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (condition()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function serverState(server: EncounterServer): C7State {
  return JSON.parse(server.getStateJSON()) as C7State;
}
// Last snapshot delivered to onState. The onState subscription made at join must keep
// firing after rotation (the client re-wires it on the new room).
const lastSnapshot = new WeakMap<SyncConnection, Snapshot>();
function pageState(connection: SyncConnection): Snapshot {
  return lastSnapshot.get(connection) ?? { phase: "" };
}
function traces(dir: string): PersistedTrace[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".conversation-trace.json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as PersistedTrace);
}
function phasesOf(t: PersistedTrace): Array<string | undefined> {
  return t.events.filter((e) => e.kind === "phase-changed").map((e) => e.phase);
}

async function boot(
  serverOptions: Record<string, unknown>,
  roomOptions: Record<string, unknown> = {},
): Promise<{ server: EncounterServer; connection: SyncConnection; traceDir: string }> {
  const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c7-"));
  const server = await (createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>)({
    traceDir,
    ...serverOptions,
  });
  servers.push(server);
  const connection = await connect(server.url, { roomOptions: { actors: ["a1", "a2"], ...roomOptions } });
  connection.onState((snapshot) => lastSnapshot.set(connection, snapshot as unknown as Snapshot));
  leavers.push(() => connection.leave());
  return { server, connection, traceDir };
}

describe("xr-sync-server C7 multi-station rotation", () => {
  it("known-good: without stations the room keeps C6 behaviour and never rotates", async () => {
    const { server, connection } = await boot({ timing: TIMING });
    expect(serverState(server).phase).toBe("doorway");
    await waitFor(() => serverState(server).phase === "closed", SESSION_TIMEOUT_MS, "closed");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(serverState(server).phase).toBe("closed");
    expect(await connection.sendIntent("pose", { x: 0, y: 1.6, z: 0 })).toMatchObject({ status: "ack" });
  }, 30000);

  it("first join lands in stations[0] with station fields synced", async () => {
    const { server, connection } = await boot({ timing: TIMING, stations: STATIONS });
    expect(serverState(server)).toMatchObject({ stationId: "station-1", stationIndex: 0, stationCount: 2 });
    await waitFor(() => pageState(connection).stationId === "station-1", 2000, "page sees station-1");
  }, 30000);

  it("counterweight: a client cannot choose its station", async () => {
    const { server } = await boot({ timing: TIMING, stations: STATIONS }, { stationId: "station-2", stationIndex: 1 });
    expect(serverState(server)).toMatchObject({ stationId: "station-1", stationIndex: 0 });
  }, 30000);

  it("rotates the same connection to the next station when a station closes, then stops", async () => {
    const { server, connection, traceDir } = await boot({ timing: TIMING, stations: STATIONS });
    await waitFor(() => serverState(server).stationId === "station-2", SESSION_TIMEOUT_MS, "station-2 room");
    await waitFor(() => pageState(connection).stationId === "station-2", 3000, "page in station-2");
    expect(serverState(server).phase).toBe("doorway");
    expect(await connection.sendIntent("pose", { x: 0, y: 1.6, z: 0 })).toMatchObject({ status: "ack" });
    await waitFor(() => serverState(server).phase === "encounter", 5000, "station-2 encounter");
    expect(await connection.sendIntent("select-actor", { actorId: "a1" })).toMatchObject({ status: "ack" });
    await waitFor(() => serverState(server).phase === "closed", SESSION_TIMEOUT_MS, "station-2 closed");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(serverState(server).stationId).toBe("station-2");
    expect(pageState(connection).stationId).toBe("station-2");
    // station-1 room disposed on rotation, so its trace is on disk; station-2 persists on close.
    await server.close();
    servers.pop();
    leavers.pop();
    const all = traces(traceDir);
    expect(all.map((t) => t.stationId).sort()).toEqual(["station-1", "station-2"]);
    for (const t of all) {
      expect(phasesOf(t)).toEqual(["doorway", "encounter", "note", "closed"]);
    }
  }, 40000);

  it("a turn stays in the station trace where it happened", async () => {
    const { server, connection, traceDir } = await boot({ timing: TIMING, stations: STATIONS });
    await waitFor(() => serverState(server).phase === "encounter", 5000, "station-1 encounter");
    await connection.sendIntent("select-actor", { actorId: "a1" });
    await connection.sendIntent("utterance-start", {});
    await connection.sendIntent("utterance-end", {});
    await waitFor(() => serverState(server).stationId === "station-2", SESSION_TIMEOUT_MS, "station-2 room");
    await waitFor(() => serverState(server).phase === "closed", SESSION_TIMEOUT_MS, "station-2 closed");
    await server.close();
    servers.pop();
    leavers.pop();
    const byStation = new Map(traces(traceDir).map((t) => [t.stationId, t]));
    expect(byStation.get("station-1")?.turns.length).toBe(1);
    expect(byStation.get("station-1")?.turns[0]?.end).toBe("closed-by-phase");
    expect(byStation.get("station-2")?.turns.length).toBe(0);
  }, 40000);
});
