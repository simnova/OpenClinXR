/**
 * C20 scenario-rubric probe: faculty scores each replayed cast station against
 * THAT station's scenario reviewRubric.
 *
 * Split out of sync-probe.ts for the file-size gate (same ceiling rationale
 * as the C16-C19 modules: this module owns and publishes window.__syncProbeC20
 * itself, and the harness reads it off window.__syncProbe). The page joins
 * the review lobby, then scores every lobby station in server order: select
 * the tile (trigger only), watch the replay, read the station's checklist
 * from the SERVER replayRubric snapshot, render each label in order into the
 * visible panel, trigger the even-index tiles on (deterministic checked
 * pattern computed from the rubric), submit score-station from the toggled
 * set in rubric order (trigger only), and return to the lobby (trigger
 * only). Every export derives from SERVER state only, except the page-local
 * toggled set (which the harness checks against the sent items).
 */

import type { IntentKind } from "@openclinxr/xr-sync-client/headset";
import * as THREE from "three";
import type { AimPose } from "./probe-c7.js";
import { handleLobbyTrigger } from "./probe-c12.js";
import { buildC13Tiles, type C13RubricItem, c13CenterFor, setC13TileMeshes } from "./probe-c13.js";

/** One station the page scored, recorded from server snapshots + triggers. */
export interface C20StationRecord {
  /** Station id, copied from the server lobby tile the trigger hit. */
  stationId: string;
  /** Checklist the server replayRubric carried, in order (ids + labels). */
  rubric: C13RubricItem[];
  /** Checklist ids the page rendered into the visible panel, in order. */
  renderedIds: string[];
  /** Rubric ids the controller trigger toggled on (even rubric indexes). */
  toggledIds: string[];
  /** Items the page sent with score-station (rubric order, from the toggled set). */
  submittedItems: Record<string, boolean> | null;
  /** True once the score-station ack settled. */
  scoreAcked: boolean;
  /** True once the return-to-lobby ack settled. */
  returnAcked: boolean;
  /** checkedCount the lobby badge showed for this station after the return. */
  badgeCheckedCount: number | null;
}

/** C20 scenario-rubric evidence (one record per scored station, lobby order). */
export interface C20Evidence {
  stations: C20StationRecord[];
  /** Page-generated connection id, fixed at connect (rotation keeps the object). */
  connectionId: string;
}

/** Empty C20 evidence (the script fills it; the harness reads it). */
export function createC20Evidence(): C20Evidence {
  return {
    stations: [],
    connectionId: `c20-${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`,
  };
}

declare global {
  interface Window {
    __syncProbeC20?: C20Evidence;
  }
}

/** Live C20 evidence for the trigger handler (set once the script starts). */
type PanelRenderer = (stationId: string, rubric: C13RubricItem[], toggled: string[]) => string[];
let liveEvidence: { c20: C20Evidence; scoring: boolean; rubric: C13RubricItem[]; toggled: string[]; renderPanel: PanelRenderer } | null = null;

/** Point the trigger handler at the script's evidence (called once, before any trigger). */
export function setC20Live(state: { c20: C20Evidence; scoring: boolean; rubric: C13RubricItem[]; toggled: string[]; renderPanel: PanelRenderer }): void {
  liveEvidence = state;
}

/** Minimal server snapshot surface the C20 panel reads. */
export interface C20RubricView {
  mode?: unknown;
  stationId?: unknown;
  replayDone?: unknown;
  replayRubric?: unknown;
  lobbyScores?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Checklist entries read from a server replayRubric snapshot (order kept). Pure function. */
export function observedRubricOf(snapshot: unknown): C13RubricItem[] {
  if (!isRecord(snapshot) || !Array.isArray(snapshot["replayRubric"])) {
    return [];
  }
  const rubric: C13RubricItem[] = [];
  for (const entry of snapshot["replayRubric"]) {
    if (isRecord(entry) && typeof entry["id"] === "string" && typeof entry["label"] === "string") {
      rubric.push({ id: entry["id"], label: entry["label"] });
    }
  }
  return rubric;
}

/**
 * Render the visible checklist panel for one station: every label in rubric
 * order with its on/off flag, into #sync-probe-c20 (readable in the headset).
 * Returns the rendered ids (rubric order). Pure read of the rubric plus the
 * page-local toggled set, plus a DOM write.
 */
export function renderC20Panel(stationId: string, rubric: C13RubricItem[], toggled: string[]): string[] {
  const ids = rubric.map((item) => item.id);
  const label = document.querySelector("#sync-probe-c20");
  if (label) {
    const toggles = rubric.map((item) => `${item.label}:${toggled.includes(item.id) ? "on" : "off"}`).join(" | ");
    label.textContent = `checklist ${stationId}: ${toggles}`;
  }
  return ids;
}

export interface C20TriggerDeps {
  /** The select Event from the XR session (right-controller `select`). */
  event: Event;
  /** Currently commanded controller aim (null when unset). */
  aim: AimPose | null;
  /** Send one intent through the page intent queue (trigger path only). */
  enqueue(kind: IntentKind, payload: Record<string, unknown>): void;
  /** Record a local selection (tile hit, before the intent settles). */
  pushLocal(id: string): void;
}

/**
 * C20 trigger handler. In the lobby phase the lobby handler runs verbatim
 * (select-station for the hit tile, J2 evidence stays C12-identical). In the
 * scoring phase rubric tile triggers toggle the page-local set, the submit
 * trigger sends score-station from that set in rubric order, and the back
 * trigger sends return-to-lobby. Returns true when handled, false on a miss.
 */
export function handleC20Trigger(deps: C20TriggerDeps): boolean {
  const live = liveEvidence;
  if (live === null) {
    return false;
  }
  const { event, aim, enqueue, pushLocal } = deps;
  if (!live.scoring) {
    return handleLobbyTrigger({
      event,
      aim,
      onHit: (stationId) => {
        live.c20.stations.push({
          stationId,
          rubric: [],
          renderedIds: [],
          toggledIds: [],
          submittedItems: null,
          scoreAcked: false,
          returnAcked: false,
          badgeCheckedCount: null,
        });
        pushLocal(stationId);
      },
      sendSelect: (stationId) => {
        enqueue("select-station", { stationId });
      },
    });
  }
  if (!aim) {
    return false;
  }
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(aim.origin.x, aim.origin.y, aim.origin.z),
    new THREE.Vector3(aim.direction.x, aim.direction.y, aim.direction.z).normalize(),
  );
  const hits = raycaster.intersectObjects([...c20TileMeshes().values()], false);
  const userData: unknown = hits[0]?.object.userData;
  const tileId = isRecord(userData) ? userData["tileId"] : undefined;
  if (typeof tileId !== "string") {
    return false;
  }
  if (tileId === "c13:submit") {
    const items: Record<string, boolean> = {};
    for (const item of live.rubric) {
      items[item.id] = live.toggled.includes(item.id);
    }
    const current = live.c20.stations.at(-1);
    if (current) {
      current.submittedItems = { ...items };
    }
    pushLocal(tileId);
    enqueue("score-station", { items });
    return true;
  }
  if (tileId === "c13:back") {
    pushLocal(tileId);
    enqueue("return-to-lobby", {});
    return true;
  }
  const rubricId = tileId.replace(/^rubric:/, "");
  if (!live.rubric.some((item) => item.id === rubricId)) {
    return false;
  }
  const at = live.toggled.indexOf(rubricId);
  if (at >= 0) {
    live.toggled.splice(at, 1);
  } else {
    live.toggled.push(rubricId);
  }
  const current = live.c20.stations.at(-1);
  if (current) {
    current.toggledIds = [...live.toggled];
    live.renderPanel(current.stationId, live.rubric, live.toggled);
  }
  pushLocal(tileId);
  return true;
}

/** Live C20 rubric tile meshes (rebuilt per station; the trigger reads them). */
let c20Meshes = new Map<string, THREE.Mesh>();

function c20TileMeshes(): Map<string, THREE.Mesh> {
  return c20Meshes;
}

/** Center for any C20 score tile id (rubric:<id>, c13:submit, c13:back) against the live station rubric. */
export function c20CenterFor(tileId: string): [number, number, number] {
  return liveEvidence !== null ? c13CenterFor(tileId, liveEvidence.rubric) : [0, 1.2, -2.0];
}

/** Build this station's rubric + submit + back tiles and point the trigger at them. */
export function setC20RubricTiles(scene: THREE.Scene, rubric: C13RubricItem[]): void {
  c20Meshes = buildC13Tiles(scene, rubric);
  setC13TileMeshes(c20Meshes);
}

export interface C20ScriptDeps {
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  aimAndTriggerTile(tileId: string, expectedIntents: number): Promise<void>;
  aimLobbyAndTrigger(stationId: string): Promise<void>;
  getSnapshot(): unknown;
  setStatus(text: string): void;
  evidence: C20Evidence;
  counts(): { acks: number; rejects: number };
  scene: THREE.Scene;
  /** Station ids to score, in server lobby order (passed in, never re-read). */
  stationIds: string[];
  /** C21 extension hooks; C20 callers omit both and retain the original flow. */
  renderPanel?: PanelRenderer;
  onReplayRubric?: (stationId: string, rubric: C13RubricItem[], snapshot: unknown) => void;
}

/**
 * C20 score script: score EVERY lobby station in server tile order. Per
 * station: trigger the tile, wait for replay, read the SERVER replayRubric
 * as the checklist, render the labels in order, trigger the even-index
 * tiles on (deterministic pattern from the rubric), submit, return, and
 * wait for the lobby badge. Ack waits read the page intent counters (the
 * trigger path enqueues fire-and-forget, so the script settles by count).
 */
export async function runC20Script(deps: C20ScriptDeps): Promise<void> {
  const { waitFor, aimAndTriggerTile, aimLobbyAndTrigger, getSnapshot, setStatus, evidence, counts, scene, stationIds } = deps;
  const snapshot = (): C20RubricView => {
    const value = getSnapshot();
    return isRecord(value) ? value : {};
  };
  const renderPanel = deps.renderPanel ?? renderC20Panel;
  const live: { c20: C20Evidence; scoring: boolean; rubric: C13RubricItem[]; toggled: string[]; renderPanel: PanelRenderer } = {
    c20: evidence,
    scoring: false,
    rubric: [],
    toggled: [],
    renderPanel,
  };
  setC20Live(live);
  if (stationIds.length === 0) {
    throw new Error("c20 script needs at least one lobby station");
  }
  for (const stationId of stationIds) {
    live.scoring = false;
    setStatus(`sync-probe c20 selecting ${stationId}`);
    const beforeSelect = counts();
    await aimLobbyAndTrigger(stationId);
    await waitFor(
      () => counts().acks === beforeSelect.acks + 1 && counts().rejects === beforeSelect.rejects,
      15000,
      `select-station ${stationId} acked`,
    );
    live.scoring = true;
    await waitFor(() => snapshot().mode === "replay" && snapshot().stationId === stationId, 15000, `replay ${stationId} live`);
    const rubric = observedRubricOf(snapshot());
    if (rubric.length === 0) {
      throw new Error(`c20 script saw an empty replayRubric for ${stationId}`);
    }
    live.rubric = rubric;
    deps.onReplayRubric?.(stationId, rubric, snapshot());
    live.toggled = [];
    setC20RubricTiles(scene, rubric);
    const current = evidence.stations.at(-1);
    if (current) {
      current.rubric = rubric.map((item) => ({ ...item }));
    }
    await waitFor(() => snapshot().replayDone === true, 120000, `c20 replayDone ${stationId}`);
    if (current) {
      current.renderedIds = renderPanel(stationId, rubric, live.toggled);
    }
    setStatus(`sync-probe c20 scoring ${stationId} (${rubric.length} items)`);
    for (let index = 0; index < rubric.length; index += 1) {
      if (index % 2 === 0) {
        const item = rubric[index];
        if (item) {
          await aimAndTriggerTile(`rubric:${item.id}`, 0);
        }
      }
    }
    await waitFor(() => live.toggled.length === Math.ceil(rubric.length / 2), 15000, `even rubric tiles toggled ${stationId}`);
    if (current) {
      current.toggledIds = [...live.toggled];
      current.renderedIds = renderPanel(stationId, rubric, live.toggled);
    }
    const beforeScore = counts();
    await aimAndTriggerTile("c13:submit", 1);
    await waitFor(
      () => counts().acks === beforeScore.acks + 1 && counts().rejects === beforeScore.rejects,
      15000,
      `score-station ${stationId} acked`,
    );
    if (current) {
      current.scoreAcked = true;
    }
    const beforeReturn = counts();
    await aimAndTriggerTile("c13:back", 1);
    await waitFor(
      () => counts().acks === beforeReturn.acks + 1 && counts().rejects === beforeReturn.rejects,
      15000,
      `return-to-lobby ${stationId} acked`,
    );
    if (current) {
      current.returnAcked = true;
    }
    const wantChecked = Math.ceil(rubric.length / 2);
    await waitFor(() => {
      if (snapshot().mode !== "lobby") {
        return false;
      }
      const lobbyScores = snapshot().lobbyScores;
      const badges = Array.isArray(lobbyScores) ? lobbyScores.filter(isRecord) : [];
      const badge = badges.find((entry) => entry["stationId"] === stationId);
      if (badge !== undefined && badge["checkedCount"] === wantChecked && current) {
        current.badgeCheckedCount = wantChecked;
        return true;
      }
      return false;
    }, 15000, `back in lobby with the ${stationId} score badge`);
  }
}
