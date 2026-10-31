/**
 * C14 faculty review sign-off for the xr-sync encounter server.
 *
 * Kept in its own module so station-replay.ts stays under the file-size
 * gate. Once every index station carries a valid faculty score, the reviewer
 * signs off from the lobby with a finalize-review intent: the server writes
 * ONE review-safe exam-session.review-packet.json into scoreDir (index rows
 * in index order with note text + scores, session completion, totals; no
 * session id, no rubric labels, no timestamps) and locks the scores. The
 * lobby reads its reviewFinalized flag from disk when it opens, so a new
 * server over the same scoreDir shows the finalized review.
 *
 * Guards (reject reasons are the contract):
 *   scoring-disabled: no scoreDir or no reviewRubric (lobby finalize only;
 *     replay rooms answer scoring-disabled from the C13 score path).
 *   review-incomplete: any index station without a valid score file (strict:
 *     the same validator as the lobby badges — checkedCount agrees with
 *     items, stationId names its own station, items match the rubric ids in
 *     rubric order).
 *   review-finalized: the packet already exists (finalize again, or
 *     score-station after sign-off; score files stay unchanged).
 *   replay-read-only: finalize in a replay room (the C13 default: only
 *     return-to-lobby and score-station are allowed there).
 *   launch-pending: a second return-to-lobby while one is in flight
 *     (one launch per replay room, mirroring the C12/C13 lobby guard).
 */
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Client } from "@colyseus/core";
import {
  isValidFacultyScoreFile,
  LAUNCH_PENDING_REASON,
  SCORE_WRITE_FAILED_REASON,
  SCORING_DISABLED_REASON,
  scoreFileName,
  type FacultyScoreBinding,
  type FacultyScoreFile,
  type LobbyScore,
  type ReviewRubricItem,
} from "./faculty-score.js";
import { PATIENT_NOTE_SCHEMA } from "./patient-note.js";
import { handleLobbySelectIntent, launchLobbyStationReplay, launchReplayReturnToLobby, type LobbySelectRoom } from "./review-lobby.js";
import type { EncounterStateInstance } from "./schema.js";
import type { LoadedStationReplay } from "./station-replay-loading.js";
import { buildScenarioReviewPacket, writeScenarioReviewPacket } from "./scenario-rubric.js";

/** Schema tag written into the persisted faculty review packet. */
export const REVIEW_PACKET_SCHEMA = "openclinxr.xr-sync.faculty-review-packet.v1";

/** Packet file name inside scoreDir (one per reviewed session). */
export const REVIEW_PACKET_FILE = "exam-session.review-packet.json";

/** Reject reason when an index station has no valid score file yet. */
export const REVIEW_INCOMPLETE_REASON = "review-incomplete";

/** Reject reason once the packet exists (finalize again, or score after sign-off). */
export const REVIEW_FINALIZED_REASON = "review-finalized";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** One packet station row: the index row plus note text and the score. */
export interface ReviewPacketStation {
  stationId: string;
  stationIndex: number;
  turnCount: number;
  turnEnds: string[];
  notePresent: boolean;
  noteText: string | null;
  score: { items: { id: string; checked: boolean }[]; checkedCount: number; rubricSize: number };
}

/** Persisted faculty review packet (review-safe: no identity, no labels, no timestamps). */
export interface ReviewPacketFile {
  schema: string;
  sessionComplete: boolean;
  stationCount: number;
  stations: ReviewPacketStation[];
  totalChecked: number;
  totalPossible: number;
}

/**
 * True when the review packet exists in scoreDir (read from disk, never from
 * memory: a new server over the same scoreDir shows the finalized review).
 */
export function isReviewFinalized(scoreDir: string | null): boolean {
  if (scoreDir === null) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(scoreDir, REVIEW_PACKET_FILE), "utf8"));
    // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["schema"] on this Record.
    return isRecord(parsed) && parsed["schema"] === REVIEW_PACKET_SCHEMA;
  } catch {
    return false;
  }
}

/** One validated score file, or null when missing, unreadable, or forged. */
export function readValidScoreFile(
  scoreDir: string,
  stationId: string,
  rubric: ReviewRubricItem[],
): FacultyScoreFile | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(scoreDir, scoreFileName(stationId)), "utf8"));
    return isValidFacultyScoreFile(parsed, stationId, rubric) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Strict lobby badges in index order (same validator as finalize: forged
 * files are ignored — no badge, and they do not count toward sign-off).
 */
export function readValidLobbyScores(
  scoreDir: string | null,
  stationIds: string[],
  rubric: ReviewRubricItem[] | null,
): LobbyScore[] {
  if (scoreDir === null || rubric === null) {
    return [];
  }
  const scores: LobbyScore[] = [];
  for (const stationId of stationIds) {
    const file = readValidScoreFile(scoreDir, stationId, rubric);
    if (file !== null) {
      scores.push({ stationId, checkedCount: file.checkedCount });
    }
  }
  return scores;
}

/**
 * Note text for one packet row: the patient-note file text when the index
 * says the station noted, else null. Unreadable or mistagged files read as
 * null (the score, not the note prose, gates sign-off).
 */
export function readPacketNoteText(replayDir: string, stationId: string, noteFile: string | null): string | null {
  if (noteFile === null || noteFile === "") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(replayDir, noteFile), "utf8"));
    if (!isRecord(parsed)) {
      return null;
    }
    // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["schema"] on this Record.
    const tagged = parsed["schema"] === PATIENT_NOTE_SCHEMA && parsed["stationId"] === stationId;
    // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["text"] on this Record.
    return tagged && typeof parsed["text"] === "string" ? (parsed["text"] as string) : null;
  } catch {
    return null;
  }
}

/**
 * Build the review packet from the loaded replay (index order), the note
 * files in replayDir, and the validated score files in scoreDir. Returns
 * scoring-disabled without config, review-incomplete when any index station
 * lacks a valid score file.
 */
export function buildReviewPacket(
  replayDir: string,
  replay: LoadedStationReplay,
  score: FacultyScoreBinding,
): { ok: true; packet: ReviewPacketFile } | { ok: false; reason: string } {
  if (score.scoreDir === null || score.rubric === null) {
    return { ok: false, reason: SCORING_DISABLED_REASON };
  }
  const stations: ReviewPacketStation[] = [];
  let totalChecked = 0;
  for (const lobby of replay.lobbyStations) {
    const station = replay.stations.get(lobby.stationId);
    const file = readValidScoreFile(score.scoreDir, lobby.stationId, score.rubric);
    if (station === undefined || file === null) {
      return { ok: false, reason: REVIEW_INCOMPLETE_REASON };
    }
    const noteFile = typeof station.entry.noteFile === "string" ? station.entry.noteFile : null;
    stations.push({
      stationId: lobby.stationId,
      stationIndex: lobby.stationIndex,
      turnCount: station.turns.length,
      turnEnds: station.turns.map((turn) => turn.end),
      notePresent: station.entry.notePresent === true,
      noteText: station.entry.notePresent === true ? readPacketNoteText(replayDir, lobby.stationId, noteFile) : null,
      score: { items: file.items, checkedCount: file.checkedCount, rubricSize: file.rubricSize },
    });
    totalChecked += file.checkedCount;
  }
  return {
    ok: true,
    packet: {
      schema: REVIEW_PACKET_SCHEMA,
      sessionComplete: replay.complete,
      stationCount: replay.lobbyStations.length,
      stations,
      totalChecked,
      totalPossible: replay.lobbyStations.length * score.rubric.length,
    },
  };
}

/**
 * Packet persistence: one exam-session.review-packet.json in scoreDir
 * (mkdir -p), written synchronously at sign-off. Returns false when the
 * write fails; the caller then rejects score-write-failed so a reviewer is
 * never told a sign-off landed when it did not.
 */
export function writeReviewPacket(scoreDir: string, packet: ReviewPacketFile): boolean {
  try {
    mkdirSync(scoreDir, { recursive: true });
    writeFileSync(join(scoreDir, REVIEW_PACKET_FILE), `${JSON.stringify(packet)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

function seqOf(message: unknown): number {
  if (!isRecord(message)) {
    return 0;
  }
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["seq"] on this Record.
  return Number.isInteger(message["seq"]) ? (message["seq"] as number) : 0;
}

function kindOf(message: unknown): string {
  if (!isRecord(message)) {
    return "";
  }
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["kind"] on this Record.
  return typeof message["kind"] === "string" ? (message["kind"] as string) : "";
}

/**
 * Lobby finalize handler: every index station scored -> write the packet,
 * mark the lobby finalized, ack. Scoring-disabled without config, a reject
 * when any station is unscored (no packet), a reject when already signed
 * off. The finalized flag lands in state BEFORE the ack so the next
 * snapshot already carries it.
 *
 * C20: pass resolveScenarioRubric on a scenarios-bank server to validate
 * each station against its own scenario rubric (the packet's totalPossible
 * is then the sum of the per-station rubric sizes); omit it for the C13/C14
 * single-rubric path (unchanged).
 */
export function handleLobbyFinalizeIntent(
  state: EncounterStateInstance,
  score: FacultyScoreBinding,
  replay: LoadedStationReplay | null,
  replayDir: string | null,
  client: Client,
  message: unknown,
  resolveScenarioRubric?: (stationId: string) => { scenarioId: string; rubric: ReviewRubricItem[] } | null,
): void {
  const seq = seqOf(message);
  if (score.scoreDir === null || replay === null || replayDir === null) {
    client.send("reject", { seq, reason: SCORING_DISABLED_REASON });
    return;
  }
  if (resolveScenarioRubric === undefined && score.rubric === null) {
    client.send("reject", { seq, reason: SCORING_DISABLED_REASON });
    return;
  }
  if (isReviewFinalized(score.scoreDir)) {
    client.send("reject", { seq, reason: REVIEW_FINALIZED_REASON });
    return;
  }
  if (resolveScenarioRubric !== undefined) {
    const built = buildScenarioReviewPacket(replayDir, replay, score.scoreDir, resolveScenarioRubric);
    if (!built.ok) {
      client.send("reject", { seq, reason: built.reason });
      return;
    }
    if (!writeScenarioReviewPacket(score.scoreDir, built.packet)) {
      client.send("reject", { seq, reason: SCORE_WRITE_FAILED_REASON });
      return;
    }
    const learner = state.learners.get(client.sessionId);
    if (learner) {
      learner.lastSeq = seq;
    }
    state.serverTick += 1;
    state.reviewFinalized = true;
    client.send("ack", { seq, serverTs: Date.now() });
    return;
  }
  const built = buildReviewPacket(replayDir, replay, score);
  if (!built.ok) {
    client.send("reject", { seq, reason: built.reason });
    return;
  }
  if (!writeReviewPacket(score.scoreDir, built.packet)) {
    client.send("reject", { seq, reason: SCORE_WRITE_FAILED_REASON });
    return;
  }
  const learner = state.learners.get(client.sessionId);
  if (learner) {
    learner.lastSeq = seq;
  }
  state.serverTick += 1;
  state.reviewFinalized = true;
  client.send("ack", { seq, serverTs: Date.now() });
}

/**
 * C14 lobby intent gate: finalize-review signs off (see above); everything
 * else runs the C12 select gate verbatim (select-station launches, all other
 * intents reject lobby-read-only, one launch per lobby).
 */
export function handleLobbyIntentWithFinalize(
  room: LobbySelectRoom,
  score: FacultyScoreBinding,
  replayDir: string | null,
  client: Client,
  message: unknown,
  launch: (stationId: string, onFailed: () => void) => void,
  resolveScenarioRubric?: (stationId: string) => { scenarioId: string; rubric: ReviewRubricItem[] } | null,
): void {
  if (kindOf(message) === "finalize-review") {
    handleLobbyFinalizeIntent(room.state, score, room.replay, replayDir, client, message, resolveScenarioRubric);
    return;
  }
  handleLobbySelectIntent(room, client, message, launch);
}

/** Per-replay-room C14 guard: a lobby is launched back at most once. */
export interface ReplayRoomGuard {
  returnPending: boolean;
}

/**
 * C14 replay-room intent pre-gate (runs before the C13 review handler):
 * a second return-to-lobby while one is in flight rejects launch-pending
 * (and claims the guard for the first); a score-station after sign-off
 * rejects review-finalized with the score files untouched. Returns true
 * when a reject was sent (the caller returns without touching state).
 */
export function rejectReplayGuardedIntent(
  guard: ReplayRoomGuard,
  score: FacultyScoreBinding,
  client: Client,
  message: unknown,
): boolean {
  const kind = kindOf(message);
  if (kind === "") {
    return false;
  }
  const seq = seqOf(message);
  if (kind === "return-to-lobby") {
    if (guard.returnPending) {
      client.send("reject", { seq, reason: LAUNCH_PENDING_REASON });
      return true;
    }
    guard.returnPending = true;
    return false;
  }
  if (kind === "score-station" && isReviewFinalized(score.scoreDir)) {
    client.send("reject", { seq, reason: REVIEW_FINALIZED_REASON });
    return true;
  }
  return false;
}

/**
 * C14 boot guard: the score packet lives BESIDE the replay directory, never
 * equal to or inside it (the replay dir stays byte-identical). Throws a
 * named error; createEncounterServer rejects. C15: paths are compared by
 * real path (realpathSync for paths that exist, resolve otherwise), so a
 * scoreDir that is a symlink resolving inside replayDir is refused too.
 */
export function assertScoreDirOutsideReplayDir(replayDir: string | null, scoreDir: string | null): void {
  if (replayDir === null || scoreDir === null) {
    return;
  }
  const canonical = (candidate: string): string => {
    try {
      return realpathSync(candidate);
    } catch {
      return resolve(candidate);
    }
  };
  const resolved = canonical(scoreDir);
  const base = canonical(replayDir);
  if (resolved === base || resolved.startsWith(`${base}${sep}`)) {
    throw new Error(`bad-score-dir: scoreDir must not equal or sit inside replayDir`);
  }
}

/**
 * Launch one station's replay for THIS client only (the C12 rotate seat:
 * one mechanism, never a broadcast). Resets the caller's launch flag when
 * the seat fails so the reviewer can retry.
 */
export function launchLobbyReplayFor(roomName: string, stationId: string, client: Client, onFailed: () => void): void {
  void launchLobbyStationReplay(roomName, stationId, client).catch(() => {
    onFailed();
    try {
      client.send("rotation-failed", { stationId });
    } catch {
      // Best-effort; the ack already settled the intent.
    }
  });
}

/**
 * Return THIS client to a fresh lobby (the same rotate mechanism as the C12
 * launch). Frees the replay-room return guard when the seat fails so the
 * reviewer can retry; a second return while one is in flight never gets
 * here (the pre-gate above rejects it launch-pending).
 */
export function launchReplayReturnFor(
  roomName: string,
  guard: ReplayRoomGuard,
  stationId: string,
  client: Client,
  onFailed: () => void,
): void {
  void launchReplayReturnToLobby(roomName, client).catch(() => {
    guard.returnPending = false;
    onFailed();
    try {
      client.send("rotation-failed", { stationId });
    } catch {
      // Best-effort; the ack already settled the intent.
    }
  });
}
