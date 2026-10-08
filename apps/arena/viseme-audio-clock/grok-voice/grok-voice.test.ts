/**
 * Replay test: the full measurement runs with networking disabled (fetch
 * stubbed to throw) and must reproduce results.jsonl exactly. A cache miss
 * also throws, so any network dependency fails the test instead of billing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readCachedStt, readCachedTts } from "./client.js";
import { CLIP_IDS, CLIPS } from "./clips.js";
import { scoreClip } from "./measure.js";

const HERE = new URL(".", import.meta.url).pathname;
const norm = (w: string): string => w.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/gu, "");

type PhoneCue = { startS: number; endS: number; phone: string };
type WordCue = { startS: number; endS: number; word: string };

function loadInputs(): {
  pronMap: Record<string, string[]>;
  mfaCues: Record<string, { phones: PhoneCue[]; words: WordCue[] }>;
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
  return { pronMap, mfaCues };
}

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("network-disabled-in-replay-test");
  });
});

describe("grok-voice cached audio clock (replay, no network)", () => {
  it("reproduces every clip score from cache with fetch disabled", () => {
    const { pronMap, mfaCues } = loadInputs();
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
      const score = scoreClip(id, refWords, stt.words, pronMap, mfaCues[id]!.phones, mfaCues[id]!.words);
      expect({ type: "clip_score", audioSha256: entry.audioSha256, sttText: stt.text, ...score }).toEqual(
        expected.get(id),
      );
    }
  });

  it("measures replay cost over 20 runs (cache read + full scoring)", () => {
    const { pronMap, mfaCues } = loadInputs();
    const ms: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const t0 = performance.now();
      for (const id of CLIP_IDS) {
        const { entry } = readCachedTts(CLIPS[id].text);
        const stt = readCachedStt(entry.audioSha256);
        const refWords = CLIPS[id].mfaTranscript.split(/\s+/).map(norm).filter(Boolean);
        scoreClip(id, refWords, stt.words, pronMap, mfaCues[id]!.phones, mfaCues[id]!.words);
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
});
