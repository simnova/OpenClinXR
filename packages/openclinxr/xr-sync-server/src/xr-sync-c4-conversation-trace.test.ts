import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";
import { C3_REPLY_TABLE } from "./room.js";
import { CONVERSATION_TRACE_SCHEMA, replayConversationTrace } from "./conversation-trace.js";

// C4 RED (planted by root, 2026-10-30): each actor turn carries renderable
// conversation content (cueId for audio/viseme playback, an emotion
// transition resolved by @openclinxr/conversation-policy EmotionEngine), and
// the room persists a review-safe conversation trace that replays to itself.
// Contract shape (field names are the spec):
//   actors[id].cueId: string (scripted reply's cue, "" before any turn)
//   actors[id].emotion: string (existing field, now driven by the engine)
//   createEncounterServer({ traceDir }) writes <traceDir>/<roomId>.conversation-trace.json on room dispose
//   server.getConversationTrace(): ConversationTrace (live copy)
//   ConversationTrace = { schema, events, turns, emotions }
//     events: Array<{ seq: number | null, kind: "select-actor" | "utterance-start" | "utterance-end" | "turn-completed", actorId: string, turnId: number | null }>
//       ("turn-completed" is server-generated: seq null)
//     turns: Array<{ turnId, actorId, replyId, cueId, startSeq, end, endSeq }>
//     emotions: Array<{ from, to, trigger, changed, turnIndex }> (EmotionTransition shape, conversation-policy)
//   replayConversationTrace(trace) recomputes turns + emotions from trace.events alone, no clock.
// Probe emotion policy (brief-specified): baseline neutral; neutral+learner_acknowledgement->reassured;
// reassured+learner_interruption->concerned; concerned+learner_acknowledgement->neutral.
// utterance-end emits learner_acknowledgement; an interrupting utterance-start emits learner_interruption.

interface TraceTurn {
  turnId: number;
  actorId: string;
  replyId: string;
  cueId: string;
  startSeq: number;
  end: string;
  endSeq: number | null;
}
interface TraceEmotion {
  from: string;
  to: string;
  trigger: string;
  changed: boolean;
  turnIndex: number | undefined;
}
interface TraceEvent {
  seq: number | null;
  kind: string;
  actorId: string;
  turnId: number | null;
}
interface ConversationTraceShape {
  schema: string;
  events: TraceEvent[];
  turns: TraceTurn[];
  emotions: TraceEmotion[];
}

interface C4State {
  actors: Record<string, { speaking?: boolean; cueId?: string; emotion?: string; replyId?: string }>;
}

const servers: EncounterServer[] = [];
const leavers: Array<() => Promise<unknown>> = [];
const dirs: string[] = [];

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
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
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

function state(server: EncounterServer): C4State {
  return JSON.parse(server.getStateJSON()) as C4State;
}

function trace(server: EncounterServer): ConversationTraceShape {
  return (server as unknown as { getConversationTrace(): ConversationTraceShape }).getConversationTrace();
}

async function boot(traceDir?: string): Promise<{ server: EncounterServer; connection: SyncConnection }> {
  const server = await (createEncounterServer as (o: Record<string, unknown>) => Promise<EncounterServer>)(
    traceDir ? { traceDir } : {},
  );
  servers.push(server);
  const connection = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
  leavers.push(() => connection.leave());
  return { server, connection };
}

/** C3 script: complete, interrupt, complete. */
async function runScript(server: EncounterServer, connection: SyncConnection): Promise<void> {
  await connection.sendIntent("select-actor", { actorId: "a1" });
  await connection.sendIntent("utterance-start", {});
  await connection.sendIntent("utterance-end", {});
  await waitFor(() => trace(server).turns[0]?.end === "completed", 15000, "turn 1 completes");
  await connection.sendIntent("utterance-start", {});
  await connection.sendIntent("utterance-end", {});
  await connection.sendIntent("utterance-start", {});
  await connection.sendIntent("utterance-end", {});
  await waitFor(() => trace(server).turns[2]?.end === "completed", 15000, "turn 3 completes");
}

describe("xr-sync-server C4 turn content and conversation trace", () => {
  it("each actor turn syncs its scripted cueId; emotion follows the conversation-policy engine", async () => {
    const { server, connection } = await boot();
    expect(state(server).actors["a1"]?.cueId).toBe("");
    expect(state(server).actors["a1"]?.emotion).toBe("neutral");

    await connection.sendIntent("select-actor", { actorId: "a1" });
    await connection.sendIntent("utterance-start", {});
    await connection.sendIntent("utterance-end", {});
    const open = state(server).actors["a1"];
    const t1 = trace(server).turns[0];
    expect(open?.speaking).toBe(true);
    expect(open?.cueId).toMatch(/\S/);
    expect(open?.cueId).toBe(t1?.cueId);
    expect(open?.emotion).toBe("reassured");

    await waitFor(() => trace(server).turns[0]?.end === "completed", 15000, "turn 1 completes");
    await connection.sendIntent("utterance-start", {});
    await connection.sendIntent("utterance-end", {});
    await connection.sendIntent("utterance-start", {});
    await connection.sendIntent("utterance-end", {});
    await waitFor(() => trace(server).turns[2]?.end === "completed", 15000, "turn 3 completes");

    const t = trace(server);
    expect(new Set(t.turns.map((turn) => turn.cueId)).size).toBe(3);
    expect(t.emotions.map(({ from, to, trigger, changed }) => ({ from, to, trigger, changed }))).toEqual([
      { from: "neutral", to: "reassured", trigger: "learner_acknowledgement", changed: true },
      { from: "reassured", to: "reassured", trigger: "learner_acknowledgement", changed: false },
      { from: "reassured", to: "concerned", trigger: "learner_interruption", changed: true },
      { from: "concerned", to: "neutral", trigger: "learner_acknowledgement", changed: true },
    ]);
    expect(state(server).actors["a1"]?.emotion).toBe("neutral");
  }, 40000);

  it("the room persists a review-safe trace file on dispose", async () => {
    const dir = await mkdtemp(join(tmpdir(), "c4-trace-"));
    dirs.push(dir);
    const { server, connection } = await boot(dir);
    const sessionId = connection.sessionId;
    await runScript(server, connection);
    const live = trace(server);
    await connection.leave();
    await server.close();
    servers.splice(servers.indexOf(server), 1);

    const files = (await readdir(dir)).filter((f) => f.endsWith(".conversation-trace.json"));
    expect(files).toHaveLength(1);
    const raw = await readFile(join(dir, files[0] as string), "utf8");
    const persisted = JSON.parse(raw) as ConversationTraceShape;
    expect(persisted.schema).toBe(CONVERSATION_TRACE_SCHEMA);
    expect(persisted.turns).toEqual(live.turns);
    expect(persisted.emotions).toEqual(live.emotions);
    expect(persisted.events.map((e) => e.kind)).toEqual([
      "select-actor",
      "utterance-start",
      "utterance-end",
      "turn-completed",
      "utterance-start",
      "utterance-end",
      "utterance-start",
      "utterance-end",
      "turn-completed",
    ]);
    const seqs = persisted.events.map((e) => e.seq).filter((s): s is number => s !== null);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

    // Review-safe: no learner session id, no reply text (text stays in the server table).
    expect(raw).not.toContain(sessionId);
    for (const reply of C3_REPLY_TABLE) {
      expect(raw).not.toContain(reply.text);
    }
  }, 40000);

  it("replay recomputes turns and emotions from events alone", async () => {
    const { server, connection } = await boot();
    await runScript(server, connection);
    const live = trace(server);
    const replayed = replayConversationTrace(live) as ConversationTraceShape;
    expect(replayed.turns).toEqual(live.turns);
    expect(replayed.emotions).toEqual(live.emotions);

    // Counterweight against a replay that copies its input: tampered derived
    // fields must be recomputed from events, not echoed back.
    const tampered: ConversationTraceShape = JSON.parse(JSON.stringify(live));
    (tampered.turns[0] as TraceTurn).replyId = "tampered";
    (tampered.emotions[0] as TraceEmotion).to = "anxious";
    const fromTampered = replayConversationTrace(tampered) as ConversationTraceShape;
    expect(fromTampered.turns).toEqual(live.turns);
    expect(fromTampered.emotions).toEqual(live.emotions);
  }, 40000);

  it("counterweight: the page cannot author cue or emotion", async () => {
    const { server, connection } = await boot();
    await connection.sendIntent("select-actor", { actorId: "a1" });
    await connection.sendIntent("utterance-start", { emotion: "anxious", cueId: "page-forged" } as Record<string, unknown>);
    await connection.sendIntent("utterance-end", { emotion: "anxious", cueId: "page-forged", trigger: "learner_dismissive" } as Record<string, unknown>);
    const a1 = state(server).actors["a1"];
    expect(a1?.cueId).not.toBe("page-forged");
    expect(a1?.emotion).toBe("reassured");
    expect(JSON.stringify(trace(server))).not.toContain("page-forged");
    expect(JSON.stringify(trace(server))).not.toContain("learner_dismissive");
  });
});
