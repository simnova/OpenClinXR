import {createHash} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {DUPLEX_WORKLET_SOURCE} from "../../entrypoints/stage1.js";
import { AUDIO_FIELDS as COUNTER_KEYS, WITNESS_FIELDS as WITNESS_COUNTER_KEYS } from "../../stage1/audio/worklet-wire.test-support.js";
import { WITNESS_WORKLET_SOURCE } from "../../entrypoints/stage1-witnessed.js";


import { prepareWitnessedDuplexAudio } from "../../entrypoints/stage1-witnessed.js";
import { WitnessedAudioPreparationError } from "../../entrypoints/stage1-witnessed.js";
import type { AudioCounters, WitnessCounters } from "../../entrypoints/stage1-witnessed.js";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
function counters(frameStart=1024,frames=24064):AudioCounters{return {frameStart,frameEnd:frameStart+frames,sampleRate:48000,blocks:frames/128,frames,channelFrames:frames,finiteSamples:frames,nonfiniteSamples:0,nonzeroSamples:frames,sumSquares:frames*.000001,peak:.002,clipSamples:0,missingInputBlocks:0,frameDiscontinuities:0,quantumMin:128,quantumMax:128,sampleRateChanges:0,zeroOutputNonzeroSamples:0};}
function wc(frameStart=0,frames=1024):WitnessCounters{return {frameStart,frameEnd:frameStart+frames,sampleRate:48000,blocks:frames/128,frames,quantumMin:128,quantumMax:128,frameDiscontinuities:0,sampleRateChanges:0,nonfiniteOutputSamples:0,nonzeroOutputSamples:0};}
function setup(){
 vi.useFakeTimers();const events:string[]=[];const processors:Processor[]=[];let stopTargets=0;
 class Node{connect=vi.fn();disconnect=vi.fn();}
 class Processor extends Node{
  name:string;onprocessorerror:null|(()=>void)=null;state:AudioCounters|WitnessCounters|null=null;
  port={onmessage:null as null|((event:{data:unknown})=>void),close:vi.fn(),postMessage:vi.fn((data:{type:string})=>{
   if(data.type==='stop'){events.push(`stop:${this.name}`);if(this.name==='witness'){
     this.emit({type:'report',sequence:2,rows:new Float64Array([1,...WITNESS_COUNTER_KEYS.map(k=>wc(24064,1152)[k])]),counters:wc(0,25216),highWater:1,coalesced:0,overflow:0});
     this.emit({type:'final',rows:2,counters:wc(0,25216),gaps:new Float64Array(0),attachSeen:{ordinal:8,frame:1024},overflow:0});
    }else{stopTargets++;this.emit({type:'final',rows:1,counters:this.state??counters()});}
   }
  })};
  constructor(_context:unknown,processor:string,options?:{processorOptions?:{mode?:string}}){super();this.name=processors.length === 0?'witness':options?.processorOptions?.mode??'unknown';processors.push(this);events.push(`create:${this.name}`);}
  emit(data:unknown){this.port.onmessage?.({data});}
 }
 const param=()=>({value:0,cancelScheduledValues:vi.fn(),setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn()});
 class Context extends EventTarget{state='running';sampleRate=48000;currentTime=0;destination=new Node();baseLatency=.004;outputLatency=.024;resume=vi.fn(async()=>{});close=vi.fn(async()=>{this.state='closed';events.push('context-close');});audioWorklet={addModule:vi.fn(async()=>{events.push('module');})};createGain=()=>Object.assign(new Node(),{gain:param()});createOscillator=()=>Object.assign(new Node(),{frequency:{value:440},type:'sine',start:vi.fn(),stop:vi.fn()});createMediaStreamSource=()=>new Node();}
 const track=Object.assign(new EventTarget(),{readyState:'live',enabled:true,muted:false,label:'actual scalar fixture',getSettings:()=>({sampleRate:48000,channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}),getConstraints:()=>({}),stop:vi.fn(function(this:{readyState:string}){this.readyState='ended';events.push('track-stop');})});
 const stream={getAudioTracks:()=>[track],getTracks:()=>[track]};const doc=Object.assign(new EventTarget(),{visibilityState:'visible'});const abort=new AbortController();
 vi.stubGlobal('AudioContext',Context);vi.stubGlobal('AudioWorkletNode',Processor);vi.stubGlobal('isSecureContext',true);vi.stubGlobal('document',doc);vi.stubGlobal('location',new URL('https://local.test/'));
 vi.stubGlobal('navigator',{userActivation:{isActive:true},mediaDevices:{getUserMedia:vi.fn(async()=>stream)}});
 vi.stubGlobal('crypto',{subtle:{digest:async(_algorithm:string,bytes:ArrayBuffer)=>Uint8Array.from(createHash('sha256').update(new Uint8Array(bytes)).digest()).buffer}});
 vi.stubGlobal('fetch',vi.fn(async(url:URL)=>new Response(url.pathname.includes('witness')?WITNESS_WORKLET_SOURCE:DUPLEX_WORKLET_SOURCE)));
 const pending=prepareWitnessedDuplexAudio({signal:abort.signal,runNonce:'async-fixture',workletUrl:'https://local.test/target.js',expectedWorkletSha256:sha(DUPLEX_WORKLET_SOURCE),witnessWorkletUrl:'https://local.test/witness.js',expectedWitnessWorkletSha256:sha(WITNESS_WORKLET_SOURCE)});
 const result=pending.catch((e:unknown)=>e as WitnessedAudioPreparationError);
 const prime=(bad=false)=>{const w=processors[0]!;const first=new Float64Array(Array.from({length:32},(_,i)=>{const row=Math.floor(i/4),column=i%4;return [row,row*128,row*128/48000,128][column]!;}));if(bad)first[4]=0;w.emit({type:'primed',firstEight:first,lastFrameStart:896,counters:wc()});};
 const ready=()=>{const w=processors[0]!;w.emit({type:'report',sequence:1,rows:new Float64Array([0,...WITNESS_COUNTER_KEYS.map(k=>wc(0,24064)[k])]),counters:wc(0,24064),highWater:1,coalesced:0,overflow:0});for(const node of processors.slice(1)){const c=counters();node.state=c;node.emit({type:'first',frame:1152,counters:counters(1024,128)});node.emit({type:'report',sequence:1,rows:new Float64Array([0,0,0,...COUNTER_KEYS.map(k=>c[k])]),counters:c,highWater:1,coalesced:0,overflow:0});}};
 return {processors,events,result,prime,ready,abort,track,get stopTargets(){return stopTargets;}};
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('witnessed engine causal construction and drain',()=>{
 it('constructs both targets only after actual eight-callback ACK and drains them before witness',async()=>{const s=setup();await vi.advanceTimersByTimeAsync(0);expect(s.processors.map(n=>n.name)).toEqual(['witness']);s.prime();await vi.advanceTimersByTimeAsync(0);expect(s.processors.map(n=>n.name)).toEqual(['witness','input','output']);s.ready();const handle=await s.result;if(handle instanceof WitnessedAudioPreparationError)throw handle;expect(handle.snapshot().preparation.readyMs).not.toBeNull();expect(handle.snapshot().witness.creationBeforeMs).toBeGreaterThanOrEqual(handle.snapshot().witness.primingReceivedMs!);expect(handle.snapshot().ownership.created).toEqual({tracks:1,contexts:1,nodes:6,ports:3,oscillators:1});handle.notifyXRSessionCreated();const final=await handle.stop();expect(s.events.indexOf('stop:witness')).toBeGreaterThan(s.events.indexOf('stop:output'));expect(s.stopTargets).toBe(2);expect(final.witness.finalReceived).toBe(true);expect(final.witness.frameEnd).toBeGreaterThanOrEqual(final.output.frameEnd);expect(final.cleanup.stopAckReceived).toBe(true);expect(Object.values(final.ownership.remaining).every(n=>n===0)).toBe(true);expect(final.preparation.setupStartedMs).toBe(final.preparation.captureGrantedMs);expect(final.preparation.setupDeadlineMs!-final.preparation.captureGrantedMs!).toBe(10000);expect(await handle.stop()).toEqual(final);});
 it('corrupt first-eight ordinals cannot admit or construct either target',async()=>{const s=setup();await vi.advanceTimersByTimeAsync(0);s.prime(true);await vi.advanceTimersByTimeAsync(5000);const e=await s.result;if(!(e instanceof WitnessedAudioPreparationError))throw Error('must fail');expect(e.record.reason).toContain('first-eight chronology');expect(s.processors.map(n=>n.name)).toEqual(['witness']);expect(e.record.preparation.readyMs).toBeNull();expect(Object.values(e.record.ownership.remaining).every(n=>n===0)).toBe(true);});
 it('a witness first-gap fails once with coordinates retained and no target admission',async()=>{const s=setup();await vi.advanceTimersByTimeAsync(0);s.processors[0]!.emit({type:'clock-gap',expected:128,actual:768,quantum:128,ordinal:1});await vi.advanceTimersByTimeAsync(5000);const e=await s.result;if(!(e instanceof WitnessedAudioPreparationError))throw Error('must fail');expect(e.record.reason).toContain('Witness frame continuity');expect(e.record.witness.gaps).toEqual([{expected:128,actual:768,quantum:128,ordinal:1}]);expect(e.record.preparation.readyMs).toBeNull();expect(s.processors).toHaveLength(1);expect(Object.values(e.record.ownership.remaining).every(n=>n===0)).toBe(true);});
 it('first target tag behind already-received witness start fails with no counter reset',async()=>{const s=setup();await vi.advanceTimersByTimeAsync(0);s.prime();await vi.advanceTimersByTimeAsync(0);s.processors[1]!.state=counters(512,128);s.processors[1]!.emit({type:'first',frame:640,counters:counters(512,128)});await vi.advanceTimersByTimeAsync(5000);const e=await s.result;if(!(e instanceof WitnessedAudioPreparationError))throw Error('must fail');expect(e.record.reason).toContain('precedes received witness frontier');expect(e.record.input.frameStart).toBe(512);expect(e.record.preparation.readyMs).toBeNull();expect(Object.values(e.record.ownership.remaining).every(n=>n===0)).toBe(true);});
});
