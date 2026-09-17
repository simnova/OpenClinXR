import type { PlaybackIdentity, PlaybackContext, PlaybackBuffer, PlaybackSource } from "./actor-audio-prepared-data.js";
export function createPlayback({
  context,
  buffer,
  identity,
  destination,
}: {
  context?: PlaybackContext;
  buffer?: PlaybackBuffer;
  identity?: PlaybackIdentity;
  destination?: unknown;
}): {
  start: (opts: { when: number; offset: number; rate: number }) => Promise<void>;
  startNow: (opts: { when: number; offset: number; rate: number }) => void;
  stopNow: () => void;
  abandonNow: () => boolean;
  ended: () => boolean;
  pauseNow: () => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  position: () => number;
  snapshot: () => { contextTime: number; position: number };
  generation: string; nodeSerial: () => number;
} {
  if (!context || !buffer || !identity || !destination) throw new Error("invalid-playback-input");
  const playbackContext = context;
  const playbackBuffer = buffer;
  const playbackDestination = destination;
  let source: PlaybackSource | null = null;
  let startedAt = 0;
  let offset = 0;
  let rate = 1;
  let playing = false;
  let paused = false;
  let naturallyEnded = false;
  let pausedPosition = 0;
  let serial = 0;
  const duration = playbackBuffer.duration;

  function positionAt(contextTime: number): number {
    if (paused) return pausedPosition;
    if (naturallyEnded) return duration;
    if (!playing || !source || !Number.isFinite(contextTime) || contextTime < startedAt) return offset;
    return Math.min(duration, offset + Math.max(0, contextTime - startedAt) * rate);
  }
  const livePosition = () => positionAt(playbackContext.currentTime);
  function snapshot(): { contextTime: number; position: number } {
    if (playbackContext.state !== "running") throw new Error("audio-context-not-running");
    const contextTime = playbackContext.currentTime;
    if (!Number.isFinite(contextTime) || contextTime < 0) throw new Error("audio-context-time-invalid");
    return { contextTime, position: positionAt(contextTime) };
  }

  function startNow(opts: { when: number; offset: number; rate: number }): void {
    if (playbackContext.state !== "running") throw new Error("audio-context-not-running");
    const next = playbackContext.createBufferSource();
    next.buffer = playbackBuffer;
    next.playbackRate.value = opts.rate;
    next.connect(playbackDestination);
    source = next;
    next.start(opts.when, opts.offset);
    serial += 1;
    const held = next;
    next.onended = () => {
      if (source === held) { playing = false; naturallyEnded = true; }
    };
    startedAt = opts.when;
    offset = opts.offset;
    rate = opts.rate;
    playing = true;
    paused = false;
    naturallyEnded = false;
  }
  function start(opts: { when: number; offset: number; rate: number }): Promise<void> {
    try { startNow(opts); return Promise.resolve(); } catch (error) { return Promise.reject(error); }
  }

  function pauseNow(): void {
    if (!source || !playing) { paused = true; return; }
    pausedPosition = livePosition();
    const stopSource = source.stop;
    if (typeof stopSource !== "function") throw new Error("source-stop-unsupported");
    const result = stopSource.call(source);
    if (result === false) throw new Error("source-stop-refused");
    playing = false;
    paused = true;
    naturallyEnded = false;
  }
  function pause(): Promise<void> {
    try { pauseNow(); return Promise.resolve(); } catch (error) { return Promise.reject(error); }
  }

  function resume(): Promise<void> {
    if (!paused) return Promise.resolve();
    return start({ when: playbackContext.currentTime, offset: pausedPosition, rate });
  }

  function stopNow(): void {
    if (!source) { playing = false; paused = false; naturallyEnded = false; return; }
    const stopFn = source.stop;
    if (typeof stopFn !== "function") throw new Error("source-stop-unsupported");
    const result = stopFn.call(source);
    if (result === false) throw new Error("source-stop-refused");
    playing = false;
    paused = false;
    naturallyEnded = false;
  }
  function abandonNow(): boolean {
    let stopped = true;
    try { stopNow(); } catch { stopped = false; }
    try {
      if (source?.disconnect) {
        source.disconnect();
        stopped = true;
      }
    } catch { /* A failed disconnection does not erase a successful stop. */ }
    return stopped;
  }

  function stop(): Promise<void> {
    try { stopNow(); return Promise.resolve(); } catch (error) { return Promise.reject(error); }
  }

  return {
    start,
    startNow,
    stopNow,
    abandonNow,
    ended: () => naturallyEnded,
    pauseNow,
    pause,
    resume,
    stop,
    position: livePosition,
    snapshot,
    generation: identity.generation,
    nodeSerial: () => serial,
  };
}

export type SpeechLike = {
  startedAtMs: number;
  durationMs: number;
  originalWallStartedAtMs?: number;
  clockKind?: string;
};

type ClockSlot = { activeSpeech?: unknown };

export function createAudioSpeechClock(input: {
  slot: ClockSlot;
  speech: SpeechLike;
  positionSeconds: () => number | null;
  wallOriginMs: number;
  rate: number;
}): { snapshot(displayNowMs: number): void; release(): void } {
  if (input.rate !== 1 || !Number.isFinite(input.rate)) {
    throw new Error("audio-speech-clock-rate-unsupported");
  }
  const { slot, speech, positionSeconds, wallOriginMs } = input;
  let displayNow = wallOriginMs;
  let sourceMs = 0;
  Object.defineProperty(speech, "originalWallStartedAtMs", {
    value: wallOriginMs,
    writable: false,
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(speech, "clockKind", {
    value: "audio_source_compatibility_accessor",
    configurable: true,
    enumerable: true,
    writable: true,
  });
  delete (speech as { startedAtMs?: number }).startedAtMs;
  Object.defineProperty(speech, "startedAtMs", {
    get: () => displayNow - sourceMs,
    configurable: true,
    enumerable: true,
  });

  function owned(): boolean {
    return slot.activeSpeech === speech;
  }

  function readPosition(): number | null {
    try {
      const value = positionSeconds();
      if (value == null || typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
      return value;
    } catch {
      return null;
    }
  }

  return {
    snapshot(displayNowMs: number): void {
      if (!owned()) return;
      const seconds = readPosition();
      if (seconds == null) {
        slot.activeSpeech = undefined;
        return;
      }
      displayNow = displayNowMs;
      sourceMs = seconds * 1000;
    },
    release(): void {
      if (owned()) slot.activeSpeech = undefined;
    },
  };
}

