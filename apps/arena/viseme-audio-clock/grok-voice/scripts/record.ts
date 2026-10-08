/**
 * Record-once script. Every OpenRouter call on this machine happens here, once
 * per fixture; everything after replays from ~/.openclinxr-cache/grok-voice/.
 * Run foreground under direnv so OPENROUTER_API_KEY is present:
 *   direnv exec /Volumes/files/src/openclinxr pnpm exec tsx <this-file>
 * Writes: machine cache (audio + responses), cache-manifest.json,
 * mfa-cues.json, phone-plans.json, results.jsonl. Never prints the API key.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fetchStt, fetchTts, CACHE_DIR, ttsKey } from "../client.js";
import { CLIP_IDS, CLIPS, STT_MODEL, TTS_MODEL, VOICE } from "../clips.js";
import { scoreClip, type ClosureSpan, type PhoneCue, type WordCue } from "../measure.js";
import {
  applyMfaClosureRule,
  MFA_ACOUSTIC_MODEL,
  MFA_DICTIONARY,
  MFA_ENV_PREFIX,
  MFA_MICROMAMBA,
  parseMfaPhonesTier,
} from "../../../../../tools/openclinxr/evidence/parent-fitted-teeth/mfa-align.ts";

const HERE = new URL(".", import.meta.url).pathname;
const OUT = new URL("..", import.meta.url).pathname;
const HOME = process.env.HOME ?? "";
const STOCK_DICT = path.join(HOME, "Documents/MFA/pretrained_models/dictionary", `${MFA_DICTIONARY}.dict`);
const ACOUSTIC = path.join(HOME, "Documents/MFA/pretrained_models/acoustic", `${MFA_ACOUSTIC_MODEL}.zip`);
const CMU_DICT = path.join(HOME, ".openclinxr-tools/cmudict/cmudict.dict");

const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const norm = (w: string): string => w.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/gu, "");

/** Parse one tier (words|phones) of an MFA long_textgrid. Stops at the next tier. */
function parseTier(textgrid: string, name: string): Array<{ startS: number; endS: number; text: string }> {
  const after = textgrid.split(`name = "${name}"`)[1];
  if (after === undefined) throw new Error(`mfa-textgrid-missing-${name}-tier`);
  const body = after.split(/\n\s*name = "/u)[0] ?? "";
  const out: Array<{ startS: number; endS: number; text: string }> = [];
  for (const m of body.matchAll(/xmin = ([\d.]+)\s+xmax = ([\d.]+)\s+text = "(.*?)"/gu)) {
    const startS = Number(m[1]);
    const endS = Number(m[2]);
    if (Number.isFinite(startS) && Number.isFinite(endS) && endS > startS) {
      out.push({ startS, endS, text: m[3] ?? "" });
    }
  }
  return out;
}

/** Look up ARPABET phones: MFA dictionary first, then cmudict. No package imports. */
function resolvePhones(word: string, mfaDict: string, cmu: string): { phones: string[]; source: string } {
  // Both dictionaries key words in lowercase; phones stay uppercase.
  const lw = word.toLowerCase();
  const probLine = mfaDict.split("\n").find((ln) => new RegExp(`^${escapeRe(lw)}[\\d\\s]`).test(ln));
  if (probLine) {
    const phones = probLine
      .split(/\s+/u)
      .slice(1)
      .filter((t) => /^[A-Z]+[0-2]?$/.test(t));
    if (phones.length > 0) return { phones, source: "mfa-english_us_arpa" };
  }
  const cmuLine = cmu
    .split("\n")
    .find((ln) => ln.startsWith(`${lw} `) || ln.startsWith(`${lw}(`));
  if (cmuLine) {
    const phones = cmuLine
      .split(" ")
      .slice(1)
      .filter((t) => /^[A-Z]+[0-2]?$/.test(t));
    if (phones.length > 0) return { phones, source: "cmudict-fallback" };
  }
  return { phones: [], source: "oov" };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\']/g, "\\$&");
}

/** MFA align with an explicit dictionary path (stock path + appended OOV entries). */
function runMfaAlignWithDict(wavPath: string, transcript: string, basename: string, dictPath: string): string {
  const jobDir = mkdtempSync(path.join(tmpdir(), `mfa-align-${process.pid}-`));
  const corpusDir = path.join(jobDir, "corpus");
  const outDir = path.join(jobDir, "out");
  execFileSync("mkdir", ["-p", corpusDir, outDir]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", wavPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", path.join(corpusDir, `${basename}.wav`)]);
  writeFileSync(path.join(corpusDir, `${basename}.lab`), `${transcript.trim()}\n`);
  execFileSync(MFA_MICROMAMBA, ["run", "-p", MFA_ENV_PREFIX, "mfa", "align", corpusDir, dictPath, ACOUSTIC, outDir, "--output_format", "long_textgrid", "--clean", "--quiet"], {
    stdio: "pipe",
    env: { ...process.env, MAMBA_ROOT_PREFIX: MFA_ENV_PREFIX },
  });
  return readFileSync(path.join(outDir, `${basename}.TextGrid`), "utf8");
}

function audioDurationS(mp3Path: string): number {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3Path], { encoding: "utf8" });
  return Number(out.trim());
}

const results: unknown[] = [];
const manifest: unknown[] = [];
const mfaCues: Record<string, { phones: PhoneCue[]; words: WordCue[] }> = {};
const phonePlans: Record<string, { phones: string[]; source: string }> = {};
const ttsMs: number[] = [];
const sttMs: number[] = [];

// --recompute: no network. Replays cache, preserves prior paid-call lines
// (probe, record_metric, latency, billing), recomputes MFA + scores.
const RECOMPUTE = process.argv.includes("--recompute");
const audioByClip = new Map<string, { bytes: Uint8Array; sha: string }>();
if (RECOMPUTE) {
  for (const ln of readFileSync(path.join(OUT, "results.jsonl"), "utf8").trim().split("\n")) {
    const r = JSON.parse(ln) as { type?: string };
    if (r.type === "probe" || r.type === "record_metric" || r.type === "latency" || r.type === "billing") {
      results.push(r);
    }
  }
  const { readCachedTts } = await import("../client.js");
  for (const id of CLIP_IDS) {
    const { bytes, entry } = readCachedTts(CLIPS[id].text);
    audioByClip.set(id, { bytes, sha: entry.audioSha256 });
  }
} else {
  await recordPaidCalls();
}

async function recordPaidCalls(): Promise<void> {
  // 1. Probe ONCE: does the TTS call accept with_timestamps?
  let ttsAcceptsTimestamps = false;
  let probeDetail = "";
  try {
    const r = await fetchTts("hi.", { record: true, extra: { with_timestamps: true } });
    ttsMs.push(r.ms);
    const looksTimed = r.bytes.length > 0 && (r.entry.contentType ?? "").includes("json");
    ttsAcceptsTimestamps = looksTimed;
    probeDetail = `http-200 bytes=${r.bytes.length} contentType=${r.entry.contentType} hasTimingData=${looksTimed}`;
    manifest.push({ key: r.entry.key, kind: "tts-probe", model: TTS_MODEL, voice: VOICE, text: "hi.", extra: { with_timestamps: true }, audioSha256: r.entry.audioSha256, bytes: r.entry.bytes, generationId: r.entry.generationId, date: new Date().toISOString() });
    void r;
  } catch (e) {
    probeDetail = `rejected: ${String(e).slice(0, 200)}`;
  }
  results.push({ type: "probe", ttsAcceptsTimestamps, detail: probeDetail });

  // 2-3. TTS + STT each fixture once.
  for (const id of CLIP_IDS) {
    const t = await fetchTts(CLIPS[id].text, { record: true });
    ttsMs.push(t.ms);
    audioByClip.set(id, { bytes: t.bytes, sha: t.entry.audioSha256 });
    manifest.push({ key: t.entry.key, kind: "tts", clip: id, model: TTS_MODEL, voice: VOICE, text: CLIPS[id].text, audioSha256: t.entry.audioSha256, bytes: t.entry.bytes, generationId: t.entry.generationId, contentType: t.entry.contentType, date: new Date().toISOString() });
    results.push({ type: "record_metric", kind: "tts", clip: id, ms: Number(t.ms.toFixed(1)), bytes: t.bytes.length, chars: CLIPS[id].text.length, fromCache: t.fromCache });
  }
  for (const id of [...CLIP_IDS, "probe-hi"] as const) {
    const a =
      id === "probe-hi" ? { bytes: (await fetchTts("hi.", { record: true })).bytes, sha: "" } : audioByClip.get(id)!;
    const aSha = a.sha || sha(a.bytes);
    const s = await fetchStt(a.bytes, aSha, { record: true });
    sttMs.push(s.ms);
    if (id !== "probe-hi") {
      manifest.push({ key: `stt:${aSha}`, kind: "stt", clip: id, model: STT_MODEL, audioSha256: aSha, words: s.stt.words.length, text: s.stt.text, usage: s.stt.usage, date: new Date().toISOString() });
    }
    results.push({ type: "record_metric", kind: "stt", clip: id, ms: Number(s.ms.toFixed(1)), words: s.stt.words.length, usage: s.stt.usage, fromCache: s.fromCache });
  }
}

// 4. Resolve pronunciations for every reference word.
const mfaDictText = readFileSync(STOCK_DICT, "utf8");
const cmuText = readFileSync(CMU_DICT, "utf8");
const refWordsByClip = new Map<string, string[]>();
for (const id of CLIP_IDS) {
  const words = CLIPS[id].mfaTranscript.split(/\s+/).map(norm).filter(Boolean);
  refWordsByClip.set(id, words);
  for (const w of words) {
    if (!phonePlans[w]) phonePlans[w] = resolvePhones(w, mfaDictText, cmuText);
  }
}
// Homophone check words (dictionary-level, no audio): phone/though/cough.
for (const w of ["phone", "though", "cough"]) {
  if (!phonePlans[w]) phonePlans[w] = resolvePhones(w, mfaDictText, cmuText);
}
writeFileSync(path.join(OUT, "phone-plans.json"), JSON.stringify(phonePlans, null, 2));

// 5. MFA align each Grok clip (temp dict = stock + OOV albuterol from cmudict).
const tmpDict = path.join(mkdtempSync(path.join(tmpdir(), `mfa-dict-${process.pid}-`)), "custom.dict");
writeFileSync(tmpDict, `${mfaDictText.replace(/\s+$/, "")}\nalbuterol AE2 L B Y UW1 T ER0 AO0 L\n`);
const wavTmp = mkdtempSync(path.join(tmpdir(), `grok-wav-${process.pid}-`));
for (const id of CLIP_IDS) {
  const a = audioByClip.get(id)!;
  const mp3Path = path.join(wavTmp, `${id}.mp3`);
  writeFileSync(mp3Path, a.bytes);
  const dur = audioDurationS(mp3Path);
  const grid = runMfaAlignWithDict(mp3Path, CLIPS[id].mfaTranscript, `grok-${id}`, tmpDict);
  const phones = applyMfaClosureRule(parseMfaPhonesTier(grid));
  const words: WordCue[] = parseTier(grid, "words")
    .filter((t) => t.text.trim() !== "")
    .map((t) => ({ startS: t.startS, endS: t.endS, word: t.text }));
  mfaCues[id] = { phones, words };
  results.push({ type: "mfa_ref", clip: id, audioSha256: a.sha, audioDurationS: Number(dur.toFixed(3)), phones: phones.length, words: words.length });
}
writeFileSync(path.join(OUT, "mfa-cues.json"), JSON.stringify(mfaCues, null, 2));

// 5b. Audio anchors (STT gaps + cached-audio energy only; never MFA cues).
// Closure rule: same predicate as applyMfaClosureRule (silence immediately
// before a P/B/M initial becomes P), emitted over the STT inter-word gap
// (or the leading silence for word 0). Closure onset is the audio-energy
// quiet point: end of the last 10-ms frame at or above threshold with frame
// end <= gap end, clamped to the gap, falling back to gap start when the
// whole gap is quiet. Leading-silence offset: per-clip energy onset (first
// frame at or above threshold) re-anchors word 0 only. Threshold -40 dBFS
// peak per 10-ms frame separates mp3 encoder idle noise (measured <= -51 dB
// in leading frames of all four clips) from speech onset (>= -29 dB); it is
// chosen from the audio alone, not fitted to MFA. Decodes the cached TTS
// mp3s offline with ffmpeg: zero network.
const ANCHOR_THRESHOLD_DB = -40;
const FRAME_S = 0.01;

function framePeakDb(mp3Path: string): number[] {
  const raw: Buffer = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", mp3Path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-f", "s16le", "-"],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  const bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  const n = Math.floor(bytes.length / 2);
  const dbs: number[] = [];
  const per = 160;
  for (let i = 0; i < n; i += per) {
    let peak = 0;
    for (let k = i; k < Math.min(i + per, n); k += 1) {
      const v = bytes.readInt16LE(k * 2);
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    dbs.push(peak <= 0 ? -99 : 20 * Math.log10(peak / 32768));
  }
  return dbs;
}

const anchors: Record<
  string,
  {
    audioSha256: string;
    thresholdDb: number;
    energyOnsetS: number;
    leadingOffsetS: number;
    firstWordStartS: number;
    closures: ClosureSpan[];
  }
> = {};
{
  const { readCachedStt } = await import("../client.js");
  const bilabial = (p: string): boolean => ["P", "B", "M"].includes(p.trim().toUpperCase().replace(/[0-2]$/u, ""));
  const pron = Object.fromEntries(Object.entries(phonePlans).map(([k, v]) => [k, v.phones])) as Record<string, string[]>;
  for (const id of CLIP_IDS) {
    const a = audioByClip.get(id)!;
    const mp3Path = path.join(CACHE_DIR, `${ttsKey(CLIPS[id].text)}.mp3`);
    const dbs = framePeakDb(mp3Path);
    let onsetIdx = dbs.findIndex((v) => v >= ANCHOR_THRESHOLD_DB);
    if (onsetIdx < 0) onsetIdx = 0;
    const energyOnsetS = Number((onsetIdx * FRAME_S).toFixed(3));
    const stt = readCachedStt(a.sha);
    const words = refWordsByClip.get(id)!;
    const leadingOffsetS = Number(Math.max(0, stt.words[0]!.start - energyOnsetS).toFixed(3));
    const firstWordStartS = Number((stt.words[0]!.start - leadingOffsetS).toFixed(3));
    const closures: ClosureSpan[] = [];
    for (let i = 0; i < Math.min(words.length, stt.words.length); i += 1) {
      const init = pron[words[i]!]![0];
      if (!init || !bilabial(init)) continue;
      const gapStart = i === 0 ? 0 : stt.words[i - 1]!.end;
      const gapEnd = stt.words[i]!.start;
      if (!(gapEnd > gapStart)) continue;
      let lastLoud = -1;
      for (let f = 0; f < dbs.length; f += 1) {
        const fs = f * FRAME_S;
        const fe = (f + 1) * FRAME_S;
        if (fe > gapEnd + 1e-9) break;
        if (fs < gapStart - 1e-9) continue;
        if (dbs[f]! >= ANCHOR_THRESHOLD_DB) lastLoud = f;
      }
      const tQuiet = lastLoud < 0 ? gapStart : Math.min(Math.max((lastLoud + 1) * FRAME_S, gapStart), gapEnd);
      closures.push({
        wordIndex: i,
        phone: "P",
        startS: Number(tQuiet.toFixed(3)),
        endS: Number(gapEnd.toFixed(3)),
      });
    }
    anchors[id] = { audioSha256: a.sha, thresholdDb: ANCHOR_THRESHOLD_DB, energyOnsetS, leadingOffsetS, firstWordStartS, closures };
  }
}
writeFileSync(path.join(OUT, "audio-anchors.json"), JSON.stringify(anchors, null, 2));

// 6. Score each clip from the recorded STT words.
const pronMap: Record<string, string[]> = Object.fromEntries(Object.entries(phonePlans).map(([k, v]) => [k, v.phones]));
for (const id of CLIP_IDS) {
  const { readCachedStt } = await import("../client.js");
  const a = audioByClip.get(id)!;
  const stt = readCachedStt(a.sha);
  const an = anchors[id]!;
  const score = scoreClip(id, refWordsByClip.get(id)!, stt.words, pronMap, mfaCues[id]!.phones, mfaCues[id]!.words, {
    closures: an.closures,
    firstWordStartS: an.firstWordStartS,
  });
  results.push({ type: "clip_score", audioSha256: a.sha, sttText: stt.text, ...score });
}

// 7. Homophone check (dictionary-level): phone starts on F; though/cough differ.
const homo = {
  type: "homophone",
  phoneStartsF: (pronMap["phone"] ?? [])[0] === "F",
  though: (pronMap["though"] ?? []).join(" "),
  cough: (pronMap["cough"] ?? []).join(" "),
  differ: (pronMap["though"] ?? []).join(" ") !== (pronMap["cough"] ?? []).join(" "),
  holds: (pronMap["phone"] ?? [])[0] === "F" && (pronMap["though"] ?? []).join(" ") !== (pronMap["cough"] ?? []).join(" "),
};
results.push(homo);

if (!RECOMPUTE) {
  // 8. Billing: TTS characters + STT usage.
  const ttsChars = CLIP_IDS.reduce((n, id) => n + CLIPS[id].text.length, 0) + 3;
  let sttUsd = 0;
  let sttSeconds = 0;
  for (const r of results) {
    const m = r as { type?: string; kind?: string; usage?: { cost?: number; seconds?: number } };
    if (m.type === "record_metric" && m.kind === "stt") {
      sttUsd += m.usage?.cost ?? 0;
      sttSeconds += m.usage?.seconds ?? 0;
    }
  }
  results.push({ type: "billing", ttsChars, ttsModel: TTS_MODEL, sttModel: STT_MODEL, sttSeconds: Number(sttSeconds.toFixed(2)), sttUsd, ttsUsd: null, ttsUsdNote: "TTS returns raw bytes; cost is characters-billed per OpenRouter pricing, not itemized in the response" });

  // Latency summary over the 5 recorded calls each.
  const q = (a: number[], p: number): number => {
    const s = [...a].sort((x, y) => x - y);
    return Number(s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!.toFixed(1));
  };
  results.push({ type: "latency", ttsMs: ttsMs.map(Number), sttMs: sttMs.map(Number), ttsP50Ms: q(ttsMs, 0.5), ttsP95Ms: q(ttsMs, 0.95), sttP50Ms: q(sttMs, 0.5), sttP95Ms: q(sttMs, 0.95) });

  writeFileSync(path.join(OUT, "cache-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`recorded: ttsP50=${q(ttsMs, 0.5)}ms sttP50=${q(sttMs, 0.5)}ms sttUsd=${sttUsd}`);
}

writeFileSync(path.join(OUT, "results.jsonl"), `${results.map((r) => JSON.stringify(r)).join("\n")}\n`);
if (RECOMPUTE) console.log("recomputed MFA + scores from cache (no network)");
