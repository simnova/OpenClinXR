/**
 * C5 faculty-observer role gate (server-side only, never synced).
 *
 * Kept in its own module so room.ts stays under the file-size gate (room.ts
 * was split once in C4). The room imports only parseEncounterRole and the
 * reject reason; observer membership itself lives on the room.
 */

/** Roles accepted at join. Absent role defaults to learner (C1-C4 behaviour). */
export type EncounterRole = "learner" | "observer";

/** Reject reason every observer intent receives, before any validation. */
export const OBSERVER_READ_ONLY_REASON = "observer-read-only";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Parse the join role from joinOrCreate options. Throws on any other role so
 * the SDK join rejects. Never returns a default for a present-but-invalid
 * role: unknown roles must not become learners or observers.
 */
/**
 * Parse the join role from joinOrCreate options. Throws on any other role so
 * the SDK join rejects. Never returns a default for a present-but-invalid
 * role: unknown roles must not become learners or observers.
 */
export function parseEncounterRole(options: unknown): EncounterRole {
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["role"] on this Record.
  const role = isRecord(options) ? options["role"] : undefined;
  if (role === undefined) {
    return "learner";
  }
  if (role === "learner" || role === "observer") {
    return role;
  }
  throw new Error(`unknown-role: ${String(role).slice(0, 64)}`);
}

/**
 * C8 D3: reject an intent from a session that is neither learner nor observer
 * of the room. Never a silent drop: the seq echoes the envelope when
 * well-formed so the client settles (the C7 silent return became a 5 s
 * timeout on the client).
 */
export function rejectNotJoined(reject: (seq: number, reason: string) => void, message: unknown): void {
  // biome-ignore lint/complexity/useLiteralKeys: tsc noPropertyAccessFromIndexSignature mandates ["seq"] on this Record.
  const seq = isRecord(message) && Number.isInteger(message["seq"]) ? (message["seq"] as number) : 0;
  reject(seq, "not-joined");
}
