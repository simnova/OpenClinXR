/**
 * C6 probe helpers: the shared server-driven turn script plus pure server
 * snapshot readers and the station phase ring.
 *
 * Split out of sync-probe.ts for the file-size gate. The turn script is
 * shared verbatim by ?script=c3 and ?script=c6 (never forked): both pass the
 * same queue + observed-state closures. Every export derives pixels or waits
 * from SERVER state only; no page-local timing enters.
 */
import * as THREE from "three";
import type { IntentKind } from "@openclinxr/xr-sync-client/headset";
import { BASE_TURN_COLOUR } from "./probe-state.js";

/** Minimal server snapshot surface the turn script reads. */
export interface C6TurnView {
  turnId?: unknown;
  turnOwner?: unknown;
  actors?: Record<string, { speaking?: unknown } | undefined>;
}

/** (turnId, owner, a1Speaking) read from a server snapshot. Pure function. */
export function observedTurnFrom(state: C6TurnView | null | undefined): {
  turnId: number;
  owner: string;
  a1Speaking: boolean;
} {
  return {
    turnId: typeof state?.turnId === "number" ? state.turnId : -1,
    owner: typeof state?.turnOwner === "string" ? state.turnOwner : "",
    a1Speaking: state?.actors?.a1?.speaking === true,
  };
}

/** Minimal server snapshot surface the phase waits read. */
export interface C6PhaseView {
  phase?: unknown;
  phaseRemainingS?: unknown;
}

/** (phase, remainingS) read from a server snapshot. Pure function. */
export function observedPhaseFrom(state: C6PhaseView | null | undefined): {
  phase: string;
  remainingS: number | null;
} {
  return {
    phase: typeof state?.phase === "string" ? state.phase : "",
    remainingS: typeof state?.phaseRemainingS === "number" ? state.phaseRemainingS : null,
  };
}

export interface C3TurnScriptDeps {
  sendIntentAndSettle(kind: IntentKind, payload: Record<string, unknown>): Promise<void>;
  observedTurn(): { turnId: number; owner: string; a1Speaking: boolean };
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
}

/**
 * C3 server-driven turn script: three learner utterance pairs with a
 * mid-turn interrupt. The interrupt waits on observed server state: turn 2
 * must be speaking before the interrupting start.
 */
export async function runC3TurnScript(deps: C3TurnScriptDeps): Promise<void> {
  const { sendIntentAndSettle, observedTurn, waitFor } = deps;
  await sendIntentAndSettle("utterance-start", {});
  await sendIntentAndSettle("utterance-end", {});
  await waitFor(() => {
    const turn = observedTurn();
    return turn.turnId === 1 && turn.a1Speaking;
  }, 20000, "turn 1 speaking");
  await waitFor(() => {
    const turn = observedTurn();
    return turn.turnId === 1 && !turn.a1Speaking && turn.owner === "none";
  }, 20000, "turn 1 completed on server clock");

  await sendIntentAndSettle("utterance-start", {});
  await sendIntentAndSettle("utterance-end", {});
  await waitFor(() => {
    const turn = observedTurn();
    return turn.turnId === 2 && turn.a1Speaking;
  }, 20000, "turn 2 speaking");

  await sendIntentAndSettle("utterance-start", {});
  // Hold the interrupting utterance until the page has rendered the
  // interrupt from server state. Ending it one RTT later lets both changes
  // coalesce into one 50 ms schema patch (Quest c4 quest2 never saw the
  // interrupt emotion).
  await waitFor(() => {
    const turn = observedTurn();
    return turn.turnId === 2 && !turn.a1Speaking && turn.owner === "learner";
  }, 20000, "interrupt rendered");
  await sendIntentAndSettle("utterance-end", {});
  await waitFor(() => {
    const turn = observedTurn();
    return turn.turnId === 3 && turn.a1Speaking;
  }, 20000, "turn 3 speaking");
  await waitFor(() => {
    const turn = observedTurn();
    return turn.turnId === 3 && !turn.a1Speaking && turn.owner === "none";
  }, 20000, "turn 3 completed on server clock");
}

export interface C6PreProbeDeps {
  sent(): number;
  enqueueSelectA1(): void;
  waitForSettled(target: number): Promise<void>;
  setStatus(text: string): void;
}

/**
 * C6 phase-gating probe: one select-actor while the server is still in
 * doorway (the page join created the room, so the clock just started). It
 * must reject outside-encounter-phase; the harness asserts the reject plus
 * that the server never applied it.
 */
export async function runC6PreEncounterProbe(deps: C6PreProbeDeps): Promise<void> {
  deps.setStatus("sync-probe c6 pre-encounter probe");
  const target = deps.sent() + 1;
  deps.enqueueSelectA1();
  await deps.waitForSettled(target);
}

/**
 * C6 station phase ring: one flat ring around the floor, coloured ONLY by
 * the server phase (resolvePhaseColour). No local timing ever drives it.
 */
export function createPhaseRing(scene: THREE.Scene): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 3.7, 64),
    new THREE.MeshBasicMaterial({ color: BASE_TURN_COLOUR, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.name = "sync-probe.phase-ring";
  scene.add(ring);
  return ring;
}
