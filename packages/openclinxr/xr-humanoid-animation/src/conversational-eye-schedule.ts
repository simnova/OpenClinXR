/** State of one actor relative to the conversation currently playing in the scene. */
export type HumanoidConversationEyeState = "talking" | "listening" | "rest";

export type HumanoidGazeBoutKind = "mutual" | "away";

/** One blink schedule sample, including asymmetric phase durations for measurement. */
export type HumanoidBlinkScheduleSample = {
  intensity: number;
  blinkIndex: number;
  phase: "between" | "closing" | "opening";
  closeDurationMs: number;
  openDurationMs: number;
};

/** One gaze-bout schedule sample and its stable away target offset. */
export type HumanoidGazeBoutSample = {
  kind: HumanoidGazeBoutKind;
  boutIndex: number;
  durationMs: number;
  elapsedInBoutMs: number;
  yaw: number;
  pitch: number;
};

/**
 * Trutoiu et al. 2011, ACM TAP 8(3), "Modeling and animating eye blinks": a natural blink
 * closes faster than it opens and totals about 300 ms. These phases deliberately sum to 300.
 */
export const HUMANOID_BLINK_CLOSE_MS = 90;
/** Opening phase paired with the 90 ms close phase for a 300 ms blink. */
export const HUMANOID_BLINK_OPEN_MS = 210;

/**
 * Bentivoglio et al. 1997, Movement Disorders 12(6):1028: conversation raises blink rate to
 * about 26/min. The existing measured rest schedule is retained at 17.6/min; recon established
 * that a silent listener uses the non-talking rate while only the active speaker uses 26/min.
 */
export function humanoidBlinkRatePerMinute(state: HumanoidConversationEyeState): number {
  return state === "talking" ? 26 : 17.6;
}

/** A stable scalar in (0,1), derived only from an integer index and a stream id. */
function indexHashUnit(index: number, stream: number): number {
  let value = (Math.trunc(index) + 1) ^ Math.imul(stream + 1, 0x9e3779b1);
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  value ^= value >>> 15;
  return ((value >>> 0) + 0.5) / 4_294_967_296;
}

/** Deterministic per-actor phase used to keep actors from blinking and looking away in unison. */
export function humanoidEyeSchedulePhaseMs(actorId: string, state: HumanoidConversationEyeState): number {
  let hash = 0;
  for (let index = 0; index < actorId.length; index += 1) hash = (hash * 31 + actorId.charCodeAt(index)) | 0;
  const hashed = Math.sin(hash) * 43758.5453;
  return (hashed - Math.floor(hashed)) * humanoidBlinkIntervalMs(state, 0);
}

/** Deterministic, irregular start-to-start interval for one blink index. */
export function humanoidBlinkIntervalMs(state: HumanoidConversationEyeState, blinkIndex: number): number {
  const meanMs = 60_000 / humanoidBlinkRatePerMinute(state);
  return meanMs * (0.62 + indexHashUnit(blinkIndex, state === "talking" ? 11 : 17) * 0.76);
}

/** Pure blink sample. No mutable PRNG: every timing value is a hash of the blink index. */
export function sampleHumanoidBlinkSchedule(
  elapsedMs: number,
  state: HumanoidConversationEyeState,
): HumanoidBlinkScheduleSample {
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  let cursor = 0;
  for (let blinkIndex = 0; blinkIndex < 100_000; blinkIndex += 1) {
    const intervalMs = humanoidBlinkIntervalMs(state, blinkIndex);
    const blinkStartMs = cursor + intervalMs - HUMANOID_BLINK_CLOSE_MS - HUMANOID_BLINK_OPEN_MS;
    if (elapsed < blinkStartMs) {
      return { intensity: 0, blinkIndex, phase: "between", closeDurationMs: HUMANOID_BLINK_CLOSE_MS, openDurationMs: HUMANOID_BLINK_OPEN_MS };
    }
    const phaseMs = elapsed - blinkStartMs;
    if (phaseMs <= HUMANOID_BLINK_CLOSE_MS) {
      const progress = phaseMs / HUMANOID_BLINK_CLOSE_MS;
      return { intensity: Math.sin(progress * Math.PI / 2), blinkIndex, phase: "closing", closeDurationMs: HUMANOID_BLINK_CLOSE_MS, openDurationMs: HUMANOID_BLINK_OPEN_MS };
    }
    if (phaseMs <= HUMANOID_BLINK_CLOSE_MS + HUMANOID_BLINK_OPEN_MS) {
      const progress = (phaseMs - HUMANOID_BLINK_CLOSE_MS) / HUMANOID_BLINK_OPEN_MS;
      return { intensity: Math.cos(progress * Math.PI / 2), blinkIndex, phase: "opening", closeDurationMs: HUMANOID_BLINK_CLOSE_MS, openDurationMs: HUMANOID_BLINK_OPEN_MS };
    }
    cursor += intervalMs;
  }
  return { intensity: 0, blinkIndex: 99_999, phase: "between", closeDurationMs: HUMANOID_BLINK_CLOSE_MS, openDurationMs: HUMANOID_BLINK_OPEN_MS };
}

const GAZE_SOURCE_SECONDS = {
  talking: {
    mutual: { mean: 3.13, sd: 3.16 },
    away: { mean: 0.927, sd: 0.8 },
  },
  listening: {
    mutual: { mean: 7.92, sd: 1.57 },
    away: { mean: 0.433, sd: 0.237 },
  },
} as const;

function gazeSourceState(state: HumanoidConversationEyeState): "talking" | "listening" {
  return state === "talking" ? "talking" : "listening";
}

/**
 * One index-hashed standard-normal deviate. Box-Muller names the distribution construction and
 * avoids mutable random state; its two uniforms come from independent integer hash streams.
 */
function indexNormal(index: number, stream: number): number {
  const u1 = indexHashUnit(index, stream);
  const u2 = indexHashUnit(index, stream + 1);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Lee, Badler & Badler 2002, SIGGRAPH "Eyes Alive", Table 1 (30 fps): talking mutual
 * 3.13 +/- 3.16 s, talking away 0.927 +/- 0.800 s; listening mutual 7.92 +/- 1.57 s,
 * listening away 0.433 +/- 0.237 s. Durations use a LOGNORMAL distribution fitted from each
 * published arithmetic mean and SD, so every sample stays positive while preserving variance.
 */
export function humanoidGazeBoutDurationMs(
  state: HumanoidConversationEyeState,
  kind: HumanoidGazeBoutKind,
  boutIndex: number,
): number {
  const source = GAZE_SOURCE_SECONDS[gazeSourceState(state)][kind];
  const varianceRatio = (source.sd * source.sd) / (source.mean * source.mean);
  const sigma = Math.sqrt(Math.log(1 + varianceRatio));
  const mu = Math.log(source.mean) - sigma * sigma / 2;
  const stream = (gazeSourceState(state) === "talking" ? 31 : 41) + (kind === "mutual" ? 0 : 5);
  return Math.exp(mu + sigma * indexNormal(boutIndex, stream)) * 1000;
}

/** Pure alternating mutual/away schedule for the actor's current conversational state. */
export function sampleHumanoidGazeBout(
  elapsedMs: number,
  state: HumanoidConversationEyeState,
): HumanoidGazeBoutSample {
  let remainingMs = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  for (let boutIndex = 0; boutIndex < 100_000; boutIndex += 1) {
    const kind: HumanoidGazeBoutKind = boutIndex % 2 === 0 ? "mutual" : "away";
    const durationMs = humanoidGazeBoutDurationMs(state, kind, boutIndex);
    if (remainingMs <= durationMs) {
      if (kind === "mutual") {
        return { kind, boutIndex, durationMs, elapsedInBoutMs: remainingMs, yaw: 0, pitch: 0 };
      }
      // Existing micro-saccade maxima are 0.029 rad yaw and 0.012 rad pitch (face-rig.ts).
      // Hashing the bout index selects a stable side/height while keeping the same magnitude.
      const yawSign = indexHashUnit(boutIndex, 53) < 0.5 ? -1 : 1;
      const pitchSign = indexHashUnit(boutIndex, 59) < 0.5 ? -1 : 1;
      return {
        kind,
        boutIndex,
        durationMs,
        elapsedInBoutMs: remainingMs,
        yaw: yawSign * 0.029,
        pitch: pitchSign * 0.012,
      };
    }
    remainingMs -= durationMs;
  }
  return { kind: "mutual", boutIndex: 99_999, durationMs: 0, elapsedInBoutMs: 0, yaw: 0, pitch: 0 };
}
