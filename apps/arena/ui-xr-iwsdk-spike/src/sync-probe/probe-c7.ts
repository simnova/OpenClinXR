/**
 * C7 probe helpers: pure server snapshot readers plus the per-station script.
 *
 * Split out of sync-probe.ts for the file-size gate. The C7 script runs the
 * shared C3 turn script verbatim (never forked) once per station: wait server
 * encounter, run the script, wait closed, follow the server rotation, repeat
 * in station 2, finish when station 2 closes. Every export derives from
 * SERVER state only; no page-local timing enters.
 */
import type { IntentKind } from "@openclinxr/xr-sync-client/headset";
import { observedPhaseFrom, observedTurnFrom, runC3TurnScript } from "./probe-c6.js";
import { resolvePhaseLabel, resolveStationLabel } from "./probe-state.js";

/** Minimal server snapshot surface the station waits read. */
export interface C7StationView {
  stationId?: unknown;
  stationIndex?: unknown;
  stationCount?: unknown;
}

/** (stationId, stationIndex, stationCount) read from a server snapshot. Pure function. */
export function observedStationFrom(state: C7StationView | null | undefined): {
  stationId: string;
  stationIndex: number | null;
  stationCount: number | null;
} {
  return {
    stationId: typeof state?.stationId === "string" ? state.stationId : "",
    stationIndex: typeof state?.stationIndex === "number" ? state.stationIndex : null,
    stationCount: typeof state?.stationCount === "number" ? state.stationCount : null,
  };
}

/**
 * Next station observation for the probe evidence: returns the updated
 * last-seen id plus a stationsObserved entry when the SERVER station
 * changes. Pure function of (lastSeen, snapshot); the caller holds lastSeen.
 */
export function nextStationObservation(
  lastSeen: string | null,
  snapshot: unknown,
): { lastSeen: string | null; event: { stationId: string; atMs: number } | null } {
  const station = observedStationFrom(snapshot as C7StationView);
  if (station.stationId === "" || station.stationId === lastSeen) {
    return { lastSeen, event: null };
  }
  return {
    lastSeen: station.stationId,
    event: { stationId: station.stationId, atMs: Number(performance.now().toFixed(2)) },
  };
}

export interface C7ScriptDeps {
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  sendIntentAndSettle(kind: IntentKind, payload: Record<string, unknown>): Promise<void>;
  aimAndTrigger(actorId: string, expectedIntents: number): Promise<void>;
  enqueueSelectA1(): void;
  settlePreProbe(): Promise<void>;
  getSnapshot(): unknown;
  setStatus(text: string): void;
  setPoseStreaming(enabled: boolean): void;
  /** C8: leave pose streaming on across rotation (the C7 pause was a D1 workaround; C8 proves lossless). */
  keepPoseAcrossRotation?: boolean;
}

function stationLabelOf(snapshot: unknown): string {
  const station = observedStationFrom(snapshot as C7StationView);
  return resolveStationLabel(station.stationId, station.stationIndex, station.stationCount);
}

function phaseLabelOf(snapshot: unknown): { phase: string; remainingS: number | null } {
  return observedPhaseFrom(snapshot as { phase?: unknown; phaseRemainingS?: unknown });
}

/**
 * C7 station loop: the shared C3 turn script once per station. Station-1's
 * pre-encounter probe ran at connect; station-2 probes after rotation lands
 * in the new room's doorway. C7 pauses pose across rotation (E5: exactly 2
 * rejects, both pre-encounter probes); C8 passes keepPoseAcrossRotation to
 * leave it on and prove rotation is lossless.
 */
export async function runC7Script(deps: C7ScriptDeps): Promise<void> {
  const { waitFor, sendIntentAndSettle, aimAndTrigger, enqueueSelectA1, settlePreProbe, getSnapshot, setStatus, setPoseStreaming } =
    deps;
  const keepPose = deps.keepPoseAcrossRotation === true;
  const snapshot = (): unknown => getSnapshot();
  const observedTurn = (): { turnId: number; owner: string; a1Speaking: boolean } =>
    observedTurnFrom(snapshot() as Parameters<typeof observedTurnFrom>[0]);
  const turnScript = (): Promise<void> => runC3TurnScript({ sendIntentAndSettle, observedTurn, waitFor });
  const stations = ["station-1", "station-2"];
  for (let index = 0; index < stations.length; index += 1) {
    const want = stations[index] as string;
    await waitFor(() => observedStationFrom(snapshot() as C7StationView).stationId === want, 30000, `station ${want}`);
    if (index > 0) {
      setStatus(`sync-probe c7 ${stationLabelOf(snapshot())} pre-encounter probe`);
      enqueueSelectA1();
      await settlePreProbe();
    }
    await waitFor(
      () =>
        observedStationFrom(snapshot() as C7StationView).stationId === want &&
        phaseLabelOf(snapshot()).phase === "encounter",
      30000,
      `station ${want} encounter phase`,
    );
    setStatus(
      `sync-probe c7 ${stationLabelOf(snapshot())} ${resolvePhaseLabel(phaseLabelOf(snapshot()).phase, phaseLabelOf(snapshot()).remainingS)} turn script`,
    );
    await aimAndTrigger("a1", 1);
    await turnScript();
    // C7 pauses pose across rotation (the D1 workaround); C8 leaves it on.
    // Resume only after the next station is observed (post-rotation), so
    // resumed poses address the new room.
    if (!keepPose) {
      setPoseStreaming(false);
    }
    setStatus(`sync-probe c7 ${stationLabelOf(snapshot())} waiting closed`);
    // The server rotates only at "closed", so seeing the next station also
    // proves this one closed. Rotation can replace the closed snapshot within
    // one poll (host measured 26 ms closed-to-doorway), so a wait on the
    // current snapshot alone misses it.
    const nextStation = stations[index + 1];
    await waitFor(
      () => {
        const current = observedStationFrom(snapshot() as C7StationView).stationId;
        return (current === want && phaseLabelOf(snapshot()).phase === "closed") || (nextStation !== undefined && current === nextStation);
      },
      90000,
      `station ${want} closed phase`,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (index < stations.length - 1) {
      const nextWant = stations[index + 1] as string;
      await waitFor(
        () => observedStationFrom(snapshot() as C7StationView).stationId === nextWant,
        30000,
        `station ${nextWant} observed`,
      );
      setPoseStreaming(true);
    }
  }
}
