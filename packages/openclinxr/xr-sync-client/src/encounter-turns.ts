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

/** Stateful detector: one turn per (actor, turnId) when the actor is speaking. */
export function createActorTurnDetector(): (snapshot: EncounterSnapshot) => SyncedActorTurn[] {
  const emitted = new Map<string, number>();
  return (snapshot) => {
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

export interface EncounterSyncHandle {
  readonly sessionId: string;
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
  return {
    sessionId: connection.sessionId,
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
    return handle;
  } catch (error) {
    evidence.state = "failed";
    evidence.error = (error instanceof Error ? error.stack ?? error.message : String(error)).slice(0, 700);
    return null;
  }
}
