import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Bone, Group, Object3D, PropertyBinding } from "three";
import { describe, expect, it } from "vitest";
import { findRuntimeActorAsset } from "@openclinxr/asset-registry/runtime-bundle-lookups";
import { createEdChestPainLocalLearnerRuntimeAssetBundle } from "@openclinxr/asset-registry/runtime-bundles";
import { edChestPainScenario } from "@openclinxr/scenario-fixtures/ed-chest-pain";
import { applySupinePoseHoldingIncline } from "@openclinxr/xr-pose";

type Node = { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; extras?: Record<string, unknown> };
type Accessor = { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string };
type Channel = { target: { node: number; path: string }; sampler: number };
type Gltf = { nodes: Node[]; skins: {joints:number[]}[]; scenes: {nodes:number[]}[]; scene?:number; accessors:Accessor[]; bufferViews:{byteOffset?:number; byteLength:number; byteStride?:number}[]; animations:{name:string;channels:Channel[];samplers:{input:number;output:number;interpolation?:string}[]}[] };
function subject() {
 const actor = edChestPainScenario.actors.find(a => a.actorId === "patient_robert_hayes_v1")!;
 const selected = actor.bodyMechanics!.touchResponses!.find(r => r.region === "abdomen_rlq")!.responseClip;
 const bundle = createEdChestPainLocalLearnerRuntimeAssetBundle({scenarioId:edChestPainScenario.scenarioId,scenario:edChestPainScenario});
 const model = findRuntimeActorAsset(bundle, actor.actorId)!.model;
 expect(model.blob.url).toBe("/generated-humanoids/mpfb-gown-ed-robert-hayes.glb");
 const bytes = readFileSync(fileURLToPath(new URL(`../../../../apps/ui-xr/public${model.blob.url}`, import.meta.url)));
 expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
 const jsonSize=bytes.readUInt32LE(12);const gltf=JSON.parse(bytes.subarray(20,20+jsonSize).toString()) as Gltf;
 const binStart=20+jsonSize+8;
 return {selected,bytes,gltf,binStart};
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
  const s=subject();const rig=buildRig(s);expect(rig.jointNodes.size).toBeGreaterThan(0);expect(applySupinePoseHoldingIncline(rig.root).bonesTouched).toHaveLength(0); // ED input-control: frozen ED input bc840005 has 414 idle channels (not generic-body 411).
 // Authority: ed-input-fingerprint.json, fullSha256 bc840005fe94f90712b77521283d1ba2c6636df523ec932c346ee37e14a3d120.
 expect(s.gltf.animations.find(a=>a.name==="ClinicalIdleConversation")!.channels).toHaveLength(414);expect(s.gltf.animations.find(a=>a.name==="ClinicalExpressionMicroTransition")!.channels).toHaveLength(1);expect(s.gltf.animations.find(a=>a.name==="ClinicalExpressionMicroTransition")!.channels[0]!.target.path).toBe("weights");expect(s.gltf.animations.map(a=>a.name)).toEqual(expect.arrayContaining(["ClinicalIdleConversation","ClinicalExpressionMicroTransition"]));
 });
 it("the materializer refuses a missing required right-arm joint without publishing output",()=>{
  const s=subject();const missing=s.gltf.nodes.find(n=>n.name==="upperarm01.R")!;expect(missing).toBeDefined();missing.name="removed_required_right_arm";
  const json=Buffer.from(JSON.stringify(s.gltf));const padded=Buffer.alloc(Math.ceil(json.length/4)*4,0x20);json.copy(padded);const jsonHeader=Buffer.alloc(8);jsonHeader.writeUInt32LE(padded.length,0);jsonHeader.writeUInt32LE(0x4e4f534a,4);const tail=s.bytes.subarray(20+s.bytes.readUInt32LE(12));const header=Buffer.from(s.bytes.subarray(0,12));header.writeUInt32LE(12+8+padded.length+tail.length,8);
  const directory=mkdtempSync(join(tmpdir(),"rlq-required-joint-"));const input=join(directory,"input.glb"),output=join(directory,"output.glb");
  try {writeFileSync(input,Buffer.concat([header,jsonHeader,padded,tail]));const result=spawnSync("pnpm",["exec","tsx",fileURLToPath(new URL("../materialize-guard-withdraw-clip.ts",import.meta.url)),"--glb",input,"--out",output,"--backup",join(directory,"backup.glb"),"--report",join(directory,"report.json")],{cwd:fileURLToPath(new URL("../../../../",import.meta.url)),encoding:"utf8",timeout:60000});expect(result.error).toBeUndefined();expect(result.status).not.toBe(0);expect(result.stderr).toMatch(/upperarm01[.]?R|upper_armR/);expect(existsSync(output)).toBe(false);}finally{rmSync(directory,{recursive:true,force:true});}
 },70000);
 it("missing required joint producer publishes no output",()=>{
  const s=subject();const missing=s.gltf.nodes.find(n=>n.name==="lowerarm01.R")!;expect(missing).toBeDefined();missing.name="removed_required_forearm";
  const json=Buffer.from(JSON.stringify(s.gltf));const padded=Buffer.alloc(Math.ceil(json.length/4)*4,0x20);json.copy(padded);const jsonHeader=Buffer.alloc(8);jsonHeader.writeUInt32LE(padded.length,0);jsonHeader.writeUInt32LE(0x4e4f534a,4);const tail=s.bytes.subarray(20+s.bytes.readUInt32LE(12));const header=Buffer.from(s.bytes.subarray(0,12));header.writeUInt32LE(12+8+padded.length+tail.length,8);
  const directory=mkdtempSync(join(tmpdir(),"rlq-required-forearm-"));const input=join(directory,"input.glb"),output=join(directory,"output.glb");
  try {writeFileSync(input,Buffer.concat([header,jsonHeader,padded,tail]));const result=produceGuardWithdrawClip(input,output,directory);expect(result.error).toBeUndefined();expect(result.status).not.toBe(0);expect(`${result.stderr}${result.stdout}`).toMatch(/lowerarm01[.]?R|forearmR/);expect(existsSync(output)).toBe(false);}finally{rmSync(directory,{recursive:true,force:true});}
 },70000);
 it("preserves every pre-existing node TRS byte-exact against the plant GLB",()=>{
  // ED input-control: portable baseline derived from frozen ED input bc840005
  // via generate-ed-input-trs-baseline.mjs (not generic-body plant 2e9a9615).
  // Authority: ed-input-trs-baseline.json in this directory.
  type Baseline = { authenticInputSha256: string; authenticInputLength: number; nodeCount: number; canonicalNodeTrsSha256: string; nodes: Node[] };
  const plant = JSON.parse(readFileSync(fileURLToPath(new URL("./ed-input-trs-baseline.json", import.meta.url)), "utf8")) as Baseline;
  expect(plant.authenticInputSha256).toBe("bc840005fe94f90712b77521283d1ba2c6636df523ec932c346ee37e14a3d120");
  expect(plant.authenticInputLength).toBe(8096468);
  expect(plant.nodes).toHaveLength(plant.nodeCount);
  expect(createHash("sha256").update(JSON.stringify(plant.nodes)).digest("hex")).toBe(plant.canonicalNodeTrsSha256);
  expect(plant.canonicalNodeTrsSha256).toBe("acce2615f0a7d8aad769ab3c49a63df4169cbfd1190f6269427a2aafe8246b0e");
  const output=subject();
  expect(output.gltf.nodes).toHaveLength(plant.nodes.length);
  for(let i=0;i<plant.nodes.length;i+=1){
    const before=plant.nodes[i]!;
    const after=output.gltf.nodes[i]!;
    expect(after.name).toBe(before.name);
    expect(after.translation).toEqual(before.translation);
    expect(after.rotation).toEqual(before.rotation);
    expect(after.scale).toEqual(before.scale);
    const {openClinXrGuardWithdrawClip: _afterTag,...restExtras}=(after.extras??{}) as {openClinXrGuardWithdrawClip?:unknown};
    const {openClinXrGuardWithdrawClip: _beforeTag,...restBefore}=(before.extras??{}) as {openClinXrGuardWithdrawClip?:unknown};
    expect(restExtras).toEqual(restBefore);
    const afterTag=(after.extras??{} as {openClinXrGuardWithdrawClip?:unknown}).openClinXrGuardWithdrawClip;
    if(afterTag!==undefined){
      expect(afterTag).toBe("openclinxr_role_patient_guard_withdraw_rlq");
    }
  }
 });
});
