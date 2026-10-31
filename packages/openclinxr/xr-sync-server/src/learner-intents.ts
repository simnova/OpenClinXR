/**
 * Learner movement + selection intent application for the encounter room.
 *
 * Split out of room.ts for the file-size gate (C1 pose + C2 select-actor:
 * validated intents in, applied or rejected, no game state owned here). The
 * room owns the learner/actor maps and the tracer; this module owns only the
 * per-kind validation and mutation through narrow structural bindings.
 */
import type { Client } from "@colyseus/core";
import type { ConversationTracer } from "./conversation-tracer.js";
import type { ProbeSelection } from "./room-types.js";
import type { LearnerStateInstance } from "./schema.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Narrow room surface the pose/select appliers mutate. */
export interface LearnerIntentBindings {
  actors: { has(actorId: string): boolean };
  selectedActor: Map<string, string>;
  selectionLog: ProbeSelection[];
  tracer: ConversationTracer;
  reject(client: Client, seq: number, reason: string): void;
}

/** Apply a validated pose intent (head position). Never rejects the envelope. */
export function applyPoseIntent(
  bindings: LearnerIntentBindings,
  client: Client,
  learner: LearnerStateInstance,
  seq: number,
  payload: unknown,
): boolean {
  if (!isRecord(payload)) {
    bindings.reject(client, seq, "bad-pose-payload");
    return false;
  }
  const { x, y, z } = payload as { x?: unknown; y?: unknown; z?: unknown };
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    bindings.reject(client, seq, "bad-pose-payload");
    return false;
  }
  learner.headX = x;
  learner.headY = y;
  learner.headZ = z;
  return true;
}

/** Apply a validated select-actor intent (learner's reply target). */
export function applySelectActorIntent(
  bindings: LearnerIntentBindings,
  client: Client,
  seq: number,
  payload: unknown,
): boolean {
  if (!isRecord(payload)) {
    bindings.reject(client, seq, "bad-select-actor-payload");
    return false;
  }
  const { actorId } = payload;
  if (typeof actorId !== "string") {
    bindings.reject(client, seq, "bad-select-actor-payload");
    return false;
  }
  if (!bindings.actors.has(actorId)) {
    bindings.reject(client, seq, "unknown-actor");
    return false;
  }
  bindings.selectedActor.set(client.sessionId, actorId);
  bindings.selectionLog.push({ sessionId: client.sessionId, actorId, seq });
  bindings.tracer.push({ seq, kind: "select-actor", actorId, turnId: null });
  return true;
}
