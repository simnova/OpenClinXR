/**
 * Encounter actor roster provisioning (server-side only, never synced).
 *
 * Split out of room.ts for the file-size gate. The known encounter roster is
 * always present; a probe page may provision its own extra actors (e.g. a1/a2)
 * through room options without changing defaults.
 */
import { MapSchema } from "@colyseus/schema";
import { ActorState, type ActorStateInstance } from "./schema.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Maximum extra probe actors a room may provision beyond the known encounter roster. */
export const MAX_EXTRA_ACTOR_IDS = 8;

export const KNOWN_ACTOR_IDS = ["physician", "patient"] as const;
export type KnownActorId = (typeof KNOWN_ACTOR_IDS)[number];

/**
 * Parse optional extra probe actor ids from room options. Invalid entries are
 * ignored; the known encounter roster is always present. Bounded so a probe
 * page can provision its own actors (e.g. a1/a2) without changing defaults.
 */
export function parseExtraActorIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(entry)) {
      continue;
    }
    if (KNOWN_ACTOR_IDS.includes(entry as KnownActorId)) {
      continue;
    }
    if (!ids.includes(entry)) {
      ids.push(entry);
    }
    if (ids.length >= MAX_EXTRA_ACTOR_IDS) {
      break;
    }
  }
  return ids;
}

/**
 * Populate a room's actor map from the server binding + room options. NEVER
 * reads client stationId/stationIndex: extras come only from options.actors.
 * Moved from room.ts onCreate (same behaviour); the room owns state, this
 * module owns roster setup.
 */
export function populateActorRoster(actors: Map<string, ActorStateInstance>, options: unknown): void {
  const roster = new Set<string>(KNOWN_ACTOR_IDS);
  const extra = isRecord(options) ? (options as { actors?: unknown }).actors : undefined;
  for (const id of parseExtraActorIds(extra)) {
    roster.add(id);
  }
  for (const id of roster) {
    const actor = new ActorState();
    actor.id = id;
    actor.speaking = false;
    actor.emotion = "neutral";
    actor.replyId = "";
    actor.cueId = "";
    actors.set(id, actor);
  }
}
