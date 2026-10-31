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
import { PATIENT_NOTE_FILE_SUFFIX, persistPatientNote } from "./patient-note.js";
import { castForStation } from "./scenario-cast.js";
import {
  driveRoomRotation,
  type RotationLearner,
  type StationBinding,
} from "./station-rotation.js";
import { type TraceTagCoverageScenario, type TraceTagRubricCoverage, traceTagCoverage } from "./trace-tag-coverage.js";

/** Schema tag written into every exam session review index file. */
export const SESSION_REVIEW_INDEX_SCHEMA = "openclinxr.xr-sync.exam-session-review-index.v1";
/** Index file name inside the server trace directory (one per server session). */
export const SESSION_REVIEW_INDEX_FILE = "exam-session.review-index.json";

/** One station's review entry: a link to its trace plus the copied fields. */
export interface SessionReviewStationEntry {
  stationId: string;
  stationIndex: number;
  /** C15 the slot's blueprint label (present only when the session ran from a blueprint). */
  stationLabel?: string;
  /** C16 the slot's scenario id (present only when the session ran with scenarios). */
  scenarioId?: string;
  /** Basename of the station's <roomId>.conversation-trace.json in traceDir. */
  traceFile: string;
  /** Phase names from the trace's phase-changed events, in order. */
  phases: string[];
  turnCount: number;
  /** Per-turn end states from the trace's turns, in order. */
  turnEnds: string[];
  /** True when the station trace holds an observer-joined event. */
  observerPresent: boolean;
  /** C11 true when the station trace holds a note-submitted event. */
  notePresent: boolean;
  /** C11 length of the last accepted note (0 when none). */
  noteChars: number;
  /** C11 basename of the station's <roomId>.patient-note.json, or null when no note was accepted. */
  noteFile: string | null;
  /** C21 required tags produced by this station's trace (cast stations only). */
  observedTraceTags?: string[];
  /** C21 required tags absent from this station's trace (cast stations only). */
  missingRequiredTraceTags?: string[];
  /** C21 per-rubric tag evidence in scenario rubric order, without labels. */
  rubricCoverage?: TraceTagRubricCoverage[];
}

/** Persisted exam session review index (review-safe: no identity, no text). */
export interface SessionReviewIndex {
  schema: string;
  complete: boolean;
  stationCount: number;
  /** C15 the blueprint id (present only when the session ran from a blueprint). */
  blueprintId?: string;
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
  stationLabel?: string,
  scenarioId?: string,
  coverageScenario?: TraceTagCoverageScenario,
): SessionReviewStationEntry {
  const noteEvents = trace.events.filter((event) => event.kind === "note-submitted");
  const lastNoteChars = noteEvents.length > 0 ? (noteEvents[noteEvents.length - 1] as { chars?: unknown }).chars : undefined;
  const coverage = coverageScenario === undefined ? undefined : traceTagCoverage(trace, coverageScenario);
  return {
    stationId,
    stationIndex,
    ...(stationLabel === undefined ? {} : { stationLabel }),
    ...(scenarioId === undefined ? {} : { scenarioId }),
    traceFile: `${roomId}${CONVERSATION_TRACE_FILE_SUFFIX}`,
    phases: trace.events.filter((event) => event.kind === "phase-changed").map((event) => event.phase ?? ""),
    turnCount: trace.turns.length,
    turnEnds: trace.turns.map((turn) => turn.end),
    observerPresent: trace.events.some((event) => event.kind === "observer-joined"),
    notePresent: noteEvents.length > 0,
    noteChars: typeof lastNoteChars === "number" ? lastNoteChars : 0,
    noteFile: noteEvents.length > 0 ? `${roomId}${PATIENT_NOTE_FILE_SUFFIX}` : null,
    ...(coverage === undefined ? {} : coverage),
  };
}

/** Assemble the persisted index: entries in station order. */
export function buildSessionReviewIndex(
  stations: string[],
  entries: Map<number, SessionReviewStationEntry>,
  complete: boolean,
  blueprintId?: string,
): SessionReviewIndex {
  const ordered = [...entries.values()].sort((a, b) => a.stationIndex - b.stationIndex);
  return {
    schema: SESSION_REVIEW_INDEX_SCHEMA,
    complete,
    stationCount: stations.length,
    ...(blueprintId === undefined ? {} : { blueprintId }),
    stations: ordered.map((entry) => ({ ...entry, phases: [...entry.phases], turnEnds: [...entry.turnEnds] })),
  };
}

/**
 * Best-effort index persistence: mkdir -p, one
 * <traceDir>/exam-session.review-index.json. A write failure is logged with
 * the path (console.error) instead of swallowed: a missing index is a silent
 * faculty-review outage otherwise (C9 grade defect 4). Never throws; the room
 * must close cleanly even when evidence cannot be written.
 */
export function writeSessionReviewIndexFile(traceDir: string, index: SessionReviewIndex): void {
  const file = join(traceDir, SESSION_REVIEW_INDEX_FILE);
  try {
    mkdirSync(traceDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(index)}\n`, "utf8");
  } catch (error) {
    console.error(`xr-sync: failed to write session review index to ${file}: ${error instanceof Error ? error.message : String(error)}`);
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
  /** C11 held patient-note text (null when no note was accepted this station). */
  noteText: string | null;
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
    // C11: a held note still persists when persistence is enabled (traceDir
    // set) even without stations; without a traceDir there is nothing to link.
    if (host.traceDir !== null && host.noteText !== null) {
      persistPatientNote(host.traceDir, host.roomId, host.stationId, host.noteText);
    }
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
    ).catch((error: unknown) => {
      // driveRoomRotation rethrows a station createRoom failure (C10). With no
      // index to write it must not escape `void rotateStation()` unhandled.
      console.error(`xr-sync: station rotation failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return;
  }
  const collector = collectorFor(host.binding);
  // Trace on disk BEFORE the index: flush the live room now, then hold its
  // snapshot (the rotated-out room may dispose before the index is written).
  // C11: the patient note persists right after the trace it links to.
  // C15: the blueprint id + slot label ride the entries (absent otherwise).
  host.flushTrace();
  if (host.noteText !== null) {
    persistPatientNote(host.traceDir, host.roomId, host.stationId, host.noteText);
  }
  const blueprint = host.binding.examBlueprint ?? null;
  const cast = castForStation(host.binding.scenarioCasts, host.stationIndex);
  collector.entries.set(
    host.stationIndex,
    stationReviewFromTrace(
      host.stationId,
      host.stationIndex,
      host.roomId,
      host.traceSnapshot(),
      blueprint?.labels.get(host.stationId),
      cast?.scenarioId ?? undefined,
      cast ?? undefined,
    ),
  );
  let learnerFailures = 0;
  let stationCreateFailed = false;
  try {
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
  } catch {
    // A station createRoom throw is terminal for the session (C10): the
    // session cannot proceed past this station, so the index below covers
    // the stations that ran with complete false.
    stationCreateFailed = true;
  }
  if (collector.written) {
    return;
  }
  const traceDir = host.traceDir;
  if (host.stationIndex >= stations.length - 1) {
    writeSessionReviewIndexFile(traceDir, buildSessionReviewIndex(stations, collector.entries, true, blueprint?.blueprintId));
    collector.written = true;
    return;
  }
  // Terminal rotation failure: every connected learner failed its seat
  // reservation, so the session cannot proceed past this station. The index
  // covers the stations that ran (the entries held so far).
  const learnerCount = host.clients.filter((client) => !host.isObserver(client.sessionId)).length;
  if (stationCreateFailed || (learnerCount > 0 && learnerFailures >= learnerCount)) {
    writeSessionReviewIndexFile(traceDir, buildSessionReviewIndex(stations, collector.entries, false, blueprint?.blueprintId));
    collector.written = true;
  }
}
