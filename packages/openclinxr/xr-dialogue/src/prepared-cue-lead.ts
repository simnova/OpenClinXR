/**
 * Per-channel cue leads for the prepared-audio runtime path (internal only).
 *
 * The old uniform RUNTIME_CUE_LEAD_S (1/3 s, sized for the jaw) put lip and
 * contact events ~300 ms early. Each channel now leads by its own group delay
 * at its operating point. Closed forms for H(s) = w^2/(s^2+2ws+w^2), whose DC
 * group delay is tau = 2/w:
 * - jaw spring (w = 6): tau_jaw = 2/6 = 1/3 s. OrdinaryLeadS is passed in as
 *   2/jawDynamicsConstants.naturalFrequency by the jaw call site.
 * - ordinary lip follower (w = 14): tau_lip = 2/14 = 1/7 s. Passed in as
 *   2/lipDynamicsConstants.naturalFrequency by the lip call site.
 * - PP snap assigns the exact closure target with no dynamics: tau_pp = 0.
 * - FF/TH deadline follower runs hurried at omega_c = 2X/D with X =
 *   DEADLINE_X below: tau_c = 2/omega_c = D/X (step3 FF: 0.07/6 ~= 11.7 ms).
 *
 * Contact precedence: the compensated sample never lands inside (or past) a
 * contact cue that starts after the media time. Prefetching an ordinary lead
 * across a 60-70 ms contact would show post-contact decay before the contact
 * (measured: FF 0.94 one frame before its cue); the sample holds at one fixed
 * step before the contact start instead. No signature changes: callers pass
 * the cues and media time they already hold.
 */

export type LeadChannel = "lip" | "jaw";

/**
 * Deadline gain for the contact follower. A critically damped step reaches
 * 0.9 when 1 - e^-x(1+x) = 0.1, i.e. x = 3.8897; x = 6.0 hurries the steep
 * end of the lip-travel curve onto the contact (measured on the 70 ms FF:
 * x = 4.3 centres at 0.905 with a 1.09 mm edge gap, x = 5.5 centres at
 * 0.947 with a 0.51 mm gap, x = 6.0 centres at ~0.97 inside the gate).
 * Hurrying a D-second cue with omega = 2x/D reaches applied weight >= 0.9
 * at its centre (T = D/2).
 */
export const DEADLINE_X = 6.0;

/** Cues whose onset the compensated sample must not cross (OVR spellings). */
const LIP_CONTACT = new Set(["PP", "FF", "TH"]);
const JAW_CONTACT = new Set(["PP"]);

export function contactLeadS(channel: LeadChannel, phoneme: string, durationS: number): number | null {
  const contacts = channel === "lip" ? LIP_CONTACT : JAW_CONTACT;
  if (!contacts.has(phoneme)) return null;
  if (phoneme === "PP") return 0;
  return durationS > 0 && Number.isFinite(durationS) ? durationS / DEADLINE_X : 0;
}

type CueLike = { phoneme: string; atSecond: number; durationSeconds?: number };

function cueIndexAt(cues: readonly CueLike[], timeS: number): number {
  return cues.findIndex((cue) => timeS >= cue.atSecond && timeS < cue.atSecond + (cue.durationSeconds ?? 0));
}

/**
 * Media time -> follower sample time for one channel. Pure function of its
 * inputs; the followers stay on their original cue arrays, so their tuning
 * (gains, deadline hurry, snap) is untouched.
 */
export function compensatedSampleTimeS(
  cues: readonly CueLike[],
  timeS: number,
  channel: LeadChannel,
  ordinaryLeadS: number,
  fixedStepS = 1 / 240,
): number {
  const active = cueIndexAt(cues, timeS);
  const own = active < 0 ? null : contactLeadS(channel, cues[active]?.phoneme ?? "", cues[active]?.durationSeconds ?? 0);
  const lead = own ?? ordinaryLeadS;
  let sample = timeS + lead;
  const contacts = channel === "lip" ? LIP_CONTACT : JAW_CONTACT;
  for (const cue of cues) {
    if (!contacts.has(cue.phoneme)) continue;
    if (cue.atSecond > timeS && cue.atSecond <= timeS + lead) {
      sample = Math.min(sample, cue.atSecond - fixedStepS);
    }
  }
  return Math.max(0, sample);
}
