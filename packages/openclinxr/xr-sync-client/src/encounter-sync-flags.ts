import type { EncounterSnapshot } from "./index.js";

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

/** C53: fires onBreak with phaseRemainingS on entering phase break and whenever it changes there, and once with null when a later snapshot reports another phase. */
export function createBreakAnnouncer(onBreak: (remainingS: number | null) => void): (snapshot: EncounterSnapshot) => void {
  let inBreak = false;
  let last = -1;
  return (snapshot) => {
    if (snapshot.phase === "break") {
      const remaining = snapshot.phaseRemainingS ?? 0;
      if (!inBreak || remaining !== last) {
        inBreak = true;
        last = remaining;
        onBreak(remaining);
      }
      return;
    }
    if (inBreak) {
      inBreak = false;
      last = -1;
      onBreak(null);
    }
  };
}

const PANEL_PHASES: ReadonlySet<string> = new Set(["doorway", "encounter", "note", "break", "closed"]);

/** C55': fires onPhase with (phase, phaseRemainingS ?? 0) on the first snapshot and whenever either changes; only for the station phases doorway, encounter, note, break, closed. */
export function createPhaseAnnouncer(onPhase: (phase: string, remainingS: number) => void): (snapshot: EncounterSnapshot) => void {
  let last = "";
  return (snapshot) => {
    if (!PANEL_PHASES.has(snapshot.phase)) return;
    const remaining = snapshot.phaseRemainingS ?? 0;
    const key = snapshot.phase + "/" + remaining;
    if (key === last) return;
    last = key;
    onPhase(snapshot.phase, remaining);
  };
}

/** C50: fires onStation on the first station position and whenever (index, count) changes. */
export function createStationAnnouncer(onStation: (index: number, count: number) => void): (snapshot: EncounterSnapshot) => void {
  let last = "";
  return (snapshot) => {
    const index = snapshot.stationIndex;
    const count = snapshot.stationCount;
    if (index === undefined || count === undefined || count <= 0) return;
    const key = index + "/" + count;
    if (key === last) return;
    last = key;
    onStation(index, count);
  };
}

/** B'': fires onTopicMenu with the snapshot's topicMenu on the first snapshot carrying one and whenever the asked set changes; never for snapshots without a menu. */
export function createTopicMenuAnnouncer(onTopicMenu: (menu: NonNullable<EncounterSnapshot["topicMenu"]>) => void): (snapshot: EncounterSnapshot) => void {
  let last = "";
  let fired = false;
  return (snapshot) => {
    const menu = snapshot.topicMenu;
    if (menu === undefined) return;
    const key = menu.map((m) => `${m.tag}:${m.asked ? "1" : "0"}`).join(",");
    if (fired && key === last) return;
    fired = true;
    last = key;
    onTopicMenu(menu);
  };
}

/** A': writes the capitalised server phase into the doorway eyebrow; an empty or missing phase writes nothing and returns "". */
export function writeSyncedDoorwayEyebrow(el: { textContent: string | null }, phase: string | undefined): string {
  if (!phase) return "";
  const name = phase.charAt(0).toUpperCase() + phase.slice(1);
  el.textContent = name;
  return name;
}

/** B': writes "Topics N/M" from the current station snapshot's topicMenu (M = entries, N = asked); a missing menu writes nothing and returns "". */
export function formatSyncedTopicsLabel(el: { textContent: string | null }, menu: EncounterSnapshot["topicMenu"]): string {
  if (menu === undefined || menu === null) return "";
  const total = menu.length;
  let asked = 0;
  for (const m of menu) if (m.asked) asked += 1;
  const label = `Topics ${asked}/${total}`;
  el.textContent = label;
  return label;
}
