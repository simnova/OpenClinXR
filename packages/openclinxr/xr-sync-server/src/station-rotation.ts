/**
 * C7 multi-station rotation for the xr-sync encounter room.
 *
 * Kept in its own module so room.ts stays under the file-size gate. This
 * module owns station config parsing, the server-secret rotation tokens, the
 * station room setup, the join gate, and the rotation driver; the room owns
 * state/trace/turn side effects and calls in with narrow structural bindings
 * (same pattern as the C6 phase clock).
 *
 * Product skeleton: a Step 2 CS-style multi-station XR exam. C7 = the server
 * moves the learner through stations: when station A's phase clock reaches
 * closed, the server rotates the learner's connection into station B's room;
 * each station keeps its own trace.
 *
 * Isolation: station assignment NEVER reads client roomOptions.stationId /
 * stationIndex (Colyseus define() defaults merge with client options, so the
 * room ignores those fields by construction). Server-created station rooms
 * carry an unguessable creation nonce; server-issued rotations carry a
 * per-learner join nonce. A client join targeting a non-first station without
 * a server-issued reservation is refused in onAuth/onJoin.
 */
import { matchMaker } from "@colyseus/core";
import { randomUUID } from "node:crypto";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validate server station config. Returns the station id list when
 * configured, null when absent (no stations -> C6 behaviour, no rotation).
 * An empty array is also no stations. Throws on invalid.
 */
export function parseStationIds(value: unknown): string[] | null {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new Error("bad-stations: stations must be an array of station ids");
  }
  if (value.length === 0) {
    return null;
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 64) {
      throw new Error("bad-stations: each station id must be a non-empty string <= 64 chars");
    }
    if (!/^[A-Za-z0-9_-]+$/.test(entry)) {
      throw new Error("bad-stations: each station id must match [A-Za-z0-9_-]+");
    }
    if (seen.has(entry)) {
      throw new Error("bad-stations: station ids must be unique");
    }
    seen.add(entry);
  }
  return [...seen];
}

/** Option key carrying the server-secret station creation token (never client-set). */
export const STATION_CREATE_KEY = "__c7Station";
/** Option key carrying the server-secret per-learner rotation token (never client-set). */
export const STATION_ROTATE_KEY = "__c7Rotation";

/** Server-issued station creation token: { index, nonce }. */
export interface StationCreateToken {
  index: number;
  nonce: string;
}

/**
 * Extract a well-formed creation token from room options. Returns null when
 * absent or malformed (caller falls back to stations[0]; client fields are
 * never read here).
 */
export function extractCreateToken(options: unknown): StationCreateToken | null {
  if (!isRecord(options)) {
    return null;
  }
  const raw = options[STATION_CREATE_KEY];
  if (!isRecord(raw)) {
    return null;
  }
  const { index, nonce } = raw as { index?: unknown; nonce?: unknown };
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    return null;
  }
  if (typeof nonce !== "string" || nonce.length === 0) {
    return null;
  }
  return { index, nonce };
}

/**
 * Extract a well-formed per-learner rotation token from join options.
 * Returns null when absent or malformed.
 */
export function extractRotateToken(options: unknown): string | null {
  if (!isRecord(options)) {
    return null;
  }
  const raw = options[STATION_ROTATE_KEY];
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  return raw;
}

/**
 * Resolve a room's station from server binding + creation token. NEVER reads
 * client stationId/stationIndex. Returns stations[0] for client-initiated
 * rooms; consumes a valid creation nonce (single use per station room).
 */
export function resolveStationForCreate(
  stations: string[] | null,
  creationNonces: Map<string, number>,
  options: unknown,
): { stationId: string; stationIndex: number; stationCount: number } {
  if (stations === null) {
    return { stationId: "", stationIndex: 0, stationCount: 0 };
  }
  const token = extractCreateToken(options);
  if (token !== null) {
    const boundIndex = creationNonces.get(token.nonce);
    if (boundIndex !== undefined && boundIndex === token.index && token.index < stations.length) {
      creationNonces.delete(token.nonce);
      const stationId = stations[token.index] as string;
      return { stationId, stationIndex: token.index, stationCount: stations.length };
    }
  }
  return { stationId: stations[0] as string, stationIndex: 0, stationCount: stations.length };
}

/**
 * Validate a learner's join to a non-first station room. First-station and
 * station-less rooms need no token. For stationIndex > 0 the join must carry
 * a server-issued rotation nonce still present in joinNonces; consumes it.
 * Returns true when the join may proceed, false when it must be refused.
 */
export function consumeRotateTokenForJoin(
  stationIndex: number,
  joinNonces: Set<string>,
  options: unknown,
): boolean {
  if (stationIndex <= 0) {
    return true;
  }
  const token = extractRotateToken(options);
  if (token === null || !joinNonces.has(token)) {
    return false;
  }
  joinNonces.delete(token);
  return true;
}

/** Per-server station binding shared by reference across a server's rooms. */
export interface StationBinding {
  stations: string[] | null;
  creationNonces: Map<string, number>;
  joinNonces: Set<string>;
}

/** Minimal room state surface the station setup writes. */
export interface StationStateTarget {
  stationId: string;
  stationIndex: number;
  stationCount: number;
}

/**
 * Assign a room's station from the server binding + creation nonce, then set
 * the synced state fields and the tracer partition key. NEVER reads client
 * stationId/stationIndex. Returns the assigned station.
 */
export function configureStationRoom(
  binding: StationBinding,
  options: unknown,
  state: StationStateTarget,
  tracer: { setStationId(stationId: string): void },
): { stationId: string; stationIndex: number; stationCount: number } {
  const station = resolveStationForCreate(binding.stations, binding.creationNonces, options);
  state.stationId = station.stationId;
  state.stationIndex = station.stationIndex;
  state.stationCount = station.stationCount;
  tracer.setStationId(station.stationId);
  return station;
}

/**
 * Refuse (by throwing) a join to a non-first station room without a
 * server-issued rotation nonce. Fresh joins land in stations[0] because
 * non-first rooms are private + locked; a direct joinById without a
 * reservation fails here so the SDK join rejects.
 */
export function assertStationJoinAllowed(
  binding: StationBinding,
  stationIndex: number,
  options: unknown,
): void {
  if (binding.stations === null || stationIndex <= 0) {
    return;
  }
  const presented = extractRotateToken(options);
  if (presented === null || !binding.joinNonces.has(presented)) {
    throw new Error("c7-no-rotation-token");
  }
}

/** Structural learner client the rotation driver sends a reservation to. */
export interface RotationLearner {
  sessionId: string;
  send(type: string, message: unknown): void;
}

/** Inputs for one rotation step (station index -> index + 1). */
export interface RotationStep {
  roomName: string;
  stations: string[];
  stationIndex: number;
  learners: RotationLearner[];
  actorIds: string[];
  closedAt: number | undefined;
  binding: StationBinding;
}

/** Structural successor room surface for gap evidence (no room import: that would cycle). */
interface GapEvidenceRoom {
  phaseChangedAtMs: Map<string, number>;
}

/**
 * C7 rotation driver: create the next station's room (server-issued, never a
 * client join), then issue each connected learner a seat reservation the
 * client consumes (it never picks a station). Per-learner best-effort: one
 * failed reservation never blocks the others. No rotation past the last
 * station; no stations means no rotation. Returns true when rotation ran.
 */
export async function driveStationRotation(step: RotationStep): Promise<boolean> {
  const { stations, stationIndex } = step;
  if (stationIndex < 0 || stationIndex >= stations.length - 1) {
    return false;
  }
  if (step.learners.length === 0) {
    return false;
  }
  const nextIndex = stationIndex + 1;
  const createNonce = randomUUID();
  step.binding.creationNonces.set(createNonce, nextIndex);
  const nextCache = await matchMaker.createRoom(step.roomName, {
    actors: step.actorIds,
    [STATION_CREATE_KEY]: { index: nextIndex, nonce: createNonce },
  });
  if (typeof step.closedAt === "number") {
    // E3 gap evidence: the successor records the predecessor closed time so
    // the harness reads both ends from the live room (the rotated-out room
    // disposes, taking its stats with it). Structural access: importing the
    // room would cycle back here.
    const next = matchMaker.getLocalRoomById(nextCache.roomId) as unknown as GapEvidenceRoom | undefined;
    next?.phaseChangedAtMs.set("prev-station-closed", step.closedAt);
  }
  for (const learner of step.learners) {
    try {
      const joinNonce = randomUUID();
      step.binding.joinNonces.add(joinNonce);
      const reservation = await matchMaker.reserveSeatFor(nextCache, {
        [STATION_ROTATE_KEY]: joinNonce,
      });
      learner.send("rotate", reservation);
    } catch {
      // Best-effort per learner: the learner stays in the closed room.
    }
  }
  return true;
}
