import type { EncounterSnapshot } from "./index.js";
import type { UtteranceBoxDeps, UtteranceBoxElement } from "./encounter-turns.js";

export interface RoomPanel {
  render(snapshot: EncounterSnapshot): void;
  refuse(reason: string, kind?: string): void;
}

export function mountRoomPanel(box: UtteranceBoxDeps, onTopic: (tag: string) => void, note?: { text(): string; submit(text: string): Promise<{ status: string; reason?: string }> }): RoomPanel {
  const panel: UtteranceBoxElement = box.doc.createElement("div");
  panel.id = "room-panel";
  const cast: UtteranceBoxElement = box.doc.createElement("div");
  cast.id = "room-cast";
  cast.textContent = "";
  const topics: UtteranceBoxElement = box.doc.createElement("div");
  topics.id = "room-topics";
  topics.textContent = "";
  const countdown: UtteranceBoxElement = box.doc.createElement("div");
  countdown.id = "room-countdown";
  countdown.textContent = "";
  const refusal: UtteranceBoxElement = box.doc.createElement("div");
  refusal.id = "room-refusal";
  refusal.textContent = "";
  let phase: string = "";
  let remaining: number = 0;
  let noteButton: UtteranceBoxElement | undefined;
  let noteStatus: UtteranceBoxElement | undefined;
  let refusalFromNote = false;
  let submitSeq = 0;
  let settledSeq = 0;
  let noteBoxElement: UtteranceBoxElement | undefined;
  if (note !== undefined) {
    const noteBox: UtteranceBoxElement = box.doc.createElement("div");
    noteBox.id = "room-note";
    noteBox.textContent = "";
    const submitButton: UtteranceBoxElement = box.doc.createElement("button");
    submitButton.id = "room-note-submit";
    submitButton.type = "button";
    submitButton.textContent = "Submit note";
    submitButton.hidden = true;
    submitButton.disabled = true;
    submitButton.addEventListener("click", () => {
      if (phase !== "note") return;
      // Each click carries an id; a result older than one already applied is dropped, so out-of-order replies leave the newest submit's outcome.
      const id = ++submitSeq;
      void note.submit(note.text()).then((result) => {
        if (id < settledSeq) return;
        settledSeq = id;
        if (result.status === "ack") {
          if (refusalFromNote) { refusal.textContent = ""; refusalFromNote = false; }
        } else if (result.reason !== undefined) {
          showRefusal(result.reason, "note-submit");
        }
      }).catch(() => undefined);
    });
    const status: UtteranceBoxElement = box.doc.createElement("div");
    status.id = "room-note-status";
    status.textContent = "";
    noteBox.appendChild(submitButton);
    noteBox.appendChild(status);
    noteButton = submitButton;
    noteStatus = status;
    noteBoxElement = noteBox;
  }
  panel.appendChild(cast);
  panel.appendChild(topics);
  panel.appendChild(countdown);
  if (noteBoxElement !== undefined) panel.appendChild(noteBoxElement);
  panel.appendChild(refusal);
  box.parent.appendChild(panel);
  const buttons = new Map<string, UtteranceBoxElement>();
  let lastOrder: string[] = [];
  const render = (snapshot: EncounterSnapshot): void => {
    phase = snapshot.phase;
    remaining = snapshot.phaseRemainingS ?? 0;
    const entries = Object.values(snapshot.actors ?? {}).filter(
      (actor) => actor.displayName !== "" && actor.displayName !== undefined,
    );
    cast.textContent =
      entries.length === 0
        ? ""
        : "Cast: " +
          entries.map((actor) => `${actor.displayName} (${actor.role ?? ""})`).join("; ");
    const menu = snapshot.topicMenu ?? [];
    const order = menu.map((entry) => entry.tag);
    if (order.length !== lastOrder.length || order.some((tag, index) => tag !== lastOrder[index])) {
      topics.textContent = "";
      buttons.clear();
      for (const entry of menu) {
        const button: UtteranceBoxElement = box.doc.createElement("button");
        button.id = "topic-" + entry.tag;
        button.type = "button";
        button.addEventListener("click", () => onTopic(entry.tag));
        topics.appendChild(button);
        buttons.set(entry.tag, button);
      }
      lastOrder = order;
    }
    for (const entry of menu) {
      const button = buttons.get(entry.tag);
      if (button === undefined) continue;
      const display = entry.labelSource === "tag" ? entry.tag.replaceAll("_", " ") : entry.label;
      button.textContent = (entry.asked ? "✓ " : "") + display;
      button.setAttribute?.("data-asked", String(entry.asked));
      if (button.style !== undefined) button.style.background = entry.asked ? "#2e7d32" : "";
    }
    if (phase === "doorway") {
      countdown.textContent = `Encounter opens in ${remaining} s`;
    } else if (phase === "encounter") {
      countdown.textContent = `Encounter: ${remaining} s left`;
    } else if (phase === "note") {
      countdown.textContent = `Note: ${remaining} s left`;
    } else if (phase === "closed") {
      countdown.textContent = "Station closed";
    } else {
      countdown.textContent = "";
    }
    if (phase === "encounter") {
      refusal.textContent = "";
    }
    if (noteButton !== undefined && noteStatus !== undefined) {
      const inWindow = phase === "note";
      noteButton.hidden = !inWindow;
      noteButton.disabled = !inWindow;
      noteStatus.textContent = snapshot.noteStatus === "submitted" ? `Note accepted, ${snapshot.noteChars ?? 0} characters` : "";
    }
  };
  const showRefusal = (reason: string, kind?: string): void => {
    refusalFromNote = kind === "note-submit";
    if (reason === "outside-encounter-phase" && phase === "doorway") {
      refusal.textContent = `Not open yet: the encounter opens in ${remaining} s.`;
    } else if (reason === "outside-encounter-phase" && phase !== "" && phase !== "doorway") {
      refusal.textContent = `Not accepted: the station is in the ${phase} phase.`;
    } else {
      refusal.textContent = `Not accepted: ${reason}`;
    }
  };
  // A note-submit reject is shown by the submit's own result (ordered by click id), not by the shared refusal hook.
  const refuse = (reason: string, kind?: string): void => { if (kind !== "note-submit") showRefusal(reason, kind); };
  return { render, refuse };
}
