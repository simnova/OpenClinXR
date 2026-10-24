/** Public stage1-witnessed contracts consumed by Quest capacity tooling. */
export { WITNESSED_AUDIO_CONFIG } from "../stage1-witnessed/audio/config.js";
export { prepareWitnessedDuplexAudio } from "../stage1-witnessed/audio/index.js";
export type { WitnessedAudioHandle } from "../stage1-witnessed/audio/types.js";
export { WITNESS_WORKLET_SOURCE } from "../stage1-witnessed/audio/witness-worklet.js";
export { createWitnessedStage1 } from "../stage1-witnessed/shell/controller.js";
export type { WitnessedStage1Metadata } from "../stage1-witnessed/shell/types.js";
export { WitnessedAudioPreparationError } from "../stage1-witnessed/audio/engine.js";
export type { WitnessedAudioRecord, PrepareWitnessedAudioOptions, WitnessCounters, AudioCounters } from "../stage1-witnessed/audio/types.js";
export { WitnessRecorder } from "../stage1-witnessed/audio/witness-recorder.js";
