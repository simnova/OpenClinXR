/**
 * Cache-keyed Grok Voice client. Arena-only; no runtime wiring.
 *
 * REPLAY is the default: a cache hit makes no network call. A cache miss
 * throws unless `record: true` is passed (the record script passes it once per
 * fixture; everything after that replays). Cache lives outside the repo at
 * ~/.openclinxr-cache/grok-voice/ so any worktree on this machine can replay.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { STT_MODEL, TTS_MODEL, VOICE } from "./clips.js";

export const CACHE_DIR = path.join(homedir(), ".openclinxr-cache", "grok-voice");

const TTS_URL = "https://openrouter.ai/api/v1/audio/speech";
const STT_URL = "https://openrouter.ai/api/v1/audio/transcriptions";

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Canonical TTS request; the cache key is sha256 of this JSON. */
export function ttsRequest(text: string, extra?: Record<string, unknown>) {
  return {
    kind: "tts",
    model: TTS_MODEL,
    voice: VOICE,
    response_format: "mp3",
    input: text,
    ...(extra ?? {}),
  };
}

export function ttsKey(text: string, extra?: Record<string, unknown>): string {
  return sha256Hex(JSON.stringify(ttsRequest(text, extra)));
}

export function sttKey(audioSha256: string): string {
  return sha256Hex(
    JSON.stringify({
      kind: "stt",
      model: STT_MODEL,
      audioSha256,
      inputAudioFormat: "mp3",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
      language: "en",
    }),
  );
}

function ensureDir(): void {
  mkdirSync(CACHE_DIR, { recursive: true });
}

export type TtsCacheEntry = {
  key: string;
  audioSha256: string;
  bytes: number;
  generationId: string | null;
  contentType: string | null;
};

function authed(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set (run under direnv exec)");
  return key;
}

function cachePaths(key: string, ext: string): { bin: string; meta: string } {
  return { bin: path.join(CACHE_DIR, `${key}.${ext}`), meta: path.join(CACHE_DIR, `${key}.json`) };
}

/**
 * Fetch TTS audio. Returns cache status plus bytes. `extra` is merged into the
 * request body (used once for the with_timestamps probe); it is part of the
 * cache key, so the probe never collides with a fixture recording.
 */
export async function fetchTts(
  text: string,
  opts: { record: boolean; extra?: Record<string, unknown> },
): Promise<{ bytes: Uint8Array; entry: TtsCacheEntry; fromCache: boolean; ms: number }> {
  ensureDir();
  const key = ttsKey(text, opts.extra);
  const { bin, meta } = cachePaths(key, "mp3");
  if (existsSync(bin) && existsSync(meta)) {
    const m = JSON.parse(readFileSync(meta, "utf8")) as TtsCacheEntry;
    return { bytes: new Uint8Array(readFileSync(bin)), entry: m, fromCache: true, ms: 0 };
  }
  if (!opts.record) throw new Error(`cache-miss (no network in replay mode): tts ${key}`);
  const t0 = performance.now();
  const res = await fetch(TTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authed()}`,
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      input: text,
      voice: VOICE,
      response_format: "mp3",
      ...(opts.extra ?? {}),
    }),
  });
  const ms = performance.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`tts-http-${res.status}: ${body.slice(0, 300)}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const entry: TtsCacheEntry = {
    key,
    audioSha256: sha256Hex(bytes),
    bytes: bytes.length,
    generationId: res.headers.get("x-generation-id") ?? res.headers.get("X-Generation-Id"),
    contentType: res.headers.get("content-type"),
  };
  writeFileSync(bin, bytes);
  writeFileSync(meta, JSON.stringify(entry, null, 2));
  return { bytes, entry, fromCache: false, ms };
}

export type SttWord = { word: string; start: number; end: number };
export type SttResult = {
  text: string;
  words: SttWord[];
  usage: { seconds?: number; total_tokens?: number; cost?: number };
  raw: unknown;
};

/** Fetch STT verbose_json with word timestamps for cached TTS audio. */
export async function fetchStt(
  audioBytes: Uint8Array,
  audioSha256: string,
  opts: { record: boolean },
): Promise<{ stt: SttResult; fromCache: boolean; ms: number }> {
  ensureDir();
  const key = sttKey(audioSha256);
  const { meta } = cachePaths(key, "stt");
  if (existsSync(meta)) {
    const stt = JSON.parse(readFileSync(meta, "utf8")) as SttResult;
    return { stt, fromCache: true, ms: 0 };
  }
  if (!opts.record) throw new Error(`cache-miss (no network in replay mode): stt ${key}`);
  const b64 = Buffer.from(audioBytes).toString("base64");
  const t0 = performance.now();
  const res = await fetch(STT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authed()}`,
    },
    body: JSON.stringify({
      model: STT_MODEL,
      input_audio: { data: b64, format: "mp3" },
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
      language: "en",
    }),
  });
  const ms = performance.now() - t0;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`stt-http-${res.status}: ${body.slice(0, 300)}`);
  }
  const raw = (await res.json()) as {
    text?: string;
    words?: Array<{ word?: string; start?: number; end?: number }>;
    usage?: SttResult["usage"];
  };
  const stt: SttResult = {
    text: raw.text ?? "",
    words: (raw.words ?? []).map((w) => ({
      word: String(w.word ?? ""),
      start: Number(w.start ?? NaN),
      end: Number(w.end ?? NaN),
    })),
    usage: raw.usage ?? {},
    raw,
  };
  writeFileSync(meta, JSON.stringify(stt, null, 2));
  return { stt, fromCache: false, ms };
}

/** Read a recorded TTS entry from cache (replay path; throws on miss). */
export function readCachedTts(text: string): { bytes: Uint8Array; entry: TtsCacheEntry } {
  const key = ttsKey(text);
  const { bin, meta } = cachePaths(key, "mp3");
  if (!existsSync(bin) || !existsSync(meta)) throw new Error(`cache-miss: tts ${key}`);
  return {
    bytes: new Uint8Array(readFileSync(bin)),
    entry: JSON.parse(readFileSync(meta, "utf8")) as TtsCacheEntry,
  };
}

/** Read a recorded STT result from cache (replay path; throws on miss). */
export function readCachedStt(audioSha256: string): SttResult {
  const key = sttKey(audioSha256);
  const { meta } = cachePaths(key, "stt");
  if (!existsSync(meta)) throw new Error(`cache-miss: stt ${key}`);
  return JSON.parse(readFileSync(meta, "utf8")) as SttResult;
}
