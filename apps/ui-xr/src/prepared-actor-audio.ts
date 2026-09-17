/** App-local prepared PCM transport and source-relative speech clock. Diagnostic nine-shape map is approximate. */
export const DIAGNOSTIC_RHUBARB_SHAPES: Readonly<Record<string, string>> = { A: "PP", B: "DD", C: "E", D: "aa", E: "O", F: "U", G: "FF", H: "nn", X: "sil" };

export type DiagnosticMouthCue = { phoneme: string; atSecond: number; durationSeconds: number };
export function convertRhubarb(doc: { mouthCues?: ReadonlyArray<{ start: number; end: number; value: string }> }): DiagnosticMouthCue[] {
  const cues = doc?.mouthCues ?? [];
  const out: DiagnosticMouthCue[] = [];
  for (const cue of cues) {
    const value = String(cue?.value ?? "");
    const start = Number(cue?.start);
    const end = Number(cue?.end);
    if (!(value in DIAGNOSTIC_RHUBARB_SHAPES) || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error("invalid-rhubarb-cue");
    }
    if (out.length > 0) {
      const prev = out[out.length - 1];
      if (prev && start < prev.atSecond + prev.durationSeconds) throw new Error("overlapping-rhubarb-cues");
    }
    const phoneme = DIAGNOSTIC_RHUBARB_SHAPES[value];
    if (!phoneme) throw new Error("invalid-rhubarb-cue");
    out.push({ phoneme, atSecond: start, durationSeconds: end - start });
  }
  return out;
}

type PlaybackIdentity = { waveformSha256: string; cueSha256: string; actorId: string; generation: string; decodedSampleRate: number; decodedSampleCount: number };

type PlaybackSource = {
  playbackRate: { value: number };
  buffer: unknown;
  connect(dest: unknown): void;
  start(when: number, offset: number): void;
  stop?: (() => unknown) | undefined;
  onended: (() => void) | null;
};

type PlaybackContext = {
  currentTime: number;
  state: string;
  sampleRate?: number;
  resume?: () => Promise<unknown>;
  createBufferSource(): PlaybackSource;
};

type PlaybackBuffer = { duration: number; sampleRate?: number; length?: number };

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
  ended: () => boolean;
  pauseNow: () => void;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  position: () => number; positionAt: (contextTime: number) => number;
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
    return { contextTime, position: positionAt(contextTime) };
  }

  function startNow(opts: { when: number; offset: number; rate: number }): void {
    if (playbackContext.state !== "running") throw new Error("audio-context-not-running");
    const next = playbackContext.createBufferSource();
    next.buffer = playbackBuffer;
    next.playbackRate.value = opts.rate;
    next.connect(playbackDestination);
    next.start(opts.when, opts.offset);
    serial += 1;
    const held = next;
    next.onended = () => {
      if (source === held) { playing = false; naturallyEnded = true; }
    };
    source = next;
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
  function stop(): Promise<void> {
    try { stopNow(); return Promise.resolve(); } catch (error) { return Promise.reject(error); }
  }

  return {
    start,
    startNow,
    stopNow,
    ended: () => naturallyEnded,
    pauseNow,
    pause,
    resume,
    stop,
    position: livePosition,
    positionAt,
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

function cuesAdmissible(cues: readonly DiagnosticMouthCue[] | undefined): boolean {
  if (!cues?.length) return false;
  let end = Number.NEGATIVE_INFINITY;
  for (const cue of cues) {
    if (!Number.isFinite(cue.atSecond) || cue.atSecond < 0 || !Number.isFinite(cue.durationSeconds) || cue.durationSeconds <= 0) return false;
    if (cue.atSecond < end) return false;
    end = cue.atSecond + cue.durationSeconds;
  }
  return true;
}

function observePlayer(player: ReturnType<typeof createPlayback>, clockState: { lastContextTime: number; lastPosition: number }): number {
  const snap = player.snapshot();
  clockState.lastContextTime = snap.contextTime; clockState.lastPosition = snap.position;
  return snap.position;
}

function stopOwned(session: OwnedSession | undefined): boolean {
  if (!session || session.player.ended()) return true;
  try { session.player.stopNow(); return true; } catch { return false; }
}

export function startPreparedActorTurnAudio(ctx: PreparedActorStartContext): boolean {
  void ctx.contextState;
  void ctx.userActivated;
  const entry = prepared.get(prepareKey(ctx.actorId, ctx.spokenText));
  if (!entry) return false;
  if (!cuesAdmissible(entry.cues)) return false;
  if (sharedContext?.state !== "running" || !userActivated || !sharedDestination) return false;
  const previous = sessions.get(ctx.actorId);
  if (!stopOwned(previous)) return false;
  host.triggerDialogue?.(ctx);
  const slot = host.getSlot?.(ctx.actorId) as LiveSlot | undefined;
  if (!slot?.activeSpeech || slot.activeSpeech.text !== ctx.spokenText) return false;
  if (previous && slot.activeSpeech === previous.speech) slot.activeSpeech = { ...previous.speech, text: ctx.spokenText };
  const speech = slot.activeSpeech;
  if (!speech) return false;
  try {
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
    player.startNow({ when, offset: resumeOffset, rate: 1 });
    if (tapMeta) tapMeta.nodeSerial = player.nodeSerial();
    if (slot.root) slot.root.userData = { ...slot.root.userData, openClinXrPreparedGeneration: generation };
    speech.durationMs = (entry.decodedSampleCount / entry.decodedSampleRate) * 1000;
    speech.bakedCues = entry.cues;
    const clockState = { lastContextTime: when, lastPosition: 0 };
    slot.mediaPositionSeconds = () => observePlayer(player, clockState);
    const clock = createAudioSpeechClock({ slot, speech, positionSeconds: () => observePlayer(player, clockState), wallOriginMs: performance.now(), rate: 1 });
    previous?.clock.release();
    if (!slot.activeSpeech) return false;
    sessions.set(ctx.actorId, { actorId: ctx.actorId, player, clock, speech, slot, generation, nodeSerial: player.nodeSerial(), startedWhen: when, clockState });
    return slot.activeSpeech === speech;
  } catch {
    return false;
  }
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
};

async function prepareFromHost(input: PrepareHostInput): Promise<{ decodedSampleCount: number; decodedSampleRate: number }> {
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
  const cues = convertRhubarb(input.mouthCues);
  const entry: PreparedEntry = { ...input, buffer, cues, decodedSampleRate: decoded.sampleRate, decodedSampleCount: decoded.sampleCount };
  prepared.set(prepareKey(input.actorId, input.responseText), entry);
  return { decodedSampleCount: decoded.sampleCount, decodedSampleRate: decoded.sampleRate };
}

export function decodePcm16MonoWav(wav: ArrayBuffer): { sampleRate: number; sampleCount: number; float32: Float32Array; pcm16: Int16Array } {
  const bytes = new Uint8Array(wav);
  const view = new DataView(wav);
  const ascii = (start: number, n: number) => String.fromCharCode(...bytes.subarray(start, start + n));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") throw new Error("invalid-waveform-container");
  let fmt: DataView | undefined;
  let dataOffset = 0;
  let dataSize = 0;
  for (let p = 12; p + 8 <= bytes.length; ) {
    const tag = ascii(p, 4);
    const size = view.getUint32(p + 4, true);
    const start = p + 8;
    if (start + size > bytes.length) throw new Error("truncated-waveform-chunk");
    if (tag === "fmt ") fmt = new DataView(wav, start, size);
    if (tag === "data") {
      dataOffset = start;
      dataSize = size;
    }
    p = start + size + (size % 2);
  }
  if (!fmt || fmt.byteLength < 16 || dataSize <= 0) throw new Error("unsupported-waveform-domain");
  if (fmt.getUint16(0, true) !== 1 || fmt.getUint16(2, true) !== 1 || fmt.getUint16(14, true) !== 16 || dataSize % 2) {
    throw new Error("unsupported-waveform-domain");
  }
  const sampleRate = fmt.getUint32(4, true);
  const sampleCount = dataSize / 2;
  const pcm16 = new Int16Array(wav, dataOffset, sampleCount);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) float32[i] = (pcm16[i] ?? 0) / 32768;
  return { sampleRate, sampleCount, float32, pcm16 };
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
