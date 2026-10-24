/** Public stage1 contracts consumed by Quest capacity tooling. */
export { DUPLEX_AUDIO_CONFIG } from "../stage1/audio/config.js";
export { DUPLEX_WORKLET_SOURCE } from "../stage1/audio/worklet.js";
export { attachBoundaries } from "../stage1/shell/boundary.js";
export { createStage1 } from "../stage1/shell/controller.js";
export { prepareDuplexAudio, AudioPreparationError } from "../stage1/audio/engine.js";
export type { DuplexAudioHandle, DuplexAudioRecord, PrepareDuplexAudioOptions } from "../stage1/audio/types.js";
export type { Stage1Metadata } from "../stage1/shell/types.js";
export { AudioWindowRecorder } from "../stage1/audio/recorder.js";
