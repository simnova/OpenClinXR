import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectVoiceStream, createDefaultVoiceGateway } from "./index.js";

const MACHINE_CACHE = path.join(homedir(), ".openclinxr-cache", "grok-voice");
const machineCachePresent = existsSync(MACHINE_CACHE);

const POLICY = {
  requestPolicyId: "voice-grok-v1",
  safetyPolicyVersion: "clinical-simulation-safety-v1",
};

const TTS_MODEL = "x-ai/grok-voice-tts-1.0";
const STT_MODEL = "x-ai/grok-stt-1.0";
const VOICE = "ara";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Cache keys re-derived here (test-local pin, no package import): must equal the manifest. */
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

function throwingFetch(calls: string[] = []): typeof fetch {
  return (async (url: unknown) => {
    calls.push(String(url));
    throw new Error("network-call-in-replay");
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("grok voice cache keys match the arena manifest", () => {
  // Texts and keys copied verbatim from
  // apps/arena/viseme-audio-clock/grok-voice/cache-manifest.json (2026-10-08 recordings).
  const ttsCases: Array<[string, string]> = [
    [
      "That quick beige fox jumped in the air over each thin dog. Look out, I shout, for he's foiled you again, creating chaos.",
      "efada122b1c5291ce1379b8b3eef8e0e3b41f13789d424154e439f2c2474749a",
    ],
    [
      "put. fat. think. tip. call. chair. sir. lot. red. car. bed. toe. book.",
      "92ef20d39c8f5dbc773562dd5a5eeae1543e130d2683df5ed375650f214dd60a",
    ],
    [
      "I feel the pain is better now.",
      "4c7ea6c05c3a11bc710fd3c6e7fb9b1930e0afa381c29217c092b24febfcab3e",
    ],
    ["Give the albuterol now.", "8b64f6d00a949d81785c52440b2d3ff37c32cf3ee376ec6d436e9f3265605521"],
  ];
  for (const [text, key] of ttsCases) {
    it(`tts key matches manifest for ${key.slice(0, 8)}`, () => {
      expect(ttsKey(text)).toBe(key);
    });
  }

  // audioSha256 values from the manifest; expected stems are the on-disk
  // ~/.openclinxr-cache/grok-voice/<sttKey>.json filenames verified 2026-10-08.
  const sttCases: Array<[string, string]> = [
    [
      "378a2974343beb50c370b9e36e3c1f55cfaf29f417dbff120d3ebe6392224ec1",
      "68595aa8ddf56c4018d3a11563e72d464b21f57072b5ef3be72895faff88f879",
    ],
    [
      "e2d91fdedcb6d48bf8af9a699d9d0bc88420a6bd6fdd675f90e8bdb831a573ec",
      "b308934ea37fe693181da4bb1760f05d82791a92ea637b3ef7b247c6108766ed",
    ],
    [
      "2220474e80fe179bb81b9b79cc0fe4294906c31f734fd25b3fc7a7f55fdf017e",
      "af057114f957a322d265eef8d42605125b8924e0b7b53467897ed01d893fe63b",
    ],
    [
      "173b1c6da43e3e91b237db3ecb2055e6833eb421052b69cb0d2c827b2c337c12",
      "ace264f93ae42207fa8b7ca2698f1065da8071dc239c9f8667aa1a5969446ba1",
    ],
  ];
  for (const [audioSha, key] of sttCases) {
    it(`stt key matches cache entry for audio ${audioSha.slice(0, 8)}`, () => {
      expect(sttKey(audioSha)).toBe(key);
    });
  }
});

type FixtureWord = { word: string; start: number; end: number };

const FIXTURE_WORDS: FixtureWord[] = [
  { word: "Give", start: 0.1, end: 0.3 },
  { word: "the", start: 0.32, end: 0.4 },
  { word: "albuterol", start: 0.42, end: 0.9 },
  { word: "now.", start: 0.92, end: 1.1 },
];

function seedCache(dir: string, text: string, words: FixtureWord[]): string {
  const audio = new Uint8Array(Array.from({ length: 4096 }, (_, i) => i % 251));
  const audioSha = createHash("sha256").update(audio).digest("hex");
  const key = ttsKey(text);
  writeFileSync(path.join(dir, `${key}.mp3`), audio);
  writeFileSync(
    path.join(dir, `${key}.json`),
    JSON.stringify({
      key,
      audioSha256: audioSha,
      bytes: audio.length,
      generationId: "gen-fixture",
      contentType: "audio/mpeg",
      grokVoice: { ttfbMs: 40, totalMs: 120, recordedAt: "2026-10-08T00:00:00.000Z" },
    }),
  );
  writeFileSync(
    path.join(dir, `${sttKey(audioSha)}.json`),
    JSON.stringify({
      text: words.map((w) => w.word).join(" "),
      words,
      usage: {},
      raw: {},
      grokVoice: { totalMs: 60, recordedAt: "2026-10-08T00:00:00.000Z" },
    }),
  );
  return audioSha;
}

function replayGateway(cacheDir: string, calls: string[] = [], emulateLatency = true) {
  vi.stubGlobal("fetch", throwingFetch(calls));
  return createDefaultVoiceGateway({
    adapters: [],
    routeId: "voice-grok-v1",
    voiceProvider: { kind: "grok-voice", mode: "replay", cacheDir, emulateLatency },
  });
}

function synthInput(text: string) {
  return {
    stationRunId: "run_001",
    actorId: "patient_maya_johnson_v1",
    voiceId: "grok-ara",
    text,
    performancePlanId: "neutral-v1",
    policy: POLICY,
  };
}

function sttInput(streamId: string) {
  return {
    stationRunId: "run_001",
    streamId,
    language: "en-US",
    audioFormat: "audio/mpeg",
    policy: POLICY,
  };
}

function errorCode(error: unknown): string {
  return (error as { code?: string }).code ?? "<no-code>";
}

describe("grok voice replay through the public factory", () => {
  it("reports ready health without credentials or network", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grok-voice-"));
    const gateway = replayGateway(dir);
    expect(await gateway.health()).toEqual([{ providerId: "grok-voice", status: "ready" }]);
  });

  it("streams one audio chunk per word with word timing, fetch stubbed to throw", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grok-voice-"));
    seedCache(dir, "Give the albuterol now.", FIXTURE_WORDS);
    const gateway = replayGateway(dir);
    const chunks = await collectVoiceStream(gateway.synthesize(synthInput("Give the albuterol now.")));
    expect(chunks).toHaveLength(4);
    expect(chunks.map((c) => c.durationMs)).toEqual([200, 80, 480, 180]);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2, 3]);
    expect(chunks[0]).toMatchObject({
      eventType: "audio_chunk",
      audioFormat: "audio/mpeg",
      provenance: expect.objectContaining({
        providerId: "grok-voice",
        modelId: "x-ai/grok-voice-tts-1.0",
        safetyStatus: "not_exercised",
      }),
    });
  });

  it("emits partials per word plus a final transcript", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grok-voice-"));
    const audioSha = seedCache(dir, "Give the albuterol now.", FIXTURE_WORDS);
    const gateway = replayGateway(dir, [], false);
    const events = await collectVoiceStream(gateway.transcribe(sttInput(`grok-audio:${audioSha}`)));
    expect(events.map((e) => e.eventType)).toEqual([
      "partial_transcript",
      "partial_transcript",
      "partial_transcript",
      "partial_transcript",
      "final_transcript",
    ]);
    expect(events.at(-1)).toMatchObject({
      text: "Give the albuterol now.",
      confidence: 0.99,
      atMs: 1100,
      provenance: expect.objectContaining({ providerId: "grok-voice", modelId: "x-ai/grok-stt-1.0" }),
    });
  });

  it("paces replay with the recorded latency unless emulateLatency is false", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grok-voice-"));
    seedCache(dir, "Give the albuterol now.", FIXTURE_WORDS);
    const t0 = performance.now();
    await collectVoiceStream(replayGateway(dir).synthesize(synthInput("Give the albuterol now.")));
    expect(performance.now() - t0).toBeGreaterThanOrEqual(30);
    const t1 = performance.now();
    await collectVoiceStream(replayGateway(dir, [], false).synthesize(synthInput("Give the albuterol now.")));
    expect(performance.now() - t1).toBeLessThan(30);
  });

  it("a miss is a stable code and never reaches the network", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grok-voice-empty-"));
    const calls: string[] = [];
    const gateway = replayGateway(dir, calls);
    const synthError = await collectVoiceStream(gateway.synthesize(synthInput("unrecorded line"))).then(
      () => null,
      (e: unknown) => e,
    );
    expect(errorCode(synthError)).toBe("grok_voice_cache_miss");
    const sttError = await collectVoiceStream(gateway.transcribe(sttInput(`grok-audio:${"0".repeat(64)}`))).then(
      () => null,
      (e: unknown) => e,
    );
    expect(errorCode(sttError)).toBe("grok_voice_cache_miss");
    expect(calls).toEqual([]);
  });

  it("rejects a streamId that names no cached audio", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grok-voice-empty-"));
    const gateway = replayGateway(dir);
    const error = await collectVoiceStream(gateway.transcribe(sttInput("learner-mic-001"))).then(
      () => null,
      (e: unknown) => e,
    );
    expect(errorCode(error)).toBe("grok_voice_audio_unavailable");
  });
});

describe("grok voice record and live through the public factory", () => {
  const TTS_BYTES = new Uint8Array(Array.from({ length: 2048 }, (_, i) => (i * 7) % 251));
  const STT_JSON = {
    text: "Hello test.",
    words: [
      { word: "Hello", start: 0.1, end: 0.4 },
      { word: "test.", start: 0.45, end: 0.7 },
    ],
    usage: { cost: 0.00005 },
  };

  function stubFetch(calls: string[]): typeof fetch {
    return (async (url: unknown) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type"
              ? "audio/mpeg"
              : name.toLowerCase() === "x-generation-id"
                ? "gen-stub-1"
                : null,
        },
        arrayBuffer: async () => TTS_BYTES.buffer.slice(0) as ArrayBuffer,
        json: async () => structuredClone(STT_JSON),
        text: async () => "",
      };
    }) as unknown as typeof fetch;
  }

  function recordGateway(cacheDir: string, calls: string[]) {
    vi.stubGlobal("fetch", stubFetch(calls));
    return createDefaultVoiceGateway({
      adapters: [],
      routeId: "voice-grok-v1",
      voiceProvider: { kind: "grok-voice", mode: "record", cacheDir, emulateLatency: false },
    });
  }

  it("record calls OpenRouter, writes cache plus latency, and never persists the key", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grok-voice-record-"));
    const calls: string[] = [];
    vi.stubEnv("OPENROUTER_API_KEY", "test-sentinel-key-do-not-persist");
    const gateway = recordGateway(dir, calls);
    const chunks = await collectVoiceStream(gateway.synthesize(synthInput("Hello test.")));
    expect(chunks).toHaveLength(2);
    expect(calls).toHaveLength(2);
    const key = ttsKey("Hello test.");
    const meta = JSON.parse(readFileSync(path.join(dir, `${key}.json`), "utf8")) as {
      generationId: string;
      grokVoice: { ttfbMs: number; totalMs: number };
    };
    expect(meta.generationId).toBe("gen-stub-1");
    expect(meta.grokVoice.ttfbMs).toEqual(expect.any(Number));
    expect(meta.grokVoice.totalMs).toEqual(expect.any(Number));
    for (const file of readdirSync(dir)) {
      expect(readFileSync(path.join(dir, file), "utf8")).not.toContain("test-sentinel-key-do-not-persist");
    }
    const again = await collectVoiceStream(gateway.synthesize(synthInput("Hello test.")));
    expect(again).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  it("record transcribe needs audioBytes, then returns word timestamps", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grok-voice-record-"));
    const calls: string[] = [];
    vi.stubEnv("OPENROUTER_API_KEY", "test-sentinel-key-do-not-persist");
    const gateway = recordGateway(dir, calls);
    const missing = await collectVoiceStream(gateway.transcribe(sttInput("learner-mic-001"))).then(
      () => null,
      (e: unknown) => e,
    );
    expect(errorCode(missing)).toBe("grok_voice_audio_unavailable");
    const input = sttInput("learner-mic-001") as unknown as { audioBytes?: Uint8Array };
    input.audioBytes = TTS_BYTES;
    const events = await collectVoiceStream(
      gateway.transcribe(input as unknown as Parameters<typeof gateway.transcribe>[0]),
    );
    expect(events.at(-1)).toMatchObject({ eventType: "final_transcript", text: "Hello test." });
    expect(calls).toHaveLength(1);
  });

  it("live calls without writing cache", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grok-voice-live-"));
    const calls: string[] = [];
    vi.stubEnv("OPENROUTER_API_KEY", "test-sentinel-key-do-not-persist");
    vi.stubGlobal("fetch", stubFetch(calls));
    const gateway = createDefaultVoiceGateway({
      adapters: [],
      routeId: "voice-grok-v1",
      voiceProvider: { kind: "grok-voice", mode: "live", cacheDir: dir, emulateLatency: false },
    });
    const chunks = await collectVoiceStream(gateway.synthesize(synthInput("Hello test.")));
    expect(chunks).toHaveLength(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("record without credentials is a stable code before any fetch", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grok-voice-nokey-"));
    const calls: string[] = [];
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const gateway = recordGateway(dir, calls);
    const error = await collectVoiceStream(gateway.synthesize(synthInput("Hello test."))).then(
      () => null,
      (e: unknown) => e,
    );
    expect(errorCode(error)).toBe("grok_voice_credentials_missing");
    expect(calls).toEqual([]);
    expect(await gateway.health()).toEqual([{ providerId: "grok-voice", status: "ready" }]);
  });

  it("an upstream non-2xx is a stable code without the key", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "grok-voice-upstream-"));
    vi.stubEnv("OPENROUTER_API_KEY", "test-sentinel-key-do-not-persist");
    vi.stubGlobal(
      "fetch",
      (async () => ({
        ok: false,
        status: 429,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
        json: async () => ({}),
        text: async () => "rate limited",
      })) as unknown as typeof fetch,
    );
    const gateway = createDefaultVoiceGateway({
      adapters: [],
      routeId: "voice-grok-v1",
      voiceProvider: { kind: "grok-voice", mode: "live", cacheDir: dir, emulateLatency: false },
    });
    const error = await collectVoiceStream(gateway.synthesize(synthInput("Hello test."))).then(
      () => null,
      (e: unknown) => e,
    );
    expect(errorCode(error)).toBe("grok_voice_upstream_error");
    expect(String(error)).toContain("429");
    expect(String(error)).not.toContain("test-sentinel-key-do-not-persist");
  });
});

describe("grok voice replay against the machine cache", () => {
  it.runIf(machineCachePresent)("replays the pangram fixture without network", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", throwingFetch(calls));
    const gateway = createDefaultVoiceGateway({
      adapters: [],
      routeId: "voice-grok-v1",
      voiceProvider: { kind: "grok-voice", mode: "replay", emulateLatency: false },
    });
    expect(await gateway.health()).toEqual([{ providerId: "grok-voice", status: "ready" }]);
    const chunks = await collectVoiceStream(
      gateway.synthesize(
        synthInput(
          "That quick beige fox jumped in the air over each thin dog. Look out, I shout, for he's foiled you again, creating chaos.",
        ),
      ),
    );
    expect(chunks).toHaveLength(23);
    const events = await collectVoiceStream(
      gateway.transcribe(
        sttInput("grok-audio:378a2974343beb50c370b9e36e3c1f55cfaf29f417dbff120d3ebe6392224ec1"),
      ),
    );
    expect(events.at(-1)).toMatchObject({
      eventType: "final_transcript",
      text: "That quick beige fox jumped in the air over each thin dog. Look out, I shout, for he's foiled you again, creating chaos.",
    });
    expect(calls).toEqual([]);
  });
});
