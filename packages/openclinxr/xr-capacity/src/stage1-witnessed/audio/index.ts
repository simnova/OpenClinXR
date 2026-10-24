export {prepareWitnessedDuplexAudio,WitnessedAudioPreparationError} from "./engine.js";
export {WITNESSED_AUDIO_CONFIG,WITNESSED_AUDIO_MEMORY,WITNESSED_TARGET_WORKLET_SHA256,witnessedAudioConfigHash} from "./config.js";
export {WITNESS_WORKLET_SOURCE,WITNESS_WORKLET_PROCESSOR} from "./witness-worklet.js";
export type {WitnessedAudioRecord,WitnessedAudioHandle,PrepareWitnessedAudioOptions,WitnessRecord,WitnessedAudioConfiguration} from "./types.js";
export {DUPLEX_WORKLET_SOURCE as TARGET_WORKLET_SOURCE} from "../../stage1/audio/worklet.js";
