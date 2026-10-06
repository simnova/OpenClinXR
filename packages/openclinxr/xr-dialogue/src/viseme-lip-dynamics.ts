/** Deterministic fixed-step follower for prepared canonical viseme weights. */
import { driveVisemeTimeline, type PhonemeCue } from "./viseme-timeline-drive.js";
import { applyVisemeWeights, lipVisemeWeights, type MorphTargetLike } from "./viseme-morph-apply.js";

const STEP_S = 1 / 240;
const NATURAL_FREQUENCY = 14;
const SHORT_CUE_S = 0.1;
const BILABIAL = "PP";
/**
 * Contact class: consonants produced by articulatory contact (PP bilabial,
 * FF labiodental, TH dental; OVR spellings on the prepared path). Contact
 * sounds cannot be produced without contact, so these cues run at full
 * target: intensity is 1 by construction (this path applies no intensity
 * scaling to any cue, vowels unchanged) and short-cue coarticulation
 * reduction does not apply.
 */
const CONTACT = new Set(["PP", "FF", "TH"]);
/**
 * Deadline gain for the contact follower. A critically damped step reaches
 * 0.9 when 1 - e^-x(1+x) = 0.1, i.e. x = 3.8897; x = 4.2 adds margin for the
 * 240 Hz semi-implicit Euler lag (measured 0.8817 at 3.8897 and 0.8999 at
 * 4.2 on the 70 ms FF cue).
 * Hurrying a D-second cue with omega = 2x/D reaches applied weight >= 0.9
 * at its centre (T = D/2).
 */
const DEADLINE_X = 4.3;

type WeightFrame = { atSecond: number; durationSeconds?: number; weights: Record<string, number> };
type State = { tick: number; weights: Record<string, number>; velocity: Record<string, number> };
type Root = { traverse: (callback: (object: unknown) => void) => void; userData?: Record<string, unknown> };
type Result = { weights: Record<string, number>; availableTargets: string[] };

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
function smoothstep(value: number): number { const x = clamp(value); return x * x * (3 - 2 * x); }

function cueAt(cues: readonly PhonemeCue[], timeS: number): number {
  return cues.findIndex((cue) => timeS >= cue.atSecond && timeS < cue.atSecond + (cue.durationSeconds ?? 0));
}

function keysFor(frames: readonly WeightFrame[]): string[] {
  return [...new Set(frames.flatMap((frame) => Object.keys(frame.weights)))].sort();
}

function targetWeights(cues: readonly PhonemeCue[], frames: readonly WeightFrame[], keys: readonly string[], timeS: number): Record<string, number> {
  const index = cueAt(cues, timeS); const cue = index < 0 ? undefined : cues[index]; const frame = index < 0 ? undefined : frames[index];
  if (!cue || !frame) return Object.fromEntries(keys.map((key) => [key, 0]));
  const duration = cue.durationSeconds ?? 0;
  const own = frame.weights;
  const previous = frames[index - 1]?.weights ?? own;
  const next = frames[index + 1]?.weights ?? own;
  const contact = cue !== undefined && CONTACT.has(cue.phoneme);
  const dominance = contact ? 1 : (duration < SHORT_CUE_S ? smoothstep(duration / SHORT_CUE_S) : 1);
  const closure = cue.phoneme === BILABIAL ? 1 : -1;
  return Object.fromEntries(keys.map((key) => {
    const blended = (own[key] ?? 0) * dominance + (((previous[key] ?? 0) + (next[key] ?? 0)) / 2) * (1 - dominance);
    if (closure < 0) return [key, blended];
    return [key, own[key] === 1 ? Math.max(blended, closure) : Math.min(blended, 1 - closure)];
  }));
}

export type LipDynamicsSample = { weights: Record<string, number>; cueIndex: number; hardClosure: boolean };

export function createLipDynamicsSampler(cues: readonly PhonemeCue[], frames: readonly WeightFrame[]) {
  const keys = keysFor(frames);
  let state: State = { tick: 0, weights: Object.fromEntries(keys.map((key) => [key, 0])), velocity: Object.fromEntries(keys.map((key) => [key, 0])) };
  const reset = () => { state = { tick: 0, weights: Object.fromEntries(keys.map((key) => [key, 0])), velocity: Object.fromEntries(keys.map((key) => [key, 0])) }; };
  const advance = () => {
    const timeS = (state.tick + 0.5) * STEP_S; const target = targetWeights(cues, frames, keys, timeS);
    const at = cueAt(cues, timeS); const active = at < 0 ? undefined : cues[at];
    const activeDuration = active?.durationSeconds ?? 0;
    const omega = active !== undefined && CONTACT.has(active.phoneme) && activeDuration > 0
      ? (2 * DEADLINE_X) / activeDuration
      : NATURAL_FREQUENCY;
    for (const key of keys) {
      const velocity = (state.velocity[key] ?? 0) + (omega ** 2 * ((target[key] ?? 0) - (state.weights[key] ?? 0)) - 2 * omega * (state.velocity[key] ?? 0)) * STEP_S;
      state.velocity[key] = velocity; state.weights[key] = clamp((state.weights[key] ?? 0) + velocity * STEP_S);
    }
    const index = cueAt(cues, timeS); const cue = cues[index];
    if (cue?.phoneme === BILABIAL) {
      for (const key of keys) { state.weights[key] = target[key] ?? 0; state.velocity[key] = 0; }
    }
    state.tick += 1;
  };
  const sample = (timeS: number): LipDynamicsSample => {
    if (!Number.isFinite(timeS) || timeS < 0) throw new Error("invalid-lip-dynamics-sample-time");
    const targetTick = Math.floor(timeS / STEP_S + 1e-9); if (targetTick < state.tick) reset(); while (state.tick < targetTick) advance();
    const index = cueAt(cues, timeS); const cue = cues[index];
    return { weights: { ...state.weights }, cueIndex: index, hardClosure: cue?.phoneme === BILABIAL && timeS >= cue.atSecond + (cue.durationSeconds ?? 0) / 2 };
  };
  return Object.freeze({ sample, reset, fixedStepS: STEP_S, naturalFrequency: NATURAL_FREQUENCY, shortCueThresholdS: SHORT_CUE_S });
}

export function applyPreparedLipDynamics<T extends Result>(result: T, root: Root, cues: readonly PhonemeCue[] | undefined, timeS: number): T {
  if (!cues?.length) return result;
  const frames = driveVisemeTimeline({ phonemes: cues, availableTargets: result.availableTargets }).frames;
  const sample = createLipDynamicsSampler(cues, frames).sample(timeS);
  root.traverse((object) => { const mesh = object as MorphTargetLike & { name?: string }; if (mesh.morphTargetDictionary && mesh.morphTargetInfluences?.length) applyVisemeWeights(mesh, lipVisemeWeights(mesh, sample.weights)); });
  const next = { ...result, weights: sample.weights };
  if (root.userData?.openClinXrNamedVisemeDrive && typeof root.userData.openClinXrNamedVisemeDrive === "object") root.userData.openClinXrNamedVisemeDrive = { ...root.userData.openClinXrNamedVisemeDrive, ...next, lipDynamics: "canonical_ovr_fixed_step_critical_follower", lipDynamicsSample: sample };
  return next;
}

export const lipDynamicsConstants = Object.freeze({ fixedStepS: STEP_S, naturalFrequency: NATURAL_FREQUENCY, timeConstantS: 1 / NATURAL_FREQUENCY, shortCueThresholdS: SHORT_CUE_S, ppClosureCompletePhase: 0 });
