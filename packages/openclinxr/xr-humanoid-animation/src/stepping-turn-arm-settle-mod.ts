/**
 * Stepping-turn arm settle (arms slice): pin the locomotion upper-body
 * crossfade to 0 while the stepping turn owns the legs, so the posture
 * pass writes the hang on the first settling frame instead of riding the
 * 0.5 s blend-out through the turn (measured 28-29 deg shoulder abduction
 * on SC-05 settling frames 44-49 against a <= 20 deg gate).
 *
 * Legs are untouched: the leg-weight ramp state is a separate userData key
 * and keeps its smooth 0.3 s ramp (stance timing frozen). Idempotent:
 * re-pinning 0 is a no-op, and a turn abort back to walking re-ramps 0->1
 * over the blend-in. Crossfade key owned by locomotion-clip-playback-mod
 * (same direct-userData discipline as seedLocomotionLegWeight in
 * stop-clip-playback-mod). Called from the stepping-owns-legs handoff in
 * case-owned-approach-frame-mod.ts, which runs before the animation loop
 * consumes the weight in the same rAF.
 */
export function pinSteppingTurnArmHang(stanceLabelSlotRoot: unknown): void {
  const rootUserData = (
    stanceLabelSlotRoot as unknown as { userData?: Record<string, unknown> } | null | undefined
  )?.userData;
  if (rootUserData === undefined || rootUserData === null) return;
  rootUserData["openClinXrLocomotionCrossfade"] = { weight: 0, targetWeight: 0 };
}
