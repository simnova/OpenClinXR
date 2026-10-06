/** Deterministic fixed-step jaw dynamics for canonical OVR cue tracks. */
import type { VisemeCue } from "./viseme-cue-track.js";
export { createLipDynamicsSampler, lipDynamicsConstants } from "./viseme-lip-dynamics.js";

const APERTURE = Object.freeze({
  sil: 0, PP: 0, FF: 0.15, TH: 0.25, DD: 0.25, kk: 0.25, CH: 0.25, SS: 0.2,
  nn: 0.2, RR: 0.3, aa: 1, E: 0.45, I: 0.35, O: 0.85, U: 0.4,
} satisfies Record<VisemeCue["viseme"], number>);

const VOWELS = new Set<VisemeCue["viseme"]>(["aa", "E", "I", "O", "U"]);
const DEFAULT_STEP_S = 1 / 240;
const DEFAULT_NATURAL_FREQUENCY = 6;

export type JawDynamicsSample = {
  aperture: number;
  velocity: number;
  target: number;
  cueIndex: number;
  hardClosure: boolean;
};

type MutableState = {
  tick: number;
  aperture: number;
  velocity: number;
  closureCueIndex: number;
  closureEntryAperture: number;
};

function smoothstep01(value: number): number {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

function cueIndexAt(track: readonly VisemeCue[], timeS: number): number {
  for (let index = 0; index < track.length; index += 1) {
    const cue = track[index];
    if (cue && timeS < cue.endS) return index;
  }
  return Math.max(0, track.length - 1);
}

/**
 * Cohen–Massaro-style feature competition for sub-100 ms vowels. The vowel's dominance is
 * smoothstep(duration/100 ms); the residual weight is shared by its neighbours. Long vowels
 * retain their own target. Vowel intensity scales aperture directly, clamped to [0.5, 1], so
 * 0.5 is the mild rail and 1 is the emphasized rail.
 */
export function jawTargetForCue(track: readonly VisemeCue[], index: number): number {
  const cue = track[index];
  if (!cue) return 0;
  let own = APERTURE[cue.viseme];
  if (VOWELS.has(cue.viseme)) own *= Math.min(1, Math.max(0.5, cue.intensity));
  const durationS = cue.endS - cue.startS;
  if (!VOWELS.has(cue.viseme) || durationS >= 0.1) return own;
  const before = index > 0 ? APERTURE[track[index - 1]?.viseme ?? "sil"] : own;
  const after = index + 1 < track.length ? APERTURE[track[index + 1]?.viseme ?? "sil"] : own;
  if (before === own && after === own) return own;
  const dominance = smoothstep01(durationS / 0.1);
  return own * dominance + ((before + after) / 2) * (1 - dominance);
}

function advanceFixedTick(
  state: MutableState,
  track: readonly VisemeCue[],
  stepS: number,
  naturalFrequency: number,
): void {
  const timeS = (state.tick + 0.5) * stepS;
  const index = cueIndexAt(track, timeS);
  const cue = track[index];
  const target = jawTargetForCue(track, index);
  const acceleration = naturalFrequency ** 2 * (target - state.aperture) - 2 * naturalFrequency * state.velocity;
  state.velocity += acceleration * stepS;
  state.aperture = Math.max(0, Math.min(1, state.aperture + state.velocity * stepS));
  if (cue?.viseme === "PP") {
    if (state.closureCueIndex !== index) {
      state.closureCueIndex = index;
      state.closureEntryAperture = state.aperture;
    }
    state.aperture = 0;
    state.velocity = 0;
  } else {
    state.closureCueIndex = -1;
    state.closureEntryAperture = 0;
  }
  state.tick += 1;
}

export function createJawDynamicsSampler(
  track: readonly VisemeCue[],
  options: { fixedStepS?: number; naturalFrequency?: number; initialAperture?: number } = {},
) {
  const fixedStepS = options.fixedStepS ?? DEFAULT_STEP_S;
  const naturalFrequency = options.naturalFrequency ?? DEFAULT_NATURAL_FREQUENCY;
  if (!(fixedStepS > 0) || !(naturalFrequency > 0)) throw new Error("invalid-jaw-dynamics-options");
  let state: MutableState = {
    tick: 0,
    aperture: Math.max(0, Math.min(1, options.initialAperture ?? 0)),
    velocity: 0,
    closureCueIndex: -1,
    closureEntryAperture: 0,
  };
  const reset = () => {
    state = { tick: 0, aperture: Math.max(0, Math.min(1, options.initialAperture ?? 0)), velocity: 0, closureCueIndex: -1, closureEntryAperture: 0 };
  };
  const sample = (timeS: number): JawDynamicsSample => {
    if (!Number.isFinite(timeS) || timeS < 0) throw new Error("invalid-jaw-sample-time");
    const targetTick = Math.floor(timeS / fixedStepS + 1e-9);
    if (targetTick < state.tick) reset();
    while (state.tick < targetTick) advanceFixedTick(state, track, fixedStepS, naturalFrequency);
    const index = cueIndexAt(track, timeS);
    const cue = track[index];
    return { aperture: state.aperture, velocity: state.velocity, target: jawTargetForCue(track, index), cueIndex: index, hardClosure: cue?.viseme === "PP" && state.aperture === 0 };
  };
  return Object.freeze({ sample, reset, fixedStepS, naturalFrequency });
}

export const jawDynamicsConstants = Object.freeze({
  aperture: APERTURE,
  fixedStepS: DEFAULT_STEP_S,
  naturalFrequency: DEFAULT_NATURAL_FREQUENCY,
  coarticulationThresholdS: 0.1,
  ppClosureCompletePhase: 0,
  vowelIntensityClamp: [0.5, 1] as const,
});
