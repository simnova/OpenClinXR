/**
 * C13 faculty-score probe helpers: rubric tile scoring plus the return to lobby.
 *
 * Split out of sync-probe.ts for the file-size gate. After the C12 flow
 * (lobby -> trigger station-2 -> replay, recorded into the C12 evidence), the
 * page renders one tile per rubric item (visible label), plus "submit" and
 * "back to lobby" tiles. The reviewer aims the IWER controller and triggers
 * two rubric tiles (toggle on), then submit (score-station from the page's
 * toggled set, never a direct call), then back to lobby (return-to-lobby).
 * After the return the page renders the lobby score badges from the server
 * lobbyScores. Every export derives from SERVER state only, except the
 * page-local toggled set (which the harness checks against the sent items).
 */
import * as THREE from "three";
import type { IntentKind } from "@openclinxr/xr-sync-client/headset";
import { handleLobbyTrigger, type C12LobbyEvidence } from "./probe-c12.js";
import type { AimPose } from "./probe-c7.js";

/** One rubric checklist entry (ids from the ?rubric= page parameter). */
export interface C13RubricItem {
  id: string;
  label: string;
}

/** One lobby score badge, copied from the server lobbyScores entry. */
export interface C13LobbyBadge {
  stationId: string;
  checkedCount: number;
}

/** C13 faculty-score evidence recorded from server snapshots + triggers. */
export interface C13Evidence {
  /** Rubric the page rendered (from ?rubric=, mirrored from the harness server config). */
  rubric: C13RubricItem[];
  /** Rubric ids the controller trigger toggled on, in toggle order. */
  toggledIds: string[];
  /** Items the page sent with score-station (rubric order, from the toggled set). */
  submittedItems: Record<string, boolean> | null;
  /** True once the submit tile trigger sent score-station. */
  scoreSent: boolean;
  /** True once the score-station ack settled. */
  scoreAcked: boolean;
  /** True once the back tile trigger sent return-to-lobby. */
  returnSent: boolean;
  /** True once the return-to-lobby ack settled. */
  returnAcked: boolean;
  /** Page-generated connection id, fixed at connect (rotation keeps the object). */
  connectionId: string;
  /** Modes the page saw, in order (lobby, replay, lobby after the return). */
  modes: string[];
  /** Badges the page rendered from the server lobbyScores, in server order. */
  lobbyBadges: C13LobbyBadge[];
  /** scoreChecked the page saw in the replay room (null before any replay snapshot). */
  scoreChecked: number | null;
  /** noteChars the page saw when the replay finished (before the return clobbers the C10 scalar). */
  replayNoteChars: number | null;
}

/** Empty C13 evidence (the script + tracker fill it; the harness reads it). */
export function createC13Evidence(): C13Evidence {
  return {
    rubric: [],
    toggledIds: [],
    submittedItems: null,
    scoreSent: false,
    scoreAcked: false,
    returnSent: false,
    returnAcked: false,
    connectionId: `c13-${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`,
    modes: [],
    lobbyBadges: [],
    scoreChecked: null,
    replayNoteChars: null,
  };
}

/** Minimal server snapshot surface the C13 tracker reads. */
export interface C13ScoreView {
  mode?: unknown;
  scoreChecked?: unknown;
  lobbyScores?: unknown;
}

/**
 * Per-snapshot C13 tracker: records mode transitions and scoreChecked, copies
 * lobbyScores into badges (server order), and renders the rubric toggles plus
 * the badges into the visible #sync-probe-c13 label. Empty lobbyScores arrays
 * never clobber the badges (replay snapshots carry an empty array).
 */
export function createC13Tracker(probe: { c13: C13Evidence }): (snapshot: unknown) => void {
  return (snapshot: unknown): void => {
    const view = snapshot as C13ScoreView;
    const evidence = probe.c13;
    if (typeof view.mode === "string" && view.mode !== "" && evidence.modes.at(-1) !== view.mode) {
      evidence.modes.push(view.mode);
    }
    if (typeof view.scoreChecked === "number") {
      evidence.scoreChecked = view.scoreChecked;
    }
    if (Array.isArray(view.lobbyScores) && view.lobbyScores.length > 0) {
      const badges: C13LobbyBadge[] = [];
      for (const entry of view.lobbyScores) {
        const row = entry as Record<string, unknown>;
        if (typeof row["stationId"] !== "string" || typeof row["checkedCount"] !== "number") {
          continue;
        }
        badges.push({ stationId: row["stationId"] as string, checkedCount: row["checkedCount"] as number });
      }
      evidence.lobbyBadges = badges;
    }
    const label = document.querySelector("#sync-probe-c13");
    if (label) {
      const toggles = evidence.rubric.map((item) => `${item.label}:${evidence.toggledIds.includes(item.id) ? "on" : "off"}`).join(" | ");
      const badges = evidence.lobbyBadges.map((badge) => `${badge.stationId}:${badge.checkedCount}`).join(" | ");
      label.textContent = `rubric: ${toggles} || scored: ${badges === "" ? "-" : badges}`;
    }
  };
}

/** Tile center for the rubric row: spread across x at y=1.2, z=-2.0. */
export function rubricCenterFor(index: number, count: number): [number, number, number] {
  const x = (index - (count - 1) / 2) * 1.4;
  return [x, 1.2, -2.0];
}

/** Center of the submit tile (below the rubric row, left). */
export function submitCenter(): [number, number, number] {
  return [-0.7, 0.3, -2.0];
}

/** Center of the back-to-lobby tile (below the rubric row, right). */
export function backCenter(): [number, number, number] {
  return [0.7, 0.3, -2.0];
}

/** Center for any C13 tile id (rubric:<id>, c13:submit, c13:back). */
export function c13CenterFor(tileId: string, rubric: C13RubricItem[]): [number, number, number] {
  if (tileId === "c13:submit") {
    return submitCenter();
  }
  if (tileId === "c13:back") {
    return backCenter();
  }
  const index = Math.max(0, rubric.findIndex((item) => `rubric:${item.id}` === tileId));
  return rubricCenterFor(index, Math.max(1, rubric.length));
}

/** Live C13 tile meshes, owned by this module (built by the page flow, read by the trigger handler). */
let c13TileMeshes = new Map<string, THREE.Mesh>();

/** Replace the live C13 tile meshes (called once the replay has finished). */
export function setC13TileMeshes(meshes: Map<string, THREE.Mesh>): void {
  c13TileMeshes = meshes;
}

/** Build the rubric + submit + back tile meshes (called once, after replayDone). */
export function buildC13Tiles(scene: THREE.Scene, rubric: C13RubricItem[]): Map<string, THREE.Mesh> {
  const meshes = new Map<string, THREE.Mesh>();
  rubric.forEach((item, index) => {
    const center = rubricCenterFor(index, rubric.length);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.6, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x6b5a4a, roughness: 0.6 }),
    );
    mesh.position.set(center[0], center[1], center[2]);
    mesh.name = `sync-probe.rubric.${item.id}`;
    mesh.userData["tileId"] = `rubric:${item.id}`;
    scene.add(mesh);
    meshes.set(`rubric:${item.id}`, mesh);
  });
  for (const [tileId, center, name] of [["c13:submit", submitCenter(), "sync-probe.c13.submit"] as const, ["c13:back", backCenter(), "sync-probe.c13.back"] as const]) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.4, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x4a6b7d, roughness: 0.6 }),
    );
    mesh.position.set(center[0], center[1], center[2]);
    mesh.name = name;
    mesh.userData["tileId"] = tileId;
    scene.add(mesh);
    meshes.set(tileId, mesh);
  }
  return meshes;
}

export interface C13TriggerDeps {
  /** The select Event from the XR session (right-controller `select`). */
  event: Event;
  /** Currently commanded controller aim (null when unset). */
  aim: AimPose | null;
  /** C12 lobby evidence (the lobby phase records the C12-identical trigger evidence). */
  c12: C12LobbyEvidence;
  /** C13 score evidence (rubric toggles, submit, return). */
  c13: C13Evidence;
  /** Send one intent through the page intent queue (trigger path only). */
  enqueue(kind: IntentKind, payload: Record<string, unknown>): void;
  /** Record a local selection (tile hit, before the intent settles). */
  pushLocal(id: string): void;
}

/**
 * C13 trigger handler. Before the lobby select acks, the lobby phase runs
 * through the C12 handler verbatim (J2 evidence stays C12-identical). After
 * the replay, rubric tile triggers toggle the page-local set, the submit
 * trigger sends score-station from that set in rubric order, and the back
 * trigger sends return-to-lobby. Returns true when handled, false on a miss.
 */
export function handleC13Trigger(deps: C13TriggerDeps): boolean {
  const { event, aim, c12, c13, enqueue, pushLocal } = deps;
  if (!c12.selectAcked) {
    return handleLobbyTrigger({
      event,
      aim,
      onHit: (stationId) => {
        c12.hitTileId = stationId;
        c12.triggerFired = true;
        pushLocal(stationId);
        c12.selectSent = true;
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
  const hits = raycaster.intersectObjects([...c13TileMeshes.values()], false);
  const tileId = (hits[0]?.object.userData as { tileId?: unknown } | undefined)?.["tileId"];
  if (typeof tileId !== "string" || !c13TileMeshes.has(tileId)) {
    return false;
  }
  if (tileId === "c13:submit") {
    // Submit sends score-station from the page's toggled set (rubric order).
    const items: Record<string, boolean> = {};
    for (const item of c13.rubric) {
      items[item.id] = c13.toggledIds.includes(item.id);
    }
    c13.submittedItems = { ...items };
    c13.scoreSent = true;
    pushLocal(tileId);
    enqueue("score-station", { items });
    return true;
  }
  if (tileId === "c13:back") {
    c13.returnSent = true;
    pushLocal(tileId);
    enqueue("return-to-lobby", {});
    return true;
  }
  // Rubric tile: toggle the page-local set (the script toggles two tiles on).
  const rubricId = tileId.replace(/^rubric:/, "");
  if (!c13.rubric.some((item) => item.id === rubricId)) {
    return false;
  }
  const at = c13.toggledIds.indexOf(rubricId);
  if (at >= 0) {
    c13.toggledIds.splice(at, 1);
  } else {
    c13.toggledIds.push(rubricId);
  }
  pushLocal(tileId);
  return true;
}

export interface C13ScriptDeps {
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  aimAndTriggerTile(tileId: string, expectedIntents: number): Promise<void>;
  getSnapshot(): unknown;
  setStatus(text: string): void;
  evidence: C13Evidence;
  counts(): { acks: number; rejects: number };
}

/**
 * C13 score script (runs after the C12 flow reached replayDone): trigger two
 * rubric tiles on, submit the toggled set, then return to the lobby and wait
 * for the score badge. Ack waits read the page intent counters (the trigger
 * path enqueues fire-and-forget, so the script settles by count).
 */
export async function runC13Script(deps: C13ScriptDeps): Promise<void> {
  const { waitFor, aimAndTriggerTile, getSnapshot, setStatus, evidence, counts } = deps;
  const snapshot = (): { replayDone?: unknown; mode?: unknown; noteChars?: unknown } => (getSnapshot() as { replayDone?: unknown; mode?: unknown; noteChars?: unknown } | null) ?? {};
  await waitFor(() => snapshot().replayDone === true, 120000, "c13 replayDone");
  // Capture the replayed noteChars now: the return to lobby rotates onto a
  // fresh lobby room whose noteChars 0 would clobber the C10 scalar.
  evidence.replayNoteChars = typeof snapshot().noteChars === "number" ? (snapshot().noteChars as number) : null;
  const [first, second] = evidence.rubric;
  if (!first || !second) {
    throw new Error("c13 script needs at least two rubric items");
  }
  setStatus(`sync-probe c13 scoring ${first.id}, ${second.id}`);
  await aimAndTriggerTile(`rubric:${first.id}`, 0);
  await aimAndTriggerTile(`rubric:${second.id}`, 0);
  await waitFor(() => evidence.toggledIds.length === 2, 15000, "two rubric tiles toggled");
  const beforeScore = counts();
  await aimAndTriggerTile("c13:submit", 1);
  await waitFor(
    () => counts().acks === beforeScore.acks + 1 && counts().rejects === beforeScore.rejects,
    15000,
    "score-station acked",
  );
  evidence.scoreAcked = true;
  const beforeReturn = counts();
  await aimAndTriggerTile("c13:back", 1);
  await waitFor(
    () => counts().acks === beforeReturn.acks + 1 && counts().rejects === beforeReturn.rejects,
    15000,
    "return-to-lobby acked",
  );
  evidence.returnAcked = true;
  await waitFor(
    () =>
      snapshot().mode === "lobby" &&
      evidence.lobbyBadges.some((badge) => badge.stationId === "station-2" && badge.checkedCount === 2),
    15000,
    "back in lobby with the station-2 score badge",
  );
  void ({} as { kind?: IntentKind });
}
