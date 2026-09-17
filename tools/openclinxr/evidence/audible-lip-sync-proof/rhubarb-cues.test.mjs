import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyNamedSpeechVisemes } from "../../../../packages/openclinxr/xr-dialogue/dist/index.js";
import { convertRhubarb } from "./rhubarb-cues.mjs";

const file = readFileSync(new URL("../../../../apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb", import.meta.url));
const document = JSON.parse(file.subarray(20,20+file.readUInt32LE(12)).toString());
const targets = [...new Set(document.meshes.flatMap(m => m.extras?.targetNames ?? []))].filter(n => n.startsWith("viseme_"));
const shapes = ["A","B","C","D","E","F","G","H","X"];
const doc = {mouthCues: shapes.map((value,i)=>({value,start:i,end:i+1}))};
function slot() {const mesh={morphTargetDictionary:Object.fromEntries(targets.map((n,i)=>[n,i])),morphTargetInfluences:targets.map(()=>0)};return {root:{traverse(fn){fn(mesh);}},activeSpeech:{phonemeSequence:["a"],startedAtMs:0,durationMs:9000,bakedCues:convertRhubarb(doc)}};}

it("counterweight: actual committed gown carries the fifteen named targets, not guessed ARKit names",()=>{
 expect(targets).toHaveLength(15); expect(targets).toContain("viseme_PP");expect(targets).toContain("viseme_aa");expect(targets).toContain("viseme_FF");expect(targets).not.toContain("viseme_IH");
});
it("counterweight: admitted driver applies an existing named target to a coherent live fixture",()=>{
 const s=slot();s.activeSpeech.bakedCues=[{phoneme:"aa",atSecond:0,durationSeconds:9}];const r=applyNamedSpeechVisemes(s,500);expect(r.appliedMeshCount).toBe(1);expect(r.activeTargetName).toBe("viseme_aa");expect(r.jawOpenRadians).toBeGreaterThan(0);
});
it("closed bilabial A selects PP with shut jaw instead of the current open AA",()=>{
 const s=slot();const r=applyNamedSpeechVisemes(s,500);expect(convertRhubarb(doc)[0].phoneme).toBe("PP");expect(r.activeTargetName).toBe("viseme_PP");expect(r.jawOpenRadians).toBe(0);
});
it("all nine documented coarse shapes have distinct honest semantic assignments and resolve on the actual shipped dictionary",()=>{
 // Approximate nine-shape reduction, not phone precision: B clench/consonants, H tongue-L.
 expect(convertRhubarb(doc).map(c=>c.phoneme)).toEqual(["PP","DD","E","aa","O","U","FF","nn","sil"]);
 for(let i=0;i<shapes.length;i++){const r=applyNamedSpeechVisemes(slot(),i*1000+500);expect(r.activeTargetName,shapes[i]).not.toBeNull();expect(r.appliedMeshCount,shapes[i]).toBe(1);}
});
it("unknown shape, negative/overlapping/nonfinite times are named refusals rather than silently claiming rest",()=>{
 for(const bad of [{value:"?",start:0,end:1},{value:"A",start:-1,end:1},{value:"A",start:2,end:1},{value:"A",start:0,end:NaN}])expect(()=>convertRhubarb({mouthCues:[bad]})).toThrow("invalid-rhubarb-cue");
 expect(()=>convertRhubarb({mouthCues:[{value:"A",start:0,end:2},{value:"B",start:1,end:3}]})).toThrow("overlapping-rhubarb-cues");
});
