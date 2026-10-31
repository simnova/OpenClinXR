/**
 * C13 faculty rubric score for the xr-sync encounter server.
 *
 * Kept in its own module so station-replay.ts stays under the file-size gate.
 * After watching a station replay, a faculty reviewer ticks a rubric checklist
 * and submits: one "score-station" intent { items: { [rubricId]: boolean } }
 * per submit, last write wins. The score persists review-safe BESIDE the
 * replay directory (never inside it: the replay dir stays byte-identical),
 * following the C11 patient-note pattern (schema field, station id, counts;
 * no identity, no timestamps, no label text).
 *
 * Server config only (never roomOptions): createEncounterServer({ scoreDir,
 * reviewRubric: [{ id, label }] }). Without both, scoring rejects
 * "scoring-disabled". The lobby reads its score badges from disk when it
 * opens, so a new server over the same scoreDir shows earlier scores.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Schema tag written into every persisted faculty-score file. */
export const FACULTY_SCORE_SCHEMA = "openclinxr.xr-sync.faculty-score.v1";

/** Persisted-file name suffix for the faculty rubric score. */
export const FACULTY_SCORE_FILE_SUFFIX = ".faculty-score.json";

/** Reject reason when scoring is not configured (no scoreDir or no rubric). */
export const SCORING_DISABLED_REASON = "scoring-disabled";

/** Reject reason when the submitted items are not exactly the rubric booleans. */
export const INVALID_SCORE_REASON = "invalid-score";

/** Reject reason for a lobby select while a launch is already in flight. */
export const LAUNCH_PENDING_REASON = "launch-pending";

/** One rubric checklist entry (server config only). */
export interface ReviewRubricItem {
  id: string;
  label: string;
}

/** Per-server score binding closed over by the replay room class. */
export interface FacultyScoreBinding {
  scoreDir: string | null;
  rubric: ReviewRubricItem[] | null;
}

/** One lobby score badge: a station with a score file on disk. */
export interface LobbyScore {
  stationId: string;
  checkedCount: number;
}

/** Persisted faculty score (review-safe: no session id, no timestamps, no labels). */
export interface FacultyScoreFile {
  schema: string;
  stationId: string;
  items: { id: string; checked: boolean }[];
  checkedCount: number;
  rubricSize: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validate server score-dir config. Returns the dir when configured, null
 * when absent (scoring disabled, never an error). Throws on invalid (fail
 * fast at boot, never per intent).
 */
export function parseScoreDir(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value === "") {
    throw new Error("bad-score-dir: scoreDir must be a non-empty string");
  }
  return value;
}

/**
 * Validate server rubric config. Returns the rubric when configured, null
 * when absent (scoring disabled). Throws on invalid: entries need a
 * non-empty string id and a string label, ids must be unique.
 */
export function parseReviewRubric(value: unknown): ReviewRubricItem[] | null {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("bad-review-rubric: reviewRubric must be a non-empty array");
  }
  const seen = new Set<string>();
  const rubric: ReviewRubricItem[] = [];
  for (const entry of value) {
    // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["id"]/["label"] on this Record.
    if (!isRecord(entry) || typeof entry["id"] !== "string" || entry["id"] === "" || typeof entry["label"] !== "string") {
      throw new Error("bad-review-rubric: each entry needs { id: non-empty string, label: string }");
    }
    const id = entry["id"] as string;
    if (seen.has(id)) {
      throw new Error(`bad-review-rubric: duplicate rubric id ${id.slice(0, 64)}`);
    }
    seen.add(id);
    rubric.push({ id, label: entry["label"] as string });
  }
  return rubric;
}

/** Score file name for one station (beside, never inside, the replay dir). */
export function scoreFileName(stationId: string): string {
  return `${stationId}${FACULTY_SCORE_FILE_SUFFIX}`;
}

/**
 * Validate a score-station payload against the rubric. Returns the checked
 * flags in rubric order, or { reason: "invalid-score" }: items must be a
 * record of booleans whose key set is exactly the rubric id set (unknown ids
 * included, missing ids included, non-boolean values included).
 */
export function validateScoreItems(
  rubric: ReviewRubricItem[],
  payload: unknown,
): { ok: true; checked: boolean[] } | { ok: false; reason: string } {
  if (!isRecord(payload)) {
    return { ok: false, reason: INVALID_SCORE_REASON };
  }
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["items"] on this Record.
  const items = payload["items"];
  if (!isRecord(items) || Array.isArray(items)) {
    return { ok: false, reason: INVALID_SCORE_REASON };
  }
  const keys = Object.keys(items);
  if (keys.length !== rubric.length || !rubric.every((entry) => keys.includes(entry.id))) {
    return { ok: false, reason: INVALID_SCORE_REASON };
  }
  const checked: boolean[] = [];
  for (const entry of rubric) {
    // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates [entry.id] on this Record.
    const value = items[entry.id];
    if (typeof value !== "boolean") {
      return { ok: false, reason: INVALID_SCORE_REASON };
    }
    checked.push(value);
  }
  return { ok: true, checked };
}

/** Build the review-safe score file (rubric order; no identity, no timestamps, no labels). */
export function buildFacultyScore(stationId: string, rubric: ReviewRubricItem[], checked: boolean[]): FacultyScoreFile {
  return {
    schema: FACULTY_SCORE_SCHEMA,
    stationId,
    items: rubric.map((entry, index) => ({ id: entry.id, checked: checked[index] === true })),
    checkedCount: checked.filter((value) => value).length,
    rubricSize: rubric.length,
  };
}

/**
 * Best-effort score persistence: one <stationId>.faculty-score.json in
 * scoreDir (mkdir -p), written synchronously per accepted submit (last wins).
 * Failures never propagate; probe evidence must not break the ack path. The
 * caller acks only after this returns.
 */
export function writeFacultyScore(scoreDir: string, stationId: string, file: FacultyScoreFile): void {
  try {
    mkdirSync(scoreDir, { recursive: true });
    writeFileSync(join(scoreDir, scoreFileName(stationId)), `${JSON.stringify(file)}\n`, "utf8");
  } catch {
    // Probe evidence only.
  }
}

/**
 * Read one station's checked count from disk (0 when unscored or unreadable).
 * Used to seed replay-room scoreChecked when the reviewer re-opens a station.
 */
export function readScoreChecked(scoreDir: string | null, stationId: string): number {
  if (scoreDir === null) {
    return 0;
  }
  try {
    const parsed = JSON.parse(readFileSync(join(scoreDir, scoreFileName(stationId)), "utf8")) as { checkedCount?: unknown };
    return typeof parsed?.checkedCount === "number" ? parsed.checkedCount : 0;
  } catch {
    return 0;
  }
}

/**
 * Read the lobby score badges from disk, in index order: one entry per index
 * station with a readable score file. A new server over the same scoreDir
 * shows earlier scores; a missing or unreadable file means unscored.
 */
export function readLobbyScores(scoreDir: string | null, stationIds: string[]): LobbyScore[] {
  if (scoreDir === null) {
    return [];
  }
  const scores: LobbyScore[] = [];
  for (const stationId of stationIds) {
    try {
      const parsed = JSON.parse(readFileSync(join(scoreDir, scoreFileName(stationId)), "utf8")) as {
        checkedCount?: unknown;
      };
      if (typeof parsed?.checkedCount === "number") {
        scores.push({ stationId, checkedCount: parsed.checkedCount });
      }
    } catch {
      // Unscored or unreadable: no badge.
    }
  }
  return scores;
}

/** Reject reason every replay-room intent receives, unless it is a C13 review intent. */
export const REPLAY_READ_ONLY_REASON = "replay-read-only";

/** Narrow replay-room state surface the C13 review handler mutates. */
export interface ReplayReviewState {
  serverTick: number;
  scoreChecked: number;
  learners: { get(id: string): { lastSeq: number } | undefined };
}

/**
 * C13 replay-room intent gate: return-to-lobby and score-station are allowed;
 * every other intent still rejects replay-read-only. Acked intents advance
 * the learner cursor like the C12 lobby select. The lobby launch runs through
 * the caller's callback (same rotate mechanism as the C12 launch).
 */
export function handleReplayReviewIntent(
  state: ReplayReviewState,
  score: FacultyScoreBinding,
  stationId: string,
  client: { sessionId: string; send(type: string, message: unknown): void },
  message: unknown,
  launchLobby: (onFailed: () => void) => void,
): void {
  if (!isRecord(message)) {
    client.send("reject", { seq: 0, reason: REPLAY_READ_ONLY_REASON });
    return;
  }
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["seq"] on this Record.
  const seq = Number.isInteger(message["seq"]) ? (message["seq"] as number) : 0;
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["kind"] on this Record.
  const kind = message["kind"];
  if (kind === "return-to-lobby") {
    const learner = state.learners.get(client.sessionId);
    if (learner) {
      learner.lastSeq = seq;
    }
    state.serverTick += 1;
    client.send("ack", { seq, serverTs: Date.now() });
    launchLobby(() => undefined);
    return;
  }
  if (kind === "score-station") {
    if (score.scoreDir === null || score.rubric === null) {
      client.send("reject", { seq, reason: SCORING_DISABLED_REASON });
      return;
    }
    // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["payload"] on this Record.
    const verdict = validateScoreItems(score.rubric, message["payload"]);
    if (!verdict.ok) {
      client.send("reject", { seq, reason: verdict.reason });
      return;
    }
    const file = buildFacultyScore(stationId, score.rubric, verdict.checked);
    writeFacultyScore(score.scoreDir, stationId, file);
    state.scoreChecked = file.checkedCount;
    const learner = state.learners.get(client.sessionId);
    if (learner) {
      learner.lastSeq = seq;
    }
    state.serverTick += 1;
    client.send("ack", { seq, serverTs: Date.now() });
    return;
  }
  client.send("reject", { seq, reason: REPLAY_READ_ONLY_REASON });
}
