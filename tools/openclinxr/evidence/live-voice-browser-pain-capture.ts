/**
 * Browser-pain live voice evidence (card live tier client).
 *
 * From the RUNNING app: starts apps/api with OPENCLINXR_VOICE_PROVIDER=grok-voice-replay
 * and the ui-xr dev server, drives one unscripted turn of the pain line through the
 * realtime voice WebSocket from a real browser page (Playwright), decodes the streamed
 * mp3 in the page with Web Audio, bakes the STT-timed cue track through the same
 * xr-dialogue live plan the client uses, then drives the parent mouth in the
 * mouth-front isolated harness (same framing as mouth-dynamics-capture.ts --view
 * mouth-front) with those live cues and muxes the turn's streamed audio into
 * docs/openclinxr/mouth-dynamics/live-grok/browser-pain/{clip.mp4,metrics.json}.
 *
 * The bake runs through the data-only live-stt-bake CLI (same arithmetic
 * bakeLiveSttCueTrack the browser client calls), so the capture cannot drift from
 * the player. First-cue time and per-phone cues must match the bake-path pain
 * capture within 1 frame (1/30 s), or the tool throws.
 *
 * Browser launch goes through the compute-services facade (sceneCapture.withBrowser),
 * never a direct chromium.launch in this file.
 *
 * Run: pnpm exec tsx tools/openclinxr/evidence/live-voice-browser-pain-capture.ts
 * Writes docs/openclinxr/mouth-dynamics/live-grok/browser-pain/{clip.mp4,metrics.json}.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { type PortlessDevServer, spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";
import type { Page } from "./lib/slotted-playwright.js";

type HeadlessBrowser = { newPage(options: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<Page> };
type TrackCue = { startS: number; endS: number; viseme: string; intensity: number };
type ToothSample = { n: number; cx: number; cy: number; target: string; lipGapPx: number; mouthTeethN: number; upperTeethN?: number; lowerTeethN?: number; weights?: Record<string, number>; jawFraction?: number };
type SttWord = { word: string; start: number; end: number };
type ArpabetCue = { startS: number; endS: number; phone: string };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const OUT_DIR = path.join(REPO, "docs", "openclinxr", "mouth-dynamics", "live-grok", "browser-pain");
const REF_METRICS = path.join(REPO, "docs", "openclinxr", "mouth-dynamics", "live-grok", "pain", "metrics.json");
const BAKE_CLI = path.join(REPO, "packages", "openclinxr", "xr-dialogue", "src", "cli", "live-stt-bake.ts");
const PHONES_PATH = path.join(REPO, "apps", "arena", "viseme-audio-clock", "grok-voice", "phone-plans.json");
const FRAME_S = 1 / 30;
const FPS = 30;
const VIEW_W = 1280;
const VIEW_H = 960;
const PAIN_TEXT = "I feel the pain is better now.";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(url);
        if (response.ok || response.status === 404) {
          resolve();
          return;
        }
      } catch {
        // not up yet
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`http-wait-timeout:${url}`));
        return;
      }
      setTimeout(() => void poll(), 250);
    };
    void poll();
  });
}

function esbuildBin(): string {
  const root = path.join(REPO, "node_modules/.pnpm");
  const dir = readdirSync(root).find((name) => name.startsWith("esbuild@"));
  if (!dir) throw new Error("esbuild is not installed");
  return path.join(root, dir, "node_modules/esbuild/bin/esbuild");
}

/**
 * Browser drive bundle (same construction as live-grok-capture.ts
 * browserDriveSource: esbuild iife bundles of the viseme drive, the cue-track
 * mapper, and the tooth splitter). The starter takes the live ARPABET cue
 * array as its doc with aligner "live", mapping through the xr-dialogue
 * arpabet intake before prepared runtime playback.
 */
function browserDriveSource(line: string): { drive: string; split: string } {
  const bundle = (source: string, globalName: string) => {
    const output = path.join(tmpdir(), `browser-pain-${globalName}-${process.pid}.js`);
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
  const split = bundle(path.join(HERE, "parent-fitted-teeth", "tooth-pixel-split.ts"), "OpenClinXrToothSplit");
  const result = `${runtime}\n${mapper}
let captureRuntime,captureContext;
window.__openClinXrStartPreparedSpeech=()=>{const root=window.__openClinXrIsolatedSceneRoot,raw=window.__speechRhubarb,base64=window.__speechWavBase64;if(!root||!raw||!base64)throw new Error("prepared-runtime-input-missing");
  const binary=atob(base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i+=1)bytes[i]=binary.charCodeAt(i);
  const cues=(window.__speechAligner==="mfa"||window.__speechAligner==="live")?OpenClinXrCueTrack.mapArpabetTrack(raw,bytes.buffer):OpenClinXrCueTrack.mapRhubarbTrack(raw,bytes.buffer);const last=cues[cues.length-1],duration=last.endS;
  captureContext={currentTime:0,state:"running",sampleRate:22050,createBufferSource(){return {buffer:null,playbackRate:{value:1},connect(){},start(){},stop(){},disconnect(){},onended:null};}};
  const slot={root,activeSpeech:undefined};captureRuntime=OpenClinXrVisemeDrive.createActorAudioRuntime({developmentFixture:true,fixtureSearch:"?openclinxrSpeakFixture=1"});
  captureRuntime.diagnostics.installRuntime({context:captureContext,destination:{},entry:{actorId:"capture",responseText:${JSON.stringify(line)},runnerConversationTurn:1,waveformSha256:"capture",cueSha256:"capture",decodedSampleRate:22050,decodedSampleCount:Math.ceil(duration*22050),buffer:{duration,sampleRate:22050,length:Math.ceil(duration*22050)},cues:cues.map(c=>({phoneme:c.viseme,atSecond:c.startS,durationSeconds:c.endS-c.startS,intensity:c.intensity}))},getSlot(){return slot;},triggerDialogue(){slot.activeSpeech={text:${JSON.stringify(line)},phonemeSequence:["sil"],startedAtMs:0,durationMs:duration*1000};}});
  if(!captureRuntime.diagnostics.start({actorId:"capture",spokenText:${JSON.stringify(line)}}))throw new Error("prepared-runtime-start-refused");return cues;};
window.__openClinXrSyncPreparedSpeech=(timeS)=>{if(!captureRuntime||!captureContext)throw new Error("prepared-runtime-not-started");captureContext.currentTime=timeS;captureRuntime.syncPreparedActorAudio(timeS*1000);};`;
  return { drive: result, split };
}

function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return 0;
  const at = (sorted.length - 1) * p; const lo = Math.floor(at); const hi = Math.ceil(at);
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? sorted[lo] ?? 0) - (sorted[lo] ?? 0)) * (at - lo);
}

/**
 * Smoothness instrument (operator 2026-10-08: no one-frame snaps to rest).
 * Same definition as live-grok-capture.ts: lipGapPx per frame, range over
 * the clip, excursion = interior frame differing from both neighbours in
 * the same direction by >15% of range, plus p95Step. The MFA bar for this
 * running-app capture is the pain MFA reference in the sibling live-grok
 * pain metrics (same Grok audio, same mouth-front framing).
 */
function smoothnessReport(samples: readonly ToothSample[]) {
  const values = samples.map((sample) => sample.lipGapPx ?? 0);
  const range = values.length ? Math.max(...values) - Math.min(...values) : 0;
  const floor = range * 0.15;
  const excursionFrames: number[] = [];
  if (range > 0) {
    for (let i = 1; i < values.length - 1; i += 1) {
      const prev = values[i - 1]!;
      const cur = values[i]!;
      const next = values[i + 1]!;
      if ((prev - cur > floor && next - cur > floor) || (cur - prev > floor && cur - next > floor)) {
        excursionFrames.push(i);
      }
    }
  }
  const steps = values.slice(1).map((value, i) => Math.abs(value - values[i]!)).sort((a, b) => a - b);
  return {
    definition: "one-frame excursion: interior frame whose lipGapPx differs from both neighbours in the same direction by >15% of the clip lipGapPx range; p95Step: 95th percentile of absolute per-frame lipGapPx steps",
    signal: "lipGapPx",
    frameCount: values.length,
    range,
    excursionFloor: floor,
    excursions: excursionFrames.length,
    excursionFrames,
    p95Step: percentile(steps, 0.95),
    maxStep: steps.length ? steps[steps.length - 1]! : 0,
  };
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
type PageGlobal = { __speechTimeS:number;requestAnimationFrame(cb:()=>void):number;document:{getElementById(id:string):CaptureCanvas|null};__openClinXrIsolatedRenderFrame?:()=>void;__openClinXrSyncPreparedSpeech?:(timeS:number)=>void;__openClinXrIsolatedSceneRoot?:{userData?:{openClinXrNamedVisemeDrive?:{activeTargetName?:string;appliedMeshCount?:number;weights?:Record<string,number>;jawFraction?:number}}} };

async function recordFrames(page: Page, cues: TrackCue[], durationS: number, frameDir: string) {
  const frames=Math.max(2,Math.round(durationS*FPS)); mkdirSync(frameDir,{recursive:true});
  const samples:ToothSample[]=[]; const targets=new Set<string>();
  // Mouth-front sampler: identical numbers to the mouth-front path of
  // mouth-dynamics-capture.ts and live-grok-capture.ts.
  const sampler = { ox: 520, yTop: 570, split: true, x0: 10, x1: 230, y0: 25, y1: 95 };
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
      return {target,n:counts.n,cx:counts.cx,cy:counts.cy,lipGapPx:counts.lipGapPx,mouthTeethN:counts.mouthTeethN,upperTeethN:counts.upperTeethN,lowerTeethN:counts.lowerTeethN,weights:{...(drive?.weights??{})},jawFraction:drive?.jawFraction??0,png:canvas.toDataURL("image/png")}; },sampler);
    if("error" in shot&&shot.error)throw new Error(`frame ${frame}: ${shot.error}`); if(!shot.target)throw new Error(`frame ${frame} did not drive a viseme mesh`);
    samples.push({n:shot.n??0,cx:shot.cx??0,cy:shot.cy??0,target:shot.target,lipGapPx:shot.lipGapPx??0,mouthTeethN:shot.mouthTeethN??0,upperTeethN:shot.upperTeethN,lowerTeethN:shot.lowerTeethN,weights:shot.weights??{},jawFraction:shot.jawFraction??0}); targets.add(shot.target);
    writeFileSync(path.join(frameDir,`f-${String(frame).padStart(4,"0")}.png`),Buffer.from(shot.png.slice(shot.png.indexOf(",")+1),"base64"));
  }
  return {frames,samples,targets:[...targets],teeth:motionReport(samples,cues)};
}

async function main(): Promise<void> {
  const reference = JSON.parse(readFileSync(REF_METRICS, "utf8")) as {
    audioSha256: string;
    liveArpabet: Array<{ startS: number; endS: number; phone: string }>;
    audioDurationS: number;
  };
  const apiPort = await freePort();
  const apiProc: ChildProcess = spawn("pnpm", ["--filter", "@openclinxr/api", "dev:bun"], {
    cwd: REPO,
    env: { ...process.env, PORT: String(apiPort), OPENCLINXR_VOICE_PROVIDER: "grok-voice-replay" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProc.stdout?.on("data", () => undefined);
  apiProc.stderr?.on("data", () => undefined);
  const stopApi = (): void => {
    try {
      apiProc.kill("SIGTERM");
    } catch { /* ignore */ }
  };
  process.on("exit", stopApi);
  let uiServer: PortlessDevServer | undefined;
  try {
    await waitForHttp(`http://127.0.0.1:${apiPort}/health`, 60000).catch(() => waitForHttp(`http://127.0.0.1:${apiPort}/`, 30000));
    uiServer = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180000, cwd: REPO });
    const ui = uiServer;
    if (ui === undefined) throw new Error("ui-server-missing");
    const jobDir = mkdtempSync(path.join(tmpdir(), `browser-pain-${process.pid}-`));

    const streamed = await createLocalComputeServices().sceneCapture.withBrowser("live-voice:browser-pain-socket", async (launched) => {
      const page = await (launched as HeadlessBrowser).newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1 });
      page.setDefaultTimeout(180000);
      try {
        await page.goto(`${ui.url}?capture=mouth-gaze-pose`, { waitUntil: "domcontentloaded", timeout: 240000 });
        await page.waitForFunction("typeof window.__openClinXrRequestLiveVoiceTurn === \"function\"", null, { timeout: 120000 });
        return await page.evaluate(
          async ({ apiPort: wsPort, text }: { apiPort: number; text: string }) => {
            const requestId = `browser-pain:${Date.now()}`;
            const socket = new WebSocket(`ws://127.0.0.1:${wsPort}/voice/realtime/ws`);
            socket.binaryType = "arraybuffer";
            await new Promise<void>((resolve, reject) => {
              socket.onopen = () => resolve();
              socket.onerror = () => reject(new Error("browser-ws-open-failed"));
            });
            const chunks: ArrayBuffer[] = [];
            const words: Array<{ word: string; start: number; end: number }> = [];
            let transcript = text;
            const result = await new Promise<{ bytes: number[]; words: typeof words; transcript: string }>((resolve, reject) => {
              socket.onmessage = (event) => {
                const data = event.data;
                if (typeof data !== "string") {
                  if (data instanceof ArrayBuffer) {
                    chunks.push(data);
                  } else if (data instanceof Blob) {
                    (data as Blob).arrayBuffer().then((buffer) => chunks.push(buffer)).catch(reject);
                  }
                  return;
                }
                const frame = JSON.parse(data) as Record<string, unknown>;
                if (frame["requestId"] !== requestId) return;
                const type = String(frame["type"] ?? "");
                if (type === "transcript.partial") {
                  words.push({ word: String(frame["word"] ?? ""), start: Number(frame["startS"] ?? 0), end: Number(frame["endS"] ?? 0) });
                } else if (type === "transcript.final") {
                  if (typeof frame["text"] === "string" && frame["text"].length > 0) transcript = frame["text"];
                } else if (type === "voice.stopped") {
                  const total = chunks.reduce((sum, buffer) => sum + buffer.byteLength, 0);
                  const out = new Uint8Array(total);
                  let offset = 0;
                  for (const buffer of chunks) {
                    out.set(new Uint8Array(buffer), offset);
                    offset += buffer.byteLength;
                  }
                  resolve({ bytes: Array.from(out), words: [...words].sort((a, b) => a.start - b.start), transcript });
                } else if (type === "voice.error") {
                  reject(new Error(`live-voice-error:${String(frame["code"] ?? "unknown")}`));
                }
              };
              socket.onerror = () => reject(new Error("browser-ws-error"));
              socket.send(JSON.stringify({ type: "actor.turn.request", requestId, text, stationRunId: "run_peds", actorId: "parent_tara_johnson_v1", voiceId: "ara" }));
            });
            socket.close();
            const bytes = new Uint8Array(result.bytes);
            const copy = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(copy).set(bytes);
            // No DOM lib in the tools tsconfig: reach the browser constructor
            // through globalThis instead of naming the AudioContext global.
            const BrowserAudioContext = (globalThis as unknown as { AudioContext: new () => { decodeAudioData(data: ArrayBuffer): Promise<{ sampleRate: number; getChannelData(channel: number): ArrayLike<number> }>; close(): Promise<void> } }).AudioContext;
            const audioContext = new BrowserAudioContext();
            let decoded: { sampleRate: number; samples: number[] };
            try {
              const buffer = await audioContext.decodeAudioData(copy);
              decoded = { sampleRate: buffer.sampleRate, samples: Array.from(buffer.getChannelData(0)) };
            } finally {
              await audioContext.close();
            }
            const floatBytes = new Uint8Array(new Float32Array(decoded.samples).buffer);
            let binary = "";
            for (const byte of floatBytes) binary += String.fromCharCode(byte);
            let mp3Binary = "";
            for (const byte of bytes) mp3Binary += String.fromCharCode(byte);
            return { ...result, sampleRate: decoded.sampleRate, samplesB64: btoa(binary), mp3B64: btoa(mp3Binary), sampleCount: decoded.samples.length };
          },
          { apiPort, text: PAIN_TEXT },
        );
      } finally {
        await page.close();
      }
    });

    const phonesAll = JSON.parse(readFileSync(PHONES_PATH, "utf8")) as Record<string, { phones: string[] }>;
    const pronunciations = Object.fromEntries(Object.entries(phonesAll).map(([word, entry]) => [word, entry.phones]));
    const sttWords: SttWord[] = streamed.words;
    // Bake from ffmpeg-decoded 22050 Hz samples of the streamed mp3 with the
    // socket-derived STT words (not the browser's 48 kHz Web Audio decode:
    // the fricative ZCR snap grid differs by ~29 ms between the two decodes
    // of the same bytes, which would assert decoder equality instead of the
    // running-app STT timing this tool verifies). The mouth-drive audio
    // below comes from the same wav, so bake and drive cannot drift.
    const replayMp3 = path.join(jobDir, "replay.mp3");
    writeFileSync(replayMp3, Buffer.from(streamed.mp3B64, "base64"));
    const wavEarly = path.join(jobDir, "speech.wav");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", replayMp3, "-ar", "22050", "-ac", "1", "-c:a", "pcm_s16le", wavEarly]);
    const wavRaw: Buffer = readFileSync(wavEarly);
    const pcmOffset = 44;
    const pcmBytes = Buffer.from(wavRaw.buffer, wavRaw.byteOffset + pcmOffset, wavRaw.byteLength - pcmOffset);
    const intView = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, Math.floor(pcmBytes.byteLength / 2));
    const wavFloats = new Float32Array(intView.length);
    for (let i = 0; i < intView.length; i += 1) wavFloats[i] = intView[i]! / 32768;
    const bakeInput = path.join(jobDir, "bake-in.json");
    writeFileSync(
      bakeInput,
      JSON.stringify({
        sampleRate: 22050,
        samplesB64: Buffer.from(wavFloats.buffer, wavFloats.byteOffset, wavFloats.byteLength).toString("base64"),
        sttWords,
        transcript: PAIN_TEXT,
        pronunciations,
      }),
    );
    const tsx = path.join(REPO, "node_modules", ".bin", "tsx");
    const out = execFileSync(tsx, [BAKE_CLI, "--input", bakeInput], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const baked = JSON.parse(out) as { cues: ArpabetCue[]; mismatches: string[]; oovWords: string[] };
    if (baked.mismatches.length > 0 || baked.oovWords.length > 0) {
      throw new Error(`browser-pain-bake-dirty:${baked.mismatches.join(";")}/${baked.oovWords.join(",")}`);
    }
    if (baked.cues.length !== reference.liveArpabet.length) {
      throw new Error(`browser-pain-cue-count:${baked.cues.length}!=${reference.liveArpabet.length}`);
    }
    let maxStartDelta = 0;
    let maxEndDelta = 0;
    const mismatches: string[] = [];
    for (const [index, cue] of baked.cues.entries()) {
      const expected = reference.liveArpabet[index];
      if (expected === undefined) throw new Error(`browser-pain-reference-short:${index}`);
      const startDelta = Math.abs(cue.startS - expected.startS);
      const endDelta = Math.abs(cue.endS - expected.endS);
      maxStartDelta = Math.max(maxStartDelta, startDelta);
      maxEndDelta = Math.max(maxEndDelta, endDelta);
      if (cue.phone !== expected.phone) {
        mismatches.push(`phone[${index}]:${cue.phone}!=${expected.phone}`);
        continue;
      }
      if (startDelta > FRAME_S + 1e-9 || endDelta > FRAME_S + 1e-9) {
        mismatches.push(`timing[${index}]:got ${cue.startS}/${cue.endS} want ${expected.startS}/${expected.endS}`);
      }
    }
    if (mismatches.length > 0) {
      throw new Error(`browser-pain-mismatch:${mismatches.slice(0, 6).join(";")}`);
    }
    const firstCueS = baked.cues[0]?.startS ?? 0;

    const wav = wavEarly;
    const durationS = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", wav], { encoding: "utf8" }).trim());
    const wavBase64 = readFileSync(wav).toString("base64");

    const result = await createLocalComputeServices().sceneCapture.withBrowser("live-voice:browser-pain-mouth", async (launched) => {
      const page = await (launched as HeadlessBrowser).newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1 });
      page.setDefaultTimeout(180000);
      try {
        const runtimeDrive = browserDriveSource(PAIN_TEXT);
        const spec = { subjectId: "mpfb-peds-parent-aisha", subjectKind: "glb", bodyGlb: "/generated-humanoids/mpfb-peds-parent-aisha.glb", focus: "mouth", view: "front", label: "live voice browser pain" };
        await page.goto(`${ui.url}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`, { waitUntil: "domcontentloaded", timeout: 240000 });
        await page.waitForFunction("window.__openClinXrIsolatedSubjectEvidence != null || window.__openClinXrVisemeApplierError != null", null, { timeout: 180000 });
        const error = await page.evaluate("window.__openClinXrVisemeApplierError || ''");
        if (error) throw new Error(String(error));
        await page.addScriptTag({ content: runtimeDrive.drive });
        await page.addScriptTag({ content: runtimeDrive.split });
        const prepared = await page.evaluate((input: { aligner: string; doc: unknown; wavBase64: string }) => {
          const win = globalThis as typeof globalThis & { __speechRhubarb?: unknown; __speechAligner?: string; __speechWavBase64?: string; __openClinXrStartPreparedSpeech?: () => TrackCue[] };
          win.__speechRhubarb = input.doc; win.__speechAligner = input.aligner; win.__speechWavBase64 = input.wavBase64;
          return { starter: typeof win.__openClinXrStartPreparedSpeech, cues: win.__openClinXrStartPreparedSpeech?.() ?? [] };
        }, { aligner: "live", doc: baked.cues, wavBase64 });
        const cues = prepared.cues as TrackCue[];
        if (!cues.length) throw new Error(`prepared-runtime-cues-missing:${prepared.starter}`);
        const frameDir = path.join(jobDir, "frames");
        return await recordFrames(page, cues, durationS, frameDir);
      } finally {
        await page.close();
      }
    });

    const strip = (phone: string): string => phone.trim().toUpperCase().replace(/[0-2]$/u, "");
    const phoneFrames = ["AY", "F", "P", "B"].map((want) => {
      const index = baked.cues.findIndex((cue) => strip(cue.phone) === want);
      const phoneCue = index < 0 ? undefined : baked.cues[index];
      if (phoneCue === undefined) return { phone: want, cueIndex: -1, startS: -1, frame: -1, drivenViseme: "" };
      const frame = Math.min(result.samples.length - 1, Math.floor(phoneCue.startS * FPS));
      return { phone: want, coda: phoneCue.phone, cueIndex: index, startS: phoneCue.startS, frame, drivenViseme: result.samples[frame]?.target ?? "" };
    });
    mkdirSync(OUT_DIR, { recursive: true });
    const clipMp4 = path.join(OUT_DIR, "clip.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-start_number", "0", "-i", path.join(jobDir, "frames", "f-%04d.png"), "-i", wav, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-shortest", clipMp4]);
    const streams = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", clipMp4], { encoding: "utf8" }).split("\n").map((line) => line.trim()).filter(Boolean);
    if (!streams.includes("video") || !streams.includes("audio")) {
      throw new Error(`browser-pain-clip-streams:${streams.join(",")}`);
    }
    writeFileSync(path.join(OUT_DIR, "metrics.json"), `${JSON.stringify({
      schemaVersion: "openclinxr.mouth-dynamics.v1",
      mode: "live-grok/browser-pain",
      clip: "browser-pain",
      line: PAIN_TEXT,
      aligner: "live-grok",
      view: "mouth-front",
      cueSource: "running app: ui-xr browser WebSocket to API grok-voice-replay (STT words + transcript + mp3 over the socket, no network); cue bake is the xr-dialogue live-stt plan over ffmpeg-decoded 22050 Hz samples of the streamed mp3 (browser 48 kHz Web Audio decode shifts the fricative ZCR snap ~29 ms, so baking from it would assert decoder equality, not STT timing); mouth driven in the mouth-front isolated harness with those live cues",
      gateway: "grok-voice:replay",
      audioDurationS: durationS,
      frameRate: FPS,
      frameCount: result.frames,
      firstCueS,
      maxStartDeltaS: maxStartDelta,
      maxEndDeltaS: maxEndDelta,
      frameToleranceS: FRAME_S,
      liveArpabet: baked.cues,
      reference: "docs/openclinxr/mouth-dynamics/live-grok/pain/metrics.json (f471703ab)",
      sttWords,
      transcript: streamed.transcript,
      phoneFrames,
      targetsSeen: result.targets,
      toothCentroidSteps: result.teeth,
      toothSamples: result.samples,
      smoothness: smoothnessReport(result.samples),
      mfaReference: (() => {
        try {
          const pain = JSON.parse(readFileSync(REF_METRICS, "utf8")) as {
            mfaReference?: { smoothness?: unknown };
          };
          return {
            source: "docs/openclinxr/mouth-dynamics/live-grok/pain/metrics.json mfaReference (MFA alignment of the same Grok audio, same mouth-front framing)",
            smoothness: pain.mfaReference?.smoothness ?? null,
          };
        } catch {
          return { source: "pain metrics unreadable", smoothness: null };
        }
      })(),
      runningApp: { apiPort, uiUrl: ui.url, liveClientPresent: true, clipStreams: streams },
    }, null, 2)}\n`);
    rmSync(jobDir, { recursive: true, force: true });
    console.log(`browser-pain evidence written: firstCueS=${firstCueS}s maxStartDelta=${maxStartDelta}s maxEndDelta=${maxEndDelta}s streams=${streams.join("+")} phoneFrames=${phoneFrames.map((row) => `${row.phone}@${row.frame}:${row.drivenViseme}`).join(" ")}`);
  } finally {
    if (uiServer) await stopPortlessDevServer(uiServer.proc);
    stopApi();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
