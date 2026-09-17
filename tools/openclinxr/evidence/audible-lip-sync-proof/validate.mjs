import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import {tmpdir} from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import fixture from "./fixture-manifest.mjs";
import {inspectPlayedSamples} from "./waveform-identity.mjs";
import {inspectAuthoredAlpha} from "./material-integrity.mjs";
import {inspectNativeCaptureBindings} from "./capture-bindings.mjs";
import {inspectExecutedModules} from "./executed-module-integrity.mjs";
export function inspectMetadata(r) {
 const errors=[];const need=(ok,message)=>{if(!ok)errors.push(message);};
 need(r?.schemaVersion===1,"schema");need(r?.claimScope==="local-prerecorded-coarse-mouth-clock-proof","claim-scope");
 need(r?.notTested?.includes("physical-speaker-output-and-perceptual-phonetic-sync"),"physical-output-scope");
 need(/^[a-f0-9]{40}$/.test(r?.captureHead??""),"capture-head");
 need(typeof r?.runId==="string"&&r.runId.length>8,"run-id");
 need(Array.isArray(r?.attempts)&&r.attempts.length>0,"immutable-attempt-ledger");
 need(Array.isArray(r?.segments)&&r.segments.length>0,"source-segments");
 need(Array.isArray(r?.frames)&&r.frames.length>=3,"observed-frames");
 const segments=Array.isArray(r?.segments)?r.segments:[],frames=Array.isArray(r?.frames)?r.frames:[];let last=-Infinity;
 need(new Set(segments.map(s=>s.generation+":"+s.nodeSerial)).size===segments.length,"ambiguous-source-segments");
 for(const s of segments){need(Number.isFinite(s.when)&&Number.isFinite(s.offset)&&s.offset>=0&&Number.isFinite(s.rate)&&s.rate>0,"invalid-source-segment");need(typeof s.generation==="string"&&Number.isInteger(s.nodeSerial),"segment-identity");}
 for(const f of frames){need(f.state==="playing","non-playing-proof-frame");need(Number.isFinite(f.contextTime)&&f.contextTime>=last,"frame-context-order");last=f.contextTime;need(f.observationKind==="raf-callback","invented-observation");
  const s=segments.find(s=>s.generation===f.generation&&s.nodeSerial===f.nodeSerial);need(!!s,"stale-or-unbound-frame");
  if(s&&f.state==="playing"){const expected=Math.min(r.decodedSampleCount/r.decodedSampleRate,s.offset+Math.max(0,f.contextTime-s.when)*s.rate);need(Math.abs(expected-f.sourcePositionSeconds)<1e-6,"source-clock-mismatch");}
  need(Number.isFinite(f.sourcePositionSeconds)&&f.sourcePositionSeconds>=0,"invalid-source-position");need(Math.abs(f.driveNowMs-f.sourcePositionSeconds*1000)<1e-6,"rig-clock-mismatch");
  need(Number.isInteger(f.frameIndex)&&f.frameIndex>=0&&f.appliedMeshCount>=1,"rig-not-applied");
 }
 need(frames.some(f=>f.activeTargetName==="viseme_PP"),"closed-bilabial-not-observed");need(frames.some(f=>f.activeTargetName==="viseme_aa"),"open-vowel-not-observed");
 need(r?.decodedSampleRate>0&&Number.isInteger(r?.decodedSampleCount)&&r.decodedSampleCount>0,"decoded-domain");
 need(r?.contextStateAtStart==="running"&&r.userActivated===true,"unactivated-or-suspended-start");
 need(r?.fixtureRights==="installed-rhubarb-demo-local-diagnostic-only","fixture-rights");
 need(r?.cueInterpretation==="approximate-rhubarb-nine-shape-not-phone-precision","cue-scope");
 need(r?.framing&&Array.isArray(r.framing.cameraMatrixWorld)&&r.framing.cameraMatrixWorld.length===16&&r.framing.viewport?.length===2,"framing-missing");
 need(Array.isArray(r?.sourceBindings)&&r.sourceBindings.length>=3&&r.sourceBindings.every(b=>typeof b.path==="string"&&/^[a-f0-9]{64}$/.test(b.sha256??"")),"source-bindings-missing");
 need(r?.files?.inputWav&&r?.files?.cues&&r?.files?.video&&r?.files?.playedPcm,"artifact-bindings");return errors;
}
function digest(path){return createHash("sha256").update(readFileSync(path)).digest("hex");}
export function validateReport(r,root){
 const errors=[...inspectMetadata(r),...inspectNativeCaptureBindings(r)];const need=(ok,message)=>{if(!ok)errors.push(message);};

 errors.push(...inspectArtifacts(r,root));
 const wav=r.files?.inputWav,cues=r.files?.cues;need(wav?.sha256===fixture.sha256,"waveform-identity-mismatch");need(cues?.sha256===fixture.cueSha256,"cue-identity-mismatch");
 const repoRoot=fileURLToPath(new URL("../../../../",import.meta.url));
 // Rebuild the consumed package before comparing executed dist; a tracked source hash
 // cannot attest stale compiler output. This writes only the explicitly selected proof tree.
 if(Array.isArray(r.executedModules)&&r.executedModules.length){
  try{execFileSync("pnpm",["--filter","@openclinxr/xr-dialogue","build","--force"],{cwd:repoRoot,stdio:"pipe"});}catch{errors.push("consumed-dialogue-build-refused");}
 }
 let reproduced={};
 if(Array.isArray(r.executedModules)&&r.executedModules.length){
  const directory=mkdtempSync(resolve(tmpdir(),"lip-sync-current-vite-validation-"));
  const input=resolve(directory,"input.json");writeFileSync(input,JSON.stringify({repoRoot,rows:r.executedModules,metadata:r.buildMetadata}));
  try{const output=execFileSync("node",[fileURLToPath(new URL("./reproduce-vite-modules.mjs",import.meta.url)),input],{encoding:"utf8",maxBuffer:30*1024*1024,timeout:120000});writeFileSync(resolve(directory,"expected-current-modules.json"),output);reproduced=JSON.parse(output);}catch(e){writeFileSync(resolve(directory,"refusal.txt"),e.message);errors.push("current-vite-reproduction-refused");}
 }
 need(r.buildMetadata?.gitCommit===r.captureHead,"capture-build-commit-mismatch");
 errors.push(...inspectExecutedModules(r.executedModules,root,repoRoot,[
  "apps/ui-xr/src/main.ts","apps/ui-xr/src/prepared-actor-audio.ts",
  "packages/openclinxr/xr-dialogue/dist/viseme-runtime-wire.js",
  "packages/openclinxr/xr-dialogue/dist/viseme-baked-cues.js"],reproduced));
 const roles=r.sourceBindings??[];
 for(const [role,path] of Object.entries(fixture.requiredSourceRoles)) {
  const entries=roles.filter(b=>b.role===role);need(entries.length===1,"required-source-role:"+role);
  if(entries.length!==1)continue;
  const binding=entries[0],expectedPath=resolve(repoRoot,path);
  need(resolve(repoRoot,binding.path)===expectedPath,"wrong-source-path:"+role);
  need(existsSync(expectedPath),"source-binding-missing:"+role);
  if(existsSync(expectedPath))need(digest(expectedPath)===binding.sha256,"source-binding-changed:"+role);
  if(fixture.frozenSourceHashes[role])need(binding.sha256===fixture.frozenSourceHashes[role],"frozen-source-changed:"+role);
 }
 const assetPath=resolve(repoRoot,fixture.requiredSourceRoles.asset);
 if(existsSync(assetPath)) {const bytes=readFileSync(assetPath);const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());errors.push(...inspectAuthoredAlpha(gltf,r.authoredMaterialRows));}
 const tap=r.files?.playedPcm&&resolve(root,r.files.playedPcm.path);
 const input=wav&&resolve(root,wav.path);
 if(input&&tap&&existsSync(input)&&existsSync(tap)) {
  errors.push(...inspectPlayedSamples(readFileSync(input),readFileSync(tap),r.playedTap??{}));
  need(r.playedTap?.sourceGeneration===r.segments?.[0]?.generation,"tap-source-generation-mismatch");
  need(r.decodedSampleRate===fixture.sampleRate&&r.decodedSampleCount===fixture.sampleCount,"native-capture-domain-required");
 }
 if(cues&&existsSync(resolve(root,cues.path))) {
  const doc=JSON.parse(readFileSync(resolve(root,cues.path),"utf8"));
  const targets={A:"viseme_PP",B:"viseme_DD",C:"viseme_E",D:"viseme_aa",E:"viseme_O",F:"viseme_U",G:"viseme_FF",H:"viseme_nn",X:"viseme_sil"};
  for(const frame of r.frames??[]) {
   const cue=doc.mouthCues.find(c=>frame.sourcePositionSeconds>=c.start&&frame.sourcePositionSeconds<c.end)??doc.mouthCues.at(-1);
   need(frame.activeTargetName===targets[cue?.value],"cue-at-source-position-mismatch");
  }
 }

 try{execFileSync("git",["merge-base","--is-ancestor",r.captureHead,"HEAD"],{cwd:fileURLToPath(new URL("../../../../",import.meta.url)),stdio:"pipe"});}catch{errors.push("capture-head-not-ancestor");}

 const video=r.files?.video&&resolve(root,r.files.video.path);
 if(video&&existsSync(video))errors.push(...inspectRecordedMedia(video));

 return errors;
}
export function inspectArtifacts(r,root){
 const errors=[];
 for(const [label,ref] of Object.entries(r.files??{})){
  if(typeof ref?.path!=="string"||!/^[a-f0-9]{64}$/.test(ref?.sha256??"")){errors.push("invalid-artifact-binding:"+label);continue;}
  const path=resolve(root,ref.path);
  if(!existsSync(path)){errors.push("artifact-missing:"+path);continue;}
  try{if(digest(path)!==ref.sha256)errors.push("artifact-hash-mismatch:"+path);}catch{errors.push("artifact-not-file:"+path);}
 }
 for(const a of r.attempts??[]) {
  if(typeof a?.manifestPath!=="string"||!/^[a-f0-9]{64}$/.test(a?.sha256??"")){errors.push("invalid-attempt-binding");continue;}
  const path=resolve(root,a.manifestPath);
  if(!existsSync(path)){errors.push("retained-attempt-missing");continue;}
  try{if(digest(path)!==a.sha256)errors.push("retained-attempt-changed");}catch{errors.push("retained-attempt-not-file");}
 }
 return errors;
}

export function inspectRecordedMedia(video){
 const errors=[];const need=(ok,message)=>{if(!ok)errors.push(message);};

  try{const probe=JSON.parse(execFileSync("ffprobe",["-v","error","-show_streams","-show_format","-of","json",video],{encoding:"utf8"}));need(probe.streams.some(s=>s.codec_type==="audio"),"video-audio-track-missing");need(probe.streams.some(s=>s.codec_type==="video"&&s.width>0&&s.height>0),"video-image-track-missing");need(Number(probe.format.duration)>=fixture.sampleCount/fixture.sampleRate,"video-does-not-cover-input");
   const pcm=execFileSync("ffmpeg",["-v","error","-i",video,"-vn","-ac","1","-f","f32le","pipe:1"],{maxBuffer:20*1024*1024});let sum=0;for(let i=0;i+4<=pcm.length;i+=4){const x=pcm.readFloatLE(i);sum+=x*x;}need(pcm.length>0&&sum>0,"silent-recorded-output");
   const pixels=execFileSync("ffmpeg",["-v","error","-i",video,"-an","-vf","scale=64:64,fps=5","-pix_fmt","rgb24","-f","rawvideo","pipe:1"],{maxBuffer:20*1024*1024});const span=64*64*3,hashes=new Set();let nonUniform=false;for(let i=0;i+span<=pixels.length;i+=span){const f=pixels.subarray(i,i+span);hashes.add(createHash("sha256").update(f).digest("hex"));for(let j=3;j<f.length;j+=3)if(f[j]!==f[0]||f[j+1]!==f[1]||f[j+2]!==f[2]){nonUniform=true;break;}}need(nonUniform,"uniform-recorded-pixels");need(hashes.size>=2,"unchanged-recorded-pixels");
  }catch(e){errors.push("artifact-decode-refused:"+e.message);}
 return errors;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const path=resolve(process.argv[2]??new URL("report.json",import.meta.url).pathname);const r=JSON.parse(readFileSync(path,"utf8"));const errors=validateReport(r,resolve(path,".."));console.log(JSON.stringify({integrityErrors:errors,notPerceptualGrading:true}));if(errors.length)process.exitCode=1;}
