import {it,expect} from "vitest";
import {installPreparedActorAudioRuntime,startPreparedActorTurnAudioOutcome,syncPreparedActorAudio} from "../../../../apps/ui-xr/src/prepared-actor-audio.ts";
import {startActorTurnSpeech} from "../../../../apps/ui-xr/src/ordinary-actor-turn-speech.ts";
function ownedFixture(actorId){
 const slot={},sources=[];let dialogueStarts=0;
 const context={state:"running",currentTime:1,sampleRate:22050,createBufferSource(){
  const state={refuseStop:false,started:0};sources.push(state);
  return{playbackRate:{value:1},connect(){},start(){state.started++;},stop(){if(state.refuseStop)throw Error("owned-stop-refused");}};
 }};
 installPreparedActorAudioRuntime({context,destination:{},getSlot:()=>slot,triggerDialogue(ctx){dialogueStarts++;slot.activeSpeech={text:ctx.spokenText,startedAt:0,durationMs:1000};},
 entry:{scenarioId:"TEST_ONLY",actorId,responseText:"same line",runnerConversationTurn:1,waveformSha256:"a".repeat(64),cueSha256:"b".repeat(64),buffer:{duration:1},cues:[{phoneme:"PP",atSecond:0,durationSeconds:1}],decodedSampleRate:22050,decodedSampleCount:22050}});
 return{slot,sources,context,dialogueStarts:()=>dialogueStarts,ctx:{actorId,spokenText:"same line"}};
}
it("prepared-to-prepared stop refusal preserves prior owned state and names exact reason",()=>{
 const f=ownedFixture("typed-ownership");expect(startPreparedActorTurnAudioOutcome(f.ctx)).toEqual({kind:"audio_started"});
 const speech=f.slot.activeSpeech,reader=f.slot.mediaPositionSeconds;f.sources[0].refuseStop=true;
 expect(startPreparedActorTurnAudioOutcome(f.ctx)).toEqual({kind:"refused",reason:"owned_stop_refusal"});
 expect(f.sources).toHaveLength(1);expect(f.dialogueStarts()).toBe(1);expect(f.slot.activeSpeech).toBe(speech);expect(f.slot.mediaPositionSeconds).toBe(reader);
 f.sources[0].refuseStop=false;
 expect(startPreparedActorTurnAudioOutcome(f.ctx)).toEqual({kind:"audio_started"});
 expect(f.sources).toHaveLength(2);expect(f.dialogueStarts()).toBe(2);expect(f.slot.activeSpeech).not.toBe(speech);
});
it("suspended prepared retry is a distinct refusal and starts no second source",()=>{
 const f=ownedFixture("typed-suspended");expect(startPreparedActorTurnAudioOutcome(f.ctx).kind).toBe("audio_started");f.context.state="suspended";
 expect(startPreparedActorTurnAudioOutcome(f.ctx)).toEqual({kind:"refused",reason:"suspended"});expect(f.sources).toHaveLength(1);
});
it("retiring old owned audio does not overwrite a replacement reader or speech from another owner",()=>{
 const f=ownedFixture("foreign-reader");expect(startPreparedActorTurnAudioOutcome(f.ctx).kind).toBe("audio_started");
 const foreignSpeech={text:"replacement",startedAt:10,durationMs:1000},foreignReader=()=>42;
 f.slot.activeSpeech=foreignSpeech;f.slot.mediaPositionSeconds=foreignReader;
 expect(startActorTurnSpeech({actorId:f.ctx.actorId,spokenText:"ordinary next"},()=>true)).toEqual({kind:"dialogue_only",reason:"prepared_audio_unavailable"});
 syncPreparedActorAudio(9999);expect(f.slot.activeSpeech).toBe(foreignSpeech);expect(f.slot.mediaPositionSeconds).toBe(foreignReader);
});
