import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ENCOUNTER_ROOM_NAME, EncounterRoom, getLatestRoom, snapshotState, type RoomProbeStats } from "./room.js";

/** Options for booting an in-process encounter server. */
export interface EncounterServerOptions {
  /** Port to bind. Defaults to 0 (ephemeral, read back from `port`). */
  port?: number;
}

/** Handle to a running encounter server with its bound address. */
export interface EncounterServer {
  port: number;
  url: string;
  /** Stable-serialized authoritative state of the latest live room. */
  getStateJSON(): string;
  /** Read-only probe stats (intent counts, selection sequence, C3 turn log) of the latest live room. */
  getProbeStats(): RoomProbeStats;
  close(): Promise<void>;
}

/** Boot one encounter room on an HTTP and WebSocket transport, then listen. */
export async function createEncounterServer(
  options: EncounterServerOptions = {},
): Promise<EncounterServer> {
  const httpServer = createServer();
  const server = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });
  server.define(ENCOUNTER_ROOM_NAME, EncounterRoom);
  await server.listen(options.port ?? 0);
  const address = httpServer.address() as AddressInfo | null;
  const port = address?.port ?? options.port ?? 0;

  return {
    port,
    url: `ws://127.0.0.1:${port}`,
    getStateJSON(): string {
      const room = getLatestRoom();
      if (!room?.state) {
        throw new Error("no live encounter room");
      }
      return JSON.stringify(snapshotState(room.state));
    },
    getProbeStats(): RoomProbeStats {
      const room = getLatestRoom();
      if (!room) {
        throw new Error("no live encounter room");
      }
      return room.getProbeStats();
    },
    async close(): Promise<void> {
      await server.gracefullyShutdown(false);
    },
  };
}
