/**
 * Entry-anchored idle-life phase for locomotion-driven slots (walk-start
 * determinism). A driven slot's idle-life phase (breathing, sway, lean)
 * runs on drive age accumulated from the first driven frame, not on `nowMs`
 * whose sim-time anchor is the first frame's wall clock: the wall anchor
 * made the physical feet at walking entry differ run to run (measured
 * 4.5 mm right-toe across identical SC-05 starts), and the foot-base entry
 * footholds baked that offset into the whole walk. The stagger is a stable
 * hash of the scenario actorId rather than creation order
 * (`animationSlots().length * 480` at load), which async GLB completion
 * order shifts run to run (measured offset 0 vs 960 ms with the age clock
 * otherwise bit-identical). Rate and shape are unchanged; undriven slots
 * and the deterministic capture clock keep the legacy path exactly.
 * Nothing here is package-public: deep import from the frame loop only.
 */
import type { HumanoidRuntimeDrive } from "./types.js";

const driveAgeMs = new WeakMap<object, number>();

function stableActorPhaseOffsetMs(actorId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < actorId.length; index += 1) {
    hash ^= actorId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 960;
}

export function resolveIdleLifePhaseSeconds(
  slot: { actorId: string; phaseOffsetMs: number },
  drive: HumanoidRuntimeDrive | ReadonlyMap<string, HumanoidRuntimeDrive> | null,
  deltaSeconds: number,
  nowMs: number,
  deterministic: boolean,
): number {
  const slotDrive = drive instanceof Map ? (drive.get(slot.actorId) ?? null) : (drive ?? null);
  const applies = slotDrive?.actorId === undefined || slotDrive.actorId === slot.actorId;
  if (slotDrive !== null && applies && !deterministic) {
    const ageMs = (driveAgeMs.get(slot) ?? 0) + deltaSeconds * 1000;
    driveAgeMs.set(slot, ageMs);
    return (ageMs + stableActorPhaseOffsetMs(slot.actorId)) / 1000;
  }
  driveAgeMs.delete(slot);
  return (nowMs + slot.phaseOffsetMs) / 1000;
}
