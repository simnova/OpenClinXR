import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@colyseus/sdk";
import {
  connect,
  type AckResult,
  type EncounterSnapshot,
  type IntentKind as ClientIntentKind,
  type IntentPayload,
  type IntentResult,
  type RejectResult,
  type SnapshotActor,
  type SnapshotLearner,
  type SyncConnection,
} from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import {
  ENCOUNTER_ROOM_NAME,
  createEncounterServer,
  type AckMessage,
  type EncounterServer,
  type EncounterServerOptions,
  type IntentKind as ServerIntentKind,
  type IntentMessage,
  type RejectMessage,
} from "./index.js";

// C1 HOST-ONLY tests: server in-process on port 0, real @openclinxr/xr-sync-client
// over real websockets. No headset, no browser, no IWSDK.

const servers: EncounterServer[] = [];
const leavers: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  while (leavers.length > 0) {
    const leave = leavers.pop();
    try {
      await leave?.();
    } catch {
      // Best-effort teardown; the assertion already ran.
    }
  }
  while (servers.length > 0) {
    const server = servers.pop();
    try {
      await server?.close();
    } catch {
      // Best-effort teardown.
    }
  }
});

async function startServer(options: EncounterServerOptions = { port: 0 }): Promise<EncounterServer> {
  const server = await createEncounterServer(options);
  servers.push(server);
  return server;
}

function trackConnection(connection: { leave: () => Promise<unknown> }): void {
  leavers.push(() => connection.leave());
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("unserializable value in state snapshot");
  }
  return serialized;
}

async function waitFor(
  condition: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sorted: number[], p: number): number {
  const rank = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  const value = sorted[Math.max(0, rank)];
  if (value === undefined) {
    throw new Error("no samples");
  }
  return value;
}

describe("xr-sync-server C1 host-only sync", () => {
  it("T1: two clients converge on learner A state after 100 pose intents", async () => {
    const server = await startServer();
    const a: SyncConnection = await connect(server.url);
    const b: SyncConnection = await connect(server.url);
    trackConnection(a);
    trackConnection(b);
    expect(a.sessionId).not.toBe(b.sessionId);

    let latestA: EncounterSnapshot | undefined;
    let latestB: EncounterSnapshot | undefined;
    a.onState((snapshot) => {
      latestA = snapshot;
    });
    b.onState((snapshot) => {
      latestB = snapshot;
    });

    const pose: ClientIntentKind = "pose";
    for (let i = 1; i <= 100; i += 1) {
      const payload: IntentPayload = { x: i + 0.5, y: i * 2.5, z: -i * 1.25 };
      const result: IntentResult = await a.sendIntent(pose, payload);
      if (result.status !== "ack") {
        throw new Error(`expected ack for seq ${i}, got reject`);
      }
      const ack: AckResult = result;
      expect(ack.seq).toBe(i);
    }

    await waitFor(() => (latestB?.serverTick ?? -1) >= 100, 10000, "client B snapshot tick 100");
    await waitFor(() => (latestA?.serverTick ?? -1) >= 100, 10000, "client A snapshot tick 100");

    const serverState = JSON.parse(server.getStateJSON()) as EncounterSnapshot;
    const expectedLearner: SnapshotLearner = {
      sessionId: a.sessionId,
      headX: 100.5,
      headY: 250,
      headZ: -125,
      lastSeq: 100,
      speaking: false,
    };
    expect(latestA?.learners[a.sessionId]).toEqual(expectedLearner);
    expect(latestB?.learners[a.sessionId]).toEqual(expectedLearner);
    expect(serverState.learners[a.sessionId]).toEqual(expectedLearner);
  }, 30000);

  it("T2: RTT p50/p95/max over 100 acknowledged intents", async () => {
    const server = await startServer();
    const a: SyncConnection = await connect(server.url);
    trackConnection(a);

    const rtts: number[] = [];
    const seqs: number[] = [];
    const pose: ClientIntentKind = "pose";
    for (let i = 1; i <= 100; i += 1) {
      const result: IntentResult = await a.sendIntent(pose, { x: i, y: i, z: i });
      if (result.status !== "ack") {
        throw new Error(`expected ack for seq ${i}, got reject`);
      }
      const ack: AckResult = result;
      rtts.push(ack.rttMs);
      seqs.push(ack.seq);
    }

    expect(seqs).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
    const sorted = [...rtts].sort((left, right) => left - right);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const max = sorted[sorted.length - 1];
    if (max === undefined) {
      throw new Error("no RTT samples");
    }
    console.log(`C1_RTT_MS n=100 p50=${p50.toFixed(2)} p95=${p95.toFixed(2)} max=${max.toFixed(2)}`);
  }, 30000);

  it("T3: forged and invalid intents leave state byte-identical and get rejects", async () => {
    const server = await startServer();
    const raw = new Client(server.url);
    const room = await raw.joinOrCreate(ENCOUNTER_ROOM_NAME, {});
    leavers.push(() => room.leave());

    const acks: Array<AckMessage> = [];
    const rejects: Array<RejectMessage> = [];
    room.onMessage("ack", (message) => {
      acks.push(message as AckMessage);
    });
    room.onMessage("reject", (message) => {
      rejects.push(message as RejectMessage);
    });

    const sendIntent = async (intent: IntentMessage): Promise<void> => {
      room.send("intent", intent);
      await new Promise((resolve) => setTimeout(resolve, 150));
    };
    const sendRaw = async (type: string, payload: unknown): Promise<void> => {
      room.send(type, payload);
      await new Promise((resolve) => setTimeout(resolve, 150));
    };

    const pose: ServerIntentKind = "pose";
    const selectActor: ServerIntentKind = "select-actor";

    // Valid baseline so monotonic-seq checks have something to bite on.
    await sendIntent({ kind: pose, seq: 1, clientTs: Date.now(), payload: { x: 1, y: 2, z: 3 } });
    expect(acks).toEqual([{ seq: 1, serverTs: expect.any(Number) }]);

    // (a) Forged state message on a known actor: must not apply, no ack/reject owed.
    const beforeForge = server.getStateJSON();
    await sendRaw("state", { actors: { physician: { emotion: "angry" } } });
    expect(server.getStateJSON()).toBe(beforeForge);
    expect(acks.length).toBe(1);
    expect(rejects.length).toBe(0);

    // (b) Stale seq: not greater than lastSeq.
    const beforeStale = server.getStateJSON();
    await sendIntent({ kind: pose, seq: 1, clientTs: Date.now(), payload: { x: 9, y: 9, z: 9 } });
    expect(server.getStateJSON()).toBe(beforeStale);
    expect(rejects.at(-1)).toMatchObject({ seq: 1, reason: "stale-seq" });

    // (c) select-actor with unknown id.
    const beforeUnknown = server.getStateJSON();
    await sendIntent({
      kind: selectActor,
      seq: 2,
      clientTs: Date.now(),
      payload: { actorId: "ghost-surgeon" },
    });
    expect(server.getStateJSON()).toBe(beforeUnknown);
    expect(rejects.at(-1)).toMatchObject({ seq: 2, reason: "unknown-actor" });

    // (d) pose with NaN.
    const beforeNaN = server.getStateJSON();
    await sendIntent({
      kind: pose,
      seq: 3,
      clientTs: Date.now(),
      payload: { x: Number.NaN, y: 0, z: 0 },
    });
    expect(server.getStateJSON()).toBe(beforeNaN);
    expect(rejects.at(-1)).toMatchObject({ seq: 3, reason: "bad-pose-payload" });

    // Stable-serialized comparison as a second, key-order-proof check.
    expect(stableStringify(JSON.parse(server.getStateJSON()))).toBe(
      stableStringify(JSON.parse(beforeNaN)),
    );
    const finalState = JSON.parse(server.getStateJSON()) as EncounterSnapshot;
    const { physician }: { physician?: SnapshotActor } = finalState.actors;
    expect(physician?.emotion).toBe("neutral");
    expect(Object.values(finalState.learners)[0]?.lastSeq).toBe(1);
  }, 30000);

  it("T4: unclean drop then reconnect keeps learner entry and lastSeq", async () => {
    const server = await startServer();
    const a: SyncConnection = await connect(server.url);

    const pose: ClientIntentKind = "pose";
    for (let i = 1; i <= 5; i += 1) {
      const result: IntentResult = await a.sendIntent(pose, { x: i, y: i, z: i });
      if (result.status !== "ack") {
        throw new Error(`expected ack for seq ${i}, got reject`);
      }
      const ack: AckResult = result;
      expect(ack.seq).toBe(i);
    }
    const before = JSON.parse(server.getStateJSON()) as EncounterSnapshot;
    expect(before.learners[a.sessionId]?.lastSeq).toBe(5);

    await a.leave(false);
    trackConnection(a);

    let reconnected = false;
    const deadline = Date.now() + 8000;
    let lastError: unknown;
    while (!reconnected && Date.now() < deadline) {
      try {
        await a.reconnect();
        reconnected = true;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    if (!reconnected) {
      throw new Error(`reconnect failed: ${String(lastError)}`);
    }

    const after = JSON.parse(server.getStateJSON()) as EncounterSnapshot;
    expect(after.learners[a.sessionId]?.lastSeq).toBe(5);
    expect(after.learners[a.sessionId]?.headX).toBe(5);

    const next: IntentResult = await a.sendIntent(pose, { x: 6, y: 6, z: 6 });
    if (next.status !== "ack") {
      throw new Error(`expected ack for seq 6, got ${next.status}`);
    }
    const ack6: AckResult = next;
    expect(ack6.seq).toBe(6);
  }, 30000);

  it("T5: client package stays lean (only @colyseus/sdk, small dist)", () => {    const clientRoot = join(__dirname, "..", "..", "xr-sync-client");
    const manifest = JSON.parse(
      readFileSync(join(clientRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(["@colyseus/sdk"]);

    const distRoot = join(clientRoot, "dist");
    const distFiles = readdirSync(distRoot).filter((file) => file.endsWith(".js"));
    expect(distFiles.length).toBeGreaterThan(0);
    const specifierPattern = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;
    const externals = new Set<string>();
    let distBytes = 0;
    for (const file of distFiles) {
      const path = join(distRoot, file);
      distBytes += statSync(path).size;
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(specifierPattern)) {
        const specifier = match[1];
        if (specifier === undefined) {
          continue;
        }
        if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
          externals.add(specifier);
        }
      }
    }
    expect([...externals].sort()).toEqual(["@colyseus/sdk"]);
    console.log(`C1_CLIENT_DIST_BYTES n=${distBytes}`);
  }, 30000);

  it("T6: wire carries only ack/reject; patch bytes vs full-state bytes", async () => {
    const server = await startServer();

    const raw = new Client(server.url);
    const room = await raw.joinOrCreate(ENCOUNTER_ROOM_NAME, {});
    leavers.push(() => room.leave());

    // Purity tap: the "*" handler is a fallback that fires for every named
    // message WITHOUT a specific handler, so ack/reject are demultiplexed
    // here and every wire message type is observed in one place.
    // A re-added broadcast (the T6 probe) shows up here as its own type.
    const seenTypes: string[] = [];
    const acked = new Set<number>();
    const rejected: Array<RejectResult> = [];
    room.onMessage("*", (type, payload) => {
      if (typeof type !== "string") {
        return;
      }
      seenTypes.push(type);
      if (type === "reject") {
        rejected.push(payload as RejectResult);
      }
      const seq = (payload as { seq?: unknown }).seq;
      if (type === "ack" && typeof seq === "number") {
        acked.add(seq);
      }
    });

    // Byte tap: exact inbound frame payload sizes at the SDK transport inlet.
    let inboundBytes = 0;
    const events = room.connection.events as unknown as {
      onmessage?: ((event: unknown) => unknown) | null;
    };
    const prevOnMessage = events.onmessage;
    events.onmessage = (event: unknown): unknown => {
      const data = (event as { data?: unknown }).data;
      if (data instanceof Uint8Array) {
        inboundBytes += data.byteLength;
      } else if (data instanceof ArrayBuffer) {
        inboundBytes += data.byteLength;
      }
      return prevOnMessage?.(event);
    };

    const sessionId = room.sessionId;
    let latestLearner: SnapshotLearner | undefined;
    room.onStateChange((state) => {
      const json = (state as { toJSON: () => EncounterSnapshot }).toJSON();
      latestLearner = json.learners[sessionId];
    });
    await waitFor(() => latestLearner !== undefined, 5000, "initial reflection state");

    // Quiesce: an idle connection must be silent (no polling frames).
    await sleep(500);
    inboundBytes = 0;
    await sleep(500);
    const baselineBytes = inboundBytes;
    inboundBytes = 0;

    // Scope the purity window to the bursts below.
    seenTypes.length = 0;

    // Valid burst: spaced past the patch tick so each intent gets its own patch.
    const validBytes: number[] = [];
    const pose: ServerIntentKind = "pose";
    for (let i = 1; i <= 10; i += 1) {
      inboundBytes = 0;
      const intent: IntentMessage = {
        kind: pose,
        seq: i,
        clientTs: Date.now(),
        payload: { x: i + 0.5, y: i * 2.5, z: -i * 1.25 },
      };
      room.send("intent", intent);
      await waitFor(() => acked.has(i), 5000, `ack ${i}`);
      await waitFor(() => latestLearner?.lastSeq === i, 5000, `patch ${i}`);
      validBytes.push(inboundBytes);
      await sleep(250);
    }

    // Invalid burst: stale seq draws a reject and must not dirty state.
    const invalidBytes: number[] = [];
    for (let k = 0; k < 5; k += 1) {
      inboundBytes = 0;
      const stale: IntentMessage = {
        kind: pose,
        seq: 1,
        clientTs: Date.now(),
        payload: { x: 0, y: 0, z: 0 },
      };
      room.send("intent", stale);
      await waitFor(() => rejected.length === k + 1, 5000, `reject ${k}`);
      await sleep(250);
      invalidBytes.push(inboundBytes);
    }

    // Purity: the only named messages on the wire are ack and reject.
    expect(seenTypes.length).toBeGreaterThan(0);
    expect(new Set(seenTypes)).toEqual(new Set(["ack", "reject"]));

    const mean = (samples: number[]): number =>
      samples.reduce((total, value) => total + value, 0) / samples.length;
    const patchMean = mean(validBytes) - mean(invalidBytes);
    const fullBytes = server.getStateJSON().length;
    console.log(
      `C1_PATCH_BYTES n=10 baseline500ms=${baselineBytes} meanPatch=${patchMean.toFixed(2)} meanAckLike=${mean(invalidBytes).toFixed(2)} fullState=${fullBytes}`,
    );
      expect(baselineBytes).toBe(0);
      expect(patchMean).toBeGreaterThan(0);
      expect(patchMean).toBeLessThan(fullBytes);

      // Equality via patches: client learner mirrors the server record.
      const serverState = JSON.parse(server.getStateJSON()) as EncounterSnapshot;
      expect(latestLearner).toEqual(serverState.learners[sessionId]);
  }, 60000);

  it("T7: select-actor and utterance intents drive the server turn (C3 meaning)", async () => {
    // C3 superseded: actor speaking now follows the server reply, see xr-sync-c3-actor-turn.test.ts.
    const server = await startServer();
    const a: SyncConnection = await connect(server.url);
    trackConnection(a);
    let latest: EncounterSnapshot | undefined;
    a.onState((snapshot) => {
      latest = snapshot;
    });
    await waitFor(() => latest !== undefined, 5000, "initial state");

    const select: ServerIntentKind = "select-actor";
    const start: ServerIntentKind = "utterance-start";
    const end: ServerIntentKind = "utterance-end";
    const selected = await a.sendIntent(select, { actorId: "physician" });
    expect(selected).toMatchObject({ status: "ack", seq: 1 });
    const started = await a.sendIntent(start, {});
    expect(started).toMatchObject({ status: "ack", seq: 2 });
    // Learner holds the turn while speaking; the actor stays silent until utterance-end.
    const learnerSpeakingIs = (snapshot: EncounterSnapshot | undefined, value: boolean): boolean => {
      if (snapshot === undefined) {
        return false;
      }
      return snapshot.learners[a.sessionId]?.speaking === value;
    };
    await waitFor(() => learnerSpeakingIs(latest, true), 5000, "learner speaking true");
    await waitFor(() => latest?.actors["physician"]?.speaking !== true, 5000, "actor silent during learner turn");
    expect(latest?.turnOwner).toBe("learner");
    const ended = await a.sendIntent(end, {});
    expect(ended).toMatchObject({ status: "ack", seq: 3 });
    const speakingIs = (snapshot: EncounterSnapshot | undefined, value: boolean): boolean => {
      if (snapshot === undefined) {
        return false;
      }
      const { physician }: { physician?: SnapshotActor } = snapshot.actors;
      return physician?.speaking === value;
    };
    await waitFor(() => speakingIs(latest, true), 5000, "actor speaking on server reply");
    expect(latest?.turnOwner).toBe("actor");
    expect(latest?.turnId).toBe(1);
    expect(latest?.actors["physician"]?.replyId).toMatch(/\S/);
    // The server clock ends the turn on its own: speaking false, owner none.
    await waitFor(() => speakingIs(latest, false), 15000, "speaking false");
    expect(latest?.turnOwner).toBe("none");

    const serverState = JSON.parse(server.getStateJSON()) as EncounterSnapshot;
    const { physician: finalPhysician }: { physician?: SnapshotActor } = serverState.actors;
    expect(finalPhysician?.speaking).toBe(false);
    expect(serverState.learners[a.sessionId]?.lastSeq).toBe(3);
  }, 30000);
});
