/**
 * Record parent Aisha saying one line, mouth driven by the dialogue phoneme timeline.
 *
 * The timeline is the text's phoneme dwells stretched across the spoken audio.
 * Lips keep a 0.06 s blend at each phone edge. Jaw aperture and the teeth keys
 * follow the vowel centers, so a consonant does not shut the hinge or drop the tooth seat.
 * Run: pnpm exec tsx tools/openclinxr/evidence/parent-fitted-teeth/speech-sync-capture.ts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { phonemesForText } from "../../../../packages/openclinxr/xr-dialogue/src/dialogue-visemes.ts";
import { mapDialoguePhonemesToCues } from "../../../../packages/openclinxr/xr-dialogue/src/viseme-runtime-wire.ts";
import { chromium, type Page } from "../lib/slotted-playwright.js";
import { spawnPortlessDevServer, stopPortlessDevServer, type PortlessDevServer } from "../lib/portless-server.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const GLB_URL = "/generated-humanoids/mpfb-peds-parent-aisha.glb";
const OUT_DIR = path.join(HERE, "visemes");
const LINE = "I feel the pain is better now.";
const VIEW_W = 1280;
const VIEW_H = 960;
const RATE_WPM = 100;
const WORD_COUNT = LINE.match(/[A-Za-z']+/g)?.length ?? 0;

/** Browser and the preflight share this. Fractions match the product aperture table for vowels only. */
const VOWEL_ENVELOPE_JS = `
function smoothstep01(u) {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  return x * x * (3 - 2 * x);
}
function vowelSeat(phoneme) {
  const p = String(phoneme || "").trim().toLowerCase();
  const seats = {
    aa: ["viseme_aa", 1], ah: ["viseme_aa", 1], ae: ["viseme_aa", 1], ay: ["viseme_aa", 1], a: ["viseme_aa", 1],
    o: ["viseme_O", 0.85], oh: ["viseme_O", 0.85], ao: ["viseme_O", 0.85], ow: ["viseme_O", 0.85], oy: ["viseme_O", 0.85],
    e: ["viseme_E", 0.45], eh: ["viseme_E", 0.45], er: ["viseme_E", 0.45], ey: ["viseme_E", 0.45],
    i: ["viseme_I", 0.35], iy: ["viseme_I", 0.35], ih: ["viseme_I", 0.35],
    u: ["viseme_U", 0.4], uh: ["viseme_U", 0.4], uw: ["viseme_U", 0.4],
    ou: ["viseme_U", 0.5],
  };
  const row = seats[p];
  return row ? { teeth: row[0], fraction: row[1] } : null;
}
function vowelEnvelopeAt(cues, progress) {
  const durations = cues.map((cue) => cue.durationSeconds || 0);
  const bounds = [0];
  for (const duration of durations) bounds.push(bounds[bounds.length - 1] + duration);
  const total = bounds[bounds.length - 1] || 1;
  const t = Math.min(1, Math.max(0, progress)) * total;
  const vowels = [];
  for (let i = 0; i < cues.length; i += 1) {
    const seat = vowelSeat(cues[i].phoneme);
    if (!seat) continue;
    vowels.push({ teeth: seat.teeth, fraction: seat.fraction, center: (bounds[i] + bounds[i + 1]) / 2 });
  }
  if (vowels.length === 0) return { fraction: 0, teeth: [] };
  const first = vowels[0];
  const last = vowels[vowels.length - 1];
  if (t <= first.center) return { fraction: first.fraction, teeth: [{ name: first.teeth, weight: 1 }] };
  if (t >= last.center) {
    const span = total - last.center;
    const s = smoothstep01(span > 1e-6 ? (t - last.center) / span : 1);
    return { fraction: last.fraction * (1 - s), teeth: [{ name: last.teeth, weight: 1 - s }] };
  }
  let left = first;
  let right = last;
  for (let i = 0; i < vowels.length - 1; i += 1) {
    if (t >= vowels[i].center && t <= vowels[i + 1].center) {
      left = vowels[i];
      right = vowels[i + 1];
      break;
    }
  }
  const span = right.center - left.center;
  const s = smoothstep01(span > 1e-6 ? (t - left.center) / span : 1);
  const fraction = left.fraction + (right.fraction - left.fraction) * s;
  if (left.teeth === right.teeth) return { fraction, teeth: [{ name: left.teeth, weight: 1 }] };
  return { fraction, teeth: [{ name: left.teeth, weight: 1 - s }, { name: right.teeth, weight: s }] };
}
function vowelEnvelopeProbe(cues) {
  const durations = cues.map((cue) => cue.durationSeconds || 0);
  const bounds = [0];
  for (const duration of durations) bounds.push(bounds[bounds.length - 1] + duration);
  const total = bounds[bounds.length - 1] || 1;
  let lastCenter = 0;
  for (let i = 0; i < cues.length; i += 1) {
    if (vowelSeat(cues[i].phoneme)) lastCenter = (bounds[i] + bounds[i + 1]) / 2;
  }
  const rows = [];
  for (let i = 0; i < cues.length; i += 1) {
    const seat = vowelSeat(cues[i].phoneme);
    const center = (bounds[i] + bounds[i + 1]) / 2;
    const env = vowelEnvelopeAt(cues, center / total);
    const weightSum = env.teeth.reduce((sum, row) => sum + (row.weight || 0), 0);
    rows.push({
      phoneme: cues[i].phoneme,
      vowel: Boolean(seat),
      beforeTail: center <= lastCenter + 1e-9,
      fraction: env.fraction,
      weightSum,
      teeth: env.teeth.map((row) => row.name + ":" + row.weight.toFixed(3)).join("+"),
    });
  }
  let minBeforeTail = 1;
  for (let s = 0; s <= 400; s += 1) {
    const t = (s / 400) * total;
    if (t > lastCenter) break;
    const env = vowelEnvelopeAt(cues, t / total);
    if (env.fraction < minBeforeTail) minBeforeTail = env.fraction;
  }
  const end = vowelEnvelopeAt(cues, 1);
  return { rows, minBeforeTail, endFraction: end.fraction, lastCenterProgress: lastCenter / total };
}
`;

type EnvelopeProbe = {
  rows: Array<{ phoneme: string; vowel: boolean; beforeTail: boolean; fraction: number; weightSum: number; teeth: string }>;
  minBeforeTail: number;
  endFraction: number;
  lastCenterProgress: number;
};

function vowelEnvelopeProbe(phonemes: readonly string[]): EnvelopeProbe {
  const cues = mapDialoguePhonemesToCues(phonemes);
  const probe = new Function(`${VOWEL_ENVELOPE_JS}\nreturn vowelEnvelopeProbe;`)() as (rows: typeof cues) => EnvelopeProbe;
  return probe(cues);
}

function assertVowelEnvelope(phonemes: readonly string[]): EnvelopeProbe {
  const report = vowelEnvelopeProbe(phonemes);
  const start = report.rows[0];
  if (!start || Math.abs(start.fraction - 1) > 1e-6 || !start.teeth.startsWith("viseme_aa:1.000")) {
    throw new Error(`speech does not start on the AA seat: ${JSON.stringify(start)}`);
  }
  if (report.minBeforeTail < 0.34) {
    throw new Error(`jaw fraction fell to ${report.minBeforeTail} before the last vowel`);
  }
  if (report.endFraction > 0.02) {
    throw new Error(`trailing silence left the jaw at ${report.endFraction}`);
  }
  const openConsonant = report.rows.some((row, index) => (
    index < report.rows.length - 1 && !row.vowel && row.beforeTail && row.fraction > 0.5 && row.weightSum > 0.98
  ));
  if (!openConsonant) {
    throw new Error(`no consonant kept the jaw open and the teeth seated: ${JSON.stringify(report.rows)}`);
  }
  for (const row of report.rows) {
    process.stderr.write(`envelope ${row.phoneme} fraction ${row.fraction.toFixed(3)} teeth ${row.teeth || "(rest)"}\n`);
  }
  return report;
}

function esbuildBin(): string {
  const root = path.join(REPO, "node_modules/.pnpm");
  const dir = readdirSync(root).find((name) => name.startsWith("esbuild@"));
  if (!dir) throw new Error("esbuild is not installed");
  return path.join(root, dir, "node_modules/esbuild/bin/esbuild");
}

function applierSource(): string {
  const outfile = path.join(tmpdir(), `parent-speech-drive-${process.pid}.js`);
  const resolver = path.join(REPO, "packages/openclinxr/asset-registry/src/morph-target-resolver.ts");
  execFileSync(esbuildBin(), [
    path.join(REPO, "packages/openclinxr/xr-dialogue/src/viseme-runtime-wire.ts"),
    "--bundle",
    "--format=iife",
    "--global-name=OpenClinXrVisemeDrive",
    "--platform=browser",
    `--alias:@openclinxr/asset-registry=${resolver}`,
    `--outfile=${outfile}`,
  ], { stdio: "inherit" });
  const bundled = readFileSync(outfile, "utf8");
  return `${bundled}
${VOWEL_ENVELOPE_JS}
function applyTeethEnvelope(root, teeth, gain) {
  root.traverse((object) => {
    const meshName = typeof object.name === "string" ? object.name.toLowerCase() : "";
    if (!meshName.includes("teeth")) return;
    const dict = object.morphTargetDictionary;
    const influences = object.morphTargetInfluences;
    if (!dict || !influences) return;
    for (const key of Object.keys(dict)) {
      if (String(key).toLowerCase().startsWith("viseme_")) influences[dict[key]] = 0;
    }
    for (const row of teeth) {
      const want = String(row.name || "").toLowerCase();
      const weight = (row.weight || 0) * gain;
      for (const key of Object.keys(dict)) {
        if (String(key).toLowerCase() === want) influences[dict[key]] = weight;
      }
    }
  });
}
function applyBlendedSpeech(drive, root, phonemes, progress) {
  const cues = drive.mapDialoguePhonemesToCues(phonemes);
  const durations = cues.map((cue) => cue.durationSeconds || 0);
  const bounds = [0];
  for (const duration of durations) bounds.push(bounds[bounds.length - 1] + duration);
  const total = bounds[bounds.length - 1] || 1;
  const t = Math.min(1, Math.max(0, progress)) * total;
  let index = cues.length - 1;
  for (let i = 0; i < cues.length; i += 1) {
    if (t < bounds[i + 1]) { index = i; break; }
  }
  const distL = t - bounds[index];
  const distR = bounds[index + 1] - t;
  const windowS = 0.06;
  let other = index;
  let towardCurrent = 1;
  if (index > 0 && distL < windowS && distL <= distR) {
    other = index - 1;
    const u = distL / windowS;
    towardCurrent = u * u * (3 - 2 * u);
  } else if (index < cues.length - 1 && distR < windowS) {
    other = index + 1;
    const u = distR / windowS;
    towardCurrent = u * u * (3 - 2 * u);
  }
  const progressAt = (cueIndex) => ((bounds[cueIndex] + bounds[cueIndex + 1]) / 2) / total;
  const pose = (cueIndex) => {
    drive.applyDialogueVisemeTimelineToRoot(root, { phonemeSequence: phonemes, progress: progressAt(cueIndex) });
    const meshes = [];
    root.traverse((object) => {
      if (object && object.morphTargetInfluences && object.morphTargetInfluences.length) {
        meshes.push({ object, influences: object.morphTargetInfluences.slice() });
      }
    });
    return { meshes };
  };
  if (other === index) {
    pose(index);
  } else {
    const current = pose(index);
    const neighbor = pose(other);
    const neighborByObject = new Map(neighbor.meshes.map((row) => [row.object, row.influences]));
    for (const row of current.meshes) {
      const from = neighborByObject.get(row.object);
      const influences = row.object.morphTargetInfluences;
      for (let i = 0; i < influences.length; i += 1) {
        const a = from ? from[i] || 0 : 0;
        const b = row.influences[i] || 0;
        influences[i] = a + (b - a) * towardCurrent;
      }
    }
  }
  if (drive.JAW_TEETH_GAIN !== 0.5) throw new Error("teeth gain is not 0.5");
  const envelope = vowelEnvelopeAt(cues, progress);
  applyTeethEnvelope(root, envelope.teeth, drive.JAW_TEETH_GAIN);
  const clear = Math.asin(0.020725011825561523 / 0.137901);
  drive.applyJawOpenToRoot(root, envelope.fraction * clear * drive.JAW_TEETH_GAIN);
}
(() => {
  const drive = typeof OpenClinXrVisemeDrive !== "undefined" ? OpenClinXrVisemeDrive : globalThis.OpenClinXrVisemeDrive;
  globalThis.OpenClinXrVisemeDrive = drive;
  if (!drive || typeof drive.applyDialogueVisemeTimelineToRoot !== "function") {
    throw new Error("shipped viseme applier did not load");
  }
  const native = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (callback) {
    return native(function (time) {
      try {
        const root = window.__openClinXrIsolatedSceneRoot;
        if (root) {
          const progress = window.__speechProgress;
          const phonemes = window.__speechPhonemes;
          if (typeof progress === "number" && phonemes) {
            applyBlendedSpeech(drive, root, phonemes, progress);
          } else {
            drive.applyDialogueVisemeTimelineToRoot(root, { phonemeSequence: ["sil"], progress: 0 });
          }
        }
      } catch (error) {
        window.__openClinXrVisemeApplierError = String(error && error.stack || error);
      }
      return callback(time);
    });
  };
})();
`;
}

function aiffDurationMs(aiff: string): number {
  const info = execFileSync("afinfo", [aiff], { encoding: "utf8" });
  const match = info.match(/estimated duration:\s+([0-9.]+)\s+sec/);
  if (!match) throw new Error(`afinfo has no duration:\n${info}`);
  return Math.round(Number(match[1]) * 1000);
}

function speechFile(): { aiff: string; durationMs: number; say: string } {
  const aiff = path.join(OUT_DIR, "i-feel-the-pain-is-better-now.aiff");
  const targetMs = Math.round((WORD_COUNT / RATE_WPM) * 60_000);
  execFileSync("say", ["-v", "Samantha", "-r", String(RATE_WPM), "-o", aiff, LINE], { stdio: "inherit" });
  let durationMs = aiffDurationMs(aiff);
  let say = `say -v Samantha -r ${RATE_WPM}`;
  // Some voices ignore -r and stay near the default rate (~230 wpm on the last take).
  if (durationMs < targetMs * 0.75) {
    execFileSync("say", ["-v", "Samantha", "-o", aiff, `[[rate ${RATE_WPM}]] ${LINE}`], { stdio: "inherit" });
    durationMs = aiffDurationMs(aiff);
    say = `say -v Samantha [[rate ${RATE_WPM}]]`;
  }
  if (durationMs < targetMs * 0.75) {
    const slowed = `${aiff}.slow.aiff`;
    const factor = durationMs / targetMs;
    const filters = factor >= 0.5
      ? `atempo=${factor.toFixed(4)}`
      : `atempo=0.5,atempo=${(factor / 0.5).toFixed(4)}`;
    execFileSync("ffmpeg", ["-y", "-i", aiff, "-filter:a", filters, slowed], { stdio: "inherit" });
    rmSync(aiff);
    renameSync(slowed, aiff);
    durationMs = aiffDurationMs(aiff);
    say = `${say}; ffmpeg atempo to ${targetMs} ms`;
  }
  return { aiff, durationMs, say };
}

type ToothSample = { n: number; cx: number; cy: number; target: string };

type SpeechCaptureCanvas = {
  height: number;
  toDataURL(kind: string): string;
  getContext(kind: string): {
    RGBA: number;
    UNSIGNED_BYTE: number;
    readPixels(x: number, y: number, width: number, height: number, format: number, type: number, pixels: Uint8Array): void;
  } | null;
};

/** DOM names stay off this file. tools-relaxed typechecks it with node types only. */
type SpeechPageGlobal = {
  __speechPhonemes: string[];
  __speechProgress: number;
  requestAnimationFrame(cb: () => void): number;
  document: { getElementById(id: string): SpeechCaptureCanvas | null };
  __openClinXrIsolatedRenderFrame?: () => void;
  __openClinXrIsolatedSceneRoot?: {
    userData?: {
      openClinXrNamedVisemeDrive?: { activeTargetName?: string; appliedMeshCount?: number };
    };
  };
};

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (index - lo);
}

function toothStepReport(samples: readonly ToothSample[]): {
  stepCount: number;
  median: number;
  p90: number;
  max: number;
  maxFrame: number;
  nMin: number;
  nMedian: number;
} {
  const steps: Array<{ frame: number; px: number }> = [];
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const curr = samples[i];
    if (!prev || !curr || prev.n < 1 || curr.n < 1) continue;
    const px = Math.hypot(curr.cx - prev.cx, curr.cy - prev.cy);
    steps.push({ frame: i, px });
  }
  const sorted = steps.map((step) => step.px).sort((a, b) => a - b);
  const counts = samples.map((sample) => sample.n).sort((a, b) => a - b);
  const worst = steps.reduce((best, step) => (step.px > best.px ? step : best), { frame: 0, px: 0 });
  return {
    stepCount: steps.length,
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    max: worst.px,
    maxFrame: worst.frame,
    nMin: counts[0] ?? 0,
    nMedian: percentile(counts, 0.5),
  };
}

async function recordFrames(page: Page, phonemes: string[], durationMs: number, frameDir: string): Promise<{ frames: number; targets: string[]; mouthSpan: number; teeth: ReturnType<typeof toothStepReport>; samples: ToothSample[] }> {
  const frames = Math.max(2, Math.round((durationMs / 1000) * 30));
  mkdirSync(frameDir, { recursive: true });
  await page.evaluate((phones: string[]) => {
    (globalThis as unknown as SpeechPageGlobal).__speechPhonemes = phones;
  }, phonemes);
  const targets = new Set<string>();
  const samples: ToothSample[] = [];
  let mouthMin = Number.POSITIVE_INFINITY;
  let mouthMax = 0;
  for (let i = 0; i < frames; i += 1) {
    const progress = i / (frames - 1);
    await page.evaluate((value: number) => {
      (globalThis as unknown as SpeechPageGlobal).__speechProgress = value;
    }, progress);
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("requestAnimationFrame stalled")), 2000);
      (globalThis as unknown as SpeechPageGlobal).requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      });
    }));
    const shot = await page.evaluate(() => {
      const win = globalThis as unknown as SpeechPageGlobal;
      if (typeof win.__openClinXrIsolatedRenderFrame !== "function") return { error: "render hook missing" };
      win.__openClinXrIsolatedRenderFrame();
      const canvas = win.document.getElementById("isolated-subject-capture-canvas");
      const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
      if (!canvas || !gl) return { error: "canvas missing" };
      const x = 500;
      const width = 240;
      const height = 180;
      const y = canvas.height - 710;
      const buf = new Uint8Array(width * height * 4);
      gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let sum = 0;
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (let p = 0, pixel = 0; p < buf.length; p += 4, pixel += 1) {
        const r = buf[p] ?? 0;
        const g = buf[p + 1] ?? 0;
        const b = buf[p + 2] ?? 0;
        sum += r;
        const mean = (r + g + b) / 3;
        if (mean > 148 && Math.abs(r - g) < 16 && Math.abs(g - b) < 16 && r > 140 && r < 220) {
          n += 1;
          sx += pixel % width;
          sy += height - 1 - Math.floor(pixel / width);
        }
      }
      const drive = win.__openClinXrIsolatedSceneRoot?.userData?.openClinXrNamedVisemeDrive;
      const target = !drive || (drive.appliedMeshCount ?? 0) < 1 ? "" : (drive.activeTargetName ?? "sil");
      return { sum, target, n, cx: n ? sx / n : 0, cy: n ? sy / n : 0, png: canvas.toDataURL("image/png") };
    });
    if ("error" in shot && shot.error) throw new Error(`frame ${i}: ${shot.error}`);
    if (!shot.target) throw new Error(`frame ${i} did not drive a viseme mesh`);
    if (shot.sum < mouthMin) mouthMin = shot.sum;
    if (shot.sum > mouthMax) mouthMax = shot.sum;
    targets.add(shot.target);
    samples.push({ n: shot.n ?? 0, cx: shot.cx ?? 0, cy: shot.cy ?? 0, target: shot.target });
    const comma = shot.png.indexOf(",");
    writeFileSync(path.join(frameDir, `f-${String(i).padStart(4, "0")}.png`), Buffer.from(shot.png.slice(comma + 1), "base64"));
    if (i % 15 === 0) process.stderr.write(`frame ${i}/${frames} ${shot.target} mouth ${shot.sum}\n`);
  }
  const teeth = toothStepReport(samples);
  process.stderr.write(`teeth steps median ${teeth.median.toFixed(2)} p90 ${teeth.p90.toFixed(2)} max ${teeth.max.toFixed(2)} frame ${teeth.maxFrame} nMin ${teeth.nMin} nMedian ${teeth.nMedian.toFixed(1)}\n`);
  return { frames, targets: [...targets], mouthSpan: mouthMax - mouthMin, teeth, samples };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const phonemes = phonemesForText(LINE);
  assertVowelEnvelope(phonemes);
  const speech = speechFile();
  process.stderr.write(`audio ${speech.durationMs} ms via ${speech.say}\nphonemes ${phonemes.join(" ")}\n`);
  const script = applierSource();
  let server: PortlessDevServer | undefined;
  const browser = await chromium.launch({ headless: true });
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
      cwd: REPO,
    });
    const page = await browser.newPage({ viewport: { width: VIEW_W, height: VIEW_H }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(180_000);
    await page.addInitScript(script);
    const spec = {
      subjectId: "mpfb-peds-parent-aisha",
      subjectKind: "glb",
      bodyGlb: GLB_URL,
      focus: "head",
      label: "parent fitted teeth speech",
    };
    await page.goto(
      `${server.url}isolated-subject.html?subject=${encodeURIComponent(JSON.stringify(spec))}`,
      { waitUntil: "domcontentloaded", timeout: 240_000 },
    );
    await page.waitForFunction(
      "window.__openClinXrIsolatedSubjectEvidence != null || window.__openClinXrVisemeApplierError != null",
      null,
      { timeout: 180_000 },
    );
    const driveError = await page.evaluate("window.__openClinXrVisemeApplierError || ''");
    if (driveError) throw new Error(String(driveError).slice(0, 2000));
    rmSync(path.join(OUT_DIR, "i-feel-the-pain-is-better-now.webm"), { force: true });
    const mp4Path = path.join(OUT_DIR, "i-feel-the-pain-is-better-now.mp4");
    rmSync(mp4Path, { force: true });
    const frameDir = "/tmp/teeth-hour/speech-frames";
    rmSync(frameDir, { recursive: true, force: true });
    const recorded = await recordFrames(page, phonemes, speech.durationMs, frameDir);
    if (recorded.targets.length < 2) {
      throw new Error(`mouth held one shape: ${recorded.targets.join(",") || "(none)"}`);
    }
    if (recorded.mouthSpan < 20_000) {
      throw new Error(`mouth crop stayed flat: span ${recorded.mouthSpan}`);
    }
    execFileSync("ffmpeg", [
      "-y",
      "-framerate", "30",
      "-start_number", "0",
      "-i", path.join(frameDir, "f-%04d.png"),
      "-i", speech.aiff,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-shortest",
      mp4Path,
    ], { stdio: "inherit" });
    rmSync(frameDir, { recursive: true, force: true });
    const probe = execFileSync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,codec_name",
      "-of", "json",
      mp4Path,
    ], { encoding: "utf8" });
    const parsed = JSON.parse(probe) as { streams?: Array<{ codec_type?: string }> };
    const codecs = (parsed.streams ?? []).map((stream) => stream.codec_type);
    if (!codecs.includes("video") || !codecs.includes("audio")) {
      throw new Error(`mp4 is missing a stream:\n${probe}`);
    }
    const measuredWpm = Math.round((WORD_COUNT / (speech.durationMs / 1000)) * 60);
    writeFileSync(path.join(OUT_DIR, "i-feel-the-pain-is-better-now.json"), `${JSON.stringify({
      line: LINE,
      voice: "Samantha",
      rateWpmRequested: RATE_WPM,
      measuredWpm,
      say: speech.say,
      phonemes,
      targetsSeen: recorded.targets,
      mouthCropSpan: recorded.mouthSpan,
      frameCount: recorded.frames,
      audioDurationMs: speech.durationMs,
      timing: "Phoneme dwells stretched across the audio. Not waveform-aligned timestamps.",
      jawTeeth: "Vowel-center envelope. Consonants do not reset the jaw or the teeth keys. Lips keep the 0.06 s phone blend.",
      toothCentroidSteps: recorded.teeth,
      toothSamples: recorded.samples,
      probe: parsed,
    }, null, 2)}\n`);
    process.stdout.write(`${mp4Path}\n${probe}\n`);
    await page.close();
  } finally {
    await browser.close().catch(() => undefined);
    if (server) await stopPortlessDevServer(server.proc);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
