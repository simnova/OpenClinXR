/** App-local prepared PCM transport and source-relative speech clock. */
import { cuesAdmissible, convertRhubarb, decodePcm16MonoWav as decodePcm16MonoWavPure, type DiagnosticMouthCue, type PlaybackIdentity, type PlaybackSource, type PlaybackContext, type PlaybackBuffer } from "./prepared-actor-audio-data.js";

export { convertRhubarb, type DiagnosticMouthCue, type PlaybackIdentity, type PlaybackSource, type PlaybackContext, type PlaybackBuffer };


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

type SpeechLike = {
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

type PreparedIdentity = {
  scenarioId: string;
  actorId: string;
  responseText: string;
  runnerConversationTurn: number;
  waveformSha256: string;
  cueSha256: string;
};

type PreparedEntry = PreparedIdentity & {
  buffer: PlaybackBuffer & AudioBuffer;
  cues: DiagnosticMouthCue[];
  decodedSampleRate: number;
  decodedSampleCount: number;
};

type LiveSlot = {
  actorId?: string;
  activeSpeech?: (SpeechLike & {
    text?: string;
    bakedCues?: DiagnosticMouthCue[];
    phonemeSequence?: readonly string[];
  }) | undefined;
  mediaPositionSeconds?: () => number | null;
  root?: { traverse: (fn: (object: unknown) => void) => void; userData?: Record<string, unknown> };
};

export type PreparedActorStartContext = {
  actorId: string;
  spokenText: string;
  contextState?: string;
  userActivated?: boolean;
  faceEmotion?: string;
  gazeTarget?: { kind: string; actorId: string | null };
  req?: unknown;
  emotionSource?: string;
  resumeOffset?: number;
};

type Host = {
  getSlot?: (actorId: string) => unknown;
  triggerDialogue?: (ctx: PreparedActorStartContext) => void;
};

type OwnedSession = {
  actorId: string;
  player: ReturnType<typeof createPlayback>;
  clock: ReturnType<typeof createAudioSpeechClock>;
  speech: SpeechLike;
  slot: LiveSlot;
  generation: string;
  nodeSerial: number;
  startedWhen: number;
  clockState: { lastContextTime: number; lastPosition: number };
  mediaPositionReader: () => number | null;
};

const host: Host = {};
const prepared = new Map<string, PreparedEntry>();
const sessions = new Map<string, OwnedSession>();
const actorGeneration = new Map<string, number>();
let sharedContext: (AudioContext | PlaybackContext) | undefined;
let sharedDestination: unknown;
let tapNode: AudioWorkletNode | undefined;
let recorderDestination: MediaStreamAudioDestinationNode | undefined;
let userActivated = false;
const tapChunks: Float32Array[] = [];
let tapMeta: {
  observationKind: string;
  generation: string;
  nodeSerial: number;
  sourceStartContextSample: number;
} | undefined;

function prepareKey(actorId: string, responseText: string): string {
  return `${actorId}\0${responseText}`;
}

function requireRunningContext(context: AudioContext | PlaybackContext | undefined): void {
  if (context?.state !== "running") throw new Error("audio-context-not-running");
}

/** Presence query does not expose mutable manager state. */
export function isPreparedEntryPresent(actorId: string, spokenText: string): boolean {
  return prepared.has(prepareKey(actorId, spokenText));
}

export function retireOwnedActorSession(actorId: string): boolean {
  const previous = sessions.get(actorId);
  if (!stopOwned(previous)) return false;
  if (previous) {
    previous.clock.release();
    if (previous.slot.mediaPositionSeconds === previous.mediaPositionReader) delete previous.slot.mediaPositionSeconds;
    if (previous.slot.activeSpeech === previous.speech) previous.slot.activeSpeech = undefined;
    sessions.delete(actorId);
  }
  return true;
}

export type PreparedActorAudioOutcome =
  | { kind: "audio_started" }
  | { kind: "refused"; reason: "prepared_audio_unavailable" | "invalid_cues" | "suspended" | "owned_stop_refusal" | "playback_failed" };


function observePlayer(player: ReturnType<typeof createPlayback>, clockState: { lastContextTime: number; lastPosition: number }): number {
  const snap = player.snapshot();
  clockState.lastContextTime = snap.contextTime;
  clockState.lastPosition = snap.position;
  return snap.position;
}

function stopOwned(session: OwnedSession | undefined): boolean {
  if (!session || session.player.ended()) return true;
  try { session.player.stopNow(); return true; } catch { return false; }
}

export function startPreparedActorTurnAudioOutcome(ctx: PreparedActorStartContext): PreparedActorAudioOutcome {
  void ctx.contextState;
  void ctx.userActivated;
  const entry = prepared.get(prepareKey(ctx.actorId, ctx.spokenText));
  if (!entry) return { kind: "refused", reason: "prepared_audio_unavailable" };
  if (!cuesAdmissible(entry.cues)) return { kind: "refused", reason: "invalid_cues" };
  if (sharedContext?.state !== "running" || !userActivated || !sharedDestination) return { kind: "refused", reason: "suspended" };
  if (!retireOwnedActorSession(ctx.actorId)) return { kind: "refused", reason: "owned_stop_refusal" };
  let attempt: OwnedSession | undefined;
  let slot: LiveSlot | undefined;
  let speech: LiveSlot["activeSpeech"];
  let originalSpeech: LiveSlot["activeSpeech"];
  let sourceStarted = false;
  let mediaPositionReader: (() => number) | undefined;
  try {
    host.triggerDialogue?.(ctx);
    slot = host.getSlot?.(ctx.actorId) as LiveSlot | undefined;
    if (!slot?.activeSpeech || slot.activeSpeech.text !== ctx.spokenText) throw new Error("prepared-speech-unavailable");
    speech = slot.activeSpeech;
    originalSpeech = { ...speech };
    const genN = (actorGeneration.get(ctx.actorId) ?? 0) + 1;
    actorGeneration.set(ctx.actorId, genN);
    const generation = `${ctx.actorId}:${entry.runnerConversationTurn}:${genN}`;
    const player = createPlayback({
      context: sharedContext as PlaybackContext,
      buffer: entry.buffer,
      identity: {
        waveformSha256: entry.waveformSha256, cueSha256: entry.cueSha256, actorId: ctx.actorId, generation,
        decodedSampleRate: entry.decodedSampleRate, decodedSampleCount: entry.decodedSampleCount,
      },
      destination: sharedDestination,
    });
    const sampleRate = sharedContext.sampleRate ?? 22050;
    const when = Math.ceil(sharedContext.currentTime * sampleRate) / sampleRate;
    if (tapNode) {
      tapChunks.length = 0;
      tapMeta = { observationKind: "audio-worklet-process", generation, nodeSerial: player.nodeSerial() + 1, sourceStartContextSample: Math.round(when * sampleRate) };
      tapNode.port.postMessage({ arm: true, generation, nodeSerial: player.nodeSerial() + 1, sourceStartContextSample: tapMeta.sourceStartContextSample, sampleCount: entry.decodedSampleCount });
    }
    const resumeOffset = typeof ctx.resumeOffset === "number" && Number.isFinite(ctx.resumeOffset) && ctx.resumeOffset >= 0 ? ctx.resumeOffset : 0;
    speech.durationMs = (entry.decodedSampleCount / entry.decodedSampleRate) * 1000;
    speech.bakedCues = entry.cues;
    const clockState = { lastContextTime: when, lastPosition: 0 };
    mediaPositionReader = () => observePlayer(player, clockState);
    slot.mediaPositionSeconds = mediaPositionReader;
    const clock = createAudioSpeechClock({ slot, speech, positionSeconds: () => observePlayer(player, clockState), wallOriginMs: performance.now(), rate: 1 });
    attempt = { actorId: ctx.actorId, player, clock, speech, slot, generation, nodeSerial: player.nodeSerial(), startedWhen: when, clockState, mediaPositionReader };
    player.startNow({ when, offset: resumeOffset, rate: 1 });
    sourceStarted = true;
    attempt.nodeSerial = player.nodeSerial();
    if (tapMeta) tapMeta.nodeSerial = player.nodeSerial();
    if (slot.activeSpeech !== speech || slot.mediaPositionSeconds !== mediaPositionReader || actorGeneration.get(ctx.actorId) !== genN) throw new Error("prepared-speech-replaced");
    if (slot.root) slot.root.userData = { ...slot.root.userData, openClinXrPreparedGeneration: generation };
    sessions.set(ctx.actorId, attempt);
    return { kind: "audio_started" };
  } catch {
    if (attempt && !attempt.player.abandonNow()) {
      if (!sessions.has(ctx.actorId)) sessions.set(ctx.actorId, attempt);
      return { kind: "refused", reason: "owned_stop_refusal" };
    }
    const ownedSpeech = slot?.activeSpeech === speech && speech !== undefined;
    attempt?.clock.release();
    if (slot && slot.mediaPositionSeconds === mediaPositionReader) delete slot.mediaPositionSeconds;
    if (slot && ownedSpeech) slot.activeSpeech = sourceStarted ? undefined : originalSpeech;
    return { kind: "refused", reason: "playback_failed" };
  }
}

/** Compatibility handshake used by the existing coordinator and DEV bridge. */
export function startPreparedActorTurnAudio(ctx: PreparedActorStartContext): boolean {
  return startPreparedActorTurnAudioOutcome(ctx).kind === "audio_started";
}

export function pausePreparedActorTurnAudio(actorId: string): boolean {
  const session = sessions.get(actorId);
  if (!session) return false;
  try { session.player.pauseNow(); } catch { return false; }
  session.clock.release();
  return session.slot.activeSpeech !== session.speech;
}

export function resumePreparedActorTurnAudio(actorId: string): boolean {
  const session = sessions.get(actorId);
  if (!session) return false;
  const text = (session.speech as { text?: string }).text;
  if (typeof text !== "string") return false;
  const offset = session.player.position();
  return startPreparedActorTurnAudio({ actorId, spokenText: text, resumeOffset: offset });
}

export function installPreparedActorAudioRuntime(input: {
  getSlot: (actorId: string) => unknown;
  triggerDialogue?: (ctx: PreparedActorStartContext) => void;
  context: PlaybackContext;
  destination: unknown;
  entry: PreparedEntry;
}): void {
  sessions.clear();
  actorGeneration.clear();
  host.getSlot = input.getSlot;
  if (input.triggerDialogue) host.triggerDialogue = input.triggerDialogue;
  sharedContext = input.context;
  sharedDestination = input.destination;
  userActivated = true;
  prepared.set(prepareKey(input.entry.actorId, input.entry.responseText), input.entry);
}
export function registerPreparedActorAudioEntry(entry: PreparedEntry): void {
  prepared.set(prepareKey(entry.actorId, entry.responseText), entry);
}

export function syncPreparedActorAudio(displayNowMs: number): void {
  for (const session of sessions.values()) {
    session.clock.snapshot(displayNowMs);
  }
}

function speakFixtureEnabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("openclinxrSpeakFixture") === "1";
  } catch {
    return false;
  }
}

export function initPreparedActorAudioBridge(deps?: {
  getSlot?: (actorId: string) => unknown;
  triggerDialogue?: (ctx: PreparedActorStartContext) => void;
}): void {
  if (deps?.getSlot) host.getSlot = deps.getSlot;
  if (deps?.triggerDialogue) host.triggerDialogue = deps.triggerDialogue;
  if (typeof window === "undefined" || !speakFixtureEnabled()) return;
  window.__openClinXrPreparedActorAudio = {
    prepare: prepareFromHost,
    start: startPreparedActorTurnAudio,
    pause: pausePreparedActorTurnAudio,
    resume: resumePreparedActorTurnAudio,
    sync: syncPreparedActorAudio,
    sessions,
    getContext: () => sharedContext as AudioContext | undefined,
    getTap: () => tapNode,
    getRecorderDestination: () => recorderDestination,
    markUserActivated,
    getAuthoredMaterials,
    getPlayedTap: () => {
      const played = new Float32Array(tapChunks.reduce((n, p) => n + p.length, 0));
      let offset = 0; for (const part of tapChunks) { played.set(part, offset); offset += part.length; }
      return { samples: played, meta: tapMeta };
    },
  };
}

export async function markUserActivated(): Promise<AudioContext> {
  const browser = (sharedContext && "createGain" in sharedContext ? sharedContext : new AudioContext({ sampleRate: 22050 })) as AudioContext;
  sharedContext = browser;
  if (browser.state !== "running") await browser.resume();
  if (browser.state !== "running") throw new Error("audio-context-not-running");
  userActivated = true;
  if (!sharedDestination) {
    const fanout = browser.createGain();
    fanout.gain.value = 1;
    fanout.connect(browser.destination);
    recorderDestination = browser.createMediaStreamDestination();
    fanout.connect(recorderDestination);
    sharedDestination = fanout;
  }
  return browser;
}

type PrepareHostInput = PreparedIdentity & {
  wav: ArrayBuffer;
  mouthCues: { mouthCues?: Array<{ start: number; end: number; value: string }> };
  tapWorkletUrl?: string;
  diagnosticCues?: DiagnosticMouthCue[];
};

/** Approximate private cues are admitted only by actual DEV fixture ingress, never caller labels. */
export function selectPreparationCues(input: Pick<PrepareHostInput, "mouthCues" | "diagnosticCues">): DiagnosticMouthCue[] {
  if (input.diagnosticCues !== undefined) {
    if (import.meta.env.DEV !== true || !speakFixtureEnabled()) throw new Error("diagnostic-cues-ingress-refused");
    if (!cuesAdmissible(input.diagnosticCues)) throw new Error("invalid-diagnostic-cues");
    return input.diagnosticCues.map((cue) => ({ ...cue }));
  }
  return convertRhubarb(input.mouthCues);
}

async function prepareFromHost(input: PrepareHostInput): Promise<{ decodedSampleCount: number; decodedSampleRate: number }> {
  const cues = selectPreparationCues(input);
  const context = await markUserActivated();
  requireRunningContext(context);
  const decoded = decodePcm16MonoWav(input.wav);
  if (decoded.sampleRate !== 22050) throw new Error("native-capture-domain-required");
  const buffer = context.createBuffer(1, decoded.sampleCount, decoded.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < decoded.float32.length; i += 1) {
    const sample = decoded.float32[i];
    channel[i] = sample === undefined ? 0 : sample;
  }
  if (input.tapWorkletUrl && !tapNode) {
    await context.audioWorklet.addModule(input.tapWorkletUrl);
    tapNode = new AudioWorkletNode(context, "openclinxr-audio-tap", {
      processorOptions: { generation: `${input.actorId}:${input.runnerConversationTurn}`, nodeSerial: 0 },
    });
    tapNode.port.onmessage = (event) => {
      const data = event.data as { samples?: Float32Array; generation?: string; nodeSerial?: number; sourceStartContextSample?: number; observationKind?: string };
      if (!data?.samples) return;
      tapChunks.push(data.samples);
      tapMeta = {
        observationKind: data.observationKind ?? "audio-worklet-process",
        generation: data.generation ?? "",
        nodeSerial: data.nodeSerial ?? 0,
        sourceStartContextSample: data.sourceStartContextSample ?? 0,
      };
    };
    if (sharedDestination) {
      tapNode.connect(sharedDestination as AudioNode);
      sharedDestination = tapNode;
    }
  }
  const entry: PreparedEntry = { ...input, buffer, cues, decodedSampleRate: decoded.sampleRate, decodedSampleCount: decoded.sampleCount };
  prepared.set(prepareKey(input.actorId, input.responseText), entry);
  return { decodedSampleCount: decoded.sampleCount, decodedSampleRate: decoded.sampleRate };
}

export function decodePcm16MonoWav(wav: ArrayBuffer): { sampleRate: number; sampleCount: number; float32: Float32Array; pcm16: Int16Array } {
  return decodePcm16MonoWavPure(wav);
}

function getAuthoredMaterials(): Array<{ gltfMaterialIndex: number; opacity: number; transparent: boolean; alphaTest: number }> {
  const rows: Array<{ gltfMaterialIndex: number; opacity: number; transparent: boolean; alphaTest: number }> = [];
  const seen = new Set<unknown>();
  for (const session of sessions.values()) {
    session.slot.root?.traverse((object) => {
      const materials = Array.isArray((object as { material?: unknown }).material) ? (object as { material: unknown[] }).material : [(object as { material?: unknown }).material];
      for (const material of materials) {
        if (!material || seen.has(material)) continue;
        seen.add(material);
        const mat = material as { opacity?: number; transparent?: boolean; alphaTest?: number; userData?: { gltfMaterialIndex?: number } };
        rows.push({ gltfMaterialIndex: mat.userData?.gltfMaterialIndex ?? rows.length, opacity: mat.opacity ?? 1, transparent: mat.transparent === true, alphaTest: mat.alphaTest ?? 0 });
      }
    });
  }
  return rows;
}

declare global {
  interface Window {
    __openClinXrPreparedActorAudio?: {
      prepare: typeof prepareFromHost; start: typeof startPreparedActorTurnAudio; pause: typeof pausePreparedActorTurnAudio; resume: typeof resumePreparedActorTurnAudio; sync: typeof syncPreparedActorAudio;
      sessions: Map<string, OwnedSession>; getContext: () => AudioContext | undefined; getTap: () => AudioWorkletNode | undefined; getRecorderDestination: () => MediaStreamAudioDestinationNode | undefined;
      markUserActivated: typeof markUserActivated; getAuthoredMaterials: typeof getAuthoredMaterials; getPlayedTap: () => { samples: Float32Array; meta: typeof tapMeta };
    };
  }
}
