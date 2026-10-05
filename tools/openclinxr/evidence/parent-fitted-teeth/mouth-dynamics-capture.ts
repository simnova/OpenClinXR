/** Capture waveform-timed mouth motion without modifying the parent GLB or its static viseme keys. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalComputeServices } from "@openclinxr/service-local-compute";
import { createActorAudioRuntime } from "@openclinxr/xr-dialogue/actor-audio-runtime";
import type { Page } from "../lib/slotted-playwright.js";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "../lib/portless-server.js";

type HeadlessBrowser = { newPage(options: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<Page> };
type TrackCue = { startS: number; endS: number; viseme: string; intensity: number };
type ToothSample = { n: number; cx: number; cy: number; target: string; lipGapPx: number; mouthTeethN: number };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const AUDIO = path.join(HERE, "visemes/i-feel-the-pain-is-better-now.aiff");
const RHUBARB = path.join(process.env.HOME ?? "", ".openclinxr-tools/rhubarb/rhubarb");
const LINE = "I feel the pain is better now.";
const MODE = process.argv.includes("--step3") ? "step3" : "step2";
const OUT_DIR = path.join(REPO, `docs/openclinxr/mouth-dynamics/${MODE}`);
const VIEW_W = 1280;
const VIEW_H = 960;
const FPS = 30;

function esbuildBin(): string {
  const root = path.join(REPO, "node_modules/.pnpm");
  const dir = readdirSync(root).find((name) => name.startsWith("esbuild@"));
  if (!dir) throw new Error("esbuild is not installed");
  return path.join(root, dir, "node_modules/esbuild/bin/esbuild");
}

function browserDriveSource(): string {
  const output = path.join(tmpdir(), `mouth-dynamics-drive-${process.pid}.js`);
  execFileSync(esbuildBin(), [
    path.join(REPO, "packages/openclinxr/xr-dialogue/src/actor-audio-runtime.ts"),
    "--bundle", "--format=iife", "--global-name=OpenClinXrVisemeDrive", "--platform=browser",
    `--alias:@openclinxr/asset-registry=${path.join(REPO, "packages/openclinxr/asset-registry/src/morph-target-resolver.ts")}`,
    `--outfile=${output}`,
  ], { stdio: "inherit" });
  const bundled = readFileSync(output, "utf8");
  rmSync(output, { force: true });
  return `${bundled}
const APERTURE = {sil:0,PP:0,FF:.15,TH:.25,DD:.25,kk:.25,CH:.25,SS:.2,nn:.2,RR:.3,aa:1,E:.45,I:.35,O:.85,U:.4};
function smooth01(value) { const x = Math.max(0, Math.min(1, value)); return x*x*(3-2*x); }
function poseAt(drive, root, cues, index) {
  const total = cues[cues.length - 1].endS || 1;
  const cue = cues[index];
  const progress = ((cue.startS + cue.endS) / 2) / total;
  drive.applyDialogueVisemeTimelineToRoot(root, {
    phonemeSequence: ["sil"], progress,
    bakedCues: cues.map(row => ({phoneme:row.viseme, atSecond:row.startS, durationSeconds:row.endS-row.startS})),
  });
  const meshes = [];
  root.traverse(object => { if (object?.morphTargetInfluences?.length) meshes.push({object, weights:object.morphTargetInfluences.slice()}); });
  return meshes;
}
function applyStep2(drive, root, cues, timeS) {
  let index = cues.length - 1;
  for (let i=0;i<cues.length;i+=1) { if (timeS < cues[i].endS) { index=i; break; } }
  const cue = cues[index]; const left = timeS-cue.startS; const right = cue.endS-timeS; const windowS=.06;
  let other=index; let currentWeight=1;
  if (index>0 && left<windowS && left<=right) { other=index-1; currentWeight=smooth01(left/windowS); }
  else if (index<cues.length-1 && right<windowS) { other=index+1; currentWeight=smooth01(right/windowS); }
  const current=poseAt(drive,root,cues,index);
  if (other!==index) {
    const neighbor=new Map(poseAt(drive,root,cues,other).map(row=>[row.object,row.weights]));
    for (const row of current) { const a=neighbor.get(row.object); const weights=row.object.morphTargetInfluences;
      for (let i=0;i<weights.length;i+=1) weights[i]=(a?.[i]||0)+((row.weights[i]||0)-(a?.[i]||0))*currentWeight; }
  }
  const neighborFraction=APERTURE[cues[other].viseme] ?? .25;
  const currentFraction=APERTURE[cue.viseme] ?? .25;
  const fraction=neighborFraction+(currentFraction-neighborFraction)*currentWeight;
  drive.applyJawOpenToRoot(root,fraction*drive.JAW_TEETH_GAIN*Math.asin(.020725011825561523/.137901));
}
let step3Track=null; let step3Sampler=null;
function blendPoses(drive,root,cues,left,right,weight) {
  const a=poseAt(drive,root,cues,left);
  if(left===right)return;
  const b=new Map(poseAt(drive,root,cues,right).map(row=>[row.object,row.weights]));
  for(const row of a){const next=b.get(row.object),weights=row.object.morphTargetInfluences;
    for(let i=0;i<weights.length;i+=1)weights[i]=(row.weights[i]||0)+((next?.[i]||0)-(row.weights[i]||0))*weight;}
}
function forcePpPose(root) { root.traverse(object=>{const dict=object?.morphTargetDictionary,weights=object?.morphTargetInfluences;if(!dict||!weights)return;
  for(const [name,index] of Object.entries(dict)){const key=name.toLowerCase();if(key.startsWith("viseme_"))weights[index]=key==="viseme_pp"?1:0;
    if(key.startsWith("mouth-"))weights[index]=key==="mouth-compression"?1:0;}}); }
function applyStep3(drive,root,cues,timeS) {
  let index=cues.length-1; for(let i=0;i<cues.length;i+=1){if(timeS<cues[i].endS){index=i;break;}}
  const cue=cues[index];
  {
    const centers=cues.map(row=>row.viseme==="PP"?row.startS:(row.startS+row.endS)/2);let left=0,right=0;
    if(timeS<=centers[0]) left=right=0;
    else if(timeS>=centers[centers.length-1]) left=right=centers.length-1;
    else for(let i=0;i<centers.length-1;i+=1){if(timeS>=centers[i]&&timeS<=centers[i+1]){left=i;right=i+1;break;}}
    const span=centers[right]-centers[left];const weight=left===right?0:smooth01((timeS-centers[left])/span);
    blendPoses(drive,root,cues,left,right,weight);
    if(cue.viseme==="PP") forcePpPose(root);
  }
  if(step3Track!==cues){step3Track=cues;step3Sampler=drive.createJawDynamicsSampler(cues);}
  const jaw=step3Sampler.sample(timeS);
  drive.applyJawOpenToRoot(root,jaw.aperture*drive.JAW_TEETH_GAIN*Math.asin(.020725011825561523/.137901));
  root.userData.openClinXrJawDynamics={...jaw};
}
(() => { const drive=OpenClinXrVisemeDrive.createActorAudioRuntime().visemeCueTrack.mouthRuntime; const native=requestAnimationFrame.bind(window); const mode=${JSON.stringify(MODE)};
  window.requestAnimationFrame=callback=>native(time=>{ try { const root=window.__openClinXrIsolatedSceneRoot;
    if (root && window.__speechTrack) (mode==="step3"?applyStep3:applyStep2)(drive,root,window.__speechTrack,window.__speechTimeS||0);
  } catch(error) { window.__openClinXrVisemeApplierError=String(error?.stack||error); } return callback(time); }); })();`;
}

function makeTrack(jobDir: string): { cues: TrackCue[]; rhubarb: unknown; wavSha256: string } {
  const wav = path.join(jobDir, "speech.wav");
  const dialog = path.join(jobDir, "dialog.txt");
  const output = path.join(jobDir, "rhubarb.json");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", AUDIO, "-ar", "22050", "-ac", "1", "-c:a", "pcm_s16le", wav]);
  writeFileSync(dialog, `${LINE}\n`);
  execFileSync(RHUBARB, ["--exportFormat", "json", "-d", dialog, "--extendedShapes", "GHX", "--output", output, wav], { stdio: "inherit" });
  const rhubarb = JSON.parse(readFileSync(output, "utf8")) as {
    metadata?: { soundFile?: string; duration?: number };
    mouthCues?: Array<{ start: number; end: number; value: string }>;
  };
  if (rhubarb.metadata?.soundFile) rhubarb.metadata.soundFile = "speech.wav";
  const bytes = readFileSync(wav);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const cues = createActorAudioRuntime().visemeCueTrack.mapRhubarbTrack(rhubarb, arrayBuffer);
  const wavSha256 = execFileSync("shasum", ["-a", "256", wav], { encoding: "utf8" }).split(/\s/u)[0] ?? "";
  return { cues, rhubarb, wavSha256 };
}

function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return 0;
  const at = (sorted.length - 1) * p; const lo = Math.floor(at); const hi = Math.ceil(at);
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? sorted[lo] ?? 0) - (sorted[lo] ?? 0)) * (at - lo);
}

function motionReport(samples: readonly ToothSample[], cues: readonly TrackCue[]) {
  const steps: Array<{ frame: number; px: number; dy: number }> = [];
  for (let index=1;index<samples.length;index+=1) {
    const a=samples[index-1]; const b=samples[index]; if (!a || !b || a.n<1 || b.n<1) continue;
    steps.push({frame:index,px:Math.hypot(b.cx-a.cx,b.cy-a.cy),dy:b.cy-a.cy});
  }
  const sorted=steps.map(row=>row.px).sort((a,b)=>a-b);
  const worst=steps.reduce((best,row)=>row.px>best.px?row:best,{frame:0,px:0,dy:0});
  let reversals=0; let previous: typeof steps[number] | undefined;
  for (const step of steps) {
    const cue=cues.find(row=>(step.frame/FPS)>=row.startS && (step.frame/FPS)<row.endS);
    if (Math.abs(step.dy)>=3 && previous && step.frame-previous.frame<=3 && Math.sign(step.dy)!==Math.sign(previous.dy) && cue?.viseme!=="PP") reversals+=1;
    if (Math.abs(step.dy)>=3) previous=step;
  }
  const ppFrames=samples.map((sample,frame)=>({sample,frame,cue:cues.find(row=>(frame/FPS)>=row.startS&&(frame/FPS)<row.endS)}))
    .filter(row=>row.cue?.viseme==="PP");
  return {
    stepCount:steps.length, median:percentile(sorted,.5), p90:percentile(sorted,.9), max:worst.px, maxFrame:worst.frame,
    countOver3Px:steps.filter(row=>row.px>3).length,
    directionReversalsWithin100Ms:reversals,
    reversalDefinition:"successive salient tooth-centroid dy steps >=3 px with opposite signs, <=3 frames apart; PP cue excluded",
    ppCheck:{ frameCount:ppFrames.length, maxLipGapPx:Math.max(0,...ppFrames.map(row=>row.sample.lipGapPx)), maxTeethCandidatePixels:Math.max(0,...ppFrames.map(row=>row.sample.mouthTeethN)) },
  };
}

type CaptureCanvas = { height:number; toDataURL(kind:string):string; getContext(kind:string):{RGBA:number;UNSIGNED_BYTE:number;readPixels(x:number,y:number,w:number,h:number,f:number,t:number,p:Uint8Array):void}|null };
type PageGlobal = { __speechTrack:TrackCue[];__speechTimeS:number;requestAnimationFrame(cb:()=>void):number;document:{getElementById(id:string):CaptureCanvas|null};__openClinXrIsolatedRenderFrame?:()=>void;__openClinXrIsolatedSceneRoot?:{userData?:{openClinXrNamedVisemeDrive?:{activeTargetName?:string;appliedMeshCount?:number}}} };

async function recordFrames(page: Page, cues: TrackCue[], durationS: number, frameDir: string) {
  const frames=Math.max(2,Math.round(durationS*FPS)); mkdirSync(frameDir,{recursive:true});
  await page.evaluate((track:TrackCue[])=>{ (globalThis as unknown as PageGlobal).__speechTrack=track; },cues);
  const samples:ToothSample[]=[]; const targets=new Set<string>();
  for (let frame=0;frame<frames;frame+=1) {
    await page.evaluate((timeS:number)=>{ (globalThis as unknown as PageGlobal).__speechTimeS=timeS; },frame/FPS);
    await page.evaluate(()=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("requestAnimationFrame stalled")),2000);(globalThis as unknown as PageGlobal).requestAnimationFrame(()=>{clearTimeout(timer);resolve();});}));
    const shot=await page.evaluate(()=>{ const win=globalThis as unknown as PageGlobal; win.__openClinXrIsolatedRenderFrame?.();
      const canvas=win.document.getElementById("isolated-subject-capture-canvas"); const gl=canvas?.getContext("webgl2")??canvas?.getContext("webgl"); if(!canvas||!gl)return {error:"canvas missing"};
      const width=240,height=180,buf=new Uint8Array(width*height*4); gl.readPixels(500,canvas.height-710,width,height,gl.RGBA,gl.UNSIGNED_BYTE,buf);
      let n=0,sx=0,sy=0,lipGapPx=0,mouthTeethN=0;
      for(let p=0,pixel=0;p<buf.length;p+=4,pixel+=1){const r=buf[p]??0,g=buf[p+1]??0,b=buf[p+2]??0,mean=(r+g+b)/3,x=pixel%width,y=height-1-Math.floor(pixel/width);
        if(mean>148&&Math.abs(r-g)<16&&Math.abs(g-b)<16&&r>140&&r<220){n+=1;sx+=x;sy+=y;if(x>=40&&x<=100&&y>=55&&y<=85)mouthTeethN+=1;}}
      for(let x=40;x<=100;x+=1){let run=0;for(let y=55;y<=85;y+=1){const row=height-1-y,p=(row*width+x)*4;const mean=((buf[p]??0)+(buf[p+1]??0)+(buf[p+2]??0))/3;if(mean<70){run+=1;lipGapPx=Math.max(lipGapPx,run);}else run=0;}}
      const drive=win.__openClinXrIsolatedSceneRoot?.userData?.openClinXrNamedVisemeDrive; const target=!drive||(drive.appliedMeshCount??0)<1?"":(drive.activeTargetName??"sil");
      return {target,n,cx:n?sx/n:0,cy:n?sy/n:0,lipGapPx,mouthTeethN,png:canvas.toDataURL("image/png")}; });
    if("error" in shot&&shot.error)throw new Error(`frame ${frame}: ${shot.error}`); if(!shot.target)throw new Error(`frame ${frame} did not drive a viseme mesh`);
    samples.push({n:shot.n??0,cx:shot.cx??0,cy:shot.cy??0,target:shot.target,lipGapPx:shot.lipGapPx??0,mouthTeethN:shot.mouthTeethN??0}); targets.add(shot.target);
    writeFileSync(path.join(frameDir,`f-${String(frame).padStart(4,"0")}.png`),Buffer.from(shot.png.slice(shot.png.indexOf(",")+1),"base64"));
  }
  return {frames,samples,targets:[...targets],teeth:motionReport(samples,cues)};
}

async function main():Promise<void>{
  mkdirSync(OUT_DIR,{recursive:true}); const jobDir=mkdtempSync(path.join(tmpdir(),`mouth-${MODE}-${process.pid}-`)); const track=makeTrack(jobDir);
  const durationS=Number(execFileSync("ffprobe",["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",AUDIO],{encoding:"utf8"}).trim());
  let server:PortlessDevServer|undefined;
  await createLocalComputeServices().sceneCapture.withBrowser(`mouth-dynamics:${MODE}`,async launched=>{try{server=await spawnPortlessDevServer({filter:"@openclinxr/ui-xr",readyTimeoutMs:180000,cwd:REPO});
    const page=await (launched as HeadlessBrowser).newPage({viewport:{width:VIEW_W,height:VIEW_H},deviceScaleFactor:1}); page.setDefaultTimeout(180000); await page.addInitScript(browserDriveSource());
    const spec={subjectId:"mpfb-peds-parent-aisha",subjectKind:"glb",bodyGlb:"/generated-humanoids/mpfb-peds-parent-aisha.glb",focus:"head",label:`mouth dynamics ${MODE}`};
    await page.goto(`${server.url}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`,{waitUntil:"domcontentloaded",timeout:240000});
    await page.waitForFunction("window.__openClinXrIsolatedSubjectEvidence != null || window.__openClinXrVisemeApplierError != null",null,{timeout:180000});
    const error=await page.evaluate("window.__openClinXrVisemeApplierError || ''"); if(error)throw new Error(String(error));
    const frameDir=path.join(jobDir,"frames"); const result=await recordFrames(page,track.cues,durationS,frameDir); const clip=path.join(OUT_DIR,"clip.mp4");
    execFileSync("ffmpeg",["-v","error","-y","-framerate",String(FPS),"-start_number","0","-i",path.join(frameDir,"f-%04d.png"),"-i",AUDIO,"-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart","-shortest",clip]);
    const dynamics=MODE==="step3"
      ? "jaw: critically damped spring at fixed 240 Hz (omega=6 rad/s); PP closure completed by cue midpoint; <100 ms vowel target = own*smoothstep(duration/0.1)+neighborMean*(1-dominance); vowel intensity clamp [0.5,1]. lips: continuous smoothstep between cue centres with PP pre-closure; PP exact full-weight pose"
      : "legacy 0.06 s smoothstep transition on lips and jaw";
    writeFileSync(path.join(OUT_DIR,"metrics.json"),`${JSON.stringify({schemaVersion:"openclinxr.mouth-dynamics.v1",mode:MODE,line:LINE,audioPath:path.relative(REPO,AUDIO),audioDurationS:durationS,frameRate:FPS,frameCount:result.frames,wavSha256:track.wavSha256,timing:"Rhubarb 1.14 waveform timestamps mapped A-H,X to canonical OVR cues",dynamics,canonicalTrack:track.cues,rhubarb:track.rhubarb,targetsSeen:result.targets,toothCentroidSteps:result.teeth,toothSamples:result.samples},null,2)}\n`);
    await page.close();
  }finally{if(server)await stopPortlessDevServer(server.proc);rmSync(jobDir,{recursive:true,force:true});}});
}

main().catch((error:unknown)=>{console.error(error);process.exitCode=1;});
