import { Client } from "@colyseus/sdk";
import { connect, type EncounterSnapshot, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import {
  ENCOUNTER_ROOM_NAME,
  createEncounterServer,
  type EncounterServer,
} from "./index.js";

// C2 probe coverage: roomOptions actor provisioning and read-only probe stats.
// Additive to C1; C1 defaults (no options) are unchanged and covered by the C1 suite.

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

describe("xr-sync-server C2 probe provisioning", () => {
  it("roomOptions.actors provisions a1/a2 alongside the known roster", async () => {
    const server = await createEncounterServer();
    servers.push(server);
    const connection: SyncConnection = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
    leavers.push(() => connection.leave());

    let latest: EncounterSnapshot | undefined;
    connection.onState((snapshot) => {
      latest = snapshot;
    });
    await waitFor(() => latest !== undefined, 5000, "initial state");
    await waitFor(
      () => (latest?.actors?.["a1"] !== undefined && latest?.actors?.["a2"] !== undefined) === true,
      5000,
      "probe actors visible",
    );

    const keys = Object.keys(latest?.actors ?? {}).sort();
    expect(keys).toEqual(["a1", "a2", "patient", "physician"]);

    const select = await connection.sendIntent("select-actor", { actorId: "a1" });
    expect(select).toMatchObject({ status: "ack", seq: 1 });
    const started = await connection.sendIntent("utterance-start", {});
    expect(started).toMatchObject({ status: "ack", seq: 2 });
    // C3 superseded: actor speaking now follows the server reply, see xr-sync-c3-actor-turn.test.ts.
    await waitFor(() => latest?.learners[connection.sessionId]?.speaking === true, 5000, "learner speaking");
    expect(latest?.actors["a1"]?.speaking).toBe(false);
    expect(latest?.turnOwner).toBe("learner");
    const ended = await connection.sendIntent("utterance-end", {});
    expect(ended).toMatchObject({ status: "ack", seq: 3 });
    await waitFor(() => latest?.actors["a1"]?.speaking === true, 5000, "a1 speaking on server reply");

    const stats = server.getProbeStats();
    expect(stats.intentCounts).toMatchObject({ pose: 0, "select-actor": 1, "utterance-start": 1, "utterance-end": 1 });
    expect(stats.selections).toEqual([{ sessionId: connection.sessionId, actorId: "a1", seq: 1 }]);

    const serverState = JSON.parse(server.getStateJSON()) as EncounterSnapshot;
    expect(serverState.actors["a1"]?.speaking).toBe(true);
    expect(serverState.turnId).toBe(1);
    expect(serverState.turnOwner).toBe("actor");
  }, 30000);

  it("invalid actor ids are ignored and defaults always survive", async () => {
    const server = await createEncounterServer();
    servers.push(server);
    const connection: SyncConnection = await connect(server.url, {
      roomOptions: { actors: ["ok-1", "bad actor!", 42, "physician", "ok-1", "a".repeat(65)] },
    });
    leavers.push(() => connection.leave());

    let latest: EncounterSnapshot | undefined;
    connection.onState((snapshot) => {
      latest = snapshot;
    });
    await waitFor(() => latest !== undefined, 5000, "initial state");
    await waitFor(() => latest?.actors?.["ok-1"] !== undefined, 5000, "valid extra actor visible");

    const keys = Object.keys(latest?.actors ?? {}).sort();
    expect(keys).toEqual(["ok-1", "patient", "physician"]);

    const rejected = await connection.sendIntent("select-actor", { actorId: "bad actor!" });
    expect(rejected).toMatchObject({ status: "reject", reason: "unknown-actor" });
  }, 30000);

  it("no options keeps the C1 default roster byte-identical", async () => {
    const server = await createEncounterServer();
    servers.push(server);
    const raw = new Client(server.url);
    const room = await raw.joinOrCreate(ENCOUNTER_ROOM_NAME, {});
    leavers.push(() => room.leave());
    const state = JSON.parse(server.getStateJSON()) as EncounterSnapshot;
    expect(Object.keys(state.actors).sort()).toEqual(["patient", "physician"]);
    expect(server.getProbeStats().intentCounts).toEqual({
      pose: 0,
      "select-actor": 0,
      "utterance-start": 0,
      "utterance-end": 0,
    });
    expect(server.getProbeStats().selections).toEqual([]);
  }, 30000);
});
