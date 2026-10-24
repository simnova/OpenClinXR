import { DUPLEX_AUDIO_CONFIG, sha256AudioBytes } from "../../stage1/audio/config.js";
import type { WitnessedAudioConfiguration } from "./types.js";
export { sha256AudioBytes } from "../../stage1/audio/config.js";
export const WITNESSED_TARGET_WORKLET_SHA256="bcfdec6d19b9b794e7915e21b79601e3f03e4124308192ec774c03c0949aebf4";
export const WITNESSED_AUDIO_CONFIG:Readonly<WitnessedAudioConfiguration>=Object.freeze({
 ...DUPLEX_AUDIO_CONFIG,construction:"muted-bootstrap-persistent-zero-witness-eight-ack-before-targets",
 witness:Object.freeze({reportSeconds:0.5,maximumRows:512,firstCallbacks:8,maximumGaps:8,rowWidth:12,primingDeadlineMs:1000}),
});
/** Main and render-thread typed storage plus conservative simultaneous known message payloads; excludes unknown JS/native heap. */
export const WITNESSED_AUDIO_MEMORY=Object.freeze({
 targetRows:512,targetWidth:21,targetMainAndWorkletStores:4,sourceByteBudget:65536,
 witnessRows:512,witnessWidth:12,witnessMainAndWorkletStores:2,witnessFirstEightBytes:256,witnessGapStorageBytes:256,
 targetTypedBytes:409600,witnessTypedBytes:98816,ownedTypedBytes:508416,
 targetPendingPayloadBytes:5376,witnessPendingPayloadBytes:1536,witnessPrimingPayloadBytes:256,witnessFinalGapPayloadBytes:256,
 maximumKnownPayloadBytes:7424,countedKnownBytes:515840,capBytes:524288,
});
export function witnessedAudioConfigHash():Promise<string>{return sha256AudioBytes(new TextEncoder().encode(JSON.stringify(WITNESSED_AUDIO_CONFIG)));}
