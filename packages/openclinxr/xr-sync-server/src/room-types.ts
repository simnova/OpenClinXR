/**
 * Shared room state shapes (server-side probe/options only, never synced).
 *
 * Split out of room.ts for the file-size gate. The room implements these;
 * server.ts consumes RoomProbeStats for the probe handle.
 */

/** One server-driven actor turn, in application order. Server-side only, never synced. */
export interface TurnRecord {
  turnId: number;
  actorId: string;
  replyId: string;
  /** Seq of the utterance-end intent that opened the turn. */
  startSeq: number;
  end: "open" | "completed" | "interrupted" | "closed-by-phase";
  /** Seq of the interrupting utterance-start, or null when completed/open/closed-by-phase. */
  endSeq: number | null;
}

/** One applied select-actor intent, in application order. Server-side only, never synced. */
export interface ProbeSelection {
  sessionId: string;
  actorId: string;
  seq: number;
}

/** Read-only probe observability for the C2 headset harness. Never sent on the wire. */
export interface RoomProbeStats {
  intentCounts: Record<string, number>;
  selections: ProbeSelection[];
  /** C3 actor-turn log; every entry is a copy, never a live reference. */
  turns: TurnRecord[];
  /** C5 host-clock ms per opened turn (Date.now at turn open), keyed by turnId. Probe stats only, never in the trace. */
  turnOpenedAtMs: Record<number, number>;
  /** C6 host-clock ms per entered phase (Date.now at phase enter). Probe only, never in the trace. */
  phaseChangedAtMs: Record<string, number>;
}

/** Options accepted at room creation (forwarded from joinOrCreate). */
export interface EncounterRoomOptions {
  actors?: unknown;
  /** Directory for the review-safe conversation trace file (server-side only). */
  traceDir?: unknown;
  /** C5 join role: "learner" (default) | "observer". Other roles refused at join. */
  role?: unknown;
}
