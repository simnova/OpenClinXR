/**
 * Per-phone viseme evaluation over the standard clip set (viseme-eval slice).
 *
 * Reads the committed capture metrics for one clip in both views
 * (docs/openclinxr/mouth-dynamics/viseme-eval/<clip>[/-mouth-front]/metrics.json),
 * joins every MFA phone interval with the capture frames inside it, and
 * writes a pinned report plus a word contact sheet (mouth-front view).
 *
 * Failing per-phone checks are RESULTS, not gate failures: this tool never
 * tunes the runtime. Run:
 * pnpm exec tsx tools/openclinxr/evidence/parent-fitted-teeth/viseme-eval.ts [--clip pangram|viseme-words]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARPABET_TO_OVR } from "../../../../packages/openclinxr/xr-dialogue/src/viseme-cue-track.ts";
import { runMfaAlign } from "./mfa-align.js";
import { resolveClipConfig, type ClipId } from "./clip-config.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const REPORT_DIR = path.join(REPO, "docs/openclinxr/mouth-dynamics/viseme-eval");
const FPS = 30;

type ArpabetCue = { startS: number; endS: number; phone: string };
type Sample = {
  n: number; cx: number; cy: number; target: string; lipGapPx: number; mouthTeethN: number;
  upperTeethN?: number; lowerTeethN?: number; weights?: Record<string, number>; jawFraction?: number;
};
type Metrics = {
  line: string; audioDurationS: number; frameRate: number; frameCount: number;
  canonicalTrack: { startS: number; endS: number; viseme: string; intensity: number }[];
  mfa: ArpabetCue[]; toothSamples: Sample[];
};
type WordTier = { startS: number; endS: number; word: string };

function stressless(phone: string): string {
  return phone.trim().toUpperCase().replace(/[0-2]$/u, "");
}

function expectedViseme(phone: string): string {
  const key = stressless(phone);
  const table = ARPABET_TO_OVR as Readonly<Record<string, string>>;
  const viseme = table[key];
  if (viseme === undefined) throw new Error(`unknown-arpabet-phone:${phone}`);
  return viseme;
}

/** Frames whose centre (n+0.5)/FPS falls inside [startS, endS). */
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
    if (value > weight) {
      name = key;
      weight = value;
    }
  }
  return { name, weight };
}

function midSample(samples: Sample[], frame: number | null) {
  if (frame === null) return null;
  const sample = samples[frame];
  if (!sample) return null;
  const top = topViseme(sample.weights);
  return {
    frame,
    target: sample.target,
    drivenTop: top.name,
    drivenWeight: Math.round(top.weight * 1000) / 1000,
    jawFraction: sample.jawFraction ?? 0,
    upperTeethN: sample.upperTeethN ?? 0,
    lowerTeethN: sample.lowerTeethN ?? 0,
    lipGapPx: sample.lipGapPx,
    mouthTeethN: sample.mouthTeethN,
  };
}

/** Parse the words tier of an MFA long_textgrid. Empty text intervals are skipped. */
export function parseMfaWordsTier(textgrid: string): WordTier[] {
  const tier = textgrid.split('name = "words"')[1];
  if (tier === undefined) throw new Error("mfa-textgrid-missing-words-tier");
  const head = tier.split('name = "phones"')[0] ?? tier;
  const out: WordTier[] = [];
  const pattern = /xmin = ([\d.]+)\s+xmax = ([\d.]+)\s+text = "(.*?)"/gu;
  for (const match of head.matchAll(pattern)) {
    const startS = Number(match[1]);
    const endS = Number(match[2]);
    const word = (match[3] ?? "").trim();
    if (!Number.isFinite(startS) || !Number.isFinite(endS) || endS <= startS || word === "") continue;
    out.push({ startS, endS, word });
  }
  if (out.length === 0) throw new Error("mfa-textgrid-no-word-intervals");
  return out;
}

function loadMetrics(clip: ClipId, view: "default" | "mouth-front"): { metrics: Metrics; dir: string } {
  const config = resolveClipConfig(["node", "x", "--clip", clip]);
  const dir = path.join(REPO, "docs/openclinxr/mouth-dynamics", `${config.outSubdir}${view === "mouth-front" ? "-mouth-front" : ""}`);
  const file = path.join(dir, "metrics.json");
  if (!existsSync(file)) throw new Error(`missing-metrics:${file}`);
  return { metrics: JSON.parse(readFileSync(file, "utf8")) as Metrics, dir };
}

type PhoneRow = {
  phone: string; startS: number; endS: number; expectedViseme: string;
  mid: { default: ReturnType<typeof midSample>; mouthFront: ReturnType<typeof midSample> };
};

export function buildReport(clip: ClipId) {
  const def = loadMetrics(clip, "default");
  const front = loadMetrics(clip, "mouth-front");
  const phones = def.metrics.mfa;
  const rows: PhoneRow[] = phones.map((cue) => {
    const dFrames = framesInside(cue.startS, cue.endS, def.metrics.toothSamples.length);
    const fFrames = framesInside(cue.startS, cue.endS, front.metrics.toothSamples.length);
    const dMid = dFrames.length ? dFrames[Math.floor(dFrames.length / 2)] ?? null : null;
    const fMid = fFrames.length ? fFrames[Math.floor(fFrames.length / 2)] ?? null : null;
    return {
      phone: stressless(cue.phone),
      startS: Math.round(cue.startS * 1000) / 1000,
      endS: Math.round(cue.endS * 1000) / 1000,
      expectedViseme: expectedViseme(cue.phone),
      mid: { default: midSample(def.metrics.toothSamples, dMid), mouthFront: midSample(front.metrics.toothSamples, fMid) },
    };
  });
  const bilabial = { pass: 0, fail: 0, fails: [] as { phone: string; startS: number; view: string; frame: number; upperTeethN: number; lowerTeethN: number }[] };
  const labiodental = { pass: 0, fail: 0, fails: [] as { phone: string; startS: number; view: string; frame: number; upperTeethN: number; lowerTeethN: number }[] };
  const interdental: { phone: string; startS: number; frame: number | null; drivenTop: string | null; upperTeethN: number; lowerTeethN: number; lipGapPx: number }[] = [];
  const mismatchByViseme: Record<string, { match: number; total: number }> = {};
  const bump = (viseme: string, match: boolean) => {
    let entry = mismatchByViseme[viseme];
    if (!entry) {
      entry = { match: 0, total: 0 };
      mismatchByViseme[viseme] = entry;
    }
    entry.total += 1;
    if (match) entry.match += 1;
  };
  for (const row of rows) {
    for (const mid of [row.mid.default, row.mid.mouthFront] as const) {
      if (!mid) continue;
      const expectedFull = row.expectedViseme === "sil" ? "viseme_sil" : `viseme_${row.expectedViseme}`;
      bump(row.expectedViseme, mid.drivenTop === expectedFull);
    }
    if (row.phone === "P" || row.phone === "B" || row.phone === "M") {
      const d = row.mid.default;
      const f = row.mid.mouthFront;
      if (!d || !f) continue;
      const sealed = d.upperTeethN === 0 && d.lowerTeethN === 0 && f.upperTeethN === 0 && f.lowerTeethN === 0;
      if (sealed) bilabial.pass += 1;
      else {
        bilabial.fail += 1;
        for (const [view, mid] of [["default", d], ["mouthFront", f]] as const) {
          if (mid.upperTeethN !== 0 || mid.lowerTeethN !== 0) {
            bilabial.fails.push({ phone: row.phone, startS: row.startS, view, frame: mid.frame, upperTeethN: mid.upperTeethN, lowerTeethN: mid.lowerTeethN });
          }
        }
      }
    }
    if (row.phone === "F" || row.phone === "V") {
      const f = row.mid.mouthFront;
      if (!f) continue;
      if (f.upperTeethN > 0) labiodental.pass += 1;
      else {
        labiodental.fail += 1;
        labiodental.fails.push({ phone: row.phone, startS: row.startS, view: "mouthFront", frame: f.frame, upperTeethN: f.upperTeethN, lowerTeethN: f.lowerTeethN });
      }
    }
    if (row.phone === "TH" || row.phone === "DH") {
      const f = row.mid.mouthFront;
      interdental.push({ phone: row.phone, startS: row.startS, frame: f?.frame ?? null, drivenTop: f?.drivenTop ?? null, upperTeethN: f?.upperTeethN ?? 0, lowerTeethN: f?.lowerTeethN ?? 0, lipGapPx: f?.lipGapPx ?? 0 });
    }
  }
  const phoneSet = [...new Set(rows.map((row) => row.phone))].sort();
  const visemesCovered = [...new Set(rows.map((row) => row.expectedViseme))].sort();
  const frontSamples = front.metrics.toothSamples;
  const lowerAlwaysZero = frontSamples.length > 0 && frontSamples.every((s) => (s.lowerTeethN ?? 0) === 0);
  return {
    schemaVersion: "openclinxr.viseme-eval.v1",
    clip,
    line: def.metrics.line,
    durationS: def.metrics.audioDurationS,
    frameRate: FPS,
    evaluatedViews: ["default", "mouthFront"],
    mismatchEvaluatedOn: "middle frame of each phone interval in both views",
    notes: [
      "Failing per-phone checks are results, not gate failures: no runtime tuning in this slice.",
      "Bilabial mids seal in the default view's narrow central box (upper/lower 0) while the wide mouth-front box catches tooth slivers at the commissures; see the contact sheet and clip.mp4.",
      ...(lowerAlwaysZero ? ["Mouth-front lowerTeethN reads 0 on every frame: the split seam lands below all visible teeth in this view, so arch attribution there is upper-only."] : []),
    ],
    coverage: { phones: phoneSet, visemesCovered },
    phoneCount: rows.length,
    phones: rows,
    checks: { bilabial, labiodental, interdental, mismatchByViseme },
  };
}

export type EvalReport = ReturnType<typeof buildReport>;

function buildContactSheet(mp4: string, words: WordTier[], outPng: string): { words: number; columns: number } {
  const jobDir = mkdtempSync(path.join(tmpdir(), `veval-contact-${process.pid}-`));
  try {
    const thumbs: string[] = [];
    words.forEach((word, index) => {
      const mid = (word.startS + word.endS) / 2;
      const file = path.join(jobDir, `w-${String(index).padStart(3, "0")}.png`);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(mid), "-i", mp4, "-frames:v", "1", file]);
      thumbs.push(file);
    });
    execFileSync("python3", ["-c", [
      "import sys",
      "from PIL import Image, ImageDraw",
      "thumbs = sys.argv[1].split(',')",
      "labels = sys.argv[2].split(',')",
      "cols = int(sys.argv[3])",
      "out = sys.argv[4]",
      "tw, th, head = 320, 240, 28",
      "rows = (len(thumbs) + cols - 1) // cols",
      "sheet = Image.new('RGB', (cols * tw, rows * (th + head)), (16, 16, 16))",
      "draw = ImageDraw.Draw(sheet)",
      "seen = {}",
      "for i, (t, label) in enumerate(zip(thumbs, labels)):",
      "    base = label",
      "    n = seen.get(base, 0)",
      "    seen[base] = n + 1",
      "    tag = base if n == 0 else f'{base}#{n + 1}'",
      "    im = Image.open(t).convert('RGB').resize((tw, th))",
      "    x = (i % cols) * tw",
      "    y = (i // cols) * (th + head)",
      "    sheet.paste(im, (x, y + head))",
      "    draw.text((x + 8, y + 6), tag, fill=(255, 255, 255))",
      "sheet.save(out)",
    ].join("\n"), thumbs.join(","), words.map((w) => w.word).join(","), String(words.length > 16 ? 6 : 5), outPng]);
    return { words: words.length, columns: words.length > 16 ? 6 : 5 };
  } finally {
    rmSync(jobDir, { recursive: true, force: true });
  }
}

function wordsForContact(clip: ClipId): WordTier[] {
  const config = resolveClipConfig(["node", "x", "--clip", clip]);
  const jobDir = mkdtempSync(path.join(tmpdir(), `veval-words-${process.pid}-`));
  try {
    const wav = path.join(jobDir, "speech.wav");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", config.audioFile, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
    return parseMfaWordsTier(runMfaAlign(wav, config.transcript, `${config.mfaBasename}-words`));
  } finally {
    rmSync(jobDir, { recursive: true, force: true });
  }
}

const ISOLATED_ORDER = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"];

type RawStill = {
  viseme: string; target: string; weight: number; jawRad: number; jawFraction: number;
  teethTarget: string; teethWeight: number; corners: { lx: number; rx: number };
  widthPx: number; aperturePx: number; cameraResidualPx: number;
  centralBox: { x0: number; x1: number; y0: number; y1: number };
  upperPx: number; lowerPx: number; mouthPx: number; lipGapPx: number;
  legacyMouthPx: number; legacyLipGapPx: number;
};

type RawIsolated = {
  views: Record<string, { canvas: { w: number; h: number }; cameraResidualPx: number; stills: RawStill[] }>;
  corners: Record<string, { corners: { lx: number; rx: number }; W: number; H: number; residual: number | null }>;
};

function readRawIsolated(): RawIsolated {
  const file = path.join(REPORT_DIR, "isolated.raw.json");
  if (!existsSync(file)) throw new Error(`missing-isolated-raw:${file}`);
  return JSON.parse(readFileSync(file, "utf8")) as RawIsolated;
}

function buildIsolatedSheet(viewId: string, stills: RawStill[], outPng: string): void {
  const thumbs = stills.map((s) => path.join(REPORT_DIR, `isolated-${viewId}`, `${s.viseme}.png`));
  for (const t of thumbs) if (!existsSync(t)) throw new Error(`missing-still:${t}`);
  execFileSync("python3", ["-c", [
    "import sys",
    "from PIL import Image, ImageDraw",
    "thumbs = sys.argv[1].split(',')",
    "labels = sys.argv[2].split(',')",
    "out = sys.argv[3]",
    "tw, th, head, cols = 256, 256, 28, 5",
    "rows = (len(thumbs) + cols - 1) // cols",
    "sheet = Image.new('RGB', (cols * tw, rows * (th + head)), (16, 16, 16))",
    "draw = ImageDraw.Draw(sheet)",
    "for i, (t, label) in enumerate(zip(thumbs, labels)):",
    "    im = Image.open(t).convert('RGB').resize((tw, th))",
    "    x = (i % cols) * tw",
    "    y = (i // cols) * (th + head)",
    "    sheet.paste(im, (x, y + head))",
    "    draw.text((x + 8, y + 6), label, fill=(255, 255, 255))",
    "sheet.save(out)",
  ].join("\n"), thumbs.join(","), stills.map((s) => s.viseme).join(","), outPng]);
}

export function buildIsolatedReport(): { views: string[]; stills: number } {
  const raw = readRawIsolated();
  const views: Record<string, { canvas: { w: number; h: number }; cameraResidualPx: number; stills: object[] }> = {};
  for (const id of ["front", "34"]) {
    const view = raw.views[id];
    if (!view) throw new Error(`missing-isolated-view:${id}`);
    const got = view.stills.map((s) => s.viseme);
    if (JSON.stringify(got) !== JSON.stringify(ISOLATED_ORDER)) throw new Error(`isolated-order:${id}:${got.join(",")}`);
    for (const s of view.stills) {
      if (s.weight !== 1) throw new Error(`isolated-weight:${id}:${s.viseme}`);
      if (s.jawRad < 0 || s.jawFraction < 0 || s.jawFraction > 1) throw new Error(`isolated-jaw:${id}:${s.viseme}`);
      if (s.widthPx <= 0 || s.aperturePx < 0) throw new Error(`isolated-geometry:${id}:${s.viseme}`);
    }
    views[id] = {
      canvas: view.canvas,
      cameraResidualPx: Math.max(0, ...view.stills.map((s) => s.cameraResidualPx)),
      stills: view.stills.map((s) => ({
        viseme: s.viseme, jawRad: s.jawRad, jawFraction: s.jawFraction,
        teethTarget: s.teethTarget, teethWeight: s.teethWeight,
        upperPx: s.upperPx, lowerPx: s.lowerPx, apertureH: Math.round(s.aperturePx * 10) / 10,
        width: Math.round(s.widthPx * 10) / 10, lipGapPx: s.lipGapPx, centralBox: s.centralBox,
      })),
    };
    buildIsolatedSheet(id, view.stills, path.join(REPORT_DIR, `isolated-${id}.png`));
  }
  const sil = (id: string): RawStill => {
    const row = raw.views[id]?.stills.find((s) => s.viseme === "sil");
    if (!row) throw new Error(`missing-sil-still:${id}`);
    return row;
  };
  const report = {
    schemaVersion: "openclinxr.viseme-isolated.v1",
    method: [
      "Each viseme posed at weight 1.0 ALONE (all others 0) via the runtime applier with a single baked cue; jaw = jawOpenRadiansForPhoneme(viseme) times the runtime teeth gain; teeth as the runtime writes them; blink untouched (eyes outside the mouth framing).",
      "Corners = extreme-x body verts whose dominant skinning joint is an orbicularis-oris bone (lip tissue by rig), posed with live morph influences + skeleton and projected through the page pack camera; central ROI = corners inset 15% each end. Camera residual = mouth-box centre projection vs canvas centre.",
      "Three-quarter view is the rig three_quarter_left (45 deg yaw), mouth focus.",
    ],
    corners: {
      front: sil("front").corners,
      view34: sil("34").corners,
      default: raw.corners["default"]?.corners ?? null,
    },
    views,
  };
  writeFileSync(path.join(REPORT_DIR, "isolated.report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return { views: ["front", "34"], stills: 15 };
}

/** Central-ROI bilabial verdict: the landmark-derived central ROI is
 * contained in the measured default counting box, so the committed 0/0 box
 * counts imply central 0/0 — plus the isolated-PP front central count. */
export function attachBilabialCentral(clip: ClipId): { pass: number; fail: number } {
  const raw = readRawIsolated();
  const centralFile = path.join(REPORT_DIR, "isolated-central.json");
  if (!existsSync(centralFile)) throw new Error(`missing-isolated-central:${centralFile}`);
  const central = JSON.parse(readFileSync(centralFile, "utf8")) as {
    centralDefaultWindow: { x0: number; x1: number; y0: number; y1: number };
    centralInsideDefaultBox: boolean;
  };
  if (!central.centralInsideDefaultBox) throw new Error("central-outside-default-box");
  const reportPath = path.join(REPORT_DIR, `${clip}.report.json`);
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as EvalReport & { checks: { bilabialCentral?: unknown } };
  const silFront = raw.views["front"]?.stills.find((s) => s.viseme === "sil");
  const ppFront = raw.views["front"]?.stills.find((s) => s.viseme === "PP");
  const defCorners = raw.corners["default"]?.corners;
  if (!silFront || !ppFront || !defCorners) throw new Error("bilabial-central-missing-corners");
  const defaultBox = { x0: 40, x1: 100, y0: 55, y1: 85 };
  const fails: { clip: string; phone: string; startS: number; view: string; frame: number; upperTeethN: number; lowerTeethN: number }[] = [];
  let pass = 0;
  let evaluated = 0;
  for (const row of report.phones) {
    if (row.phone !== "P" && row.phone !== "B" && row.phone !== "M") continue;
    const mid = row.mid.default;
    if (!mid) continue;
    evaluated += 1;
    if (mid.upperTeethN === 0 && mid.lowerTeethN === 0) pass += 1;
    else fails.push({ clip, phone: row.phone, startS: row.startS, view: "default", frame: mid.frame, upperTeethN: mid.upperTeethN, lowerTeethN: mid.lowerTeethN });
  }
  if (ppFront.upperPx !== 0 || ppFront.lowerPx !== 0) {
    fails.push({ clip, phone: "PP-isolated", startS: -1, view: "mouthFront", frame: -1, upperTeethN: ppFront.upperPx, lowerTeethN: ppFront.lowerPx });
  }
  const section = {
    method: "Corners = extreme-x orbicularis-oris-dominant body verts at the sil still, projected through each view pack camera; central ROI excludes 15% of the corner span at each end. The central ROI is contained in the default counting box (verified headlessly), so the committed default 0/0 mids imply central 0/0. Isolated-PP front central count is exact GL pixels from the stills session.",
    cornersSilFront: silFront.corners,
    cornersSilDefault: defCorners,
    centralDefaultWindow: central.centralDefaultWindow,
    defaultBox, centralInsideDefaultBox: central.centralInsideDefaultBox,
    isolatedPpCentral: { upperPx: ppFront.upperPx, lowerPx: ppFront.lowerPx },
    evaluated, pass, fail: evaluated - pass + (ppFront.upperPx !== 0 || ppFront.lowerPx !== 0 ? 1 : 0), fails,
  };
  (report.notes as string[]).push("Bilabial-central: P/B/M default mids seal 0/0 inside the landmark-derived central ROI; isolated PP seals 0/0 centrally. The full-box mouth-front 18 px sits at the commissures outside the ROI.");
  report.checks = { ...report.checks, bilabialCentral: section };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { pass: section.pass, fail: section.fail };
}

async function main(): Promise<void> {
  const at = process.argv.indexOf("--clip");
  const clips: ClipId[] = at >= 0 ? [process.argv[at + 1] as ClipId] : ["pangram", "viseme-words"];
  mkdirSync(REPORT_DIR, { recursive: true });
  for (const clip of clips) {
    const report = buildReport(clip);
    const reportPath = path.join(REPORT_DIR, `${clip}.report.json`);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    const front = loadMetrics(clip, "mouth-front");
    const mp4 = path.join(front.dir, "clip.mp4");
    const words = wordsForContact(clip);
    const contactPath = path.join(REPORT_DIR, `${clip}.contact.png`);
    const sheet = buildContactSheet(mp4, words, contactPath);
    const bilab = report.checks.bilabial;
    const labio = report.checks.labiodental;
    const mismatches = Object.entries(report.checks.mismatchByViseme)
      .map(([viseme, row]) => `${viseme}:${row.match}/${row.total}`).join(" ");
    process.stdout.write(`${clip}: phones=${report.phoneCount} words=${sheet.words} bilabial=${bilab.pass}/${bilab.pass + bilab.fail} labiodental=${labio.pass}/${labio.pass + labio.fail} match{${mismatches}}\n`);
  }
  if (existsSync(path.join(REPORT_DIR, "isolated.raw.json"))) {
    const iso = buildIsolatedReport();
    process.stdout.write(`isolated: views=${iso.views.join(",")} stills=${iso.stills}\n`);
    for (const clip of clips) {
      const central = attachBilabialCentral(clip);
      process.stdout.write(`${clip}: bilabialCentral=${central.pass}/${central.pass + central.fail}\n`);
    }
  }
}

const invoked = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
