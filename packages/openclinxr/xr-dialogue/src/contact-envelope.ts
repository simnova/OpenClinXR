/**
 * Anticipatory symmetric contact envelope for the prepared-audio runtime path (internal only).
 *
 * Contact visemes (PP/FF/TH) used to snap or hurry onto their shape in about one
 * frame (PP snap in viseme-lip-dynamics.ts and viseme-jaw-dynamics.ts, deadline
 * follower omega = 2X/D with X = DEADLINE_X): step3 capture mean|dpx| peaked at
 * 5.42 at contact transitions. This envelope reaches the contact shape on the
 * same cue with a bounded slope instead. S(x) = 3x^2-2x^3 clamped to [0,1];
 * for a cue [s,e], u(t) = S((t-(s-A))/A) * (1-S((t-e)/R)) with A = R = 200 ms
 * (six 30 fps frames). The 200 ms is a capture-derived bound, not a physiology
 * claim: the steepest smoothstep slope (1.5 per unit x) over A gives at most
 * 1.5*(1/30)/0.2 = 0.25 applied-weight change per 30 fps frame, the largest
 * step the capture still reads as continuous. If the per-frame bound fails,
 * lengthen A and R; never restore a snap.
 */

export const CONTACT_ATTACK_S = 0.2;
export const CONTACT_RELEASE_S = 0.2;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Smoothstep S(x) = 3x^2-2x^3 clamped to [0,1]. */
export function contactSmoothstep(value: number): number {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
}

/**
 * Envelope value at media time for one contact cue. Rises 0 -> 1 over
 * [s-A, s], holds 1 over [s, e], releases 1 -> 0 over [e, e+R].
 * Non-finite inputs read 0 (silence direction, never NaN weights).
 */
export function contactEnvelope(
  timeS: number,
  startS: number,
  endS: number,
  attackS: number = CONTACT_ATTACK_S,
  releaseS: number = CONTACT_RELEASE_S,
): number {
  if (!Number.isFinite(timeS) || !Number.isFinite(startS) || !Number.isFinite(endS)) return 0;
  if (!(attackS > 0) || !(releaseS > 0)) return 0;
  return (
    contactSmoothstep((timeS - (startS - attackS)) / attackS) *
    (1 - contactSmoothstep((timeS - endS) / releaseS))
  );
}
