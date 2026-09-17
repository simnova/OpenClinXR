/** Consumed-host counterweight. Static wiring complements, never replaces real Vite runtime proof. */
import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
const main=()=>readFileSync(new URL('../../../../apps/ui-xr/src/main.ts',import.meta.url),'utf8');
it('known product main really consumes admitted frozen playback and existing dev speak bridge',()=>{
 const source=main();expect(source).toMatch(/return playFrozenActorTurnOnSlot\(plan, execution/);
 expect(source).toMatch(/initSpeakFixtureBridge\(\{/);expect(source).toMatch(/actorDialogueStore\.triggerHumanoidDialogue\(/);
});
it.fails('the real product host imports prepared audio source from its app-local module',()=>{
 expect(main()).toMatch(/import\s*\{[^}]*startPreparedActorTurnAudio[^}]*\}\s*from\s*["']\.\/prepared-actor-audio\.js["']/);
});
it.fails('the real speak handshake acknowledges the shared source manager instead of unconditional true',()=>{
 const source=main();const begin=source.indexOf('function playLiveFrozenActorTurn(');const end=source.indexOf('function hasAuthoredClinicalIdlePoseClip(',begin);
 const host=source.slice(begin,end);expect(host).toMatch(/speak:\s*\(?ctx\)?\s*=>\s*startPreparedActorTurnAudio\(/);
 expect(host).not.toMatch(/speak:\s*\(ctx\)\s*=>\s*\{[\s\S]*?return true;/);
});
it.fails('actual displayed frame snapshots source clock immediately before existing sole animation writer',()=>{
 expect(main()).toMatch(/syncPreparedActorAudio\(now\);\s*updateGeneratedHumanoidAnimations\(deltaSeconds, now, camera, genDriveForHumanoid\)/);
});
it.fails('the existing dev dialogue ingress and preparation bridge are wired rather than a second renderer-only path',()=>{
 expect(main()).toMatch(/initPreparedActorAudioBridge\(/);
 const source=main(),begin=source.indexOf('initSpeakFixtureBridge({'),end=source.indexOf('function buildHumanoidSpeechEvidence(',begin);
 expect(source.slice(begin,end)).toMatch(/startPreparedActorTurnAudio\(/);
});

// Exercise the consumed manager itself: a lower-level playback refusal cannot prove host ACK.
import {startPreparedActorTurnAudio} from '../../../../apps/ui-xr/src/prepared-actor-audio.ts';
it.fails('unprepared product source manager returns false instead of acknowledging voice',()=>{
 expect(startPreparedActorTurnAudio({actorId:'clock-patient',spokenText:'clock fixture'})).toBe(false);
});
it.fails('caller running-context labels cannot grant an unprepared product voice ACK',()=>{
 expect(startPreparedActorTurnAudio({actorId:'clock-patient',spokenText:'clock fixture',contextState:'running',userActivated:true})).toBe(false);
});
