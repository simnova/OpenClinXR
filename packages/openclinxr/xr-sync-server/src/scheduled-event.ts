/**
 * C19 scheduled-event shared constants for the xr-sync encounter server.
 *
 * A cast station runs its scenario's eventSchedule on the server clock: at
 * atSecond after the encounter starts, the named actor interjects with no
 * learner intent. The trace records { kind: "scheduled-event", actorId,
 * eventId, tag } (review-safe: ids + tag only, never text). The reply id is
 * always `scheduled:<eventId>`, spoken for the C3 first-row duration with an
 * empty caption and cue (the interjection carries no authored line, so there
 * is nothing review-safe to show).
 */

/** Trace event kind for a server-clock scheduled interjection. */
export const SCHEDULED_EVENT_KIND = "scheduled-event";

/** Server reply id for a scheduled interjection (no learner intent). */
export function scheduledReplyId(eventId: string): string {
  return `scheduled:${eventId}`;
}

/** True when a server reply id names a scheduled interjection. */
export function isScheduledReplyId(replyId: string): boolean {
  return replyId.startsWith("scheduled:");
}

/** One scenario schedule entry (mirrors @openclinxr/shared-schemas EventScheduleEntry). */
export interface ScheduledScenarioEntry {
  eventId: string;
  atSecond: number;
  actorId: string;
  tag: string;
}
