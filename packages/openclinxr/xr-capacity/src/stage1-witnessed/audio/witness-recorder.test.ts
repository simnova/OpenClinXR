import {describe,it,expect} from "vitest";
import { WitnessRecorder } from "../../entrypoints/stage1-witnessed.js";
import { WITNESS_FIELDS, collectedWitnessCounters } from "../../stage1/audio/worklet-wire.test-support.js";
const counters=(start=0,frames=24064)=>({frameStart:start,frameEnd:start+frames,sampleRate:48000,blocks:frames/128,frames,quantumMin:128,quantumMax:128,frameDiscontinuities:0,sampleRateChanges:0,nonfiniteOutputSamples:0,nonzeroOutputSamples:0});
const row=(sequence=0,start=0,frames=24064)=>new Float64Array([sequence,...WITNESS_FIELDS.map(k=>counters(start,frames)[k])]);
describe('witness scalar storage',()=>{
 it('keeps the first full bin complete and only the actual short tail partial',()=>{const r=new WitnessRecorder();expect(r.acceptBatch(row())).toBe(true);expect(r.acceptBatch(row(1,24064,128))).toBe(true);const s=r.snapshot();expect(s.windows.map(w=>w.partial)).toEqual([false,true]);expect(s.windows[0]?.sequence).toBe(0);});
 it('rejects fractional frames and impossible block/quantum counts',()=>{expect(collectedWitnessCounters({...counters(),frameStart:.5})).toBeNull();expect(collectedWitnessCounters({...counters(),blocks:1})).toBeNull();expect(collectedWitnessCounters({...counters(),frames:NaN})).toBeNull();});
 it('retains positive error counts as data so the engine can fail rather than erase them',()=>{const c={...counters(),frameDiscontinuities:1,nonfiniteOutputSamples:1};expect(collectedWitnessCounters(c)).toEqual(c);});
 it('rejects malformed shape/sequence and storage overflow without overwriting row0',()=>{const r=new WitnessRecorder();expect(r.acceptBatch(row(1))).toBe(false);expect(r.acceptBatch(new Float64Array([0]))).toBe(false);for(let i=0;i<512;i++)expect(r.acceptBatch(row(i,i*128,128))).toBe(true);expect(r.acceptBatch(row(512))).toBe(false);expect(r.rows).toBe(512);expect(r.storage[0]).toBe(0);expect(r.record.rejected).toBe(3);});
});
