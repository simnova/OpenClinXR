/** Fixture clip definitions. Arena-only; no runtime wiring. */

export const TTS_MODEL = "x-ai/grok-voice-tts-1.0";
export const STT_MODEL = "x-ai/grok-stt-1.0";

/**
 * Actor voice for this station. The repo selects `Samantha` (macOS `say`) or
 * mock voice ids for these fixtures; neither maps to a Grok voice
 * (Eve/Ara/Rex/Sal/Leo), so the card rule falls through to Ara. Recorded here.
 */
export const VOICE = "ara" as const;

export type ClipId =
  | "pangram"
  | "viseme-words"
  | "pain"
  | "oov"
  | "clin-01"
  | "clin-02"
  | "clin-03"
  | "clin-04"
  | "clin-05"
  | "clin-06"
  | "clin-07"
  | "clin-08"
  | "clin-09"
  | "clin-10";

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
  // Held-out clinical-dialogue set (10 lines, patient + parent answers):
  // drug names (albuterol, steroids, inhaler), numbers (two/four/three/one
  // hundred one/six/seven/twice), questions (clin-05, clin-10),
  // fricative-initial (she/feels/fast/fever/six/slow/spacer/soccer/throat)
  // and stop-initial (takes/two/tight/better/take/play/puffer/daily) words.
  // Recorded ONCE alongside the bar clips; chosen as the held-out half for
  // snap window/threshold selection (fit on the original 4 clips' audio only).
  "clin-01": {
    text: "She takes two puffs of albuterol every four hours.",
    mfaTranscript: "she takes two puffs of albuterol every four hours",
  },
  "clin-02": {
    text: "My chest feels tight when I run fast.",
    mfaTranscript: "my chest feels tight when i run fast",
  },
  "clin-03": {
    text: "The fever started three nights ago at one hundred one.",
    mfaTranscript: "the fever started three nights ago at one hundred one",
  },
  "clin-04": {
    text: "I feel better after the puffer but it comes back.",
    mfaTranscript: "i feel better after the puffer but it comes back",
  },
  "clin-05": {
    text: "Will the steroids make her shaky and hungry?",
    mfaTranscript: "will the steroids make her shaky and hungry",
  },
  "clin-06": {
    text: "I coughed six times last night and sat up.",
    mfaTranscript: "i coughed six times last night and sat up",
  },
  "clin-07": {
    text: "She finished the inhaler twice daily for seven days.",
    mfaTranscript: "she finished the inhaler twice daily for seven days",
  },
  "clin-08": {
    text: "My throat hurts and my nose is stuffy.",
    mfaTranscript: "my throat hurts and my nose is stuffy",
  },
  "clin-09": {
    text: "Take slow breaths with the spacer every morning.",
    mfaTranscript: "take slow breaths with the spacer every morning",
  },
  "clin-10": {
    text: "Can I still play soccer at school today?",
    mfaTranscript: "can i still play soccer at school today",
  },
};

export const CLIP_IDS = Object.keys(CLIPS) as ClipId[];
