/** Internal canonical-cue sampler for prepared Rhubarb audio. */
import { createJawDynamicsSampler, jawDynamicsConstants, type JawDynamicsSample } from "./viseme-jaw-dynamics.js";
import type { VisemeCue } from "./viseme-cue-track.js";
import type { PhonemeCue } from "./viseme-timeline-drive.js";
import { compensatedSampleTimeS } from "./prepared-cue-lead.js";
import { CONTACT_ATTACK_S, contactSmoothstep } from "./contact-envelope.js";

const OVR = new Set<VisemeCue["viseme"]>(["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"]);

export function samplePreparedJawDynamics(cues: readonly PhonemeCue[] | undefined, timeS: number): JawDynamicsSample | null {
  if (!cues?.length) return null;
  const track: VisemeCue[] = [];
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (const cue of cues) {
    const duration = cue.durationSeconds;
    if (!OVR.has(cue.phoneme as VisemeCue["viseme"]) || !Number.isFinite(cue.atSecond) || cue.atSecond < previousEnd || !Number.isFinite(duration) || duration === undefined || duration <= 0) return null;
    track.push({ startS: cue.atSecond, endS: cue.atSecond + duration, viseme: cue.phoneme as VisemeCue["viseme"], intensity: typeof cue.intensity === "number" ? cue.intensity : 1 });
    previousEnd = cue.atSecond + duration;
  }
  // Per-channel lead: jaw tau = 2/w (w = jaw natural frequency); PP keeps
  // 0 lead. w stays 6. The old PP snap (aperture forced to 0 in one tick) is
  // retired: the spring targets shut over [s-A, e] (see viseme-jaw-dynamics)
  // and the envelope below seals the output exactly through the cue, so the
  // jaw still reads 0 on every PP media frame and opens only after the
  // preceding closure ends.
  const ordinaryLeadS = 2 / jawDynamicsConstants.naturalFrequency;
  return createJawDynamicsSampler(track).sample(compensatedSampleTimeS(cues, timeS, "jaw", ordinaryLeadS));
}

/**
 * PP closure envelope at media time: the anticipatory rise of
 * contact-envelope.ts without its release (the release follows the
 * lead-compensated spring, which reopens within one frame). Holds exactly 1
 * over the cue, so the jaw reads exactly 0 on every PP media frame.
 */
function ppClosureEnvelope(mediaS: number, cues: readonly PhonemeCue[]): number {
  let closure = 0;
  for (const cue of cues) {
    if (cue.phoneme !== "PP") continue;
    if (mediaS > cue.atSecond + (cue.durationSeconds ?? 0)) continue;
    const rise = contactSmoothstep((mediaS - (cue.atSecond - CONTACT_ATTACK_S)) / CONTACT_ATTACK_S);
    if (rise > closure) closure = rise;
  }
  return closure;
}

type JawResult = { jawOpenRadians: number; jawFraction: number; jawBonesTouched: number };
type JawRoot = { traverse: (callback: (object: unknown) => void) => void; userData?: Record<string, unknown> };

export function applyPreparedJawDynamics<T extends JawResult>(
  result: T, root: JawRoot, cues: readonly PhonemeCue[] | undefined, timeS: number,
  clearRadians: number, teethGain: number, applyJaw: (root: JawRoot, radians: number) => number,
): T {
  const sample = samplePreparedJawDynamics(cues, timeS);
  if (!sample) return result;
  const aperture = sample.aperture * (1 - ppClosureEnvelope(timeS, cues ?? []));
  const jawOpenRadians = aperture * clearRadians * teethGain;
  const next = { ...result, jawOpenRadians, jawFraction: aperture, jawBonesTouched: applyJaw(root, jawOpenRadians) };
  const prior = root.userData?.openClinXrNamedVisemeDrive;
  if (root.userData && prior && typeof prior === "object") root.userData.openClinXrNamedVisemeDrive = { ...prior, ...next, jawDynamics: "canonical_ovr_fixed_step_critical_spring", jawDynamicsSample: { ...sample } };
  return next;
}
