import { describe, expect, it } from "vitest";
import type { ActorTurnPlan } from "@openclinxr/shared-schemas";
import {
  requestUnscriptedLiveTurn,
  type LiveVoiceAudioContext,
  type LiveVoiceSocket,
  type LiveVoiceTurnRequest,
} from "@openclinxr/xr-dialogue/package-actor-turn";

/**
 * Live voice turn client through the package entrypoint only: an unscripted
 * actor line streams over the voice socket, decodes with Web Audio, bakes
 * STT-timed cues, and plays audio + visemes on one clock with tier live.
 * A voice.error surfaces its code and never falls back.
 */

const PLAN_ID = "plan_live_client_001";
const TURN_ID = "turn_live_client_001";
const ACTOR_ID = "parent_tara_johnson_v1";
const LINE = "I feel the pain is better now.";

function samplePlan(): ActorTurnPlan {
  return {
    planId: PLAN_ID,
    planVersion: 1,
    turnId: TURN_ID,
    stationRunId: "run_peds",
    actorId: ACTOR_ID,
    respondingActorId: ACTOR_ID,
    turnIndex: 0,
    spokenText: LINE,
    spokenTextForTts: LINE,
    dialogueEmotionFrom: "neutral",
    dialogueEmotionTo: "concerned",
    somaticEmotion: null,
    eventKind: "learner_clinical_question",
    eventKindSource: "classifier",
    intensityBucket: "mid",
    ageBand: "adult",
    performancePlanId: "perf_concerned_adult_mid",
    facePresetId: "face.concerned",
    posePresetId: "pose_upright_adult",
    gestureClipIds: [],
    prosody: { wrapTags: [], inlineTags: [], speed: 1, droppedTags: [] },
    voiceId: "ara",
    languageProvenance: { fallbackUsed: false, providerId: "grok-voice" },
    claimScope: "simulated_actor_behavior",
    notEvidenceFor: ["clinical_affect_inference", "empathy_score", "licensure"],
  };
}

type ScriptedSocket = LiveVoiceSocket & { emit(data: string | Uint8Array): void; sent: string[] };

function fakeSocket(): ScriptedSocket {
  const sent: string[] = [];
  let handler: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  const socket = {
    sent,
    send(data: string | ArrayBuffer | Uint8Array): void {
      sent.push(typeof data === "string" ? data : "binary");
    },
    close(): void {},
    emit(data: string | Uint8Array): void {
      handler?.({ data: data as string | ArrayBuffer });
    },
  } as ScriptedSocket;
  Object.defineProperty(socket, "onmessage", {
    get: () => handler,
    set: (fn) => {
      handler = fn;
    },
  });
  Object.defineProperty(socket, "onerror", { get: () => null, set: () => undefined });
  return socket;
}

/** Web Audio fake: leading silence then a voiced sine, so the onset snap has work. */
function fakeAudioContext(): LiveVoiceAudioContext {
  return {
    decodeAudioData: async () => {
      const sampleRate = 16000;
      const samples = new Float32Array(sampleRate * 2);
      for (let i = 0; i < samples.length; i += 1) {
        const t = i / sampleRate;
        samples[i] = t < 0.14 ? 0 : Math.sin(2 * Math.PI * 220 * t) * 0.5;
      }
      return { sampleRate, getChannelData: () => samples };
    },
  };
}

const STT_WORDS = [
  { word: "I", start: 0.14, end: 0.24 },
  { word: "feel", start: 0.27, end: 0.46 },
  { word: "the", start: 0.58, end: 0.62 },
  { word: "pain", start: 0.68, end: 0.97 },
  { word: "is", start: 0.97, end: 1.06 },
  { word: "better", start: 1.17, end: 1.44 },
  { word: "now.", start: 1.44, end: 1.7 },
];

function emitTurn(socket: ScriptedSocket, requestId: string): void {
  socket.emit(JSON.stringify({ type: "voice.started", requestId, chunkCount: 1 }));
  socket.emit(JSON.stringify({ type: "audio.chunk", requestId, chunkIndex: 0, chunkCount: 1 }));
  socket.emit(new Uint8Array([0xff, 0xfb, 0x90, 0x00]));
  for (const word of STT_WORDS) {
    socket.emit(JSON.stringify({ type: "transcript.partial", requestId, word: word.word, startS: word.start, endS: word.end }));
  }
  socket.emit(JSON.stringify({ type: "transcript.final", requestId, text: LINE }));
  socket.emit(JSON.stringify({ type: "voice.stopped", requestId, chunkCount: 1 }));
}

describe("live voice turn client", () => {
  it("streams an unscripted turn and plays audio plus visemes on one clock with tier live", async () => {
    const socket = fakeSocket();
    const request: LiveVoiceTurnRequest = {
      text: LINE,
      stationRunId: "run_peds",
      actorId: ACTOR_ID,
      requestId: "req_live_001",
    };
    const seen: number[] = [];
    const pending = requestUnscriptedLiveTurn({
      request,
      openSocket: () => socket,
      socketUrl: "ws://127.0.0.1:1/voice/realtime/ws",
      audioContext: fakeAudioContext(),
      plan: samplePlan(),
      audioUri: "replay:live-pain",
      adapters: {
        startAudio: (ctx) => {
          seen.push(ctx.timelineOriginMs);
          return true;
        },
        startViseme: (ctx) => {
          seen.push(ctx.timelineOriginMs);
          return true;
        },
        startGaze: () => true,
        startEmotion: () => true,
      },
      nowMs: 5000,
    });
    emitTurn(socket, "req_live_001");
    const { baked, trace } = await pending;
    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]).toContain("actor.turn.request");
    expect(baked.sttWords.map((word) => word.word)).toEqual(["I", "feel", "the", "pain", "is", "better", "now."]);
    expect(baked.cues.length).toBeGreaterThan(4);
    expect(baked.cues.at(0)?.phone.replace(/[0-2]$/u, "")).toBe("AY");
    expect(baked.firstCueS).toBeCloseTo(0.14, 1);
    expect(trace.lipSyncTierPlayed).toBe("live");
    expect(trace.timelineOriginMs).toBe(5000);
    expect(seen).toEqual([5000, 5000]);
  });

  it("a voice.error surfaces its code and never falls back", async () => {
    const socket = fakeSocket();
    const pending = requestUnscriptedLiveTurn({
      request: { text: LINE, stationRunId: "run_peds", actorId: ACTOR_ID, requestId: "req_live_002" },
      openSocket: () => socket,
      socketUrl: "ws://127.0.0.1:1/voice/realtime/ws",
      audioContext: fakeAudioContext(),
      plan: samplePlan(),
      audioUri: "replay:live-pain",
      adapters: { startAudio: () => true, startViseme: () => true, startGaze: () => true, startEmotion: () => true },
    });
    socket.emit(
      JSON.stringify({ type: "voice.error", requestId: "req_live_002", code: "grok_voice_cache_miss", providerId: "grok-voice" }),
    );
    await expect(pending).rejects.toThrow("grok_voice_cache_miss");
  });
});
