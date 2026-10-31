/**
 * C10 faculty replay probe helpers: RED-identical replay observation plus the
 * one-intent replay script.
 *
 * Split out of sync-probe.ts for the file-size gate. The observer mirrors the
 * C10 RED's observe() exactly (turns with recorded ids, ends via speaking
 * true->false + lastTurnEnd, emotions from the neutral baseline, phases on
 * change), plus the replay envelope (mode/stationId/replayDone) and the first
 * snapshot / last change timestamps the harness uses for the duration check.
 * Every export derives from SERVER state only; no page-local timing enters.
 */
import type { IntentKind } from "@openclinxr/xr-sync-client/headset";

/** One replayed turn, as the RED observes it. */
export interface C10ReplayTurn {
  turnId: number;
  actorId: string;
  replyId: string;
  cueId: string;
}

/** C10 replay evidence recorded from server snapshots. */
export interface C10ReplayEvidence {
  turns: C10ReplayTurn[];
  ends: string[];
  emotions: string[];
  phases: string[];
  mode: string;
  stationId: string;
  replayDone: boolean;
  lastTurnEnd: string;
  /** C11 replayed patient-note state (noteStatus/noteChars from the recorded note-submitted). */
  noteStatus: string;
  noteChars: number;
  /** performance.now() ms of the first snapshot received. */
  firstSnapshotAtMs: number | null;
  /** performance.now() ms of the last snapshot that changed replay state. */
  lastChangeAtMs: number | null;
}

/** Minimal probe surface the C10 observer fills. */
export interface C10ProbeEvidence {
  c10: C10ReplayEvidence | null;
}

/** Minimal server snapshot surface the C10 observer reads. */
export interface C10ReplayView {
  phase?: unknown;
  turnId?: unknown;
  mode?: unknown;
  stationId?: unknown;
  replayDone?: unknown;
  lastTurnEnd?: unknown;
  noteStatus?: unknown;
  noteChars?: unknown;
  actors?: Record<string, { id: string; speaking: boolean; emotion: string; replyId: string; cueId: string } | undefined>;
}

/** Signature over the replay-relevant snapshot fields (change detection). */
function replaySignature(view: C10ReplayView): string {
  const actors = Object.values(view.actors ?? {}).map((actor) =>
    actor ? [actor.id, actor.speaking, actor.emotion, actor.replyId, actor.cueId].join("/") : "?",
  );
  return JSON.stringify([view.mode, view.stationId, view.phase, view.turnId, view.lastTurnEnd, view.replayDone, ...actors]);
}

/**
 * Create the per-snapshot replay tracker. Recording matches the C10 RED's
 * observe() exactly; the envelope and change timestamps are harness extras.
 */
export function createC10ReplayObserver(probe: C10ProbeEvidence): (snapshot: unknown) => void {
  const seen: C10ReplayEvidence = {
    turns: [],
    ends: [],
    emotions: [],
    phases: [],
    mode: "",
    stationId: "",
    replayDone: false,
    lastTurnEnd: "",
    noteStatus: "none",
    noteChars: 0,
    firstSnapshotAtMs: null,
    lastChangeAtMs: null,
  };
  probe.c10 = seen;
  const wasSpeaking = new Map<string, boolean>();
  let lastSignature: string | null = null;
  return (snapshot: unknown): void => {
    const s = snapshot as C10ReplayView;
    const nowMs = Number(performance.now().toFixed(2));
    if (seen.firstSnapshotAtMs === null) {
      seen.firstSnapshotAtMs = nowMs;
    }
    const signature = replaySignature(s);
    if (signature !== lastSignature) {
      seen.lastChangeAtMs = nowMs;
      lastSignature = signature;
    }
    if (typeof s.mode === "string") {
      seen.mode = s.mode;
    }
    if (typeof s.stationId === "string") {
      seen.stationId = s.stationId;
    }
    if (typeof s.replayDone === "boolean") {
      seen.replayDone = s.replayDone;
    }
    if (typeof s.lastTurnEnd === "string") {
      seen.lastTurnEnd = s.lastTurnEnd;
    }
    if (typeof s.noteStatus === "string") {
      seen.noteStatus = s.noteStatus;
    }
    if (typeof s.noteChars === "number") {
      seen.noteChars = s.noteChars;
    }
    if (typeof s.phase === "string" && s.phase !== "" && seen.phases.at(-1) !== s.phase) {
      seen.phases.push(s.phase);
    }
    const turnId = typeof s.turnId === "number" ? s.turnId : 0;
    for (const actor of Object.values(s.actors ?? {})) {
      if (!actor) {
        continue;
      }
      // A turn end is observed as speaking true -> false; lastTurnEnd names how it ended.
      if (wasSpeaking.get(actor.id) === true && !actor.speaking) {
        seen.ends.push(seen.lastTurnEnd);
      }
      wasSpeaking.set(actor.id, actor.speaking);
    }
    for (const actor of Object.values(s.actors ?? {})) {
      if (!actor) {
        continue;
      }
      if (actor.speaking && !seen.turns.some((t) => t.turnId === turnId)) {
        seen.turns.push({ turnId, actorId: actor.id, replyId: actor.replyId, cueId: actor.cueId });
      }
      if (actor.emotion && actor.emotion !== (seen.emotions.at(-1) ?? "neutral")) {
        seen.emotions.push(actor.emotion);
      }
    }
  };
}

export interface C10ScriptDeps {
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  sendIntentAndSettle(kind: IntentKind, payload: Record<string, unknown>): Promise<void>;
  getSnapshot(): unknown;
}

/**
 * C10 faculty replay script: the page sends exactly one intent (select-actor,
 * which must reject replay-read-only) and otherwise only watches the recorded
 * station play into state with the existing C4 renderers. Finishes when the
 * server reports replayDone. Pose streaming is disabled by the caller.
 */
export async function runC10Script(deps: C10ScriptDeps): Promise<void> {
  const { waitFor, sendIntentAndSettle, getSnapshot } = deps;
  const snapshot = (): { replayDone?: unknown } => (getSnapshot() as { replayDone?: unknown } | null) ?? {};
  await sendIntentAndSettle("select-actor", { actorId: "a1" });
  await waitFor(() => snapshot().replayDone === true, 120000, "replay done");
}
