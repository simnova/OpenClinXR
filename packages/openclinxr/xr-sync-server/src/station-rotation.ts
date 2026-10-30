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

/** C8 test seam (server-config only, never client-settable): force the next N
 * seat reservations to fail (exercises retry + rotation-failed), and/or send
 * a bogus rotate payload (exercises the client consume-fail path). */
export interface RotationFaults {
  failNext: number;
  bogusRotate: boolean;
}

/** Per-server station binding shared by reference across a server's rooms. */
export interface StationBinding {
  stations: string[] | null;
  creationNonces: Map<string, number>;
  joinNonces: Set<string>;
  /** C8 exact per-station applied pose counts (survives room dispose; drives F3). */
  appliedPoseByStation: Map<string, number>;
  /** C8 rotation fault seam (server-config only; product path leaves it off). */
  rotationFaults: RotationFaults;
}

/** C8: record one applied pose for the station (exact F3 cross-check source). */
export function recordStationPose(binding: StationBinding, stationId: string): void {
  binding.appliedPoseByStation.set(stationId, (binding.appliedPoseByStation.get(stationId) ?? 0) + 1);
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
  /** "learner" (default) or "observer": observers rotate on the same path with role preserved. */
  role?: "learner" | "observer";
  send(type: string, message: unknown): void;
}

/** Injectable matchmaking surface for rotation (tests pass fakes; product passes nothing). */
export type RotationMatchMaker = Pick<typeof matchMaker, "createRoom" | "reserveSeatFor" | "getLocalRoomById">;

/** Inputs for one rotation step (station index -> index + 1). */
export interface RotationStep {
  roomName: string;
  stations: string[];
  stationIndex: number;
  learners: RotationLearner[];
  /** C8 faculty observers rotated with the learners (same reservation + nonce path). */
  observers?: RotationLearner[];
  actorIds: string[];
  closedAt: number | undefined;
  binding: StationBinding;
  /** Current station id (for the rotation-failed client message). */
  stationId?: string;
  /** C8: record one review-safe rotation-failed trace event (no identity). */
  onRotationFailed?: (failedStationId: string) => void;
  /** C8 test seam: fake matchmaking (product path uses the real matchMaker). */
  deps?: RotationMatchMaker;
}

/** Structural successor room surface for gap evidence (no room import: that would cycle). */
interface GapEvidenceRoom {
  phaseChangedAtMs: Map<string, number>;
}

/**
 * C8 rotation driver: create the next station's room (server-issued, never a
 * client join), then issue each connected learner AND each connected observer
 * a seat reservation the client consumes (it never picks a station; observer
 * role is preserved in the reservation so the next room counts/traces it).
 * Per-participant best-effort with one retry: a twice-failed reservation
 * sends that client "rotation-failed" {stationId} and records one
 * review-safe "rotation-failed" trace event (no identity). No rotation past
 * the last station; no stations means no rotation. Returns true when
 * rotation ran (room created, even if some participants failed).
 *
 * Nonce hygiene (C8 D4): a creation nonce is deleted when createRoom throws;
 * a join nonce is deleted on reservation failure (both attempts), on consume
 * (join path), on reservation expiry (timeout), and every remaining unused
 * nonce is cleared when a station room disposes (clearStationNoncesOnDispose).
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
  const mm: RotationMatchMaker = step.deps ?? matchMaker;
  let nextCache: Awaited<ReturnType<typeof matchMaker.createRoom>>;
  try {
    nextCache = await mm.createRoom(step.roomName, {
      actors: step.actorIds,
      [STATION_CREATE_KEY]: { index: nextIndex, nonce: createNonce },
    });
  } catch {
    step.binding.creationNonces.delete(createNonce);
    throw new Error("rotation-failed");
  }
  if (typeof step.closedAt === "number") {
    // E3 gap evidence: the successor records the predecessor closed time so
    // the harness reads both ends from the live room (the rotated-out room
    // disposes, taking its stats with it). Structural access: importing the
    // room would cycle back here.
    const next = mm.getLocalRoomById(nextCache.roomId) as unknown as GapEvidenceRoom | undefined;
    next?.phaseChangedAtMs.set("prev-station-closed", step.closedAt);
  }
  const failedStationId = stations[nextIndex] as string;
  const faults = step.binding.rotationFaults;
  const participants: RotationLearner[] = [...step.learners, ...(step.observers ?? [])];
  for (const participant of participants) {
    const role = participant.role ?? "learner";
    const reserveOptions = (nonce: string): Record<string, unknown> =>
      role === "observer" ? { [STATION_ROTATE_KEY]: nonce, role: "observer" } : { [STATION_ROTATE_KEY]: nonce };
    const tryReserve = async (room: typeof nextCache, options: Record<string, unknown>): Promise<unknown> => {
      if (faults.failNext > 0) {
        faults.failNext -= 1;
        throw new Error("rotation-fault");
      }
      return mm.reserveSeatFor(room, options);
    };
    if (faults.bogusRotate) {
      // C8 fault seam: a bogus rotate payload exercises the client
      // consume-fail path. No nonce is issued, so D4 counts stay clean.
      try {
        participant.send("rotate", { bogus: true });
      } catch {
        // Best-effort; the client surfaces the failure itself.
      }
      continue;
    }
    let joinNonce = randomUUID();
    step.binding.joinNonces.add(joinNonce);
    let reservation: unknown = null;
    try {
      reservation = await tryReserve(nextCache, reserveOptions(joinNonce));
    } catch {
      step.binding.joinNonces.delete(joinNonce);
      joinNonce = randomUUID();
      step.binding.joinNonces.add(joinNonce);
      try {
        reservation = await tryReserve(nextCache, reserveOptions(joinNonce));
      } catch {
        step.binding.joinNonces.delete(joinNonce);
        try {
          participant.send("rotation-failed", { stationId: failedStationId });
        } catch {
          // Client send is best-effort; the trace still records the failure.
        }
        step.onRotationFailed?.(failedStationId);
        continue;
      }
    }
    // C8 D4: an unused reservation expires server-side; the nonce must not
    // outlive it. Consumed nonces are deleted at join; this timeout is the
    // expiry backstop (unref so tests close cleanly).
    const issued = joinNonce;
    const timer = setTimeout(() => {
      step.binding.joinNonces.delete(issued);
    }, 15000);
    if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
      (timer as unknown as { unref: () => void }).unref();
    }
    try {
      participant.send("rotate", reservation);
    } catch {
      // Best-effort per participant: the client stays in the closed room and
      // surfaces the failure via its own consume path; the nonce expires above.
    }
  }
  return true;
}

/** C8 unused station nonce counts for probe stats (binding-shared, probe only). */
export function stationNonceCounts(binding: StationBinding): { creation: number; join: number } {
  return { creation: binding.creationNonces.size, join: binding.joinNonces.size };
}

/**
 * C8 D4: clear every unused station nonce when a station room disposes. Safe
 * because rotations are sequential: at dispose the in-flight nonces for the
 * just-completed rotation were consumed at join (deleted), so anything left
 * is a never-consumed reservation (leave/consume-fail) or a leaked creation
 * nonce from a failed createRoom.
 */
export function clearStationNoncesOnDispose(binding: StationBinding): void {
  binding.creationNonces.clear();
  binding.joinNonces.clear();
}

/** Structural host surface the room passes for one rotation step. */
export interface RoomRotationHost {
  stations: string[] | null;
  stationIndex: number;
  stationId: string;
  clients: RotationLearner[];
  isObserver(sessionId: string): boolean;
  actorIds: string[];
  closedAt: number | undefined;
  binding: StationBinding;
  onRotationFailed(stationId: string): void;
  rotationStarted: boolean;
  setRotationStarted(value: boolean): void;
}

/** Room delegate: partition learners/observers and run the driver. */
export async function driveRoomRotation(host: RoomRotationHost, roomName: string): Promise<void> {
  if (host.stations === null || host.rotationStarted) {
    return;
  }
  host.setRotationStarted(true);
  try {
    const learners = host.clients.filter((client) => !host.isObserver(client.sessionId));
    const observers = host.clients
      .filter((client) => host.isObserver(client.sessionId))
      .map((client) => ({
        sessionId: client.sessionId,
        role: "observer" as const,
        send: (type: string, message: unknown): void => {
          client.send(type, message);
        },
      }));
    const rotated = await driveStationRotation({
      roomName,
      stations: host.stations,
      stationIndex: host.stationIndex,
      learners,
      observers,
      actorIds: host.actorIds,
      closedAt: host.closedAt,
      binding: host.binding,
      stationId: host.stationId,
      onRotationFailed: host.onRotationFailed,
    });
    if (!rotated) {
      host.setRotationStarted(false);
    }
  } catch {
    host.setRotationStarted(false);
  }
}
