/** C21 extension of the C20 replay/scoring flow: visible observed/required counts. */
import type { C13RubricItem } from "./probe-c13.js";
import { type C20Evidence, type C20ScriptDeps, createC20Evidence, runC20Script } from "./probe-c20.js";
export { runC22Probe } from "./probe-c22.js";

export interface C21CoverageItem {
  id: string;
  observedCount: number;
  requiredCount: number;
}

export interface C21StationCoverage {
  stationId: string;
  rubricIds: string[];
  replayRubricCoverage: C21CoverageItem[];
  renderedCoverageLabels: string[];
  scoreAcked: boolean;
}

export interface C21Evidence extends C20Evidence {
  coverageStations: C21StationCoverage[];
}

export function createC21Evidence(): C21Evidence {
  return { ...createC20Evidence(), coverageStations: [] };
}

function coverageOf(snapshot: unknown): C21CoverageItem[] {
  const rows = (snapshot as { replayRubricCoverage?: unknown } | null)?.replayRubricCoverage;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((raw) => {
    const row = raw as Record<string, unknown>;
    return typeof row["id"] === "string" && typeof row["observedCount"] === "number" && typeof row["requiredCount"] === "number"
      ? [{ id: row["id"] as string, observedCount: row["observedCount"] as number, requiredCount: row["requiredCount"] as number }]
      : [];
  });
}

/** Render the C20 label plus a visible "observed/required" value per item. */
function renderCoveragePanel(evidence: C21Evidence, stationId: string, rubric: C13RubricItem[], toggled: string[]): string[] {
  const station = evidence.coverageStations.find((entry) => entry.stationId === stationId);
  const byId = new Map((station?.replayRubricCoverage ?? []).map((entry) => [entry.id, entry]));
  const labels = rubric.map((item) => {
    const coverage = byId.get(item.id);
    return `${coverage?.observedCount ?? 0}/${coverage?.requiredCount ?? 0}`;
  });
  if (station) station.renderedCoverageLabels = labels;
  const panel = document.querySelector("#sync-probe-c20");
  if (panel) {
    panel.textContent = `checklist ${stationId}: ${rubric.map((item, index) => `${item.label} ${labels[index]}:${toggled.includes(item.id) ? "on" : "off"}`).join(" | ")}`;
  }
  return rubric.map((item) => item.id);
}

declare global {
  interface Window {
    __syncProbeC21?: C21Evidence;
  }
}

export async function runC21Script(deps: Omit<C20ScriptDeps, "evidence" | "renderPanel" | "onReplayRubric"> & { evidence: C21Evidence }): Promise<void> {
  const evidence = deps.evidence;
  await runC20Script({
    ...deps,
    evidence,
    onReplayRubric: (stationId, rubric, snapshot) => {
      evidence.coverageStations.push({
        stationId,
        rubricIds: rubric.map((item) => item.id),
        replayRubricCoverage: coverageOf(snapshot),
        renderedCoverageLabels: [],
        scoreAcked: false,
      });
    },
    renderPanel: (stationId, rubric, toggled) => renderCoveragePanel(evidence, stationId, rubric, toggled),
  });
  for (const station of evidence.coverageStations) {
    station.scoreAcked = evidence.stations.find((entry) => entry.stationId === station.stationId)?.scoreAcked === true;
  }
}
