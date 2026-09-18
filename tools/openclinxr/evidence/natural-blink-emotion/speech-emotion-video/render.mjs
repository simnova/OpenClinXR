// Render the speech/emotion/blink video: frame-accurate stepping of page.mjs.
// Run: node render.mjs --glb <abs path> --speech <bake-speech out dir> --out <dir>
//   [--width 1280 --height 720 --fps 30]
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../../../../..");

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name, def) => {
    const at = args.indexOf(name);
    return at >= 0 && args[at + 1] ? args[at + 1] : def;
  };
  const glb = get("--glb");
  const speech = get("--speech");
  const out = get("--out");
  if (!glb || !speech || !out) throw new Error("usage: render.mjs --glb <abs> --speech <dir> --out <dir>");
  return {
    glb: resolve(glb),
    speech: resolve(speech),
    out: resolve(out),
    width: Number(get("--width", "1280")),
    height: Number(get("--height", "720")),
    fps: Number(get("--fps", "30")),
  };
}

const opts = parseArgs();
const lines = JSON.parse(readFileSync(join(opts.speech, "speech-lines.json"), "utf8"));

const mime = (p) =>
  p.endsWith(".js") ? "text/javascript"
  : p.endsWith(".html") ? "text/html"
  : p.endsWith(".glb") ? "model/gltf-binary"
  : p.endsWith(".json") ? "application/json"
  : "application/octet-stream";

async function serve(jobTmp) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let file;
    if (url.pathname === "/") file = join(jobTmp, "index.html");
    else if (url.pathname === "/capture-page.js") file = join(jobTmp, "capture-page.js");
    else if (url.pathname === "/subject.glb") file = opts.glb;
    else if (url.pathname.startsWith("/lip-sync-cues/")) {
      file = join(opts.speech, url.pathname.slice(1));
    } else {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    if (!existsSync(file)) {
      console.error("404", url.pathname);
      res.writeHead(404);
      res.end("missing");
      return;
    }
    res.writeHead(200, { "content-type": mime(file), "cache-control": "no-store" });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) };
}

// Schedule from audio durations (ms), not hardcoded beyond the gaps.
const SILENCE_LEAD_MS = 3000;
const GAP_MS = 3500;
const POST_GAP_MS = 3000;
const WIDE_TAIL_MS = 7000;

const schedule = [];
{
  let t = 0;
  schedule.push({ type: "camera", startMs: 0, shot: "closeup" });
  t += SILENCE_LEAD_MS;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const durMs = Math.round(line.audioDurationSeconds * 1000);
    schedule.push({
      type: "speech",
      startMs: t,
      lineId: line.lineId,
      text: line.text,
      emotion: line.emotion,
      utteranceId: line.utteranceId,
      durationMs: durMs,
    });
    t += durMs + (i < lines.length - 1 ? GAP_MS : POST_GAP_MS);
  }
  const wideStart = t;
  schedule.push({ type: "camera", startMs: wideStart, shot: "wide" });
  t += WIDE_TAIL_MS;
  var totalMs = t;
}

const totalFrames = Math.ceil((totalMs / 1000) * opts.fps);

mkdirSync(opts.out, { recursive: true });
const framesDir = join(opts.out, "frames");
mkdirSync(framesDir, { recursive: true });

const jobTmp = join(opts.out, ".serve-tmp");
mkdirSync(jobTmp, { recursive: true });
execFileSync("pnpm", ["exec", "esbuild", join(here, "page.mjs"), "--bundle", "--format=esm",
  `--outfile=${join(jobTmp, "capture-page.js")}`, "--platform=browser"], { cwd: repo, stdio: "inherit" });
writeFileSync(join(jobTmp, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#18211d}</style></head><body><script type="module" src="/capture-page.js"></script></body></html>`);

const http = await serve(jobTmp);
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--use-gl=angle", "--enable-webgl",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});
const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height } });
page.setDefaultTimeout(180_000);
page.on("pageerror", (e) => console.error("pageerror", e.message));
await page.addInitScript(() => {
  window.__virtualNowMs = 0;
  performance.now = () => window.__virtualNowMs;
});
await page.goto(http.url, { waitUntil: "load" });
await page.waitForFunction(() => typeof window.__setup === "function");
const setup = await page.evaluate(
  ({ glbUrl, width, height, lines }) => window.__setup({ glbUrl, width, height, lines }),
  { glbUrl: "/subject.glb", width: opts.width, height: opts.height, lines },
);
console.error(`setup meshes=${setup.meshCount} closureMeshes=${setup.closureMeshCount} morphs=${setup.morphTargetNames.length}`);

const rows = [];
const eyeBoxes = {};
for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
  const row = await page.evaluate(
    ({ frameIndex, fps, events }) => window.__step({ frameIndex, fps, events }),
    { frameIndex, fps: opts.fps, events: schedule },
  );
  // Per-frame eye box: the head moves during the shot (idle posture + gaze
  // turns), so a once-per-shot box drifts onto hair/cheek. Stored on the row.
  const eye = await page.evaluate(() => window.__eyeBoxes());
  row.eyeBox = eye.union;
  rows.push(row);
  if (row.shot === "closeup" && !eyeBoxes.closeup) {
    eyeBoxes.closeup = eye;
  }
  if (row.shot === "wide" && !eyeBoxes.wide) {
    eyeBoxes.wide = eye;
  }
  const dataUrl = await page.evaluate(() => window.__frameDataUrl());
  const png = Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
  writeFileSync(join(framesDir, `${String(frameIndex).padStart(5, "0")}.png`), png);
  if (frameIndex % 60 === 0) console.error(`frame ${frameIndex}/${totalFrames}`);
}
await browser.close();
await http.close();

const glbSha256 = createHash("sha256").update(readFileSync(opts.glb)).digest("hex");
writeFileSync(join(opts.out, "state.json"), JSON.stringify({
  glb: opts.glb,
  glbSha256,
  width: opts.width,
  height: opts.height,
  fps: opts.fps,
  schedule,
  lines,
  eyeBoxes,
  frames: rows,
}, null, 1));

// Audio: one adelay per line at its start, amix, apad, trim to total.
{
  const inputs = [];
  const delays = [];
  for (let i = 0; i < lines.length; i += 1) {
    const ev = schedule.find((s) => s.type === "speech" && s.lineId === lines[i].lineId);
    const wav = join(opts.speech, lines[i].wavPath);
    inputs.push("-i", wav);
    delays.push(`[${i}:a]adelay=${ev.startMs}|${ev.startMs}[a${i}]`);
  }
  const mixInputs = delays.map((_, i) => `[a${i}]`).join("");
  const totalSec = (totalMs / 1000).toFixed(3);
  execFileSync("ffmpeg", ["-y", ...inputs, "-filter_complex",
    `${delays.join(";")};${mixInputs}amix=inputs=${lines.length}:normalize=0,apad,atrim=0:${totalSec}[mix]`,
    "-map", "[mix]", "-ar", "22050", "-ac", "1", join(opts.out, "audio.wav")],
    { stdio: "inherit" });
}

// Encode both from the same PNG sequence.
function fileSizeBytes(p) {
  return Number(execFileSync("stat", ["-f", "%z", p]).toString().trim());
}
function encodeWebm(bitrateK, crfUnused) {
  execFileSync("ffmpeg", ["-y", "-framerate", String(opts.fps), "-i", join(framesDir, "%05d.png"),
    "-i", join(opts.out, "audio.wav"),
    "-c:v", "libvpx-vp9", "-b:v", `${bitrateK}k`, "-row-mt", "1", "-deadline", "good", "-cpu-used", "2",
    "-pix_fmt", "yuv420p", "-c:a", "libopus", "-b:a", "64k",
    "-shortest", join(opts.out, "video.webm")], { stdio: "inherit" });
}
function encodeMp4(crf) {
  execFileSync("ffmpeg", ["-y", "-framerate", String(opts.fps), "-i", join(framesDir, "%05d.png"),
    "-i", join(opts.out, "audio.wav"),
    "-c:v", "libx264", "-crf", String(crf), "-preset", "slow", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", "-c:a", "aac", "-b:a", "96k",
    "-shortest", join(opts.out, "video.mp4")], { stdio: "inherit" });
}
const EIGHT_MB = 8 * 1024 * 1024;
encodeWebm(1400);
if (fileSizeBytes(join(opts.out, "video.webm")) > EIGHT_MB) {
  console.error("video.webm exceeds 8 MB; re-encoding at 0.7x bitrate");
  encodeWebm(Math.round(1400 * 0.7));
}
encodeMp4(18);
if (fileSizeBytes(join(opts.out, "video.mp4")) > EIGHT_MB) {
  console.error("video.mp4 exceeds 8 MB; re-encoding at crf 21");
  encodeMp4(21);
}

// Poster: closeup frame at L1 midpoint.
{
  const l1 = schedule.find((s) => s.type === "speech" && s.lineId === "L1");
  const midFrame = Math.floor(((l1.startMs + l1.durationMs / 2) / 1000) * opts.fps);
  copyFileSync(join(framesDir, `${String(midFrame).padStart(5, "0")}.png`), join(opts.out, "poster.png"));
}

// Blinks from animation state: maximal runs with min(left,right) >= 0.5.
const blinks = [];
{
  let run = null;
  const closeupStart = 0;
  const closeupEnd = schedule.find((s) => s.type === "camera" && s.shot === "wide").startMs;
  for (const row of rows) {
    const closure = Math.min(row.leftClosure, row.rightClosure);
    if (closure >= 0.5) {
      if (!run) run = { start: row, peak: row };
      else if (closure > Math.min(run.peak.leftClosure, run.peak.rightClosure)) run.peak = row;
    } else if (run) {
      // Reference open frame: latest frame >= 300 ms before run start with closure < 0.05.
      const openRef = [...rows].reverse().find((r) =>
        r.frameIndex < run.start.frameIndex && r.tMs <= run.start.tMs - 300 &&
        Math.min(r.leftClosure, r.rightClosure) < 0.05);
      const peakClosure = Math.min(run.peak.leftClosure, run.peak.rightClosure);
      blinks.push({
        peakFrameIndex: run.peak.frameIndex,
        peakTimeMs: run.peak.tMs,
        peakClosure: Number(peakClosure.toFixed(3)),
        shot: run.peak.shot,
        duringSpeech: run.peak.speakingLineId !== null,
        referenceFrameIndex: openRef?.frameIndex ?? null,
      });
      run = null;
    }
  }
  const closeupSec = (closeupEnd - closeupStart) / 1000;
  const closeupBlinks = blinks.filter((b) => b.shot === "closeup").length;
  var blinkRate = closeupSec > 0 ? (closeupBlinks / closeupSec) * 60 : 0;
}
writeFileSync(join(opts.out, "blinks.json"), JSON.stringify({
  blinks,
  blinkRatePerMinuteCloseup: Number(blinkRate.toFixed(2)),
}, null, 1));
console.error(`DONE frames=${totalFrames} blinks=${blinks.length} rate=${blinkRate.toFixed(1)}/min -> ${opts.out}`);
