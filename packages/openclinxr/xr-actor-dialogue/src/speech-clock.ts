import type { GeneratedHumanoidAnimationSlot } from "@openclinxr/xr-humanoid-animation";

/** userData key the animation loop stamps with the authoritative sim clock. */
export const SPEECH_CLOCK_USER_DATA_KEY = "openClinXrSpeechNowMs";

type SpeechClockSlotLike = Pick<GeneratedHumanoidAnimationSlot, "root"> | {
  root?: { userData?: Record<string, unknown> } | undefined;
} | undefined;

/**
 * Single-domain speech clock: the animation-loop sim time stamped on the
 * slot root, falling back to wall time only where no animated slot exists
 * (virtual device, missing slot, never-synced root).
 */
export function speechClockNowMs(slot: SpeechClockSlotLike, wallNowMs: number): number {
  const stamped = (slot as { root?: { userData?: Record<string, unknown> } } | undefined)?.root?.userData?.[SPEECH_CLOCK_USER_DATA_KEY];
  return typeof stamped === "number" && Number.isFinite(stamped) ? stamped : wallNowMs;
}

/** Remaining speech measured on the same clock that stamped its start. */
export function speechClockRemainingMs(
  activeSpeech: { startedAtMs: number; durationMs: number } | undefined,
  clockNowMs: number,
): number {
  if (!activeSpeech) return 0;
  return Math.max(0, activeSpeech.startedAtMs + activeSpeech.durationMs - clockNowMs);
}
