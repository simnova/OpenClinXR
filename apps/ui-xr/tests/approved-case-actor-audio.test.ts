/** OWNER plant: valid callable semantic baseline. TEST PCM is not speech or voice-rights evidence. */
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { ActorTurnPlan, ActorTurnExecution } from "@openclinxr/shared-schemas";
import { playFrozenActorTurnOnSlot, playIdentityBoundActorTurn, digestActorTurnPlan, type ActorTurnExecutionArtifacts } from "@openclinxr/xr-dialogue";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import { createActorAudioRuntime } from "@openclinxr/xr-dialogue/actor-audio-runtime";
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function wave() {
  const b = new Uint8Array(44 + 960 * 2), v = new DataView(b.buffer);
  const put = (p: number, s: string) => [...s].forEach((c, i) => {v.setUint8(p+i,c.charCodeAt(0));});
  put(0,"RIFF");v.setUint32(4,b.length-8,true);put(8,"WAVE");put(12,"fmt ");v.setUint32(16,16,true);
  v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,48000,true);v.setUint32(28,96000,true);
  v.setUint16(32,2,true);v.setUint16(34,16,true);put(36,"data");v.setUint32(40,1920,true);
  for(let i=0;i<960;i++)v.setInt16(44+2*i,(i%31-15)*300,true);
  return b;
}
const baselineBundle=createEdChestPainLocalLearnerRuntimeAssetBundle();
const baselineActor=baselineBundle.actors[0]!;
const baselineTurn=baselineBundle.sceneManifest.dialogueTurns.find(t=>t.actorId===baselineActor.actorId)!;
const plan: ActorTurnPlan = {
  planId:"plan-test",planVersion:1,turnId:"turn-test",stationRunId:"run-test",actorId:baselineActor.actorId,respondingActorId:baselineActor.actorId,turnIndex:0,
  spokenText:"Test line",spokenTextForTts:"Test line",dialogueEmotionFrom:"neutral",dialogueEmotionTo:"concerned",somaticEmotion:null,
  eventKind:"learner_dismissive",eventKindSource:"classifier",intensityBucket:"mid",ageBand:"adult",performancePlanId:"perf-test",facePresetId:"face-test",posePresetId:"pose-test",gestureClipIds:[],
  prosody:{wrapTags:[],inlineTags:[],speed:1,droppedTags:[]},voiceId:"TEST-ONLY-approved-voice",languageProvenance:{fallbackUsed:false},claimScope:"simulated_actor_behavior",notEvidenceFor:["voice_rights","phonetic_accuracy"],
};
const execution: ActorTurnExecution = {planId:plan.planId,turnId:plan.turnId,interruption:{kind:"none"},renderedProsodyTags:[],droppedProsodyTags:[],fallback:{language:false,tts:false}};
const wav=wave(), cueDoc={metadata:{soundFile:"test.wav",duration:.02},mouthCues:[{start:0,end:.01,value:"A"},{start:.01,end:.02,value:"D"}]};
const cueBytes=new TextEncoder().encode(JSON.stringify(cueDoc));
const descriptorBase={version:1 as const,plan,execution,scenarioId:baselineBundle.scenarioId,actorId:plan.actorId,traceTag:baselineTurn.traceTag,spokenText:plan.spokenText,planId:plan.planId,planVersion:1,turnId:plan.turnId,planDigest:digestActorTurnPlan(plan),voiceId:plan.voiceId,
  waveformUri:"test:wav",waveformSha256:hash(wav),waveformByteLength:wav.length,cueUri:"test:cues",cueSha256:hash(cueBytes),cueByteLength:cueBytes.length,bakeWaveformSha256:hash(wav),approvalId:"TEST-authority",nativeSampleRate:48000,nativeSampleCount:960};
const ref={actorId:plan.actorId,turnId:plan.turnId,planDigest:digestActorTurnPlan(plan)};
const artifacts: ActorTurnExecutionArtifacts={audio:{...ref,audioUri:descriptorBase.waveformUri,durationMs:20},visemeCues:{...ref,baker:"rhubarb",mouthCues:cueDoc.mouthCues},gaze:{...ref,gazeTargetKind:"learner_camera",gazeTargetActorId:null},emotion:{...ref,from:"neutral",to:"concerned"}};
const descriptor={...descriptorBase,artifacts};
// Exact owner contract uses the admitted factory and normal constructor, never diagnostic ingress.
function setup(options: {approval?: "allow"|"deny"|"missing"; fetch?: (uri:string)=>Promise<Uint8Array>; omitEmotion?: boolean; onSourceStart?: ()=>void; authority?: (request:unknown)=>Promise<boolean>}={}) {
  const ledger: string[]=[], sources: object[]=[];
  const slot: {actorId:string; root:{userData:Record<string,unknown>;traverse():void}; activeSpeech?:{actorId:string;text:string;startedAtMs:number;durationMs:number;visemeSequence:string[];gazeTargetKind?:string;gazeTargetActorId?:string|null;emotion?:string}; emotionExpression?:{targetEmotion?:string};mediaPositionSeconds?:()=>number|null}={actorId:plan.actorId,root:{userData:{},traverse(){}},activeSpeech:undefined};
  let stopFails=false;
  class Context {
    constructor(){ledger.push("construct");}
    state="suspended"; currentTime=0; sampleRate=48000; destination={};
    async resume(){ledger.push("resume");this.state="running";}
    createBuffer(channels:number,count:number,rate:number){ledger.push(`buffer:${channels}:${count}:${rate}`);const samples=new Float32Array(count);return {numberOfChannels:channels,length:count,sampleRate:rate,duration:count/rate,copyToChannel:(p:Float32Array)=>samples.set(p),getChannelData:()=>samples};}
    createMediaStreamDestination(){return {stream:{},connect(){},disconnect(){}};}
    createBufferSource(){const source={buffer:null,playbackRate:{value:1},onended:null,connect(){ledger.push("connect");},disconnect(){ledger.push("disconnect");},start(_when:number,offset:number){ledger.push(`start:${offset}`);options.onSourceStart?.();},stop(){ledger.push("stop");if(stopFails)throw Error("TEST-stop-refusal");}};sources.push(source);return source;}
  }
  vi.stubGlobal("AudioContext",Context);
  vi.stubGlobal("navigator",{userActivation:{isActive:true}});
  const authority = options.approval==="missing" ? undefined : async (request:Omit<typeof descriptor,"plan"|"execution"|"artifacts">) => options.approval!=="deny" && request.voiceId===plan.voiceId && request.approvalId==="TEST-authority" && request.waveformSha256===hash(wav) && request.cueSha256===hash(cueBytes) && request.bakeWaveformSha256===hash(wav) && request.scenarioId===descriptor.scenarioId && request.actorId===plan.actorId && request.turnId===plan.turnId && request.planId===plan.planId && request.planVersion===plan.planVersion && request.planDigest===digestActorTurnPlan(plan) && request.spokenText===plan.spokenText && request.traceTag===descriptor.traceTag && request.nativeSampleRate===48000 && request.nativeSampleCount===960;
  const runtime = createActorAudioRuntime({developmentFixture:false,
    // Proposed trusted constructor dependencies; production authority must be independent of descriptor booleans.
    caseAudio:{fetchBytes:options.fetch??(async(uri:string)=>uri==="test:wav"?wav.slice():cueBytes.slice()),resolveApproval:options.authority??authority},
  });
  runtime.initPreparedActorAudioBridge({getSlot:id=>id===plan.actorId?slot:undefined,triggerDialogue:ctx=>{slot.activeSpeech={actorId:ctx.actorId,text:ctx.spokenText,startedAtMs:0,durationMs:20,visemeSequence:["PP","AA"],gazeTargetKind:ctx.gazeTarget?.kind,gazeTargetActorId:ctx.gazeTarget?.actorId,emotion:ctx.faceEmotion};slot.emotionExpression={targetEmotion:options.omitEmotion?"neutral":ctx.faceEmotion};}});
  const bundle={...baselineBundle,bundleId:"bundle-test",sceneManifest:{...baselineBundle.sceneManifest,dialogueTurns:[{...baselineTurn,actorId:plan.actorId,text:plan.spokenText,actorAudio:{...descriptor,artifacts:structuredClone(artifacts)}}]}};
  const select=()=>{runtime.caseAudio.select(bundle);runtime.caseAudio.bindPlan({plan,execution},baselineTurn.traceTag);};
  return {runtime,slot,bundle,ledger,sources,select,failStop:()=>{stopFails=true;}};
}
afterEach(()=>vi.unstubAllGlobals());
async function ready(f:ReturnType<typeof setup>){f.select();expect(f.runtime.caseAudio.snapshot().selected).toBe(true);expect((await f.runtime.caseAudio.preload(plan)).kind).toBe("verified");await f.runtime.caseAudio.markGesture();}
it("constructor and selection do not construct or start audio",()=>{const f=setup();f.select();expect(f.ledger).toEqual([]);});
it("unselected is null; selected descriptor missing is explicit absent",async()=>{const f=setup();expect(f.runtime.caseAudio.start(plan,execution,{})).toBeNull();Reflect.deleteProperty(f.bundle.sceneManifest.dialogueTurns[0]!,"actorAudio");f.select();expect(f.runtime.caseAudio.snapshot().selected).toBe(true);expect((await f.runtime.caseAudio.preload(plan)).kind).toBe("absent");expect(f.runtime.caseAudio.start(plan,execution,{})).toBeNull();expect(f.ledger).toEqual([]);});
it.each(["missing","deny"] as const)("trusted approval %s refuses before audio start",async approval=>{const f=setup({approval});f.select();expect(f.runtime.caseAudio.snapshot().selected).toBe(true);expect((await f.runtime.caseAudio.preload(plan))?.kind).toBe("refused");expect(f.sources).toHaveLength(0);});
it("approved 48k bytes produce native count/duration and one real player start",async()=>{const f=setup();await ready(f);expect(f.runtime.caseAudio.start(plan,execution,{})).toMatchObject({kind:"audio_started",player:{status:"playing",actorId:plan.actorId,turnId:plan.turnId}});expect(f.sources).toHaveLength(1);expect(f.slot.activeSpeech.durationMs).toBe(20);expect(f.ledger.filter(x=>x.startsWith("start:"))).toEqual(["start:0"]);});
it.each(["scenarioId","actorId","traceTag","spokenText","planId","planVersion","turnId","voiceId","planDigest","bakeWaveformSha256"])("mismatched %s never becomes eligible",async key=>{const f=setup();Object.assign(f.bundle.sceneManifest.dialogueTurns[0]!.actorAudio,{[key]:"WRONG"});f.select();expect(f.runtime.caseAudio.snapshot().selected).toBe(true);expect((await f.runtime.caseAudio.preload(plan))?.kind).toBe("refused");expect(f.sources).toHaveLength(0);});
it("voice identity is checked beyond digest",async()=>{expect(digestActorTurnPlan({...plan,voiceId:"other"})).toBe(digestActorTurnPlan(plan));const f=setup();f.select();expect(f.runtime.caseAudio.snapshot().selected).toBe(true);expect((await f.runtime.caseAudio.preload({...plan,voiceId:"other"}))?.kind).toBe("refused");});
it.each(["test:wav","test:cues"])("actual fetched %s bytes require hash match",async bad=>{const f=setup({fetch:async uri=>{const b=(uri==="test:wav"?wav:cueBytes).slice();if(uri===bad)b[b.length-1]^=1;return b;}});f.select();expect(f.runtime.caseAudio.snapshot().selected).toBe(true);expect((await f.runtime.caseAudio.preload(plan))?.kind).toBe("refused");});
it("late same-text fetch cannot install under a new selected bundle",async()=>{let release!:(v:Uint8Array)=>void;const f=setup({fetch:uri=>uri==="test:wav"?new Promise(r=>{release=r;}):Promise.resolve(cueBytes.slice())});f.select();const pending=f.runtime.caseAudio.preload(plan);await vi.waitFor(()=>expect(release).toBeTypeOf("function"));f.runtime.caseAudio.select({...f.bundle,bundleId:"replacement"});expect(release).toBeTypeOf("function");release(wav.slice());expect((await pending).kind).toBe("stale");expect(f.runtime.caseAudio.start(plan,execution,{})?.kind).toBe("refused");});
it("dispose old selection cannot erase newer equal-text eligibility",async()=>{const f=setup();await ready(f);const old=await f.runtime.caseAudio.preload(plan);expect(old.kind).toBe("verified");if(old.kind!=="verified")throw Error("owner control not ready");f.select();await f.runtime.caseAudio.preload(plan);f.runtime.caseAudio.dispose(old.selection);expect(f.runtime.caseAudio.snapshot().verifiedCount).toBe(1);await f.runtime.caseAudio.markGesture();expect(f.runtime.caseAudio.start(plan,execution,{})?.kind).toBe("audio_started");expect(f.sources).toHaveLength(1);});
it("gesture is real context readiness; caller labels do not unlock start",async()=>{const f=setup();f.select();await f.runtime.caseAudio.preload(plan);expect(f.runtime.caseAudio.start(plan,execution,{})?.kind).toBe("refused");expect(f.sources).toHaveLength(0);});
it("wrong artifact reference refuses; player boolean is not a prepared-start promise",async()=>{const f=setup();await ready(f);f.bundle.sceneManifest.dialogueTurns[0].actorAudio.artifacts={...artifacts,audio:{...artifacts.audio!,turnId:"wrong"}};f.select();await f.runtime.caseAudio.preload(plan);expect(f.runtime.caseAudio.start(plan,execution,{})?.kind).toBe("refused");expect(f.sources).toHaveLength(0);});
it("owned stop refusal preserves old owner and starts no second source",async()=>{const f=setup();await ready(f);f.runtime.caseAudio.start(plan,execution,{});const old=f.slot.activeSpeech;f.failStop();expect(f.runtime.caseAudio.start(plan,execution,{})?.kind).toBe("refused");expect(f.slot.activeSpeech).toBe(old);expect(f.sources).toHaveLength(1);expect(f.ledger.filter(x=>x==="stop")).toHaveLength(1);});
it("copied snapshot cannot mutate eligibility",async()=>{const f=setup();await ready(f);const s=f.runtime.caseAudio.snapshot();s.verifiedCount=999;expect(f.runtime.caseAudio.snapshot().verifiedCount).toBe(1);});

function onSlotControl(label:string,speakResult:boolean,cancelled:boolean) {
  const p={...plan,planId:`plan-${label}`,turnId:`turn-${label}`,stationRunId:`station-${label}`};
  const ex={...execution,planId:p.planId,turnId:p.turnId,interruption:{kind:cancelled?"truncated" as const:"none" as const}};
  const old={actorId:p.actorId,text:p.spokenText,visemeSequence:["PP"]};
  const slot={activeSpeech:old as typeof old|undefined,emotionExpression:{targetEmotion:"neutral"},root:{userData:{} as Record<string,unknown>}};
  let writes=0;
  const result=playFrozenActorTurnOnSlot(p,ex,{nowMs:100,clipNames:[],getSlot:()=>slot,
    speak:()=>{if(speakResult)slot.activeSpeech={...old};return speakResult;},
    playClip:()=>{writes++;return true;},startFaceTransition:(_id,emotion)=>{writes++;slot.emotionExpression.targetEmotion=emotion;}});
  return {result,slot,old,writes};
}
it("actual OnSlot false speak guards later effective writes and preserves prior speech",()=>{
  const f=onSlotControl("false-owned",false,false);
  expect(f.result.lanes.some(l=>l.modality==="voice")).toBe(false);
  expect(f.slot.activeSpeech).toBe(f.old);expect(f.writes).toBe(0);
  expect(f.slot.emotionExpression.targetEmotion).toBe("neutral");expect(f.slot.root.userData).toEqual({});
});
it("actual OnSlot cancelled refused start cannot clear prior owner",()=>{
  const f=onSlotControl("cancel-refused",false,true);
  expect(f.result.cancelled).toBe(true);expect(f.slot.activeSpeech).toBe(f.old);
  expect(f.slot.emotionExpression.targetEmotion).toBe("neutral");expect(f.writes).toBe(0);
});
it("actual OnSlot cancelled successful new speech still cleans the newly owned state",()=>{
  const f=onSlotControl("cancel-new",true,true);
  expect(f.result.cancelled).toBe(true);expect(f.slot.activeSpeech).toBeUndefined();
  expect(f.slot.root.userData.openClinXrActorTurnPlaybackCancelled).toBe(true);
});
it("existing identity player calls later adapters after false audio, requiring the real wrapper latch",()=>{
  const calls:string[]=[];
  const r=playIdentityBoundActorTurn(plan,artifacts,{adapters:{startAudio:()=>{calls.push("audio");return false;},startViseme:()=>{calls.push("viseme");return true;},startGaze:()=>{calls.push("gaze");return true;},startEmotion:()=>{calls.push("emotion");return true;}}});
  expect(r.status).toBe("blocked");expect(calls).toEqual(["audio","viseme","gaze","emotion"]);
});

it("accepted source with unfulfilled affect compensates only its owned generation",async()=>{
  const f=setup({omitEmotion:true});await ready(f);
  expect(f.runtime.caseAudio.start(plan,execution,{})?.kind).toBe("refused");
  expect(f.sources).toHaveLength(1);expect(f.ledger.filter(x=>x==="stop")).toHaveLength(1);
  expect(f.slot.activeSpeech).toBeUndefined();expect(f.slot.mediaPositionSeconds).toBeUndefined();
});
it("partial audio setup preserves speech replaced by a source-start callback",async()=>{
  const replacement={actorId:plan.actorId,text:"newer owner",startedAtMs:77,durationMs:50,visemeSequence:["AA"]};
  let f:ReturnType<typeof setup>;f=setup({onSourceStart:()=>{f.slot.activeSpeech=replacement;}});await ready(f);
  expect(f.runtime.caseAudio.start(plan,execution,{})?.kind).toBe("refused");
  expect(f.sources).toHaveLength(1);expect(f.slot.activeSpeech).toBe(replacement);
  expect(f.ledger.filter(x=>x==="stop")).toHaveLength(1);
});

it("programmatic gesture cannot allocate context or claim activation",async()=>{
  const f=setup();f.select();expect((await f.runtime.caseAudio.preload(plan)).kind).toBe("verified");
  vi.stubGlobal("navigator",{userActivation:{isActive:false}});
  await f.runtime.caseAudio.markGesture();
  expect(f.ledger.filter(x=>x==="construct")).toHaveLength(0);
  expect(f.runtime.caseAudio.start(plan,execution,{})?.kind).toBe("refused");
});

it.each(["nativeSampleRate","nativeSampleCount","waveformByteLength","cueByteLength"])("decoded/fetched evidence agrees with declared %s independently of approval",async key=>{
  const f=setup({authority:async()=>true});Object.assign(f.bundle.sceneManifest.dialogueTurns[0]!.actorAudio,{[key]:1});
  f.select();expect(f.runtime.caseAudio.snapshot().selected).toBe(true);
  expect((await f.runtime.caseAudio.preload(plan)).kind).toBe("refused");expect(f.sources).toHaveLength(0);
});
it("approved waveform cannot start an artifact naming a different audible URI",async()=>{
  const f=setup();f.bundle.sceneManifest.dialogueTurns[0]!.actorAudio.artifacts.audio!.audioUri="test:unapproved-other";
  f.select();expect(f.runtime.caseAudio.snapshot().selected).toBe(true);
  expect((await f.runtime.caseAudio.preload(plan)).kind).toBe("refused");expect(f.sources).toHaveLength(0);
});
it("approved cue bytes cannot authorize different embedded mouth cues",async()=>{
  const f=setup();f.bundle.sceneManifest.dialogueTurns[0]!.actorAudio.artifacts.visemeCues!.mouthCues=[{start:0,end:.02,value:"B"}];
  f.select();expect(f.runtime.caseAudio.snapshot().selected).toBe(true);
  expect((await f.runtime.caseAudio.preload(plan)).kind).toBe("refused");expect(f.sources).toHaveLength(0);
});
