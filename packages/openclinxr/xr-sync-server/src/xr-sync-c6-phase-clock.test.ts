import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C6 RED (planted by root, 2026-10-30): the server runs the Step 2 CS station
// phase clock. Timing shape is shared-schemas ExamBlueprintTimingSchema's
// {doorwaySeconds, encounterSeconds, noteSeconds}; it is SERVER config
// (createEncounterServer({ timing })), never client roomOptions.
// Contract (names are the spec):
//   no timing -> C1..C5 behaviour: phase "brief", no phase gating, no phase events
//   with timing: phase "doorway" at room create -> "encounter" -> "note" -> "closed" on the room clock
//   state.phaseRemainingS: integer seconds left in the current phase (0 when closed)
//   select-actor / utterance-start / utterance-end outside "encounter" -> reject "outside-encounter-phase"
//     (pose is accepted in every phase)
//   an actor turn still open when encounter ends -> turn end "closed-by-phase", actor speaking false
//   trace events gain kind "phase-changed" {seq: null, kind, actorId: "", turnId: null, phase}
//   getProbeStats().phaseChangedAtMs: Record<phase, number> (server Date.now, probe only, never in the trace)
// Illustrative test timing below (1/2/1 s) is chosen to keep the suite short; it is not a product value.

const TIMING = { doorwaySeconds: 1, encounterSeconds: 2, noteSeconds: 1 };
// Tolerance: 4 x the 50 ms schema patch interval (C1 default patchRate).
const TOLERANCE_MS = 200;

interface C6State {
  phase: string;
  phaseRemainingS?: number;
  turnId: number;
  actors: Record<string, { speaking: boolean }>;
}
interface TraceShape {
  events: Array<{ seq: number | null; kind: string; actorId: string; turnId: number | null; phase?: string }>;
  turns: Array<{ turnId: number; end: string }>;
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

function state(server: EncounterServer): C6State {
  return JSON.parse(server.getStateJSON()) as C6State;
}
function trace(server: EncounterServer): TraceShape {
  return (server as unknown as { getConversationTrace(): TraceShape }).getConversationTrace();
}
function phaseTimes(server: EncounterServer): Record<string, number> {
  return (server.getProbeStats() as unknown as { phaseChangedAtMs?: Record<string, number> }).phaseChangedAtMs ?? {};
}

async function boot(timing?: Record<string, number>, roomOptions: Record<string, unknown> = {}): Promise<{
  server: EncounterServer;
  connection: SyncConnection;
}> {
  const server = await (createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>)(
    timing ? { timing } : {},
  );
  servers.push(server);
  const connection = await connect(server.url, { roomOptions: { actors: ["a1", "a2"], ...roomOptions } });
  leavers.push(() => connection.leave());
  return { server, connection };
}

describe("xr-sync-server C6 station phase clock", () => {
  it("known-good: without timing the room keeps C1..C5 behaviour", async () => {
    const { server, connection } = await boot();
    expect(state(server).phase).toBe("brief");
    expect(await connection.sendIntent("select-actor", { actorId: "a1" })).toMatchObject({ status: "ack" });
    expect(trace(server).events.some((e) => e.kind === "phase-changed")).toBe(false);
  }, 20000);

  it("runs doorway -> encounter -> note -> closed on the server clock", async () => {
    const { server } = await boot(TIMING);
    expect(state(server).phase).toBe("doorway");
    expect(state(server).phaseRemainingS).toBe(TIMING.doorwaySeconds);
    await waitFor(() => state(server).phase === "closed", 10000, "closed");
    expect(state(server).phaseRemainingS).toBe(0);
    const phases = trace(server)
      .events.filter((e) => e.kind === "phase-changed")
      .map((e) => e.phase);
    expect(phases).toEqual(["doorway", "encounter", "note", "closed"]);
    const at = phaseTimes(server);
    const spans = [
      (at["encounter"] ?? Number.NaN) - (at["doorway"] ?? Number.NaN),
      (at["note"] ?? Number.NaN) - (at["encounter"] ?? Number.NaN),
      (at["closed"] ?? Number.NaN) - (at["note"] ?? Number.NaN),
    ];
    const want = [TIMING.doorwaySeconds, TIMING.encounterSeconds, TIMING.noteSeconds].map((s) => s * 1000);
    spans.forEach((span, i) => {
      expect(Math.abs(span - (want[i] as number))).toBeLessThanOrEqual(TOLERANCE_MS);
    });
  }, 20000);

  it("conversation intents are accepted only during encounter; pose always", async () => {
    const { server, connection } = await boot(TIMING);
    expect(await connection.sendIntent("pose", { x: 0, y: 1.6, z: 0 })).toMatchObject({ status: "ack" });
    expect(await connection.sendIntent("select-actor", { actorId: "a1" })).toMatchObject({
      status: "reject",
      reason: "outside-encounter-phase",
    });
    await waitFor(() => state(server).phase === "encounter", 5000, "encounter");
    expect(await connection.sendIntent("select-actor", { actorId: "a1" })).toMatchObject({ status: "ack" });
    expect(await connection.sendIntent("utterance-start", {})).toMatchObject({ status: "ack" });
    await waitFor(() => state(server).phase === "note", 5000, "note");
    expect(await connection.sendIntent("utterance-end", {})).toMatchObject({
      status: "reject",
      reason: "outside-encounter-phase",
    });
    expect(await connection.sendIntent("pose", { x: 0, y: 1.6, z: 0 })).toMatchObject({ status: "ack" });
    expect(state(server).turnId).toBe(0);
  }, 20000);

  it("an actor turn open when encounter ends closes by phase", async () => {
    // encounter 1 s < first reply 2 s (C3 table), so the turn is open at the boundary.
    const { server, connection } = await boot({ doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 1 });
    await waitFor(() => state(server).phase === "encounter", 5000, "encounter");
    await connection.sendIntent("select-actor", { actorId: "a1" });
    await connection.sendIntent("utterance-start", {});
    await connection.sendIntent("utterance-end", {});
    expect(state(server).actors["a1"]?.speaking).toBe(true);
    await waitFor(() => state(server).phase === "note", 5000, "note");
    expect(state(server).actors["a1"]?.speaking).toBe(false);
    expect(trace(server).turns.at(-1)?.end).toBe("closed-by-phase");
    // The closed turn's own timer must not reopen or complete it later.
    await new Promise((resolve) => setTimeout(resolve, 3500));
    expect(trace(server).turns.at(-1)?.end).toBe("closed-by-phase");
  }, 20000);

  it("counterweight: a client cannot set or stretch the phase clock", async () => {
    const { server } = await boot(TIMING, {
      timing: { doorwaySeconds: 0, encounterSeconds: 9999, noteSeconds: 0 },
      phase: "encounter",
    });
    expect(state(server).phase).toBe("doorway");
    await waitFor(() => state(server).phase === "note", 6000, "note on server timing");
    const at = phaseTimes(server);
    expect(Math.abs((at["note"] ?? 0) - (at["encounter"] ?? 0) - TIMING.encounterSeconds * 1000)).toBeLessThanOrEqual(
      TOLERANCE_MS,
    );
  }, 20000);
});
