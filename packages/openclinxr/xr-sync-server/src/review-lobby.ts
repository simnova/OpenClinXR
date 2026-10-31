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
  LobbyScoreState,
  LobbyStationState,
  type ActorStateInstance,
  type EncounterStateInstance,
  type LearnerStateInstance,
  type LobbyScoreStateInstance,
  type LobbyStationStateInstance,
} from "./schema.js";
import type { LoadedStationReplay } from "./station-replay.js";
import { LAUNCH_PENDING_REASON, type LobbyScore } from "./faculty-score.js";

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

/** Fill a fresh EncounterState as a lobby: mode lobby, index stations in order. Scores are read from disk by the caller when the lobby opens (a new server over the same scoreDir shows earlier scores); reviewFinalized is true when the packet is already on disk. */
export function setupLobbyState(state: EncounterStateInstance, replay: LoadedStationReplay, scores: LobbyScore[] = [], reviewFinalized = false): void {
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
  // C13 score badges, in index order. lobbyStations rows are unchanged (no
  // score fields on them); reviewers read badges from lobbyScores. C14: the
  // finalized flag mirrors the packet on disk.
  state.lobbyScores = new ArraySchema<LobbyScoreStateInstance>();
  for (const score of scores) {
    const badge = new LobbyScoreState();
    badge.stationId = score.stationId;
    badge.checkedCount = score.checkedCount;
    state.lobbyScores.push(badge);
  }
  state.reviewFinalized = reviewFinalized;
  state.scoreChecked = 0;
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

/**
 * C13 return-to-lobby: open a fresh lobby room for THIS client only and send
 * it via the same rotate mechanism as the C12 launch (one mechanism, no
 * second path). The fresh lobby reads its score badges from disk, so scores
 * submitted in the replay just left are visible on return.
 */
export async function launchReplayReturnToLobby(roomName: string, client: Client): Promise<void> {
  const next = await matchMaker.createRoom(roomName, { reviewLobby: true });
  let reservation: unknown;
  try {
    reservation = await matchMaker.reserveSeatFor(next, { reviewLobby: true });
  } catch {
    reservation = await matchMaker.reserveSeatFor(next, { reviewLobby: true });
  }
  client.send("rotate", reservation);
}

/** Narrow room surface the lobby select handler mutates. */
export interface LobbySelectRoom {
  state: EncounterStateInstance;
  launchPending: boolean;
  replay: LoadedStationReplay | null;
}

/**
 * C12 lobby intent gate (moved here from station-replay.ts for the file-size
 * gate; same behaviour plus the C13 launch-pending carry-over): select-station
 * validates + launches, everything else rejects lobby-read-only. A lobby
 * launches at most once: a select while a launch is in flight rejects
 * launch-pending (two concurrent selects settle exactly one ack). The launch
 * callback performs the rotate send; onFailed runs when it throws (the flag
 * resets so the reviewer can retry, and the client sees rotation-failed).
 */
export function handleLobbySelectIntent(
  room: LobbySelectRoom,
  client: Client,
  message: unknown,
  launch: (stationId: string, onFailed: () => void) => void,
): void {
  if (!isRecord(message)) {
    client.send("reject", { seq: 0, reason: LOBBY_READ_ONLY_REASON });
    return;
  }
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["seq"] on this Record.
  const seq = Number.isInteger(message["seq"]) ? (message["seq"] as number) : 0;
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["kind"] on this Record.
  const kind = message["kind"];
  if (kind !== "select-station") {
    client.send("reject", { seq, reason: LOBBY_READ_ONLY_REASON });
    return;
  }
  if (room.launchPending) {
    client.send("reject", { seq, reason: LAUNCH_PENDING_REASON });
    return;
  }
  const replay = room.replay;
  if (replay === null) {
    client.send("reject", { seq, reason: LOBBY_UNKNOWN_STATION_REASON });
    return;
  }
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["payload"] on this Record.
  const stationId = lobbySelectStationIdOf(message["payload"]);
  const verdict = validateLobbySelect(replay, stationId);
  if (!verdict.ok) {
    client.send("reject", { seq, reason: verdict.reason });
    return;
  }
  room.launchPending = true;
  const learner = room.state.learners.get(client.sessionId);
  if (learner) {
    learner.lastSeq = seq;
  }
  room.state.serverTick += 1;
  client.send("ack", { seq, serverTs: Date.now() });
  // Launch THIS client's replay only (never a broadcast): the client
  // consumes the seat like a C7 rotation on the same connection.
  launch(stationId, () => {
    room.launchPending = false;
  });
}
