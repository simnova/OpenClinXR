import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PATIENT_NOTE_SCHEMA } from "./patient-note.js";

/** Schema tag written into the persisted faculty review packet. */
export const REVIEW_PACKET_SCHEMA = "openclinxr.xr-sync.faculty-review-packet.v1";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
    return tagged && typeof parsed["text"] === "string" ? parsed["text"] : null;
  } catch {
    return null;
  }
}
