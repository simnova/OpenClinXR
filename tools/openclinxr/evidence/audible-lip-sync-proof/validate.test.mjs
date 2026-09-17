import {it as test} from "vitest";import assert from "node:assert/strict";import {inspectMetadata} from "./validate.mjs";
function valid(){return {schemaVersion:1,claimScope:"local-prerecorded-coarse-mouth-clock-proof",notTested:["physical-speaker-output-and-perceptual-phonetic-sync"],captureHead:"a".repeat(40),runId:"immutable-run-1",attempts:[{manifestPath:"attempt.json",sha256:"b".repeat(64)}],segments:[{when:10,offset:0,rate:1,generation:"A:1",nodeSerial:1}],frames:[10,10.1,10.2].map((t,i)=>({contextTime:t,observationKind:"raf-callback",generation:"A:1",nodeSerial:1,state:"playing",sourcePositionSeconds:t-10,driveNowMs:(t-10)*1000,frameIndex:i,activeTargetName:i===0?"viseme_PP":"viseme_aa",appliedMeshCount:1})),decodedSampleRate:48000,decodedSampleCount:480000,contextStateAtStart:"running",userActivated:true,fixtureRights:"installed-rhubarb-demo-local-diagnostic-only",cueInterpretation:"approximate-rhubarb-nine-shape-not-phone-precision",framing:{cameraMatrixWorld:Array(16).fill(0),viewport:[640,640]},sourceBindings:[1,2,3].map(i=>({path:"source"+i,sha256:"a".repeat(64)})),files:{inputWav:{},cues:{},video:{},playedPcm:{}}};}
test("coherent source-domain positive control passes metadata integrity without claiming perception",()=>assert.deepEqual(inspectMetadata(valid()),[]));
for(const [name,mutate,reason] of [
 ["wall time substituted",r=>r.frames[1].driveNowMs=9999,"rig-clock-mismatch"],
 ["stale same-text generation",r=>r.frames[1].generation="A:old","stale-or-unbound-frame"],
 ["inserted synthetic observation",r=>r.frames[1].observationKind="padded","invented-observation"],
 ["false source start",r=>r.contextStateAtStart="suspended","unactivated-or-suspended-start"],
 ["metadata-only rig",r=>r.frames[1].appliedMeshCount=0,"rig-not-applied"],
 ["missing closed bilabial",r=>r.frames.forEach(f=>f.activeTargetName="viseme_aa"),"closed-bilabial-not-observed"],
 ["unlicensed public claim",r=>r.fixtureRights="redistribute","fixture-rights"],
 ["source offset ignored",r=>r.segments[0].offset=1,"source-clock-mismatch"],
 ["rate ignored",r=>r.segments[0].rate=2,"source-clock-mismatch"],
 ["unknown state bypass",r=>r.frames[1].state="fabricated","non-playing-proof-frame"],
 ["duplicate source segment",r=>r.segments.push({...r.segments[0]}),"ambiguous-source-segments"],
 ["unbound source identity",r=>r.sourceBindings=[1,2,3],"source-bindings-missing"],
 ["no attempted-outcome record",r=>r.attempts=[],"immutable-attempt-ledger"]
])test(name+" is refused",()=>{const r=valid();mutate(r);assert.ok(inspectMetadata(r).includes(reason));});
