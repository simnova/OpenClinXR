export const MESM_VOICE_IDS = ["heart", "wren", "everly", "hadley", "bryony", "maeve", "miles", "trevor", "edwin", "hugh"] as const;

export interface MouthCue {
  phoneme: "AA" | "E" | "OH" | "SS" | "sil";
  atSecond: number;
  durationSeconds: number;
}

export interface VoiceEngine {
  synthesize(text: string, voice: string, onChunk: (samples: Float32Array) => void): Promise<{ audioSeconds: number; computeMs: number }>;
}

export interface VoiceSink {
  reset(): void;
  push(samples: Float32Array): void;
  end(): void;
  onStart(callback: () => void): void;
  onFinish(callback: (info: { played: number; underruns: number }) => void): void;
  positionSeconds(): number | null;
  peakAmplitude(): number;
}

export interface VoiceSlot {
  activeSpeech?: {
    text?: string;
    startedAtMs: number;
    durationMs: number;
    bakedCues?: MouthCue[];
    phonemeSequence?: readonly string[];
  } | undefined;
  mediaPositionSeconds?: () => number | null | undefined;
  /** Scene-graph root of the actor; only read by ActorVoice.mouth (evidence). */
  root?: { traverse(callback: (object: unknown) => void): void };
}

export interface SpokenTurnRecord {
  actorId: string;
  turnKey: string;
  voiceRequested: string;
  voiceUsed: string;
  voiceFallback: boolean;
  chars: number;
  /** FNV-1a 32-bit hash of the spoken text, hex: lets a harness check which line was spoken without the record holding it. */
  textHash: string;
  /** ms from the turn's arrival at speakTurn to the first synthesized chunk reaching the main thread. */
  firstChunkMs: number | null;
  firstAudioMs: number | null;
  audioSeconds: number;
  computeMs: number;
  rtf: number;
  xRealtime: number;
  chunks: number;
  cueCount: number;
  nonSilentCues: number;
  peak: number;
  /** Which clock drove the mouth: the sink's audio clock, or wall time after the output failed to start within WALL_FALLBACK_MS. */
  audioClock: "audio" | "wall";
  played?: number;
  underruns?: number;
  error: string;
}

export interface ActorVoice {
  speakTurn(input: { actorId: string; caption: string; turnKey: string }): Promise<SpokenTurnRecord>;
  readonly records: SpokenTurnRecord[];
  /** Sum of the actor's live speech morph influences: visemes except silence plus the mouth-opening targets (largest per name across meshes). Movement is read against the actor's own rest value. 0 without a slot root. Evidence only. */
  mouth(actorId: string): number;
  /** Non-zero viseme/mouth morph targets on the actor (largest influence per name). Evidence only. */
  mouthTargets(actorId: string): Record<string, number>;
}

export function speechTextFromCaption(caption: string): string {
  return caption.trim().replace(/^[^:]{1,60}:\s*/u, "").trim();
}

export function resolveActorVoice(requested?: string): { requested: string; used: "heart"; fallback: boolean } {
  const resolved = requested ?? "heart";
  return { requested: resolved, used: "heart", fallback: resolved !== "heart" };
}

const CUE_GAP_SECONDS = 0.0005;
const WALL_FALLBACK_MS = 1500;
const PLAYBACK_GRACE_MS = 1000;

interface CueRun {
  phoneme: MouthCue["phoneme"];
  startSample: number;
  sampleCount: number;
  frames: number;
}

export function createEnvelopeCueBuilder(sampleRate: number): {
  readonly cues: MouthCue[];
  readonly seconds: number;
  push(samples: Float32Array): void;
  finish(): void;
} {
  const frameSamples = Math.max(1, Math.round(sampleRate * 0.02));
  const cues: MouthCue[] = [];
  let carry = new Float32Array(0);
  let pushedSamples = 0;
  let classifiedSamples = 0;
  let runningPeakRms = 0;
  let open: CueRun | undefined;
  let pending: CueRun | undefined;
  let finished = false;

  // The shell's baked-cue admission is strict (a cue may not start before the previous one ends, no tolerance), so every
  // cue ends CUE_GAP_SECONDS before its integral-sample end: float sums can never overlap the next start.
  const emit = (run: CueRun): void => {
    const previous = cues.at(-1);
    const end = run.startSample + run.sampleCount;
    if (previous !== undefined && previous.phoneme === run.phoneme) {
      previous.durationSeconds = (end - Math.round(previous.atSecond * sampleRate)) / sampleRate - CUE_GAP_SECONDS;
      return;
    }
    cues.push({ phoneme: run.phoneme, atSecond: run.startSample / sampleRate, durationSeconds: run.sampleCount / sampleRate - CUE_GAP_SECONDS });
  };

  const holdClosed = (run: CueRun): void => {
    if (pending === undefined) {
      pending = run;
      return;
    }
    if (run.frames < 2) {
      pending.sampleCount += run.sampleCount;
      pending.frames += run.frames;
      return;
    }
    if (pending.frames < 2 && cues.length === 0) {
      run.startSample = pending.startSample;
      run.sampleCount += pending.sampleCount;
      run.frames += pending.frames;
      pending = run;
      return;
    }
    emit(pending);
    pending = run;
  };

  const classify = (frame: Float32Array): MouthCue["phoneme"] => {
    let squareSum = 0;
    let crossings = 0;
    for (let i = 0; i < frame.length; i += 1) {
      const value = frame[i] ?? 0;
      squareSum += value * value;
      if (i > 0 && ((value >= 0) !== ((frame[i - 1] ?? 0) >= 0))) crossings += 1;
    }
    const rms = Math.sqrt(squareSum / frame.length);
    runningPeakRms = Math.max(runningPeakRms, rms);
    const zcr = frame.length > 1 ? crossings / (frame.length - 1) : 0;
    if (rms < Math.max(0.01, 0.1 * runningPeakRms)) return "sil";
    if (zcr > 0.25) return "SS";
    if (rms >= 0.7 * runningPeakRms) return "AA";
    if (rms >= 0.4 * runningPeakRms) return "E";
    return "OH";
  };

  const consumeFrame = (frame: Float32Array): void => {
    const phoneme = classify(frame);
    if (open?.phoneme === phoneme) {
      open.sampleCount += frame.length;
      open.frames += 1;
    } else {
      if (open !== undefined) holdClosed(open);
      open = { phoneme, startSample: classifiedSamples, sampleCount: frame.length, frames: 1 };
    }
    classifiedSamples += frame.length;
  };

  return {
    cues,
    get seconds() { return pushedSamples / sampleRate; },
    push(samples) {
      if (finished || samples.length === 0) return;
      pushedSamples += samples.length;
      const joined = new Float32Array(carry.length + samples.length);
      joined.set(carry);
      joined.set(samples, carry.length);
      let offset = 0;
      while (joined.length - offset >= frameSamples) {
        consumeFrame(joined.slice(offset, offset + frameSamples));
        offset += frameSamples;
      }
      carry = joined.slice(offset);
    },
    finish() {
      if (finished) return;
      finished = true;
      if (carry.length > 0) consumeFrame(carry);
      carry = new Float32Array(0);
      if (open === undefined) return;
      if (pending === undefined) {
        emit(open);
      } else if (pending.frames < 2 && cues.length === 0) {
        open.startSample = pending.startSample;
        open.sampleCount += pending.sampleCount;
        emit(open);
      } else {
        emit(pending);
        emit(open);
      }
      pending = undefined;
      open = undefined;
    },
  };
}

export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

export function createActorVoice(deps: {
  engine: VoiceEngine;
  sink: VoiceSink;
  slotFor(actorId: string): VoiceSlot | undefined;
  voiceFor(actorId: string): string | undefined;
  nowMs(): number;
}): ActorVoice {
  const records: SpokenTurnRecord[] = [];
  let queue: Promise<unknown> = Promise.resolve();

  /** One turn. `slot` and `speech` were captured when the turn arrived (the shell's play() had just made this turn's speech). */
  const execute = async (
    input: { actorId: string; caption: string; turnKey: string },
    t0: number,
    slot: VoiceSlot | undefined,
    speech: VoiceSlot["activeSpeech"],
    turn: { ended: Promise<void> },
  ): Promise<SpokenTurnRecord> => {
    const text = speechTextFromCaption(input.caption);
    const voice = resolveActorVoice(deps.voiceFor(input.actorId));
    const record: SpokenTurnRecord = {
      actorId: input.actorId, turnKey: input.turnKey,
      voiceRequested: voice.requested, voiceUsed: voice.used, voiceFallback: voice.fallback,
      chars: text.length, textHash: fnv1a(text), firstChunkMs: null, firstAudioMs: null, audioSeconds: 0, computeMs: 0,
      rtf: 0, xRealtime: 0, chunks: 0, cueCount: 0, nonSilentCues: 0,
      peak: 0, error: "", audioClock: "audio",
    };
    if (text === "") {
      records.push(record);
      return record;
    }

    const owns = (): boolean => slot !== undefined && speech !== undefined && slot.activeSpeech === speech;
    // A newer speech on the slot (a later turn, or an interruption) was not this turn's: the audio still plays, the mouth is not touched.
    const attached = owns();
    const builder = createEnvelopeCueBuilder(24000);
    // The sink's audio clock drives the mouth. If the output never starts (the headset's AudioContext clock can stall), the
    // mouth falls back to wall time from the first chunk so captions and lip movement still play; the record says which clock ran.
    let firstChunkAtMs: number | null = null;
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    let resolveEnded: () => void = () => undefined;
    turn.ended = new Promise<void>((resolve) => { resolveEnded = resolve; });
    const endSpeech = (): void => {
      if (slot !== undefined && slot.mediaPositionSeconds === mediaClock) delete slot.mediaPositionSeconds;
      if (slot !== undefined && attached && owns()) slot.activeSpeech = undefined;
    };
    const finishPlayback = (): void => {
      if (endTimer !== undefined) clearTimeout(endTimer);
      endSpeech();
      resolveEnded();
    };
    function mediaClock(): number | null {
      const audio = deps.sink.positionSeconds();
      if (audio !== null) return audio;
      if (firstChunkAtMs === null || record.firstAudioMs !== null) return null;
      const waited = deps.nowMs() - firstChunkAtMs;
      if (waited < WALL_FALLBACK_MS) return null;
      record.audioClock = "wall";
      const position = (waited - WALL_FALLBACK_MS) / 1000;
      if (position <= builder.seconds + 0.3) return position;
      endSpeech();
      return null;
    }
    deps.sink.reset();
    if (attached && speech !== undefined && slot !== undefined) {
      speech.bakedCues = builder.cues;
      slot.mediaPositionSeconds = mediaClock;
    }
    deps.sink.onStart(() => {
      const firstAudioMs = deps.nowMs() - t0;
      record.firstAudioMs = firstAudioMs;
      if (attached && owns() && speech !== undefined) speech.startedAtMs += firstAudioMs;
    });
    deps.sink.onFinish(({ played, underruns }) => {
      record.played = played;
      record.underruns = underruns;
      // The audio is the clock: when it has drained the speech is over, so the animation loop returns the mouth to rest now.
      finishPlayback();
    });

    try {
      const result = await deps.engine.synthesize(text, voice.used, (samples) => {
        record.firstChunkMs ??= deps.nowMs() - t0;
        firstChunkAtMs ??= deps.nowMs();
        builder.push(samples);
        deps.sink.push(samples);
        record.chunks += 1;
        if (attached && owns() && speech !== undefined) {
          speech.durationMs = Math.max(speech.durationMs, builder.seconds * 1000 + 250);
        }
      });
      builder.finish();
      deps.sink.end();
      record.audioSeconds = result.audioSeconds;
      record.computeMs = result.computeMs;
      record.rtf = result.audioSeconds > 0 ? result.computeMs / 1000 / result.audioSeconds : 0;
      record.xRealtime = record.rtf > 0 ? 1 / record.rtf : 0;
      record.cueCount = builder.cues.length;
      record.nonSilentCues = builder.cues.filter((cue) => cue.phoneme !== "sil").length;
      record.peak = deps.sink.peakAmplitude();
      // A sink that never reports the end (stalled output) must not hold the next turn or the slot forever.
      endTimer = setTimeout(finishPlayback, result.audioSeconds * 1000 + WALL_FALLBACK_MS + PLAYBACK_GRACE_MS);
    } catch (error) {
      record.error = errorText(error);
      deps.sink.end();
      if (slot !== undefined && attached && owns() && speech !== undefined) {
        delete speech.bakedCues;
        if (slot.mediaPositionSeconds === mediaClock) delete slot.mediaPositionSeconds;
      }
      resolveEnded();
    }
    records.push(record);
    return record;
  };

  return {
    records,
    mouthTargets(actorId) {
      const out: Record<string, number> = {};
      deps.slotFor(actorId)?.root?.traverse((object) => {
        const mesh = object as { morphTargetDictionary?: Record<string, number>; morphTargetInfluences?: number[] } | null;
        if (mesh?.morphTargetDictionary === undefined || mesh.morphTargetInfluences === undefined) return;
        for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
          const value = mesh.morphTargetInfluences[index] ?? 0;
          if (/^(viseme_|mouth-)/iu.test(name) && value > 0.001) out[name] = Math.max(out[name] ?? 0, Number(value.toFixed(3)));
        }
      });
      return out;
    },
    mouth(actorId) {
      let total = 0;
      for (const [name, value] of Object.entries(this.mouthTargets(actorId))) {
        if (/^viseme_(?!sil)/iu.test(name) || /^mouth-(open|parling|part-later|protusion|pursing|eversion)$/iu.test(name)) total += value;
      }
      return total;
    },
    speakTurn(input) {
      const arrivedMs = deps.nowMs();
      const slot = deps.slotFor(input.actorId);
      const speech = slot?.activeSpeech;
      const turn = { ended: Promise.resolve() };
      const run = queue.then(() => execute(input, arrivedMs, slot, speech, turn));
      // The next turn starts after this one's audio ended (or its end timer fired): one sink serves every actor.
      queue = run.then(() => turn.ended, () => undefined);
      return run;
    },
  };
}
