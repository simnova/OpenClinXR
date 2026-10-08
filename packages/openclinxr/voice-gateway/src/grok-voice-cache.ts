import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Grok voice TTS model served via OpenRouter. Mirrors the arena bake-off fixture model. */
export const GROK_VOICE_TTS_MODEL = "x-ai/grok-voice-tts-1.0" as const;

/** Grok voice STT model served via OpenRouter (verbose_json with word timestamps). */
export const GROK_VOICE_STT_MODEL = "x-ai/grok-stt-1.0" as const;

/** Default actor voice. The repo fixtures fall through to Ara; the key binds the voice. */
export const GROK_VOICE_DEFAULT_VOICE = "ara" as const;

export const GROK_VOICE_TTS_URL = "https://openrouter.ai/api/v1/audio/speech";
export const GROK_VOICE_STT_URL = "https://openrouter.ai/api/v1/audio/transcriptions";

/** One STT word with second-offset timestamps; drives per-word audio chunks and partials. */
export type GrokVoiceWord = {
  word: string;
  start: number;
  end: number;
};

export type GrokVoiceTtsCacheMeta = {
  key: string;
  audioSha256: string;
  bytes: number;
  generationId: string | null;
  contentType: string | null;
  grokVoice?: {
    ttfbMs?: number;
    totalMs?: number;
    recordedAt?: string;
  };
};

export type GrokVoiceSttCacheEntry = {
  text: string;
  words: GrokVoiceWord[];
  usage: { seconds?: number; total_tokens?: number; cost?: number };
  raw?: unknown;
  grokVoice?: {
    totalMs?: number;
    recordedAt?: string;
  };
};

export function grokVoiceSha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Content-addressed TTS key: sha256 of the canonical request JSON.
 * Re-derived from apps/arena/viseme-audio-clock/grok-voice/client.ts (no import across the
 * boundary); the key-equality test pins it against cache-manifest.json entries.
 */
export function grokVoiceTtsKey(text: string, voice: string = GROK_VOICE_DEFAULT_VOICE): string {
  return grokVoiceSha256Hex(
    JSON.stringify({
      kind: "tts",
      model: GROK_VOICE_TTS_MODEL,
      voice,
      response_format: "mp3",
      input: text,
    }),
  );
}

/**
 * Content-addressed STT key: sha256 of the canonical request JSON.
 * Re-derived from apps/arena/viseme-audio-clock/grok-voice/client.ts.
 */
export function grokVoiceSttKey(audioSha256: string): string {
  return grokVoiceSha256Hex(
    JSON.stringify({
      kind: "stt",
      model: GROK_VOICE_STT_MODEL,
      audioSha256,
      inputAudioFormat: "mp3",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
      language: "en",
    }),
  );
}

/** Shared machine cache outside the repo, so any worktree on this machine can replay. */
export function grokVoiceDefaultCacheDir(): string {
  return path.join(homedir(), ".openclinxr-cache", "grok-voice");
}

/** Word span in whole milliseconds; non-positive or non-finite spans yield 0. */
export function grokVoiceWordSpanMs(word: GrokVoiceWord): number {
  if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end <= word.start) return 0;
  return Math.round((word.end - word.start) * 1000);
}

const AUDIO_SHA_PATTERN = /^grok-audio:([0-9a-f]{64})$/u;

export function grokVoiceAudioShaFromStreamId(streamId: string): string {
  const match = AUDIO_SHA_PATTERN.exec(streamId.trim());
  if (!match?.[1]) {
    throw new Error(
      `grok-voice audio unavailable: streamId must be "grok-audio:<audioSha256>" (got "${streamId.slice(0, 48)}")`,
    );
  }
  return match[1];
}

export function readGrokVoiceTtsMeta(
  cacheDir: string,
  key: string,
  miss: (kind: "tts" | "stt", key: string) => Error,
): GrokVoiceTtsCacheMeta {
  if (!existsSync(path.join(cacheDir, `${key}.mp3`)) || !existsSync(path.join(cacheDir, `${key}.json`))) {
    throw miss("tts", key);
  }
  return JSON.parse(readFileSync(path.join(cacheDir, `${key}.json`), "utf8")) as GrokVoiceTtsCacheMeta;
}

export function readGrokVoiceSttEntry(
  cacheDir: string,
  audioSha256: string,
  miss: (kind: "tts" | "stt", key: string) => Error,
): GrokVoiceSttCacheEntry {
  const key = grokVoiceSttKey(audioSha256);
  const metaPath = path.join(cacheDir, `${key}.json`);
  if (!existsSync(metaPath)) {
    throw miss("stt", key);
  }
  return JSON.parse(readFileSync(metaPath, "utf8")) as GrokVoiceSttCacheEntry;
}

export function writeGrokVoiceTtsEntry(
  cacheDir: string,
  key: string,
  bytes: Uint8Array,
  entry: { generationId: string | null; contentType: string | null; ttfbMs: number; totalMs: number },
): GrokVoiceTtsCacheMeta {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path.join(cacheDir, `${key}.mp3`), bytes);
  const meta: GrokVoiceTtsCacheMeta = {
    key,
    audioSha256: grokVoiceSha256Hex(bytes),
    bytes: bytes.length,
    generationId: entry.generationId,
    contentType: entry.contentType,
    grokVoice: {
      ttfbMs: Math.round(entry.ttfbMs),
      totalMs: Math.round(entry.totalMs),
      recordedAt: new Date().toISOString(),
    },
  };
  writeFileSync(path.join(cacheDir, `${key}.json`), JSON.stringify(meta, null, 2));
  return meta;
}

export function writeGrokVoiceSttEntry(
  cacheDir: string,
  audioSha256: string,
  stt: { text: GrokVoiceWord[]; fullText: string },
  totalMs: number,
  raw: unknown,
): void {
  mkdirSync(cacheDir, { recursive: true });
  const key = grokVoiceSttKey(audioSha256);
  const entry: GrokVoiceSttCacheEntry = {
    text: stt.fullText,
    words: stt.text,
    usage: {},
    raw,
    grokVoice: { totalMs: Math.round(totalMs), recordedAt: new Date().toISOString() },
  };
  writeFileSync(path.join(cacheDir, `${key}.json`), JSON.stringify(entry, null, 2));
}
