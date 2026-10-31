/** C22 cast-station topic menu renderer and learner history-topic script. */
import * as THREE from "three";
import type { IntentKind } from "@openclinxr/xr-sync-client/headset";

export interface C22AskedTopic {
  actorId: string;
  topicTag: string;
  acked: boolean;
}

export interface C22StationEvidence {
  stationId: string;
  menu: string[];
  askedTopics: C22AskedTopic[];
  rejectReason: string;
}

export interface C22Evidence {
  stations: C22StationEvidence[];
  renderedTiles: Array<{ stationId: string; topicTag: string }>;
}

export function createC22Evidence(): C22Evidence {
  return { stations: [], renderedTiles: [] };
}

declare global {
  interface Window {
    __syncProbeC22?: C22Evidence;
  }
}

interface C22View {
  stationId?: unknown;
  stationIndex?: unknown;
  stationCount?: unknown;
  phase?: unknown;
  topicMenu?: unknown;
  actors?: Record<string, unknown>;
}

export interface C22ScriptDeps {
  scene: THREE.Scene;
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  sendIntentAndSettle(kind: IntentKind, payload: Record<string, unknown>): Promise<void>;
  getSnapshot(): unknown;
  setStatus(text: string): void;
  setPoseStreaming(enabled: boolean): void;
  counts(): { acks: number; rejects: number; rejectDetails: Array<{ seq: number; reason: string }> };
  evidence: C22Evidence;
  publish(): void;
}

function menuOf(view: C22View): string[] {
  return Array.isArray(view.topicMenu) ? view.topicMenu.filter((tag): tag is string => typeof tag === "string") : [];
}

function renderTopicTiles(scene: THREE.Scene, evidence: C22Evidence, stationId: string, menu: string[]): void {
  for (const child of [...scene.children]) {
    if (child.name.startsWith("sync-probe.topic.")) scene.remove(child);
  }
  evidence.renderedTiles = evidence.renderedTiles.filter((entry) => entry.stationId !== stationId);
  menu.forEach((topicTag, index) => {
    const tile = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.14, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x4a9c7d, roughness: 0.7 }),
    );
    tile.position.set(-1.2 + (index % 5) * 0.6, 0.35 + Math.floor(index / 5) * 0.22, -1.6);
    tile.name = `sync-probe.topic.${index}`;
    tile.userData["topicTag"] = topicTag;
    scene.add(tile);
    evidence.renderedTiles.push({ stationId, topicTag });
  });
  const panel = document.querySelector("#sync-probe-topics");
  if (panel) panel.textContent = `topics ${stationId}: ${menu.join(" | ")}`;
}

/** Ask the first two scenario topics through two cast actors, then reject one unknown topic, per station. */
export async function runC22Script(deps: C22ScriptDeps): Promise<void> {
  deps.setPoseStreaming(false);
  const view = (): C22View => deps.getSnapshot() as C22View;
  await deps.waitFor(() => typeof view().stationCount === "number" && (view().stationCount as number) > 0, 30000, "c22 stations");
  const count = view().stationCount as number;
  for (let index = 0; index < count; index += 1) {
    await deps.waitFor(() => view().stationIndex === index && view().phase === "encounter" && menuOf(view()).length >= 2, 30000, `c22 station ${index} menu`);
    const snapshot = view();
    const stationId = typeof snapshot.stationId === "string" ? snapshot.stationId : "";
    const menu = menuOf(snapshot);
    const actors = Object.keys(snapshot.actors ?? {}).sort();
    if (actors.length < 2) throw new Error(`c22 ${stationId} needs two cast actors`);
    const station: C22StationEvidence = { stationId, menu, askedTopics: [], rejectReason: "" };
    deps.evidence.stations.push(station);
    renderTopicTiles(deps.scene, deps.evidence, stationId, menu);
    deps.publish();
    for (let topicIndex = 0; topicIndex < 2; topicIndex += 1) {
      const actorId = actors[topicIndex] as string;
      const topicTag = menu[topicIndex] as string;
      await deps.sendIntentAndSettle("select-actor", { actorId });
      await deps.sendIntentAndSettle("utterance-start", {});
      const before = deps.counts().acks;
      await deps.sendIntentAndSettle("utterance-end", { topicTag });
      station.askedTopics.push({ actorId, topicTag, acked: deps.counts().acks === before + 1 });
      deps.publish();
    }
    await deps.sendIntentAndSettle("select-actor", { actorId: actors[0] as string });
    await deps.sendIntentAndSettle("utterance-start", {});
    const beforeRejects = deps.counts().rejects;
    await deps.sendIntentAndSettle("utterance-end", { topicTag: "c22_unknown_topic" });
    if (deps.counts().rejects !== beforeRejects + 1) throw new Error(`c22 ${stationId} unknown topic was not rejected`);
    station.rejectReason = deps.counts().rejectDetails.at(-1)?.reason ?? "";
    deps.setStatus(`sync-probe c22 ${stationId} asked ${station.askedTopics.map((entry) => entry.topicTag).join(", ")}`);
    deps.publish();
    if (index < count - 1) {
      await deps.waitFor(() => view().stationIndex === index + 1, 60000, `c22 rotation ${index + 1}`);
    } else {
      await deps.waitFor(() => view().phase === "closed", 60000, "c22 final closed");
    }
  }
}

/** Dispatcher adapter kept here so probe-script.ts remains at its established ceiling. */
export async function runC22Probe(deps: {
  scene: THREE.Scene;
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  sendIntentAndSettle(kind: IntentKind, payload: Record<string, unknown>): Promise<void>;
  getSnapshot(): unknown;
  setStatus(text: string): void;
  setPoseStreaming(enabled: boolean): void;
  intentCounts(): { sent: number; acks: number; rejects: number; rejectDetails: Array<{ seq: number; reason: string }> };
}): Promise<void> {
  const evidence = createC22Evidence();
  const publish = (): void => {
    window.__syncProbeC22 = evidence;
    if (window.__syncProbe !== undefined) Object.assign(window.__syncProbe, { c22: evidence });
  };
  publish();
  await runC22Script({
    scene: deps.scene,
    waitFor: deps.waitFor,
    sendIntentAndSettle: deps.sendIntentAndSettle,
    getSnapshot: deps.getSnapshot,
    setStatus: deps.setStatus,
    setPoseStreaming: deps.setPoseStreaming,
    counts: () => deps.intentCounts(),
    evidence,
    publish,
  });
}
