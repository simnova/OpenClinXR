/**
 * C18 faculty replay of a recorded cast station: visible replyId + emotion
 * panel plus the per-render record the harness checks.
 *
 * Split out of sync-probe.ts for the file-size gate (same ceiling rationale
 * as the C16/C17 modules: this module owns and publishes window.__syncProbeC18
 * itself). The page joins a replay server (the C10 flow: one select-actor that
 * must reject replay-read-only, then watch the recorded station play into
 * state). On every poll the page renders the replayed actors' replyIds and
 * emotions into the visible station panel (readable in the headset) and
 * records every (stationId, actorId, replyId, emotion) it rendered. Every
 * export derives from SERVER state only; no page-local timing enters.
 */
import type { IntentKind } from "@openclinxr/xr-sync-client/headset";

/** One rendered replayed turn (SERVER values only, page clock). */
export interface C18RenderedEvent {
  stationId: string;
  actorId: string;
  replyId: string;
  emotion: string;
  atMs: number;
}

/** Minimal probe evidence surface the C18 tracker updates. */
export interface C18Evidence {
  rendered: C18RenderedEvent[];
  /** Last panel text the page rendered (the replayed actor lines, else the station line). */
  panelText: string;
}

/** Empty C18 evidence (nothing rendered, panel blank). */
export function createC18Evidence(): C18Evidence {
  return { rendered: [], panelText: "" };
}

declare global {
  interface Window {
    __syncProbeC18?: C18Evidence;
  }
}

/** Minimal server snapshot surface for the replay panel. */
export interface C18ReplayView {
  stationId?: unknown;
  actors?: Record<string, { speaking?: unknown; replyId?: unknown; emotion?: unknown } | undefined>;
}

/** (replyId, emotion, speaking) for one actor, read from a server snapshot. Pure function. */
export function observedReplayOf(
  state: C18ReplayView | null | undefined,
  actorId: string,
): { replyId: string; emotion: string; speaking: boolean } {
  const actor = state?.actors?.[actorId];
  return {
    replyId: typeof actor?.replyId === "string" ? (actor.replyId as string) : "",
    emotion: typeof actor?.emotion === "string" ? (actor.emotion as string) : "",
    speaking: actor?.speaking === true,
  };
}

/**
 * Render the visible replay panel from the SERVER snapshot and record one
 * rendered entry per speaking actor reply. Pure read of server state plus a
 * DOM write; called on every script poll so the replyId/emotion pair is
 * captured while the server says the actor is speaking.
 */
export function renderC18Panel(probe: { c18: C18Evidence }, snapshot: unknown): void {
  const view = snapshot as C18ReplayView;
  const stationId = typeof view.stationId === "string" ? view.stationId : "";
  const actors = view.actors ?? {};
  const speakingId = [...Object.keys(actors)].sort().find((id) => observedReplayOf(view, id).speaking) ?? null;
  const text =
    speakingId !== null
      ? (() => {
          const seen = observedReplayOf(view, speakingId);
          return `replay ${stationId} ${speakingId} ${seen.replyId} ${seen.emotion}`;
        })()
      : `replay station: ${stationId}`;
  probe.c18.panelText = text;
  const badge = document.querySelector("#sync-probe-station");
  if (badge) {
    badge.textContent = text;
  }
  if (speakingId !== null) {
    const seen = observedReplayOf(view, speakingId);
    if (seen.replyId !== "") {
      const last = probe.c18.rendered.at(-1);
      if (last?.stationId !== stationId || last?.actorId !== speakingId || last?.replyId !== seen.replyId) {
        probe.c18.rendered.push({
          stationId,
          actorId: speakingId,
          replyId: seen.replyId,
          emotion: seen.emotion,
          atMs: Number(performance.now().toFixed(2)),
        });
      }
    }
  }
}

export interface C18ScriptDeps {
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  sendIntentAndSettle(kind: IntentKind, payload: Record<string, unknown>): Promise<void>;
  getSnapshot(): unknown;
  setStatus(text: string): void;
  evidence: C18Evidence;
  publish(): void;
}

/**
 * C18 faculty replay script: the C10 flow verbatim (one select-actor, which
 * must reject replay-read-only) plus the visible replyId/emotion panel above.
 * Finishes when the server reports replayDone. Pose streaming is disabled by
 * the caller. No new learner intents: the single select-actor is the C10
 * read-only probe, not a turn driver.
 */
export async function runC18Script(deps: C18ScriptDeps): Promise<void> {
  const { waitFor, sendIntentAndSettle, getSnapshot, setStatus, evidence, publish } = deps;
  const snapshot = (): unknown => getSnapshot();
  const render = (): void => {
    renderC18Panel({ c18: evidence }, snapshot());
  };
  setStatus("sync-probe c18 faculty replay of the recorded cast station");
  await sendIntentAndSettle("select-actor", { actorId: "a1" });
  publish();
  await waitFor(
    () => {
      render();
      publish();
      const state = snapshot() as { replayDone?: unknown };
      return state.replayDone === true;
    },
    120000,
    "c18 replay done",
  );
  render();
  publish();
}
