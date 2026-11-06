/**
 * Class-pure headset entrypoint: the names the thin headset client (an app)
 * binds. Package consumers (server tests) keep binding ".".
 *
 * Re-exporting from index would mix "." across consumer classes, which the
 * consumer-contracts gate refuses without an allowlist reason, and the
 * allowlist is frozen. So this subpath exists instead.
 */
export { connect } from "./index.js";
export type {
  EncounterSnapshot,
  IntentKind,
  SyncConnection,
} from "./index.js";
export type { ConnectOptions } from "./options.js";
export { startEncounterSyncFromUrl } from "./encounter-turns.js";
export type { EncounterSyncEvidence, UtteranceBoxDeps } from "./encounter-turns.js";
export { downsampleToPcm16, pcmRms } from "./speech-pcm.js";
export { createActorVoice, createEnvelopeCueBuilder, MESM_VOICE_IDS, resolveActorVoice, speechTextFromCaption } from "./actor-voice.js";
export type { VoiceEngine, VoiceSink, VoiceSlot } from "./actor-voice.js";
