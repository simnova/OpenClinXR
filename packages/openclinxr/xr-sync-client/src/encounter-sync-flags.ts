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
