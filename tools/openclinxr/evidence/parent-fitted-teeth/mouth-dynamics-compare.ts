/** Build labelled control/step3 comparison media and an apples-to-apples metrics table. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Sample = { n: number; cx: number; cy: number };
type Cue = { startS: number; endS: number; viseme: string };
type Metrics = { toothSamples: Sample[]; canonicalTrack?: Cue[]; toothCentroidSteps?: { ppCheck?: unknown } };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const ROOT = path.join(REPO, "docs/openclinxr/mouth-dynamics");
const CONTROL = path.join(ROOT, "control/clip.mp4");
const STEP3 = path.join(ROOT, "step3/clip.mp4");
const FPS = 30;
const WIDTH = 1280;
const HEIGHT = 960;

const FONT: Readonly<Record<string, string[]>> = {
  " ": ["000", "000", "000", "000", "000", "000", "000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
};

function labelPpm(file: string, text: string): void {
  const height = 54; const scale = 5; const gap = 2; const pixels = Buffer.alloc(WIDTH * height * 3, 10);
  let cursor = 18;
  for (const char of text.toUpperCase()) {
    const glyph = FONT[char] ?? FONT[" "] ?? []; const glyphWidth = glyph[0]?.length ?? 3;
    for (let gy = 0; gy < glyph.length; gy += 1) for (let gx = 0; gx < glyphWidth; gx += 1) {
      if (glyph[gy]?.[gx] !== "1") continue;
      for (let sy = 0; sy < scale; sy += 1) for (let sx = 0; sx < scale; sx += 1) {
        const x = cursor + gx * scale + sx; const y = 9 + gy * scale + sy; const offset = (y * WIDTH + x) * 3;
        pixels[offset] = 245; pixels[offset + 1] = 245; pixels[offset + 2] = 245;
      }
    }
    cursor += glyphWidth * scale + gap * scale;
  }
  writeFileSync(file, Buffer.concat([Buffer.from(`P6\n${WIDTH} ${height}\n255\n`), pixels]));
}

function runFfmpeg(args: string[]): void {
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
}

function labelledComparison(job: string): void {
  const controlLabel = path.join(job, "control.ppm"); const stepLabel = path.join(job, "step3.ppm");
  labelPpm(controlLabel, "CONTROL"); labelPpm(stepLabel, "STEP 3");
  runFfmpeg(["-i", CONTROL, "-i", STEP3, "-loop", "1", "-framerate", "30", "-i", controlLabel,
    "-loop", "1", "-framerate", "30", "-i", stepLabel,
    "-filter_complex", "[0:v][2:v]overlay=0:0:shortest=1[c];[1:v][3:v]overlay=0:0:shortest=1[s];[c][s]hstack=inputs=2[v]",
    "-map", "[v]", "-map", "1:a:0", "-frames:v", "123", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy",
    "-movflags", "+faststart", path.join(ROOT, "compare-side-by-side.mp4")]);
}

function labelledStill(input: string, frame: number, label: string, output: string, job: string): void {
  const raw = path.join(job, `${path.basename(output)}-raw.png`); const ppm = path.join(job, `${path.basename(output)}.ppm`);
  runFfmpeg(["-i", input, "-vf", `select=eq(n\\,${frame})`, "-frames:v", "1", raw]);
  labelPpm(ppm, label);
  runFfmpeg(["-i", raw, "-i", ppm, "-filter_complex", "[0:v][1:v]overlay=0:0", "-frames:v", "1", output]);
}

function stillSheet(job: string, track: readonly Cue[]): void {
  const order = ["aa", "E", "O", "PP", "FF"];
  const control: string[] = []; const step3: string[] = [];
  for (const viseme of order) {
    const cue = track.find((row) => row.viseme === viseme);
    if (!cue) throw new Error(`missing comparison cue:${viseme}`);
    const frame = Math.round(((cue.startS + cue.endS) / 2) * FPS);
    const c = path.join(job, `control-${viseme}.png`); const s = path.join(job, `step3-${viseme}.png`);
    labelledStill(CONTROL, frame, `CONTROL ${viseme} FRAME ${frame}`, c, job);
    labelledStill(STEP3, frame, `STEP 3 ${viseme} FRAME ${frame}`, s, job);
    control.push(c); step3.push(s);
  }
  const args = [...control.flatMap((file) => ["-i", file]), ...step3.flatMap((file) => ["-i", file])];
  args.push("-filter_complex", "[0][1][2][3][4]hstack=inputs=5[top];[5][6][7][8][9]hstack=inputs=5[bottom];[top][bottom]vstack=inputs=2[out]",
    "-map", "[out]", "-frames:v", "1", path.join(ROOT, "stills-aa-E-O-PP-FF.png"));
  runFfmpeg(args);
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (!sorted.length) return 0; const at = (sorted.length - 1) * fraction; const lo = Math.floor(at); const hi = Math.ceil(at);
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? sorted[lo] ?? 0) - (sorted[lo] ?? 0)) * (at - lo);
}

function motion(samples: readonly Sample[], track: readonly Cue[]) {
  const steps: Array<{ frame: number; px: number; dy: number }> = [];
  for (let frame = 1; frame < samples.length; frame += 1) {
    const a = samples[frame - 1]; const b = samples[frame]; if (!a || !b || a.n < 1 || b.n < 1) continue;
    steps.push({ frame, px: Math.hypot(b.cx - a.cx, b.cy - a.cy), dy: b.cy - a.cy });
  }
  let reversals = 0; let previous: typeof steps[number] | undefined;
  for (const step of steps) {
    const cue = track.find((row) => step.frame / FPS >= row.startS && step.frame / FPS < row.endS);
    if (Math.abs(step.dy) >= 3 && previous && step.frame - previous.frame <= 3 && Math.sign(step.dy) !== Math.sign(previous.dy) && cue?.viseme !== "PP") reversals += 1;
    if (Math.abs(step.dy) >= 3) previous = step;
  }
  const values = steps.map((row) => row.px).sort((a, b) => a - b);
  return { medianPx: percentile(values, 0.5), p90Px: percentile(values, 0.9), maxPx: Math.max(0, ...values), countOver3Px: values.filter((value) => value > 3).length, directionReversalsWithin100Ms: reversals };
}

function ppVideoCheck(clip: string, ppCue: Cue) {
  const frames = Array.from({ length: Math.ceil(ppCue.endS * FPS) - Math.ceil(ppCue.startS * FPS) }, (_, index) => Math.ceil(ppCue.startS * FPS) + index);
  const select = frames.map((frame) => `eq(n\\,${frame})`).join("+");
  const rgb = execFileSync("ffmpeg", ["-v", "error", "-i", clip, "-vf", `select=${select}`, "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { maxBuffer: 32 * 1024 * 1024 });
  const frameBytes = WIDTH * HEIGHT * 3; let maxGap = 0; let maxTeeth = 0;
  for (let image = 0; image < frames.length; image += 1) {
    let teeth = 0;
    for (let x = 540; x <= 600; x += 1) { let run = 0; for (let y = 585; y <= 615; y += 1) {
      const at = image * frameBytes + (y * WIDTH + x) * 3; const r = rgb[at] ?? 0; const g = rgb[at + 1] ?? 0; const b = rgb[at + 2] ?? 0; const mean = (r + g + b) / 3;
      if (mean < 70) { run += 1; maxGap = Math.max(maxGap, run); } else run = 0;
      if (mean > 148 && Math.abs(r - g) < 16 && Math.abs(g - b) < 16 && r > 140 && r < 220) teeth += 1;
    } }
    maxTeeth = Math.max(maxTeeth, teeth);
  }
  return { frameCount: frames.length, maxLipGapPx: maxGap, maxTeethCandidatePixels: maxTeeth, measurement: "decoded-video RGB in canonical PP window; mouth ROI x=540..600 y=585..615" };
}

function main(): void {
  const job = mkdtempSync(path.join(tmpdir(), `mouth-compare-${process.pid}-`));
  try {
    const control = JSON.parse(readFileSync(path.join(ROOT, "control/metrics.json"), "utf8")) as Metrics;
    const step2 = JSON.parse(readFileSync(path.join(ROOT, "step2/metrics.json"), "utf8")) as Metrics;
    const step3 = JSON.parse(readFileSync(path.join(ROOT, "step3/metrics.json"), "utf8")) as Metrics;
    const track = step3.canonicalTrack ?? []; const ppCue = track.find((cue) => cue.viseme === "PP"); if (!ppCue) throw new Error("PP cue missing");
    labelledComparison(job); stillSheet(job, track);
    const rows = [
      { mode: "control", ...motion(control.toothSamples, track), ppCheck: ppVideoCheck(CONTROL, ppCue) },
      { mode: "step2", ...motion(step2.toothSamples, track), ppCheck: ppVideoCheck(path.join(ROOT, "step2/clip.mp4"), ppCue) },
      { mode: "step3", ...motion(step3.toothSamples, track), ppCheck: ppVideoCheck(STEP3, ppCue) },
    ];
    writeFileSync(path.join(ROOT, "comparison-metrics.json"), `${JSON.stringify({ schemaVersion: "openclinxr.mouth-dynamics-comparison.v1", frameRate: FPS,
      reversalDefinition: "successive salient tooth-centroid dy steps >=3 px with opposite signs, <=3 frames apart; PP cue excluded", rows }, null, 2)}\n`);
  } finally { rmSync(job, { recursive: true, force: true }); }
}

main();
