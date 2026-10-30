import { Client } from "@colyseus/sdk";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { ENCOUNTER_ROOM_NAME, createEncounterServer, type EncounterServer } from "./index.js";

// C3 RED (planted by root, 2026-10-30): the server drives the actor's turn.
// Learner utterance-start/utterance-end are the only turn inputs. On
// utterance-end the room picks a scripted, replayable actor reply (no LLM),
// sets actor.speaking + state.turnId, and ends the turn on its own clock.
// A learner utterance-start during an actor turn interrupts it.
// Contract shape (field names are the spec; values below are not tuning):
//   state.turnId: number (0 before any actor turn, +1 per actor turn)
//   state.turnOwner: "none" | "learner" | "actor"
//   learners[id].speaking: boolean
//   actors[id].speaking: boolean, actors[id].replyId: string
//   getProbeStats().turns: Array<{ turnId, actorId, replyId, startSeq, end, endSeq }>
//     end: "open" | "completed" | "interrupted"; endSeq is the interrupting
//     utterance-start seq, or null when completed/open.

interface TurnRecord {
  turnId: number;
  actorId: string;
  replyId: string;
  startSeq: number;
  end: "open" | "completed" | "interrupted";
  endSeq: number | null;
}

interface C3State {
  turnId?: number;
  turnOwner?: string;
  actors: Record<string, { speaking?: boolean; replyId?: string }>;
  learners: Record<string, { speaking?: boolean }>;
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

function serverState(server: EncounterServer): C3State {
  return JSON.parse(server.getStateJSON()) as C3State;
}

function turns(server: EncounterServer): TurnRecord[] {
  return (server.getProbeStats() as unknown as { turns?: TurnRecord[] }).turns ?? [];
}

async function boot(): Promise<{ server: EncounterServer; connection: SyncConnection }> {
  const server = await createEncounterServer();
  servers.push(server);
  const connection = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
  leavers.push(() => connection.leave());
  return { server, connection };
}

/** Same intent script on any server; returns the turn log once the script settles. */
async function runScript(server: EncounterServer, connection: SyncConnection): Promise<TurnRecord[]> {
  await connection.sendIntent("select-actor", { actorId: "a1" });
  await connection.sendIntent("utterance-start", {});
  await connection.sendIntent("utterance-end", {});
  await waitFor(() => turns(server)[0]?.end === "completed", 15000, "turn 1 completes");
  await connection.sendIntent("utterance-start", {});
  await connection.sendIntent("utterance-end", {});
  await waitFor(() => serverState(server).actors["a1"]?.speaking === true, 5000, "turn 2 speaking");
  await connection.sendIntent("utterance-start", {});
  await connection.sendIntent("utterance-end", {});
  await waitFor(() => turns(server)[2]?.end === "completed", 15000, "turn 3 completes");
  return turns(server);
}

describe("xr-sync-server C3 server-driven actor turn", () => {
  it("orders turns: learner speaks, then the actor replies on the server clock", async () => {
    const { server, connection } = await boot();
    expect(serverState(server).turnId).toBe(0);
    expect(serverState(server).turnOwner).toBe("none");

    expect(await connection.sendIntent("select-actor", { actorId: "a1" })).toMatchObject({ status: "ack" });
    expect(await connection.sendIntent("utterance-start", {})).toMatchObject({ status: "ack" });
    let state = serverState(server);
    expect(state.learners[connection.sessionId]?.speaking).toBe(true);
    expect(state.actors["a1"]?.speaking).toBe(false);
    expect(state.turnOwner).toBe("learner");
    expect(state.turnId).toBe(0);

    const end = await connection.sendIntent("utterance-end", {});
    expect(end).toMatchObject({ status: "ack" });
    state = serverState(server);
    expect(state.learners[connection.sessionId]?.speaking).toBe(false);
    expect(state.actors["a1"]?.speaking).toBe(true);
    expect(state.turnOwner).toBe("actor");
    expect(state.turnId).toBe(1);
    expect(state.actors["a1"]?.replyId).toMatch(/\S/);
    expect(turns(server)).toEqual([
      { turnId: 1, actorId: "a1", replyId: state.actors["a1"]?.replyId, startSeq: end.seq, end: "open", endSeq: null },
    ]);

    await waitFor(() => serverState(server).actors["a1"]?.speaking === false, 15000, "actor turn ends on server clock");
    expect(serverState(server).turnOwner).toBe("none");
    expect(turns(server)[0]?.end).toBe("completed");
  });

  it("a learner utterance-start during an actor turn interrupts it", async () => {
    const { server, connection } = await boot();
    await connection.sendIntent("select-actor", { actorId: "a1" });
    await connection.sendIntent("utterance-start", {});
    await connection.sendIntent("utterance-end", {});
    expect(serverState(server).actors["a1"]?.speaking).toBe(true);

    const interrupt = await connection.sendIntent("utterance-start", {});
    expect(interrupt).toMatchObject({ status: "ack" });
    const state = serverState(server);
    expect(state.actors["a1"]?.speaking).toBe(false);
    expect(state.learners[connection.sessionId]?.speaking).toBe(true);
    expect(state.turnOwner).toBe("learner");
    expect(turns(server)[0]).toMatchObject({ turnId: 1, end: "interrupted", endSeq: interrupt.seq });

    // The interrupted turn's timer must not fire later and flip anything.
    // Wait past the longest allowed reply (4000 ms, brief ceiling) + 500 ms.
    await new Promise((resolve) => setTimeout(resolve, 4500));
    expect(serverState(server).turnOwner).toBe("learner");
    expect(turns(server)).toHaveLength(1);
  }, 20000);

  it("the actor reply sequence is replayable: same intents give the same turn log", async () => {
    const first = await boot();
    const logA = await runScript(first.server, first.connection);
    const second = await boot();
    const logB = await runScript(second.server, second.connection);
    const strip = (log: TurnRecord[]) => log.map(({ turnId, actorId, replyId, end }) => ({ turnId, actorId, replyId, end }));
    expect(strip(logA).map((t) => t.end)).toEqual(["completed", "interrupted", "completed"]);
    expect(strip(logB)).toEqual(strip(logA));
  }, 60000);

  it("counterweight: the page cannot author an actor turn", async () => {
    const { server, connection } = await boot();
    await connection.sendIntent("select-actor", { actorId: "a1" });

    // utterance-end with no open learner utterance starts nothing.
    const orphanEnd = await connection.sendIntent("utterance-end", {});
    expect(orphanEnd).toMatchObject({ status: "reject", reason: "no-open-utterance" });
    expect(serverState(server).turnId).toBe(0);

    // Client-supplied reply/turn fields are ignored.
    await connection.sendIntent("utterance-start", {});
    const forged = await connection.sendIntent("utterance-end", {
      replyId: "page-forged",
      turnId: 99,
      speaking: true,
      text: "page-forged",
    } as Record<string, unknown>);
    expect(forged).toMatchObject({ status: "ack" });
    const state = serverState(server);
    expect(state.turnId).toBe(1);
    expect(state.actors["a1"]?.replyId).not.toBe("page-forged");

    // A raw room message outside the intent channel changes nothing.
    const raw = new Client(server.url);
    const room = await raw.joinOrCreate(ENCOUNTER_ROOM_NAME, { actors: ["a1", "a2"] });
    leavers.push(() => room.leave());
    room.send("turn", { actorId: "a2", speaking: true, replyId: "page-forged", turnId: 50 });
    room.send("state", { turnId: 50, turnOwner: "actor" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = serverState(server);
    expect(after.turnId).toBe(1);
    expect(after.actors["a2"]?.speaking).toBe(false);
    expect(turns(server).map((t) => t.replyId)).not.toContain("page-forged");
  });
});
