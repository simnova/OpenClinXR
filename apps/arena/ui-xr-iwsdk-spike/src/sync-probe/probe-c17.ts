/**
 * C17 scenario-voice probe helpers: opening-caption panel + per-actor station loop.
 *
 * Split out of sync-probe.ts for the file-size gate (sync-probe.ts sits at
 * its ceiling, so this module also owns the C17 evidence surface, published
 * at window.__syncProbeC17 and attached onto window.__syncProbe like the C16
 * module does). The page joins a cast blueprint server (the c16 flow) and
 * addresses EVERY cast actor once per station with one utterance pair, so
 * each actor's first reply in the station is its scenario opening line. The
 * speaking actor's caption (SERVER state only) renders in the visible station
 * panel (readable by the learner in the headset); every (stationId, actorId,
 * replyId, caption) the page rendered is recorded. Emotion expectations stay
 * server-side (the harness reads them from server state). Every export
 * derives from SERVER state only; no page-local timing enters.
 */
import type { IntentKind } from "@openclinxr/xr-sync-client/headset";
import { observedPhaseFrom } from "./probe-c6.js";
import { observedStationFrom } from "./probe-c7.js";
import { observedCastOf, type C16CastView } from "./probe-c16.js";

/** One rendered opening caption (SERVER values only, page clock). */
export interface C17CaptionEvent {
  stationId: string;
  actorId: string;
  replyId: string;
  caption: string;
  atMs: number;
}

/** One page-driven select-actor settle (SERVER outcome, page clock). */
export interface C17SelectEvent {
  stationId: string;
  actorId: string;
  settled: "ack" | "reject";
  atMs: number;
}

/** Minimal probe evidence surface the C17 tracker updates. */
export interface C17Evidence {
  captionsRendered: C17CaptionEvent[];
  selects: C17SelectEvent[];
  /** Last panel text the page rendered (the speaking actor's caption, else the station line). */
  panelText: string;
}

/** Empty C17 evidence (no caption seen, panel blank). */
export function createC17Evidence(): C17Evidence {
  return { captionsRendered: [], selects: [], panelText: "" };
}

declare global {
  interface Window {
    __syncProbeC17?: C17Evidence;
  }
}

/** Minimal server snapshot surface for the caption panel. */
export interface C17CaptionView extends C16CastView {
  actors?: Record<string, { speaking?: unknown; emotion?: unknown; replyId?: unknown; caption?: unknown } | undefined>;
}

/** (actorId, replyId, caption, speaking) for one actor, read from a server snapshot. Pure function. */
export function observedCaptionOf(
  state: C17CaptionView | null | undefined,
  actorId: string,
): { replyId: string; caption: string; speaking: boolean } {
  const actor = state?.actors?.[actorId];
  return {
    replyId: typeof actor?.replyId === "string" ? (actor.replyId as string) : "",
    caption: typeof actor?.caption === "string" ? (actor.caption as string) : "",
    speaking: actor?.speaking === true,
  };
}

/**
 * Render the visible caption panel from the SERVER snapshot and record one
 * captionsRendered entry per speaking actor reply. Pure read of server state
 * plus a DOM write; called on every script poll so the caption is captured
 * while the server says the actor is speaking.
 */
export function renderC17Panel(probe: { c17: C17Evidence }, snapshot: unknown): void {
  const view = snapshot as C17CaptionView;
  const stationId = typeof view.stationId === "string" ? view.stationId : "";
  const speakingId = [...Object.keys(view.actors ?? {})].sort().find((id) => observedCaptionOf(view, id).speaking) ?? null;
  const spoken = speakingId !== null ? observedCaptionOf(view, speakingId) : null;
  const text = spoken !== null && spoken.caption !== "" ? spoken.caption : `station: ${stationId}`;
  probe.c17.panelText = text;
  const badge = document.querySelector("#sync-probe-station");
  if (badge) {
    badge.textContent = text;
  }
  if (speakingId !== null && spoken !== null && spoken.caption !== "") {
    const last = probe.c17.captionsRendered.at(-1);
    if (last?.stationId !== stationId || last?.actorId !== speakingId || last?.replyId !== spoken.replyId) {
      probe.c17.captionsRendered.push({
        stationId,
        actorId: speakingId,
        replyId: spoken.replyId,
        caption: spoken.caption,
        atMs: Number(performance.now().toFixed(2)),
      });
    }
  }
}

/** Status line for the current cast station (SERVER values only). */
export function c17StationStatus(snapshot: unknown): string {
  const cast = observedCastOf(snapshot as C16CastView);
  const station = observedStationFrom(snapshot as Parameters<typeof observedStationFrom>[0]);
  const shown = cast.scenarioTitle !== "" ? cast.scenarioTitle : station.stationId;
  if (station.stationIndex !== null && station.stationCount !== null) {
    return `${shown} ${station.stationIndex + 1}/${station.stationCount}`;
  }
  return shown;
}

export interface C17ScriptDeps {
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  sendIntentAndSettle(kind: IntentKind, payload: Record<string, unknown>): Promise<void>;
  counts(): { sent: number; acks: number; rejects: number };
  enqueueSelectA1(): void;
  settlePreProbe(): Promise<void>;
  getSnapshot(): unknown;
  setStatus(text: string): void;
  setPoseStreaming(enabled: boolean): void;
  evidence: C17Evidence;
  publish(): void;
}

/**
 * C17 station loop: per blueprint station, address EVERY cast actor once
 * (select-actor + one utterance pair each, in sorted actor order) so each
 * actor's first reply in the station is its scenario opening line, rendering
 * each caption while the server speaks it. Pose stays off for the whole run
 * (the C16 rationale: determinism over streaming evidence). Follows the
 * server rotation like the C16 loop.
 */
export async function runC17Script(deps: C17ScriptDeps): Promise<void> {
  const { waitFor, sendIntentAndSettle, counts, enqueueSelectA1, settlePreProbe, getSnapshot, setStatus, setPoseStreaming, evidence, publish } = deps;
  const snapshot = (): unknown => getSnapshot();
  const render = (): void => {
    renderC17Panel({ c17: evidence }, snapshot());
  };
  const waitRendered = async (condition: () => boolean, timeoutMs: number, label: string): Promise<void> => {
    await waitFor(() => {
      render();
      return condition();
    }, timeoutMs, label);
  };
  const selectAndRecord = async (stationId: string, actorId: string): Promise<void> => {
    const before = counts();
    await sendIntentAndSettle("select-actor", { actorId });
    const after = counts();
    evidence.selects.push({
      stationId,
      actorId,
      settled: after.acks > before.acks ? "ack" : "reject",
      atMs: Number(performance.now().toFixed(2)),
    });
    publish();
  };
  const openingTurnFor = async (stationId: string, actorId: string): Promise<void> => {
    await selectAndRecord(stationId, actorId);
    await sendIntentAndSettle("utterance-start", {});
    await sendIntentAndSettle("utterance-end", {});
    await waitRendered(() => observedCaptionOf(snapshot() as C17CaptionView, actorId).speaking, 20000, `c17 ${actorId} opening speaking`);
    render();
    publish();
    await waitRendered(() => {
      const seen = observedCaptionOf(snapshot() as C17CaptionView, actorId);
      return !seen.speaking;
    }, 20000, `c17 ${actorId} opening completed on server clock`);
    publish();
  };
  setPoseStreaming(false);
  await waitRendered(() => {
    const station = observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]);
    return station.stationId !== "" && (station.stationCount ?? 0) > 0;
  }, 30000, "c17 blueprint stations");
  publish();
  const count = (observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationCount ?? 0) as number;
  for (let index = 0; index < count; index += 1) {
    await waitRendered(
      () => observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationIndex === index,
      30000,
      `c17 station index ${index}`,
    );
    if (index > 0) {
      setStatus(`sync-probe c17 ${c17StationStatus(snapshot())} pre-encounter probe`);
      enqueueSelectA1();
      await settlePreProbe();
    }
    await waitRendered(
      () =>
        observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationIndex === index &&
        observedPhaseFrom(snapshot() as Parameters<typeof observedPhaseFrom>[0]).phase === "encounter",
      30000,
      `c17 station index ${index} encounter phase`,
    );
    const cast = observedCastOf(snapshot() as C16CastView);
    setStatus(`sync-probe c17 ${c17StationStatus(snapshot())} opening lines`);
    for (const actorId of cast.actorIds) {
      await openingTurnFor(cast.stationId, actorId);
    }
    setStatus(`sync-probe c17 ${c17StationStatus(snapshot())} waiting closed`);
    await waitRendered(
      () => {
        const current = observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationIndex;
        return (
          (current === index && observedPhaseFrom(snapshot() as Parameters<typeof observedPhaseFrom>[0]).phase === "closed") ||
          (index + 1 < count && current === index + 1)
        );
      },
      90000,
      `c17 station index ${index} closed phase`,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (index < count - 1) {
      await waitRendered(
        () => observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationIndex === index + 1,
        30000,
        `c17 station index ${index + 1} observed`,
      );
    }
  }
}
