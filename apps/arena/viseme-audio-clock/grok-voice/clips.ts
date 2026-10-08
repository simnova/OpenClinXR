/** Fixture clip definitions. Arena-only; no runtime wiring. */

export const TTS_MODEL = "x-ai/grok-voice-tts-1.0";
export const STT_MODEL = "x-ai/grok-stt-1.0";

/**
 * Actor voice for this station. The repo selects `Samantha` (macOS `say`) or
 * mock voice ids for these fixtures; neither maps to a Grok voice
 * (Eve/Ara/Rex/Sal/Leo), so the card rule falls through to Ara. Recorded here.
 */
export const VOICE = "ara" as const;

export type ClipId = "pangram" | "viseme-words" | "pain" | "oov";

export const CLIPS: Readonly<Record<ClipId, { text: string; mfaTranscript: string }>> = {
  pangram: {
    text: "That quick beige fox jumped in the air over each thin dog. Look out, I shout, for he's foiled you again, creating chaos.",
    mfaTranscript:
      "that quick beige fox jumped in the air over each thin dog look out i shout for he's foiled you again creating chaos",
  },
  "viseme-words": {
    text: "put. fat. think. tip. call. chair. sir. lot. red. car. bed. toe. book.",
    mfaTranscript: "put fat think tip call chair sir lot red car bed toe book",
  },
  pain: {
    text: "I feel the pain is better now.",
    mfaTranscript: "i feel the pain is better now",
  },
  oov: {
    text: "Give the albuterol now.",
    mfaTranscript: "give the albuterol now",
  },
};

export const CLIP_IDS = Object.keys(CLIPS) as ClipId[];
