import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bakeLiveSttCueTrack, type SttWord } from "./package-actor-turn.js";

/**
 * Decode-rate independence (card tsk_9e638e9b4448672e).
 * The browser bakes from a 48 kHz Web Audio decode while the reference bakes
 * from ffmpeg at 22.05 kHz; the onset snap must land identically. Both inputs
 * resample to the fixed 16 kHz analysis rate before framing, so the same
 * audio at either rate bakes identical cue starts within 1 ms.
 */
function upsampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  const durationS = input.length / fromRate;
  const outLen = Math.max(1, Math.round(durationS * toRate));
  const out = new Float32Array(outLen);
  const last = input.length - 1;
  for (let j = 0; j < outLen; j += 1) {
    const pos = (j / toRate) * fromRate;
    const lo = Math.floor(pos);
    const hi = Math.min(last, lo + 1);
    const frac = pos - lo;
    const a = input[Math.max(0, Math.min(last, lo))] ?? 0;
    const b = input[Math.max(0, Math.min(last, hi))] ?? 0;
    out[j] = a + (b - a) * frac;
  }
  return out;
}

/** Synthetic onset signal: silence, vowel, frication, vowel. */
function synthetic22050(): Float32Array {
  const sr = 22050;
  const out = new Float32Array(sr);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / sr;
    if (t < 0.2) out[i] = 0;
    else if (t < 0.4) out[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / sr);
    else if (t < 0.6) out[i] = (i % 2 === 0 ? 0.15 : -0.15);
    else out[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / sr);
  }
  return out;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..");
const ARENA = path.join(REPO, "apps", "arena", "viseme-audio-clock", "grok-voice");
const CACHE_DIR = path.join(homedir(), ".openclinxr-cache", "grok-voice");

describe("live-stt decode-rate independence", () => {
  it("bakes identical cue starts at 22.05 and 48 kHz (synthetic onset signal)", () => {
    const words: SttWord[] = [
      { word: "ah", start: 0.25, end: 0.5 },
      { word: "see", start: 0.55, end: 0.9 },
    ];
    const pronunciations: Record<string, string[]> = { ah: ["AH1"], see: ["S", "IY1"] };
    const lo = synthetic22050();
    const hi = upsampleLinear(lo, 22050, 48000);
    const a = bakeLiveSttCueTrack({
      samples: lo, sampleRate: 22050, sttWords: words, transcript: "ah see", pronunciations,
    });
    const b = bakeLiveSttCueTrack({
      samples: hi, sampleRate: 48000, sttWords: words, transcript: "ah see", pronunciations,
    });
    expect(a.mismatches).toEqual([]);
    expect(b.mismatches).toEqual([]);
    expect(b.cues.map((c) => c.phone)).toEqual(a.cues.map((c) => c.phone));
    expect(b.cues).toHaveLength(a.cues.length);
    let maxStart = 0;
    let maxEnd = 0;
    for (let i = 0; i < a.cues.length; i += 1) {
      maxStart = Math.max(maxStart, Math.abs(b.cues[i]!.startS - a.cues[i]!.startS));
      maxEnd = Math.max(maxEnd, Math.abs(b.cues[i]!.endS - a.cues[i]!.endS));
    }
    expect(maxStart, `max cue-start delta ${maxStart}s`).toBeLessThanOrEqual(0.001);
    expect(maxEnd, `max cue-end delta ${maxEnd}s`).toBeLessThanOrEqual(0.001);
  });

  it("bakes identical cue starts from cached pain audio at 22.05 and 48 kHz", () => {
    const manifestPath = path.join(ARENA, "cache-manifest.json");
    if (!existsSync(manifestPath) || !existsSync(CACHE_DIR)) {
      expect("skipped: no cached audio").toBeTruthy();
      return;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Array<{
      kind?: string; clip?: string; key?: string; text?: string; audioSha256?: string;
    }>;
    const tts = manifest.find((e) => e.kind === "tts" && e.clip === "pain");
    if (!tts?.key || !tts.text) {
      expect("skipped: no pain tts").toBeTruthy();
      return;
    }
    const mp3 = path.join(CACHE_DIR, `${tts.key}.mp3`);
    if (!existsSync(mp3)) {
      expect("skipped: pain mp3 absent").toBeTruthy();
      return;
    }
    const sttByText = new Map<string, SttWord[]>();
    for (const file of readdirSync(CACHE_DIR)) {
      if (!file.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(readFileSync(path.join(CACHE_DIR, file), "utf8")) as {
          words?: Array<{ word?: string; start?: number; end?: number }>; text?: string;
        };
        if (parsed && Array.isArray(parsed.words) && typeof parsed.text === "string") {
          sttByText.set(
            parsed.text,
            parsed.words.map((w) => ({
              word: String(w.word ?? ""), start: Number(w.start), end: Number(w.end),
            })),
          );
        }
      } catch { /* keep scanning */ }
    }
    const sttEntry = manifest.find((m) => m.kind === "stt" && m.audioSha256 === tts.audioSha256);
    const sttWords = (sttEntry?.text !== undefined ? sttByText.get(sttEntry.text) : undefined)
      ?? sttByText.get(tts.text);
    if (!sttWords) {
      expect("skipped: pain stt absent").toBeTruthy();
      return;
    }
    const phonesPath = path.join(ARENA, "phone-plans.json");
    const phonesAll = JSON.parse(readFileSync(phonesPath, "utf8")) as Record<string, { phones: string[] }>;
    const pronunciations = Object.fromEntries(Object.entries(phonesAll).map(([k, v]) => [k, v.phones]));
    const raw: Buffer = execFileSync(
      "ffmpeg",
      ["-v", "error", "-i", mp3, "-ar", "22050", "-ac", "1", "-c:a", "pcm_s16le", "-f", "s16le", "-"],
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
    );
    const bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
    const n = Math.floor(bytes.length / 2);
    const lo = new Float32Array(n);
    for (let i = 0; i < n; i += 1) lo[i] = bytes.readInt16LE(i * 2) / 32768;
    const hi = upsampleLinear(lo, 22050, 48000);
    const a = bakeLiveSttCueTrack({
      samples: lo, sampleRate: 22050, sttWords, transcript: tts.text, pronunciations,
    });
    const b = bakeLiveSttCueTrack({
      samples: hi, sampleRate: 48000, sttWords, transcript: tts.text, pronunciations,
    });
    expect(a.mismatches).toEqual([]);
    expect(b.cues.map((c) => c.phone)).toEqual(a.cues.map((c) => c.phone));
    let maxStart = 0;
    for (let i = 0; i < a.cues.length; i += 1) {
      maxStart = Math.max(maxStart, Math.abs(b.cues[i]!.startS - a.cues[i]!.startS));
    }
    expect(maxStart, `pain max cue-start delta ${maxStart}s`).toBeLessThanOrEqual(0.001);
  });
});
