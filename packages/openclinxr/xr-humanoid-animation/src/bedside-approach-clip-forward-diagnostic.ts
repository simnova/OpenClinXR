/**
 * DIAGNOSTIC (2026-09-26): publish the runtime's own measured clip forward/timeScale, additive
 * like every other `__openClinXr*Evidence` global in this package. `forward` is exactly the vector
 * `travelYawForClipForward` (xr-runtime-state) aligns to the route heading; a mismatch between it
 * and the rig's own body-local stepping axis is what makes the body face one way while stepping
 * another ("crabbing") -- the kimodo cagematch round-12 finding this exists to make checkable
 * without re-deriving it offline.
 *
 * claimScope: the runtime's own measured stance-advance vector and playback timeScale for the
 * currently-resolved bedside approach.
 * notEvidenceFor: gait realism, clinical plausibility, Quest performance.
 */
export function publishClipForwardDiagnostic(
  rateOneAdvance: { metersPerSecond: number; forward: { x: number; z: number }; windowFrames: number },
  playbackTimeScale: number,
): void {
  const host = (globalThis as unknown as { window?: Record<string, unknown> }).window
    ?? (globalThis as unknown as Record<string, unknown>);
  host["__openClinXrBedsideApproachClipForwardDiagnostic"] = {
    schemaVersion: "openclinxr.bedside-approach-clip-forward-diagnostic.v1",
    rateOneAdvance,
    playbackTimeScale,
    scaledMetersPerSecond: rateOneAdvance.metersPerSecond * playbackTimeScale,
    clipYawDeg: (Math.atan2(rateOneAdvance.forward.x, rateOneAdvance.forward.z) * 180) / Math.PI,
  };
}
