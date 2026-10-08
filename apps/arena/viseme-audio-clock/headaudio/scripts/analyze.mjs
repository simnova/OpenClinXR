/** Score the bake-off: join candidate frame signals with MFA reference intervals. */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const HERE = new URL("../", import.meta.url).pathname;
const CACHE = `${HERE}cache/`;
const RUNS = `${CACHE}runs/`;
const FPS = 30;
const WIDEN_FRAMES = 2;

const CLIPS = ["pangram", "viseme-words", "pain", "oov"];
const MFA_FILE = { pangram: "mfa-pangram.json", "viseme-words": "mfa-words.json", pain: "mfa-pain.json", oov: "mfa-oov.json" };

const stressless = (p) => p.trim().toUpperCase().replace(/[0-2]$/u, "");
const BILABIAL = new Set(["P", "B", "M"]);
const LABIODENTAL = new Set(["F", "V"]);

function loadRuns(candidate, clip) {
  return readdirSync(RUNS)
    .filter((f) => f.startsWith(`${candidate}.${clip}.rep`) && f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(RUNS + f, "utf8")));
}

/** Bin raw samples into 30 fps frames. Returns per-frame {pp, ff, sil, act} summary. */
function binFrames(run) {
  const frames = new Map();
  for (const s of run.samples) {
    const n = Math.floor(s.t * FPS);
    if (n < 0) continue;
    let f = frames.get(n);
    if (!f) {
      f = run.candidate === "headaudio"
        ? { ppW: [], ffW: [], ppHit: false, ffHit: false, act: false }
        : { ppHit: false, ffHit: false, act: false, visemes: [] };
      frames.set(n, f);
    }
    if (run.candidate === "headaudio") {
      f.ppW.push(s.viseme_PP ?? 0);
      f.ffW.push(s.viseme_FF ?? 0);
      if (s.active === 5) f.ppHit = true;
      if (s.active === 9) f.ffHit = true;
      if (s.active !== -1) f.act = true;
    } else {
      if (s.viseme === "viseme_PP") f.ppHit = true;
      if (s.viseme === "viseme_FF") f.ffHit = true;
      if (s.viseme !== "viseme_sil") f.act = true;
      f.visemes.push(s.viseme);
    }
  }
  return frames;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

const out = [];
// Run-level timing for every rep.
for (const candidate of ["headaudio", "wawa"]) {
  for (const clip of CLIPS) {
    for (const run of loadRuns(candidate, clip)) {
      out.push({
        type: "run_metric", candidate, clip, rep: run.rep,
        audioMs: run.audioMs, wallMs: run.wallMs,
        rtf: run.audioMs / run.wallMs, nSamples: run.samples.length,
      });
    }
  }
}

const clipScores = [];
for (const candidate of ["headaudio", "wawa"]) {
  for (const clip of CLIPS) {
    const runs = loadRuns(candidate, clip);
    const mfa = JSON.parse(readFileSync(CACHE + MFA_FILE[clip], "utf8"));
    const cues = mfa.cues;
    // Accuracy from rep0 (recorded artifact); stability range across reps below.
    const frames = binFrames(runs[0]);
    const frameCount = Math.ceil((runs[0].audioMs / 1000) * FPS);
    const inWindow = (cue) => {
      const a = cue.startS - WIDEN_FRAMES / FPS;
      const b = cue.endS + WIDEN_FRAMES / FPS;
      const hit = [];
      for (let n = 0; n < frameCount; n += 1) {
        const c = (n + 0.5) / FPS;
        if (c >= a && c < b) hit.push(n);
      }
      return hit;
    };
    const score = (phones) => {
      let hits = 0;
      let total = 0;
      const errs = [];
      const intervals = [];
      for (const cue of cues) {
        if (!phones.has(stressless(cue.phone))) continue;
        total += 1;
        const ns = inWindow(cue);
        let event = null;
        let peak = 0;
        for (const n of ns) {
          const f = frames.get(n);
          if (!f) continue;
          if (candidate === "headaudio" && f.ppW.length && phones === BILABIAL) peak = Math.max(peak, ...f.ppW);
          if (candidate === "headaudio" && f.ffW.length && phones === LABIODENTAL) peak = Math.max(peak, ...f.ffW);
          const isHit = phones === BILABIAL ? f.ppHit : f.ffHit;
          if (isHit && event === null) event = (n + 0.5) / FPS;
        }
        if (event !== null) {
          hits += 1;
          errs.push(Number((((event - cue.startS) * FPS)).toFixed(1)));
        }
        intervals.push({ phone: cue.phone, startS: cue.startS, endS: cue.endS, hit: event !== null, errFrames: event === null ? null : Number(((event - cue.startS) * FPS).toFixed(1)), peakWeight: candidate === "headaudio" ? Number(peak.toFixed(3)) : undefined });
      }
      errs.sort((x, y) => x - y);
      return { hits, total, errs, intervals };
    };
    const clo = score(BILABIAL);
    const lab = score(LABIODENTAL);
    // Stability: hits across all reps.
    const repHits = runs.map((r) => {
      const fr = binFrames(r);
      let h = 0;
      for (const cue of cues) {
        if (!BILABIAL.has(stressless(cue.phone))) continue;
        const a = cue.startS - WIDEN_FRAMES / FPS;
        const b = cue.endS + WIDEN_FRAMES / FPS;
        for (let n = 0; n < frameCount; n += 1) {
          const c = (n + 0.5) / FPS;
          if (c >= a && c < b && fr.get(n)?.ppHit) { h += 1; break; }
        }
      }
      return h;
    });
    // Activity: speech span vs silence baseline (words-clip inter-word gaps).
    const lastSpeechEnd = Math.max(...cues.filter((c) => stressless(c.phone) !== "SIL").map((c) => c.endS));
    let speechN = 0;
    let speechA = 0;
    for (let n = 0; n < frameCount; n += 1) {
      const c = (n + 0.5) / FPS;
      if (c < lastSpeechEnd && frames.get(n)) { speechN += 1; if (frames.get(n).act) speechA += 1; }
    }
    const wordsRuns = loadRuns(candidate, "viseme-words");
    const wordsMfa = JSON.parse(readFileSync(CACHE + MFA_FILE["viseme-words"], "utf8"));
    const wordsFrames = binFrames(wordsRuns[0]);
    let silN = 0;
    let silA = 0;
    for (const cue of wordsMfa.cues) {
      const k = stressless(cue.phone);
      if (k !== "SIL" && k !== "SP" && k !== "SPN") continue;
      for (let n = 0; n < Math.ceil((wordsRuns[0].audioMs / 1000) * FPS); n += 1) {
        const c = (n + 0.5) / FPS;
        if (c >= cue.startS && c < cue.endS && wordsFrames.get(n)) { silN += 1; if (wordsFrames.get(n).act) silA += 1; }
      }
    }
    const rtfAll = runs.map((r) => r.audioMs / r.wallMs).sort((a, b) => a - b);
    const entry = {
      type: "clip_score", candidate, clip,
      closureHits: clo.hits, closureTotal: clo.total,
      labiodentalHits: lab.hits, labiodentalTotal: lab.total,
      onsetMedianFrames: quantile(clo.errs, 0.5), onsetP95Frames: quantile(clo.errs, 0.95),
      onsetErrs: clo.errs, closureIntervals: clo.intervals, labiodentalIntervals: lab.intervals,
      rep0Hits: clo.hits, repHitsRange: [Math.min(...repHits), Math.max(...repHits)],
      speechActivity: speechN ? Number((speechA / speechN).toFixed(3)) : null,
      silenceActivity: silN ? Number((silA / silN).toFixed(3)) : null,
      rtfP50: Number(quantile(rtfAll, 0.5).toFixed(3)), rtfP95: Number(quantile(rtfAll, 0.95).toFixed(3)),
      wallP50Ms: Number(quantile(runs.map((r) => r.wallMs).sort((a, b) => a - b), 0.5).toFixed(0)),
      wallP95Ms: Number(quantile(runs.map((r) => r.wallMs).sort((a, b) => a - b), 0.95).toFixed(0)),
      nReps: runs.length,
    };
    clipScores.push(entry);
    out.push(entry);
  }
}

writeFileSync(`${HERE}results.jsonl`, out.map((o) => JSON.stringify(o)).join("\n") + "\n");
console.log(`wrote ${out.length} lines`);
for (const e of clipScores) {
  console.log(`${e.candidate}.${e.clip} clo=${e.closureHits}/${e.closureTotal} lab=${e.labiodentalHits}/${e.labiodentalTotal} onsetMed=${e.onsetMedianFrames} p95=${e.onsetP95Frames} repRange=${e.repHitsRange} act=${e.speechActivity}/${e.silenceActivity} rtf=${e.rtfP50}/${e.rtfP95}`);
}
