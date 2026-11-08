/**
 * C45 server-side patient-note holder: the explicit note-submit (C11) and the
 * latest valid note-draft, with the draft promotion at note -> closed.
 *
 * A learner may send "note-draft" { text } intents during the note phase. The
 * server holds only the latest valid draft text (never synced, never traced)
 * and promotes it at note -> closed when no explicit note-submit was accepted.
 * An invalid draft clears the held one (the latest draft decides).
 */
import type { ConversationTracer } from "./conversation-tracer.js";
import {
  DRAFT_RATE_LIMITED_REASON,
  NOTE_DRAFT_MIN_INTERVAL_MS,
  OUTSIDE_NOTE_PHASE_REASON,
  validateNoteDraft,
  validateNoteSubmit,
} from "./patient-note.js";

/** The synced-state fields the note application writes. */
interface NoteStateBinding {
  phase: string;
  noteStatus: string;
  noteChars: number;
  noteSource: string;
}

export class NoteStation {
  /** Held learner note text (explicit or promoted draft); server-side only. */
  text: string | null = null;
  private draft: string | null = null;
  private explicitAccepted = false;
  private promoted = false;
  private lastDraftAtMs = new Map<string, number>();

  /** Apply one note-submit or note-draft intent; returns true or the reject reason. */
  apply(
    kind: string,
    state: NoteStateBinding,
    tracer: ConversationTracer,
    sessionId: string,
    seq: number,
    payload: unknown,
    noteMaxChars: number,
    nowMs: number,
  ): true | { reason: string } {
    if (kind === "note-draft") {
      return this.offerDraft(sessionId, state.phase, noteMaxChars, payload, nowMs);
    }
    const validated = validateNoteSubmit(state.phase, noteMaxChars, payload);
    if (typeof validated !== "string") {
      return validated;
    }
    this.text = validated;
    this.explicitAccepted = true;
    this.draft = null;
    state.noteStatus = "submitted";
    state.noteChars = validated.length;
    state.noteSource = "explicit";
    tracer.push({ seq, kind: "note-submitted", actorId: "", turnId: null, chars: validated.length, source: "explicit" });
    return true;
  }

  private offerDraft(sessionId: string, phase: string, noteMaxChars: number, payload: unknown, nowMs: number): true | { reason: string } {
    if (phase !== "note") {
      return { reason: OUTSIDE_NOTE_PHASE_REASON };
    }
    const last = this.lastDraftAtMs.get(sessionId);
    if (last !== undefined && nowMs - last < NOTE_DRAFT_MIN_INTERVAL_MS) {
      return { reason: DRAFT_RATE_LIMITED_REASON };
    }
    const validated = validateNoteDraft(phase, noteMaxChars, payload);
    if (typeof validated !== "string") {
      this.draft = null;
      return validated;
    }
    if (!this.explicitAccepted) {
      this.draft = validated;
    }
    this.lastDraftAtMs.set(sessionId, nowMs);
    return true;
  }

  /** At note -> closed: promote the held draft once, unless an explicit submit was accepted. */
  promote(state: NoteStateBinding, tracer: ConversationTracer): void {
    if (this.promoted || this.explicitAccepted || this.draft === null) {
      return;
    }
    this.promoted = true;
    const text = this.draft;
    this.draft = null;
    this.text = text;
    state.noteStatus = "submitted";
    state.noteChars = text.length;
    state.noteSource = "draft";
    tracer.push({ seq: null, kind: "note-submitted", actorId: "", turnId: null, chars: text.length, source: "draft" });
  }
}
