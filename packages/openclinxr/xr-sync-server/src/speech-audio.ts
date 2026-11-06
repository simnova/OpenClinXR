// C33 learner speech-audio intake: recognize buffered 16 kHz mono PCM through a
// server-injected recognizer. Server config only; the audio and the recognized
// text are never stored, logged, or traced (no trace event, no actor turn, no
// serverTick/state change apart from the learner cursor).
import type { Client } from "@colyseus/core";

export type SpeechRecognizer = (audio: { pcm: Int16Array; sampleRate: 16000 }) => Promise<{ text: string; confidence: number }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function payloadBytes(payload: unknown): Uint8Array | null {
  if (payload instanceof Uint8Array) return payload;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(payload)) return new Uint8Array(payload.buffer, payload.byteOffset, payload.length);
  if (ArrayBuffer.isView(payload)) {
    const view = payload as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return null;
}

export function handleSpeechAudioIntent(
  ctx: { recognizer: SpeechRecognizer | null; busy: Set<string>; reject(client: Client, seq: number, reason: string): void },
  client: Client,
  learner: { lastSeq: number },
  seq: number,
  payload: unknown,
): void {
  let bytes: Uint8Array | null = null;
  let rate: unknown;
  if (isRecord(payload)) {
    rate = payload["sampleRate"];
    bytes = payloadBytes(payload["pcm"]);
  }
  if (rate !== 16000 || bytes === null || bytes.byteLength % 2 !== 0 || bytes.byteLength < 3200 || bytes.byteLength > 480000) {
    ctx.reject(client, seq, "bad-audio");
    return;
  }
  const recognizer = ctx.recognizer;
  if (recognizer === null) {
    ctx.reject(client, seq, "speech-recognizer-unavailable");
    return;
  }
  if (ctx.busy.has(client.sessionId)) {
    ctx.reject(client, seq, "speech-busy");
    return;
  }
  ctx.busy.add(client.sessionId);
  learner.lastSeq = seq;
  void (async () => {
    try {
      const copy = new Uint8Array(bytes as Uint8Array);
      const little = new Int16Array(copy.byteLength / 2);
      for (let i = 0; i < little.length; i += 1) {
        const lo = copy[i * 2] ?? 0;
        const hi = copy[i * 2 + 1] ?? 0;
        let v = (hi << 8) | lo;
        if (v >= 0x8000) v -= 0x10000;
        little[i] = v;
      }
      let result: { text: string; confidence: number };
      try {
        result = await recognizer({ pcm: little, sampleRate: 16000 });
      } catch {
        ctx.reject(client, seq, "speech-recognition-failed");
        return;
      }
      if (typeof result?.text !== "string" || result.text.length > 2000 || typeof result?.confidence !== "number" || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) {
        ctx.reject(client, seq, "speech-recognition-failed");
        return;
      }
      client.send("ack", { seq, serverTs: Date.now(), transcript: { text: result.text, confidence: result.confidence } });
    } finally {
      ctx.busy.delete(client.sessionId);
    }
  })().catch(() => undefined);
}
