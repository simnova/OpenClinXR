/**
 * Client-to-server intent wire protocol (envelope types only, no logic).
 *
 * Split out of room.ts for the file-size gate. The room re-exports these so
 * the package "." surface and existing room.js importers keep working.
 */

/** Client-to-server intent kinds. The only message type that may mutate state. */
export type IntentKind = "pose" | "select-actor" | "utterance-start" | "utterance-end" | "note-submit";
export const INTENT_KINDS: ReadonlySet<string> = new Set([
  "pose",
  "select-actor",
  "utterance-start",
  "utterance-end",
  "note-submit",
]);

/** Wire envelope for one client intent. Validated before anything is applied. */
export interface IntentMessage {
  kind?: unknown;
  seq?: unknown;
  clientTs?: unknown;
  payload?: unknown;
}

/** Server reply for an applied intent, carrying the round-trip terminus. */
export interface AckMessage {
  seq: number;
  serverTs: number;
}

/** Server reply for a rejected intent. State is unchanged when this is sent. */
export interface RejectMessage {
  seq: number;
  reason: string;
}
