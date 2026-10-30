/**
 * Pure probe logic for the C2 sync-probe page. No DOM, no three.js, no network:
 * every export here is unit-tested, including the counterweight that proves
 * rendered colour follows server state only.
 */

/** Scene ids of the two primitive probe actors. Also the server actor ids. */
export const PROBE_ACTOR_IDS = ["a1", "a2"] as const;
export type ProbeActorId = (typeof PROBE_ACTOR_IDS)[number];

/** Base (unselected/unspoken) actor colour. */
export const BASE_ACTOR_COLOUR = 0x3f6f5f;
/** Highlight colour for the actor the SERVER says is speaking. Never set locally. */
export const SPEAKING_ACTOR_COLOUR = 0xffb545;

/** Rendered colour for one actor, derived ONLY from its server snapshot state. */
export function resolveActorColour(speaking: boolean): number {
  return speaking ? SPEAKING_ACTOR_COLOUR : BASE_ACTOR_COLOUR;
}

/** Base turn-indicator colour: nobody holds the turn. */
export const BASE_TURN_COLOUR = 0x2a3f3a;
/** Turn-indicator colour while the SERVER says the learner holds the turn. */
export const LEARNER_TURN_COLOUR = 0x4fc3f7;
/** Turn-indicator colour while the SERVER says the actor is replying. Never set locally. */
export const ACTOR_TURN_COLOUR = 0xffb545;

/**
 * Rendered turn-indicator colour, derived ONLY from server turn state.
 * Pure function of (turnOwner, actorSpeaking): no local intent state enters,
 * so a page-local turn mutation can never move the indicator without the server.
 */
export function resolveTurnIndicatorColour(turnOwner: string, actorSpeaking: boolean): number {
  if (turnOwner === "actor" && actorSpeaking) {
    return ACTOR_TURN_COLOUR;
  }
  if (turnOwner === "learner") {
    return LEARNER_TURN_COLOUR;
  }
  return BASE_TURN_COLOUR;
}

/** Quantize a pose component to float32 so the schema round-trip is bit-exact. */
export function quantizePoseComponent(value: number): number {
  return Math.fround(value);
}

/** Yaw-only quaternion (degrees) for the scripted head sweep. */
export function yawQuaternionDegrees(degrees: number): { x: number; y: number; z: number; w: number } {
  const half = (degrees * Math.PI) / 360;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

/** Yaw angle (degrees) of the fixed 6 s sweep at a given script time. */
export function sweepYawDegrees(elapsedMs: number): number {
  const t = Math.min(Math.max(elapsedMs, 0), 6000);
  if (t >= 6000) {
    return 0;
  }
  const segment = Math.floor(t / 2000);
  const local = (t - segment * 2000) / 2000;
  if (segment === 0) {
    return local * 30;
  }
  if (segment === 1) {
    return 30 - local * 60;
  }
  return -30 + local * 30;
}

export interface SummaryStats {
  n: number;
  p50: number;
  p95: number;
  max: number;
}

/** Percentile summary over raw samples (2-decimal ms precision). */
export function summarizeMs(samples: number[]): SummaryStats {
  if (samples.length === 0) {
    return { n: 0, p50: 0, p95: 0, max: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number): number => {
    const rank = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return Number((sorted[Math.max(0, rank)] ?? 0).toFixed(2));
  };
  return {
    n: sorted.length,
    p50: at(50),
    p95: at(95),
    max: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
  };
}

/**
 * C4 rendered emotion tint, derived ONLY from the server's actor emotion.
 * Pure function of server state: a page-local emotion value can never move it.
 */
export const EMOTION_TINTS: Record<string, number> = {
  neutral: 0x8fa8a0,
  reassured: 0x6fd08c,
  concerned: 0xe0a458,
  anxious: 0xd05a5a,
};

export function resolveActorTint(emotion: string): number {
  return EMOTION_TINTS[emotion] ?? EMOTION_TINTS["neutral"]!;
}

/** Page-local mouth envelope for one server cue: peak amplitude and oscillation rate. */
export interface CueEnvelope {
  peak: number;
  hz: number;
}

/**
 * Page-local cue envelope catalog keyed by server cueId. The server is
 * authoritative for WHICH cue (and WHEN it speaks); the page owns only HOW a
 * cue looks as a mouth bar. Unknown cues fall back to DEFAULT_CUE_ENVELOPE so
 * a new server cue still moves the mouth while the server says speaking.
 */
export const CUE_ENVELOPES: Record<string, CueEnvelope> = {
  "cue-greeting-01": { peak: 0.9, hz: 2.2 },
  "cue-followup-02": { peak: 0.7, hz: 3.1 },
  "cue-recap-03": { peak: 0.8, hz: 2.6 },
};

export const DEFAULT_CUE_ENVELOPE: CueEnvelope = { peak: 0.6, hz: 2.0 };

export function resolveCueEnvelope(cueId: string): CueEnvelope {
  return CUE_ENVELOPES[cueId] ?? DEFAULT_CUE_ENVELOPE;
}

/**
 * Mouth-bar amplitude for one actor frame. Pure function of (server cueId,
 * server speaking, frame time): 0 whenever the server says the actor is NOT
 * speaking, whatever cueId the page holds. While speaking the amplitude stays
 * strictly positive (0.6 + 0.4 * sin in [0.2, 1] of peak) so silent frames are
 * distinguishable from speaking frames.
 */
export function resolveMouthAmplitude(cueId: string, speaking: boolean, tMs: number): number {
  if (!speaking) {
    return 0;
  }
  const envelope = resolveCueEnvelope(cueId);
  return envelope.peak * (0.6 + 0.4 * Math.sin((2 * Math.PI * envelope.hz * tMs) / 1000));
}
