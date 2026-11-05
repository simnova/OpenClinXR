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
import type { ConnectOptions } from "./options.js";

/** One server-authoritative actor turn, as seen on the speaking edge. */
export interface SyncedActorTurn {
  turnId: number;
  actorId: string;
  replyId: string;
  caption: string;
  emotion: string;
}

const DIALOGUE_EMOTIONS: ReadonlySet<string> = new Set(["anxious", "concerned", "reassured", "neutral"]);

/** Returns the room url when ?encounterSync= holds a ws:// or wss:// url. */
export function encounterSyncUrl(search: string): { url: string } | null {
  const value = new URLSearchParams(search).get("encounterSync");
  if (value === null || !/^wss?:\/\/[^\s/]+/u.test(value)) return null;
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
      turns.push({ turnId: snapshot.turnId, actorId, replyId: actor.replyId, caption: actor.caption ?? "", emotion: actor.emotion });
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

/** Send intent steps in order, stopping at the first non-ack; never throws. */
async function sendIntentSteps(
  sendIntent: SyncConnection["sendIntent"],
  statuses: string[],
  steps: Array<[IntentKind, Record<string, string>]>,
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
  if (trimmed === "") return;
  const entry: SentUtterance = { actorId, chars: trimmed.length, statuses: [] };
  log.push(entry);
  await sendIntentSteps(sendIntent, entry.statuses, [["select-actor", { actorId }], ["utterance-start", {}], ["utterance-end", { text: trimmed }]]);
}

export interface EncounterSyncHandle {
  readonly sessionId: string;
  /** Learner trace-action sends, in order. */
  readonly intents: readonly SentTraceAction[];
  sendTraceAction(actorId: string | undefined, topicTag: string): Promise<void>;
  /** C27 learner free-text sends, in order (lengths and statuses, never text). */
  readonly utterances: readonly SentUtterance[];
  sendUtterance(actorId: string | undefined, text: string): Promise<void>;
  /** Every turn forwarded to onTurn, in order. */
  readonly turns: readonly SyncedActorTurn[];
  sendIntent: SyncConnection["sendIntent"];
  leave(): Promise<void>;
}

export interface JoinEncounterRoomOptions {
  url: string;
  actorIds: readonly string[];
  onTurn(turn: SyncedActorTurn, stationId: string): void;
  connectFn?: (url: string, options?: ConnectOptions) => Promise<SyncConnection>;
}

/** Join the room and forward each detected actor turn to onTurn. */
export async function joinEncounterRoom(options: JoinEncounterRoomOptions): Promise<EncounterSyncHandle> {
  const connectFn = options.connectFn ?? connect;
  const connection = await connectFn(options.url, { roomOptions: { actors: [...options.actorIds] } });
  const detect = createActorTurnDetector();
  const turns: SyncedActorTurn[] = [];
  connection.onState((snapshot) => {
    for (const turn of detect(snapshot)) {
      turns.push(turn);
      options.onTurn(turn, snapshot.stationId ?? "");
    }
  });
  const intents: SentTraceAction[] = [];
  const utterances: SentUtterance[] = [];
  let queue: Promise<void> = Promise.resolve();
  return {
    sessionId: connection.sessionId,
    intents,
    // One trace action at a time: a second click waits for the first one's three intents.
    sendTraceAction: (actorId, topicTag) => (queue = queue.then(() => sendTraceActionIntents((kind, payload) => connection.sendIntent(kind, payload), intents, actorId, topicTag))),
    utterances,
    // Same queue as trace actions: text waits for the open action's three intents and vice versa.
    sendUtterance: (actorId, text) => (queue = queue.then(() => sendUtteranceIntents((kind, payload) => connection.sendIntent(kind, payload), utterances, actorId, text))),
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
}

/** Structural input/button surface for the learner free-text box (no DOM lib in this package). */
export interface UtteranceBoxElement {
  id: string;
  value?: string;
  textContent: string | null;
  type?: string;
  placeholder?: string;
  appendChild(child: UtteranceBoxElement): unknown;
  addEventListener(type: string, listener: (event: { preventDefault?: () => void }) => void): void;
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
  /** C27 learner free-text box mount; unset mounts nothing. */
  utteranceBox?: UtteranceBoxDeps;
}

/** Join when ?encounterSync= is present; resolves after the join settles. No-op (null) without the flag. */
export async function startEncounterSyncFromUrl(deps: StartEncounterSyncDeps): Promise<EncounterSyncHandle | null> {
  const flag = encounterSyncUrl(deps.search);
  if (flag === null) return null;
  const evidence: EncounterSyncEvidence = { url: flag.url, state: "joining", sessionId: "", error: "", turns: [] };
  deps.publish(evidence);
  try {
    const handle = await joinEncounterRoom({
      url: flag.url,
      actorIds: deps.actorIds(),
      ...(deps.connectFn === undefined ? {} : { connectFn: deps.connectFn }),
      onTurn: (turn, stationId) => {
        const registered = deps.register(syncedTurnPayload(turn, stationId), `xr-sync:${turn.turnId}:${turn.actorId}`);
        if (registered === undefined) return;
        const spoken = registered.caption !== "";
        if (spoken) deps.play(turn.actorId, registered.caption, registered.faceEmotion);
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
    if (deps.utteranceBox !== undefined) {
      const input = deps.utteranceBox.doc.createElement("input");
      input.id = "utterance-input";
      input.type = "text";
      input.placeholder = "Type what you say to the patient";
      const button = deps.utteranceBox.doc.createElement("button");
      button.id = "utterance-send";
      button.textContent = "Say";
      deps.utteranceBox.parent.appendChild(input);
      deps.utteranceBox.parent.appendChild(button);
      button.addEventListener("click", () => {
        const text = input.value ?? "";
        if (text.trim() === "") return;
        input.value = "";
        void handle.sendUtterance(deps.actorIds()[0], text);
      });
    }
    return handle;
  } catch (error) {
    evidence.state = "failed";
    evidence.error = (error instanceof Error ? error.stack ?? error.message : String(error)).slice(0, 700);
    return null;
  }
}
