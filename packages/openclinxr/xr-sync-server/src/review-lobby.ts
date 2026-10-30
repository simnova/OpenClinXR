/**
 * C12 faculty review lobby: one lobby room per reviewer on replay servers.
 *
 * Kept in its own module so room.ts and station-replay.ts stay under the
 * file-size gate. The lobby lists the recorded stations from the review
 * index; the reviewer picks one with a select-station intent and the server
 * launches that station's replay on the same connection (a seat reservation
 * the client consumes exactly like a C7 rotation: one mechanism, no second
 * path). Every other intent in the lobby rejects lobby-read-only; an unknown
 * station rejects unknown-station; a station whose trace failed C11
 * validation rejects station-unavailable. Live servers refuse reviewLobby
 * (see room.ts): a reviewer pointed at the wrong server must never get a
 * live learner seat.
 */
import { ArraySchema, MapSchema } from "@colyseus/schema";
import { matchMaker } from "@colyseus/core";
import type { Client } from "@colyseus/core";
import {
  LobbyStationState,
  type ActorStateInstance,
  type EncounterStateInstance,
  type LearnerStateInstance,
  type LobbyStationStateInstance,
} from "./schema.js";
import type { LoadedStationReplay } from "./station-replay.js";

/** Reject reason for every non-select intent in the lobby. */
export const LOBBY_READ_ONLY_REASON = "lobby-read-only";
/** Reject reason for a select-station naming no index station. */
export const LOBBY_UNKNOWN_STATION_REASON = "unknown-station";
/** Reject reason for a station whose trace failed validation. */
export const LOBBY_STATION_UNAVAILABLE_REASON = "station-unavailable";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** True when the join asks for the review lobby (replay servers only). */
export function isReviewLobbyRequest(options: unknown): boolean {
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["reviewLobby"] on this Record.
  return isRecord(options) && options["reviewLobby"] === true;
}

/** Extract the select-station target ("" when missing/not a string). */
export function lobbySelectStationIdOf(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["stationId"] on this Record.
  const value = payload["stationId"];
  return typeof value === "string" ? value : "";
}

/**
 * Validate a lobby select against the loaded index plus the per-station
 * load result. Returns the station id when it may launch, else the reject
 * reason (unknown-station, or station-unavailable for a C11-failed trace).
 */
export function validateLobbySelect(replay: LoadedStationReplay, stationId: string): { ok: true } | { ok: false; reason: string } {
  if (stationId === "") {
    return { ok: false, reason: LOBBY_UNKNOWN_STATION_REASON };
  }
  if (replay.failures.has(stationId)) {
    return { ok: false, reason: LOBBY_STATION_UNAVAILABLE_REASON };
  }
  if (!replay.stations.has(stationId)) {
    return { ok: false, reason: LOBBY_UNKNOWN_STATION_REASON };
  }
  return { ok: true };
}

/** Fill a fresh EncounterState as a lobby: mode lobby, index stations in order. */
export function setupLobbyState(state: EncounterStateInstance, replay: LoadedStationReplay): void {
  state.serverTick = 0;
  state.turnId = 0;
  state.turnOwner = "none";
  state.observerCount = 0;
  state.phase = "";
  state.phaseRemainingS = 0;
  state.stationId = "";
  state.stationIndex = 0;
  state.stationCount = replay.lobbyStations.length;
  state.mode = "lobby";
  state.lastTurnEnd = "";
  state.replayDone = false;
  state.noteStatus = "none";
  state.noteChars = 0;
  state.sessionComplete = replay.complete;
  state.actors = new MapSchema<ActorStateInstance>();
  state.learners = new MapSchema<LearnerStateInstance>();
  state.lobbyStations = new ArraySchema<LobbyStationStateInstance>();
  for (const entry of replay.lobbyStations) {
    const row = new LobbyStationState();
    row.stationId = entry.stationId;
    row.stationIndex = entry.stationIndex;
    row.turnCount = entry.turnCount;
    row.notePresent = entry.notePresent;
    row.noteChars = entry.noteChars;
    state.lobbyStations.push(row);
  }
}

/**
 * Launch one station's replay for THIS client only: create a fresh replay
 * room for the station, reserve a seat carrying its replayStationId, and
 * send the reservation to that client as a rotate message (the client
 * consumes it like a C7 rotation: same SyncConnection, onState continues).
 * Never broadcasts: every other lobby client keeps its own lobby.
 */
export async function launchLobbyStationReplay(roomName: string, stationId: string, client: Client): Promise<void> {
  const next = await matchMaker.createRoom(roomName, { replayStationId: stationId });
  let reservation: unknown;
  try {
    reservation = await matchMaker.reserveSeatFor(next, { replayStationId: stationId });
  } catch {
    reservation = await matchMaker.reserveSeatFor(next, { replayStationId: stationId });
  }
  client.send("rotate", reservation);
}
