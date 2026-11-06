/**
 * C25: the production shell joins the xr-sync encounter room.
 *
 * Behind ?encounterSync=ws://host:port the shell connects through this thin
 * client (Colyseus SDK only, no IWSDK). The server owns the actor's turn; each
 * server turn (replyId, caption, emotion) becomes an ActorTurnPlan payload the
 * shell's existing actor-turn consumer reads. The shell supplies the player.
 * Lives in the package because apps/ui-xr is under a shrink-only line budget.
 */
import { type EncounterSnapshot, type IntentKind, type SyncConnection, connect } from "./index.js";
import { type GazeView, gazedActorId, pickAddressedActor } from "./addressed-actor.js";
import { createActorVoice, type ActorVoice, type SpokenTurnRecord, type VoiceEngine, type VoiceSink, type VoiceSlot } from "./actor-voice.js";
import { createBrowserVoiceParts } from "./actor-voice-browser.js";
import type { ConnectOptions } from "./options.js";
import { createLobbyPicker, type LobbyEvidence } from "./encounter-lobby.js";
import { mountSpeechCapture, type SpeechEvidence, type SpeechRecorder, type XrSessionLike } from "./speech-capture.js";
import { createBrowserSpeechRecorder } from "./speech-recorder-browser.js";

const SPEECH_LOW_CONFIDENCE = "speech_low_confidence";

/** One server-authoritative actor turn, as seen on the speaking edge. */
export interface SyncedActorTurn {
  turnId: number;
  actorId: string;
  replyId: string;
  caption: string;
  emotion: string;
  intake: string;
  retries: number;
}

const DIALOGUE_EMOTIONS: ReadonlySet<string> = new Set(["anxious", "concerned", "reassured", "neutral"]);

/** Returns the room url when ?encounterSync= holds a ws:// or wss:// url. */
export function encounterSyncUrl(search: string): { url: string; replayStation?: string; reviewLobby?: true } | null {
  const params = new URLSearchParams(search);
  const value = params.get("encounterSync");
  if (value === null || !/^wss?:\/\/[^\s/]+/u.test(value)) return null;
  const station = params.get("encounterReplayStation");
  if (station !== null) {
    if (!/^[A-Za-z0-9._:-]{1,64}$/u.test(station)) return null;
    if (params.get("encounterReviewLobby") === "1") return null;
    return { url: value, replayStation: station };
  }
  if (params.get("encounterReviewLobby") === "1") return { url: value, reviewLobby: true };
  return { url: value };
}

/** Stateful detector: one turn per (actor, turnId) when the actor is speaking; turnId restarts per station room. */
export function createActorTurnDetector(): (snapshot: EncounterSnapshot) => SyncedActorTurn[] {
  const emitted = new Map<string, number>();
  let station: string | undefined;
  return (snapshot) => {
    if (snapshot.stationId !== station) {
      station = snapshot.stationId;
      emitted.clear();
    }
    const turns: SyncedActorTurn[] = [];
    // The SDK replays a snapshot before the first patch has populated the actor map.
    for (const [actorId, actor] of Object.entries(snapshot.actors ?? {})) {
      if (!actor.speaking || emitted.get(actorId) === snapshot.turnId) continue;
      emitted.set(actorId, snapshot.turnId);
      const turn = { turnId: snapshot.turnId, actorId, replyId: actor.replyId, caption: actor.caption ?? "", emotion: actor.emotion } as SyncedActorTurn;
      if (actor.intake === undefined && actor.retries === undefined) {
        Object.defineProperties(turn, {
          intake: { value: "", enumerable: false },
          retries: { value: 0, enumerable: false },
        });
      } else {
        turn.intake = actor.intake ?? "";
        turn.retries = actor.retries ?? 0;
      }
      turns.push(turn);
    }
    return turns;
  };
}

/** liveActorTurnFromPayload input for one synced turn: caption = spokenText, face = dialogueEmotionTo. */
export function syncedTurnPayload(turn: SyncedActorTurn, stationId: string): Record<string, unknown> {
  return {
    actorTurnPlan: {
      planId: `xr-sync:${stationId}:${turn.actorId}:${turn.replyId}`,
      turnId: String(turn.turnId),
      actorId: turn.actorId,
      spokenText: turn.caption,
      spokenTextForTts: turn.caption,
      dialogueEmotionTo: DIALOGUE_EMOTIONS.has(turn.emotion) ? turn.emotion : "neutral",
      prosody: { droppedTags: [] },
      notEvidenceFor: ["clinical_validity", "exam_equivalence", "scoring", "learner_readiness"],
    },
  };
}

/** One learner trace action sent as intents; statuses hold the result of each intent actually sent. */
interface SentTraceAction {
  actorId: string;
  topicTag: string;
  statuses: string[];
}

/** One learner free-text utterance sent as intents; statuses hold the result of each intent actually sent. Never the text. */
export interface SentUtterance {
  actorId: string;
  chars: number;
  statuses: string[];
}

/** One learner speech utterance sent as intents; statuses hold the result of each intent actually sent. Never the text. */
export interface SentSpeech {
  actorId: string;
  chars: number;
  confidence: number;
  statuses: string[];
}

/** Send intent steps in order, stopping at the first non-ack; never throws. */
async function sendIntentSteps(
  sendIntent: SyncConnection["sendIntent"],
  statuses: string[],
  steps: Array<[IntentKind, Record<string, string | number>]>,
): Promise<void> {
  for (const [kind, payload] of steps) {
    try {
      const result = await sendIntent(kind, payload);
      statuses.push(result.status);
      if (result.status !== "ack") return;
    } catch {
      statuses.push("error");
      return;
    }
  }
}

/**
 * C26: a learner trace action (topic selection) as the three intents the room reads:
 * select-actor, utterance-start, utterance-end{topicTag}. Stops at the first non-ack; never throws.
 */
async function sendTraceActionIntents(
  sendIntent: SyncConnection["sendIntent"],
  log: SentTraceAction[],
  actorId: string | undefined,
  topicTag: string,
): Promise<void> {
  if (actorId === undefined || actorId === "") return;
  const entry: SentTraceAction = { actorId, topicTag, statuses: [] };
  log.push(entry);
  await sendIntentSteps(sendIntent, entry.statuses, [["select-actor", { actorId }], ["utterance-start", {}], ["utterance-end", { topicTag }]]);
}

/** C27: a learner free-text utterance as select-actor, utterance-start, utterance-end{text}. Never throws. */
async function sendUtteranceIntents(
  sendIntent: SyncConnection["sendIntent"],
  log: SentUtterance[],
  actorId: string | undefined,
  text: string,
): Promise<void> {
  if (actorId === undefined || actorId === "") return;
  const trimmed = text.trim();
  // The room rejects text over 500 chars after utterance-start opened the turn, which would wedge later sends.
  if (trimmed === "" || trimmed.length > 500) return;
  const entry: SentUtterance = { actorId, chars: trimmed.length, statuses: [] };
  log.push(entry);
  await sendIntentSteps(sendIntent, entry.statuses, [["select-actor", { actorId }], ["utterance-start", {}], ["utterance-end", { text: trimmed }]]);
}

/** C29: a recognized speech utterance as select-actor, utterance-start, utterance-end{text, modality, confidence}. Never throws. */
export async function sendSpeechIntents(
  sendIntent: SyncConnection["sendIntent"],
  log: SentSpeech[],
  actorId: string | undefined,
  text: string,
  confidence: number,
): Promise<void> {
  if (actorId === undefined || actorId === "") return;
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.length > 500) return;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return;
  const entry: SentSpeech = { actorId, chars: trimmed.length, confidence, statuses: [] };
  log.push(entry);
  await sendIntentSteps(sendIntent, entry.statuses, [["select-actor", { actorId }], ["utterance-start", {}], ["utterance-end", { text: trimmed, modality: "speech", confidence }]]);
}

export interface EncounterSyncHandle {
  readonly sessionId: string;
  /** Learner trace-action sends, in order. */
  readonly intents: readonly SentTraceAction[];
  sendTraceAction(actorId: string | undefined, topicTag: string): Promise<void>;
  /** C27 learner free-text sends, in order (lengths and statuses, never text). */
  readonly utterances: readonly SentUtterance[];
  sendUtterance(actorId: string | undefined, text: string): Promise<void>;
  /** C29 learner speech sends, in order (lengths, confidence and statuses, never text). */
  readonly speechUtterances: readonly SentSpeech[];
  sendSpeech(actorId: string | undefined, text: string, confidence: number): Promise<void>;
  /** Every turn forwarded to onTurn, in order. */
  readonly turns: readonly SyncedActorTurn[];
  sendIntent: SyncConnection["sendIntent"];
  leave(): Promise<void>;
}

export interface JoinEncounterRoomOptions {
  url: string;
  actorIds: readonly string[];
  replayStation?: string;
  reviewLobby?: boolean;
  onSnapshot?(snapshot: EncounterSnapshot): void;
  onTurn(turn: SyncedActorTurn, stationId: string): void;
  connectFn?: (url: string, options?: ConnectOptions) => Promise<SyncConnection>;
}

/** Join the room and forward each detected actor turn to onTurn. */
export async function joinEncounterRoom(options: JoinEncounterRoomOptions): Promise<EncounterSyncHandle> {
  const connectFn = options.connectFn ?? connect;
  const roomOptions = options.reviewLobby === true
    ? { reviewLobby: true }
    : { actors: [...options.actorIds], ...(options.replayStation === undefined ? {} : { replayStationId: options.replayStation }) };
  const connection = await connectFn(options.url, { roomOptions });
  const detect = createActorTurnDetector();
  const turns: SyncedActorTurn[] = [];
  connection.onState((snapshot) => {
    options.onSnapshot?.(snapshot);
    for (const turn of detect(snapshot)) {
      turns.push(turn);
      options.onTurn(turn, snapshot.stationId ?? "");
    }
  });
  const intents: SentTraceAction[] = [];
  const utterances: SentUtterance[] = [];
  const speechUtterances: SentSpeech[] = [];
  let queue: Promise<void> = Promise.resolve();
  return {
    sessionId: connection.sessionId,
    intents,
    // One trace action at a time: a second click waits for the first one's three intents.
    sendTraceAction: (actorId, topicTag) => (queue = queue.then(() => sendTraceActionIntents((kind, payload) => connection.sendIntent(kind, payload), intents, actorId, topicTag))),
    utterances,
    // Same queue as trace actions: text waits for the open action's three intents and vice versa.
    sendUtterance: (actorId, text) => (queue = queue.then(() => sendUtteranceIntents((kind, payload) => connection.sendIntent(kind, payload), utterances, actorId, text))),
    speechUtterances,
    sendSpeech: (actorId, text, confidence) => (queue = queue.then(() => sendSpeechIntents((kind, payload) => connection.sendIntent(kind, payload), speechUtterances, actorId, text, confidence))),
    turns,
    sendIntent: (kind: IntentKind, payload) => connection.sendIntent(kind, payload),
    leave: () => connection.leave(),
  };
}

/** One played turn as published on window.__openClinXrEncounterSync. */
export interface PlayedSyncedTurn extends SyncedActorTurn {
  stationId: string;
  /** Emotion read back from the registered plan (plan.dialogueEmotionTo). */
  faceEmotion: string;
  /** Caption read back from the registered plan (plan.spokenText). */
  planCaption: string;
  playedAtMs: number;
  /** False when the server turn carried no caption (an uncast fallback reply): recorded, not played. */
  spoken: boolean;
}

/** Window evidence for the host and Quest harnesses. */
export interface EncounterSyncEvidence {
  url: string;
  state: "joining" | "joined" | "failed";
  sessionId: string;
  error: string;
  turns: PlayedSyncedTurn[];
  sendIntent?: SyncConnection["sendIntent"];
  /** C26: learner trace actions sent to the room, with per-intent statuses. */
  intents?: readonly SentTraceAction[];
  sendTraceAction?: EncounterSyncHandle["sendTraceAction"];
  /** C27: learner free-text sends, with text lengths and per-intent statuses (never the text). */
  utterances?: readonly SentUtterance[];
  sendUtterance?: EncounterSyncHandle["sendUtterance"];
  /** C29: learner speech sends, with text lengths, confidence and per-intent statuses (never the text). */
  speechUtterances?: readonly SentSpeech[];
  sendSpeech?: EncounterSyncHandle["sendSpeech"];
  /** C28: the actor the learner's view names right now (the first thing the typed-text box addresses). */
  gazedActorId?: () => string | undefined;
  /** C31: the replayed station id when joined from ?encounterReplayStation= (a replay room rejects every intent). */
  replayStation?: string;
  /** C30 on-device actor-voice evidence and user-gesture audio unlock. */
  voice?: { records: readonly SpokenTurnRecord[]; unlock(): Promise<void>; mouth(actorId: string): number; mouthTargets(actorId: string): Record<string, number>; audioState(): string; error?: string };
  /** C30 low-confidence actor turns that asked the learner to repeat. */
  repeatPrompts?: Array<{ actorId: string; turnId: number; retries: number }>;
  /** C32 review-lobby station list and select-station outcomes. */
  lobby?: LobbyEvidence;
  /** C33 learner speech captures (counts and statuses, never text or audio). */
  speech?: SpeechEvidence;
}

/** Structural input/button surface for the learner free-text box (no DOM lib in this package). */
export interface UtteranceBoxElement {
  id: string;
  value?: string;
  textContent: string | null;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  hidden?: boolean;
  appendChild(child: UtteranceBoxElement): unknown;
  addEventListener(type: string, listener: (event: { key?: string; isComposing?: boolean; shiftKey?: boolean; preventDefault?: () => void; stopPropagation?: () => void }) => void): void;
}

/** DOM mount point for the learner free-text box. */
export interface UtteranceBoxDeps {
  doc: { createElement(tag: string): UtteranceBoxElement };
  parent: UtteranceBoxElement;
}

export interface StartEncounterSyncDeps {
  search: string;
  actorIds(): string[];
  /** Plays one registered turn: the shell's triggerHumanoidDialogue with plan-sourced emotion. */
  play(actorId: string, caption: string, faceEmotion: string): void;
  register(payload: Record<string, unknown>, tag: string): { caption: string; faceEmotion: string } | undefined;
  publish(evidence: EncounterSyncEvidence): void;
  nowMs(): number;
  connectFn?: JoinEncounterRoomOptions["connectFn"];
  /** C28: the learner's eye, view axis and the cast's head positions right now; the typed-text box addresses the actor in view first. */
  gazeView?(): GazeView | undefined;
  /** C27 learner free-text box mount; unset mounts nothing. */
  utteranceBox?: UtteranceBoxDeps;
  /** C33 learner speech capture; unset mounts no hold-to-speak button. */
  speech?: { recorder?: SpeechRecorder; xrSession?: () => XrSessionLike | null | undefined; inject?: boolean };
  /** C30 on-device actor voice wired to the shell's existing speech slot. */
  voice?: {
    assetBase: string;
    slotFor(actorId: string): VoiceSlot | undefined;
    voiceFor(actorId: string): string | undefined;
    engine?: VoiceEngine;
    sink?: VoiceSink;
  };
}

/** Join when ?encounterSync= is present; resolves after the join settles. No-op (null) without the flag. */
export async function startEncounterSyncFromUrl(deps: StartEncounterSyncDeps): Promise<EncounterSyncHandle | null> {
  const flag = encounterSyncUrl(deps.search);
  if (flag === null) return null;
  const isReplayRoom = flag.replayStation !== undefined;
  const isLobby = flag.reviewLobby === true;
  const evidence: EncounterSyncEvidence = { url: flag.url, state: "joining", sessionId: "", error: "", turns: [] };
  if (flag.replayStation !== undefined) evidence.replayStation = flag.replayStation;
  let sendSelect: (stationId: string) => Promise<{ status: string; reason?: string }> = () =>
    Promise.resolve({ status: "error", reason: "not-joined" });
  let sendReturn: () => Promise<{ status: string; reason?: string }> = () =>
    Promise.resolve({ status: "error", reason: "not-joined" });
  const picker = isLobby && deps.utteranceBox !== undefined
    ? createLobbyPicker({ box: deps.utteranceBox, select: (stationId) => sendSelect(stationId), returnToLobby: () => sendReturn() })
    : undefined;
  if (picker !== undefined) evidence.lobby = picker.evidence;
  let voice: ActorVoice | undefined;
  if (deps.voice !== undefined) {
    try {
      const parts = deps.voice.engine !== undefined && deps.voice.sink !== undefined
        ? undefined
        : createBrowserVoiceParts({ assetBase: deps.voice.assetBase });
      const engine = deps.voice.engine ?? parts?.engine;
      const sink = deps.voice.sink ?? parts?.sink;
      if (engine === undefined || sink === undefined) throw new Error("actor voice engine and sink are required");
      voice = createActorVoice({
        engine,
        sink,
        slotFor: deps.voice.slotFor,
        voiceFor: deps.voice.voiceFor,
        nowMs: deps.nowMs,
      });
      evidence.voice = { records: voice.records, unlock: parts?.unlock ?? (async () => undefined), mouth: (actorId) => voice?.mouth(actorId) ?? 0, mouthTargets: (actorId) => voice?.mouthTargets(actorId) ?? {}, audioState: parts?.audioState ?? (() => "injected") };
    } catch (error) {
      evidence.voice = { records: [], unlock: async () => undefined, mouth: () => 0, mouthTargets: () => ({}), audioState: () => "none", error: error instanceof Error ? error.message : String(error) };
    }
  }
  if (deps.utteranceBox !== undefined && !isReplayRoom && !isLobby) evidence.repeatPrompts = [];
  deps.publish(evidence);
  const gazedNow = (): string | undefined => {
    const view = deps.gazeView?.();
    return view === undefined ? undefined : gazedActorId(view.eye, view.forward, view.actors);
  };
  let lastSpokeActorId: string | undefined;
  let lastAddressedActorId: string | undefined;
  let repeatPrompt: UtteranceBoxElement | undefined;
  let speechEvidence: SpeechEvidence | undefined;
  try {
    const handle = await joinEncounterRoom({
      url: flag.url,
      actorIds: deps.actorIds(),
      ...(flag.replayStation === undefined ? {} : { replayStation: flag.replayStation }),
      reviewLobby: isLobby,
      onSnapshot: (snapshot) => { picker?.render(snapshot); speechEvidence?.setServerSpeech(snapshot.speechAvailable); },
      ...(deps.connectFn === undefined ? {} : { connectFn: deps.connectFn }),
      onTurn: (turn, stationId) => {
        lastSpokeActorId = turn.actorId;
        if (turn.intake === SPEECH_LOW_CONFIDENCE) {
          if (repeatPrompt !== undefined) repeatPrompt.textContent = turn.retries === 1 ? "Please repeat that." : `Please repeat that. (attempt ${turn.retries})`;
          evidence.repeatPrompts?.push({ actorId: turn.actorId, turnId: turn.turnId, retries: turn.retries });
        } else if (repeatPrompt !== undefined) {
          repeatPrompt.textContent = "";
        }
        const registered = deps.register(syncedTurnPayload(turn, stationId), `xr-sync:${turn.turnId}:${turn.actorId}`);
        if (registered === undefined) return;
        const spoken = registered.caption !== "";
        if (spoken) {
          deps.play(turn.actorId, registered.caption, registered.faceEmotion);
          void voice?.speakTurn({ actorId: turn.actorId, caption: registered.caption, turnKey: `${turn.turnId}:${turn.actorId}` });
        }
        evidence.turns.push({ ...turn, stationId, faceEmotion: registered.faceEmotion, planCaption: registered.caption, playedAtMs: deps.nowMs(), spoken });
      },
    });
    evidence.state = "joined";
    evidence.sessionId = handle.sessionId;
    evidence.sendIntent = handle.sendIntent;
    evidence.intents = handle.intents;
    evidence.sendTraceAction = handle.sendTraceAction;
    evidence.utterances = handle.utterances;
    evidence.sendUtterance = handle.sendUtterance;
    evidence.speechUtterances = handle.speechUtterances;
    evidence.sendSpeech = (actorId, text, confidence) => handle.sendSpeech(actorId, text, confidence);
    evidence.gazedActorId = gazedNow;
    sendSelect = (stationId) => handle.sendIntent("select-station", { stationId });
    sendReturn = () => handle.sendIntent("return-to-lobby", {});
    if (deps.utteranceBox !== undefined && !isReplayRoom && !isLobby) {
      repeatPrompt = deps.utteranceBox.doc.createElement("div");
      repeatPrompt.id = "repeat-prompt";
      repeatPrompt.textContent = "";
      deps.utteranceBox.parent.appendChild(repeatPrompt);
      const caption = deps.utteranceBox.doc.createElement("div");
      caption.id = "learner-caption";
      caption.textContent = "";
      deps.utteranceBox.parent.appendChild(caption);
      const setCaption = (text: string, confidence?: number): void => {
        caption.textContent = confidence !== undefined ? `You said (${confidence.toFixed(2)}): ${text.trim()}` : `You said: ${text.trim()}`;
      };
      evidence.sendSpeech = (actorId, text, confidence) => {
        const trimmed = text.trim();
        if (actorId !== undefined && actorId !== "" && trimmed !== "" && trimmed.length <= 500 && typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1) {
          setCaption(text, confidence);
        }
        return handle.sendSpeech(actorId, text, confidence);
      };
      const input = deps.utteranceBox.doc.createElement("input");
      input.id = "utterance-input";
      input.type = "text";
      input.placeholder = "Type what you say to the patient";
      const button = deps.utteranceBox.doc.createElement("button");
      button.id = "utterance-send";
      button.textContent = "Say";
      deps.utteranceBox.parent.appendChild(input);
      deps.utteranceBox.parent.appendChild(button);
      const submit = (): void => {
        const text = input.value ?? "";
        if (text.trim() === "" || text.trim().length > 500) return;
        input.value = "";
        const actorId = pickAddressedActor({ actorIds: deps.actorIds(), gazedActorId: gazedNow(), lastSpokeActorId, lastAddressedActorId });
        if (actorId === undefined || actorId === "") return;
        lastAddressedActorId = actorId;
        setCaption(text);
        void handle.sendUtterance(actorId, text);
      };
      button.addEventListener("click", submit);
      input.addEventListener("keydown", (event) => {
        // Typing must not trigger the shell's keyboard shortcuts.
        event.stopPropagation?.();
        if (event.key !== "Enter" || event.shiftKey === true || event.isComposing === true) return;
        event.preventDefault?.();
        submit();
      });
      if (deps.speech !== undefined) {
        const recorder = deps.speech.recorder ?? createBrowserSpeechRecorder();
        const xr = deps.speech.xrSession === undefined ? {} : { xrSession: deps.speech.xrSession };
        speechEvidence = mountSpeechCapture({ box: deps.utteranceBox, speech: { recorder, ...xr }, nowMs: deps.nowMs,
          sendAudio: (pcm): Promise<{ status: string; reason?: string; transcript?: { text: string; confidence: number } }> => handle.sendIntent("speech-audio", { pcm, sampleRate: 16000 }).then((r): { status: string; reason?: string; transcript?: { text: string; confidence: number } } => (r.status === "ack" ? (r.transcript === undefined ? { status: r.status } : { status: r.status, transcript: r.transcript }) : { status: r.status, reason: r.reason })),
          pickActor: () => { const actor = pickAddressedActor({ actorIds: deps.actorIds(), gazedActorId: gazedNow(), lastSpokeActorId, lastAddressedActorId }); if (actor !== undefined) lastAddressedActorId = actor; return actor; },
          sendSpeech: (a, t, c) => evidence.sendSpeech!(a, t, c) });
        evidence.speech = speechEvidence;
        if (deps.speech.inject !== true) delete evidence.speech.inject;
      }
    }
    return handle;
  } catch (error) {
    evidence.state = "failed";
    evidence.error = (error instanceof Error ? error.stack ?? error.message : String(error)).slice(0, 700);
    return null;
  }
}
