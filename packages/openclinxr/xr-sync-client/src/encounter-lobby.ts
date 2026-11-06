import type { EncounterSnapshot } from "./index.js";
import type { UtteranceBoxDeps } from "./encounter-turns.js";

export interface LobbyStationEvidence {
  stationId: string;
  available: boolean;
  reason: string;
}

export interface LobbySelectionEvidence {
  stationId: string;
  status: string;
  reason: string;
}

export interface LobbyEvidence {
  stations: LobbyStationEvidence[];
  selections: LobbySelectionEvidence[];
  returns: Array<{ status: string; reason: string }>;
}

interface LobbyRow {
  stationId: string;
  turnCount?: number;
  available?: boolean;
  unavailableReason?: string;
}

/** C32 review-lobby station picker: one button per lobby station in the utteranceBox mount. */
export function createLobbyPicker(deps: {
  box: UtteranceBoxDeps;
  select(stationId: string): Promise<{ status: string; reason?: string }>;
  returnToLobby(): Promise<{ status: string; reason?: string }>;
}): { render(snapshot: EncounterSnapshot): void; evidence: LobbyEvidence } {
  const evidence: LobbyEvidence = { stations: [], selections: [], returns: [] };
  const container = deps.box.doc.createElement("div");
  container.id = "review-lobby";
  deps.box.parent.appendChild(container);
  const back = deps.box.doc.createElement("button");
  back.id = "return-to-lobby";
  back.textContent = "Back to review lobby";
  back.hidden = true;
  deps.box.parent.appendChild(back);
  let returning = false;
  back.addEventListener("click", () => {
    if (returning) return;
    returning = true;
    void (async () => {
      try {
        const result = await deps.returnToLobby();
        evidence.returns.push({ status: result.status, reason: result.reason ?? "" });
      } catch (error) {
        evidence.returns.push({ status: "error", reason: error instanceof Error ? error.message : String(error) });
      } finally {
        returning = false;
      }
    })();
  });

  const render = (snapshot: EncounterSnapshot): void => {
    if (snapshot.mode !== "lobby") {
      container.textContent = "";
      evidence.stations.length = 0;
      back.hidden = !(snapshot.mode === "replay" && snapshot.replayDone === true);
      return;
    }
    container.textContent = "";
    evidence.stations.length = 0;
    const rows = (snapshot.lobbyStations ?? []) as LobbyRow[];
    for (const row of rows) {
      const available = row.available !== false;
      const reason = row.unavailableReason ?? "";
      evidence.stations.push({ stationId: row.stationId, available, reason });
    }
    for (const entry of evidence.stations) {
      const rowDiv = deps.box.doc.createElement("div");
      rowDiv.id = `lobby-row-${entry.stationId}`;
      const button = deps.box.doc.createElement("button");
      button.id = `lobby-station-${entry.stationId}`;
      const source = rows.find((row) => row.stationId === entry.stationId);
      const turnCount = typeof source?.turnCount === "number" ? source.turnCount : 0;
      button.textContent = `${entry.stationId} (${turnCount} turns)`;
      button.disabled = !entry.available;
      const reasonDiv = deps.box.doc.createElement("div");
      reasonDiv.id = `lobby-reason-${entry.stationId}`;
      reasonDiv.textContent = entry.available ? "" : entry.reason;
      const stationId = entry.stationId;
      const stationAvailable = entry.available;
      button.addEventListener("click", () => {
        if (!stationAvailable) return;
        void (async () => {
          try {
            const result = await deps.select(stationId);
            evidence.selections.push({ stationId, status: result.status, reason: result.reason ?? "" });
          } catch (error) {
            evidence.selections.push({
              stationId,
              status: "error",
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        })();
      });
      rowDiv.appendChild(button);
      rowDiv.appendChild(reasonDiv);
      container.appendChild(rowDiv);
    }
    back.hidden = true;
  };

  return { render, evidence };
}
