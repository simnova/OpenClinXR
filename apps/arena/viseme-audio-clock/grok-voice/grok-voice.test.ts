/**
 * Replay test: the full measurement runs with networking disabled (fetch
 * stubbed to throw) and must reproduce results.jsonl exactly. A cache miss
 * also throws, so any network dependency fails the test instead of billing.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CACHE_DIR, readCachedStt, readCachedTts, ttsKey } from "./client.js";
import { CLIP_IDS, CLIPS } from "./clips.js";
import { buildPhonePlan, phoneWeight, scoreClip, snapWordStarts, type ClosureSpan } from "./measure.js";

const HERE = new URL(".", import.meta.url).pathname;
const norm = (w: string): string => w.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/gu, "");

type PhoneCue = { startS: number; endS: number; phone: string };
type WordCue = { startS: number; endS: number; word: string };

function loadInputs(): {
  pronMap: Record<string, string[]>;
  mfaCues: Record<string, { phones: PhoneCue[]; words: WordCue[] }>;
  anchors: Record<string, { closures: ClosureSpan[]; firstWordStartS: number; snappedStarts: number[] }>;
} {
  const phonePlans = JSON.parse(readFileSync(`${HERE}phone-plans.json`, "utf8")) as Record<
    string,
    { phones: string[] }
  >;
  const pronMap: Record<string, string[]> = Object.fromEntries(
    Object.entries(phonePlans).map(([k, v]) => [k, v.phones]),
  );
  const mfaCues = JSON.parse(readFileSync(`${HERE}mfa-cues.json`, "utf8")) as Record<
    string,
    { phones: PhoneCue[]; words: WordCue[] }
  >;
  const anchors = JSON.parse(readFileSync(`${HERE}audio-anchors.json`, "utf8")) as Record<
    string,
    { closures: ClosureSpan[]; firstWordStartS: number; snappedStarts: number[] }
  >;
  return { pronMap, mfaCues, anchors };
}

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("network-disabled-in-replay-test");
  });
});

describe("grok-voice cached audio clock (replay, no network)", () => {
  it("reproduces every clip score from cache with fetch disabled", () => {
    const { pronMap, mfaCues, anchors } = loadInputs();
    const expected = new Map<string, unknown>(
      readFileSync(`${HERE}results.jsonl`, "utf8")
        .trim()
        .split("\n")
        .map((l: string) => JSON.parse(l) as { type?: string; clip?: string })
        .filter((r) => r.type === "clip_score")
        .map((r) => [r.clip as string, r]),
    );

    for (const id of CLIP_IDS) {
      const { bytes, entry } = readCachedTts(CLIPS[id].text);
      expect(bytes.length).toBe(entry.bytes);
      const stt = readCachedStt(entry.audioSha256);
      expect(stt.words.length).toBeGreaterThan(0);
      const refWords = CLIPS[id].mfaTranscript.split(/\s+/).map(norm).filter(Boolean);
      const an = anchors[id]!;
      const score = scoreClip(id, refWords, stt.words, pronMap, mfaCues[id]!.phones, mfaCues[id]!.words, {
        closures: an.closures,
        firstWordStartS: an.firstWordStartS,
        wordStarts: an.snappedStarts,
        split: "duration",
      });
      expect({ type: "clip_score", audioSha256: entry.audioSha256, sttText: stt.text, ...score }).toEqual(
        expected.get(id),
      );
    }
  });

  it("measures replay cost over 20 runs (cache read + full scoring)", () => {
    const { pronMap, mfaCues, anchors } = loadInputs();
    const ms: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const t0 = performance.now();
      for (const id of CLIP_IDS) {
        const { entry } = readCachedTts(CLIPS[id].text);
        const stt = readCachedStt(entry.audioSha256);
        const refWords = CLIPS[id].mfaTranscript.split(/\s+/).map(norm).filter(Boolean);
        const an = anchors[id]!;
        scoreClip(id, refWords, stt.words, pronMap, mfaCues[id]!.phones, mfaCues[id]!.words, {
          closures: an.closures,
          firstWordStartS: an.firstWordStartS,
          wordStarts: an.snappedStarts,
          split: "duration",
        });
      }
      ms.push(performance.now() - t0);
    }
    const s = [...ms].sort((a, b) => a - b);
    const q = (p: number): number =>
      Number(s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!.toFixed(2));
    writeFileSync(
      `${HERE}replay-timings.json`,
      `${JSON.stringify({ type: "replay_latency", runs: 20, ms: ms.map((m) => Number(m.toFixed(2))), replayP50Ms: q(0.5), replayP95Ms: q(0.95) }, null, 2)}\n`,
    );
    expect(q(0.5)).toBeGreaterThanOrEqual(0);
  });

  it("snaps word starts to the nearest audio onset within the window", () => {
    // Frames: quiet until 0.20 s, speech 0.20-0.50, quiet gap, onset 0.70.
    const frames = Array.from({ length: 100 }, (_, f) => {
      const t = f * 0.01;
      return (t >= 0.2 && t < 0.5) || t >= 0.7 ? -20 : -60;
    });
    const stt = [
      { word: "a", start: 0.36, end: 0.44 }, // 160 ms past the 0.20 onset -> kept
      { word: "bed", start: 0.83, end: 0.95 }, // 130 ms late vs 0.70 onset -> snapped
      { word: "toe", start: 0.4, end: 0.46 }, // nearest onset 0.20 is 200 ms away -> kept
    ];
    expect(snapWordStarts(stt, frames, -40, 0.15, 0.01).map((s) => Number(s.toFixed(2)))).toEqual([
      0.36, 0.7, 0.4,
    ]);
  });

  it("weights within-word splits by fixed phone durations", () => {
    // FAT: F(0.9) AE1(1.15*1.1=1.265): vowel span exceeds the stop share.
    expect(phoneWeight("F")).toBe(0.9);
    expect(phoneWeight("AE1")).toBeCloseTo(1.265, 10);
    expect(phoneWeight("P")).toBe(0.6);
    const ref = ["fat"];
    const stt = [{ word: "fat", start: 1.0, end: 1.2 }];
    const pron = { fat: ["F", "AE1", "T"] };
    const even = buildPhonePlan(ref, stt, pron, { split: "even" });
    const weighted = buildPhonePlan(ref, stt, pron, { split: "duration" });
    expect(even.plan.map((p) => Number(p.startS.toFixed(4)))).toEqual([1, 1.0667, 1.1333]);
    // Total weight 0.9+1.265+0.6=2.765: F ends 1.0651, AE1 ends 1.1566.
    expect(weighted.plan.map((p) => Number(p.startS.toFixed(4)))).toEqual([1, 1.0651, 1.1566]);
  });

  it("emits closure P phones from STT gaps with no MFA input", () => {
    // Counterweight behavioral half: buildPhonePlan takes reference words,
    // STT words, pronunciations, and precomputed audio anchors only. There is
    // no parameter through which MFA cues could enter plan construction.
    const ref = ["put", "bed"];
    const stt = [
      { word: "put", start: 0.1, end: 0.34 },
      { word: "bed", start: 0.62, end: 0.86 },
    ];
    const pron = { put: ["P", "UH1"], bed: ["B", "EH1", "D"] };
    const { plan } = buildPhonePlan(ref, stt, pron, {
      closures: [
        { wordIndex: 0, phone: "P", startS: 0, endS: 0.1 },
        { wordIndex: 1, phone: "P", startS: 0.5, endS: 0.62 },
      ],
      firstWordStartS: 0.1,
    });
    const closures = plan.filter((p) => p.wordIndex === 0 || p.phone === "P" || p.wordIndex === 1);
    expect(
      plan.filter((p) => p.phone === "P").map((p) => [Number(p.startS.toFixed(2)), Number(p.endS.toFixed(2))]),
    ).toEqual([
      [0, 0.1],
      [0.1, 0.22],
      [0.5, 0.62],
    ]);
    expect(closures.length).toBe(plan.length);
  });

  it("plan construction cannot read MFA cues", () => {
    // Counterweight static half: the plan builder source mentions no MFA
    // input, and the committed anchors carry no MFA cue data (bounds keyed
    // by STT word index, threshold stated in the file).
    const src = readFileSync(`${HERE}measure.ts`, "utf8");
    const fn = src.slice(src.indexOf("export function buildPhonePlan"));
    const body = fn.slice(0, fn.indexOf("\n}\n") + 3);
    const codeOnly = body
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/\/\/.*$/gmu, "");
    expect(codeOnly.toLowerCase()).not.toContain("mfa");
    const anchors = JSON.parse(readFileSync(`${HERE}audio-anchors.json`, "utf8")) as Record<string, object>;
    expect(JSON.stringify(anchors).toLowerCase()).not.toContain("mfa");
    for (const id of CLIP_IDS) {
      const an = (anchors as Record<string, { closures: ClosureSpan[] }>)[id]!;
      for (const c of an.closures) {
        expect(c.phone).toBe("P");
        expect(Number.isInteger(c.wordIndex)).toBe(true);
        expect(c.endS).toBeGreaterThan(c.startS);
      }
    }
  });

  it("committed anchors reproduce from cached audio (ffmpeg decode, no network)", () => {
    // Proves the leading offset and closure bounds are measured from the TTS
    // audio itself: re-decode one cached clip and re-derive its anchors.
    const anchors = JSON.parse(readFileSync(`${HERE}audio-anchors.json`, "utf8")) as Record<
      string,
      { thresholdDb: number; energyOnsetS: number; closures: ClosureSpan[] }
    >;
    const mp3 = `${CACHE_DIR}/${ttsKey(CLIPS["viseme-words"].text)}.mp3`;
    const raw: Buffer = execFileSync(
      "ffmpeg",
      ["-v", "error", "-i", mp3, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-f", "s16le", "-"],
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
    );
    const bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
    const n = Math.floor(bytes.length / 2);
    const th = anchors["viseme-words"]!.thresholdDb;
    const peaks: number[] = [];
    for (let i = 0; i < n; i += 160) {
      let peak = 0;
      for (let k = i; k < Math.min(i + 160, n); k += 1) {
        const a = Math.abs(bytes.readInt16LE(k * 2));
        if (a > peak) peak = a;
      }
      peaks.push(peak <= 0 ? -99 : 20 * Math.log10(peak / 32768));
    }
    const onset = peaks.findIndex((v) => v >= th);
    expect(Number((onset * 0.01).toFixed(3))).toBe(anchors["viseme-words"]!.energyOnsetS);
    // Bed gap: last loud frame end <= 6.287 must reproduce the closure onset.
    let last = -1;
    for (let f = 0; f < peaks.length; f += 1) {
      if ((f + 1) * 0.01 > 6.287 + 1e-9) break;
      if (f * 0.01 < 6.006 - 1e-9) continue;
      if (peaks[f]! >= th) last = f;
    }
    const bed = anchors["viseme-words"]!.closures.find((c) => c.wordIndex === 10)!;
    expect(Number(((last + 1) * 0.01).toFixed(3))).toBe(bed.startS);
    expect(bed.endS).toBe(6.287);
  });

  it("vendored closure predicate matches mfa-align.ts (sync or fail)", () => {
    // The plan's closure predicate is vendored from applyMfaClosureRule with
    // no published entrypoint, so an upstream change does NOT propagate.
    // This test snapshots the source text and fails on divergence, forcing
    // a deliberate re-vendor in measure.ts.
    const root = `${HERE}../../../../`;
    const src = readFileSync(`${root}tools/openclinxr/evidence/parent-fitted-teeth/mfa-align.ts`, "utf8");
    const normWs = (s: string): string =>
      s
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/\/\/.*$/gmu, "")
        .replace(/\s+/gu, " ")
        .trim();
    const set = src.match(/const BILABIAL_STOPS = new Set\(\[.*?\]\)/su)?.[0] ?? "";
    const start = src.indexOf("export function applyMfaClosureRule");
    const fn = src.slice(start, src.indexOf("\n}\n", start) + 3);
    expect(normWs(`${set} ${fn}`)).toBe(
      'const BILABIAL_STOPS = new Set(["P", "B", "M"]) export function applyMfaClosureRule(cues: readonly ArpabetCue[]): ArpabetCue[] { return cues.map((cue, index) => { const key = stressless(cue.phone); if ((key === "SIL" || key === "SP" || key === "SPN") && index + 1 < cues.length) { const next = stressless(cues[index + 1]?.phone ?? ""); if (BILABIAL_STOPS.has(next)) return { ...cue, phone: "P" }; } return { ...cue }; }); }',
    );
  });
});
