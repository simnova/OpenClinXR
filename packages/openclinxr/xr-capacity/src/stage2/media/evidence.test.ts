import {describe,it,expect} from 'vitest';
import {gradeStage2Run} from '../../entrypoints/stage2.js';
import {negativeFixture} from './run.test-support.js';
import type {Stage2RunRecord} from '../../entrypoints/stage2.js';
function exercised(mode:Parameters<typeof negativeFixture>[0],mutate?:(r:Stage2RunRecord)=>void){const {record,release}=negativeFixture(mode);mutate?.(record);return gradeStage2Run(record,release).negative?.exercised;}
describe('actual negative boundaries through the public run verdict',()=>{
 it('joins actual completezero and retained terminal partial exactly to applied-output latch',()=>{expect(exercised('remote-output-disconnected')).toBe(true);});
 it('rejects oldzero with a later unobserved latch or command issued before injection',()=>{
  expect(exercised('remote-output-disconnected',r=>{const p=r.marks[0]?.browser.ack?.downlinkMonitor?.position;if(!p)throw Error('fixture');p.processedFrames+=128;p.tag.value+=128;})).toBe(false);
  expect(exercised('remote-output-disconnected',r=>{if(!r.negative||!r.marks[0])throw Error('fixture');r.marks[0].browser.sentMs=r.negative.injectedAtBrowserMs!-1;})).toBe(false);
 });
 it('rejects intervening nonzero or nonfinite tail and nonfinite injection time',()=>{
  for(const mutate of [(r:Stage2RunRecord)=>{r.decoded.downlink.bins[1]!.nonzeroSamples=1;},(r:Stage2RunRecord)=>{r.decoded.downlink.bins[1]!.nonfiniteSamples=1;},(r:Stage2RunRecord)=>{if(!r.negative)throw Error('fixture');r.negative.injectedAtBrowserMs=NaN;}])expect(exercised('remote-output-disconnected',mutate)).toBe(false);
 });
 it('credits five seconds only in both actual phase latches',()=>{
  expect(exercised('early-peer-close')).toBe(true);
  for(const key of ['uplinkDecoded','downlinkMonitor'] as const)expect(exercised('early-peer-close',r=>{const c=r.negative?.preInjectionCheckpoint;if(!c)throw Error('fixture');c[key].processedFrames--;c[key].tag.value--;})).toBe(false);
 });
 it('does not replace absent START with final lifetime positions',()=>{expect(exercised('early-peer-close',r=>{r.marks=r.marks.filter(m=>m.command!=='start');})).toBe(false);});
 it('requires actual complete400Hz uplink content rather than any nonzero decoded signal',()=>{
  expect(exercised('uplink-only')).toBe(true);
  for(const corrupt of [(r:Stage2RunRecord)=>{for(const b of r.decoded.uplink.bins){[b.tone.real400,b.tone.real700]=[b.tone.real700,b.tone.real400];[b.tone.power400,b.tone.power700]=[b.tone.power700,b.tone.power400];}},(r:Stage2RunRecord)=>{for(const b of r.decoded.uplink.bins)b.partialReason='phase-boundary';},(r:Stage2RunRecord)=>{r.decoded.uplink.bins[1]!.tone.power400=0;r.decoded.uplink.bins[1]!.tone.power700=.001;}])expect(exercised('uplink-only',corrupt)).toBe(false);
 });
});
