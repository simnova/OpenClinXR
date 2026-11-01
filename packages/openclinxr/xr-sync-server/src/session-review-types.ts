import type { TraceTagRubricCoverage } from "./trace-tag-coverage.js";

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
