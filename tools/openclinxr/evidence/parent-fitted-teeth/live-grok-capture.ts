/**
 * Live-Grok mouth-dynamics capture (card tsk_103fae4032cebc86).
 *
 * Companion to mouth-dynamics-capture.ts (frozen step3/viseme-eval capture):
 * a cue source that drives the MADR 0062 live path in replay mode. Per clip
 * it loads the cached Grok TTS mp3 + STT word timestamps (no network),
 * bakes the STT-timed ARPABET track through the xr-dialogue live-stt plan
 * (via the data-only src/cli/live-stt-bake.ts process boundary, so the
 * capture cannot drift from the player), and records the parent mouth in the
 * mouth-front view. MFA aligns the same Grok wav as the scoring reference.
 *
 * Run (replay only):
 * pnpm exec tsx tools/openclinxr/evidence/parent-fitted-teeth/live-grok-capture.ts \
 *   --clip pain --step3 --view mouth-front
 * Omit --clip to capture pain + clin-01. Writes
 * docs/openclinxr/mouth-dynamics/live-grok/<clip>/{clip.mp4,metrics.json}.
 * Failing viseme-eval checks are RESULTS, not gate failures; the coordinator
 * grades the pixels — this tool claims no visual quality.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { mfaArpabetCues, type ArpabetCue } from "./mfa-align.js";
import { type PortlessDevServer, spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";
import type { Page } from "../lib/slotted-playwright.js";

type HeadlessBrowser = { newPage(options: { viewport: { width: number; height: number }; deviceScaleFactor?: number }): Promise<Page> };
type TrackCue = { startS: number; endS: number; viseme: string; intensity: number };
type ToothSample = { n: number; cx: number; cy: number; target: string; lipGapPx: number; mouthTeethN: number; upperTeethN?: number; lowerTeethN?: number; weights?: Record<string, number>; jawFraction?: number };
type SttWord = { word: string; start: number; end: number };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const ARENA = path.join(REPO, "apps", "arena", "viseme-audio-clock", "grok-voice");
const CACHE_DIR = path.join(process.env.HOME ?? "", ".openclinxr-cache", "grok-voice");
const PHONES_PATH = path.join(ARENA, "phone-plans.json");
const MANIFEST_PATH = path.join(ARENA, "cache-manifest.json");
const BAKE_CLI = path.join(REPO, "packages", "openclinxr", "xr-dialogue", "src", "cli", "live-stt-bake.ts");
const TSX_BIN = path.join(REPO, "node_modules", ".bin", "tsx");

const GROK_CLIPS = {
  pain: {
    text: "I feel the pain is better now.",
    transcript: "i feel the pain is better now",
    mfaBasename: "live-grok-pain",
  },
  "clin-01": {
    text: "She takes two puffs of albuterol every four hours.",
    transcript: "she takes two puffs of albuterol every four hours",
    mfaBasename: "live-grok-clin-01",
  },
} as const;
type GrokClip = keyof typeof GROK_CLIPS;

function requestedClips(): GrokClip[] {
  const at = process.argv.indexOf("--clip");
  const named = at >= 0 ? process.argv[at + 1] : undefined;
  if (named === "pain" || named === "clin-01") return [named];
  if (named !== undefined) throw new Error(`unknown-live-grok-clip:${named}`);
  return ["pain", "clin-01"];
}

function replayMiss(what: string): Error {
  // Same code the grok-voice replay provider throws on a cache miss: replay
  // never touches the network, and a miss surfaces instead of a fallback.
  return Object.assign(new Error(`live-grok-cache-miss (no network in replay mode): ${what}`), {
    code: "grok_voice_cache_miss",
  });
}

function requireFlags(): void {
  if (!process.argv.includes("--step3")) throw new Error("usage: live-grok-capture.ts --clip pain|clin-01 --step3 --view mouth-front");
  const at = process.argv.indexOf("--view");
  if (at < 0 || process.argv[at + 1] !== "mouth-front") throw new Error("usage: live-grok-capture.ts --clip pain|clin-01 --step3 --view mouth-front");
}

const VIEW_W = 1280;
const VIEW_H = 960;
const FPS = 30;
const SAMPLE_RATE = 22050;

function esbuildBin(): string {
  const root = path.join(REPO, "node_modules/.pnpm");
  const dir = readdirSync(root).find((name) => name.startsWith("esbuild@"));
  if (!dir) throw new Error("esbuild is not installed");
  return path.join(root, dir, "node_modules/esbuild/bin/esbuild");
}

function browserDriveSource(line: string): { drive: string; split: string } {
  const bundle = (source: string, globalName: string) => {
    const output = path.join(tmpdir(), `live-grok-${globalName}-${process.pid}.js`);
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
  const cues=(window.__speechAligner==="mfa"||window.__speechAligner==="live")?OpenClinXrCueTrack.mapArpabetTrack(raw,bytes.buffer):OpenClinXrCueTrack.mapRhubarbTrack(raw,bytes.buffer);const last=cues[cues.length-1],duration=last.endS;
  captureContext={currentTime:0,state:"running",sampleRate:22050,createBufferSource(){return {buffer:null,playbackRate:{value:1},connect(){},start(){},stop(){},disconnect(){},onended:null};}};
  const slot={root,activeSpeech:undefined};captureRuntime=OpenClinXrVisemeDrive.createActorAudioRuntime({developmentFixture:true,fixtureSearch:"?openclinxrSpeakFixture=1"});
  captureRuntime.diagnostics.installRuntime({context:captureContext,destination:{},entry:{actorId:"capture",responseText:${JSON.stringify(line)},runnerConversationTurn:1,waveformSha256:"capture",cueSha256:"capture",decodedSampleRate:22050,decodedSampleCount:Math.ceil(duration*22050),buffer:{duration,sampleRate:22050,length:Math.ceil(duration*22050)},cues:cues.map(c=>({phoneme:c.viseme,atSecond:c.startS,durationSeconds:c.endS-c.startS,intensity:c.intensity}))},getSlot(){return slot;},triggerDialogue(){slot.activeSpeech={text:${JSON.stringify(line)},phonemeSequence:["sil"],startedAtMs:0,durationMs:duration*1000};}});
  if(!captureRuntime.diagnostics.start({actorId:"capture",spokenText:${JSON.stringify(line)}}))throw new Error("prepared-runtime-start-refused");return cues;};
window.__openClinXrSyncPreparedSpeech=(timeS)=>{if(!captureRuntime||!captureContext)throw new Error("prepared-runtime-not-started");captureContext.currentTime=timeS;captureRuntime.syncPreparedActorAudio(timeS*1000);};`;
  return { drive: result, split };
}

function loadReplayClip(clip: GrokClip): {
  mp3Path: string; cacheKey: string; audioSha256: string;
  sttWords: SttWord[]; pronunciations: Record<string, string[]>;
} {
  const def = GROK_CLIPS[clip];
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Array<{
    kind?: string; clip?: string; key?: string; text?: string; audioSha256?: string;
  }>;
  const tts = manifest.find((entry) => entry.kind === "tts" && entry.clip === clip);
  if (!tts?.key || !tts.audioSha256 || !tts.text) throw new Error(`live-grok-manifest-without-tts:${clip}`);
  const mp3Path = path.join(CACHE_DIR, `${tts.key}.mp3`);
  if (!existsSync(mp3Path)) throw replayMiss(`tts ${tts.key}`);
  const sttByText = new Map<string, SttWord[]>();
  for (const file of readdirSync(CACHE_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(path.join(CACHE_DIR, file), "utf8")) as {
        words?: Array<{ word?: string; start?: number; end?: number }>; text?: string;
      };
      if (parsed && Array.isArray(parsed.words) && typeof parsed.text === "string") {
        sttByText.set(parsed.text, parsed.words.map((w) => ({ word: String(w.word ?? ""), start: Number(w.start), end: Number(w.end) })));
      }
    } catch { continue; }
  }
  const sttEntry = manifest.find((m) => m.kind === "stt" && m.audioSha256 === tts.audioSha256);
  const sttWords = (sttEntry?.text !== undefined ? sttByText.get(sttEntry.text) : undefined) ?? sttByText.get(tts.text);
  if (!sttWords || sttWords.length === 0) throw replayMiss(`stt ${tts.audioSha256}`);
  const phonesAll = JSON.parse(readFileSync(PHONES_PATH, "utf8")) as Record<string, { phones: string[] }>;
  const pronunciations: Record<string, string[]> = Object.fromEntries(
    Object.entries(phonesAll).map(([word, entry]) => [word, entry.phones]),
  );
  return { mp3Path, cacheKey: tts.key, audioSha256: tts.audioSha256, sttWords, pronunciations };
}

function bakeLiveCues(jobDir: string, sttWords: SttWord[], transcript: string, pronunciations: Record<string, string[]>): {
  cues: ArpabetCue[]; mismatches: string[]; oovWords: string[];
} {
  const raw: Buffer = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", path.join(jobDir, "speech.wav"), "-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", "-f", "s16le", "-"],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  const bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  const ib = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const floats = new Float32Array(ib.length);
  for (let i = 0; i < ib.length; i += 1) floats[i] = ib[i]! / 32768;
  const inputPath = path.join(jobDir, "bake-in.json");
  writeFileSync(inputPath, JSON.stringify({
    sampleRate: SAMPLE_RATE,
    samplesB64: Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength).toString("base64"),
    sttWords,
    transcript,
    pronunciations,
  }));
  const tsx = existsSync(TSX_BIN) ? TSX_BIN : "tsx";
  const out = execFileSync(tsx, [BAKE_CLI, "--input", inputPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const parsed = JSON.parse(out) as { cues: ArpabetCue[]; mismatches: string[]; oovWords: string[] };
  if (!Array.isArray(parsed.cues) || parsed.cues.length === 0) throw new Error("live-grok-bake-empty");
  if (parsed.mismatches.length > 0 || parsed.oovWords.length > 0) {
    throw new Error(`live-grok-bake-dirty:mismatches=${parsed.mismatches.join(";")} oov=${parsed.oovWords.join(",")}`);
  }
  return parsed;
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

/**
 * Local mirror of ARPABET_TO_OVR (packages/openclinxr/xr-dialogue/src/viseme-cue-track.ts).
 * Same admission as tools/openclinxr/evidence/parent-fitted-teeth/viseme-eval.ts:
 * importing the package table would publish an eval-only mapping on the
 * reviewed production surface (admission psr-01e), so the mapping lives here
 * with its source cited. Update both if the canonical table changes.
 */
const EVAL_ARPABET_TO_OVR: Readonly<Record<string, string>> = Object.freeze({
  SIL: "sil", SP: "sil", SPN: "sil",
  P: "PP", B: "PP", M: "PP",
  F: "FF", V: "FF",
  TH: "TH", DH: "TH",
  T: "DD", D: "DD",
  K: "kk", G: "kk", NG: "kk",
  CH: "CH", JH: "CH", SH: "CH", ZH: "CH",
  S: "SS", Z: "SS",
  N: "nn", L: "nn",
  R: "RR", ER: "RR",
  AA: "aa", AE: "aa", AH: "aa", AW: "aa", AY: "aa", HH: "aa",
  EH: "E", EY: "E",
  IH: "I", IY: "I", Y: "I",
  AO: "O", OW: "O", OY: "O",
  UH: "U", UW: "U", W: "U",
});

function stressless(phone: string): string {
  return phone.trim().toUpperCase().replace(/[0-2]$/u, "");
}

function framesInside(startS: number, endS: number, frameCount: number): number[] {
  const out: number[] = [];
  for (let n = 0; n < frameCount; n += 1) {
    const t = (n + 0.5) / FPS;
    if (t >= startS && t < endS) out.push(n);
  }
  return out;
}

function topViseme(weights: Record<string, number> | undefined): { name: string; weight: number } {
  let name = "";
  let weight = 0;
  for (const [key, value] of Object.entries(weights ?? {})) {
    if (value > weight) { name = key; weight = value; }
  }
  return { name, weight };
}

/** Score live-driven mouth-front mids against the MFA reference phones. */
function scoreAgainstMfa(mfa: ArpabetCue[], samples: ToothSample[]) {
  const phones = mfa.map((cue) => {
    const frames = framesInside(cue.startS, cue.endS, samples.length);
    const mid = frames.length ? (frames[Math.floor(frames.length / 2)] ?? null) : null;
    const sample = mid === null ? null : samples[mid];
    const top = topViseme(sample?.weights);
    const expected = EVAL_ARPABET_TO_OVR[stressless(cue.phone)];
    if (expected === undefined) throw new Error(`unknown-arpabet-phone:${cue.phone}`);
    return {
      phone: stressless(cue.phone),
      startS: Math.round(cue.startS * 1000) / 1000,
      endS: Math.round(cue.endS * 1000) / 1000,
      expectedViseme: expected,
      mid: mid === null || !sample ? null : {
        frame: mid,
        target: sample.target,
        drivenTop: top.name,
        drivenWeight: Math.round(top.weight * 1000) / 1000,
        jawFraction: sample.jawFraction ?? 0,
        upperTeethN: sample.upperTeethN ?? 0,
        lowerTeethN: sample.lowerTeethN ?? 0,
        lipGapPx: sample.lipGapPx,
      },
    };
  });
  const bilabial = { pass: 0, fail: 0, fails: [] as { phone: string; startS: number; frame: number; upperTeethN: number; lowerTeethN: number }[] };
  const labiodental = { pass: 0, fail: 0, fails: [] as { phone: string; startS: number; frame: number; upperTeethN: number }[] };
  const mismatchByViseme: Record<string, { match: number; total: number }> = {};
  for (const row of phones) {
    if (!row.mid) continue;
    const expectedFull = row.expectedViseme === "sil" ? "viseme_sil" : `viseme_${row.expectedViseme}`;
    const key = row.expectedViseme;
    mismatchByViseme[key] ??= { match: 0, total: 0 };
    mismatchByViseme[key]!.total += 1;
    if (row.mid.drivenTop === expectedFull) mismatchByViseme[key]!.match += 1;
    if (row.phone === "P" || row.phone === "B" || row.phone === "M") {
      if (row.mid.upperTeethN === 0 && row.mid.lowerTeethN === 0) bilabial.pass += 1;
      else {
        bilabial.fail += 1;
        bilabial.fails.push({ phone: row.phone, startS: row.startS, frame: row.mid.frame, upperTeethN: row.mid.upperTeethN, lowerTeethN: row.mid.lowerTeethN });
      }
    }
    if (row.phone === "F" || row.phone === "V") {
      if (row.mid.upperTeethN > 0) labiodental.pass += 1;
      else {
        labiodental.fail += 1;
        labiodental.fails.push({ phone: row.phone, startS: row.startS, frame: row.mid.frame, upperTeethN: row.mid.upperTeethN });
      }
    }
  }
  return {
    schema: "openclinxr.viseme-eval-live-grok.v1",
    evaluatedView: "mouthFront",
    notes: [
      "Failing per-phone checks are results, not gate failures: no runtime tuning in this slice.",
      "Reference is MFA 3.4.2 alignment of the same cached Grok wav; frames are driven by the live STT-timed bake.",
    ],
    phoneCount: phones.length,
    phones,
    checks: { bilabial, labiodental, mismatchByViseme },
  };
}

type CaptureCanvas = { height:number; toDataURL(kind:string):string; getContext(kind:string):{RGBA:number;UNSIGNED_BYTE:number;readPixels(x:number,y:number,w:number,h:number,f:number,t:number,p:Uint8Array):void}|null };
type PageGlobal = { __speechTimeS:number;requestAnimationFrame(cb:()=>void):number;document:{getElementById(id:string):CaptureCanvas|null};__openClinXrIsolatedRenderFrame?:()=>void;__openClinXrSyncPreparedSpeech?:(timeS:number)=>void;__openClinXrIsolatedSceneRoot?:{userData?:{openClinXrNamedVisemeDrive?:{activeTargetName?:string;appliedMeshCount?:number;weights?:Record<string,number>;jawFraction?:number}}} };

async function recordFrames(page: Page, cues: TrackCue[], durationS: number, frameDir: string) {
  const frames=Math.max(2,Math.round(durationS*FPS)); mkdirSync(frameDir,{recursive:true});
  const samples:ToothSample[]=[]; const targets=new Set<string>();
  // Mouth-front sampler: same 240x180 window, re-centred, wide counting box
  // (identical numbers to the mouth-front path of mouth-dynamics-capture.ts).
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

async function captureClip(clip: GrokClip): Promise<void> {
  const def = GROK_CLIPS[clip];
  const OUT_DIR = path.join(REPO, "docs", "openclinxr", "mouth-dynamics", "live-grok", clip);
  mkdirSync(OUT_DIR, { recursive: true });
  const replay = loadReplayClip(clip);
  const jobDir = mkdtempSync(path.join(tmpdir(), `live-grok-${clip}-${process.pid}-`));
  try {
    const wav = path.join(jobDir, "speech.wav");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", replay.mp3Path, "-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", wav]);
    const durationS = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", wav], { encoding: "utf8" }).trim());
    const live = bakeLiveCues(jobDir, replay.sttWords, def.text, replay.pronunciations);
    const mfa = mfaArpabetCues(wav, def.transcript, def.mfaBasename);
    const wavBase64 = readFileSync(wav).toString("base64");
    const wavSha256 = execFileSync("shasum", ["-a", "256", wav], { encoding: "utf8" }).split(/\s/u)[0] ?? "";
    let server: PortlessDevServer | undefined;
    await createLocalComputeServices().sceneCapture.withBrowser(`live-grok:${clip}`, async (launched) => {
      try {
        server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180000, cwd: REPO });
        const page = await (launched as HeadlessBrowser).newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1 });
        page.setDefaultTimeout(180000);
        const runtimeDrive = browserDriveSource(def.text);
        const spec = { subjectId: "mpfb-peds-parent-aisha", subjectKind: "glb", bodyGlb: "/generated-humanoids/mpfb-peds-parent-aisha.glb", focus: "mouth", view: "front", label: `live grok ${clip}` };
        await page.goto(`${server.url}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`, { waitUntil: "domcontentloaded", timeout: 240000 });
        await page.waitForFunction("window.__openClinXrIsolatedSubjectEvidence != null || window.__openClinXrVisemeApplierError != null", null, { timeout: 180000 });
        const error = await page.evaluate("window.__openClinXrVisemeApplierError || ''");
        if (error) throw new Error(String(error));
        await page.addScriptTag({ content: runtimeDrive.drive });
        await page.addScriptTag({ content: runtimeDrive.split });
        const prepared = await page.evaluate((input: { aligner: string; doc: unknown; wavBase64: string }) => {
          const win = globalThis as typeof globalThis & { __speechRhubarb?: unknown; __speechAligner?: string; __speechWavBase64?: string; __openClinXrStartPreparedSpeech?: () => TrackCue[] };
          win.__speechRhubarb = input.doc; win.__speechAligner = input.aligner; win.__speechWavBase64 = input.wavBase64;
          return { starter: typeof win.__openClinXrStartPreparedSpeech, cues: win.__openClinXrStartPreparedSpeech?.() ?? [] };
        }, { aligner: "live", doc: live.cues, wavBase64 });
        const cues = prepared.cues as TrackCue[];
        if (!cues.length) throw new Error(`prepared-runtime-cues-missing:${prepared.starter}`);
        const frameDir = path.join(jobDir, "frames");
        const result = await recordFrames(page, cues, durationS, frameDir);
        const clipMp4 = path.join(OUT_DIR, "clip.mp4");
        execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-start_number", "0", "-i", path.join(frameDir, "f-%04d.png"), "-i", wav, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-shortest", clipMp4]);
        writeFileSync(path.join(OUT_DIR, "metrics.json"), `${JSON.stringify({
          schemaVersion: "openclinxr.mouth-dynamics.v1",
          mode: `live-grok/${clip}`,
          clip,
          line: def.text,
          aligner: "live-grok",
          view: "mouth-front",
          cueSource: "xr-dialogue live-stt plan over cached Grok audio + STT words (replay, no network)",
          gateway: "grok-voice:replay",
          cacheKey: replay.cacheKey,
          audioSha256: replay.audioSha256,
          audioDurationS: durationS,
          frameRate: FPS,
          frameCount: result.frames,
          wavSha256,
          timing: "live STT-timed ARPABET bake (duration-weighted split, audio-onset snap, closure-gap P) mapped by the xr-dialogue arpabet intake before prepared runtime playback",
          dynamics: "legacy 0.06 s smoothstep transition on lips and jaw",
          canonicalTrack: cues,
          liveArpabet: live.cues,
          mfa,
          targetsSeen: result.targets,
          toothCentroidSteps: result.teeth,
          toothSamples: result.samples,
          visemeEval: scoreAgainstMfa(mfa, result.samples),
        }, null, 2)}\n`);
        await page.close();
      } finally {
        if (server) await stopPortlessDevServer(server.proc);
      }
    });
  } finally {
    rmSync(jobDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  requireFlags();
  for (const clip of requestedClips()) {
    await captureClip(clip);
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
