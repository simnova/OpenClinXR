import type { EncounterSnapshot } from "./index.js";
import type { UtteranceBoxDeps, UtteranceBoxElement } from "./encounter-turns.js";

function topicLabel(tag: string): string {
  return tag.replaceAll("_", " ");
}

export interface RoomPanel {
  render(snapshot: EncounterSnapshot): void;
  refuse(reason: string): void;
}

export function mountRoomPanel(box: UtteranceBoxDeps): RoomPanel {
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
  panel.appendChild(cast);
  panel.appendChild(topics);
  panel.appendChild(countdown);
  panel.appendChild(refusal);
  box.parent.appendChild(panel);
  let phase: string = "";
  let remaining: number = 0;
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
    topics.textContent =
      menu.length === 0 ? "" : "Ask about: " + menu.map((tag) => topicLabel(tag)).join(", ");
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
  };
  const refuse = (reason: string): void => {
    if (reason === "outside-encounter-phase" && phase === "doorway") {
      refusal.textContent = `Not open yet: the encounter opens in ${remaining} s.`;
    } else if (reason === "outside-encounter-phase" && phase !== "" && phase !== "doorway") {
      refusal.textContent = `Not accepted: the station is in the ${phase} phase.`;
    } else {
      refusal.textContent = `Not accepted: ${reason}`;
    }
  };
  return { render, refuse };
}
