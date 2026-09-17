/** Owner draft semantic clock plant. Source media position, never a synthetic performance claim. */
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {applyNamedSpeechVisemes} from '../../../../packages/openclinxr/xr-dialogue/dist/index.js';
import {Group,Mesh,Line,PerspectiveCamera} from 'three';
import {createHumanoidEmotionExpressionState,updateGeneratedHumanoidAnimations} from '../../../../packages/openclinxr/xr-humanoid-animation/dist/index.js';
const names=['viseme_sil','viseme_PP','viseme_aa'];
function fixture(position){
 const mesh={morphTargetDictionary:Object.fromEntries(names.map((n,i)=>[n,i])),morphTargetInfluences:[0,0,0]};
 const root={traverse(fn){fn(mesh);},userData:{}};
 const speech={phonemeSequence:['sil','PP','aa'],startedAtMs:0,durationMs:317009/22050*1000,
  bakedCues:[{phoneme:'sil',atSecond:0,durationSeconds:1.24},{phoneme:'PP',atSecond:1.24,durationSeconds:0.08},{phoneme:'aa',atSecond:1.32,durationSeconds:13.05}]};
 const slot={root,activeSpeech:speech};if(position!==undefined)slot.mediaPositionSeconds=position;
 return{slot,mesh};
}
describe('admitted source-position clock versus wall/dwell time',()=>{
 it('legacy caller without audio position retains the admitted ordinary named driver',()=>{
  const {slot,mesh}=fixture();const r=applyNamedSpeechVisemes(slot,10000);
  expect(r.activeTargetName).toBe('viseme_aa');expect(mesh.morphTargetInfluences[2]).toBeGreaterThan(0);
 });
 it.fails('real source position selects bilabial despite unrelated display wall time',()=>{
  const {slot,mesh}=fixture(()=>1.25);const r=applyNamedSpeechVisemes(slot,10000);
  expect(r.activeTargetName).toBe('viseme_PP');expect(mesh.morphTargetInfluences[1]).toBeGreaterThan(0);
 });
 it.fails('exact baked start is not stretched by the longer native PCM buffer duration',()=>{
  const {slot}=fixture(()=>1.24);
  expect(applyNamedSpeechVisemes(slot,1240).activeTargetName).toBe('viseme_PP');
 });
 it.fails('held source position does not advance with later display callbacks',()=>{
  const {slot}=fixture(()=>1.25);
  const a=applyNamedSpeechVisemes(slot,2000);const b=applyNamedSpeechVisemes(slot,12000);
  expect(a.activeTargetName).toBe('viseme_PP');expect(b.activeTargetName).toBe('viseme_PP');
 });
 it.fails('invalid or missing audio position refuses wall-clock substitution and releases mouth',()=>{
  for(const value of [null,NaN,Infinity,-1]){
   const {slot,mesh}=fixture(()=>value);applyNamedSpeechVisemes(slot,10000);
   expect(mesh.morphTargetInfluences[1]).toBe(0);expect(mesh.morphTargetInfluences[2]).toBe(0);
  }
 });
});

function realLoopFixture(){
 const root=new Group(),actorSlot=new Group();actorSlot.add(root);
 const slot={actorId:'clock-patient',assetId:'clock-fixture',root,actorSlot,
  baseX:0,baseY:0,baseZ:0,baseScaleX:1,baseScaleY:1,baseScaleZ:1,baseRotationY:0,phaseOffsetMs:0,
  mouthCue:new Mesh(),gazeCue:new Line(),eyeFocusCue:new Group(),expressionCue:new Group(),
  emotionExpression:createHumanoidEmotionExpressionState({deterministicClock:true}),sourceComparatorFreezeEnabled:false};
 const speech={actorId:slot.actorId,assetId:slot.assetId,text:'clock fixture',emotion:'neutral',emotionContext:{source:'explicit_fixture',baselineMood:'neutral',cueIds:[],emotion:'neutral'},gazeTargetKind:'learner_camera',gazeTargetActorId:null,
  phonemeSequence:['a'],visemeSequence:['a'],startedAtMs:0,durationMs:317009/22050*1000};
 slot.activeSpeech=speech;slot.mediaPositionSeconds=()=>1.25;
 const ctx={slots:[slot],slotsByActorId:new Map([[slot.actorId,slot]]),actorSlotsByActorId:new Map([[slot.actorId,actorSlot]]),
  virtualDeviceSlotsByActorId:new Map(),activeVirtualDeviceSpeechByActorId:new Map(),runtimePatientActorId:()=>slot.actorId,
  runtimeFamilyActorId:()=>'',runtimeClinicalTeamActorId:()=>'',runtimeActorRole:()=>undefined,isPediatricAsthmaRuntimeScenario:()=>false,
  shouldUseCleanHumanoidSourceComparatorCapture:()=>false,humanoidDialogueDurationMs:()=>2000,applyIdlePosture:()=>{},applyRolePosture:()=>{},
  seatedClipPerforming:()=>false,resolveGazeTargetWorld:(_s,c)=>c.position.clone(),normalizeLiveEmotion:()=> 'neutral',liveTurnForCue:()=>undefined,
  bundleTurnsForScenario:()=>[],runtimeTurnForTraceTag:()=>undefined,isDeterministicCaptureClock:()=>true,isMouthGazePoseReviewCaptureMode:()=>false,
  selectedCaptureMode:()=>'',selectedHumanoidSourceComparator:()=>null,scenarioIdForEvidence:()=> 'clock-unit',comparatorScenarioId:()=> 'clock-unit',
  assetPathForSlot:()=> 'fixture.glb',animationPlaybackForSlot:()=>undefined,morphTargetAppliedTargetCount:()=>0,
  visemeTimelineComparatorEvidencePresent:()=>false,emotionTransitionCuePresent:()=>false,currentSpeechEvidence:()=>undefined,recordActingCueEvidence:()=>{}};
 return{slot,speech,ctx};
}
describe('actual admitted animation-loop lifetime is an independent source-clock boundary',()=>{
 beforeEach(()=>vi.stubGlobal('window',{}));afterEach(()=>vi.unstubAllGlobals());
 it('known short wall-time frame preserves ordinary active speech in the actual loop',()=>{
  const {slot,speech,ctx}=realLoopFixture();updateGeneratedHumanoidAnimations(ctx,1/60,100,new PerspectiveCamera());
  expect(slot.activeSpeech).toBe(speech);
 });
 it('a source-position reader alone does not alter the separate actual-loop wall-expiry policy',()=>{
  const {slot,speech,ctx}=realLoopFixture();updateGeneratedHumanoidAnimations(ctx,1/60,16000,new PerspectiveCamera());
  expect(slot.activeSpeech).toBeUndefined();expect(slot.mediaPositionSeconds()).toBe(1.25);
 });
});

// Audio-owned origin is explicitly source-relative compatibility, never a historical timestamp.
import {createAudioSpeechClock} from '../../../../apps/ui-xr/src/prepared-actor-audio.ts';
describe('explicit audio-owned compatibility accessor through the actual admitted loop',()=>{
 beforeEach(()=>vi.stubGlobal('window',{}));afterEach(()=>vi.unstubAllGlobals());
 function owned(f,reader=()=>1.25,rate=1){return createAudioSpeechClock({slot:f.slot,speech:f.speech,positionSeconds:reader,wallOriginMs:0,rate});}
 it.fails('delayed display frame retains exact owned speech and native duration on source elapsed time',()=>{
  const f=realLoopFixture(),clock=owned(f);clock.snapshot(16000);
  expect(f.slot.activeSpeech).toBe(f.speech);
  expect(f.speech.clockKind).toBe('audio_source_compatibility_accessor');
  expect(f.speech.originalWallStartedAtMs).toBe(0);
  expect(Object.getOwnPropertyDescriptor(f.speech,'originalWallStartedAtMs').writable).toBe(false);
  expect(typeof Object.getOwnPropertyDescriptor(f.speech,'startedAtMs').get).toBe('function');
  expect(16000-f.speech.startedAtMs).toBe(1250);
  expect(f.speech.durationMs).toBe(317009/22050*1000);
  updateGeneratedHumanoidAnimations(f.ctx,1/60,16000,new PerspectiveCamera());
  expect(f.slot.activeSpeech).toBe(f.speech);
  clock.snapshot(18000);expect(18000-f.speech.startedAtMs).toBe(1250);
  expect(f.speech.originalWallStartedAtMs).toBe(0);
  updateGeneratedHumanoidAnimations(f.ctx,1/60,18000,new PerspectiveCamera());
  expect(f.slot.activeSpeech).toBe(f.speech);
 });
 it.fails('invalid null nonfinite negative throwing or suspended source clears only exact owned speech',()=>{
  for(const reader of [()=>null,()=>NaN,()=>Infinity,()=>-1,()=>{throw Error('read-failed');},()=>{throw Error('audio-context-not-running');}]){
   const f=realLoopFixture(),other=realLoopFixture(),clock=owned(f,reader);
   clock.snapshot(16000);expect(f.slot.activeSpeech).toBeUndefined();expect(other.slot.activeSpeech).toBe(other.speech);
   updateGeneratedHumanoidAnimations(f.ctx,1/60,16000,new PerspectiveCamera());
   expect(f.slot.activeSpeech).toBeUndefined();
  }
 });
 it.fails('late invalid snapshot and release cannot clear replacement or another actor',()=>{
  const f=realLoopFixture(),other=realLoopFixture(),clock=owned(f,()=>null);
  const replacement={...f.speech,text:'replacement',startedAtMs:15900};f.slot.activeSpeech=replacement;
  clock.snapshot(16000);clock.release();
  expect(f.slot.activeSpeech).toBe(replacement);expect(other.slot.activeSpeech).toBe(other.speech);
  updateGeneratedHumanoidAnimations(f.ctx,1/60,16000,new PerspectiveCamera());
  expect(f.slot.activeSpeech).toBe(replacement);
 });
 it.fails('release clears owned speech and source end releases through the actual loop',()=>{
  const f=realLoopFixture(),other=realLoopFixture(),clock=owned(f);clock.snapshot(16000);clock.release();
  expect(f.slot.activeSpeech).toBeUndefined();expect(other.slot.activeSpeech).toBe(other.speech);
  const end=realLoopFixture(),endClock=owned(end,()=>317009/22050);endClock.snapshot(16000);
  updateGeneratedHumanoidAnimations(end.ctx,1/60,16000,new PerspectiveCamera());
  expect(end.slot.activeSpeech).toBeUndefined();
 });
 it.fails('non-unit rate is an explicit bounded diagnostic refusal',()=>{
  for(const rate of [0.5,2,0,NaN,Infinity]){const f=realLoopFixture();
   expect(()=>owned(f,()=>1.25,rate)).toThrow('audio-speech-clock-rate-unsupported');
   expect(f.slot.activeSpeech).toBe(f.speech);expect(f.speech.startedAtMs).toBe(0);
  }
 });
});
