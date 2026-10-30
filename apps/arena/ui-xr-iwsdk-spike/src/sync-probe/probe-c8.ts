/**
 * C8 probe helpers: observer badge + lossless station loop.
 *
 * Split out of sync-probe.ts for the file-size gate. The C8 script imports
 * the C7 station loop (never forks it) with pose streaming left on across
 * rotation; observer presence follows the SERVER only (pure functions of
 * stationId/observerCount, recorded read-only for the harness).
 */
import type { SyncConnection } from "@openclinxr/xr-sync-client/headset";
import { nextStationObservation } from "./probe-c7.js";

/** C8 rotation-failed evidence entry (client-surfaced, page clock). */
export interface C8RotationFailedEvent {
  stationId: string;
  atMs: number;
}

/** C8 observer-count evidence entry (SERVER values only). */
export interface C8ObserverCountEvent {
  stationId: string;
  observerCount: number;
  atMs: number;
}

/** Minimal probe evidence surface the C8 trackers update. */
export interface C8ProbeEvidence {
  stationsObserved: Array<{ stationId: string; atMs: number; pageLoadId: string }>;
  observerCountsObserved: C8ObserverCountEvent[];
  rotationFaileds: C8RotationFailedEvent[];
  pageLoadId: string;
}

/** Minimal server snapshot surface for C8 presence. */
export interface C8PresenceView {
  stationId?: unknown;
  observerCount?: unknown;
}

/** Update the observer badge from SERVER state (DOM write only). */
export function updateC8ObserverBadge(stationId: string, observerCount: number): void {
  const badge = document.querySelector("#sync-probe-observers");
  if (badge) {
    badge.textContent = `observers: ${observerCount} @ ${stationId}`;
  }
}

/** Record one station observation with the page load id (no-reload proof). */
export function pushC8StationObservation(
  probe: C8ProbeEvidence,
  lastSeen: string | null,
  snapshot: unknown,
): string | null {
  const update = nextStationObservation(lastSeen, snapshot);
  if (update.event !== null) {
    probe.stationsObserved.push({ ...update.event, pageLoadId: probe.pageLoadId });
  }
  return update.lastSeen;
}

/** Attach the typed rotation-failed listener (no station choice). */
export function attachC8RotationFailed(connection: SyncConnection, probe: C8ProbeEvidence): void {
  connection.onRotationFailed((info) => {
    probe.rotationFaileds.push({ stationId: info.stationId, atMs: Number(performance.now().toFixed(2)) });
  });
}

/** Create the per-snapshot observer tracker (SERVER values only). */
export function createC8ObserverTracker(probe: C8ProbeEvidence): (snapshot: unknown) => void {
  let last: { stationId: string; observerCount: number } | null = null;
  return (snapshot: unknown): void => {
    const view = snapshot as C8PresenceView;
    if (typeof view.stationId === "string" && typeof view.observerCount === "number") {
      if (last === null || last.stationId !== view.stationId || last.observerCount !== view.observerCount) {
        last = { stationId: view.stationId, observerCount: view.observerCount };
        probe.observerCountsObserved.push({ ...last, atMs: Number(performance.now().toFixed(2)) });
        updateC8ObserverBadge(view.stationId, view.observerCount);
      }
    }
  };
}
