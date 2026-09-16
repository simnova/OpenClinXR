import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AnimationClip, AnimationMixer, Bone, Group, LoopOnce, Object3D, PropertyBinding, QuaternionKeyframeTrack } from "three";
import { describe, expect, it } from "vitest";
import { findRuntimeActorAsset } from "../../../../packages/openclinxr/asset-registry/src/runtime-bundle-lookups.js";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "../../../../packages/openclinxr/asset-registry/src/runtime-bundles.js";
import { edChestPainScenario } from "../../../../packages/openclinxr/scenario-fixtures/src/ed-chest-pain.js";
import { applySupinePoseHoldingIncline } from "../../../../packages/openclinxr/xr-pose/src/supine-deck-plant.js";

type Node = { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; extras?: Record<string, unknown> };
type Accessor = { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string };
type Channel = { target: { node: number; path: string }; sampler: number };
type Gltf = { nodes: Node[]; skins: {joints:number[]}[]; scenes: {nodes:number[]}[]; scene?:number; accessors:Accessor[]; bufferViews:{byteOffset?:number; byteLength:number; byteStride?:number}[]; animations:{name:string;channels:Channel[];samplers:{input:number;output:number;interpolation?:string}[]}[] };
function subject() {
 const actor = edChestPainScenario.actors.find(a => a.actorId === "patient_robert_hayes_v1")!;
 const selected = actor.bodyMechanics!.touchResponses!.find(r => r.region === "abdomen_rlq")!.responseClip;
 const bundle = createEdChestPainLocalLearnerRuntimeAssetBundle({scenarioId:edChestPainScenario.scenarioId,scenario:edChestPainScenario});
 const model = findRuntimeActorAsset(bundle, actor.actorId)!.model;
 expect(model.blob.url).toBe("/generated-humanoids/mpfb-gown-adult-patient.glb");
 const bytes = readFileSync(fileURLToPath(new URL(`../../../../apps/ui-xr/public${model.blob.url}`, import.meta.url)));
 expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
 const jsonSize=bytes.readUInt32LE(12);const gltf=JSON.parse(bytes.subarray(20,20+jsonSize).toString()) as Gltf;
 const binStart=20+jsonSize+8;
 return {selected,bytes,gltf,binStart};
}
function floats(s:ReturnType<typeof subject>, index:number, width:number) {
 const a=s.gltf.accessors[index]!;expect(a.componentType).toBe(5126);expect(a.type).toBe(width===4?"VEC4":"SCALAR");
 const v=s.gltf.bufferViews[a.bufferView]!;const offset=s.binStart+(v.byteOffset??0)+(a.byteOffset??0);const stride=v.byteStride??width*4;
 return Array.from({length:a.count*width},(_,i)=>s.bytes.readFloatLE(offset+Math.floor(i/width)*stride+(i%width)*4));
}
function buildRig(s:ReturnType<typeof subject>){
  const root=new Group();const jointNodes=new Set(s.gltf.skins.flatMap(skin=>skin.joints));const objects=s.gltf.nodes.map((n,i)=>{const o=jointNodes.has(i)?new Bone():new Object3D();o.name=PropertyBinding.sanitizeNodeName(n.name??"");if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation).normalize();if(n.scale)o.scale.fromArray(n.scale);return o;});
  s.gltf.nodes.forEach((n,i)=>{n.children?.forEach(j=>{objects[i]!.add(objects[j]!);});});
  s.gltf.scenes[s.gltf.scene??0]!.nodes.forEach(i=>{root.add(objects[i]!);});
 return {root,objects,jointNodes};
}
// The ordinary form must first fail on the missing authored clip; expected-failure form is the committed plant.
// ## FIXED (tsk_b823209b08ca56b0) — both planted it.fails converted to it; producer refuses missing required joints and the bound GLB carries the selected RLQ clip.
const MATERIALIZER = fileURLToPath(new URL("../materialize-guard-withdraw-clip.ts", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
function produceGuardWithdrawClip(input: string, output: string, directory: string) {
  return spawnSync("pnpm", ["exec", "tsx", MATERIALIZER, "--glb", input, "--out", output, "--backup", join(directory, "backup.glb"), "--report", join(directory, "report.json")], { cwd: REPO_ROOT, encoding: "utf8", timeout: 60000 });
}
describe("the shipped ED patient has a playable RLQ response",()=>{
 it("pins the promoted patient and retains its existing animations",()=>{
  const s=subject();const rig=buildRig(s);expect(rig.jointNodes.size).toBeGreaterThan(0);expect(applySupinePoseHoldingIncline(rig.root).bonesTouched).toHaveLength(0);expect(s.gltf.animations.find(a=>a.name==="ClinicalIdleConversation")!.channels).toHaveLength(411);expect(s.gltf.animations.find(a=>a.name==="ClinicalExpressionMicroTransition")!.channels).toHaveLength(1);expect(s.gltf.animations.find(a=>a.name==="ClinicalExpressionMicroTransition")!.channels[0]!.target.path).toBe("weights");expect(s.gltf.animations.map(a=>a.name)).toEqual(expect.arrayContaining(["ClinicalIdleConversation","ClinicalExpressionMicroTransition"]));
 });
 it("the materializer refuses a missing required right-arm joint without publishing output",()=>{
  const s=subject();const missing=s.gltf.nodes.find(n=>n.name==="upperarm01.R")!;expect(missing).toBeDefined();missing.name="removed_required_right_arm";
  const json=Buffer.from(JSON.stringify(s.gltf));const padded=Buffer.alloc(Math.ceil(json.length/4)*4,0x20);json.copy(padded);const jsonHeader=Buffer.alloc(8);jsonHeader.writeUInt32LE(padded.length,0);jsonHeader.writeUInt32LE(0x4e4f534a,4);const tail=s.bytes.subarray(20+s.bytes.readUInt32LE(12));const header=Buffer.from(s.bytes.subarray(0,12));header.writeUInt32LE(12+8+padded.length+tail.length,8);
  const directory=mkdtempSync(join(tmpdir(),"rlq-required-joint-"));const input=join(directory,"input.glb"),output=join(directory,"output.glb");
  try {writeFileSync(input,Buffer.concat([header,jsonHeader,padded,tail]));const result=spawnSync("pnpm",["exec","tsx",fileURLToPath(new URL("../materialize-guard-withdraw-clip.ts",import.meta.url)),"--glb",input,"--out",output,"--backup",join(directory,"backup.glb"),"--report",join(directory,"report.json")],{cwd:fileURLToPath(new URL("../../../../",import.meta.url)),encoding:"utf8",timeout:60000});expect(result.error).toBeUndefined();expect(result.status).not.toBe(0);expect(result.stderr).toMatch(/upperarm01[.]?R|upper_armR/);expect(existsSync(output)).toBe(false);}finally{rmSync(directory,{recursive:true,force:true});}
 },70000);
 it("the selected response moves the MPFB right arm then settles without moving supine support",()=>{
  const s=subject();const candidates=s.gltf.animations.filter(a=>a.name===s.selected);expect(candidates,`authored ${s.selected} absent from bound patient`).toHaveLength(1);
  const clip=candidates[0]!;const names=clip.channels.map(c=>s.gltf.nodes[c.target.node]!.name!);
  expect(names).toEqual(expect.arrayContaining(["upperarm01.R","lowerarm01.R","spine03","spine01","head"]));
  expect(new Set(names).size).toBe(names.length);
  for(const c of clip.channels) {expect(c.target.path).toBe("rotation");expect(s.gltf.nodes[c.target.node]!.name).not.toMatch(/root|pelvis|leg|foot|toe/i);}
  const {root,objects}=buildRig(s);
  root.userData.openClinXrActorPosture="supine";expect(objects.filter(o=>o instanceof Bone).length).toBeGreaterThan(0);const pose=applySupinePoseHoldingIncline(root);expect(pose.bonesTouched).toHaveLength(0);root.updateMatrixWorld(true);
  const baseRoot=root.matrixWorld.clone();const legs=objects.filter(o=>/upperleg|lowerleg|foot|toe/i.test(o.name));const baseLegs=legs.map(o=>o.quaternion.clone());
  const tracks=clip.channels.map(c=>{const sampler=clip.samplers[c.sampler]!;const times=floats(s,sampler.input,1);const values=floats(s,sampler.output,4);expect(times).toEqual([0,expect.closeTo(0.28,5),expect.closeTo(0.85,5)]);for(let i=0;i<values.length;i+=4){expect(Math.hypot(...values.slice(i,i+4))).toBeCloseTo(1,5);}return new QuaternionKeyframeTrack(`${objects[c.target.node]!.name}.quaternion`,times,values);});
  const arm=objects[names.includes("upperarm01.R")?clip.channels[names.indexOf("upperarm01.R")]!.target.node:-1]!;const baseline=arm.quaternion.clone();
  const mixer=new AnimationMixer(root);const action=mixer.clipAction(new AnimationClip(s.selected,-1,tracks));action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.update(0.28);applySupinePoseHoldingIncline(root);
  expect(arm.quaternion.angleTo(baseline)).toBeGreaterThan(0.05);
  root.updateMatrixWorld(true);expect(root.matrixWorld.elements).toEqual(baseRoot.elements);legs.forEach((o,i)=>{expect(o.quaternion.angleTo(baseLegs[i]!)).toBeLessThan(1e-6);});
  mixer.update(1);applySupinePoseHoldingIncline(root);expect(arm.quaternion.angleTo(baseline)).toBeLessThan(0.01);
 });
 it("missing required joint producer publishes no output",()=>{
  const s=subject();const missing=s.gltf.nodes.find(n=>n.name==="lowerarm01.R")!;expect(missing).toBeDefined();missing.name="removed_required_forearm";
  const json=Buffer.from(JSON.stringify(s.gltf));const padded=Buffer.alloc(Math.ceil(json.length/4)*4,0x20);json.copy(padded);const jsonHeader=Buffer.alloc(8);jsonHeader.writeUInt32LE(padded.length,0);jsonHeader.writeUInt32LE(0x4e4f534a,4);const tail=s.bytes.subarray(20+s.bytes.readUInt32LE(12));const header=Buffer.from(s.bytes.subarray(0,12));header.writeUInt32LE(12+8+padded.length+tail.length,8);
  const directory=mkdtempSync(join(tmpdir(),"rlq-required-forearm-"));const input=join(directory,"input.glb"),output=join(directory,"output.glb");
  try {writeFileSync(input,Buffer.concat([header,jsonHeader,padded,tail]));const result=produceGuardWithdrawClip(input,output,directory);expect(result.error).toBeUndefined();expect(result.status).not.toBe(0);expect(`${result.stderr}${result.stdout}`).toMatch(/lowerarm01[.]?R|forearmR/);expect(existsSync(output)).toBe(false);}finally{rmSync(directory,{recursive:true,force:true});}
 },70000);
 it("preserves every pre-existing node TRS byte-exact against the plant GLB",()=>{
  const plantPath="apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb";
  const shown=spawnSync("git",["show","71954173549f55cea2b3cfa4c206b365c838678e:"+plantPath],{cwd:REPO_ROOT,maxBuffer:30_000_000,encoding:"buffer"});
  expect(shown.status).toBe(0);
  const plantBytes=Buffer.from(shown.stdout);
  expect(createHash("sha256").update(plantBytes).digest("hex")).toBe("2e9a9615fa2034675eab9b2634139a74b3918c9698e97b6a1cb65bd8076ed588");
  expect(plantBytes.length).toBe(18576544);
  const plantJsonSize=plantBytes.readUInt32LE(12);
  const plant=JSON.parse(plantBytes.subarray(20,20+plantJsonSize).toString()) as Gltf;
  const output=subject();
  expect(output.gltf.nodes).toHaveLength(plant.nodes.length);
  for(let i=0;i<plant.nodes.length;i+=1){
    const before=plant.nodes[i]!;
    const after=output.gltf.nodes[i]!;
    expect(after.name).toBe(before.name);
    expect(after.translation).toEqual(before.translation);
    expect(after.rotation).toEqual(before.rotation);
    expect(after.scale).toEqual(before.scale);
    const {openClinXrGuardWithdrawClip,...restExtras}=(after.extras??{}) as {openClinXrGuardWithdrawClip?:unknown};
    expect(restExtras).toEqual(before.extras??{});
    if(openClinXrGuardWithdrawClip!==undefined){
      expect(openClinXrGuardWithdrawClip).toBe("openclinxr_role_patient_guard_withdraw_rlq");
    }
  }
 });
});

// APPEND-ONLY successor draft. Existing five clause bodies and preceding bytes are immutable.
async function supportFrameFixture(transformedParent=false) {
 const {Vector3}=await import("three");
 const {applyAndPlantSupineOnDeck,holdSupinePlantFrame,reapplySupineHeadToStoredPillow}=await import("../../../../packages/openclinxr/xr-pose/src/index.js");
 const {alignSupineHeadToPillow}=await import("../../../../packages/openclinxr/xr-pose/src/supine-deck-plant.js");
 const {buildPatientStretcher,setStretcherInclineDegrees,STRETCHER_DECK_TOP_METERS}=await import("../../../../packages/openclinxr/xr-station/src/index.js");
 const s=subject(),rig=buildRig(s),parent=new Group();
 if(transformedParent){parent.position.set(2,.4,-3);parent.rotation.set(.15,.6,-.1);parent.scale.set(1.3,.8,1.1);}
 parent.add(rig.root);parent.updateMatrixWorld(true);
 const stretcher=buildPatientStretcher({slotId:"stretcher",position:{x:0,y:0,z:0},trimColor:0x445566,inclineDegrees:0});
 const plant=(inclineDegrees=0,supportedStretcher=false)=>{if(supportedStretcher){setStretcherInclineDegrees(stretcher,inclineDegrees);parent.add(stretcher);parent.updateMatrixWorld(true);}return applyAndPlantSupineOnDeck(rig.root,{deckTopWorldY:supportedStretcher?STRETCHER_DECK_TOP_METERS:0,deckCenter:{x:0,z:0},...(supportedStretcher?{stretcher}:{inclineDegrees}),applyJointEulers:false});};
 plant();rig.root.updateMatrixWorld(true);
 const head=rig.objects.find(o=>o.name==="head")!;expect(head).toBeDefined();
 const reference=rig.root.worldToLocal(head.getWorldPosition(new Vector3()));
 const restingTarget=rig.root.localToWorld(reference.clone());rig.root.userData.openClinXrSupinePillowWorld={x:restingTarget.x,z:restingTarget.z};
 const base=()=>({x:rig.root.position.x,y:rig.root.position.y,z:rig.root.position.z,scaleX:rig.root.scale.x,scaleY:rig.root.scale.y,scaleZ:rig.root.scale.z});
 const selected=s.gltf.animations.find(a=>a.name===s.selected)!;expect(selected).toBeDefined();
 const tracks=selected.channels.map(c=>{const sampler=selected.samplers[c.sampler]!;return new QuaternionKeyframeTrack(`${rig.objects[c.target.node]!.name}.quaternion`,floats(s,sampler.input,1),floats(s,sampler.output,4));});
 const mixer=new AnimationMixer(rig.root),clip=new AnimationClip(s.selected,-1,tracks),action=mixer.clipAction(clip);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();
 const support=rig.objects.filter(o=>/^(pelvis|foot|toe)/i.test(o.name));expect(support.length).toBeGreaterThan(3);
 const arm=rig.objects.find(o=>o.name==="upperarm01R")!;expect(arm).toBeDefined();
 const frame=(time:number,captured=base(),breathing=0)=>{mixer.setTime(time);applySupinePoseHoldingIncline(rig.root);holdSupinePlantFrame(rig.root,captured,breathing);reapplySupineHeadToStoredPillow(rig.root);rig.root.updateMatrixWorld(true);};
 const world=()=>support.map(o=>o.matrixWorld.elements.slice()),local=()=>support.map(o=>({q:o.quaternion.toArray(),t:o.position.toArray()}));
 const assertWorld=(before:number[][])=>world().forEach((after,i)=>expect(Math.max(...after.map((v,j)=>Math.abs(v-before[i]![j]!)))).toBeLessThan(1e-12));
 const assertAnchor=(anchor:import("three").Vector3,target:import("three").Vector3)=>{const actual=rig.root.localToWorld(anchor.clone());expect(actual.x).toBeCloseTo(target.x,12);expect(actual.z).toBeCloseTo(target.z,12);};
 return{...rig,parent,plant,head,reference,restingTarget,base,mixer,clip,arm,frame,world,local,assertWorld,assertAnchor,Vector3,alignSupineHeadToPillow,reapplySupineHeadToStoredPillow};
}
describe("the shipped supine response retains its staged world support frame",()=>{
 it("full plant stages the resting reference before playback; peak and settle retain world support while the arm moves",async()=>{
  const f=await supportFrameFixture(),base=f.base();f.frame(0,base);const before=f.world(),local=f.local(),arm=f.arm.quaternion.clone();
  for(let i=0;i<3;i++){f.frame(0,base);f.assertWorld(before);expect(f.local()).toEqual(local);}
  f.frame(.28,base);expect(f.arm.quaternion.angleTo(arm)).toBeGreaterThan(.05);f.assertWorld(before);expect(f.local()).toEqual(local);
  f.frame(f.clip.duration,base);expect(f.arm.quaternion.angleTo(arm)).toBeLessThan(.01);f.assertWorld(before);expect(f.local()).toEqual(local);
 });
 it("resting staging alignment reaches world XZ without moving world Y under a nonidentity parent",async()=>{
  const f=await supportFrameFixture(true),before=f.head.getWorldPosition(new f.Vector3()),target={x:before.x+.1,z:before.z-.04};
  f.alignSupineHeadToPillow(f.root,target);const after=f.head.getWorldPosition(new f.Vector3());expect(after.x).toBeCloseTo(target.x,12);expect(after.z).toBeCloseTo(target.z,12);expect(after.y).toBeCloseTo(before.y,12);
 });
 it("a changed pillow aligns the staged rest reference rather than the animated head under a transformed parent",async()=>{
  const f=await supportFrameFixture(true),base=f.base();f.frame(0,base);const arm=f.arm.quaternion.clone();
  const target=f.restingTarget.clone().add(new f.Vector3(.06,0,.02));f.root.userData.openClinXrSupinePillowWorld={x:target.x,z:target.z};f.frame(.28,base);
  expect(f.arm.quaternion.angleTo(arm)).toBeGreaterThan(.05);f.assertAnchor(f.reference,target);
 });
 it("full replant with a changed resting head and incline replaces the staged reference before subsequent motion",async()=>{
  const f=await supportFrameFixture();f.mixer.stopAllAction();f.head.position.x+=.02;f.plant(15,true);
  expect(f.root.userData.openClinXrPlantSteps.map((step:{step:string})=>step.step)).toEqual(expect.arrayContaining(["head_flex","final"]));
  expect(f.root.userData.openClinXrSupineHeadFlexJoints.length).toBeGreaterThan(1);
  expect(f.root.userData.openClinXrSupineHeadFlexRad).toBeGreaterThan(0);f.root.updateMatrixWorld(true);
  const newReference=f.root.worldToLocal(f.head.getWorldPosition(new f.Vector3()));expect(newReference.distanceTo(f.reference)).toBeGreaterThan(.01);
  const target=f.root.localToWorld(newReference.clone()).add(new f.Vector3(.06,0,.02));f.root.userData.openClinXrSupinePillowWorld={x:target.x,z:target.z};const base=f.base();f.mixer.clipAction(f.clip).reset().play();f.frame(.28,base);f.assertAnchor(newReference,target);
 });
 it("keeps missing and nonfinite pillow inputs as baseline no-ops",async()=>{
  const f=await supportFrameFixture();const before={position:f.root.position.toArray(),quaternion:f.root.quaternion.toArray(),scale:f.root.scale.toArray()};
  delete f.root.userData.openClinXrSupinePillowWorld;f.reapplySupineHeadToStoredPillow(f.root);expect(f.root.position.toArray()).toEqual(before.position);expect(f.root.quaternion.toArray()).toEqual(before.quaternion);expect(f.root.scale.toArray()).toEqual(before.scale);
  f.root.userData.openClinXrSupinePillowWorld={x:NaN,z:0};f.reapplySupineHeadToStoredPillow(f.root);expect(f.root.position.toArray()).toEqual(before.position);expect(f.root.quaternion.toArray()).toEqual(before.quaternion);expect(f.root.scale.toArray()).toEqual(before.scale);
 });
 it("missing or nonfinite pillow and absent or malformed rest cache cannot move the root",async()=>{
  const f=await supportFrameFixture();const cache=f.root.userData.openClinXrSupineRestHeadRoot;expect(cache).toBeDefined();const snapshot=()=>({position:f.root.position.toArray(),quaternion:f.root.quaternion.toArray(),scale:f.root.scale.toArray()});
  const pillow=f.root.userData.openClinXrSupinePillowWorld;delete f.root.userData.openClinXrSupinePillowWorld;let before=snapshot();f.reapplySupineHeadToStoredPillow(f.root);expect(snapshot()).toEqual(before);
  f.root.userData.openClinXrSupinePillowWorld={x:NaN,z:0};before=snapshot();f.reapplySupineHeadToStoredPillow(f.root);expect(snapshot()).toEqual(before);
  // Private cache field name/shape is fixed by this owner design; no public export is added.
  f.root.userData.openClinXrSupinePillowWorld=pillow;delete f.root.userData.openClinXrSupineRestHeadRoot;f.mixer.setTime(.28);before=snapshot();f.reapplySupineHeadToStoredPillow(f.root);expect(snapshot()).toEqual(before);
  f.root.userData.openClinXrSupineRestHeadRoot={x:NaN,y:0,z:0};before=snapshot();f.reapplySupineHeadToStoredPillow(f.root);expect(snapshot()).toEqual(before);
  f.root.userData.openClinXrSupineRestHeadRoot=cache;f.root.userData.openClinXrSupineInclineDegrees=45;before=snapshot();f.reapplySupineHeadToStoredPillow(f.root);expect(snapshot()).toEqual(before);
 });
 it("preserves nonzero intentional breathing instead of freezing the entire supine body",async()=>{
  const f=await supportFrameFixture(),base=f.base();f.frame(0,base,.7);
  expect(f.root.position.y).toBeCloseTo(base.y+.7*.006,12);expect(f.root.scale.y).toBeCloseTo(base.scaleY+.7*.006,12);
  expect(f.root.position.y).not.toBe(base.y);expect(f.root.scale.y).not.toBe(base.scaleY);
 });
 it("rejects stale planted-root quaternion identity independently of unchanged incline",async()=>{
  const f=await supportFrameFixture();expect(f.root.userData.openClinXrSupineRestHeadRoot).toBeDefined();
  const incline=f.root.userData.openClinXrSupineInclineDegrees;f.root.userData.openClinXrSupineRootQuat={x:0,y:.1,z:0,w:Math.sqrt(.99)};
  f.mixer.setTime(.28);const before=f.root.position.toArray();f.reapplySupineHeadToStoredPillow(f.root);
  expect(f.root.userData.openClinXrSupineInclineDegrees).toBe(incline);expect(f.root.position.toArray()).toEqual(before);
 });

});
