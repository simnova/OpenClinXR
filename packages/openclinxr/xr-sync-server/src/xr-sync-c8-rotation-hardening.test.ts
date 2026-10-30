import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C8 hardening via the PUBLIC entrypoint only (2026-10-30 round 03): D2/D4.
//   D2: a faulted reservation retries once, then the client gets
//     "rotation-failed" {stationId}; the trace records kind "rotation-failed"
//     (no identity); the client surfaces it via onRotationFailed /
//     rotationFailed. A single fault still rotates with no failure signal.
//   D4: unused nonces never leak: failure and success paths both settle at
//     stationNonces {creation: 0, join: 0} (probe-visible via getProbeStats).
//   Client consume-fail (bogus rotate payload) surfaces through the same
//     typed rotation-failed channel.
// NOTE (round 03): the D3 "not-joined" live test was dropped: reaching it
// needs a connected session with no learner/observer entry, which the public
// entrypoint cannot produce deterministically (every joined session is a
// learner or observer; the branch is a defensive race guard). The behaviour
// is kept (observer.rejectNotJoined + room.ts gate); see RESULT NOT_TESTED.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 1 };
const STATIONS = ["station-1", "station-2"];
const SESSION_TIMEOUT_MS = 15000;

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
    if (condition()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function serverState(server: EncounterServer): { stationId?: string; phase?: string } {
  return JSON.parse(server.getStateJSON()) as { stationId?: string; phase?: string };
}

function trackStations(connection: SyncConnection): string[] {
  const seen: string[] = [];
  connection.onState((snapshot) => {
    const id = (snapshot as unknown as { stationId?: unknown }).stationId;
    if (typeof id === "string" && id !== "" && seen.at(-1) !== id) {
      seen.push(id);
    }
  });
  return seen;
}

function traceFiles(dir: string): Array<{ stationId: string | undefined; raw: string; events: Array<{ kind: string }> }> {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".conversation-trace.json"))
    .map((f) => {
      const raw = readFileSync(join(dir, f), "utf8");
      const parsed = JSON.parse(raw) as { stationId?: string; events: Array<{ kind: string }> };
      return { stationId: parsed.stationId, raw, events: parsed.events };
    });
}

describe("xr-sync-server C8 rotation hardening D2/D4 (public entrypoint)", () => {
  it("D2: one faulted reservation still rotates with no failure signal", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c8-d2r-"));
    const server = await createEncounterServer({
      traceDir,
      timing: { ...TIMING },
      stations: [...STATIONS],
      rotationFaults: { failNextReservations: 1 },
    });
    servers.push(server);
    const learner = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
    leavers.push(() => learner.leave());
    const stations = trackStations(learner);
    let failed: Array<{ stationId: string }> = [];
    const unsub = learner.onRotationFailed((info) => {
      failed = [...failed, info];
    });
    try {
      await waitFor(() => serverState(server).stationId === "station-2", SESSION_TIMEOUT_MS, "station-2");
      await waitFor(() => stations.at(-1) === "station-2", 5000, "learner sees station-2");
      expect(learner.rotationFailed).toBeNull();
      expect(failed).toEqual([]);
    } finally {
      unsub();
    }
    await waitFor(() => serverState(server).phase === "closed", SESSION_TIMEOUT_MS, "station-2 closed");
    await server.close();
    servers.pop();
    leavers.length = 0;
    const byStation = new Map(traceFiles(traceDir).map((t) => [t.stationId, t]));
    expect(byStation.get("station-1")?.events.some((e) => e.kind === "rotation-failed")).toBe(false);
  }, 40000);

  it("D2: repeated faults send rotation-failed and trace it without identity", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c8-d2f-"));
    const server = await createEncounterServer({
      traceDir,
      timing: { ...TIMING },
      stations: [...STATIONS],
      rotationFaults: { failNextReservations: 10 },
    });
    servers.push(server);
    const learner = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
    leavers.push(() => learner.leave());
    const stations = trackStations(learner);
    const seen: Array<{ stationId: string }> = [];
    learner.onRotationFailed((info) => {
      seen.push(info);
    });
    await waitFor(() => learner.rotationFailed !== null, SESSION_TIMEOUT_MS, "rotation-failed surfaced");
    expect(learner.rotationFailed).toMatchObject({ stationId: "station-2" });
    expect(seen).toEqual([{ stationId: "station-2" }]);
    expect(stations).toEqual(["station-1"]);
    await waitFor(
      () => {
        const nonces = server.getProbeStats().stationNonces;
        return nonces !== undefined && nonces.creation === 0 && nonces.join === 0;
      },
      5000,
      "D4 failure-path nonces settled",
    );
    await learner.leave();
    leavers.pop();
    await waitFor(
      () => traceFiles(traceDir).some((t) => t.stationId === "station-1"),
      10000,
      "station-1 trace persisted",
    );
    const sessionId = learner.sessionId;
    await server.close();
    servers.pop();
    const byStation = new Map(traceFiles(traceDir).map((t) => [t.stationId, t]));
    const station1 = byStation.get("station-1");
    expect(station1?.events.map((e) => e.kind)).toContain("rotation-failed");
    expect(station1?.raw.includes(sessionId)).toBe(false);
    const station2 = byStation.get("station-2");
    if (station2) {
      expect(station2.events.map((e) => e.kind)).not.toContain("rotation-failed");
    }
  }, 60000);

  it("D4: success-path rotation leaves no unused nonces", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c8-d4-"));
    const server = await createEncounterServer({ traceDir, timing: { ...TIMING }, stations: [...STATIONS] });
    servers.push(server);
    const learner = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
    leavers.push(() => learner.leave());
    const observer = await connect(server.url, { roomOptions: { actors: ["a1", "a2"], role: "observer" } });
    leavers.push(() => observer.leave());
    const learnerStations = trackStations(learner);
    const observerStations = trackStations(observer);
    await waitFor(() => serverState(server).stationId === "station-2", SESSION_TIMEOUT_MS, "station-2");
    await waitFor(() => learnerStations.at(-1) === "station-2", 5000, "learner sees station-2");
    await waitFor(() => observerStations.at(-1) === "station-2", 5000, "observer sees station-2");
    await waitFor(
      () => {
        const nonces = server.getProbeStats().stationNonces;
        return nonces !== undefined && nonces.creation === 0 && nonces.join === 0;
      },
      5000,
      "D4 success-path nonces settled",
    );
  }, 40000);

  it("client consume-fail surfaces through the typed rotation-failed channel", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c8-bogus-"));
    const server = await createEncounterServer({
      traceDir,
      timing: { ...TIMING },
      stations: [...STATIONS],
      rotationFaults: { sendBogusRotate: true },
    });
    servers.push(server);
    const learner = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
    leavers.push(() => learner.leave());
    const stations = trackStations(learner);
    const seen: Array<{ stationId: string }> = [];
    learner.onRotationFailed((info) => {
      seen.push(info);
    });
    await waitFor(() => learner.rotationFailed !== null, SESSION_TIMEOUT_MS, "consume-fail surfaced");
    expect(typeof learner.rotationFailed?.stationId).toBe("string");
    expect(seen.length).toBeGreaterThan(0);
    expect(stations).toEqual(["station-1"]);
  }, 40000);
});
