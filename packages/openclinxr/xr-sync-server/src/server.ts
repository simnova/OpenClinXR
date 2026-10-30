import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ENCOUNTER_ROOM_NAME, EncounterRoom, getLatestRoom } from "./room.js";
import { parseStationTiming, type StationTiming } from "./phase-clock.js";
import { parseStationIds, type StationBinding } from "./station-rotation.js";
import type { RoomProbeStats } from "./room-types.js";
import { snapshotState } from "./schema.js";
import type { ConversationTrace } from "./conversation-trace.js";

/** Options for booting an in-process encounter server. */
export interface EncounterServerOptions {
  /** Port to bind. Defaults to 0 (ephemeral, read back from `port`). */
  port?: number;
  /** Directory for the review-safe conversation trace file (<roomId>.conversation-trace.json), written on room dispose and again on close (same content). Omit to disable. */
  traceDir?: string;
  /**
   * C6 station phase clock ({ doorwaySeconds, encounterSeconds, noteSeconds },
   * integers >= 0). Server config only: the room ignores client
   * roomOptions.timing/phase. Omit for C1..C5 "brief" behaviour.
   */
  timing?: StationTiming;
  /**
   * C7 multi-station rotation (array of station ids, e.g.
   * ["station-1", "station-2"]). Server config only: the room ignores client
   * roomOptions.stationId/stationIndex. Omit or empty for C6 behaviour (no
   * rotation, stationId "", stationIndex 0, stationCount 0).
   */
  stations?: string[];
}

/** Handle to a running encounter server with its bound address. */
export interface EncounterServer {
  port: number;
  url: string;
  /** Stable-serialized authoritative state of the latest live room. */
  getStateJSON(): string;
  /** Read-only probe stats (intent counts, selection sequence, C3 turn log) of the latest live room. */
  getProbeStats(): RoomProbeStats;
  /** C4 live conversation trace (review-safe: no sessionId, no reply text). */
  getConversationTrace(): ConversationTrace;
  /** C8 exact per-station applied pose counts (survives room dispose). */
  getStationPoseCounts(): Record<string, number>;
  close(): Promise<void>;
}

/** Boot one encounter room on an HTTP and WebSocket transport, then listen. */
export async function createEncounterServer(
  options: EncounterServerOptions = {},
): Promise<EncounterServer> {
  const httpServer = createServer();
  const timing = parseStationTiming(options.timing);
  const stations = parseStationIds(options.stations);
  const traceDir = typeof options.traceDir === "string" ? options.traceDir : null;
  // Per-server room subclass: timing + traceDir + stations are bound in the
  // closure and read in onCreate via the protected hook. Every room on this
  // server shares this binding; client roomOptions.timing/.phase/.traceDir
  // /.stationId/.stationIndex are ignored, and no module cell leaks one
  // server's config into another room or server. Rotation nonces are
  // per-server single-use sets shared by reference across this server's rooms.
  const binding: StationBinding = { stations, creationNonces: new Map(), joinNonces: new Set(), appliedPoseByStation: new Map() };
  class ConfiguredEncounterRoom extends EncounterRoom {
    protected override stationTiming = timing;
    protected override stationTraceDir = traceDir;
    protected override stationBinding: StationBinding = binding;
  }
  const server = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });
  server.define(ENCOUNTER_ROOM_NAME, ConfiguredEncounterRoom);
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
    getConversationTrace(): ConversationTrace {
      const room = getLatestRoom();
      if (!room) {
        throw new Error("no live encounter room");
      }
      return room.getConversationTrace();
    },
    getStationPoseCounts(): Record<string, number> {
      return Object.fromEntries(binding.appliedPoseByStation);
    },
    async close(): Promise<void> {
      // Flush the trace file before shutdown (same content the room writes on
      // dispose; covers rooms that have not disposed yet).
      getLatestRoom()?.flushConversationTrace();
      await server.gracefullyShutdown(false);
    },
  };
}
