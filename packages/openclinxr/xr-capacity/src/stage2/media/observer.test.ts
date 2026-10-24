import {runInNewContext} from 'node:vm';
import {describe,it,expect} from 'vitest';
import {Stage2Observer} from "../../entrypoints/stage2.js";
import {emptyHealth,fixture} from '../grading/fixtures.test-support.js';
import type {Stage2RunRecord} from "../../entrypoints/stage2.js";
function emptySource():Stage2RunRecord["sources"]["uplink"]{const s=fixture().record.sources.uplink;return {...s,initialQuantum:null,targetBinFrames:null,bins:[],origin:null,final:null,total:emptyHealth(),stopped:false};}
function emptyConsumer():Stage2RunRecord["decoded"]["downlink"]{const s=fixture().record.decoded.downlink;return {...s,sampleRate:null,channels:null,initialQuantum:null,targetBinFrames:null,bins:[],origin:null,final:null,total:emptyHealth(),firstDecodedAtLocalMs:null,firstNonzeroAtLocalMs:null};}
import {STAGE2_WORKLET_SOURCE} from "../../entrypoints/stage2.js";
import {Stage2Budget} from "../../entrypoints/stage2.js";
interface Proc {process(inputs:unknown,outputs:unknown):boolean;port:{onmessage:((e:{data:unknown})=>void)|null}}
function flow(mode:'generator'|'monitor'='generator',budget?:Stage2Budget) {
 const queue:unknown[]=[],faults:string[]=[],events:string[]=[],record=mode==='generator'?emptySource():emptyConsumer();let frame=12037,Type:(new(options:unknown)=>Proc)|undefined;
 class Base {port={onmessage:null as null|((e:{data:unknown})=>void),postMessage:(v:unknown)=>queue.push(structuredClone(v))};}
 runInNewContext(STAGE2_WORKLET_SOURCE,{AudioWorkletProcessor:Base,Float64Array,Float32Array,get currentFrame(){return frame;},get currentTime(){return frame/48000;},sampleRate:48000,registerProcessor:(_n:string,t:unknown)=>{Type=t as new(options:unknown)=>Proc;}});
 if(!Type)throw Error('processor missing');const proc=new Type({processorOptions:{mode}}),port={onmessage:null as null|((e:{data:unknown})=>void),postMessage:(v:unknown)=>proc.port.onmessage?.({data:v}),close:()=>{}};
 const node={port,onprocessorerror:null},observer=new Stage2Observer(node,record,mode,r=>faults.push(r),t=>events.push(t),budget);
 const deliver=()=>{while(queue.length)port.onmessage?.({data:queue.shift()});};
 const step=(silent=false)=>{const input=new Float32Array(128);if(!silent)for(let i=0;i<128;i++)input[i]=.002*Math.sin(2*Math.PI*700*(frame+i)/48000);const active=proc.process(mode==='monitor'?[[input]]:[],[[new Float32Array(128)]]);frame+=128;deliver();return active;};
 const stop=()=>{void observer.stop();for(let i=0;i<20;i++)if(!step())break;deliver();};
 return {observer,record,faults,events,step,stop,port,deliver};
}
describe('browser observer consumes real generated processor messages (VM only)',()=>{
 it('recounts firstcallback, phase partials and finaltail without resetting lifetime counters',async()=>{
  const h=flow();for(let i=0;i<200;i++)h.step();await h.observer.active;const start=h.observer.mark('start','start');h.step();const first=await start;for(let i=0;i<200;i++)h.step();const end=h.observer.mark('end','end');h.step();const last=await end;h.stop();await h.observer.final;
  expect(h.faults).toEqual([]);expect(first.position.processedFrames).toBe(25600);expect(last.position.processedFrames).toBe(51328);expect(h.record.origin?.tag.value).toBe(12037);expect(h.record.total.frames).toBe(h.record.bins.reduce((n,b)=>n+b.frames,0));expect(h.record.bins[0]?.partialReason).toBeNull();expect(h.record.final?.tag.value).toBe(12037+h.record.total.frames);expect(h.observer.finalReceived).toBe(true);
 });
 it('does not waive the first full qualified silent bin',async()=>{
  const h=flow('monitor');h.step();const ack=h.observer.mark('start','start');h.step(true);await ack;for(let i=0;i<190;i++)h.step(true);const full=h.record.bins.find(b=>b.phase==='qualified'&&b.partialReason===null);expect(full?.nonzeroSamples).toBe(0);expect(h.faults.some(f=>f.includes('qualified partial/bin is silent'))).toBe(true);h.stop();
 });
 it('rejects unknown and unsolicited marker messages rather than inventing acknowledgements',()=>{const h=flow();h.port.onmessage?.({data:{type:'imagined-success'}});h.port.onmessage?.({data:{type:'mark',markerId:'not-sent',command:'start',phase:'qualified',position:{}}});expect(h.observer.rejected).toBe(2);expect(h.faults).toHaveLength(2);});
 it('rejects fractional or inconsistent scalar counters and rawframe tags through observer messages',()=>{
  const h=flow();h.step();expect(h.faults).toEqual([]);expect(h.record.total.frames).toBe(128);
  for(const total of [{...h.record.total,frames:127.5},{...h.record.total,finiteSamples:127}])h.port.onmessage?.({data:{type:'first',total,position:h.record.final}});
  h.port.onmessage?.({data:{type:'first',total:h.record.total,position:{...h.record.final,tag:{kind:'worklet-currentFrame',value:3.5,timeBaseNumerator:1,timeBaseDenominator:48000}}}});
  expect(h.faults).toHaveLength(3);expect(h.faults.every(f=>f.includes('cumulative counter/position'))).toBe(true);
 });
 it('refuses a new canonical bin before retention when exact history reservation is full',()=>{const first=flow();for(let i=0;i<188;i++)first.step();const one=first.record.bins[0]!;const budget=new Stage2Budget(new TextEncoder().encode(JSON.stringify(one)).byteLength+1,0),h=flow('generator',budget);for(let i=0;i<188;i++)h.step();expect(h.record.bins).toHaveLength(1);const saved=structuredClone(h.record.bins[0]);for(let i=0;i<188;i++)h.step();expect(h.record.bins).toHaveLength(1);expect(h.record.bins[0]).toEqual(saved);expect(budget.audit().rejectedReservations).toBe(1);expect(h.faults.some(f=>f.includes('budget-exhausted'))).toBe(true);h.observer.close();});
 it('rejects forged final with positive lifetime but no retained bins',()=>{const h=flow();h.step();h.port.onmessage?.({data:{type:'final',total:h.record.total,position:h.record.final,rows:0,overflow:0}});expect(h.observer.finalReceived).toBe(false);expect(h.faults.at(-1)).toContain('final rows incomplete');});
 it('rejects a report sequence skip and closes pending marker promises',async()=>{const h=flow();h.step();h.port.onmessage?.({data:{type:'report',sequence:2,rows:new Float64Array(33)}});expect(h.faults.at(-1)).toContain('report sequence');const pending=h.observer.mark('pending','start');h.observer.close();await expect(pending).rejects.toThrow('media stopped');expect(h.observer.pendingCount).toBe(0);expect(h.port.onmessage).toBeNull();});
});
