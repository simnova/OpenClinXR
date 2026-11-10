/** Wall-clock laps for the supine plant: per recordPlantStep, per later phase, and the whole call. */
import type { Object3D } from "three";

const plantClock = new WeakMap<Object3D, number>();

/** Milliseconds since the previous lap of this root (0 for the first lap). */
export function plantLap(root: Object3D): number {
  const now = performance.now();
  const ms = now - (plantClock.get(root) ?? now);
  plantClock.set(root, now);
  return ms;
}

export function restartPlantClock(root: Object3D): void {
  plantClock.set(root, performance.now());
}

export function startPlantClock(root: Object3D): number {
  root.userData["openClinXrPlantPhases"] = [];
  const startMs = performance.now();
  plantClock.set(root, startMs);
  return startMs;
}

export function recordPlantPhase(root: Object3D, phase: string): void {
  const phases = (root.userData["openClinXrPlantPhases"] as { phase: string; ms: number }[] | undefined) ?? [];
  phases.push({ phase, ms: plantLap(root) });
  root.userData["openClinXrPlantPhases"] = phases;
}

export function finishPlantClock(root: Object3D, startMs: number): void {
  root.userData["openClinXrPlantTotalMs"] = performance.now() - startMs;
}
