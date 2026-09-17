// Measure blinks on the ENCODED video vs the source PNG frames.
// Run: node measure-blinks.mjs --out <render out dir> --video <video.mp4 or .webm>
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name) => {
    const at = args.indexOf(name);
    return at >= 0 && args[at + 1] ? args[at + 1] : undefined;
  };
  const out = get("--out");
  const video = get("--video");
  if (!out || !video) throw new Error("usage: measure-blinks.mjs --out <dir> --video <file>");
  return { out, video };
}

const { out, video } = parseArgs();
const state = JSON.parse(readFileSync(join(out, "state.json"), "utf8"));
const blinkDoc = JSON.parse(readFileSync(join(out, "blinks.json"), "utf8"));
const { fps, frames } = state;
const eyeBoxByFrame = new Map((frames ?? []).map((r) => [r.frameIndex, r.eyeBox]));

function cropForFrame(frameIndex) {
  const box = eyeBoxByFrame.get(frameIndex);
  if (!box) throw new Error(`frame ${frameIndex} has no eyeBox; re-run render.mjs`);
  return `crop=${box.x1 - box.x0}:${box.y1 - box.y0}:${box.x0}:${box.y0}`;
}

const cropDir = join(out, "blink-crops");
mkdirSync(cropDir, { recursive: true });

function rawPixels(args) {
  const cmd = execFileSync("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 });
  return cmd;
}

// Frame-accurate seek: seek to the exact frame time + half a frame, extract one frame.
// Each frame is cropped with THAT frame's own eyeBox from state.json.
function extractFromVideo(frameIndex) {
  const seconds = (frameIndex / fps + 0.5 / fps).toFixed(4);
  return rawPixels(["-v", "error", "-ss", seconds, "-i", video,
    "-frames:v", "1", "-vf", cropForFrame(frameIndex), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
}

// Source PNG via ffmpeg decode (same path for both, no new deps).
function extractFromPng(frameIndex) {
  const png = join(out, "frames", `${String(frameIndex).padStart(5, "0")}.png`);
  return rawPixels(["-v", "error", "-i", png,
    "-vf", cropForFrame(frameIndex), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
}

function fractions(buf) {
  const n = buf.length / 3;
  let sclera = 0;
  let dark = 0;
  let iris = 0;
  for (let i = 0; i < buf.length; i += 3) {
    const r = buf[i];
    const g = buf[i + 1];
    const b = buf[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (lum > 170 && spread < 40) sclera += 1;
    if (lum < 60) dark += 1;
    if (b > r + 25 && b > g + 5 && b > 60) iris += 1;
  }
  return {
    scleraFraction: Number((sclera / n).toFixed(4)),
    darkFraction: Number((dark / n).toFixed(4)),
    irisFraction: Number((iris / n).toFixed(4)),
  };
}

function saveCropPng(sourceArgs, crop, dest) {
  execFileSync("ffmpeg", ["-y", "-v", "error", ...sourceArgs, "-vf", `${crop},scale=iw*1:ih*1`, dest]);
}

function irisDrops(measured) {
  return Number((measured.open.irisFraction - measured.closed.irisFraction).toFixed(4));
}

// A confirmed blink: the open eye shows measurable blue iris and the closed eye
// shows at most a quarter of it.
function isConfirmedBlink(measured) {
  return measured.open.irisFraction >= 0.01 && measured.closed.irisFraction <= 0.25 * measured.open.irisFraction;
}

const pairs = [];
for (const blink of blinkDoc.blinks ?? []) {
  if (blink.shot !== "closeup") continue;
  if ((blink.peakClosure ?? 0) < 0.8) continue;
  if (blink.referenceFrameIndex === null || blink.referenceFrameIndex === undefined) continue;
  const peak = blink.peakFrameIndex;
  const open = blink.referenceFrameIndex;
  const label = `${blink.peakTimeMs}ms`;

  const closedRaw = extractFromVideo(peak);
  const openRaw = extractFromVideo(open);
  const closed = fractions(closedRaw);
  const openM = fractions(openRaw);

  const closedSrc = fractions(extractFromPng(peak));
  const openSrc = fractions(extractFromPng(open));

  const peakSec = (peak / fps + 0.5 / fps).toFixed(4);
  const openSec = (open / fps + 0.5 / fps).toFixed(4);
  // Default behaviour: overwrite blink-crops/*.png with this run's crops.
  saveCropPng(["-ss", openSec, "-i", video, "-frames:v", "1"], cropForFrame(open), join(cropDir, `${label}-open.png`));
  saveCropPng(["-ss", peakSec, "-i", video, "-frames:v", "1"], cropForFrame(peak), join(cropDir, `${label}-closed.png`));

  pairs.push({
    peakTimeMs: blink.peakTimeMs,
    peakFrameIndex: peak,
    openFrameIndex: open,
    encoded: {
      open: openM,
      closed,
      scleraDrop: Number((openM.scleraFraction - closed.scleraFraction).toFixed(4)),
      irisDrop: irisDrops({ open: openM, closed }),
      confirmed: isConfirmedBlink({ open: openM, closed }),
    },
    source: {
      open: openSrc,
      closed: closedSrc,
      scleraDrop: Number((openSrc.scleraFraction - closedSrc.scleraFraction).toFixed(4)),
      irisDrop: irisDrops({ open: openSrc, closed: closedSrc }),
      confirmed: isConfirmedBlink({ open: openSrc, closed: closedSrc }),
    },
  });
}

const summary = {
  pairs: pairs.length,
  encodedConfirmedPairs: pairs.filter((p) => p.encoded.confirmed).length,
  sourceConfirmedPairs: pairs.filter((p) => p.source.confirmed).length,
};
writeFileSync(join(out, "blink-measure.json"), JSON.stringify({ pairs, summary }, null, 1));
console.error(`DONE pairs=${pairs.length} encodedConfirmed=${summary.encodedConfirmedPairs} sourceConfirmed=${summary.sourceConfirmedPairs}`);
