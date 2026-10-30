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
export function parseEncounterRole(options: unknown): EncounterRole {
  const role = isRecord(options) ? options["role"] : undefined;
  if (role === undefined) {
    return "learner";
  }
  if (role === "learner" || role === "observer") {
    return role;
  }
  throw new Error(`unknown-role: ${String(role).slice(0, 64)}`);
}
