import { createCaseAudioController } from "./actor-audio-case-controller.js";
import type { CaseAudioOptions } from "./actor-audio-case-types.js";
import { createPlayback, createAudioSpeechClock } from "./actor-audio-playback-clock.js";
import { convertRhubarb, cuesAdmissible, decodePcm16MonoWav as decodePcm16MonoWavPure, hasPreparedEntry } from "./actor-audio-prepared-data.js";
import type { PlaybackContext, DiagnosticMouthCue } from "./actor-audio-prepared-data.js";
import type { Host, OwnedSession, LiveSlot, PreparedEntry, PreparedIdentity, PreparedActorStartContext } from "./actor-audio-types.js";
export function createActorAudioRuntime(options: { developmentFixture?: boolean; fixtureSearch?: string; caseAudio?: CaseAudioOptions } = {}) {
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

function retireOwnedActorSession(actorId: string): boolean {
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

type PreparedActorAudioOutcome =
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

function startPreparedActorTurnAudioOutcome(ctx: PreparedActorStartContext): PreparedActorAudioOutcome {
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
function startPreparedActorTurnAudio(ctx: PreparedActorStartContext): boolean {
  return startPreparedActorTurnAudioOutcome(ctx).kind === "audio_started";
}

function pausePreparedActorTurnAudio(actorId: string): boolean {
  const session = sessions.get(actorId);
  if (!session) return false;
  try { session.player.pauseNow(); } catch { return false; }
  session.clock.release();
  return session.slot.activeSpeech !== session.speech;
}

function resumePreparedActorTurnAudio(actorId: string): boolean {
  const session = sessions.get(actorId);
  if (!session) return false;
  const text = (session.speech as { text?: string }).text;
  if (typeof text !== "string") return false;
  const offset = session.player.position();
  return startPreparedActorTurnAudio({ actorId, spokenText: text, resumeOffset: offset });
}

function installPreparedActorAudioRuntime(input: {
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
function registerPreparedActorAudioEntry(entry: PreparedEntry): void {
  prepared.set(prepareKey(entry.actorId, entry.responseText), entry);
}

function syncPreparedActorAudio(displayNowMs: number): void {
  for (const session of sessions.values()) {
    session.clock.snapshot(displayNowMs);
  }
}

function speakFixtureEnabled(): boolean {
  const search = options.fixtureSearch ?? (typeof window === "undefined" ? "" : window.location.search);
  return options.developmentFixture === true && new URLSearchParams(search).get("openclinxrSpeakFixture") === "1";
}
function requireDiagnostic(): void { if (!speakFixtureEnabled()) throw new Error("diagnostic-disabled"); }
function initPreparedActorAudioBridge(deps?: Host): void {
  if (deps?.getSlot) host.getSlot = deps.getSlot;
  if (deps?.triggerDialogue) host.triggerDialogue = deps.triggerDialogue;
  if (typeof window !== "undefined" && speakFixtureEnabled())
    (window as Window & { __openClinXrPreparedActorAudio?: unknown }).__openClinXrPreparedActorAudio = diagnostics;
}
async function activateContext(): Promise<AudioContext> {
  requireDiagnostic();
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
function selectPreparationCues(input: Pick<PrepareHostInput, "mouthCues" | "diagnosticCues">): DiagnosticMouthCue[] {
  if (input.diagnosticCues !== undefined) {
    if (!speakFixtureEnabled()) throw new Error("diagnostic-cues-ingress-refused");
    if (!cuesAdmissible(input.diagnosticCues)) throw new Error("invalid-diagnostic-cues");
    return input.diagnosticCues.map((cue) => ({ ...cue }));
  }
  return convertRhubarb(input.mouthCues);
}

async function prepareFromHost(input: PrepareHostInput): Promise<{ decodedSampleCount: number; decodedSampleRate: number }> {
  const cues = selectPreparationCues(input);
  requireDiagnostic();
  const context = await activateContext();
  requireRunningContext(context);
  const decoded = decodePcm16MonoWavPure(input.wav);
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

type OrdinaryActorTurnSpeechOutcome =
  | { kind: "audio_started" }
  | { kind: "dialogue_only"; reason: "prepared_audio_unavailable" }
  | { kind: "refused"; reason: "prepared_audio_unavailable" | "invalid_cues" | "suspended" | "owned_stop_refusal" | "playback_failed" | "ordinary_setup_failed" };
type OrdinaryTurnHostAdapter = {
  readSpeech: (context: PreparedActorStartContext) => { text?: string } | undefined;
  startDialogue: (context: PreparedActorStartContext) => void;
};

function startActorTurnSpeech(
  context: PreparedActorStartContext,
  ordinary: ((context: PreparedActorStartContext) => boolean) | OrdinaryTurnHostAdapter,
): OrdinaryActorTurnSpeechOutcome {
  if (hasPreparedEntry(prepared, context.actorId, context.spokenText)) return startPreparedActorTurnAudioOutcome(context);
  try {
    const previous = typeof ordinary === "function" ? undefined : ordinary.readSpeech(context);
    if (!retireOwnedActorSession(context.actorId)) return { kind: "refused", reason: "owned_stop_refusal" };
    if (typeof ordinary === "function") {
      if (!ordinary(context)) return { kind: "refused", reason: "ordinary_setup_failed" };
    } else {
      ordinary.startDialogue(context);
      const speech = ordinary.readSpeech(context);
      if (!speech || speech.text !== context.spokenText || speech === previous) return { kind: "refused", reason: "ordinary_setup_failed" };
    }
    return { kind: "dialogue_only", reason: "prepared_audio_unavailable" };
  } catch {
    return { kind: "refused", reason: "ordinary_setup_failed" };
  }
}

function preparedActorTurnAudioAvailable(context: PreparedActorStartContext): boolean {
  return hasPreparedEntry(prepared, context.actorId, context.spokenText);
}
const diagnostics = Object.freeze({
  installRuntime(input: Parameters<typeof installPreparedActorAudioRuntime>[0]): void {
    requireDiagnostic();
    if (sessions.size) throw new Error("diagnostic-owner-active");
    installPreparedActorAudioRuntime(input);
  },
  registerEntry(entry: PreparedEntry): void { requireDiagnostic(); registerPreparedActorAudioEntry(entry); },
  prepare: prepareFromHost,
  start(ctx: PreparedActorStartContext) { requireDiagnostic(); return startPreparedActorTurnAudio(ctx); },
  pause(actorId: string) { requireDiagnostic(); return pausePreparedActorTurnAudio(actorId); },
  resume(actorId: string) { requireDiagnostic(); return resumePreparedActorTurnAudio(actorId); },
  sync(nowMs: number) { requireDiagnostic(); return syncPreparedActorAudio(nowMs); },
  async markUserActivated(): Promise<void> { await activateContext(); },
  selectPreparationCues,
  sessionSnapshots() { requireDiagnostic(); return Array.from(sessions.values(), s => ({ actorId: s.actorId, generation: s.generation, nodeSerial: s.nodeSerial, startedWhen: s.startedWhen, playback: { ...s.player.snapshot() } })); },
  graphSnapshot() { requireDiagnostic(); const c = sharedContext as AudioContext | undefined; return c ? { state: c.state, currentTime: c.currentTime, sampleRate: c.sampleRate, baseLatency: c.baseLatency, outputLatency: c.outputLatency, outputTimestamp: c.getOutputTimestamp ? { ...c.getOutputTimestamp() } : undefined } : undefined; },
  recorderStream() { requireDiagnostic(); return recorderDestination?.stream; },
  authoredMaterials() { requireDiagnostic(); return getAuthoredMaterials().map(row => ({ ...row })); },
  playedTap() {
    requireDiagnostic(); const samples = new Float32Array(tapChunks.reduce((n, part) => n + part.length, 0));
    let offset = 0; for (const part of tapChunks) { samples.set(part, offset); offset += part.length; }
    return { samples, meta: tapMeta ? { ...tapMeta } : undefined };
  },
});
const caseEntries = new Map<object, PreparedEntry>();
const sessionEntries = new WeakMap<OwnedSession, PreparedEntry>();
const caseOwners = new WeakMap<object, OwnedSession>();
const caseAudio = createCaseAudioController(options.caseAudio, {
  async activate() {
    if (typeof navigator === "undefined" || navigator.userActivation?.isActive !== true) return;
    const context = (sharedContext ?? new AudioContext()) as AudioContext;
    sharedContext = context;
    if (context.state !== "running") await context.resume();
    if (context.state !== "running") return;
    userActivated = true;
    sharedDestination ??= context.destination;
  },
  install(e, bytes) {
    const context = sharedContext as AudioContext | undefined;
    if (!userActivated || context?.state !== "running") return null;
    const buffer = context.createBuffer(1, bytes.decoded.sampleCount, bytes.decoded.sampleRate);
    buffer.getChannelData(0).set(bytes.decoded.float32);
    const entry: PreparedEntry = { scenarioId: e.scenarioId, actorId: e.actorId, responseText: e.spokenText, runnerConversationTurn: e.plan.turnIndex + 1, waveformSha256: e.waveformSha256, cueSha256: e.cueSha256, buffer, cues: bytes.cues, decodedSampleRate: bytes.decoded.sampleRate, decodedSampleCount: bytes.decoded.sampleCount };
    const handle = Object.freeze({}); caseEntries.set(handle, entry);
    return handle;
  },
  remove(handle) {
    const entry = caseEntries.get(handle);
    if (!entry) return true;
    const current = sessions.get(entry.actorId);
    if (current && sessionEntries.get(current) === entry && !retireOwnedActorSession(entry.actorId)) return false;
    if (prepared.get(prepareKey(entry.actorId, entry.responseText)) === entry) prepared.delete(prepareKey(entry.actorId, entry.responseText));
    caseEntries.delete(handle); return true;
  },
  begin(e, entryHandle, context) {
    const entry = caseEntries.get(entryHandle);
    if (!entry || entry.actorId !== e.actorId || entry.responseText !== e.spokenText || entry.waveformSha256 !== e.waveformSha256 || entry.cueSha256 !== e.cueSha256) return { kind: "refused", reason: "prepared_audio_unavailable" };
    const key = prepareKey(e.actorId, e.spokenText);
    const previous = prepared.get(key);
    prepared.set(key, entry);
    const result = startPreparedActorTurnAudioOutcome({ actorId: e.actorId, spokenText: e.spokenText, faceEmotion: e.artifacts.emotion!.to, gazeTarget: { kind: e.artifacts.gaze!.gazeTargetKind, actorId: e.artifacts.gaze!.gazeTargetActorId }, req: context.req });
    if (result.kind === "refused") {
      if (prepared.get(key) === entry) { if (previous) prepared.set(key, previous); else prepared.delete(key); }
      return result;
    }
    const session = sessions.get(e.actorId);
    if (!session) return { kind: "refused", reason: "playback_failed" };
    const handle = Object.freeze({}); caseOwners.set(handle, session); sessionEntries.set(session, entry);
    return { kind: "audio_started", handle };
  },
  inspect(handle, e) {
    const session = caseOwners.get(handle);
    if (!session || sessions.get(e.actorId) !== session || session.slot.activeSpeech !== session.speech) return false;
    const slot = session.slot as LiveSlot & { emotionExpression?: { targetEmotion?: string } };
    const speech = session.speech as typeof session.speech & { gazeTargetKind?: string; gazeTargetActorId?: string | null };
    return session.slot.activeSpeech?.bakedCues === prepared.get(prepareKey(e.actorId, e.spokenText))?.cues && slot.emotionExpression?.targetEmotion === e.artifacts.emotion?.to && speech.gazeTargetKind === e.artifacts.gaze?.gazeTargetKind && speech.gazeTargetActorId === e.artifacts.gaze?.gazeTargetActorId;
  },
  compensate(handle) {
    const session = caseOwners.get(handle);
    if (!session) return true;
    if (sessions.get(session.actorId) !== session) return true;
    if (!retireOwnedActorSession(session.actorId)) return false;
    caseOwners.delete(handle); return true;
  },
});
return Object.freeze({ caseAudio, initPreparedActorAudioBridge, startPreparedActorTurnAudio, startPreparedActorTurnAudioOutcome,
  syncPreparedActorAudio, preparedActorTurnAudioAvailable, startActorTurnSpeech, diagnostics });
}
