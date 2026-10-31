/**
 * C11 learner patient-note intent for the xr-sync encounter room.
 *
 * Kept in its own module so room.ts stays under the file-size gate. After the
 * encounter the learner writes a Step 2 CS-style patient note during the note
 * phase: one "note-submit" intent { text } per accepted note, last wins. The
 * note text is held server-side only (never synced, never traced): schema
 * state carries noteStatus/noteChars, the trace carries one "note-submitted"
 * event with chars per accepted note, and the full text persists to one
 * <roomId>.patient-note.json at the station close.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Schema tag written into every persisted patient-note file. */
export const PATIENT_NOTE_SCHEMA = "openclinxr.xr-sync.patient-note.v1";

/** Persisted-file name suffix for the learner patient note. */
export const PATIENT_NOTE_FILE_SUFFIX = ".patient-note.json";

/** Reject reason when a note-submit arrives outside the note phase (brief mode included). */
export const OUTSIDE_NOTE_PHASE_REASON = "outside-note-phase";

/** Reject reason when the note text is missing or not a non-empty string. */
export const INVALID_NOTE_REASON = "invalid-note";

/** Reject reason when the note text exceeds the server noteMaxChars. */
export const NOTE_TOO_LONG_REASON = "note-too-long";

/**
 * Default server noteMaxChars when unset: a harness-oriented bound (2000
 * chars), not a Step 2 CS figure. Binds per server like timing (never client
 * roomOptions): the room ignores any client noteMaxChars by construction.
 */
export const DEFAULT_NOTE_MAX_CHARS = 2000;

/**
 * Validate server note config. Returns the bound when configured, the default
 * when absent. Throws on invalid (fail fast at boot, never per intent).
 */
export function parseNoteMaxChars(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_NOTE_MAX_CHARS;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("bad-note-max-chars: noteMaxChars must be a positive integer");
  }
  return value;
}

/**
 * Validate a note-submit payload against the phase gate and the server bound.
 * Returns the accepted text, or { reason } for the reject. The caller holds
 * the text and records the trace event (room owns state/trace side effects).
 */
export function validateNoteSubmit(
  phase: string,
  noteMaxChars: number,
  payload: unknown,
): string | { reason: string } {
  if (phase !== "note") {
    return { reason: OUTSIDE_NOTE_PHASE_REASON };
  }
  if (typeof payload !== "object" || payload === null) {
    return { reason: INVALID_NOTE_REASON };
  }
  const text = (payload as { text?: unknown }).text;
  if (typeof text !== "string" || text.length === 0) {
    return { reason: INVALID_NOTE_REASON };
  }
  if (text.length > noteMaxChars) {
    return { reason: NOTE_TOO_LONG_REASON };
  }
  return text;
}

/** Persisted learner patient note (review-safe: no session id, no timestamps). */
export interface PatientNoteFile {
  schema: string;
  stationId: string;
  text: string;
  chars: number;
}

/**
 * Best-effort note persistence: one <roomId>.patient-note.json in dir
 * (mkdir -p), written synchronously at the station close. Failures never
 * propagate; probe evidence must not break dispose or server close.
 */
export function persistPatientNote(dir: string, roomId: string, stationId: string, text: string): void {
  try {
    mkdirSync(dir, { recursive: true });
    const note: PatientNoteFile = { schema: PATIENT_NOTE_SCHEMA, stationId, text, chars: text.length };
    writeFileSync(join(dir, `${roomId}${PATIENT_NOTE_FILE_SUFFIX}`), `${JSON.stringify(note)}\n`, "utf8");
  } catch {
    // Probe evidence only.
  }
}
