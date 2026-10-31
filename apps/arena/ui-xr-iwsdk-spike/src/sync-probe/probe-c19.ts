/**
 * C19 scenario-schedule probe helpers: scheduled-interjection panel + station loop.
 *
 * Split out of sync-probe.ts for the file-size gate (same ceiling rationale
 * as the C16/C17/C18 modules: this module owns and publishes
 * window.__syncProbeC19 itself). The page joins a cast blueprint server and
 * watches: a cast station runs its scenario's eventSchedule on the server
 * clock, so with no learner intent each scheduled entry fires once and the
 * named actor speaks `scheduled:<eventId>`. The speaking actor's scheduled
 * line renders in the visible station panel; every (stationId, eventId,
 * actorId, replyId) the page rendered is recorded. Every export derives from
 * SERVER state only; no page-local timing enters.
 */
import { observedPhaseFrom } from "./probe-c6.js";
import { observedStationFrom } from "./probe-c7.js";

/** Server reply-id prefix for a scheduled interjection (mirrors the server). */
const SCHEDULED_REPLY_PREFIX = "scheduled:";

/** One rendered scheduled interjection (SERVER values only, page clock). */
export interface C19ScheduledEvent {
  stationId: string;
  eventId: string;
  actorId: string;
  replyId: string;
  atMs: number;
}

/** Minimal probe evidence surface the C19 tracker updates. */
export interface C19Evidence {
  scheduledRendered: C19ScheduledEvent[];
  /** Last panel text the page rendered (the scheduled line, else the station line). */
  panelText: string;
}

/** Empty C19 evidence (nothing seen, panel blank). */
export function createC19Evidence(): C19Evidence {
  return { scheduledRendered: [], panelText: "" };
}

declare global {
  interface Window {
    __syncProbeC19?: C19Evidence;
  }
}

/** Minimal server snapshot surface for the scheduled panel. */
export interface C19ScheduledView {
  stationId?: unknown;
  lastScheduledEventId?: unknown;
  actors?: Record<string, { speaking?: unknown; replyId?: unknown } | undefined>;
}

/** (actorId, eventId, replyId, speaking) for one actor, read from a server snapshot. Pure function. */
export function observedScheduledOf(
  state: C19ScheduledView | null | undefined,
  actorId: string,
): { replyId: string; eventId: string; speaking: boolean } {
  const actor = state?.actors?.[actorId];
  const replyId = typeof actor?.replyId === "string" ? (actor.replyId as string) : "";
  return {
    replyId,
    eventId: replyId.startsWith(SCHEDULED_REPLY_PREFIX) ? replyId.slice(SCHEDULED_REPLY_PREFIX.length) : "",
    speaking: actor?.speaking === true && replyId.startsWith(SCHEDULED_REPLY_PREFIX),
  };
}

/**
 * Render the visible scheduled panel from the SERVER snapshot and record one
 * scheduledRendered entry per speaking scheduled actor reply. Pure read of
 * server state plus a DOM write; called on every script poll so the
 * interjection is captured while the server says the actor is speaking.
 */
export function renderC19Panel(probe: { c19: C19Evidence }, snapshot: unknown): void {
  const view = snapshot as C19ScheduledView;
  const stationId = typeof view.stationId === "string" ? view.stationId : "";
  const speakingId = [...Object.keys(view.actors ?? {})].sort().find((id) => observedScheduledOf(view, id).speaking) ?? null;
  const spoken = speakingId !== null ? observedScheduledOf(view, speakingId) : null;
  const text = spoken !== null ? `scheduled ${stationId} ${speakingId} ${spoken.eventId}` : `station: ${stationId}`;
  probe.c19.panelText = text;
  const badge = document.querySelector("#sync-probe-station");
  if (badge) {
    badge.textContent = text;
  }
  if (speakingId !== null && spoken !== null && spoken.replyId !== "") {
    const last = probe.c19.scheduledRendered.at(-1);
    if (last?.stationId !== stationId || last?.actorId !== speakingId || last?.replyId !== spoken.replyId) {
      probe.c19.scheduledRendered.push({
        stationId,
        eventId: spoken.eventId,
        actorId: speakingId,
        replyId: spoken.replyId,
        atMs: Number(performance.now().toFixed(2)),
      });
    }
  }
}

export interface C19ScriptDeps {
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  enqueueSelectA1(): void;
  settlePreProbe(): Promise<void>;
  getSnapshot(): unknown;
  setStatus(text: string): void;
  setPoseStreaming(enabled: boolean): void;
  evidence: C19Evidence;
  publish(): void;
}

/**
 * C19 station loop: per blueprint station, watch the server-clock schedule
 * fire with no learner intent (the pre-encounter doorway probe is the only
 * intent the page sends). Renders every scheduled interjection while the
 * server speaks it, then follows the server rotation.
 */
export async function runC19Script(deps: C19ScriptDeps): Promise<void> {
  const { waitFor, enqueueSelectA1, settlePreProbe, getSnapshot, setStatus, setPoseStreaming, evidence, publish } = deps;
  const snapshot = (): unknown => getSnapshot();
  const render = (): void => {
    renderC19Panel({ c19: evidence }, snapshot());
  };
  const waitRendered = async (condition: () => boolean, timeoutMs: number, label: string): Promise<void> => {
    await waitFor(() => {
      render();
      return condition();
    }, timeoutMs, label);
  };
  setPoseStreaming(false);
  await waitRendered(() => {
    const station = observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]);
    return station.stationId !== "" && (station.stationCount ?? 0) > 0;
  }, 30000, "c19 blueprint stations");
  publish();
  const count = (observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationCount ?? 0) as number;
  for (let index = 0; index < count; index += 1) {
    await waitRendered(
      () => observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationIndex === index,
      30000,
      `c19 station index ${index}`,
    );
    if (index > 0) {
      setStatus(`sync-probe c19 station ${index} pre-encounter probe`);
      enqueueSelectA1();
      await settlePreProbe();
    }
    await waitRendered(
      () =>
        observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationIndex === index &&
        observedPhaseFrom(snapshot() as Parameters<typeof observedPhaseFrom>[0]).phase === "encounter",
      30000,
      `c19 station index ${index} encounter phase`,
    );
    if (index === 0) {
      setStatus("sync-probe c19 watching the server-clock schedule");
    }
    setStatus(`sync-probe c19 station ${index} waiting closed`);
    await waitRendered(
      () => {
        const current = observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationIndex;
        return (
          (current === index && observedPhaseFrom(snapshot() as Parameters<typeof observedPhaseFrom>[0]).phase === "closed") ||
          (index + 1 < count && current === index + 1)
        );
      },
      90000,
      `c19 station index ${index} closed phase`,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (index < count - 1) {
      await waitRendered(
        () => observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationIndex === index + 1,
        30000,
        `c19 station index ${index + 1} observed`,
      );
    }
  }
}
