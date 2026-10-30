import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { ENCOUNTER_ROOM_NAME, createEncounterServer, type EncounterServer } from "./index.js";

// C6 server-config follow-up (2026-10-30): station timing and the trace
// directory are PER-SERVER config, never client roomOptions. The room reads
// both ONLY from its server binding:
//   (a) two rooms created sequentially on one timed server both start at
//       phase doorway with the clock running;
//   (b) two servers in one process with different encounterSeconds keep
//       their own clock each;
//   (c) a client joining with roomOptions.traceDir writes nothing there;
//       the trace lands in the server traceDir.
// Contract: createEncounterServer({ timing, traceDir }); client
// roomOptions.timing / roomOptions.phase / roomOptions.traceDir are ignored.

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
    if (condition()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface TrackedPhase {
  phase?: unknown;
  phaseRemainingS?: unknown;
}

/** Client-observed server state for one raw room (works with many rooms per server). */
function trackRoom(room: Room): { get(): TrackedPhase } {
  let latest: TrackedPhase = {};
  room.onStateChange((state) => {
    // Keep the receiver: toJSON reads schema internals off `this`.
    latest = (state as unknown as { toJSON(): TrackedPhase }).toJSON();
  });
  return { get: () => latest };
}

describe("xr-sync-server C6 per-server config", () => {
  it("(a) two rooms on one timed server both start doorway with the clock running", async () => {
    const server = await createEncounterServer({
      timing: { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 1 },
    });
    servers.push(server);
    const first = new Client(server.url);
    const room1 = await first.joinOrCreate(ENCOUNTER_ROOM_NAME, { actors: ["a1", "a2"] });
    leavers.push(() => room1.leave());
    const seen1 = trackRoom(room1);
    // A second room on the SAME server (create always makes a new room).
    const second = new Client(server.url);
    const room2 = await second.create(ENCOUNTER_ROOM_NAME, { actors: ["a1", "a2"] });
    leavers.push(() => room2.leave());
    const seen2 = trackRoom(room2);

    await waitFor(() => seen1.get().phase !== undefined && seen2.get().phase !== undefined, 5000, "both rooms synced");
    expect(seen1.get().phase).toBe("doorway");
    expect(seen2.get().phase).toBe("doorway");
    expect(seen1.get().phaseRemainingS).toBe(1);
    expect(seen2.get().phaseRemainingS).toBe(1);
    // Both clocks run to closed on their own.
    await waitFor(() => seen1.get().phase === "closed" && seen2.get().phase === "closed", 10000, "both rooms closed");
  }, 20000);

  it("(b) two servers in one process keep their own encounterSeconds across lifetimes", async () => {
    // Supported topology: server lifetimes do not overlap. Colyseus pools
    // same-name rooms process-wide by last defineRoomType (verified by
    // swapping define order: the trailing definition serves both servers),
    // so two CONCURRENT same-name servers cannot isolate config at the
    // xr-sync layer; each production server runs in its own process.
    // Ranges (not exact) absorb the first 1 s countdown tick racing the read.
    const slow = await createEncounterServer({
      timing: { doorwaySeconds: 1, encounterSeconds: 30, noteSeconds: 1 },
    });
    servers.push(slow);
    const slowClient = new Client(slow.url);
    const slowRoom = await slowClient.joinOrCreate(ENCOUNTER_ROOM_NAME, { actors: ["a1", "a2"] });
    leavers.push(() => slowRoom.leave());
    const seenSlow = trackRoom(slowRoom);
    await waitFor(() => seenSlow.get().phase === "encounter", 5000, "slow room encounter");
    const slowRemaining = seenSlow.get().phaseRemainingS;
    expect(slowRemaining).toBeGreaterThanOrEqual(29);
    expect(slowRemaining).toBeLessThanOrEqual(30);
    await slowRoom.leave();
    await slow.close();
    servers.splice(servers.indexOf(slow), 1);

    const fast = await createEncounterServer({
      timing: { doorwaySeconds: 1, encounterSeconds: 2, noteSeconds: 1 },
    });
    servers.push(fast);
    const fastClient = new Client(fast.url);
    const fastRoom = await fastClient.joinOrCreate(ENCOUNTER_ROOM_NAME, { actors: ["a1", "a2"] });
    leavers.push(() => fastRoom.leave());
    const seenFast = trackRoom(fastRoom);
    await waitFor(() => seenFast.get().phase === "encounter", 5000, "fast room encounter");
    const fastRemaining = seenFast.get().phaseRemainingS;
    expect(fastRemaining).toBeGreaterThanOrEqual(1);
    expect(fastRemaining).toBeLessThanOrEqual(2);
  }, 20000);

  it("(c) a client traceDir writes nothing to the client dir", async () => {
    const serverDir = await mkdtemp(join(tmpdir(), "c6-server-trace-"));
    dirs.push(serverDir);
    const evilDir = await mkdtemp(join(tmpdir(), "c6-evil-trace-"));
    dirs.push(evilDir);
    const server = await createEncounterServer({
      traceDir: serverDir,
      timing: { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 1 },
    });
    servers.push(server);
    const connection: SyncConnection = await connect(server.url, {
      roomOptions: { actors: ["a1", "a2"], traceDir: evilDir },
    });
    leavers.push(() => connection.leave());
    await waitFor(() => seenPhase(server) === "closed", 10000, "station closed");
    await connection.leave();
    await server.close();
    servers.splice(servers.indexOf(server), 1);

    const evilFiles = (await readdir(evilDir)).filter((f) => f.endsWith(".conversation-trace.json"));
    expect(evilFiles).toEqual([]);
    const serverFiles = (await readdir(serverDir)).filter((f) => f.endsWith(".conversation-trace.json"));
    expect(serverFiles).toHaveLength(1);
  }, 20000);

  function seenPhase(server: EncounterServer): string {
    return (JSON.parse(server.getStateJSON()) as { phase?: unknown }).phase as string;
  }
});
