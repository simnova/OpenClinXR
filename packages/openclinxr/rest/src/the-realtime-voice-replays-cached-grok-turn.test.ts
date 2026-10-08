import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBunServerConfig } from "./index.js";

/**
 * Live tier server voice (MADR 0017 WebSocket-first, MADR 0019 provider
 * adapters): with grok-voice replay configured, an actor-turn request for an
 * unscripted line is served by createDefaultVoiceGateway replay — cached
 * audio bytes paced with the recorded latency plus STT word timestamps as
 * protocol messages. A cache miss returns the gateway error code on the
 * socket, never a silent fallback.
 *
 * Cue-track note: the server streams the exact cached bytes and STT words;
 * the ARPABET cue track itself is baked downstream through the xr-dialogue
 * live plan (same arithmetic the player consumes). The pain-line evidence
 * below proves the server delivered the bytes and words that bake to the
 * committed live-grok cues within one frame. No new package export was
 * needed, so no psr-c6 exception is staged.
 */

const TTS_MODEL = "x-ai/grok-voice-tts-1.0";
const STT_MODEL = "x-ai/grok-stt-1.0";
const VOICE = "ara";
const FRAME_S = 1 / 30;

const sha = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** Test-local key pin (no package import): must equal the voice-gateway derivation. */
const ttsKey = (text: string): string =>
  sha(JSON.stringify({ kind: "tts", model: TTS_MODEL, voice: VOICE, response_format: "mp3", input: text }));
const sttKey = (audioSha256: string): string =>
  sha(
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

type CollectedFrame = { json: Record<string, unknown> } | { binary: Uint8Array };

type ReplayTestSocket = {
  frames: CollectedFrame[];
  send(frame: string | Uint8Array): number;
};

function fakeSocket(): ReplayTestSocket {
  const frames: CollectedFrame[] = [];
  return {
    frames,
    send(frame: string | Uint8Array): number {
      if (typeof frame === "string") {
        frames.push({ json: JSON.parse(frame) as Record<string, unknown> });
      } else {
        frames.push({ binary: frame instanceof Uint8Array ? frame : new Uint8Array(frame) });
      }
      return 1;
    },
  };
}

function jsonFrames(socket: { frames: CollectedFrame[] }, type: string): Record<string, unknown>[] {
  return socket.frames.flatMap((frame) => ("json" in frame) && frame.json["type"] === type ? [frame.json] : []);
}

function binaryBytes(socket: { frames: CollectedFrame[] }): Uint8Array {
  const parts = socket.frames.flatMap((frame) => ("binary" in frame ? [frame.binary] : []));
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function requestTurn(
  socket: ReplayTestSocket,
  handler: ReturnType<typeof createBunServerConfig>["websocket"],
  control: Record<string, unknown>,
): Promise<void> {
  handler.open(socket);
  handler.message(socket, JSON.stringify({ type: "actor.turn.request", ...control }));
  const start = Date.now();
  for (;;) {
    const types = socket.frames.flatMap((frame) => ("json" in frame ? [String(frame.json["type"])] : []));
    if (types.includes("voice.stopped") || types.includes("voice.error")) return;
    if (Date.now() - start > 10_000) throw new Error("replay turn did not terminate");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("realtime voice grok replay turn", () => {
  it("serves cached bytes paced with word timing, fetch stubbed to throw", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      (async (url: unknown) => {
        calls.push(String(url));
        throw new Error("network-call-in-replay");
      }) as unknown as typeof fetch,
    );
    const dir = mkdtempSync(path.join(tmpdir(), "realtime-grok-replay-"));
    const text = "Give the albuterol now.";
    const words = [
      { word: "Give", start: 0.1, end: 0.3 },
      { word: "the", start: 0.32, end: 0.4 },
      { word: "albuterol", start: 0.42, end: 0.9 },
      { word: "now.", start: 0.92, end: 1.1 },
    ];
    const audio = new Uint8Array(Array.from({ length: 4096 }, (_, i) => (i * 7 + 3) % 251));
    const audioSha = sha(audio);
    const key = ttsKey(text);
    writeFileSync(path.join(dir, `${key}.mp3`), audio);
    writeFileSync(
      path.join(dir, `${key}.json`),
      JSON.stringify({ key, audioSha256: audioSha, bytes: audio.length, generationId: "gen-fixture", contentType: "audio/mpeg" }),
    );
    writeFileSync(
      path.join(dir, `${sttKey(audioSha)}.json`),
      JSON.stringify({ text: words.map((w) => w.word).join(" "), words, usage: {} }),
    );

    const socket = fakeSocket();
    const config = createBunServerConfig(undefined, {
      grokVoiceReplay: { cacheDir: dir, voice: VOICE, emulateLatency: false },
    });
    expect(config.canUpgradeWebSocketRequest(new Request("http://localhost/voice/realtime/ws", { headers: { upgrade: "websocket" } }))).toBe(
      true,
    );
    await requestTurn(socket, config.websocket, { text, stationRunId: "run_001", actorId: "patient_maya_johnson_v1", voiceId: VOICE });

    const started = jsonFrames(socket, "voice.started");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ providerId: "grok-voice", mode: "replay", text, audioSha256: audioSha, chunkCount: 4 });

    expect(sha(binaryBytes(socket))).toBe(audioSha);

    const chunks = jsonFrames(socket, "audio.chunk");
    expect(chunks.map((c) => c["durationMs"])).toEqual([200, 80, 480, 180]);
    expect(chunks.map((c) => c["chunkIndex"])).toEqual([0, 1, 2, 3]);

    const partials = jsonFrames(socket, "transcript.partial");
    expect(partials.map((p) => [p["word"], p["startS"], p["endS"], p["atMs"]])).toEqual([
      ["Give", 0.1, 0.3, 300],
      ["the", 0.32, 0.4, 400],
      ["albuterol", 0.42, 0.9, 900],
      ["now.", 0.92, 1.1, 1100],
    ]);

    const final = jsonFrames(socket, "transcript.final");
    expect(final).toHaveLength(1);
    expect(final[0]).toMatchObject({ text, atMs: 1100 });

    const stopped = jsonFrames(socket, "voice.stopped");
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toMatchObject({ chunkCount: 4, totalBytes: audio.length });

    expect(jsonFrames(socket, "voice.error")).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("a cache miss returns the gateway error code, never a fallback", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      (async (url: unknown) => {
        calls.push(String(url));
        throw new Error("network-call-in-replay");
      }) as unknown as typeof fetch,
    );
    const dir = mkdtempSync(path.join(tmpdir(), "realtime-grok-replay-empty-"));
    const socket = fakeSocket();
    const config = createBunServerConfig(undefined, {
      grokVoiceReplay: { cacheDir: dir, voice: VOICE, emulateLatency: false },
    });
    await requestTurn(socket, config.websocket, { text: "an unrecorded line", stationRunId: "run_001" });

    const errors = jsonFrames(socket, "voice.error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "grok_voice_cache_miss", providerId: "grok-voice" });
    expect(jsonFrames(socket, "voice.started")).toEqual([]);
    expect(jsonFrames(socket, "voice.stopped")).toEqual([]);
    expect(binaryBytes(socket)).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  it("default mode keeps the echo contract and refuses actor turns", async () => {
    const socket = fakeSocket();
    const config = createBunServerConfig(undefined, {});
    config.websocket.open(socket);
    expect(jsonFrames(socket, "gateway.ready")[0]).not.toHaveProperty("voiceReplay");
    config.websocket.message(socket, JSON.stringify({ type: "actor.turn.request", text: "hello" }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const errors = jsonFrames(socket, "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ reason: "unsupported_control_type", controlType: "actor.turn.request" });
  });
});

const MACHINE_CACHE = path.join(homedir(), ".openclinxr-cache", "grok-voice");
const PAIN_TEXT = "I feel the pain is better now.";
const PAIN_CACHE_KEY = "4c7ea6c05c3a11bc710fd3c6e7fb9b1930e0afa381c29217c092b24febfcab3e";
const painCachePresent = existsSync(path.join(MACHINE_CACHE, `${PAIN_CACHE_KEY}.mp3`));

describe("realtime voice replays the pain line from cache", () => {
  it.runIf(painCachePresent)(
    "audio bytes hash to the cache entry and cue timings match live-grok pain within 1 frame",
    async () => {
      const calls: string[] = [];
      vi.stubGlobal(
        "fetch",
        (async (url: unknown) => {
          calls.push(String(url));
          throw new Error("network-call-in-replay");
        }) as unknown as typeof fetch,
      );
      const root = path.resolve(import.meta.dirname, "..", "..", "..", "..");
      const metrics = JSON.parse(
        readFileSync(path.join(root, "docs", "openclinxr", "mouth-dynamics", "live-grok", "pain", "metrics.json"), "utf8"),
      ) as { audioSha256: string; liveArpabet: Array<{ startS: number; endS: number; phone: string }> };

      const socket = fakeSocket();
      const config = createBunServerConfig(undefined, {
        grokVoiceReplay: { cacheDir: MACHINE_CACHE, voice: VOICE, emulateLatency: false },
      });
      await requestTurn(socket, config.websocket, {
        text: PAIN_TEXT,
        stationRunId: "run_peds",
        actorId: "parent_tara_johnson_v1",
        voiceId: VOICE,
      });

      expect(jsonFrames(socket, "voice.error")).toEqual([]);
      const received = binaryBytes(socket);
      expect(sha(received)).toBe(metrics.audioSha256);

      const partials = jsonFrames(socket, "transcript.partial");
      const sttEntry = JSON.parse(
        readFileSync(path.join(MACHINE_CACHE, `${sttKey(metrics.audioSha256)}.json`), "utf8"),
      ) as { words: Array<{ word: string; start: number; end: number }> };
      expect(partials.map((p) => [p["word"], p["startS"], p["endS"]])).toEqual(
        sttEntry.words.map((w) => [w.word, w.start, w.end]),
      );

      const jobDir = mkdtempSync(path.join(tmpdir(), "realtime-grok-pain-bake-"));
      const receivedMp3 = path.join(jobDir, "received.mp3");
      writeFileSync(receivedMp3, received);
      const raw: Buffer = execFileSync(
        "ffmpeg",
        ["-v", "error", "-i", receivedMp3, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-f", "s16le", "-"],
        { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
      );
      const bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
      const frames = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
      const floats = new Float32Array(frames.length);
      for (let i = 0; i < frames.length; i += 1) floats[i] = frames[i]! / 32768;
      const phonesAll = JSON.parse(
        readFileSync(path.join(root, "apps", "arena", "viseme-audio-clock", "grok-voice", "phone-plans.json"), "utf8"),
      ) as Record<string, { phones: string[] }>;
      const pronunciations = Object.fromEntries(Object.entries(phonesAll).map(([word, entry]) => [word, entry.phones]));
      const bakeInput = path.join(jobDir, "bake-in.json");
      writeFileSync(
        bakeInput,
        JSON.stringify({
          sampleRate: 16000,
          samplesB64: Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength).toString("base64"),
          sttWords: partials.map((p) => ({ word: String(p["word"]), start: Number(p["startS"]), end: Number(p["endS"]) })),
          transcript: PAIN_TEXT,
          pronunciations,
        }),
      );
      const tsx = path.join(root, "node_modules", ".bin", "tsx");
      const out = execFileSync(tsx, [path.join(root, "packages", "openclinxr", "xr-dialogue", "src", "cli", "live-stt-bake.ts"), "--input", bakeInput], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      const baked = JSON.parse(out) as { cues: Array<{ startS: number; endS: number; phone: string }>; mismatches: string[]; oovWords: string[] };
      expect(baked.mismatches).toEqual([]);
      expect(baked.oovWords).toEqual([]);
      expect(baked.cues).toHaveLength(metrics.liveArpabet.length);
      for (const [index, cue] of baked.cues.entries()) {
        const expected = metrics.liveArpabet[index]!;
        expect(Math.abs(cue.startS - expected.startS)).toBeLessThanOrEqual(FRAME_S + 1e-9);
        expect(Math.abs(cue.endS - expected.endS)).toBeLessThanOrEqual(FRAME_S + 1e-9);
        expect(cue.phone).toBe(expected.phone);
      }
      expect(calls).toEqual([]);
    },
    60_000,
  );
});
