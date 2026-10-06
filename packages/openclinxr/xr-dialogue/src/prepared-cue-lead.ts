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
 * - PP: lead 0. The contact shape comes from the anticipatory symmetric
 *   envelope (contact-envelope.ts, evaluated in media time), not from follower
 *   timing, so PP needs no lead of its own.
 * - FF/TH: lead D/X (step3 FF: 0.07/6 ~= 11.7 ms), the retired deadline
 *   follower's time constant, kept so the follower residual meets the contact
 *   at the same phase it always has.
 *
 * Contact precedence: retired. The compensated sample used to hold at one fixed
 * step before a contact cue starting inside the lead window, because
 * prefetching an ordinary lead across a 60-70 ms contact showed post-contact
 * decay before the contact (measured: FF 0.94 one frame before its cue). The
 * anticipatory symmetric contact envelope (contact-envelope.ts) now bounds
 * every contact step to 0.25 per 30 fps frame, so prefetching INTO a contact
 * reads as smooth anticipation instead of a jump, and the hold is removed for
 * contact cues. Vowel cues never triggered the hold, so the vowel path is
 * untouched. No signature changes: callers pass the cues and media time they
 * already hold.
 */

export type LeadChannel = "lip" | "jaw";

/**
 * Divisor for the FF/TH contact lead. Retired tuning note: a critically damped
 * step reaches 0.9 at x = 3.8897 and x = 6.0 hurried the steep end of the
 * lip-travel curve onto short contacts; the anticipatory symmetric envelope
 * (contact-envelope.ts) now carries the contact shape instead. DEADLINE_X
 * stays as the single source for the FF/TH per-channel lead D/X below, whose
 * value is unchanged.
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
 * (gains, envelope attack/release) is untouched.
 */
export function compensatedSampleTimeS(
  cues: readonly CueLike[],
  timeS: number,
  channel: LeadChannel,
  ordinaryLeadS: number,
  fixedStepS = 1 / 240,
): number {
  void fixedStepS;
  const active = cueIndexAt(cues, timeS);
  const own = active < 0 ? null : contactLeadS(channel, cues[active]?.phoneme ?? "", cues[active]?.durationSeconds ?? 0);
  const lead = own ?? ordinaryLeadS;
  return Math.max(0, timeS + lead);
}
