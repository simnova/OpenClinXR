import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type SyncConnection } from "@openclinxr/xr-sync-client";
import { afterEach, describe, expect, it } from "vitest";
import { createEncounterServer, type EncounterServer } from "./index.js";
import { getLatestRoom } from "./room.js";
import {
  clearStationNoncesOnDispose,
  driveStationRotation,
  type RotationMatchMaker,
  type StationBinding,
} from "./station-rotation.js";

// C8 hardening (authored by the C8 worker, 2026-10-30): D2/D3/D4.
//   D2: reservation failure retries once, then the client gets "rotation-failed"
//     {stationId} and the trace records kind "rotation-failed" (no identity);
//     the client surfaces it via onRotationFailed / rotationFailed.
//   D3: an intent from a session that is neither learner nor observer of the
//     room rejects "not-joined" (never a silent drop).
//   D4: unused nonces are cleared on failure/expiry/dispose (no leak).

const TIMING = { doorwaySeconds: 1, encounterSeconds: 1, noteSeconds: 1 };

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

function testBinding(stations: string[] = ["station-1", "station-2"]): StationBinding {
  return { stations, creationNonces: new Map(), joinNonces: new Set(), appliedPoseByStation: new Map() };
}

function fakeMatchMaker(overrides: {
  createRoom?: (roomName: string, options: Record<string, unknown>) => Promise<{ roomId: string }>;
  reserveSeatFor?: (room: { roomId: string }, options: Record<string, unknown>) => Promise<unknown>;
}): RotationMatchMaker {
  return {
    createRoom: (overrides.createRoom ?? (async () => ({ roomId: "fake-room" }))) as RotationMatchMaker["createRoom"],
    reserveSeatFor: (overrides.reserveSeatFor ?? (async () => ({ sessionId: "r1" }))) as RotationMatchMaker["reserveSeatFor"],
    getLocalRoomById: (() => undefined) as RotationMatchMaker["getLocalRoomById"],
  };
}

describe("xr-sync-server C8 rotation hardening D2/D3/D4", () => {
  it("D2: a twice-failed reservation sends rotation-failed and traces it without identity", async () => {
    const binding = testBinding();
    const deps = fakeMatchMaker({
      reserveSeatFor: async () => {
        throw new Error("full");
      },
    });
    const sent: Array<{ type: string; message: unknown }> = [];
    const failed: string[] = [];
    const rotated = await driveStationRotation({
      roomName: "encounter",
      stations: ["station-1", "station-2"],
      stationIndex: 0,
      learners: [
        {
          sessionId: "s1",
          send: (type: string, message: unknown): void => {
            sent.push({ type, message });
          },
        },
      ],
      actorIds: ["a1"],
      closedAt: undefined,
      binding,
      stationId: "station-1",
      onRotationFailed: (stationId: string): void => {
        failed.push(stationId);
      },
      deps,
    });
    expect(rotated).toBe(true);
    expect(sent.filter((entry) => entry.type === "rotate")).toHaveLength(0);
    expect(sent.filter((entry) => entry.type === "rotation-failed")).toHaveLength(1);
    expect((sent.find((entry) => entry.type === "rotation-failed")?.message as { stationId?: unknown }).stationId).toBe(
      "station-2",
    );
    expect(failed).toEqual(["station-2"]);
    expect(binding.joinNonces.size).toBe(0);
  }, 20000);

  it("D2: one failure then success still rotates with no failure signal", async () => {
    const binding = testBinding();
    let calls = 0;
    const deps = fakeMatchMaker({
      reserveSeatFor: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("full");
        }
        return { sessionId: "r1" };
      },
    });
    const sent: Array<{ type: string; message: unknown }> = [];
    const failed: string[] = [];
    const rotated = await driveStationRotation({
      roomName: "encounter",
      stations: ["station-1", "station-2"],
      stationIndex: 0,
      learners: [
        {
          sessionId: "s1",
          send: (type: string, message: unknown): void => {
            sent.push({ type, message });
          },
        },
      ],
      actorIds: ["a1"],
      closedAt: undefined,
      binding,
      stationId: "station-1",
      onRotationFailed: (stationId: string): void => {
        failed.push(stationId);
      },
      deps,
    });
    expect(rotated).toBe(true);
    expect(calls).toBe(2);
    expect(sent.filter((entry) => entry.type === "rotate")).toHaveLength(1);
    expect(sent.filter((entry) => entry.type === "rotation-failed")).toHaveLength(0);
    expect(failed).toEqual([]);
  }, 20000);

  it("D4: a failed createRoom does not leak its creation nonce", async () => {
    const binding = testBinding();
    const deps = fakeMatchMaker({
      createRoom: async () => {
        throw new Error("no-room");
      },
    });
    await expect(
      driveStationRotation({
        roomName: "encounter",
        stations: ["station-1", "station-2"],
        stationIndex: 0,
        learners: [{ sessionId: "s1", send: (): void => {} }],
        actorIds: ["a1"],
        closedAt: undefined,
        binding,
        stationId: "station-1",
        deps,
      }),
    ).rejects.toThrow("rotation-failed");
    expect(binding.creationNonces.size).toBe(0);
  }, 20000);

  it("D4: dispose clearing empties every unused nonce", () => {
    const binding = testBinding();
    binding.creationNonces.set("create-leak", 1);
    binding.joinNonces.add("join-leak");
    clearStationNoncesOnDispose(binding);
    expect(binding.creationNonces.size).toBe(0);
    expect(binding.joinNonces.size).toBe(0);
  });

  it("D3: an intent from an unknown session rejects not-joined (never a silent drop)", async () => {
    const traceDir = mkdtempSync(join(tmpdir(), "xr-sync-c8-d3-"));
    const server = await createEncounterServer({ traceDir, timing: { ...TIMING } });
    servers.push(server);
    const learner: SyncConnection = await connect(server.url, { roomOptions: { actors: ["a1", "a2"] } });
    leavers.push(() => learner.leave());
    const room = getLatestRoom();
    expect(room).toBeDefined();
    room?.state.learners.delete(learner.sessionId);
    const result = await learner.sendIntent("pose", { x: 0, y: 1.6, z: 0 });
    expect(result).toMatchObject({ status: "reject", reason: "not-joined" });
  }, 20000);
});
