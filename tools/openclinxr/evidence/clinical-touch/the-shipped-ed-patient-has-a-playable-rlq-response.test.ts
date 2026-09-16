import { spawnSync } from "node:child_process";
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

type Node = { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] };
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
  const root=new Group();const jointNodes=new Set(s.gltf.skins.flatMap(skin=>skin.joints));const objects=s.gltf.nodes.map((n,i)=>{const o=jointNodes.has(i)?new Bone():new Object3D();o.name=PropertyBinding.sanitizeNodeName(n.name??"");if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);return o;});
  s.gltf.nodes.forEach((n,i)=>{n.children?.forEach(j=>{objects[i]!.add(objects[j]!);});});
  s.gltf.scenes[s.gltf.scene??0]!.nodes.forEach(i=>{root.add(objects[i]!);});
 return {root,objects,jointNodes};
}
// The ordinary form must first fail on the missing authored clip; expected-failure form is the committed plant.
describe("the shipped ED patient has a playable RLQ response",()=>{
 it("pins the promoted patient and retains its existing animations",()=>{
  const s=subject();const rig=buildRig(s);expect(rig.jointNodes.size).toBeGreaterThan(0);expect(applySupinePoseHoldingIncline(rig.root).bonesTouched).toHaveLength(0);expect(s.gltf.animations.find(a=>a.name==="ClinicalIdleConversation")!.channels).toHaveLength(411);expect(s.gltf.animations.find(a=>a.name==="ClinicalExpressionMicroTransition")!.channels).toHaveLength(1);expect(s.gltf.animations.find(a=>a.name==="ClinicalExpressionMicroTransition")!.channels[0]!.target.path).toBe("weights");expect(s.gltf.animations.map(a=>a.name)).toEqual(expect.arrayContaining(["ClinicalIdleConversation","ClinicalExpressionMicroTransition"]));
 });
 it.fails("the materializer refuses a missing required right-arm joint without publishing output",()=>{
  const s=subject();const missing=s.gltf.nodes.find(n=>n.name==="upperarm01.R")!;expect(missing).toBeDefined();missing.name="removed_required_right_arm";
  const json=Buffer.from(JSON.stringify(s.gltf));const padded=Buffer.alloc(Math.ceil(json.length/4)*4,0x20);json.copy(padded);const jsonHeader=Buffer.alloc(8);jsonHeader.writeUInt32LE(padded.length,0);jsonHeader.writeUInt32LE(0x4e4f534a,4);const tail=s.bytes.subarray(20+s.bytes.readUInt32LE(12));const header=Buffer.from(s.bytes.subarray(0,12));header.writeUInt32LE(12+8+padded.length+tail.length,8);
  const directory=mkdtempSync(join(tmpdir(),"rlq-required-joint-"));const input=join(directory,"input.glb"),output=join(directory,"output.glb");
  try {writeFileSync(input,Buffer.concat([header,jsonHeader,padded,tail]));const result=spawnSync("pnpm",["exec","tsx",fileURLToPath(new URL("../materialize-guard-withdraw-clip.ts",import.meta.url)),"--glb",input,"--out",output,"--backup",join(directory,"backup.glb"),"--report",join(directory,"report.json")],{cwd:fileURLToPath(new URL("../../../../",import.meta.url)),encoding:"utf8",timeout:60000});expect(result.error).toBeUndefined();expect(result.status).not.toBe(0);expect(result.stderr).toMatch(/upperarm01[.]?R|upper_armR/);expect(existsSync(output)).toBe(false);}finally{rmSync(directory,{recursive:true,force:true});}
 },70000);
 it.fails("the selected response moves the MPFB right arm then settles without moving supine support",()=>{
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
});
