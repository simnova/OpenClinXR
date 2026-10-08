import type { ProviderHealth } from "@cellix/provider-contracts";
import type {
  AudioEvent,
  SpeechInput,
  SpeechSynthesisRequest,
  TranscriptEvent,
  VoiceCapability,
  VoiceProvenance,
  VoiceProviderAdapter,
} from "./types.js";
import {
  GROK_VOICE_STT_MODEL,
  GROK_VOICE_STT_URL,
  GROK_VOICE_TTS_MODEL,
  GROK_VOICE_TTS_URL,
  grokVoiceAudioShaFromStreamId,
  grokVoiceDefaultCacheDir,
  grokVoiceSha256Hex,
  grokVoiceTtsKey,
  grokVoiceWordSpanMs,
  readGrokVoiceSttEntry,
  readGrokVoiceTtsMeta,
  writeGrokVoiceSttEntry,
  writeGrokVoiceTtsEntry,
  type GrokVoiceWord,
} from "./grok-voice-cache.js";

/** Replay reads cache only; record calls OpenRouter and rewrites cache; live calls without writing. */
export type GrokVoiceProviderMode = "replay" | "record" | "live";

/** Construction options for the record/replay Grok voice provider. */
export type GrokVoiceProviderOptions = {
  /** Default "replay": content-addressed cache only, never a network call. */
  mode?: GrokVoiceProviderMode;
  /** Bound into the TTS cache key. Default "ara". */
  voice?: string;
  /** Default ~/.openclinxr-cache/grok-voice (shared machine cache, outside the repo). */
  cacheDir?: string;
  /** True disables all replay pacing (tests). Default false. */
  zeroDelay?: boolean;
  /** Injectable fetch. Tests stub it to throw, proving replay never touches the network. */
  fetchImpl?: typeof fetch;
  /** Pacing for entries recorded before latency capture. Defaults 0 (no delay). */
  replayFallbackTtfbMs?: number;
  /** Pacing for entries recorded before latency capture. Defaults 0 (no delay). */
  replayFallbackTotalMs?: number;
  /** Pacing for STT entries recorded before latency capture. Defaults 0 (no delay). */
  replayFallbackSttMs?: number;
};

/**
 * Transcribe input carrying its own audio bytes for record/live modes.
 * The gateway SpeechInput has no audio payload; replay mode ignores this and reads cache by
 * streamId (`grok-audio:<audioSha256>`), while record/live read `audioBytes` when present.
 */
export type GrokVoiceSpeechInput = SpeechInput & {
  audioBytes?: Uint8Array;
};

/** Typed miss: replay found no cache entry. Never a network call. */
export class GrokVoiceCacheMissError extends Error {
  readonly code = "grok_voice_cache_miss";
  readonly kind: "tts" | "stt";
  readonly key: string;

  constructor(kind: "tts" | "stt", key: string) {
    super(`grok-voice cache-miss (no network in replay mode): ${kind} ${key}`);
    this.name = "GrokVoiceCacheMissError";
    this.kind = kind;
    this.key = key;
  }
}

/** Typed refusal: transcribe input names no cached audio and carries no bytes. */
export class GrokVoiceAudioUnavailableError extends Error {
  readonly code = "grok_voice_audio_unavailable";

  constructor(detail: string) {
    super(`grok-voice audio unavailable: ${detail}`);
    this.name = "GrokVoiceAudioUnavailableError";
  }
}

/** Typed refusal: record/live need OPENROUTER_API_KEY in env (run under direnv exec). */
export class GrokVoiceCredentialsError extends Error {
  readonly code = "grok_voice_credentials_missing";

  constructor() {
    super("grok-voice credentials missing: OPENROUTER_API_KEY is not set (run under direnv exec)");
    this.name = "GrokVoiceCredentialsError";
  }
}

/** Typed upstream failure: OpenRouter returned non-2xx. The key is never included. */
export class GrokVoiceUpstreamError extends Error {
  readonly code = "grok_voice_upstream_error";
  readonly status: number;

  constructor(kind: "tts" | "stt", status: number, bodyPrefix: string) {
    super(`grok-voice ${kind}-http-${status}: ${bodyPrefix}`);
    this.name = "GrokVoiceUpstreamError";
    this.status = status;
  }
}

function miss(kind: "tts" | "stt", key: string): Error {
  return new GrokVoiceCacheMissError(kind, key);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

/**
 * Record/replay Grok voice provider. Replay (default) serves the content-addressed machine
 * cache written by apps/arena/viseme-audio-clock/grok-voice/scripts/record.ts, pacing audio
 * chunks with the latency recorded alongside each entry so iterations simulate a live call
 * without spending tokens. Output per turn is the gateway event shape: one audio_chunk per
 * STT word (word timing in durationMs order) plus partial/final transcripts with word atMs.
 */
export class GrokVoiceProviderAdapter implements VoiceProviderAdapter {
  readonly id = "grok-voice";
  readonly capabilities: VoiceCapability[] = ["transcription", "synthesis", "viseme_cues"];

  private readonly mode: GrokVoiceProviderMode;
  private readonly voice: string;
  private readonly cacheDir: string;
  private readonly zeroDelay: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly fallbackTtfbMs: number;
  private readonly fallbackTotalMs: number;
  private readonly fallbackSttMs: number;

  constructor(options: GrokVoiceProviderOptions = {}) {
    this.mode = options.mode ?? "replay";
    this.voice = options.voice ?? "ara";
    this.cacheDir = options.cacheDir ?? grokVoiceDefaultCacheDir();
    this.zeroDelay = options.zeroDelay ?? false;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.fallbackTtfbMs = options.replayFallbackTtfbMs ?? 0;
    this.fallbackTotalMs = options.replayFallbackTotalMs ?? 0;
    this.fallbackSttMs = options.replayFallbackSttMs ?? 0;
  }

  async health(): Promise<ProviderHealth> {
    // Always ready: OPENROUTER_API_KEY is call-time configuration (like network
    // availability), so record/live report missing credentials per call with the
    // stable grok_voice_credentials_missing code instead of going not_configured
    // (which would hide the code behind the gateway's generic no-provider error).
    return { providerId: this.id, status: "ready" };
  }

  async *transcribe(input: SpeechInput): AsyncIterable<TranscriptEvent> {
    const words = await this.wordsForTranscribe(input);
    const provenanceBase = this.provenanceBase(input, GROK_VOICE_STT_MODEL);
    let prefix = "";
    for (const word of words.text) {
      prefix = prefix.length === 0 ? word.word : `${prefix} ${word.word}`;
      yield {
        eventType: "partial_transcript",
        text: prefix,
        confidence: 0.9,
        atMs: Math.round(word.end * 1000),
        provenance: { ...provenanceBase, latencyMs: words.latencyMs },
      };
    }
    const last = words.text[words.text.length - 1];
    yield {
      eventType: "final_transcript",
      text: words.fullText,
      confidence: 0.99,
      atMs: last ? Math.round(last.end * 1000) : 0,
      provenance: {
        ...provenanceBase,
        latencyMs: words.latencyMs,
        costEstimateUsd: words.costUsd,
      },
    };
  }

  async *synthesize(input: SpeechSynthesisRequest): AsyncIterable<AudioEvent> {
    const turns = await this.chunksForSynthesis(input);
    const provenanceBase = this.provenanceBase(input, GROK_VOICE_TTS_MODEL);
    let first = true;
    for (const [index, chunk] of turns.chunks.entries()) {
      if (!this.zeroDelay) {
        if (first) {
          first = false;
          if (turns.ttfbMs > 0) await sleep(turns.ttfbMs);
        } else if (turns.gapMs > 0) {
          await sleep(turns.gapMs);
        }
      }
      yield {
        eventType: "audio_chunk",
        audioFormat: "audio/mpeg",
        chunkIndex: index,
        durationMs: chunk.durationMs,
        visemeCue: "neutral",
        provenance: { ...provenanceBase, latencyMs: turns.ttfbMs },
      };
    }
  }

  private async wordsForTranscribe(
    input: SpeechInput,
  ): Promise<{ text: GrokVoiceWord[]; fullText: string; latencyMs: number; costUsd: number }> {
    if (this.mode === "replay") {
      let sha: string;
      try {
        sha = grokVoiceAudioShaFromStreamId(input.streamId);
      } catch {
        throw new GrokVoiceAudioUnavailableError(
          `streamId must be "grok-audio:<audioSha256>" (got "${input.streamId.slice(0, 48)}")`,
        );
      }
      const entry = readGrokVoiceSttEntry(this.cacheDir, sha, miss);
      if (!this.zeroDelay) {
        const waitMs = entry.grokVoice?.totalMs ?? this.fallbackSttMs;
        if (waitMs > 0) await sleep(waitMs);
      }
      return {
        text: entry.words,
        fullText: entry.text,
        latencyMs: entry.grokVoice?.totalMs ?? this.fallbackSttMs,
        costUsd: 0,
      };
    }
    const bytes = (input as GrokVoiceSpeechInput).audioBytes;
    if (!bytes) {
      throw new GrokVoiceAudioUnavailableError(
        `${this.mode} transcribe needs input.audioBytes (SpeechInput carries no audio payload)`,
      );
    }
    const sha = grokVoiceSha256Hex(bytes);
    if (this.mode === "live") {
      const stt = await this.callStt(bytes);
      return { text: stt.words, fullText: stt.text, latencyMs: stt.ms, costUsd: stt.costUsd };
    }
    try {
      const entry = readGrokVoiceSttEntry(this.cacheDir, sha, miss);
      return { text: entry.words, fullText: entry.text, latencyMs: 0, costUsd: 0 };
    } catch (error) {
      if (!(error instanceof GrokVoiceCacheMissError)) throw error;
    }
    const stt = await this.callStt(bytes);
    writeGrokVoiceSttEntry(this.cacheDir, sha, { text: stt.words, fullText: stt.text }, stt.ms, stt.raw);
    return { text: stt.words, fullText: stt.text, latencyMs: stt.ms, costUsd: stt.costUsd };
  }

  private async chunksForSynthesis(
    input: SpeechSynthesisRequest,
  ): Promise<{ chunks: Array<{ durationMs: number }>; ttfbMs: number; gapMs: number }> {
    if (this.mode === "replay") {
      const key = grokVoiceTtsKey(input.text, this.voice);
      const meta = readGrokVoiceTtsMeta(this.cacheDir, key, miss);
      const stt = readGrokVoiceSttEntry(this.cacheDir, meta.audioSha256, miss);
      const ttfbMs = meta.grokVoice?.ttfbMs ?? this.fallbackTtfbMs;
      const totalMs = meta.grokVoice?.totalMs ?? this.fallbackTotalMs;
      const chunks = stt.words.map((word) => ({ durationMs: grokVoiceWordSpanMs(word) }));
      const gapMs = chunks.length > 1 ? Math.max(0, (totalMs - ttfbMs) / (chunks.length - 1)) : 0;
      return { chunks, ttfbMs, gapMs };
    }
    if (this.mode === "live") {
      const call = await this.callTts(input.text);
      return { chunks: [{ durationMs: Math.max(1, Math.round(call.ms)) }], ttfbMs: call.ttfbMs, gapMs: 0 };
    }
    const key = grokVoiceTtsKey(input.text, this.voice);
    try {
      const meta = readGrokVoiceTtsMeta(this.cacheDir, key, miss);
      const stt = readGrokVoiceSttEntry(this.cacheDir, meta.audioSha256, miss);
      return { chunks: stt.words.map((word) => ({ durationMs: grokVoiceWordSpanMs(word) })), ttfbMs: 0, gapMs: 0 };
    } catch (error) {
      if (!(error instanceof GrokVoiceCacheMissError)) throw error;
    }
    const call = await this.callTts(input.text);
    const meta = writeGrokVoiceTtsEntry(this.cacheDir, key, call.bytes, {
      generationId: call.generationId,
      contentType: call.contentType,
      ttfbMs: call.ttfbMs,
      totalMs: call.ms,
    });
    const stt = await this.callStt(call.bytes);
    writeGrokVoiceSttEntry(this.cacheDir, meta.audioSha256, { text: stt.words, fullText: stt.text }, stt.ms, stt.raw);
    return {
      chunks: stt.words.map((word) => ({ durationMs: grokVoiceWordSpanMs(word) })),
      ttfbMs: 0,
      gapMs: 0,
    };
  }

  private apiKey(): string {
    const key = process.env["OPENROUTER_API_KEY"];
    if (!key) throw new GrokVoiceCredentialsError();
    return key;
  }

  private async callTts(
    text: string,
  ): Promise<{ bytes: Uint8Array; generationId: string | null; contentType: string | null; ttfbMs: number; ms: number }> {
    const t0 = performance.now();
    const res = await this.fetchImpl(GROK_VOICE_TTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey()}`,
      },
      body: JSON.stringify({
        model: GROK_VOICE_TTS_MODEL,
        input: text,
        voice: this.voice,
        response_format: "mp3",
      }),
    });
    const ttfbMs = performance.now() - t0;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new GrokVoiceUpstreamError("tts", res.status, body.slice(0, 300));
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ms = performance.now() - t0;
    return {
      bytes,
      generationId: res.headers.get("x-generation-id") ?? res.headers.get("X-Generation-Id"),
      contentType: res.headers.get("content-type"),
      ttfbMs,
      ms,
    };
  }

  private async callStt(
    audioBytes: Uint8Array,
  ): Promise<{ text: string; words: GrokVoiceWord[]; costUsd: number; ms: number; raw: unknown }> {
    const t0 = performance.now();
    const res = await this.fetchImpl(GROK_VOICE_STT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey()}`,
      },
      body: JSON.stringify({
        model: GROK_VOICE_STT_MODEL,
        input_audio: { data: Buffer.from(audioBytes).toString("base64"), format: "mp3" },
        response_format: "verbose_json",
        timestamp_granularities: ["word"],
        language: "en",
      }),
    });
    const ms = performance.now() - t0;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new GrokVoiceUpstreamError("stt", res.status, body.slice(0, 300));
    }
    const raw = (await res.json()) as {
      text?: string;
      words?: Array<{ word?: string; start?: number; end?: number }>;
      usage?: { cost?: number };
    };
    return {
      text: raw.text ?? "",
      words: (raw.words ?? []).map((w) => ({
        word: String(w.word ?? ""),
        start: Number(w.start ?? NaN),
        end: Number(w.end ?? NaN),
      })),
      costUsd: raw.usage?.cost ?? 0,
      ms,
      raw,
    };
  }

  private provenanceBase(
    input: SpeechInput | SpeechSynthesisRequest,
    modelId: string,
  ): Omit<VoiceProvenance, "latencyMs"> {
    return {
      requestId: voiceRequestId(input),
      providerId: this.id,
      modelId,
      modelVersion: "1.0.0",
      modelRuntimeName: "grok-voice-openrouter-runtime",
      requestPolicyId: input.policy.requestPolicyId,
      safetyPolicyVersion: input.policy.safetyPolicyVersion,
      costEstimateUsd: 0,
      safetyStatus: "not_exercised",
    };
  }
}

function voiceRequestId(input: SpeechInput | SpeechSynthesisRequest): string {
  if (input.requestId && input.requestId.trim().length > 0) {
    return input.requestId;
  }
  if ("streamId" in input) {
    return `${input.stationRunId}:${input.streamId}:transcription`;
  }
  return `${input.stationRunId}:${input.actorId}:${input.voiceId}:synthesis`;
}
