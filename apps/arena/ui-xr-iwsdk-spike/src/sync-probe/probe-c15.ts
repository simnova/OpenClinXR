/**
 * C15 exam-blueprint probe helpers: blueprint label panel + dynamic station loop.
 *
 * Split out of sync-probe.ts for the file-size gate. The page joins a
 * blueprint server (no direct server calls beyond the existing join/rotate
 * flow) and renders the current station's blueprint label as a visible panel
 * (readable by the reviewer/learner), recording every stationLabel it
 * rendered across the rotation. The station loop mirrors the C7 script (one
 * shared C3 turn script per station with server rotation) but discovers the
 * stations from SERVER state (stationIndex/stationCount) instead of
 * hard-coding ids, since the blueprint's slot ids come from the factory.
 * Every export derives from SERVER state only; no page-local timing enters.
 */
import type { IntentKind } from "@openclinxr/xr-sync-client/headset";
import { observedPhaseFrom, observedTurnFrom, runC3TurnScript } from "./probe-c6.js";
import { observedStationFrom } from "./probe-c7.js";

/** One rendered blueprint label (SERVER values only, page clock). */
export interface C15StationLabelEvent {
  stationId: string;
  stationLabel: string;
  atMs: number;
}

/** Minimal probe evidence surface the C15 tracker updates. */
export interface C15Evidence {
  labelsRendered: C15StationLabelEvent[];
  /** Last panel text the page rendered (the current slot label). */
  panelText: string;
}

/** Minimal server snapshot surface for the blueprint label. */
export interface C15LabelView {
  stationId?: unknown;
  stationIndex?: unknown;
  stationCount?: unknown;
  stationLabel?: unknown;
}

/** Empty C15 evidence (no station seen, panel blank). */
export function createC15Evidence(): C15Evidence {
  return { labelsRendered: [], panelText: "" };
}

/** Read the blueprint label from a server snapshot ("" when absent). */
export function observedStationLabelOf(state: C15LabelView | null | undefined): string {
  return typeof state?.stationLabel === "string" ? state.stationLabel : "";
}

/**
 * Track one server snapshot: always re-render the visible station panel from
 * the SERVER label, and record one labelsRendered entry when the SERVER
 * station changes. Pure read of server state plus a DOM write.
 */
export function trackC15Snapshot(probe: { c15: C15Evidence }, snapshot: unknown): void {
  const view = snapshot as C15LabelView;
  const stationId = typeof view.stationId === "string" ? view.stationId : "";
  const label = observedStationLabelOf(view);
  const text = label !== "" ? `station: ${label}` : `station: ${stationId}`;
  probe.c15.panelText = text;
  const badge = document.querySelector("#sync-probe-station");
  if (badge) {
    badge.textContent = text;
  }
  const last = probe.c15.labelsRendered.at(-1)?.stationId ?? null;
  if (stationId !== "" && stationId !== last) {
    probe.c15.labelsRendered.push({ stationId, stationLabel: label, atMs: Number(performance.now().toFixed(2)) });
  }
}

/** Status line for the current blueprint station (SERVER values only). */
export function c15StationStatus(snapshot: unknown): string {
  const view = snapshot as C15LabelView;
  const station = observedStationFrom(snapshot as Parameters<typeof observedStationFrom>[0]);
  const label = observedStationLabelOf(view);
  const shown = label !== "" ? label : station.stationId;
  if (station.stationIndex !== null && station.stationCount !== null) {
    return `${shown} ${station.stationIndex + 1}/${station.stationCount}`;
  }
  return shown;
}

export interface C15ScriptDeps {
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  sendIntentAndSettle(kind: IntentKind, payload: Record<string, unknown>): Promise<void>;
  aimAndTrigger(actorId: string, expectedIntents: number): Promise<void>;
  enqueueSelectA1(): void;
  settlePreProbe(): Promise<void>;
  getSnapshot(): unknown;
  setStatus(text: string): void;
  setPoseStreaming(enabled: boolean): void;
}

/**
 * C15 station loop: the shared C3 turn script once per blueprint station.
 * Station count comes from the SERVER snapshot; each station is entered by
 * stationIndex. Pose pauses across rotation (the C7 behaviour); the resumed
 * stream addresses the new room only after the next station is observed.
 */
export async function runC15Script(deps: C15ScriptDeps): Promise<void> {
  const { waitFor, sendIntentAndSettle, aimAndTrigger, enqueueSelectA1, settlePreProbe, getSnapshot, setStatus, setPoseStreaming } = deps;
  const snapshot = (): unknown => getSnapshot();
  const observedTurn = (): { turnId: number; owner: string; a1Speaking: boolean } =>
    observedTurnFrom(snapshot() as Parameters<typeof observedTurnFrom>[0]);
  const turnScript = (): Promise<void> => runC3TurnScript({ sendIntentAndSettle, observedTurn, waitFor });
  await waitFor(() => {
    const station = observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]);
    return station.stationId !== "" && (station.stationCount ?? 0) > 0;
  }, 30000, "c15 blueprint stations");
  const count = (observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationCount ?? 0) as number;
  for (let index = 0; index < count; index += 1) {
    await waitFor(
      () => observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationIndex === index,
      30000,
      `c15 station index ${index}`,
    );
    if (index > 0) {
      setStatus(`sync-probe c15 ${c15StationStatus(snapshot())} pre-encounter probe`);
      enqueueSelectA1();
      await settlePreProbe();
    }
    await waitFor(
      () =>
        observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationIndex === index &&
        observedPhaseFrom(snapshot() as Parameters<typeof observedPhaseFrom>[0]).phase === "encounter",
      30000,
      `c15 station index ${index} encounter phase`,
    );
    setStatus(`sync-probe c15 ${c15StationStatus(snapshot())} turn script`);
    await aimAndTrigger("a1", 1);
    await turnScript();
    // Pause pose across rotation (the C7 workaround); resume only after the
    // next station is observed, so resumed poses address the new room.
    setPoseStreaming(false);
    setStatus(`sync-probe c15 ${c15StationStatus(snapshot())} waiting closed`);
    // The server rotates only at "closed", so seeing the next station also
    // proves this one closed. Rotation can replace the closed snapshot within
    // one poll, so a wait on the current snapshot alone misses it.
    await waitFor(
      () => {
        const current = observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationIndex;
        return (
          (current === index && observedPhaseFrom(snapshot() as Parameters<typeof observedPhaseFrom>[0]).phase === "closed") ||
          (index + 1 < count && current === index + 1)
        );
      },
      90000,
      `c15 station index ${index} closed phase`,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (index < count - 1) {
      await waitFor(
        () => observedStationFrom(snapshot() as Parameters<typeof observedStationFrom>[0]).stationIndex === index + 1,
        30000,
        `c15 station index ${index + 1} observed`,
      );
      setPoseStreaming(true);
    }
  }
}
