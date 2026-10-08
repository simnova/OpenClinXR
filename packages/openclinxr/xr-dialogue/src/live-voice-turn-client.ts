/**
 * Browser-safe live voice turn client (unscripted actor line via API voice socket).
 *
 * Moved from apps/ui-xr (composition-root budget: behaviour lives in packages)
 * with imports rewritten to same-package relatives; the runtime-app call site
 * keeps a single call. Opens the realtime voice WebSocket served with
 * OPENCLINXR_VOICE_PROVIDER=grok-voice-replay, requests one unscripted line,
 * collects cached mp3 chunks + STT word timestamps, decodes the audio with Web
 * Audio, bakes the STT-timed cue track through the live plan, and plays audio
 * + visemes on one clock through the existing identity-bound player, recording
 * lipSyncTierPlayed 'live'. A cache miss surfaces voice.error, never a fallback.
 *
 * Browser-only: WebSocket + Web Audio only, no Node built-ins.
 *
 * claimScope: simulated_actor_behavior.
 * notEvidenceFor: Quest readiness, live speech provider, clinical affect.
 */

import {
  digestActorTurnPlan,
  playIdentityBoundActorTurn,
  type ActorTurnPlayerAdapters,
} from "./actor-turn-player.js";
import { bakeLiveSttCueTrack } from "./live-stt-plan.js";
import { DIALOGUE_PRONUNCIATIONS } from "./dialogue-pronunciations.js";
import type { ActorTurnPlan } from "@openclinxr/shared-schemas";

export type LiveVoiceSttWord = { word: string; start: number; end: number };

export type LiveVoiceTurnRequest = {
  text: string;
  stationRunId: string;
  actorId: string;
  voiceId?: string;
  requestId?: string;
};

export type LiveVoiceSocket = {
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(): void;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export type LiveVoiceAudioContext = {
  decodeAudioData(data: ArrayBuffer): Promise<{ sampleRate: number; getChannelData(channel: number): Float32Array }>;
};

export type LiveVoiceCollected = {
  audioBytes: Uint8Array;
  sttWords: LiveVoiceSttWord[];
  transcript: string;
  audioSha256?: string | undefined;
  chunkCount: number;
};

export type LiveVoiceBakedTurn = LiveVoiceCollected & {
  samples: Float32Array;
  sampleRate: number;
  cues: Array<{ startS: number; endS: number; phone: string }>;
  firstCueS: number;
};

export type LiveVoicePlaybackTrace = {
  lipSyncTierPlayed: "live";
  planId: string;
  turnId: string;
  timelineOriginMs: number;
  visemeCueCount: number;
  firstCueS: number;
};

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function toBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

/** Minimal pronunciation table for one transcript from the bank-scoped CMU subset. */
function pronunciationsForTranscript(transcript: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const raw of transcript.split(/\s+/)) {
    const key = raw.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/gu, "");
    if (!key) continue;
    const entry = DIALOGUE_PRONUNCIATIONS[key];
    if (typeof entry === "string" && entry.length > 0) {
      out[key] = entry.split(/\s+/);
    }
  }
  return out;
}

/**
 * Collect one unscripted turn from an already-open voice socket. Resolves on
 * voice.stopped, rejects on voice.error or socket error. Binary frames are the
 * cached mp3 slices; transcript.partial frames carry the STT words.
 */
function collectLiveVoiceTurn(
  socket: LiveVoiceSocket,
  request: LiveVoiceTurnRequest,
): Promise<LiveVoiceCollected> {
  const requestId = request.requestId ?? `${request.stationRunId}:live:${request.text.length}`;
  const chunks: Uint8Array[] = [];
  const words: LiveVoiceSttWord[] = [];
  let transcript = request.text;
  let chunkCount = 0;
  let settled = false;

  return new Promise<LiveVoiceCollected>((resolve, reject) => {
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const done = (value: LiveVoiceCollected): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    socket.onerror = (event) => {
      fail(new Error(`live-voice-socket-error:${String(event)}`));
    };
    socket.onmessage = (event) => {
      const data = event.data;
      if (typeof data !== "string") {
        chunks.push(toBytes(data as ArrayBuffer | Uint8Array));
        return;
      }
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (frame.requestId !== undefined && frame.requestId !== requestId) return;
      const type = String(frame.type ?? "");
      if (type === "audio.chunk") {
        chunkCount = Number(frame.chunkCount ?? chunkCount);
        return;
      }
      if (type === "transcript.partial") {
        words.push({
          word: String(frame.word ?? ""),
          start: Number(frame.startS ?? 0),
          end: Number(frame.endS ?? 0),
        });
        return;
      }
      if (type === "transcript.final") {
        if (typeof frame.text === "string" && frame.text.length > 0) {
          transcript = frame.text;
        }
        return;
      }
      if (type === "voice.started") {
        if (typeof frame.chunkCount === "number") chunkCount = frame.chunkCount;
        return;
      }
      if (type === "voice.stopped") {
        done({
          audioBytes: concatBytes(chunks),
          sttWords: [...words].sort((a, b) => a.start - b.start),
          transcript,
          audioSha256: typeof frame.audioSha256 === "string" ? frame.audioSha256 : undefined,
          chunkCount,
        });
        return;
      }
      if (type === "voice.error") {
        fail(
          Object.assign(new Error(`live-voice-error:${String(frame.code ?? "voice_replay_failed")}`), {
            code: String(frame.code ?? "voice_replay_failed"),
          }),
        );
      }
    };
    socket.send(
      JSON.stringify({
        type: "actor.turn.request",
        requestId,
        text: request.text,
        stationRunId: request.stationRunId,
        actorId: request.actorId,
        ...(request.voiceId !== undefined ? { voiceId: request.voiceId } : {}),
      }),
    );
  });
}

/** Decode cached mp3 bytes with Web Audio into mono float samples. */
function decodeLiveVoiceAudio(
  audioBytes: Uint8Array,
  audioContext: LiveVoiceAudioContext,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const copy = new ArrayBuffer(audioBytes.byteLength);
  new Uint8Array(copy).set(audioBytes);
  return audioContext.decodeAudioData(copy).then((decoded) => ({
    samples: decoded.getChannelData(0),
    sampleRate: decoded.sampleRate,
  }));
}

/** Bake decoded samples + STT words into the live ARPABET cue track. */
function bakeLiveVoiceCues(input: {
  samples: Float32Array;
  sampleRate: number;
  sttWords: LiveVoiceSttWord[];
  transcript: string;
}): LiveVoiceBakedTurn["cues"] {
  const result = bakeLiveSttCueTrack({
    samples: input.samples,
    sampleRate: input.sampleRate,
    sttWords: input.sttWords,
    transcript: input.transcript,
    pronunciations: pronunciationsForTranscript(input.transcript),
  });
  return result.cues;
}

/**
 * Play decoded + baked live turn through the identity-bound player on one clock.
 * Audio and visemes share timelineOriginMs; the trace records lipSyncTierPlayed live.
 */
function playLiveVoiceTurn(input: {
  plan: ActorTurnPlan;
  audioUri: string;
  audioDurationMs: number;
  cues: Array<{ startS: number; endS: number; phone: string }>;
  gaze?: { gazeTargetKind: "learner_camera" | "actor"; gazeTargetActorId: string | null };
  adapters: ActorTurnPlayerAdapters;
  nowMs?: number | undefined;
}): { status: string; trace: LiveVoicePlaybackTrace } {
  const plan = input.plan;
  const id = { actorId: plan.actorId, turnId: plan.turnId, planDigest: digestActorTurnPlan(plan) };
  const timelineOriginMs = input.nowMs ?? 0;
  const firstCueS = input.cues.at(0)?.startS ?? 0;
  const playback = playIdentityBoundActorTurn(
    plan,
    {
      audio: { ...id, audioUri: input.audioUri, durationMs: input.audioDurationMs },
      visemeCues: {
        ...id,
        baker: "mfa-baked",
        mouthCues: input.cues.map((cue) => ({ start: cue.startS, end: cue.endS, value: cue.phone })),
      },
      gaze: { ...id, gazeTargetKind: input.gaze?.gazeTargetKind ?? "learner_camera", gazeTargetActorId: input.gaze?.gazeTargetActorId ?? null },
      emotion: { ...id, from: plan.dialogueEmotionFrom, to: plan.dialogueEmotionTo },
    },
    { nowMs: timelineOriginMs, adapters: input.adapters },
  );
  if (playback.status !== "playing") {
    throw new Error(`live-voice-playback-blocked:${playback.status === "blocked" ? playback.reason : "unknown"}`);
  }
  return {
    status: playback.status,
    trace: {
      lipSyncTierPlayed: "live",
      planId: playback.planId,
      turnId: playback.turnId,
      timelineOriginMs: playback.timelineOriginMs,
      visemeCueCount: playback.viseme.cues.length,
      firstCueS,
    },
  };
}

/** Socket URL for the realtime voice gateway on the current origin. */
function liveVoiceSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/voice/realtime/ws`;
}

/**
 * One-call helper for the runtime: open the socket, collect the turn, decode,
 * bake, and play on one clock. The caller owns starting AudioContext and the
 * player adapters; this function never touches Node built-ins.
 */
export async function requestUnscriptedLiveTurn(input: {
  request: LiveVoiceTurnRequest;
  openSocket: (url: string) => LiveVoiceSocket;
  socketUrl?: string | undefined;
  audioContext: LiveVoiceAudioContext;
  plan: ActorTurnPlan;
  audioUri: string;
  adapters: ActorTurnPlayerAdapters;
  nowMs?: number | undefined;
}): Promise<{ baked: LiveVoiceBakedTurn; trace: LiveVoicePlaybackTrace }> {
  const socket = input.openSocket(input.socketUrl ?? liveVoiceSocketUrl());
  let collected: LiveVoiceCollected;
  try {
    collected = await collectLiveVoiceTurn(socket, input.request);
  } finally {
    socket.close();
  }
  const { samples, sampleRate } = await decodeLiveVoiceAudio(collected.audioBytes, input.audioContext);
  const cues = bakeLiveVoiceCues({
    samples,
    sampleRate,
    sttWords: collected.sttWords,
    transcript: collected.transcript,
  });
  const firstCueS = cues.at(0)?.startS ?? 0;
  const { trace } = playLiveVoiceTurn({
    plan: input.plan,
    audioUri: input.audioUri,
    audioDurationMs: Math.round((samples.length / sampleRate) * 1000),
    cues,
    adapters: input.adapters,
    nowMs: input.nowMs,
  });
  return {
    baked: { ...collected, samples, sampleRate, cues, firstCueS },
    trace,
  };
}
