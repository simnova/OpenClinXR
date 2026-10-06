/** Capture waveform-timed mouth motion without modifying the parent GLB or its static viseme keys. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { mfaArpabetCues } from "./mfa-align.js";
import { type PortlessDevServer, spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";
import type { Page } from "../lib/slotted-playwright.js";

type HeadlessBrowser = { newPage(options: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<Page> };
type TrackCue = { startS: number; endS: number; viseme: string; intensity: number };
type ToothSample = { n: number; cx: number; cy: number; target: string; lipGapPx: number; mouthTeethN: number; upperTeethN?: number; lowerTeethN?: number };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const AUDIO = path.join(HERE, "visemes/i-feel-the-pain-is-better-now.aiff");
const RHUBARB = path.join(process.env.HOME ?? "", ".openclinxr-tools/rhubarb/rhubarb");
const LINE = "I feel the pain is better now.";
/** Cue source: MFA forced alignment by default when installed (tools/openclinxr/asset-pipeline/mfa/install-mfa.sh); Rhubarb when MFA is absent or `--aligner rhubarb` is passed. */
const ALIGNER_ARG = process.argv.includes("--aligner") ? process.argv[process.argv.indexOf("--aligner") + 1] : undefined;
const ALIGNER = ALIGNER_ARG === "rhubarb" ? "rhubarb" : ALIGNER_ARG === "mfa" || existsSync(path.join(process.env.HOME ?? "", ".openclinxr-tools/mfa/bin/mfa")) ? "mfa" : "rhubarb";
const MODE = process.argv.includes("--fixed-gap") ? "teeth-gap/fixed-capture" : process.argv.includes("--step3") ? "step3" : "step2";
/** U1 mouth-front: opt-in frontal mouth-height view. Absent = legacy head framing, byte-identical. */
const MOUTH_FRONT = process.argv.includes("--view") && process.argv[process.argv.indexOf("--view") + 1] === "mouth-front";
const OUT_DIR = path.join(REPO, `docs/openclinxr/mouth-dynamics/${MODE}${MOUTH_FRONT ? "-mouth-front" : ""}`);
const MODE_TMP = MODE.replaceAll("/", "-");
const VIEW_W = 1280;
const VIEW_H = 960;
const FPS = 30;

function esbuildBin(): string {
  const root = path.join(REPO, "node_modules/.pnpm");
  const dir = readdirSync(root).find((name) => name.startsWith("esbuild@"));
  if (!dir) throw new Error("esbuild is not installed");
  return path.join(root, dir, "node_modules/esbuild/bin/esbuild");
}

function browserDriveSource(): { drive: string; split: string } {
  const bundle = (source: string, globalName: string) => {
    const output = path.join(tmpdir(), `mouth-dynamics-${globalName}-${process.pid}.js`);
    execFileSync(esbuildBin(), [source, "--bundle", "--format=iife", `--global-name=${globalName}`, "--platform=browser",
    `--alias:@openclinxr/asset-registry=${path.join(REPO, "packages/openclinxr/asset-registry/src/morph-target-resolver.ts")}`,
    `--outfile=${output}`,
    ], { stdio: "inherit" });
    const result = readFileSync(output, "utf8");
    rmSync(output, { force: true });
    return result;
  };
  const runtime = bundle(path.join(REPO, "packages/openclinxr/xr-dialogue/src/actor-audio-runtime.ts"), "OpenClinXrVisemeDrive");
  const mapper = bundle(path.join(REPO, "packages/openclinxr/xr-dialogue/src/viseme-cue-track.ts"), "OpenClinXrCueTrack");
  const split = bundle(path.join(HERE, "tooth-pixel-split.ts"), "OpenClinXrToothSplit");
  const result = `${runtime}\n${mapper}
let captureRuntime,captureContext;
window.__openClinXrStartPreparedSpeech=()=>{const root=window.__openClinXrIsolatedSceneRoot,raw=window.__speechRhubarb,base64=window.__speechWavBase64;if(!root||!raw||!base64)throw new Error("prepared-runtime-input-missing");
  const binary=atob(base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i+=1)bytes[i]=binary.charCodeAt(i);
  const cues=window.__speechAligner==="mfa"?OpenClinXrCueTrack.mapArpabetTrack(raw,bytes.buffer):OpenClinXrCueTrack.mapRhubarbTrack(raw,bytes.buffer);const last=cues[cues.length-1],duration=last.endS;
  captureContext={currentTime:0,state:"running",sampleRate:22050,createBufferSource(){return {buffer:null,playbackRate:{value:1},connect(){},start(){},stop(){},disconnect(){},onended:null};}};
  const slot={root,activeSpeech:undefined};captureRuntime=OpenClinXrVisemeDrive.createActorAudioRuntime({developmentFixture:true,fixtureSearch:"?openclinxrSpeakFixture=1"});
  captureRuntime.diagnostics.installRuntime({context:captureContext,destination:{},entry:{actorId:"capture",responseText:${JSON.stringify(LINE)},runnerConversationTurn:1,waveformSha256:"capture",cueSha256:"capture",decodedSampleRate:22050,decodedSampleCount:Math.ceil(duration*22050),buffer:{duration,sampleRate:22050,length:Math.ceil(duration*22050)},cues:cues.map(c=>({phoneme:c.viseme,atSecond:c.startS,durationSeconds:c.endS-c.startS,intensity:c.intensity}))},getSlot(){return slot;},triggerDialogue(){slot.activeSpeech={text:${JSON.stringify(LINE)},phonemeSequence:["sil"],startedAtMs:0,durationMs:duration*1000};}});
  if(!captureRuntime.diagnostics.start({actorId:"capture",spokenText:${JSON.stringify(LINE)}}))throw new Error("prepared-runtime-start-refused");return cues;};
window.__openClinXrSyncPreparedSpeech=(timeS)=>{if(!captureRuntime||!captureContext)throw new Error("prepared-runtime-not-started");captureContext.currentTime=timeS;captureRuntime.syncPreparedActorAudio(timeS*1000);};`;
  return { drive: result, split };
}

function makeTrack(jobDir: string): { aligner: string; doc: unknown; wavBase64: string; wavSha256: string } {
  const wav = path.join(jobDir, "speech.wav");
  const dialog = path.join(jobDir, "dialog.txt");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", AUDIO, "-ar", "22050", "-ac", "1", "-c:a", "pcm_s16le", wav]);
  writeFileSync(dialog, `${LINE}\n`);
  let doc: unknown;
  if (ALIGNER === "mfa") {
    doc = mfaArpabetCues(wav, LINE, "step3");
  } else {
    const output = path.join(jobDir, "rhubarb.json");
    execFileSync(RHUBARB, ["--exportFormat", "json", "-d", dialog, "--extendedShapes", "GHX", "--output", output, wav], { stdio: "inherit" });
    const rhubarb = JSON.parse(readFileSync(output, "utf8")) as {
      metadata?: { soundFile?: string; duration?: number };
      mouthCues?: Array<{ start: number; end: number; value: string }>;
    };
    if (rhubarb.metadata?.soundFile) rhubarb.metadata.soundFile = "speech.wav";
    doc = rhubarb;
  }
  const bytes = readFileSync(wav);
  const wavSha256 = execFileSync("shasum", ["-a", "256", wav], { encoding: "utf8" }).split(/\s/u)[0] ?? "";
  return { aligner: ALIGNER, doc, wavBase64: bytes.toString("base64"), wavSha256 };
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
type PageGlobal = { __speechTimeS:number;requestAnimationFrame(cb:()=>void):number;document:{getElementById(id:string):CaptureCanvas|null};__openClinXrIsolatedRenderFrame?:()=>void;__openClinXrSyncPreparedSpeech?:(timeS:number)=>void;__openClinXrIsolatedSceneRoot?:{userData?:{openClinXrNamedVisemeDrive?:{activeTargetName?:string;appliedMeshCount?:number}}} };

async function recordFrames(page: Page, cues: TrackCue[], durationS: number, frameDir: string) {
  const frames=Math.max(2,Math.round(durationS*FPS)); mkdirSync(frameDir,{recursive:true});
  const samples:ToothSample[]=[]; const targets=new Set<string>();
  // Sampler geometry: legacy head-view numbers are the defaults; mouth-front
  // recentres the 240x180 window (same size) and widens the counting box to
  // the measured aperture extent (k=0: teeth x13-239 y29-83 of the window).
  // Defaults are literal-identical to the pre-view code path.
  const sampler = MOUTH_FRONT
    ? { ox: 520, yTop: 570, split: true, x0: 10, x1: 230, y0: 25, y1: 95 }
    : { ox: 500, yTop: 710, split: false, x0: 40, x1: 100, y0: 55, y1: 85 };
  for (let frame=0;frame<frames;frame+=1) {
    await page.evaluate((timeS:number)=>{ const win=globalThis as unknown as PageGlobal;win.__speechTimeS=timeS;win.__openClinXrSyncPreparedSpeech?.(timeS); },frame/FPS);
    await page.evaluate(()=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("requestAnimationFrame stalled")),2000);(globalThis as unknown as PageGlobal).requestAnimationFrame(()=>{clearTimeout(timer);resolve();});}));
    const shot=await page.evaluate((geom:{ox:number;yTop:number;split:boolean;x0:number;x1:number;y0:number;y1:number})=>{ const win=globalThis as unknown as PageGlobal; win.__openClinXrIsolatedRenderFrame?.();
      const canvas=win.document.getElementById("isolated-subject-capture-canvas"); const gl=canvas?.getContext("webgl2")??canvas?.getContext("webgl"); if(!canvas||!gl)return {error:"canvas missing"};
      const width=240,height=180,buf=new Uint8Array(width*height*4); gl.readPixels(geom.ox,canvas.height-geom.yTop,width,height,gl.RGBA,gl.UNSIGNED_BYTE,buf);
      const splitLib=globalThis as unknown as { OpenClinXrToothSplit?: { analyzeToothPixels(buf: ArrayLike<number>, width: number, height: number, box: { x0: number; x1: number; y0: number; y1: number }, split: boolean): { n: number; cx: number; cy: number; mouthTeethN: number; lipGapPx: number; upperTeethN?: number; lowerTeethN?: number } } };
      const counts=splitLib.OpenClinXrToothSplit?.analyzeToothPixels(buf,width,height,{x0:geom.x0,x1:geom.x1,y0:geom.y0,y1:geom.y1},geom.split);
      if(!counts)return {error:"tooth-split-lib-missing"};
      const drive=win.__openClinXrIsolatedSceneRoot?.userData?.openClinXrNamedVisemeDrive; const target=!drive||(drive.appliedMeshCount??0)<1?"":(drive.activeTargetName??"sil");
      return {target,n:counts.n,cx:counts.cx,cy:counts.cy,lipGapPx:counts.lipGapPx,mouthTeethN:counts.mouthTeethN,upperTeethN:counts.upperTeethN,lowerTeethN:counts.lowerTeethN,png:canvas.toDataURL("image/png")}; },sampler);
    if("error" in shot&&shot.error)throw new Error(`frame ${frame}: ${shot.error}`); if(!shot.target)throw new Error(`frame ${frame} did not drive a viseme mesh`);
    samples.push({n:shot.n??0,cx:shot.cx??0,cy:shot.cy??0,target:shot.target,lipGapPx:shot.lipGapPx??0,mouthTeethN:shot.mouthTeethN??0,...(shot.upperTeethN!==undefined?{upperTeethN:shot.upperTeethN,lowerTeethN:shot.lowerTeethN??0}:{})}); targets.add(shot.target);
    writeFileSync(path.join(frameDir,`f-${String(frame).padStart(4,"0")}.png`),Buffer.from(shot.png.slice(shot.png.indexOf(",")+1),"base64"));
  }
  return {frames,samples,targets:[...targets],teeth:motionReport(samples,cues)};
}

async function main():Promise<void>{
  mkdirSync(OUT_DIR,{recursive:true}); const jobDir=mkdtempSync(path.join(tmpdir(),`mouth-${MODE_TMP}-${process.pid}-`)); const track=makeTrack(jobDir);
  const durationS=Number(execFileSync("ffprobe",["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",AUDIO],{encoding:"utf8"}).trim());
  let server:PortlessDevServer|undefined;
  await createLocalComputeServices().sceneCapture.withBrowser(`mouth-dynamics:${MODE}`,async launched=>{try{server=await spawnPortlessDevServer({filter:"@openclinxr/ui-xr",readyTimeoutMs:180000,cwd:REPO});
    const page=await (launched as HeadlessBrowser).newPage({viewport:{width:VIEW_W,height:VIEW_H},deviceScaleFactor:1}); page.setDefaultTimeout(180000); const runtimeDrive=browserDriveSource();
    const spec={subjectId:"mpfb-peds-parent-aisha",subjectKind:"glb",bodyGlb:"/generated-humanoids/mpfb-peds-parent-aisha.glb",...(MOUTH_FRONT?{focus:"mouth",view:"front"}:{focus:"head"}),label:`mouth dynamics ${MODE}`};
    await page.goto(`${server.url}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`,{waitUntil:"domcontentloaded",timeout:240000});
    await page.waitForFunction("window.__openClinXrIsolatedSubjectEvidence != null || window.__openClinXrVisemeApplierError != null",null,{timeout:180000});
    const error=await page.evaluate("window.__openClinXrVisemeApplierError || ''"); if(error)throw new Error(String(error));
    await page.addScriptTag({ content: runtimeDrive.drive });
    await page.addScriptTag({ content: runtimeDrive.split });
    const prepared=await page.evaluate((input:{aligner:string;doc:unknown;wavBase64:string})=>{ const win=globalThis as typeof globalThis & {__speechRhubarb?:unknown;__speechAligner?:string;__speechWavBase64?:string;__openClinXrStartPreparedSpeech?:()=>TrackCue[]};win.__speechRhubarb=input.doc;win.__speechAligner=input.aligner;win.__speechWavBase64=input.wavBase64;return {starter:typeof win.__openClinXrStartPreparedSpeech,cues:win.__openClinXrStartPreparedSpeech?.()??[]};},{aligner:track.aligner,doc:track.doc,wavBase64:track.wavBase64});
    const cues=prepared.cues as TrackCue[];
    if(!cues.length)throw new Error(`prepared-runtime-cues-missing:${prepared.starter}`);
    const frameDir=path.join(jobDir,"frames"); const result=await recordFrames(page,cues,durationS,frameDir); const clip=path.join(OUT_DIR,"clip.mp4");
    execFileSync("ffmpeg",["-v","error","-y","-framerate",String(FPS),"-start_number","0","-i",path.join(frameDir,"f-%04d.png"),"-i",AUDIO,"-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart","-shortest",clip]);
    const dynamicsStep3="jaw: critically damped spring at fixed 240 Hz (omega=6 rad/s); PP hard closure at cue onset; <100 ms vowel target = own*smoothstep(duration/0.1)+neighborMean*(1-dominance); vowel intensity clamp [0.5,1]. lips: canonical per-weight critically damped follower at 240 Hz (omega=14 rad/s, tau=71 ms); <100 ms cue coarticulation; PP exact full-weight closure at cue onset";
    const dynamics=MODE==="step3" || MODE.startsWith("teeth-gap") ? dynamicsStep3 : "legacy 0.06 s smoothstep transition on lips and jaw";
    const timing = track.aligner === "mfa"
      ? "MFA 3.4.2 phone alignment of the known dialog (english_us_arpa) mapped by the xr-dialogue arpabet intake before prepared runtime playback"
      : "Rhubarb 1.14 waveform timestamps mapped by the xr-dialogue internal intake mapper before prepared runtime playback";
    const cueDoc = track.aligner === "mfa" ? { mfa: track.doc } : { rhubarb: track.doc };
    writeFileSync(path.join(OUT_DIR,"metrics.json"),`${JSON.stringify({schemaVersion:"openclinxr.mouth-dynamics.v1",mode:MODE,line:LINE,aligner:track.aligner,audioPath:path.relative(REPO,AUDIO),audioDurationS:durationS,frameRate:FPS,frameCount:result.frames,wavSha256:track.wavSha256,timing,dynamics,canonicalTrack:cues,...cueDoc,targetsSeen:result.targets,toothCentroidSteps:result.teeth,toothSamples:result.samples},null,2)}\n`);
    await page.close();
  }finally{if(server)await stopPortlessDevServer(server.proc);rmSync(jobDir,{recursive:true,force:true});}});
}

main().catch((error:unknown)=>{console.error(error);process.exitCode=1;});
