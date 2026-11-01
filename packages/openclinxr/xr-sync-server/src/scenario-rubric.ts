/**
 * C20 per-station scenario review rubric for the xr-sync encounter server.
 *
 * Kept in its own module so station-replay.ts stays under the file-size
 * gate. On a replay server booted with a scenarios bank, each replayed
 * station is scored against ITS scenario's reviewRubric (resolved via the
 * C18 trace scenarioId), not one server-wide rubric: rubric ids =
 * reviewRubric[].rubricId in scenario order. Replay state carries
 * replayRubric [{ id, label }] for the station being replayed ([] when the
 * station's scenario is not in the bank) so the headset can show the
 * checklist. Score files gain scenarioId with items in scenario rubric
 * order; no label text ever reaches a persisted file (C13 rule). A station
 * whose scenarioId is not in the bank rejects score-station
 * "scoring-disabled". Without scenarios, the C13 path is unchanged.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildFacultyScore,
  type FacultyScoreBinding,
  type FacultyScoreFile,
  isValidFacultyScoreFile,
  type LobbyScore,
  type ReviewRubricItem,
  SCORE_WRITE_FAILED_REASON,
  SCORING_DISABLED_REASON,
  validateScoreItems,
  writeFacultyScore,
} from "./faculty-score.js";
import { REVIEW_PACKET_SCHEMA, type ReviewPacketFile, readPacketNoteText } from "./review-packet-file.js";
import type { LoadedStationReplay } from "./station-replay-loading.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validate the replay-server scenarios bank: an array of scenarios with a
 * unique non-empty scenarioId and a non-empty reviewRubric of unique
 * rubricIds ([{ rubricId, label }]). Every refusal names "scenarios" (the
 * C16 live-server rule "scenarios require examBlueprint" does not apply on a
 * replay server: scenarios is a bank keyed by scenarioId, never a slot cast).
 * Returns the bank as scenarioId -> rubric items (server config only).
 */
export function parseScenarioRubricBank(value: unknown): Map<string, ReviewRubricItem[]> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("bad-scenarios: scenarios must be a non-empty array of scenarios with a reviewRubric");
  }
  const bank = new Map<string, ReviewRubricItem[]>();
  value.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry["scenarioId"] !== "string" || (entry["scenarioId"] as string) === "") {
      throw new Error(`bad-scenarios: scenarios[${index}].scenarioId must be a non-empty string`);
    }
    const scenarioId = entry["scenarioId"] as string;
    if (bank.has(scenarioId)) {
      throw new Error(`bad-scenarios: duplicate scenarioId ${scenarioId.slice(0, 64)}`);
    }
    const reviewRubric = entry["reviewRubric"];
    if (!Array.isArray(reviewRubric) || reviewRubric.length === 0) {
      throw new Error(`bad-scenarios: scenarios[${index}] (${scenarioId.slice(0, 64)}) reviewRubric must be a non-empty array`);
    }
    const seen = new Set<string>();
    const rubric: ReviewRubricItem[] = [];
    for (const item of reviewRubric) {
      if (!isRecord(item) || typeof item["rubricId"] !== "string" || (item["rubricId"] as string) === "" || typeof item["label"] !== "string") {
        throw new Error(
          `bad-scenarios: scenarios[${index}] (${scenarioId.slice(0, 64)}) reviewRubric entries need { rubricId: non-empty string, label: string }`,
        );
      }
      const id = item["rubricId"] as string;
      if (seen.has(id)) {
        throw new Error(`bad-scenarios: scenarios[${index}] (${scenarioId.slice(0, 64)}) duplicate rubricId ${id.slice(0, 64)}`);
      }
      seen.add(id);
      const requiredTraceTags = item["requiredTraceTags"];
      if (!Array.isArray(requiredTraceTags) || requiredTraceTags.some((tag) => typeof tag !== "string")) {
        throw new Error(`bad-scenarios: scenarios[${index}] (${scenarioId.slice(0, 64)}) reviewRubric entries need requiredTraceTags: string[]`);
      }
      rubric.push({ id, label: item["label"] as string, requiredTraceTags: [...requiredTraceTags] as string[] });
    }
    bank.set(scenarioId, rubric);
  });
  return bank;
}

/** The bank rubric for one trace scenarioId, or null when not in the bank. */
export function rubricForScenario(bank: Map<string, ReviewRubricItem[]> | null, scenarioId: string): ReviewRubricItem[] | null {
  if (bank === null || scenarioId === "") {
    return null;
  }
  return bank.get(scenarioId) ?? null;
}

/**
 * One replayed station's scenario rubric: the C18 trace scenarioId resolved
 * against the bank. Null when there is no bank or the station's scenario is
 * not in it (the room then carries an empty replayRubric and scoring stays
 * disabled for that station).
 */
export function stationScenarioRubric(
  replay: LoadedStationReplay | null,
  bank: Map<string, ReviewRubricItem[]> | null | undefined,
  stationId: string,
): { scenarioId: string; rubric: ReviewRubricItem[] } | null {
  if (replay === null || bank === null || bank === undefined) {
    return null;
  }
  const station = replay.stations.get(stationId);
  if (station === undefined) {
    return null;
  }
  const rubric = rubricForScenario(bank, station.scenarioId);
  if (rubric === null) {
    return null;
  }
  return { scenarioId: station.scenarioId, rubric };
}

/** True when this replay server scores per-station scenario rubrics (C20 bank mode). */
export function isScenarioRubricBinding(score: FacultyScoreBinding): boolean {
  return score.scenarioRubrics !== null && score.scenarioRubrics !== undefined;
}

/**
 * One validated scenario score file, or null when missing, unreadable, or
 * forged (same strictness as the C13/C14 validator, plus the scenarioId must
 * name the station's own scenario).
 */
export function readValidScenarioScoreFile(
  scoreDir: string,
  stationId: string,
  scenarioId: string,
  rubric: ReviewRubricItem[],
): FacultyScoreFile | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(scoreDir, `${stationId}.faculty-score.json`), "utf8"));
    if (!isValidFacultyScoreFile(parsed, stationId, rubric)) {
      return null;
    }
    if (!isRecord(parsed) || parsed["scenarioId"] !== scenarioId) {
      return null;
    }
    return parsed as FacultyScoreFile;
  } catch {
    return null;
  }
}

/**
 * Strict lobby badges in index order against EACH station's own scenario
 * rubric (a forged file or a station outside the bank shows no badge).
 * resolveRubric maps a station id to its scenario rubric (null when the
 * station's scenario is not in the bank).
 */
export function readScenarioLobbyScores(
  scoreDir: string | null,
  stationIds: string[],
  resolveRubric: (stationId: string) => { scenarioId: string; rubric: ReviewRubricItem[] } | null,
): LobbyScore[] {
  if (scoreDir === null) {
    return [];
  }
  const scores: LobbyScore[] = [];
  for (const stationId of stationIds) {
    const resolved = resolveRubric(stationId);
    if (resolved === null) {
      continue;
    }
    const file = readValidScenarioScoreFile(scoreDir, stationId, resolved.scenarioId, resolved.rubric);
    if (file !== null) {
      scores.push({ stationId, checkedCount: file.checkedCount });
    }
  }
  return scores;
}

/**
 * Build the review packet against EACH station's own scenario rubric (index
 * order; note files from replayDir; validated score files from scoreDir).
 * Returns scoring-disabled without config, review-incomplete when any index
 * station lacks a valid scenario score file. totalPossible is the SUM of the
 * per-station rubric sizes (stations may carry different checklists: the C14
 * packet field that changes under C20).
 */
export function buildScenarioReviewPacket(
  replayDir: string,
  replay: LoadedStationReplay,
  scoreDir: string,
  resolveRubric: (stationId: string) => { scenarioId: string; rubric: ReviewRubricItem[] } | null,
): { ok: true; packet: ReviewPacketFile } | { ok: false; reason: string } {
  const stations: ReviewPacketFile["stations"] = [];
  let totalChecked = 0;
  let totalPossible = 0;
  for (const lobby of replay.lobbyStations) {
    const station = replay.stations.get(lobby.stationId);
    const resolved = resolveRubric(lobby.stationId);
    if (station === undefined || resolved === null) {
      return { ok: false, reason: "review-incomplete" };
    }
    const file = readValidScenarioScoreFile(scoreDir, lobby.stationId, resolved.scenarioId, resolved.rubric);
    if (file === null) {
      return { ok: false, reason: "review-incomplete" };
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
    totalPossible += resolved.rubric.length;
  }
  return {
    ok: true,
    packet: {
      schema: REVIEW_PACKET_SCHEMA,
      sessionComplete: replay.complete,
      stationCount: replay.lobbyStations.length,
      stations,
      totalChecked,
      totalPossible,
    },
  };
}

/** Packet persistence for the scenario path (same file, same mkdir -p write). */
export function writeScenarioReviewPacket(scoreDir: string, packet: ReviewPacketFile): boolean {
  try {
    mkdirSync(scoreDir, { recursive: true });
    writeFileSync(join(scoreDir, "exam-session.review-packet.json"), `${JSON.stringify(packet)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/** Narrow replay-room state surface the C20 score handler mutates. */
export interface ScenarioReviewState {
  serverTick: number;
  scoreChecked: number;
  learners: { get(id: string): { lastSeq: number } | undefined };
}

/**
 * C20 replay-room score-station handler: validates the items key set against
 * the STATION's own scenario rubric ("invalid-score" otherwise; a null rubric
 * means the station's scenario is not in the bank: "scoring-disabled"). The
 * score file gains scenarioId with items in scenario rubric order; no label
 * text is persisted (C13 rule). Last write wins, like the C13 path.
 */
export function handleScenarioScoreIntent(
  state: ScenarioReviewState,
  scoreDir: string,
  stationId: string,
  scenarioId: string,
  rubric: ReviewRubricItem[] | null,
  client: { sessionId: string; send(type: string, message: unknown): void },
  message: unknown,
): void {
  if (!isRecord(message)) {
    client.send("reject", { seq: 0, reason: SCORING_DISABLED_REASON });
    return;
  }
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["seq"] on this Record.
  const seq = Number.isInteger(message["seq"]) ? (message["seq"] as number) : 0;
  if (scoreDir === "" || rubric === null) {
    client.send("reject", { seq, reason: SCORING_DISABLED_REASON });
    return;
  }
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["payload"] on this Record.
  const verdict = validateScoreItems(rubric, message["payload"]);
  if (!verdict.ok) {
    client.send("reject", { seq, reason: verdict.reason });
    return;
  }
  const file = buildFacultyScore(stationId, rubric, verdict.checked, scenarioId);
  if (!writeFacultyScore(scoreDir, stationId, file)) {
    client.send("reject", { seq, reason: SCORE_WRITE_FAILED_REASON });
    return;
  }
  state.scoreChecked = file.checkedCount;
  const learner = state.learners.get(client.sessionId);
  if (learner) {
    learner.lastSeq = seq;
  }
  state.serverTick += 1;
  client.send("ack", { seq, serverTs: Date.now() });
}
