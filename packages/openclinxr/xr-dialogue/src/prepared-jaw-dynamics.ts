/** Internal canonical-cue sampler for prepared Rhubarb audio. */
import { createJawDynamicsSampler, type JawDynamicsSample } from "./viseme-jaw-dynamics.js";
import type { VisemeCue } from "./viseme-cue-track.js";
import { RUNTIME_CUE_LEAD_S, type PhonemeCue } from "./viseme-timeline-drive.js";

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
  return createJawDynamicsSampler(track).sample(timeS + RUNTIME_CUE_LEAD_S);
}

type JawResult = { jawOpenRadians: number; jawFraction: number; jawBonesTouched: number };
type JawRoot = { traverse: (callback: (object: unknown) => void) => void; userData?: Record<string, unknown> };

export function applyPreparedJawDynamics<T extends JawResult>(
  result: T, root: JawRoot, cues: readonly PhonemeCue[] | undefined, timeS: number,
  clearRadians: number, teethGain: number, applyJaw: (root: JawRoot, radians: number) => number,
): T {
  const sample = samplePreparedJawDynamics(cues, timeS);
  if (!sample) return result;
  const jawOpenRadians = sample.aperture * clearRadians * teethGain;
  const next = { ...result, jawOpenRadians, jawFraction: sample.aperture, jawBonesTouched: applyJaw(root, jawOpenRadians) };
  const prior = root.userData?.openClinXrNamedVisemeDrive;
  if (root.userData && prior && typeof prior === "object") root.userData.openClinXrNamedVisemeDrive = { ...prior, ...next, jawDynamics: "canonical_ovr_fixed_step_critical_spring", jawDynamicsSample: { ...sample } };
  return next;
}
