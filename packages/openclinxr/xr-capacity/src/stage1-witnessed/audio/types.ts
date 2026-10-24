import type { AudioCounters, AudioMarkAck, AudioMarkLabel, DuplexAudioConfiguration, DuplexAudioRecord, PrepareDuplexAudioOptions } from "../../stage1/audio/types.js";
export type { AudioCounters, AudioMarkAck, AudioMarkLabel, DuplexAudioOwnership, DuplexAudioResources } from "../../stage1/audio/types.js";
export interface WitnessCounters { frameStart:number; frameEnd:number; sampleRate:number; blocks:number; frames:number; quantumMin:number; quantumMax:number; frameDiscontinuities:number; sampleRateChanges:number; nonfiniteOutputSamples:number; nonzeroOutputSamples:number }
export interface WitnessWindow extends WitnessCounters { sequence:number; partial:boolean }
export interface WitnessGap { expected:number; actual:number; quantum:number; ordinal:number }
export interface WitnessRecord extends WitnessCounters {
 createdMs:number|null;connectedMs:number|null;finalReceivedMs:number|null;targetConnectedMs:number|null;targetCreation:{input:{beforeMs:number;afterMs:number}|null;output:{beforeMs:number;afterMs:number}|null};
 windows:WitnessWindow[]; firstEight:number[][]; primingReceivedMs:number|null; receivedFrontierFrameStart:number|null;
 creationBeforeMs:number|null; creationAfterMs:number|null; attachedSentMs:number|null; attachSeen:{ordinal:number;frame:number}|null;
 gaps:WitnessGap[]; finalReceived:boolean; firstWorkReceivedMs:number|null; rejected:number; overflow:number; coalesced:number; highWater:number;
}
export interface WitnessedAudioConfiguration extends Omit<DuplexAudioConfiguration,"construction"> {
 construction:"muted-bootstrap-persistent-zero-witness-eight-ack-before-targets";
 witness:{reportSeconds:0.5;maximumRows:512;firstCallbacks:8;maximumGaps:8;rowWidth:12;primingDeadlineMs:1000};
}
export interface WitnessedAudioRecord extends Omit<DuplexAudioRecord,"schema"|"config"|"source"|"memory"|"preparation"> {
 schema:"quest-stage1-witnessed-audio.v1";config:WitnessedAudioConfiguration;
 source:DuplexAudioRecord["source"] & {witnessWorkletUrl:string;expectedWitnessWorkletSha256:string;witnessWorkletSha256:string|null};
 preparation:DuplexAudioRecord["preparation"] & {setupStartedMs:number|null;setupDeadlineMs:number|null};
 witness:WitnessRecord;
 memory:DuplexAudioRecord["memory"] & {ledger:Record<string,number>};
}
export interface PrepareWitnessedAudioOptions extends PrepareDuplexAudioOptions { witnessWorkletUrl:string;expectedWitnessWorkletSha256:string }
export interface WitnessedAudioHandle {
 readonly readyMs:number;readonly configuration:WitnessedAudioConfiguration;
 mark(label:AudioMarkLabel,xrReceiptMs:number):Promise<AudioMarkAck>;notifyXRSessionCreated():void;
 snapshot():WitnessedAudioRecord;stop(reason?:string):Promise<WitnessedAudioRecord>;
}
export type TargetCounters=AudioCounters;
