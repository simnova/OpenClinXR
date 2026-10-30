import { connect, type EncounterSnapshot, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";

// C5 RED (planted by root, 2026-10-30): a faculty observer joins the same
// encounter read-only and sees the learner's conversation live.
// Contract shape (names are the spec):
//   join with roomOptions.role: "learner" (default when absent) | "observer"; any other role -> join refused
//   observers get NO learners[] entry; state.observerCount: number counts connected observers
//   every observer intent -> reject "observer-read-only"; no state change, not counted in getProbeStats().intentCounts
//   conversation trace events gain kinds "observer-joined" / "observer-left" (seq null, actorId "", turnId null);
//     they carry no session id and do not change turns or emotions.

interface C5State {
  serverTick: number;
  turnId: number;
  observerCount?: number;
  actors: Record<string, { speaking: boolean; cueId?: string; emotion: string }>;
  learners: Record<string, unknown>;
}
interface TraceShape {
  events: Array<{ seq: number | null; kind: string; actorId: string; turnId: number | null }>;
  turns: unknown[];
  emotions: unknown[];
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

function state(server: EncounterServer): C5State {
  return JSON.parse(server.getStateJSON()) as C5State;
}
function trace(server: EncounterServer): TraceShape {
  return (server as unknown as { getConversationTrace(): TraceShape }).getConversationTrace();
}

async function join(server: EncounterServer, role?: string): Promise<SyncConnection> {
  const roomOptions: Record<string, unknown> = { actors: ["a1", "a2"] };
  if (role !== undefined) roomOptions["role"] = role;
  const connection = await connect(server.url, { roomOptions });
  leavers.push(() => connection.leave());
  return connection;
}

async function boot(): Promise<EncounterServer> {
  const server = await createEncounterServer();
  servers.push(server);
  return server;
}

describe("xr-sync-server C5 faculty observer", () => {
  it("an observer joins without a learner seat and is counted", async () => {
    const server = await boot();
    const learner = await join(server);
    expect(state(server).observerCount).toBe(0);
    const observer = await join(server, "observer");
    await waitFor(() => state(server).observerCount === 1, 5000, "observer counted");
    const learners = Object.keys(state(server).learners);
    expect(learners).toEqual([learner.sessionId]);
    expect(learners).not.toContain(observer.sessionId);
  }, 20000);

  it("every observer intent is rejected read-only and changes nothing", async () => {
    const server = await boot();
    const learner = await join(server);
    await learner.sendIntent("select-actor", { actorId: "a1" });
    const observer = await join(server, "observer");
    const before = state(server);
    const countsBefore = server.getProbeStats().intentCounts;
    for (const [kind, payload] of [
      ["pose", { x: 1, y: 1, z: 1 }],
      ["select-actor", { actorId: "a2" }],
      ["utterance-start", { actorId: "a1" }],
      ["utterance-end", { actorId: "a1" }],
    ] as const) {
      const result = await observer.sendIntent(kind, payload);
      expect(result).toMatchObject({ status: "reject", reason: "observer-read-only" });
    }
    const after = state(server);
    expect(after.serverTick).toBe(before.serverTick);
    expect(after.turnId).toBe(before.turnId);
    expect(after.actors).toEqual(before.actors);
    expect(server.getProbeStats().intentCounts).toEqual(countsBefore);
  }, 20000);

  it("the observer sees the learner's actor turn through schema sync", async () => {
    const server = await boot();
    const learner = await join(server);
    const observer = await join(server, "observer");
    let seen: EncounterSnapshot | undefined;
    observer.onState((snapshot) => {
      seen = snapshot;
    });
    await learner.sendIntent("select-actor", { actorId: "a1" });
    await learner.sendIntent("utterance-start", {});
    await learner.sendIntent("utterance-end", {});
    const serverA1 = state(server).actors["a1"];
    await waitFor(
      () => (seen as unknown as C5State | undefined)?.turnId === 1 && seen?.actors["a1"]?.speaking === true,
      5000,
      "observer sees turn 1",
    );
    const observedA1 = (seen as unknown as C5State).actors["a1"];
    expect(observedA1?.cueId).toBe(serverA1?.cueId);
    expect(observedA1?.emotion).toBe(serverA1?.emotion);
  }, 20000);

  it("the trace records observer presence without identity and replay is unaffected", async () => {
    const server = await boot();
    const learner = await join(server);
    const observer = await join(server, "observer");
    await learner.sendIntent("select-actor", { actorId: "a1" });
    await learner.sendIntent("utterance-start", {});
    await learner.sendIntent("utterance-end", {});
    await observer.leave();
    await waitFor(() => state(server).observerCount === 0, 5000, "observer gone");
    const t = trace(server);
    const presence = t.events.filter((e) => e.kind.startsWith("observer-"));
    expect(presence).toEqual([
      { seq: null, kind: "observer-joined", actorId: "", turnId: null },
      { seq: null, kind: "observer-left", actorId: "", turnId: null },
    ]);
    const raw = JSON.stringify(t);
    expect(raw).not.toContain(observer.sessionId);
    expect(raw).not.toContain(learner.sessionId);
    expect(t.turns).toHaveLength(1);
    expect(t.emotions).toHaveLength(1);
  }, 20000);

  it("counterweight: a client cannot claim an unknown role or promote itself", async () => {
    const server = await boot();
    await expect(join(server, "faculty-admin")).rejects.toThrow();
    const observer = await join(server, "observer");
    const promote = await observer.sendIntent("select-actor", { actorId: "a1", role: "learner" } as Record<string, unknown>);
    expect(promote).toMatchObject({ status: "reject", reason: "observer-read-only" });
    expect(Object.keys(state(server).learners)).toEqual([]);
  }, 20000);
});
