import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C9 RED (planted by root, 2026-10-30): a multi-station exam session produces one faculty
// review index that links its per-station traces.
// Contract (names are the spec):
//   with stations + traceDir configured, when the LAST station reaches "closed" the server writes
//     <traceDir>/exam-session.review-index.json (one per server session, write-once)
//   schema "openclinxr.xr-sync.exam-session-review-index.v1":
//     { schema, complete: true, stationCount,
//       stations: [{ stationId, stationIndex, traceFile, phases, turnCount, turnEnds, observerPresent }] }
//   traceFile is the basename of that station's <roomId>.conversation-trace.json in traceDir;
//   phases / turnCount / turnEnds are copied from that trace (index and trace must agree);
//   observerPresent is true when the station trace has an observer-joined event
//   review-safe: no session id, no nonce, no reply text, no timestamps in the index
//   no stations -> no index file (C6 behaviour); a session whose rotation failed writes the index
//     with complete false and only the stations that ran
// Illustrative test timing (1/1/1 s) keeps the suite short; it is not a product value.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 1 };
const STATIONS = ["station-1", "station-2"];
// Two 3 s stations plus rotation; 15 s bounds it on a loaded host (C7 RED provenance).
const SESSION_TIMEOUT_MS = 15000;
const INDEX_FILE = "exam-session.review-index.json";

interface StationEntry {
  stationId: string;
  stationIndex: number;
  traceFile: string;
  phases: string[];
  turnCount: number;
  turnEnds: string[];
  observerPresent: boolean;
}
interface ReviewIndex {
  schema: string;
  complete: boolean;
  stationCount: number;
  stations: StationEntry[];
}
interface PersistedTrace {
  stationId?: string;
  events: Array<{ kind: string; phase?: string }>;
  turns: Array<{ end: string }>;
}

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

function hasFile(dir: string, name: string): boolean {
  return readdirSync(dir).includes(name);
}

async function boot(serverOptions: Record<string, unknown>): Promise<{ server: EncounterServer; traceDir: string }> {
  const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c9-"));
  const server = await (createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>)({
    traceDir,
    timing: TIMING,
    ...serverOptions,
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

describe("xr-sync-server C9 exam session review index", () => {
  it("known-good: without stations no review index is written", async () => {
    const { server, traceDir } = await boot({});
    await joinAs(server);
    await waitFor(() => (JSON.parse(server.getStateJSON()) as { phase: string }).phase === "closed", 10000, "closed");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(hasFile(traceDir, INDEX_FILE)).toBe(false);
  }, 30000);

  it("writes one complete index when the last station closes, before the server closes", async () => {
    const { traceDir } = await boot({ stations: STATIONS });
    // The server is not closed here: the index is written on the last station's "closed".
    const learner = await joinAs((servers.at(-1) as EncounterServer));
    expect(learner.sessionId).not.toBe("");
    await waitFor(() => hasFile(traceDir, INDEX_FILE), SESSION_TIMEOUT_MS * 2, "review index");
    const index = JSON.parse(readFileSync(join(traceDir, INDEX_FILE), "utf8")) as ReviewIndex;
    expect(index.schema).toBe("openclinxr.xr-sync.exam-session-review-index.v1");
    expect(index.complete).toBe(true);
    expect(index.stationCount).toBe(2);
    expect(index.stations.map((s) => [s.stationId, s.stationIndex])).toEqual([
      ["station-1", 0],
      ["station-2", 1],
    ]);
  }, 40000);

  it("each entry links its station trace and agrees with it", async () => {
    const { server, traceDir } = await boot({ stations: STATIONS });
    const learner = await joinAs(server);
    await waitFor(() => (JSON.parse(server.getStateJSON()) as { phase: string }).phase === "encounter", 5000, "s1 encounter");
    await learner.sendIntent("select-actor", { actorId: "a1" });
    await learner.sendIntent("utterance-start", {});
    await learner.sendIntent("utterance-end", {});
    await waitFor(() => hasFile(traceDir, INDEX_FILE), SESSION_TIMEOUT_MS * 2, "review index");
    await server.close();
    servers.pop();
    leavers.length = 0;
    const index = JSON.parse(readFileSync(join(traceDir, INDEX_FILE), "utf8")) as ReviewIndex;
    for (const entry of index.stations) {
      expect(entry.traceFile).toMatch(/\.conversation-trace\.json$/);
      const trace = JSON.parse(readFileSync(join(traceDir, entry.traceFile), "utf8")) as PersistedTrace;
      expect(trace.stationId).toBe(entry.stationId);
      expect(entry.phases).toEqual(trace.events.filter((e) => e.kind === "phase-changed").map((e) => e.phase));
      expect(entry.turnCount).toBe(trace.turns.length);
      expect(entry.turnEnds).toEqual(trace.turns.map((t) => t.end));
    }
    const s1 = index.stations.find((s) => s.stationId === "station-1");
    expect(s1?.turnEnds).toEqual(["closed-by-phase"]);
  }, 40000);

  it("records observer presence per station and carries no identity", async () => {
    const { server, traceDir } = await boot({ stations: STATIONS });
    const learner = await joinAs(server);
    const observer = await joinAs(server, "observer");
    await waitFor(() => hasFile(traceDir, INDEX_FILE), SESSION_TIMEOUT_MS * 2, "review index");
    const raw = readFileSync(join(traceDir, INDEX_FILE), "utf8");
    const index = JSON.parse(raw) as ReviewIndex;
    expect(index.stations.map((s) => s.observerPresent)).toEqual([true, true]);
    expect(raw).not.toContain(learner.sessionId);
    expect(raw).not.toContain(observer.sessionId);
    expect(raw).not.toMatch(/__c7|nonce|"atMs"|"timestamp"/i);
  }, 40000);

  it("a session whose rotation fails writes an incomplete index of the stations that ran", async () => {
    // rotationFaults is the C8 server-config fault seam (failNextReservations: every reservation fails).
    const { traceDir } = await boot({ stations: STATIONS, rotationFaults: { failNextReservations: 99 } });
    await joinAs(servers.at(-1) as EncounterServer);
    await waitFor(() => hasFile(traceDir, INDEX_FILE), SESSION_TIMEOUT_MS * 2, "review index");
    const index = JSON.parse(readFileSync(join(traceDir, INDEX_FILE), "utf8")) as ReviewIndex;
    expect(index.complete).toBe(false);
    expect(index.stations.map((s) => s.stationId)).toEqual(["station-1"]);
  }, 40000);
});
