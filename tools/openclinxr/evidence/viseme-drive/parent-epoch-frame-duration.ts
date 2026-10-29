/** Same-pass owned parent frame epoch (source130). Pure validator/selector:
 * duration comes ONLY from the owned epoch read before frame waits. No scene
 * traversal, no baked/text fallback. */
export interface OwnedFrameEpoch {
  actorId: unknown;
  speechActorId: unknown;
  startedAtMs: unknown;
  durationMs: unknown;
  nowMs: unknown;
}
export function selectOwnedFrameEpochDurationMs(epoch: OwnedFrameEpoch, expectedActorId: string): number | null {
  if (epoch.actorId !== expectedActorId) return null;
  if (epoch.speechActorId !== expectedActorId) return null;
  if (typeof epoch.startedAtMs !== "number" || !Number.isFinite(epoch.startedAtMs)) return null;
  if (typeof epoch.durationMs !== "number" || !Number.isFinite(epoch.durationMs) || epoch.durationMs <= 0) return null;
  // Not stale/expired: the observed runtime clock must still be inside the epoch.
  // rAF may run slightly before start, so only the end bound is enforced.
  if (typeof epoch.nowMs !== "number" || !Number.isFinite(epoch.nowMs)) return null;
  if (!(epoch.nowMs < epoch.startedAtMs + epoch.durationMs)) return null;
  return epoch.durationMs;
}
