// C33 browser speech recorder: real microphone (or injected 16 kHz PCM) captured
// through the Web Audio graph. Structural types only; no DOM lib needed.
import type { SpeechRecorder } from "./speech-capture.js";

interface MediaTrackLike {
  stop(): void;
}

interface MediaStreamLike {
  getTracks(): MediaTrackLike[];
}

interface AudioBufferLike {
  getChannelData(channel: number): Float32Array;
}

interface AudioNodeLike {
  connect(destination: unknown): unknown;
  disconnect(): void;
}

interface ScriptProcessorEventLike {
  inputBuffer: { getChannelData(channel: number): Float32Array };
}

interface ScriptProcessorLike extends AudioNodeLike {
  onaudioprocess: ((event: ScriptProcessorEventLike) => void) | null;
}

interface GainNodeLike extends AudioNodeLike {
  gain: { value: number };
}

interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  start(): void;
}

interface MediaStreamDestinationLike extends AudioNodeLike {
  stream: MediaStreamLike;
}

interface AudioContextLike {
  sampleRate: number;
  destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): BufferSourceLike;
  createMediaStreamDestination(): MediaStreamDestinationLike;
  createMediaStreamSource(stream: MediaStreamLike): MediaStreamSourceLike;
  createScriptProcessor(bufferSize: number, inputs: number, outputs: number): ScriptProcessorLike;
  createGain(): GainNodeLike;
  audioWorklet?: { addModule(url: string): Promise<void> };
}

// Off-main-thread tap: the main thread is busy with rendering, and a ScriptProcessor tap dropped blocks there.
const TAP_SOURCE = "class C33Tap extends AudioWorkletProcessor { constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; } process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) { for (let i = 0; i < ch.length; i += 1) { this.buf[this.n++] = ch[i]; if (this.n === this.buf.length) { const out = this.buf.slice(0); this.port.postMessage(out.buffer, [out.buffer]); this.n = 0; } } } return true; } } registerProcessor('c33-tap', C33Tap);";

interface MediaStreamSourceLike extends AudioNodeLike {}

interface MediaDevicesLike {
  getUserMedia(constraints: unknown): Promise<MediaStreamLike>;
}

interface WorkletNodeLike extends AudioNodeLike {
  port: { onmessage: ((event: { data: ArrayBuffer }) => void) | null };
}

interface RuntimeLike {
  AudioContext?: new () => AudioContextLike;
  AudioWorkletNode?: new (context: AudioContextLike, name: string) => WorkletNodeLike;
  URL?: { createObjectURL(blob: unknown): string; revokeObjectURL(url: string): void };
  Blob?: new (parts: string[], options: { type: string }) => unknown;
  navigator?: { mediaDevices?: MediaDevicesLike };
}

const runtime = globalThis as unknown as RuntimeLike;

function notSupported(reason: string): Error {
  const failure = new Error(reason);
  failure.name = "NotSupportedError";
  return failure;
}

/** Capture microphone PCM via a ScriptProcessor tap; inject(pcm) feeds 16 kHz int16 instead. */
export function createBrowserSpeechRecorder(): SpeechRecorder {
  let pendingInject: Int16Array | null = null;
  let injectedActive = false;
  let recording = false;
  let context: AudioContextLike | undefined;
  let stream: MediaStreamLike | undefined;
  let mediaSource: MediaStreamSourceLike | undefined;
  let processor: AudioNodeLike | undefined;
  let gain: GainNodeLike | undefined;
  let bufferSource: BufferSourceLike | undefined;
  let chunks: Float32Array[] = [];
  const startInner = async (): Promise<void> => {
    const ContextCtor = runtime.AudioContext;
    if (ContextCtor === undefined) throw notSupported("AudioContext is unavailable");
    context = new ContextCtor();
    await context.resume();
    const injected = pendingInject;
    pendingInject = null;
    injectedActive = injected !== null;
    bufferSource = undefined;
    chunks = [];
    if (injected !== null) {
      const buffer = context.createBuffer(1, injected.length, 16000);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < injected.length; i += 1) data[i] = (injected[i] ?? 0) / 32768;
      bufferSource = context.createBufferSource();
      bufferSource.buffer = buffer;
      const destination = context.createMediaStreamDestination();
      bufferSource.connect(destination);
      stream = destination.stream;
    } else {
      const mediaDevices = runtime.navigator?.mediaDevices;
      if (mediaDevices?.getUserMedia === undefined) throw notSupported("getUserMedia is unavailable");
      const opening = mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const failure = new Error("microphone did not open within 15 s");
          failure.name = "TimeoutError";
          reject(failure);
        }, 15000);
      });
      try {
        stream = await Promise.race([opening, timeout]);
      } catch (error) {
        void opening.then((late) => { for (const track of late.getTracks()) track.stop(); }, () => undefined);
        await context.close().catch(() => undefined);
        context = undefined;
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    mediaSource = context.createMediaStreamSource(stream);
    gain = context.createGain();
    gain.gain.value = 0;
    let tapped = false;
    const WorkletCtor = runtime.AudioWorkletNode;
    if (context.audioWorklet !== undefined && WorkletCtor !== undefined && runtime.Blob !== undefined && runtime.URL !== undefined) {
      try {
        const url = runtime.URL.createObjectURL(new runtime.Blob([TAP_SOURCE], { type: "application/javascript" }));
        try {
          await context.audioWorklet.addModule(url);
        } finally {
          runtime.URL.revokeObjectURL(url);
        }
        const tap = new WorkletCtor(context, "c33-tap");
        tap.port.onmessage = (event) => { chunks.push(new Float32Array(event.data)); };
        processor = tap;
        tapped = true;
      } catch {
        tapped = false;
      }
    }
    if (!tapped) {
      const script = context.createScriptProcessor(4096, 1, 1);
      script.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      processor = script;
    }
    mediaSource.connect(processor as AudioNodeLike);
    (processor as AudioNodeLike).connect(gain);
    gain.connect(context.destination);
    bufferSource?.start();
    recording = true;
  };
  const teardown = async (): Promise<number> => {
    recording = false;
    injectedActive = false;
    for (const node of [processor, gain, mediaSource, bufferSource]) {
      try { node?.disconnect(); } catch { /* already disconnected */ }
    }
    processor = undefined;
    gain = undefined;
    mediaSource = undefined;
    bufferSource = undefined;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = undefined;
    const sampleRate = context?.sampleRate ?? 16000;
    await context?.close().catch(() => undefined);
    context = undefined;
    return sampleRate;
  };
  // Any failure after the context exists releases the tracks and the context (the microphone must not stay open).
  const start = async (): Promise<void> => {
    try {
      await startInner();
    } catch (error) {
      chunks = [];
      await teardown();
      throw error;
    }
  };
  const stop = async (): Promise<{ chunks: Float32Array[]; sampleRate: number }> => {
    const sampleRate = await teardown();
    const result = { chunks, sampleRate };
    chunks = [];
    return result;
  };
  return {
    start,
    stop,
    inject: (pcm) => {
      pendingInject = pcm;
    },
    source: () => (injectedActive && recording ? "injected" : "microphone"),
  };
}
