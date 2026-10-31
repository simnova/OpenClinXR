/**
 * C11 patient-note probe helpers: the one-station note script plus the server
 * note-state tracker.
 *
 * Split out of sync-probe.ts for the file-size gate. The script runs the
 * shared C3 turn script verbatim (never forked) once through the encounter,
 * then drives the patient-note path: one note-submit before the note phase
 * (rejected outside-note-phase), one over-limit submit in the note phase
 * (rejected note-too-long), then two accepted submits (last wins). Every
 * export derives from SERVER state only; the note length bound comes from the
 * ?noteMaxChars= page parameter the harness sets from its server config.
 * The tracker also renders noteStatus/noteChars from server state into the
 * visible #sync-probe-note label.
 */
import type { IntentKind } from "@openclinxr/xr-sync-client/headset";
import { observedTurnFrom, runC3TurnScript } from "./probe-c6.js";

/** C11 accepted note texts (fixed harness-known strings; lengths are the evidence). */
export const C11_NOTE_A = "c11 note one: HPI chest pain, onset today, no radiation.";
export const C11_NOTE_B = "c11 note two: HPI chest pain, PE clear lungs, plan ECG.";

/** C11 patient-note evidence recorded from server snapshots + sent texts. */
export interface C11NoteEvidence {
  /** Accepted-submit texts, in send order ([NOTE_A, NOTE_B]). */
  noteTexts: string[];
  /** Rejected over-limit submit length (noteMaxChars + 1). */
  overLimitLength: number;
  /** Pre-note-phase submit length (rejected outside-note-phase). */
  preNoteLength: number;
  /** noteStatus the page saw during the encounter (before any accept). */
  noteStatusDuringEncounter: string;
  /** noteChars the page saw during the encounter (before any accept). */
  noteCharsDuringEncounter: number;
  /** noteStatus the page saw after the first accepted submit. */
  noteStatusAfterFirstAccept: string;
}

/** Empty C11 evidence (the script fills it; the harness reads it). */
export function createC11NoteEvidence(): C11NoteEvidence {
  return {
    noteTexts: [],
    overLimitLength: 0,
    preNoteLength: 0,
    noteStatusDuringEncounter: "",
    noteCharsDuringEncounter: -1,
    noteStatusAfterFirstAccept: "",
  };
}

/** Minimal server snapshot surface the C11 tracker/script reads. */
export interface C11NoteView {
  phase?: unknown;
  noteStatus?: unknown;
  noteChars?: unknown;
}

function noteOf(state: C11NoteView | null | undefined): { status: string; chars: number } {
  return {
    status: typeof state?.noteStatus === "string" ? state.noteStatus : "",
    chars: typeof state?.noteChars === "number" ? state.noteChars : -1,
  };
}

/**
 * Create the per-snapshot note tracker. Renders noteStatus/noteChars from
 * SERVER state into the visible label (the script records the evidence).
 */
export function createC11NoteTracker(): (snapshot: unknown) => void {
  return (snapshot: unknown): void => {
    const note = noteOf(snapshot as C11NoteView);
    const label = document.querySelector("#sync-probe-note");
    if (label) {
      label.textContent = `note: ${note.status === "" ? "none" : note.status} @ ${note.chars < 0 ? 0 : note.chars}`;
    }
  };
}

export interface C11ScriptDeps {
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  sendIntentAndSettle(kind: IntentKind, payload: Record<string, unknown>): Promise<void>;
  getSnapshot(): unknown;
  setStatus(text: string): void;
  noteMaxChars: number;
  note: C11NoteEvidence;
}

/**
 * C11 note script: select a1, the shared C3 turn script, one pre-note
 * note-submit (rejected), then in the note phase one over-limit submit
 * (rejected) and two accepted submits (last wins). Finishes when the server
 * reports the note phase closed.
 */
export async function runC11Script(deps: C11ScriptDeps): Promise<void> {
  const { waitFor, sendIntentAndSettle, getSnapshot, setStatus, noteMaxChars, note } = deps;
  const snapshot = (): C11NoteView => (getSnapshot() as C11NoteView | null) ?? {};
  const phase = (): string => (typeof snapshot().phase === "string" ? (snapshot().phase as string) : "");
  const observedTurn = (): { turnId: number; owner: string; a1Speaking: boolean } =>
    observedTurnFrom(snapshot() as Parameters<typeof observedTurnFrom>[0]);

  await waitFor(() => phase() === "encounter", 30000, "c11 encounter phase");
  setStatus("sync-probe c11 encounter turn script");
  await sendIntentAndSettle("select-actor", { actorId: "a1" });
  // One note-submit before the note phase: the server rejects outside-note-phase.
  const preNote = "c11 pre-note probe";
  note.preNoteLength = preNote.length;
  await sendIntentAndSettle("note-submit", { text: preNote });
  await runC3TurnScript({ sendIntentAndSettle, observedTurn, waitFor });
  // The page saw noteStatus none during the encounter (before any accept).
  note.noteStatusDuringEncounter = noteOf(snapshot()).status;
  note.noteCharsDuringEncounter = noteOf(snapshot()).chars;

  await waitFor(() => phase() === "note", 60000, "c11 note phase");
  setStatus("sync-probe c11 note submits");
  const overLimit = "x".repeat(noteMaxChars + 1);
  note.overLimitLength = overLimit.length;
  await sendIntentAndSettle("note-submit", { text: overLimit });
  await sendIntentAndSettle("note-submit", { text: C11_NOTE_A });
  await waitFor(() => noteOf(snapshot()).chars === C11_NOTE_A.length, 15000, "c11 first noteChars");
  note.noteStatusAfterFirstAccept = noteOf(snapshot()).status;
  note.noteTexts.push(C11_NOTE_A);
  await sendIntentAndSettle("note-submit", { text: C11_NOTE_B });
  await waitFor(() => noteOf(snapshot()).chars === C11_NOTE_B.length, 15000, "c11 second noteChars");
  note.noteTexts.push(C11_NOTE_B);

  await waitFor(() => phase() === "closed", 60000, "c11 closed phase");
}
