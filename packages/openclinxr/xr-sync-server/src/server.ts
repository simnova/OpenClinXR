import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ENCOUNTER_ROOM_NAME, EncounterRoom, getLatestRoom } from "./room.js";
import {
  createStationReplayRoomClass,
  loadStationReplayDir,
  parseReplayStepMs,
  type LoadedStationReplay,
  type StationReplayBinding,
} from "./station-replay.js";
import { parseReviewRubric, parseScoreDir } from "./faculty-score.js";
import { assertScoreDirOutsideReplayDir } from "./review-packet.js";
import { parseNoteMaxChars } from "./patient-note.js";
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
  /**
   * C8 rotation fault seam (server config only, never client-settable; the
   * product path leaves it unset). Forces the next N seat reservations to
   * fail (exercises retry + rotation-failed) and/or sends a bogus rotate
   * payload (exercises the client consume-fail path). Test-only.
   */
  rotationFaults?: { failNextReservations?: number; sendBogusRotate?: boolean; failNextStationCreate?: number };
  /**
   * C11 patient-note bound: the longest accepted note text in chars (server
   * config only, never client roomOptions.noteMaxChars). Defaults to 2000
   * when unset (a harness-oriented bound, not a Step 2 CS figure). Throws at
   * boot on invalid (fail fast, never per intent).
   */
  noteMaxChars?: number;
  /**
   * C10 faculty station replay (directory holding a C9
   * exam-session.review-index.json plus the per-station traces it names).
   * Server config only: a client joins with roomOptions.replayStationId.
   * When set, this server serves replay rooms only (never live rooms).
   */
  replayDir?: string;
  /**
   * C10 ms between recorded replay events on the room clock (server config
   * only). Defaults to 300.
   */
  replayStepMs?: number;
  /**
   * C13 faculty-score directory: <stationId>.faculty-score.json files are
   * written beside (never inside) the replay directory. Server config only.
   * Omit to disable scoring (score-station rejects "scoring-disabled").
   */
  scoreDir?: string;
  /**
   * C13 faculty review rubric ([{ id, label }], unique non-empty ids).
   * Server config only. Omit to disable scoring. Throws at boot on invalid.
   */
  reviewRubric?: { id: string; label: string }[];
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
  const noteMaxChars = parseNoteMaxChars(options.noteMaxChars);
  const traceDir = typeof options.traceDir === "string" ? options.traceDir : null;
  // Per-server room subclass: timing + traceDir + stations are bound in the
  // closure and read in onCreate via the protected hook. Every room on this
  // server shares this binding; client roomOptions.timing/.phase/.traceDir
  // /.stationId/.stationIndex are ignored, and no module cell leaks one
  // server's config into another room or server. Rotation nonces are
  // per-server single-use sets shared by reference across this server's rooms.
  const binding: StationBinding = {
    stations,
    creationNonces: new Map(),
    joinNonces: new Set(),
    appliedPoseByStation: new Map(),
    rotationFaults: {
      failNext: options.rotationFaults?.failNextReservations ?? 0,
      bogusRotate: options.rotationFaults?.sendBogusRotate ?? false,
      failNextCreate: options.rotationFaults?.failNextStationCreate ?? 0,
    },
  };
  const replayDir = typeof options.replayDir === "string" ? options.replayDir : null;
  class ConfiguredEncounterRoom extends EncounterRoom {
    protected override stationTiming = timing;
    protected override stationTraceDir = traceDir;
    protected override stationNoteMaxChars = noteMaxChars;
    protected override stationBinding: StationBinding = binding;
  }
  const server = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });
  if (replayDir !== null) {
    // C10 faculty replay server: the C9 review index + traces are loaded and
    // validated once at boot (a malformed or missing file refuses each join
    // with a named error, never a partial replay). The replay room is defined
    // under the same room name; no live room exists on this server.
    const stepMs = parseReplayStepMs(options.replayStepMs);
    let replay: LoadedStationReplay | null = null;
    let loadError: string | null = null;
    try {
      replay = loadStationReplayDir(replayDir);
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    }
    const scoreDir = parseScoreDir(options.scoreDir);
    // C14: the score packet lives beside the replay dir, never equal to or inside it.
    assertScoreDirOutsideReplayDir(replayDir, scoreDir);
    const replayBinding: StationReplayBinding = { replay, loadError, stepMs, replayDir, stationFailures: replay?.failures ?? new Map(), score: { scoreDir, rubric: parseReviewRubric(options.reviewRubric) } };
    server.define(ENCOUNTER_ROOM_NAME, createStationReplayRoomClass(replayBinding));
  } else {
    server.define(ENCOUNTER_ROOM_NAME, ConfiguredEncounterRoom);
  }
  // Loopback only: the url dials 127.0.0.1, and a wildcard bind lets another
  // process take 127.0.0.1:<port> on macOS and answer this server's clients.
  await server.listen(options.port ?? 0, "127.0.0.1");
  const address = httpServer.address() as AddressInfo | null;
  const port = address?.port ?? options.port ?? 0;

  // C11: on a replay-only server there is no live room by construction (the
  // replay rooms hold no live state). Name the replay server in the error so
  // operators stop looking for a live encounter room that can never exist.
  // The check ignores getLatestRoom: a stale live room from an earlier server
  // in the same process must not leak into a replay handle.
  if (replayDir !== null) {
    const replayError = "no live encounter room: this is a replay server (join a replayStationId room to review)";
    return {
      port,
      url: `ws://127.0.0.1:${port}`,
      getStateJSON(): string {
        throw new Error(replayError);
      },
      getProbeStats(): RoomProbeStats {
        throw new Error(replayError);
      },
      getConversationTrace(): ConversationTrace {
        throw new Error(replayError);
      },
      getStationPoseCounts(): Record<string, number> {
        return {};
      },
      async close(): Promise<void> {
        await server.gracefullyShutdown(false);
      },
    };
  }

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
