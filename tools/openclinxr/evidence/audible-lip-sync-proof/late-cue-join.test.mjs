/** Actual admitted async join: equal text is not source/object identity. */
import {it,expect,vi,afterEach} from 'vitest';
import {attachBakedCuesToSpeech} from '../../../../packages/openclinxr/xr-dialogue/dist/index.js';
afterEach(()=>vi.unstubAllGlobals());
async function delayedJoin(change){
 let resolveResponse;const pending=new Promise(resolve=>{resolveResponse=resolve;});
 vi.stubGlobal('fetch',()=>pending);
 const requested={text:'same text',durationMs:14376.825,bakedCues:[{phoneme:'PP',atSecond:0,durationSeconds:14.376825}],startedAtMs:100};
 const slot={root:{traverse(){},userData:{}},activeSpeech:requested};
 attachBakedCuesToSpeech(slot,requested.text,'owner-join-'+crypto.randomUUID());
 change?.(slot,requested);
 resolveResponse({ok:true,json:async()=>({mouthCues:[{start:0,end:1,value:'D'}]})});
 await new Promise(resolve=>setTimeout(resolve,0));
 return {slot,requested};
}
it('ordinary same-object served bake still attaches',async()=>{
 const {slot}=await delayedJoin();expect(slot.activeSpeech.durationMs).toBe(1000);
 expect(slot.root.userData.openClinXrBakedVisemeTimeline.cueCount).toBe(1);
});
it('equal-text replacement is not the object that requested the delayed bake',async()=>{
 const {slot}=await delayedJoin(slot=>{slot.activeSpeech={...slot.activeSpeech,durationMs:7777};});
 expect(slot.activeSpeech.durationMs).toBe(7777);expect(slot.root.userData.openClinXrBakedVisemeTimeline).toBeUndefined();
});
it('audio-owned speech retains its native duration and exact source cues',async()=>{
 const {slot,requested}=await delayedJoin(slot=>{slot.mediaPositionSeconds=()=>1.25;});
 expect(requested.durationMs).toBe(14376.825);expect(requested.bakedCues[0].phoneme).toBe('PP');
 expect(slot.root.userData.openClinXrBakedVisemeTimeline).toBeUndefined();
});
it('pause/removal before delayed response does not resurrect speech',async()=>{
 const {slot}=await delayedJoin(slot=>{slot.activeSpeech=undefined;});
 expect(slot.activeSpeech).toBeUndefined();expect(slot.root.userData.openClinXrBakedVisemeTimeline).toBeUndefined();
});

it('equal-value distinct-object replay cannot receive the old delayed bake',async()=>{
 const {slot,requested}=await delayedJoin(slot=>{slot.activeSpeech={...slot.activeSpeech};});
 expect(slot.activeSpeech).not.toBe(requested);
 expect(slot.activeSpeech.text).toBe(requested.text);
 expect(slot.activeSpeech.startedAtMs).toBe(requested.startedAtMs);
 expect(slot.activeSpeech.durationMs).toBe(14376.825);
 expect(slot.activeSpeech.bakedCues[0].phoneme).toBe('PP');
 expect(slot.root.userData.openClinXrBakedVisemeTimeline).toBeUndefined();
});
