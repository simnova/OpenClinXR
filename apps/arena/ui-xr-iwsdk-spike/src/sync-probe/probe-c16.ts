/**
 * C16 scenario-cast probe helpers: scenario title + cast panel and the dynamic station loop.
 *
 * Split out of sync-probe.ts for the file-size gate (sync-probe.ts sits at its
 * ceiling, so this module also owns the C16 evidence surface, published at
 * window.__syncProbeC16 instead of the shared __syncProbe object). The page
 * joins a cast blueprint server (no direct server calls beyond the existing
 * join/rotate flow) and renders the current station's scenario title plus its
 * cast actor ids as a visible panel (readable by the reviewer/learner),
 * recording every (stationId, scenarioId, sorted actorIds) it rendered across
 * the rotation. One cast actor per station is selected via the existing
 * select-actor intent and the ack/reject is recorded. The C3 turn script runs
 * verbatim in intent order against the selected cast actor (the shared
 * runC3TurnScript observes a1, which no cast station rosters, so the waits
 * observe the cast actor here; the sent intent sequence is identical).
 * Every export derives from SERVER state only; no page-local timing enters.
 */
import type { IntentKind } from "@openclinxr/xr-sync-client/headset";
import { observedPhaseFrom } from "./probe-c6.js";
import { observedStationFrom } from "./probe-c7.js";

/** One rendered station cast (SERVER values only, page clock). */
export interface C16StationCastEvent {
  stationId: string;
  scenarioId: string;
  scenarioTitle: string;
  actorIds: string[];
  /** Starting server emotions, read at first render (doorway, before any turn). */
  actorEmotions: Record<string, string>;
  atMs: number;
}

/** One page-driven select-actor settle (SERVER outcome, page clock). */
export interface C16SelectEvent {
  stationId: string;
  actorId: string;
  settled: "ack" | "reject";
  atMs: number;
}

/** Minimal probe evidence surface the C16 tracker updates. */
export interface C16Evidence {
  stationsRendered: C16StationCastEvent[];
  selects: C16SelectEvent[];
  /** Last panel text the page rendered (the current station's cast). */
  panelText: string;
}

/** Empty C16 evidence (no station seen, panel blank). */
export function createC16Evidence(): C16Evidence {
  return { stationsRendered: [], selects: [], panelText: "" };
}

declare global {
  interface Window {
    __syncProbeC16?: C16Evidence;
  }
}

/** Minimal server snapshot surface for the scenario cast. */
export interface C16CastView {
  stationId?: unknown;
  stationIndex?: unknown;
  stationCount?: unknown;
  scenarioId?: unknown;
  scenarioTitle?: unknown;
  turnId?: unknown;
  turnOwner?: unknown;
  actors?: Record<string, { speaking?: unknown; emotion?: unknown } | undefined>;
}

/** (scenarioId, scenarioTitle, sorted actorIds, emotions) read from a server snapshot. Pure function. */
export function observedCastOf(state: C16CastView | null | undefined): {
  stationId: string;
  scenarioId: string;
  scenarioTitle: string;
  actorIds: string[];
  emotions: Record<string, string>;
} {
  const stationId = typeof state?.stationId === "string" ? state.stationId : "";
  const scenarioId = typeof state?.scenarioId === "string" ? state.scenarioId : "";
  const scenarioTitle = typeof state?.scenarioTitle === "string" ? state.scenarioTitle : "";
  const actors = state?.actors ?? {};
  const actorIds = Object.keys(actors).sort();
  const emotions: Record<string, string> = {};
  for (const id of actorIds) {
    const emotion = (actors as Record<string, { emotion?: unknown } | undefined>)[id]?.emotion;
    emotions[id] = typeof emotion === "string" ? emotion : "";
  }
  return { stationId, scenarioId, scenarioTitle, actorIds, emotions };
}

/**
 * Render the visible cast panel from the SERVER snapshot and record one
 * stationsRendered entry when the SERVER station changes. Pure read of server
 * state plus a DOM write; called on every script poll so the doorway-time
 * (pre-turn) emotions are the starting ones.
 */
export function renderC16Panel(probe: { c16: C16Evidence }, snapshot: unknown): void {
  const cast = observedCastOf(snapshot as C16CastView);
  const text =
    cast.scenarioTitle !== "" ? `scenario: ${cast.scenarioTitle} cast: ${cast.actorIds.join(", ")}` : `station: ${cast.stationId}`;
  probe.c16.panelText = text;
  const badge = document.querySelector("#sync-probe-station");
  if (badge) {
    badge.textContent = text;
  }
  const last = probe.c16.stationsRendered.at(-1)?.stationId ?? null;
  if (cast.stationId !== "" && cast.stationId !== last) {
    probe.c16.stationsRendered.push({
      stationId: cast.stationId,
      scenarioId: cast.scenarioId,
      scenarioTitle: cast.scenarioTitle,
      actorIds: [...cast.actorIds],
      actorEmotions: { ...cast.emotions },
      atMs: Number(performance.now().toFixed(2)),
    });
  }
}

/** Status line for the current cast station (SERVER values only). */
export function c16StationStatus(snapshot: unknown): string {
  const cast = observedCastOf(snapshot as C16CastView);
  const station = observedStationFrom(snapshot as Parameters<typeof observedStationFrom>[0]);
  const shown = cast.scenarioTitle !== "" ? cast.scenarioTitle : station.stationId;
  if (station.stationIndex !== null && station.stationCount !== null) {
    return `${shown} ${station.stationIndex + 1}/${station.stationCount}`;
  }
  return shown;
}

/** (turnId, owner, speaking) for one cast actor, read from a server snapshot. Pure function. */
export function observedCastTurnFrom(
  state: C16CastView | null | undefined,
  actorId: string,
): { turnId: number; owner: string; speaking: boolean } {
  return {
    turnId: typeof state?.turnId === "number" ? state.turnId : -1,
    owner: typeof state?.turnOwner === "string" ? state.turnOwner : "",
    speaking: state?.actors?.[actorId]?.speaking === true,
  };
}

export interface C16ScriptDeps {
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  sendIntentAndSettle(kind: IntentKind, payload: Record<string, unknown>): Promise<void>;
  counts(): { sent: number; acks: number; rejects: number };
  enqueueSelectA1(): void;
  settlePreProbe(): Promise<void>;
  getSnapshot(): unknown;
  setStatus(text: string): void;
  setPoseStreaming(enabled: boolean): void;
  evidence: C16Evidence;
  publish(): void;
}

/**
 * C16 station loop: per blueprint station, select one cast actor via the
 * existing select-actor intent (ack recorded), reject a physician select
 * (unknown-actor recorded), run the C3 turn script against the cast actor,
 * then follow the server rotation. Pose stays off for the whole run so every
 * select settles 1:1 against the intent counters (the C7 pause rationale:
 * determinism over streaming evidence, which every other slice already proves).
 */
export async function runC16Script(deps: C16ScriptDeps): Promise<void> {
  const { waitFor, sendIntentAndSettle, counts, enqueueSelectA1, settlePreProbe, getSnapshot, setStatus, setPoseStreaming, evidence, publish } = deps;
  const snapshot = (): unknown => getSnapshot();
  const render = (): void => {
    renderC16Panel({ c16: evidence }, snapshot());
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
  const turnScriptFor = async (actorId: string): Promise<void> => {
    // Same sent intent sequence as runC3TurnScript (three learner utterance
    // pairs with a mid-turn interrupt); the waits observe the cast actor.
    const observedTurn = (): { turnId: number; owner: string; speaking: boolean } =>
      observedCastTurnFrom(snapshot() as C16CastView, actorId);
    await sendIntentAndSettle("utterance-start", {});
    await sendIntentAndSettle("utterance-end", {});
    await waitFor(() => {
      const turn = observedTurn();
      return turn.turnId === 1 && turn.speaking;
    }, 20000, "c16 turn 1 speaking");
    await waitFor(() => {
      const turn = observedTurn();
      return turn.turnId === 1 && !turn.speaking && turn.owner === "none";
    }, 20000, "c16 turn 1 completed on server clock");
    await sendIntentAndSettle("utterance-start", {});
    await sendIntentAndSettle("utterance-end", {});
    await waitFor(() => {
      const turn = observedTurn();
      return turn.turnId === 2 && turn.speaking;
    }, 20000, "c16 turn 2 speaking");
    await sendIntentAndSettle("utterance-start", {});
    await waitFor(() => {
      const turn = observedTurn();
      return turn.turnId === 2 && !turn.speaking && turn.owner === "learner";
    }, 20000, "c16 interrupt rendered");
    await sendIntentAndSettle("utterance-end", {});
    await waitFor(() => {
      const turn = observedTurn();
      return turn.turnId === 3 && turn.speaking;
    }, 20000, "c16 turn 3 speaking");
    await waitFor(() => {
      const turn = observedTurn();
      return turn.turnId === 3 && !turn.speaking && turn.owner === "none";
    }, 20000, "c16 turn 3 completed on server clock");
  };
  setPoseStreaming(false);
  await waitRendered(() => {
    const station = observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]);
    return station.stationId !== "" && (station.stationCount ?? 0) > 0;
  }, 30000, "c16 blueprint stations");
  publish();
  const count = (observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationCount ?? 0) as number;
  for (let index = 0; index < count; index += 1) {
    await waitRendered(
      () => observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationIndex === index,
      30000,
      `c16 station index ${index}`,
    );
    if (index > 0) {
      setStatus(`sync-probe c16 ${c16StationStatus(snapshot())} pre-encounter probe`);
      enqueueSelectA1();
      await settlePreProbe();
    }
    await waitRendered(
      () =>
        observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationIndex === index &&
        observedPhaseFrom(snapshot() as Parameters<typeof observedPhaseFrom>[0]).phase === "encounter",
      30000,
      `c16 station index ${index} encounter phase`,
    );
    const cast = observedCastOf(snapshot() as C16CastView);
    const castActor = cast.actorIds[0] as string;
    setStatus(`sync-probe c16 ${c16StationStatus(snapshot())} cast select`);
    await selectAndRecord(cast.stationId, castActor);
    // An outsider select must reject unknown-actor while still in encounter
    // (rejected intents never move the selection, so the turn script below
    // still addresses the cast actor).
    await selectAndRecord(cast.stationId, "physician");
    setStatus(`sync-probe c16 ${c16StationStatus(snapshot())} turn script`);
    await turnScriptFor(castActor);
    setStatus(`sync-probe c16 ${c16StationStatus(snapshot())} waiting closed`);
    // The server rotates only at "closed", so seeing the next station also
    // proves this one closed. Rotation can replace the closed snapshot within
    // one poll, so a wait on the current snapshot alone misses it.
    await waitRendered(
      () => {
        const current = observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationIndex;
        return (
          (current === index && observedPhaseFrom(snapshot() as Parameters<typeof observedPhaseFrom>[0]).phase === "closed") ||
          (index + 1 < count && current === index + 1)
        );
      },
      90000,
      `c16 station index ${index} closed phase`,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (index < count - 1) {
      await waitRendered(
        () => observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationIndex === index + 1,
        30000,
        `c16 station index ${index + 1} observed`,
      );
    }
  }
}
