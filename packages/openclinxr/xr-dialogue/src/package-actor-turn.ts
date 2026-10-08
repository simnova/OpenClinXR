/**
 * Public package-actor-turn subpath: actor-turn playback and dialogue speech
 * for package consumers (consumer-driven contracts, class "package").
 *
 * Narrow re-export — only the symbols real package consumers bind.
 * Apps/ui-xr keeps "."; tools and evidence use their own entrypoints.
 */
export type { ActorTurnPlayback, ActorTurnPlaybackStartContext } from "./actor-turn-playback.js";
export { playFrozenActorTurnOnSlot } from "./actor-turn-playback.js";
export type { LiveActorTurnConsumption } from "./actor-turn-plan-consumption.js";
export { resolveLiveActorTurnForTrace } from "./actor-turn-plan-consumption.js";
export { attachBakedCuesToSpeech } from "./viseme-baked-cues.js";
export { initialDialogueTextForScenario } from "./initial-dialogue-text.js";
export { phonemesForText, visemesForText } from "./dialogue-visemes.js";
export { createActorAudioRuntime } from "./actor-audio-runtime.js";
export { bakeLiveSttCueTrack, buildPhonePlan } from "./live-stt-plan.js";
export type { SttWord } from "./live-stt-plan.js";
export { requestUnscriptedLiveTurn } from "./live-voice-turn-client.js";
export type {
  LiveVoiceAudioContext,
  LiveVoiceSocket,
  LiveVoiceTurnRequest,
} from "./live-voice-turn-client.js";
