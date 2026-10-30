import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type IntentResult, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C8 RED (planted by root, 2026-10-30): the faculty observer follows the learner through
// station rotation, and rotation loses no intent.
// Contract (names are the spec):
//   with stations configured, an observer in station N's room is rotated with the learners
//     (same server-issued reservation path; an observer never picks a station)
//   the next station's state.observerCount counts the arrived observer; its trace records
//     observer-joined (and the old station's trace records observer-left)
//   the observer's SyncConnection.onState keeps firing across rotation
//   every intent the learner sends while rotation happens settles as an ack (pose is accepted in
//     every phase, C6): no reject from the client's own room-left path, no 5 s timeout
// Illustrative test timing (1/1/1 s) keeps the suite short; it is not a product value.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 1 };
const STATIONS = ["station-1", "station-2"];
// Two 3 s stations plus rotation; 15 s bounds it on a loaded host (C7 RED provenance).
const SESSION_TIMEOUT_MS = 15000;
// Pose bursts during the rotation window: BURST intents every 5 ms, so intents are still
// unacked at the moment the client switches rooms (one pose per tick acks before the old room's
// leave completes on a local host and never exercises the in-flight path).
const POSE_INTERVAL_MS = 5;
const POSE_BURST = 200;

interface C8State {
  phase: string;
  stationId?: string;
  observerCount?: number;
}
interface PersistedTrace {
  stationId?: string;
  events: Array<{ kind: string }>;
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

function serverState(server: EncounterServer): C8State {
  return JSON.parse(server.getStateJSON()) as C8State;
}
function traces(dir: string): PersistedTrace[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".conversation-trace.json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as PersistedTrace);
}

// Every station transition the connection's onState reported, in order.
function trackStations(connection: SyncConnection): string[] {
  const seen: string[] = [];
  connection.onState((snapshot) => {
    const id = (snapshot as unknown as Snapshot).stationId;
    if (typeof id === "string" && id !== "" && seen.at(-1) !== id) seen.push(id);
  });
  return seen;
}

async function boot(stations: string[] = STATIONS): Promise<{ server: EncounterServer; traceDir: string }> {
  const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c8-"));
  const server = await (createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>)({
    traceDir,
    timing: TIMING,
    stations,
  });
  servers.push(server);
  return { server, traceDir };
}

async function joinAs(server: EncounterServer, role?: "observer"): Promise<SyncConnection> {
  const roomOptions: Record<string, unknown> = { actors: ["a1", "a2"] };
  if (role) roomOptions["role"] = role;
  const connection = await connect(server.url, { roomOptions });
  leavers.push(() => connection.leave());
  return connection;
}

describe("xr-sync-server C8 observer follows rotation; rotation is lossless", () => {
  it("known-good: learner rotation alone still produces both station traces", async () => {
    const { server, traceDir } = await boot();
    const learner = await joinAs(server);
    const learnerStations = trackStations(learner);
    await waitFor(() => serverState(server).stationId === "station-2", SESSION_TIMEOUT_MS, "station-2");
    await waitFor(() => serverState(server).phase === "closed", SESSION_TIMEOUT_MS, "station-2 closed");
    expect(learnerStations).toEqual(["station-1", "station-2"]);
    await server.close();
    servers.pop();
    leavers.length = 0;
    expect(traces(traceDir).map((t) => t.stationId).sort()).toEqual(["station-1", "station-2"]);
  }, 40000);

  it("an observer rotates with the learner and is counted in the next station", async () => {
    const { server } = await boot();
    const learner = await joinAs(server);
    const observer = await joinAs(server, "observer");
    const observerStations = trackStations(observer);
    await waitFor(() => serverState(server).observerCount === 1, 3000, "observer counted in station-1");
    await waitFor(() => serverState(server).stationId === "station-2", SESSION_TIMEOUT_MS, "station-2");
    await waitFor(() => observerStations.at(-1) === "station-2", 3000, "observer sees station-2");
    await waitFor(() => serverState(server).observerCount === 1, 3000, "observer counted in station-2");
    expect(observerStations).toEqual(["station-1", "station-2"]);
    expect(learner.sessionId).not.toBe("");
  }, 40000);

  it("presence is recorded per station: left in station-1, joined in station-2", async () => {
    const { server, traceDir } = await boot();
    await joinAs(server);
    await joinAs(server, "observer");
    await waitFor(() => serverState(server).stationId === "station-2", SESSION_TIMEOUT_MS, "station-2");
    await waitFor(() => serverState(server).phase === "closed", SESSION_TIMEOUT_MS, "station-2 closed");
    await server.close();
    servers.pop();
    leavers.length = 0;
    const byStation = new Map(traces(traceDir).map((t) => [t.stationId, t.events.map((e) => e.kind)]));
    expect(byStation.get("station-1")).toContain("observer-left");
    expect(byStation.get("station-2")).toContain("observer-joined");
  }, 40000);

  it("every intent sent across each rotation settles as an ack", async () => {
    // Four stations = three rotations. One rotation with bursts lost intents in 4 of 5 runs on
    // the C7 client (root probe), so three rotations leave a broken client ~1% to pass.
    const four = ["station-1", "station-2", "station-3", "station-4"];
    const { server } = await boot(four);
    const learner = await joinAs(server);
    const stations = trackStations(learner);
    const results: Array<Promise<IntentResult>> = [];
    for (let index = 0; index < four.length - 1; index += 1) {
      const here = four[index] as string;
      const next = four[index + 1] as string;
      await waitFor(
        () => serverState(server).stationId === here && serverState(server).phase === "note",
        SESSION_TIMEOUT_MS * 2,
        `${here} note`,
      );
      let rotatedAt: number | null = null;
      while (rotatedAt === null || Date.now() - rotatedAt < 500) {
        for (let i = 0; i < POSE_BURST; i += 1) results.push(learner.sendIntent("pose", { x: 0, y: 1.6, z: 0 }));
        if (rotatedAt === null && stations.at(-1) === next) rotatedAt = Date.now();
        if (results.length > 400000) throw new Error(`rotation to ${next} never observed while streaming pose`);
        await new Promise((resolve) => setTimeout(resolve, POSE_INTERVAL_MS));
      }
    }
    const settled = await Promise.all(results);
    const notAcked = settled.filter((r) => r.status !== "ack");
    expect(notAcked.slice(0, 3)).toEqual([]);
    expect(stations).toEqual(four);
  }, 90000);
});
