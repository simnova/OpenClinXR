/**
 * C14 review sign-off probe helpers: the lobby sign-off tile plus the
 * trigger-driven finalize.
 *
 * Split out of sync-probe.ts for the file-size gate. After the C13 flow
 * (lobby -> trigger station-2 -> replay -> two rubric toggles -> submit ->
 * back to lobby), the page renders one "sign off" tile in the lobby. The
 * reviewer aims the IWER controller at it and triggers, and THAT trigger
 * sends the finalize-review intent (never a direct call). The page then
 * records the server reviewFinalized flag plus the sign-off badge it
 * renders. Every export derives from SERVER state only, except the
 * page-local sent flags (which the harness checks against the sent intents).
 */
import * as THREE from "three";
import type { IntentKind } from "@openclinxr/xr-sync-client/headset";
import { handleC13Trigger, type C13Evidence } from "./probe-c13.js";
import type { C12LobbyEvidence } from "./probe-c12.js";
import type { AimPose } from "./probe-c7.js";

/** C14 sign-off evidence recorded from server snapshots + the trigger. */
export interface C14Evidence {
  /** Tile id of the sign-off tile the controller trigger hit ("" before a hit). */
  hitTileId: string;
  /** True once the sign-off handler fired from a controller trigger. */
  triggerFired: boolean;
  /** True once the page sent finalize-review (always via the trigger path). */
  signoffSent: boolean;
  /** True once the finalize-review ack settled. */
  signoffAcked: boolean;
  /** True once the page saw the server reviewFinalized flag. */
  reviewFinalized: boolean;
  /** Badge the page rendered from the server reviewFinalized flag. */
  signoffBadge: string;
  /** Page-generated connection id, fixed at connect (rotation keeps the object). */
  connectionId: string;
}

/** Empty C14 evidence (the script + tracker fill it; the harness reads it). */
export function createC14Evidence(): C14Evidence {
  return {
    hitTileId: "",
    triggerFired: false,
    signoffSent: false,
    signoffAcked: false,
    reviewFinalized: false,
    signoffBadge: "",
    connectionId: `c14-${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`,
  };
}

/** Minimal server snapshot surface the C14 tracker reads. */
export interface C14SignoffView {
  mode?: unknown;
  reviewFinalized?: unknown;
}

/**
 * Per-snapshot C14 tracker: copies the server reviewFinalized flag into
 * evidence and renders the sign-off badge into the visible #sync-probe-c14
 * label. Runs on every snapshot (lobby and replay alike); only the flag
 * matters, never the mode.
 */
export function createC14Tracker(probe: { c14: C14Evidence }): (snapshot: unknown) => void {
  return (snapshot: unknown): void => {
    const view = snapshot as C14SignoffView;
    const evidence = probe.c14;
    if (view.reviewFinalized === true && !evidence.reviewFinalized) {
      evidence.reviewFinalized = true;
    }
    evidence.signoffBadge = evidence.reviewFinalized ? "signoff:finalized" : "signoff:open";
    const label = document.querySelector("#sync-probe-c14");
    if (label) {
      label.textContent = evidence.signoffBadge;
    }
  };
}

/** Center of the sign-off tile (above the rubric row, centered). */
export function signoffCenter(): [number, number, number] {
  return [0, 2.1, -2.0];
}

/** Live C14 tile meshes, owned by this module (built by the page flow, read by the trigger handler). */
let c14TileMeshes = new Map<string, THREE.Mesh>();

/** Replace the live C14 tile meshes (called once the page is back in the lobby). */
export function setC14TileMeshes(meshes: Map<string, THREE.Mesh>): void {
  c14TileMeshes = meshes;
}

/** Build the sign-off tile mesh (called once, after the return to lobby). */
export function buildC14Tiles(scene: THREE.Scene): Map<string, THREE.Mesh> {
  const meshes = new Map<string, THREE.Mesh>();
  const center = signoffCenter();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.5, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x7d4a6b, roughness: 0.6 }),
  );
  mesh.position.set(center[0], center[1], center[2]);
  mesh.name = "sync-probe.c14.signoff";
  // biome-ignore lint/complexity/useLiteralKeys: three userData is a plain record here (see probe-c12 tileId).
  mesh.userData["tileId"] = "c14:signoff";
  scene.add(mesh);
  meshes.set("c14:signoff", mesh);
  return meshes;
}

export interface C14TriggerDeps {
  /** The select Event from the XR session (right-controller `select`). */
  event: Event;
  /** Currently commanded controller aim (null when unset). */
  aim: AimPose | null;
  /** C12 lobby evidence (the lobby phase runs the C12/C13 trigger chain). */
  c12: C12LobbyEvidence;
  /** C13 score evidence (the score phase runs through the C13 handler). */
  c13: C13Evidence;
  /** C14 sign-off evidence (sign-off trigger, finalize sent). */
  c14: C14Evidence;
  /** Send one intent through the page intent queue (trigger path only). */
  enqueue(kind: IntentKind, payload: Record<string, unknown>): void;
  /** Record a local selection (tile hit, before the intent settles). */
  pushLocal(id: string): void;
}

/**
 * C14 trigger handler. Before the return to lobby acks, the C13 chain runs
 * verbatim (lobby select, rubric toggles, submit, back). After it, a trigger
 * aimed at the sign-off tile sends finalize-review from that trigger only.
 * Returns true when handled, false on a miss.
 */
export function handleC14Trigger(deps: C14TriggerDeps): boolean {
  const { event, aim, c12, c13, c14, enqueue, pushLocal } = deps;
  if (!c13.returnAcked) {
    return handleC13Trigger({ event, aim, c12, c13, enqueue, pushLocal });
  }
  if (!aim) {
    return false;
  }
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(aim.origin.x, aim.origin.y, aim.origin.z),
    new THREE.Vector3(aim.direction.x, aim.direction.y, aim.direction.z).normalize(),
  );
  const hits = raycaster.intersectObjects([...c14TileMeshes.values()], false);
  // biome-ignore lint/complexity/useLiteralKeys: three userData is a plain record here (see probe-c12 tileId).
  const tileId = (hits[0]?.object.userData as { tileId?: unknown } | undefined)?.["tileId"];
  if (typeof tileId === "string" && tileId === "c14:signoff") {
    c14.hitTileId = tileId;
    c14.triggerFired = true;
    c14.signoffSent = true;
    pushLocal(tileId);
    enqueue("finalize-review", {});
    return true;
  }
  return handleC13Trigger({ event, aim, c12, c13, enqueue, pushLocal });
}

export interface C14ScriptDeps {
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  aimAndTriggerTile(tileId: string, expectedIntents: number): Promise<void>;
  getSnapshot(): unknown;
  setStatus(text: string): void;
  evidence: C14Evidence;
  counts(): { acks: number; rejects: number };
}

/**
 * C14 sign-off script (runs after the C13 script returned to the lobby with
 * the station-2 badge): trigger the sign-off tile (finalize-review leaves
 * through that trigger, never a direct call), then wait for the ack and the
 * server reviewFinalized flag. Ack waits read the page intent counters.
 */
export async function runC14Signoff(deps: C14ScriptDeps): Promise<void> {
  const { waitFor, aimAndTriggerTile, getSnapshot, setStatus, evidence, counts } = deps;
  const snapshot = (): { mode?: unknown; reviewFinalized?: unknown } => (getSnapshot() as { mode?: unknown; reviewFinalized?: unknown } | null) ?? {};
  await waitFor(() => snapshot().mode === "lobby", 15000, "c14 back in lobby");
  setStatus("sync-probe c14 signing off");
  const before = counts();
  await aimAndTriggerTile("c14:signoff", 1);
  await waitFor(
    () => counts().acks === before.acks + 1 && counts().rejects === before.rejects,
    15000,
    "finalize-review acked",
  );
  evidence.signoffAcked = true;
  await waitFor(() => snapshot().reviewFinalized === true, 15000, "reviewFinalized true");
  await waitFor(() => evidence.signoffBadge === "signoff:finalized", 15000, "sign-off badge finalized");
  void ({} as { kind?: IntentKind });
}
