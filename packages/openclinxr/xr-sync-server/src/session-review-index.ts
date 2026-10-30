/**
 * C9 exam session review index for the xr-sync encounter server.
 *
 * Kept in its own module so room.ts stays under the file-size gate. When an
 * exam session ends, the server writes one review-safe index linking each
 * station's persisted conversation trace: the faculty reviewer opens the
 * index, not the live rooms.
 *
 * Write rule (write-once per server session):
 *   - stations configured + traceDir set: when the LAST station reaches
 *     "closed", write <traceDir>/exam-session.review-index.json with
 *     complete true and one entry per station, in station order;
 *   - when a rotation fails terminally (every connected learner failed its
 *     seat reservation), write the index with complete false and only the
 *     stations that ran;
 *   - no stations, or persistence disabled, means no index (C6 behaviour).
 *
 * One source: every entry is derived from the same ConversationTracer
 * snapshot the room persists (phases from its phase-changed events, turnCount
 * / turnEnds from its turns, observerPresent from its observer-joined
 * events). Nothing is recomputed from config. Each station's data is HELD in
 * the per-server collector at its own close: the rotated-out room may
 * dispose (persisting its trace file) before the last station closes, so the
 * index cannot rely on live rooms. The live room's trace is flushed to disk
 * BEFORE the index is written, so every entry's traceFile already exists.
 *
 * Review-safe by construction: entries carry only station ids, the trace
 * basename, phase names, turn ends, counts, and presence booleans. No
 * session id, no rotation nonce, no timestamp, no reply text ever enters.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONVERSATION_TRACE_FILE_SUFFIX,
  type ConversationTrace,
} from "./conversation-trace.js";
import {
  driveRoomRotation,
  type RotationLearner,
  type StationBinding,
} from "./station-rotation.js";

/** Schema tag written into every exam session review index file. */
export const SESSION_REVIEW_INDEX_SCHEMA = "openclinxr.xr-sync.exam-session-review-index.v1";
/** Index file name inside the server trace directory (one per server session). */
export const SESSION_REVIEW_INDEX_FILE = "exam-session.review-index.json";

/** One station's review entry: a link to its trace plus the copied fields. */
export interface SessionReviewStationEntry {
  stationId: string;
  stationIndex: number;
  /** Basename of the station's <roomId>.conversation-trace.json in traceDir. */
  traceFile: string;
  /** Phase names from the trace's phase-changed events, in order. */
  phases: string[];
  turnCount: number;
  /** Per-turn end states from the trace's turns, in order. */
  turnEnds: string[];
  /** True when the station trace holds an observer-joined event. */
  observerPresent: boolean;
}

/** Persisted exam session review index (review-safe: no identity, no text). */
export interface SessionReviewIndex {
  schema: string;
  complete: boolean;
  stationCount: number;
  stations: SessionReviewStationEntry[];
}

/** Per-server held review data: one entry per station that has closed. */
export interface SessionReviewCollector {
  entries: Map<number, SessionReviewStationEntry>;
  written: boolean;
}

/** Lazily attach the review collector to a per-server station binding. */
export function collectorFor(binding: StationBinding): SessionReviewCollector {
  if (!binding.review) {
    binding.review = { entries: new Map(), written: false };
  }
  return binding.review;
}

/**
 * Derive one station's review entry from the same tracer snapshot the room
 * persists. Phases, turn ends, and presence are COPIES of trace fields, so
 * the index and the trace agree by construction.
 */
export function stationReviewFromTrace(
  stationId: string,
  stationIndex: number,
  roomId: string,
  trace: ConversationTrace,
): SessionReviewStationEntry {
  return {
    stationId,
    stationIndex,
    traceFile: `${roomId}${CONVERSATION_TRACE_FILE_SUFFIX}`,
    phases: trace.events.filter((event) => event.kind === "phase-changed").map((event) => event.phase ?? ""),
    turnCount: trace.turns.length,
    turnEnds: trace.turns.map((turn) => turn.end),
    observerPresent: trace.events.some((event) => event.kind === "observer-joined"),
  };
}

/** Assemble the persisted index: entries in station order. */
export function buildSessionReviewIndex(
  stations: string[],
  entries: Map<number, SessionReviewStationEntry>,
  complete: boolean,
): SessionReviewIndex {
  const ordered = [...entries.values()].sort((a, b) => a.stationIndex - b.stationIndex);
  return {
    schema: SESSION_REVIEW_INDEX_SCHEMA,
    complete,
    stationCount: stations.length,
    stations: ordered.map((entry) => ({ ...entry, phases: [...entry.phases], turnEnds: [...entry.turnEnds] })),
  };
}

/**
 * Best-effort index persistence: mkdir -p, one
 * <traceDir>/exam-session.review-index.json. Failures never propagate; the
 * room must close cleanly even when evidence cannot be written.
 */
export function writeSessionReviewIndexFile(traceDir: string, index: SessionReviewIndex): void {
  try {
    mkdirSync(traceDir, { recursive: true });
    writeFileSync(join(traceDir, SESSION_REVIEW_INDEX_FILE), `${JSON.stringify(index)}\n`, "utf8");
  } catch {
    // Probe evidence only.
  }
}

/** Narrow structural host a station room passes when its phase hits closed. */
export interface StationCloseReviewHost {
  stations: string[] | null;
  stationIndex: number;
  stationId: string;
  roomId: string;
  clients: RotationLearner[];
  isObserver(sessionId: string): boolean;
  actorIds: string[];
  closedAt: number | undefined;
  binding: StationBinding;
  /** Null disables persistence (and the index with it). */
  traceDir: string | null;
  /** Live tracer snapshot: the same data the room persists. */
  traceSnapshot(): ConversationTrace;
  /** Persist the live trace now (same content the dispose write leaves). */
  flushTrace(): void;
  onRotationFailed(stationId: string): void;
  rotationStarted: boolean;
  setRotationStarted(value: boolean): void;
}

/**
 * C9 station-close handler: hold this station's review data (flushing its
 * trace to disk first), run the C8 rotation driver, then write the index
 * once when the session ends. No stations or no traceDir means rotation
 * only, never an index.
 */
export async function handleStationClosed(host: StationCloseReviewHost, roomName: string): Promise<void> {
  const stations = host.stations;
  if (stations === null || host.traceDir === null) {
    await driveRoomRotation(
      {
        stations,
        stationIndex: host.stationIndex,
        stationId: host.stationId,
        clients: host.clients,
        isObserver: host.isObserver,
        actorIds: host.actorIds,
        closedAt: host.closedAt,
        binding: host.binding,
        onRotationFailed: host.onRotationFailed,
        rotationStarted: host.rotationStarted,
        setRotationStarted: host.setRotationStarted,
      },
      roomName,
    );
    return;
  }
  const collector = collectorFor(host.binding);
  // Trace on disk BEFORE the index: flush the live room now, then hold its
  // snapshot (the rotated-out room may dispose before the index is written).
  host.flushTrace();
  collector.entries.set(
    host.stationIndex,
    stationReviewFromTrace(host.stationId, host.stationIndex, host.roomId, host.traceSnapshot()),
  );
  let learnerFailures = 0;
  await driveRoomRotation(
    {
      stations,
      stationIndex: host.stationIndex,
      stationId: host.stationId,
      clients: host.clients,
      isObserver: host.isObserver,
      actorIds: host.actorIds,
      closedAt: host.closedAt,
      binding: host.binding,
      onRotationFailed: (stationId) => {
        host.onRotationFailed(stationId);
      },
      onParticipantFailed: (failed) => {
        if (failed.role === "learner") {
          learnerFailures += 1;
        }
      },
      rotationStarted: host.rotationStarted,
      setRotationStarted: host.setRotationStarted,
    },
    roomName,
  );
  if (collector.written) {
    return;
  }
  const traceDir = host.traceDir;
  if (host.stationIndex >= stations.length - 1) {
    writeSessionReviewIndexFile(traceDir, buildSessionReviewIndex(stations, collector.entries, true));
    collector.written = true;
    return;
  }
  // Terminal rotation failure: every connected learner failed its seat
  // reservation, so the session cannot proceed past this station. The index
  // covers the stations that ran (the entries held so far).
  const learnerCount = host.clients.filter((client) => !host.isObserver(client.sessionId)).length;
  if (learnerCount > 0 && learnerFailures >= learnerCount) {
    writeSessionReviewIndexFile(traceDir, buildSessionReviewIndex(stations, collector.entries, false));
    collector.written = true;
  }
}
