/**
 * C12 review-lobby probe helpers: lobby tile rendering state plus the
 * trigger-driven select script.
 *
 * Split out of sync-probe.ts for the file-size gate. The lobby lists one
 * tile per lobbyStations entry (server state only); the reviewer aims the
 * right controller at the station-2 tile and pulls the trigger, and THAT
 * trigger sends the select-station intent (never a direct call). After the
 * server launches the replay on the same connection, the existing C10/C11
 * renderers record the replayed turns/ends/emotions/noteChars.
 */
import * as THREE from "three";
import type { IntentKind } from "@openclinxr/xr-sync-client/headset";

/** One lobby tile, copied from the server lobbyStations entry. */
export interface C12LobbyTile {
  stationId: string;
  stationIndex: number;
  turnCount: number;
  notePresent: boolean;
  noteChars: number;
}

/** C12 lobby evidence recorded from server snapshots + the trigger. */
export interface C12LobbyEvidence {
  /** Tiles the page rendered from the server lobby state, in server order. */
  tiles: C12LobbyTile[];
  /** Station id of the tile the controller trigger hit ("" before a hit). */
  hitTileId: string;
  /** True once the page's select handler fired from a controller trigger. */
  triggerFired: boolean;
  /** True once the page sent select-station (always via the trigger path). */
  selectSent: boolean;
  /** True once the select-station ack settled. */
  selectAcked: boolean;
  /** Page-generated connection id, fixed at connect (rotation keeps the object). */
  connectionId: string;
  /** Modes the page saw, in order (lobby, then replay after the launch). */
  modes: string[];
  /** Station id the launched replay reports ("" before the launch lands). */
  launchStationId: string;
}

/** Empty C12 evidence (the script + tracker fill it; the harness reads it). */
export function createC12LobbyEvidence(): C12LobbyEvidence {
  return {
    tiles: [],
    hitTileId: "",
    triggerFired: false,
    selectSent: false,
    selectAcked: false,
    connectionId: `c12-${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`,
    modes: [],
    launchStationId: "",
  };
}

/** Minimal server snapshot surface the C12 tracker reads. */
export interface C12LobbyView {
  mode?: unknown;
  stationId?: unknown;
  lobbyStations?: unknown;
}

/** Tile center for the lobby row: spread across x at y=1.0, z=-2.0. */
export function tileCenterFor(index: number, count: number): [number, number, number] {
  const x = (index - (count - 1) / 2) * 1.8;
  return [x, 1.0, -2.0];
}

/** Live lobby tile meshes, owned by this module (built by the page flow, read by the trigger handler). */
let lobbyTileMeshes = new Map<string, THREE.Mesh>();

/** Replace the live lobby tile meshes (called once the server lobby state lands). */
export function setLobbyTileMeshes(meshes: Map<string, THREE.Mesh>): void {
  lobbyTileMeshes = meshes;
}

export interface LobbyTriggerDeps {
  /** The select Event from the XR session (right-controller `select`). */
  event: Event;
  /** Currently commanded controller aim (null when unset). */
  aim: AimPose | null;
  /** Record a local selection (tile hit, before the intent settles). */
  onHit(stationId: string): void;
  /** Send select-station for the hit tile (through the page intent queue). */
  sendSelect(stationId: string): void;
}

/**
 * C12 trigger handler: raycast the commanded aim against the lobby tiles and
 * send select-station for the hit tile. Returns true when the event targeted
 * the lobby (handled), false when it missed every tile. The select-station
 * intent leaves through this handler only (the script never calls it
 * directly): the harness checks the recorded hit tile id + trigger event.
 */
export function handleLobbyTrigger(deps: LobbyTriggerDeps): boolean {
  if (!deps.aim) {
    return false;
  }
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(deps.aim.origin.x, deps.aim.origin.y, deps.aim.origin.z),
    new THREE.Vector3(deps.aim.direction.x, deps.aim.direction.y, deps.aim.direction.z).normalize(),
  );
  const hits = raycaster.intersectObjects([...lobbyTileMeshes.values()], false);
  const stationId = (hits[0]?.object.userData as { stationId?: unknown } | undefined)?.["stationId"];
  if (typeof stationId !== "string" || !lobbyTileMeshes.has(stationId)) {
    return false;
  }
  deps.onHit(stationId);
  deps.sendSelect(stationId);
  return true;
}

/**
 * Per-snapshot lobby tracker: copies lobbyStations into tiles (server
 * order), records mode transitions, and renders one visible DOM label per
 * tile into #sync-probe-lobby (station id, turns, note chars).
 */
export function createC12LobbyTracker(evidence: C12LobbyEvidence): (snapshot: unknown) => void {
  return (snapshot: unknown): void => {
    const view = snapshot as C12LobbyView;
    if (typeof view.mode === "string" && view.mode !== "" && evidence.modes.at(-1) !== view.mode) {
      evidence.modes.push(view.mode);
    }
    if (typeof view.stationId === "string" && view.stationId !== "" && view.mode === "replay") {
      evidence.launchStationId = view.stationId;
    }
    if (!Array.isArray(view.lobbyStations)) {
      return;
    }
    // Lobby-only: replay snapshots carry an empty lobbyStations (the replay
    // room never fills it), which must not clobber the recorded tiles.
    if (view.lobbyStations.length === 0) {
      return;
    }
    const tiles: C12LobbyTile[] = [];
    for (const entry of view.lobbyStations) {
      const row = entry as Record<string, unknown>;
      if (typeof row["stationId"] !== "string") {
        continue;
      }
      tiles.push({
        stationId: row["stationId"] as string,
        stationIndex: typeof row["stationIndex"] === "number" ? (row["stationIndex"] as number) : tiles.length,
        turnCount: typeof row["turnCount"] === "number" ? (row["turnCount"] as number) : 0,
        notePresent: row["notePresent"] === true,
        noteChars: typeof row["noteChars"] === "number" ? (row["noteChars"] as number) : 0,
      });
    }
    evidence.tiles = tiles;
    const label = document.querySelector("#sync-probe-lobby");
    if (label) {
      label.textContent = tiles.map((t) => `${t.stationId} turns:${t.turnCount} note:${t.noteChars}`).join(" | ");
    }
  };
}

/** Build one mesh per lobby tile (called once the tiles are known). */
export function buildLobbyTiles(scene: THREE.Scene, tiles: C12LobbyTile[]): Map<string, THREE.Mesh> {
  const meshes = new Map<string, THREE.Mesh>();
  tiles.forEach((tile, index) => {
    const center = tileCenterFor(index, tiles.length);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.6, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x4a7d6b, roughness: 0.6 }),
    );
    mesh.position.set(center[0], center[1], center[2]);
    mesh.name = `sync-probe.lobby.${tile.stationId}`;
    mesh.userData["stationId"] = tile.stationId;
    scene.add(mesh);
    meshes.set(tile.stationId, mesh);
  });
  return meshes;
}

/**
 * Mark the trigger-sent select settled: exactly one ack and no rejects means
 * the lobby accepted the pick (the harness checks selectAcked).
 */
export function markTileTriggerSettled(evidence: C12LobbyEvidence, acks: number, rejects: number): void {
  if (acks === 1 && rejects === 0) {
    evidence.selectAcked = true;
  }
}

export interface C12ScriptDeps {
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  aimAndTriggerTile(stationId: string): Promise<void>;
  getSnapshot(): unknown;
  setStatus(text: string): void;
  evidence: C12LobbyEvidence;
}

/**
 * C12 review script: wait for the lobby tiles, trigger the station-2 tile
 * (the select goes out through the page trigger handler), then wait for the
 * launched replay to finish. The C10 observer records turns/ends/emotions.
 */
export async function runC12Script(deps: C12ScriptDeps): Promise<void> {
  const { waitFor, aimAndTriggerTile, getSnapshot, setStatus, evidence } = deps;
  const snapshot = (): C12LobbyView => (getSnapshot() as C12LobbyView | null) ?? {};
  await waitFor(() => (snapshot().lobbyStations as unknown[] | undefined) !== undefined && ((snapshot().lobbyStations as unknown[])?.length ?? 0) > 0, 15000, "lobby tiles");
  await waitFor(() => evidence.tiles.length > 0, 15000, "lobby tiles rendered");
  setStatus(`sync-probe c12 lobby: ${evidence.tiles.map((t) => t.stationId).join(",")} — triggering station-2`);
  await aimAndTriggerTile("station-2");
  await waitFor(() => evidence.selectAcked, 15000, "select-station acked");
  const replayDone = (): boolean => (snapshot() as { replayDone?: unknown }).replayDone === true;
  await waitFor(() => replayDone(), 120000, "station-2 replayDone");
  void ({} as { kind?: IntentKind });
}
