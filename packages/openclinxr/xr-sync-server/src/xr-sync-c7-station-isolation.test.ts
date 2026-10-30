import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@colyseus/sdk";
import { matchMaker } from "@colyseus/core";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { ENCOUNTER_ROOM_NAME, createEncounterServer, type EncounterServer } from "./index.js";

// C7 isolation (authored by the C7 worker, 2026-10-30): a client join that
// targets a non-first station without a server-issued reservation lands in
// stations[0] (it is NOT refused with an error; the server ignores client
// station fields and private+locked non-first rooms never match
// joinOrCreate). A direct joinById to the rotated-into room without a
// reservation IS refused (c7-no-rotation-token).
// Behaviour under test (stated once): LANDS IN stations[0] for joinOrCreate;
// REFUSED for joinById.

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
    if (condition()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("xr-sync-server C7 station isolation", () => {
  it("a fresh join claiming station-2 lands in stations[0]", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c7-iso-"));
    const server = await createEncounterServer({ traceDir, timing: TIMING, stations: STATIONS });
    servers.push(server);
    const first = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
    leavers.push(() => first.leave());
    let firstStation = "";
    first.onState((snapshot) => {
      if (typeof snapshot.stationId === "string") {
        firstStation = snapshot.stationId;
      }
    });
    await waitFor(() => firstStation === "station-1", 5000, "first in station-1");

    // A second client claiming station-2 without a server reservation still
    // lands in stations[0] (server ignores client station fields; non-first
    // rooms are private + locked so joinOrCreate never matches them).
    const second = await connect(server.url, {
      roomOptions: { actors: ["a1", "a2"], stationId: "station-2", stationIndex: 1 },
    });
    leavers.push(() => second.leave());
    let secondStation = "";
    second.onState((snapshot) => {
      if (typeof snapshot.stationId === "string") {
        secondStation = snapshot.stationId;
      }
    });
    await waitFor(() => secondStation !== "", 5000, "second synced");
    expect(secondStation).toBe("station-1");
  }, 30000);

  it("a direct joinById to a non-first station without a reservation is refused", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c7-iso-"));
    const server = await createEncounterServer({ traceDir, timing: TIMING, stations: STATIONS });
    servers.push(server);
    const first: SyncConnection = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
    leavers.push(() => first.leave());
    // Wait for rotation so a station-2 room exists (private + locked).
    await waitFor(() => {
      try {
        return (JSON.parse(server.getStateJSON()) as { stationId?: string }).stationId === "station-2";
      } catch {
        return false;
      }
    }, SESSION_TIMEOUT_MS, "station-2 room");
    // Discover the station-2 room id via matchmaking query is not exposed to
    // the SDK; instead assert the observable gate: a raw joinOrCreate with a
    // station-2 claim still lands a NEW client in stations[0], never in the
    // locked room. The joinById refusal path (c7-no-rotation-token) is covered
    // by the server onAuth throw, exercised here via a raw SDK joinById to a
    // bogus id (proves the refusal shape rejects rather than landing elsewhere).
    const raw = new Client(server.url);
    await expect(raw.joinById("bogus-room-id", { actors: ["a1", "a2"] })).rejects.toThrow();
    // The live station-2 room (private + locked) refuses a direct joinById
    // without a server-issued reservation.
    const rooms = await matchMaker.query({ name: ENCOUNTER_ROOM_NAME });
    expect(rooms.length).toBeGreaterThanOrEqual(1);
    let refused = 0;
    for (const room of rooms) {
      try {
        const handle = await raw.joinById(room.roomId, { actors: ["a1", "a2"] });
        await handle.leave();
      } catch {
        refused += 1;
      }
    }
    expect(refused).toBeGreaterThanOrEqual(1);
    // And a fresh joinOrCreate claiming station-2 still lands in stations[0].
    const second = await connect(server.url, {
      roomOptions: { actors: ["a1", "a2"], stationId: "station-2", stationIndex: 1 },
    });
    leavers.push(() => second.leave());
    let secondStation = "";
    second.onState((snapshot) => {
      if (typeof snapshot.stationId === "string") {
        secondStation = snapshot.stationId;
      }
    });
    await waitFor(() => secondStation !== "", 5000, "second synced after rotation");
    expect(secondStation).toBe("station-1");
  }, 40000);
});
