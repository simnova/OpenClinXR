/**
 * Server-side Grok voice replay turn for the Bun realtime voice WebSocket
 * (MADR 0017 WebSocket-first, MADR 0019 provider adapters).
 *
 * Split from bun-realtime-voice-handler.ts under the file-size budget: this
 * module owns the replay cache reads, gateway calls, and protocol emission.
 * The handler keeps control routing and the echo contract.
 */

import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { collectVoiceStream, createDefaultVoiceGateway, realtimeVoiceProtocol } from "@openclinxr/voice-gateway";
import type { AudioEvent } from "@openclinxr/voice-gateway";
import type { BunRealtimeVoiceWebSocket } from "./api-types.js";

/**
 * Server-side Grok voice replay settings. Replay reads the content-addressed
 * machine cache only and never touches the network; a miss surfaces the
 * gateway error code on the socket, never a silent fallback.
 */
export type BunRealtimeVoiceReplayOptions = {
  /** Defaults to the shared machine cache (~/.openclinxr-cache/grok-voice). */
  cacheDir?: string;
  /** TTS voice bound into the cache key. Default "ara". */
  voice?: string;
  /** True paces replay with the recorded per-entry latency. Default true. */
  emulateLatency?: boolean;
};

export type BunRealtimeVoiceReplayEnvironment = {
  readonly [key: string]: string | undefined;
  readonly OPENCLINXR_VOICE_PROVIDER?: string;
  readonly OPENCLINXR_GROK_VOICE_CACHE_DIR?: string;
};

export type ResolvedBunRealtimeVoiceReplayOptions = {
  cacheDir?: string;
  voice: string;
  emulateLatency: boolean;
};

/**
 * Live-tier actor-turn request. Only served when the API starts with
 * grok-voice replay; every other mode keeps its control contract byte-identical.
 */
export const ACTOR_TURN_REQUEST_CONTROL_TYPE = "actor.turn.request";

const GROK_VOICE_TTS_MODEL = "x-ai/grok-voice-tts-1.0";
const GROK_VOICE_STT_MODEL = "x-ai/grok-stt-1.0";
const GROK_VOICE_DEFAULT_VOICE = "ara";
const GROK_VOICE_REPLAY_ROUTE_ID = "voice-grok-replay-v1";
const GROK_VOICE_REPLAY_POLICY_ID = "voice-grok-replay-v1";

/**
 * Explicit startup option wins; otherwise OPENCLINXR_VOICE_PROVIDER adopts
 * grok-voice replay with an optional OPENCLINXR_GROK_VOICE_CACHE_DIR. Absent
 * (default) keeps the local echo.
 */
export function resolveBunRealtimeVoiceReplayOptions(
  explicit?: BunRealtimeVoiceReplayOptions,
  env: BunRealtimeVoiceReplayEnvironment = {},
): ResolvedBunRealtimeVoiceReplayOptions | undefined {
  if (explicit !== undefined) {
    return {
      ...(explicit.cacheDir !== undefined ? { cacheDir: explicit.cacheDir } : {}),
      voice: explicit.voice ?? GROK_VOICE_DEFAULT_VOICE,
      emulateLatency: explicit.emulateLatency ?? true,
    };
  }
  if (env["OPENCLINXR_VOICE_PROVIDER"] !== "grok-voice-replay") {
    return undefined;
  }
  const cacheDir = env["OPENCLINXR_GROK_VOICE_CACHE_DIR"];
  return {
    ...(cacheDir !== undefined && cacheDir.length > 0 ? { cacheDir } : {}),
    voice: GROK_VOICE_DEFAULT_VOICE,
    emulateLatency: true,
  };
}

export function isActorTurnRequestControlType(controlType: string): boolean {
  return controlType === ACTOR_TURN_REQUEST_CONTROL_TYPE;
}

/**
 * Content-addressed cache keys re-derived from
 * packages/openclinxr/voice-gateway/src/grok-voice-cache.ts (no cross-boundary
 * import; the same re-derivation precedent the gateway itself uses against the
 * arena record client). The key-equality pin lives in the voice-gateway tests.
 */
function grokVoiceTtsKey(text: string, voice: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: "tts",
        model: GROK_VOICE_TTS_MODEL,
        voice,
        response_format: "mp3",
        input: text,
      }),
    )
    .digest("hex");
}

function grokVoiceSttKey(audioSha256: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: "stt",
        model: GROK_VOICE_STT_MODEL,
        audioSha256,
        inputAudioFormat: "mp3",
        response_format: "verbose_json",
        timestamp_granularities: ["word"],
        language: "en",
      }),
    )
    .digest("hex");
}

function grokVoiceSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function errorCodeOf(error: unknown): string {
  return typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : "voice_replay_failed";
}

function sendJson(socket: BunRealtimeVoiceWebSocket, payload: Record<string, unknown>): void {
  socket.send(JSON.stringify(payload));
}

function sendReplayError(socket: BunRealtimeVoiceWebSocket, error: unknown, requestId?: string): void {
  sendJson(socket, {
    type: "voice.error",
    code: errorCodeOf(error),
    providerId: "grok-voice",
    mode: "replay",
    ...(requestId !== undefined ? { requestId } : {}),
    ...(error instanceof Error ? { message: error.message } : {}),
  });
}

type ReplayWord = { word: string; start: number; end: number };

function readReplayCacheEntry(
  cacheDir: string,
  key: string,
  audioBytes: Uint8Array,
): { audioSha256: string; words: ReplayWord[] } {
  const metaPath = path.join(cacheDir, `${key}.json`);
  const audioPath = path.join(cacheDir, `${key}.mp3`);
  if (!existsSync(metaPath) || !existsSync(audioPath)) {
    const miss = new Error(`grok-voice cache-miss (no network in replay mode): tts ${key}`);
    (miss as { code?: string }).code = "grok_voice_cache_miss";
    throw miss;
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { audioSha256?: unknown };
  if (typeof meta.audioSha256 !== "string") {
    const corrupt = new Error(`grok-voice cache entry without audioSha256: tts ${key}`);
    (corrupt as { code?: string }).code = "grok_voice_cache_corrupt";
    throw corrupt;
  }
  if (grokVoiceSha256Hex(audioBytes) !== meta.audioSha256) {
    const corrupt = new Error(`grok-voice cache bytes do not hash to the entry: tts ${key}`);
    (corrupt as { code?: string }).code = "grok_voice_cache_corrupt";
    throw corrupt;
  }
  const stt = JSON.parse(readFileSync(path.join(cacheDir, `${grokVoiceSttKey(meta.audioSha256)}.json`), "utf8")) as {
    text?: unknown;
    words?: unknown;
  };
  if (typeof stt.text !== "string" || !Array.isArray(stt.words)) {
    const miss = new Error(
      `grok-voice cache-miss (no network in replay mode): stt ${grokVoiceSttKey(meta.audioSha256)}`,
    );
    (miss as { code?: string }).code = "grok_voice_cache_miss";
    throw miss;
  }
  const words = (stt.words as Array<{ word?: unknown; start?: unknown; end?: unknown }>).map((word) => ({
    word: String(word.word ?? ""),
    start: Number(word.start),
    end: Number(word.end),
  }));
  return { audioSha256: meta.audioSha256, words };
}

/** Partition cached mp3 bytes across per-word chunks proportional to durationMs. Concatenation is exact. */
function splitReplayAudio(audioBytes: Uint8Array, durationsMs: number[]): Uint8Array[] {
  const total = durationsMs.reduce((sum, duration) => sum + Math.max(0, duration), 0);
  const slices: Uint8Array[] = [];
  let offset = 0;
  for (const [index, duration] of durationsMs.entries()) {
    const last = index === durationsMs.length - 1;
    const take = last
      ? audioBytes.byteLength - offset
      : Math.floor((audioBytes.byteLength * Math.max(0, duration)) / (total || 1));
    slices.push(audioBytes.slice(offset, offset + take));
    offset += take;
  }
  return slices;
}

/**
 * Serve one unscripted actor-turn line from the cached Grok voice replay
 * gateway: cached audio bytes paced with the recorded latency plus the STT
 * word timestamps as protocol messages. A cache miss returns the gateway
 * error code on the socket; the path never falls back to another timing.
 * Fire-and-forget: every path ends in voice.stopped or voice.error.
 */
export function serveGrokVoiceReplayTurn(
  socket: BunRealtimeVoiceWebSocket,
  control: Record<string, unknown>,
  replay: ResolvedBunRealtimeVoiceReplayOptions,
): void {
  serveGrokVoiceReplayTurnAsync(socket, control, replay).catch(() => undefined);
}

async function serveGrokVoiceReplayTurnAsync(
  socket: BunRealtimeVoiceWebSocket,
  control: Record<string, unknown>,
  replay: ResolvedBunRealtimeVoiceReplayOptions,
): Promise<void> {
  const text = optionalString(control["text"]);
  const stationRunId = optionalString(control["stationRunId"]) ?? "live";
  const actorId = optionalString(control["actorId"]) ?? "actor_replay_v1";
  const voiceId = optionalString(control["voiceId"]) ?? replay.voice;
  const requestId =
    optionalString(control["requestId"]) ??
    `${stationRunId}:replay:${grokVoiceTtsKey(text ?? "", replay.voice).slice(0, 8)}`;
  if (!text) {
    sendJson(socket, {
      type: "voice.error",
      code: "invalid_actor_turn_request",
      providerId: "grok-voice",
      mode: "replay",
      requestId,
    });
    return;
  }

  const gateway = createDefaultVoiceGateway({
    adapters: [],
    routeId: GROK_VOICE_REPLAY_ROUTE_ID,
    voiceProvider: {
      kind: "grok-voice",
      mode: "replay",
      ...(replay.cacheDir !== undefined ? { cacheDir: replay.cacheDir } : {}),
      emulateLatency: replay.emulateLatency,
    },
  });
  const policy = {
    requestPolicyId: GROK_VOICE_REPLAY_POLICY_ID,
    safetyPolicyVersion: "clinical-simulation-safety-v1",
  };

  let audioEvents: AudioEvent[];
  try {
    audioEvents = await collectVoiceStream(
      gateway.synthesize({
        requestId,
        stationRunId,
        actorId,
        voiceId,
        text,
        performancePlanId: "live-replay-v1",
        policy,
      }),
    );
  } catch (error) {
    sendReplayError(socket, error, requestId);
    return;
  }

  const cacheDir = replay.cacheDir ?? path.join(process.env["HOME"] ?? "", ".openclinxr-cache", "grok-voice");
  const key = grokVoiceTtsKey(text, replay.voice);
  let audioBytes: Uint8Array;
  let entry: { audioSha256: string; words: ReplayWord[] };
  try {
    audioBytes = new Uint8Array(readFileSync(path.join(cacheDir, `${key}.mp3`)));
    entry = readReplayCacheEntry(cacheDir, key, audioBytes);
  } catch (error) {
    if (error instanceof Error && !("code" in error)) {
      (error as { code?: string }).code = "grok_voice_cache_miss";
    }
    sendReplayError(socket, error, requestId);
    return;
  }

  let transcriptEvents: Array<{ eventType: string; text: string; atMs: number }>;
  try {
    transcriptEvents = await collectVoiceStream(
      gateway.transcribe({
        requestId,
        stationRunId,
        streamId: `grok-audio:${entry.audioSha256}`,
        language: "en-US",
        audioFormat: "audio/mpeg",
        policy,
      }),
    );
  } catch (error) {
    sendReplayError(socket, error, requestId);
    return;
  }

  if (entry.words.length !== audioEvents.length) {
    const corrupt = new Error(
      `grok-voice cache word/chunk mismatch: words=${entry.words.length} chunks=${audioEvents.length}`,
    );
    (corrupt as { code?: string }).code = "grok_voice_cache_corrupt";
    sendReplayError(socket, corrupt, requestId);
    return;
  }

  sendJson(socket, {
    type: realtimeVoiceProtocol.serverEvents.voiceStarted,
    requestId,
    text,
    providerId: "grok-voice",
    mode: "replay",
    audioSha256: entry.audioSha256,
    chunkCount: audioEvents.length,
    voice: replay.voice,
  });

  const slices = splitReplayAudio(
    audioBytes,
    audioEvents.map((event) => event.durationMs),
  );
  const partials = transcriptEvents.filter((event) => event.eventType === "partial_transcript");
  for (const [index, audio] of audioEvents.entries()) {
    sendJson(socket, {
      type: realtimeVoiceProtocol.serverEvents.audioChunk,
      requestId,
      chunkIndex: audio.chunkIndex,
      durationMs: audio.durationMs,
      audioFormat: "audio/mpeg",
      chunkCount: audioEvents.length,
    });
    socket.send(slices[index] ?? new Uint8Array(0));
    const word = entry.words[index];
    const partial = partials[index];
    sendJson(socket, {
      type: realtimeVoiceProtocol.serverEvents.transcriptPartial,
      requestId,
      wordIndex: index,
      word: word?.word ?? "",
      text: partial?.text ?? "",
      startS: word?.start ?? 0,
      endS: word?.end ?? 0,
      atMs: partial?.atMs ?? 0,
    });
  }

  const final = transcriptEvents.find((event) => event.eventType === "final_transcript");
  sendJson(socket, {
    type: realtimeVoiceProtocol.serverEvents.transcriptFinal,
    requestId,
    text: final?.text ?? text,
    atMs: final?.atMs ?? 0,
  });
  sendJson(socket, {
    type: realtimeVoiceProtocol.serverEvents.voiceStopped,
    requestId,
    chunkCount: audioEvents.length,
    totalBytes: audioBytes.byteLength,
  });
}
