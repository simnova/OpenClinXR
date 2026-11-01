/**
 * C12 probe script dispatcher: the ?script= chain moved out of sync-probe.ts
 * for the file-size gate (no behaviour change: every arm is verbatim).
 *
 * Each arm drives the page through one product slice: c3 (server-driven turn),
 * c6 (phase-gated C3), c7/c8 (per-station C3 with server rotation), c10
 * (faculty replay watch), c11 (patient-note submits), c12 (review-lobby tile
 * trigger + launched replay watch), or the default c2 sweep. The C10/C11
 * renderers stay wired for every script; the dispatcher only picks the
 * driver. All waits read SERVER state; no page-local timing enters.
 */

import type * as THREE from "three";
import type { IntentKind } from "@openclinxr/xr-sync-client/headset";
import { createC3ScriptHelpers } from "./probe-c6.js";
import { createAimAndTrigger, runC7Script, type AimPose } from "./probe-c7.js";
import { runC10Script } from "./probe-c10.js";
import { runC11Script, type C11NoteEvidence } from "./probe-c11.js";
import {
  buildLobbyTiles,
  markTileTriggerSettled,
  runC12Script,
  setLobbyTileMeshes,
  tileCenterFor,
  type C12LobbyEvidence,
} from "./probe-c12.js";
import {
  buildC13Tiles,
  c13CenterFor,
  runC13Script,
  setC13TileMeshes,
  type C13Evidence,
} from "./probe-c13.js";
import {
  buildC14Tiles,
  runC14Signoff,
  setC14TileMeshes,
  signoffCenter,
  type C14Evidence,
} from "./probe-c14.js";
import { runC15Script } from "./probe-c15.js";
import { createC16Evidence, runC16Script, type C16Evidence } from "./probe-c16.js";
import { createC17Evidence, runC17Script, type C17Evidence } from "./probe-c17.js";
import { createC18Evidence, runC18Script, type C18Evidence } from "./probe-c18.js";
import { createC19Evidence, runC19Script, type C19Evidence } from "./probe-c19.js";
import { createC20Evidence, c20CenterFor, runC20Script, type C20Evidence, type C20ScriptDeps } from "./probe-c20.js";
import { createC21Evidence, runC21Script, runC22Probe } from "./probe-c21.js";
import { PROBE_ACTOR_IDS, resolvePhaseLabel } from "./probe-state.js";
import { parseC11NoteMaxChars } from "./probe-query.js";
/** Aim-and-trigger driver: aim the right controller, pull the trigger. */
export type AimAndTrigger = (actorId: string, expectedIntents: number) => Promise<void>;

/** Everything the script chain reads: page-owned closures, never page state. */
export interface ProbeScriptDeps {
  script: string;
  scene: THREE.Scene;
  dispatch(method: string, params: Record<string, unknown>): Promise<unknown>;
  waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void>;
  sendIntentAndSettle(kind: IntentKind, payload: Record<string, unknown>): Promise<void>;
  aimAndTrigger: AimAndTrigger;
  enqueueSelectA1(): void;
  getSnapshot(): unknown;
  getSessionLearnerSpeaking(): boolean;
  setStatus(text: string): void;
  setPoseStreaming(enabled: boolean): void;
  keepPoseAcrossRotation: boolean;
  c11Note: C11NoteEvidence;
  c12: C12LobbyEvidence;
  c13: C13Evidence;
  c14: C14Evidence;
  intentCounts(): { sent: number; acks: number; rejects: number; rejectDetails: Array<{ seq: number; reason: string }> };
  setCommandedAim(aim: AimPose | null): void;
}
/** Run the ?script= driver (verbatim arms from sync-probe.ts). */
export async function runProbeScript(deps: ProbeScriptDeps): Promise<void> {
  const { waitFor, sendIntentAndSettle, aimAndTrigger, getSnapshot, setStatus } = deps;
  const { observedPhase, turnScript } = createC3ScriptHelpers({
    sendIntentAndSettle,
    getSnapshot,
    waitFor,
  });

  if (deps.script === "c3") {
    // C3: select a1 ONCE via trigger, then the shared turn script.
    setStatus("sync-probe c3 turn script");
    await aimAndTrigger("a1", 1);
    await turnScript();
  } else if (deps.script === "c6") {
    // C6: pre-encounter probe ran at connect; wait encounter, trigger a1,
    // run the shared C3 script, wait closed. Label is pure server state.
    await waitFor(() => observedPhase().phase === "encounter", 30000, "encounter phase");
    setStatus(`sync-probe c6 ${resolvePhaseLabel(observedPhase().phase, observedPhase().remainingS)} turn script`);
    await aimAndTrigger("a1", 1);
    await turnScript();
    setStatus(`sync-probe c6 ${resolvePhaseLabel(observedPhase().phase, observedPhase().remainingS)} waiting closed`);
    await waitFor(() => observedPhase().phase === "closed", 60000, "closed phase");
  } else if (deps.script === "c7" || deps.script === "c8") {
    // C7: the shared C3 turn script once per station (see probe-c7). C8
    // imports the same loop with pose streaming left on across rotation.
    await runC7Script({
      waitFor,
      sendIntentAndSettle,
      aimAndTrigger,
      enqueueSelectA1: () => deps.enqueueSelectA1(),
      settlePreProbe: async () => {
        const target = deps.intentCounts().sent;
        await waitFor(
          () => deps.intentCounts().acks + deps.intentCounts().rejects >= target,
          15000,
          "station pre-encounter settled",
        );
      },
      getSnapshot,
      setStatus,
      setPoseStreaming: (enabled) => {
        deps.setPoseStreaming(enabled);
      },
      keepPoseAcrossRotation: deps.keepPoseAcrossRotation,
    });
  } else if (deps.script === "c10") {
    // C10 faculty replay: one select-actor (rejected read-only), then watch.
    await runC10Script({ waitFor, sendIntentAndSettle, getSnapshot });
  } else if (deps.script === "c11") {
    // C11 patient note: one-station C3 script, then note-submits in the note phase.
    await runC11Script({
      waitFor,
      sendIntentAndSettle,
      getSnapshot,
      setStatus,
      noteMaxChars: parseC11NoteMaxChars(window.location.search),
      note: deps.c11Note,
    });
  } else if (deps.script === "c12") {
    // C12 review lobby: build one tile mesh per server lobby station, aim
    // the controller at the station-2 tile and trigger (the select goes
    // out through onSelectEvent, never a direct call), then watch the
    // launched replay with the C10/C11 renderers.
    await waitFor(() => deps.c12.tiles.length > 0, 15000, "c12 lobby tiles tracked");
    setLobbyTileMeshes(buildLobbyTiles(deps.scene, deps.c12.tiles));
    const aimTileAndTrigger = createAimAndTrigger({
      dispatch: (method: string, params: Record<string, unknown>) => deps.dispatch(method, params),
      actorCenter: (id) => {
        const index = deps.c12.tiles.findIndex((t) => t.stationId === id);
        return tileCenterFor(Math.max(0, index), Math.max(1, deps.c12.tiles.length));
      },
      setCommandedAim: (aim) => {
        deps.setCommandedAim(aim);
      },
      sent: () => deps.intentCounts().sent,
      settled: () => deps.intentCounts().acks + deps.intentCounts().rejects,
      waitFor,
    });
    await runC12Script({
      waitFor,
      aimAndTriggerTile: async (stationId) => {
        await aimTileAndTrigger(stationId, 1);
        markTileTriggerSettled(deps.c12, deps.intentCounts().acks, deps.intentCounts().rejects);
      },
      getSnapshot,
      setStatus,
      evidence: deps.c12,
    });
  } else if (deps.script === "c13") {
    // C13 faculty score: the C12 flow verbatim (lobby tiles, station-2
    // trigger through onSelectEvent, launched replay watch), then the rubric
    // tiles (two toggled on), submit (score-station from the toggled set),
    // and back to lobby (return-to-lobby + score badge wait).
    await waitFor(() => deps.c12.tiles.length > 0, 15000, "c13 lobby tiles tracked");
    setLobbyTileMeshes(buildLobbyTiles(deps.scene, deps.c12.tiles));
    const aimLobbyAndTrigger = createAimAndTrigger({
      dispatch: (method: string, params: Record<string, unknown>) => deps.dispatch(method, params),
      actorCenter: (id) => {
        const index = deps.c12.tiles.findIndex((t) => t.stationId === id);
        return tileCenterFor(Math.max(0, index), Math.max(1, deps.c12.tiles.length));
      },
      setCommandedAim: (aim) => {
        deps.setCommandedAim(aim);
      },
      sent: () => deps.intentCounts().sent,
      settled: () => deps.intentCounts().acks + deps.intentCounts().rejects,
      waitFor,
    });
    await runC12Script({
      waitFor,
      aimAndTriggerTile: async (stationId) => {
        await aimLobbyAndTrigger(stationId, 1);
        markTileTriggerSettled(deps.c12, deps.intentCounts().acks, deps.intentCounts().rejects);
      },
      getSnapshot,
      setStatus,
      evidence: deps.c12,
    });
    setC13TileMeshes(buildC13Tiles(deps.scene, deps.c13.rubric));
    const aimScoreAndTrigger = createAimAndTrigger({
      dispatch: (method: string, params: Record<string, unknown>) => deps.dispatch(method, params),
      actorCenter: (id) => c13CenterFor(id, deps.c13.rubric),
      setCommandedAim: (aim) => {
        deps.setCommandedAim(aim);
      },
      sent: () => deps.intentCounts().sent,
      settled: () => deps.intentCounts().acks + deps.intentCounts().rejects,
      waitFor,
    });
    await runC13Script({
      waitFor,
      aimAndTriggerTile: (tileId, expectedIntents) => aimScoreAndTrigger(tileId, expectedIntents),
      getSnapshot,
      setStatus,
      evidence: deps.c13,
      counts: () => ({ acks: deps.intentCounts().acks, rejects: deps.intentCounts().rejects }),
    });
  } else if (deps.script === "c14") {
    // C14 sign-off: the C13 flow verbatim (lobby tiles, station-2 trigger
    // through onSelectEvent, launched replay watch, two rubric toggles,
    // submit, back to lobby with the station-2 badge), then the sign-off
    // tile (finalize-review through the trigger) and the finalized wait.
    await waitFor(() => deps.c12.tiles.length > 0, 15000, "c14 lobby tiles tracked");
    setLobbyTileMeshes(buildLobbyTiles(deps.scene, deps.c12.tiles));
    const aimLobbyAndTrigger = createAimAndTrigger({
      dispatch: (method: string, params: Record<string, unknown>) => deps.dispatch(method, params),
      actorCenter: (id) => {
        const index = deps.c12.tiles.findIndex((t) => t.stationId === id);
        return tileCenterFor(Math.max(0, index), Math.max(1, deps.c12.tiles.length));
      },
      setCommandedAim: (aim) => {
        deps.setCommandedAim(aim);
      },
      sent: () => deps.intentCounts().sent,
      settled: () => deps.intentCounts().acks + deps.intentCounts().rejects,
      waitFor,
    });
    await runC12Script({
      waitFor,
      aimAndTriggerTile: async (stationId) => {
        await aimLobbyAndTrigger(stationId, 1);
        markTileTriggerSettled(deps.c12, deps.intentCounts().acks, deps.intentCounts().rejects);
      },
      getSnapshot,
      setStatus,
      evidence: deps.c12,
    });
    setC13TileMeshes(buildC13Tiles(deps.scene, deps.c13.rubric));
    const aimScoreAndTrigger = createAimAndTrigger({
      dispatch: (method: string, params: Record<string, unknown>) => deps.dispatch(method, params),
      actorCenter: (id) => c13CenterFor(id, deps.c13.rubric),
      setCommandedAim: (aim) => {
        deps.setCommandedAim(aim);
      },
      sent: () => deps.intentCounts().sent,
      settled: () => deps.intentCounts().acks + deps.intentCounts().rejects,
      waitFor,
    });
    await runC13Script({
      waitFor,
      aimAndTriggerTile: (tileId, expectedIntents) => aimScoreAndTrigger(tileId, expectedIntents),
      getSnapshot,
      setStatus,
      evidence: deps.c13,
      counts: () => ({ acks: deps.intentCounts().acks, rejects: deps.intentCounts().rejects }),
    });
    setC14TileMeshes(buildC14Tiles(deps.scene));
    const aimSignoffAndTrigger = createAimAndTrigger({
      dispatch: (method: string, params: Record<string, unknown>) => deps.dispatch(method, params),
      actorCenter: () => signoffCenter(),
      setCommandedAim: (aim) => {
        deps.setCommandedAim(aim);
      },
      sent: () => deps.intentCounts().sent,
      settled: () => deps.intentCounts().acks + deps.intentCounts().rejects,
      waitFor,
    });
    await runC14Signoff({
      waitFor,
      aimAndTriggerTile: (tileId, expectedIntents) => aimSignoffAndTrigger(tileId, expectedIntents),
      getSnapshot,
      setStatus,
      evidence: deps.c14,
      counts: () => ({ acks: deps.intentCounts().acks, rejects: deps.intentCounts().rejects }),
    });
  } else if (deps.script === "c15") {
    // C15 blueprint session: the shared C3 turn script once per blueprint
    // station (server rotation), with the station label panel tracked.
    await runC15Script({
      waitFor,
      sendIntentAndSettle,
      aimAndTrigger,
      enqueueSelectA1: () => deps.enqueueSelectA1(),
      settlePreProbe: async () => {
        const target = deps.intentCounts().sent;
        await waitFor(
          () => deps.intentCounts().acks + deps.intentCounts().rejects >= target,
          15000,
          "station pre-encounter settled",
        );
      },
      getSnapshot,
      setStatus,
      setPoseStreaming: (enabled) => {
        deps.setPoseStreaming(enabled);
      },
    });
  } else if (deps.script === "c16") {
    // C16 scenario-cast session: one cast-actor select + the C3 turn script
    // per cast station (server rotation), with the cast panel tracked in the
    // C16 evidence surface (sync-probe.ts sits at its file-size ceiling, so
    // probe-c16 owns and publishes window.__syncProbeC16 itself).
    const c16: C16Evidence = createC16Evidence();
    const publishC16 = (): void => {
      window.__syncProbeC16 = c16;
      // The harness reads window.__syncProbe (harness-lib is shared and
      // frozen); sync-probe.ts sits at its file-size ceiling and cannot grow
      // a c16 field, so the C16 module attaches its data-only evidence here.
      if (window.__syncProbe !== undefined) {
        Object.assign(window.__syncProbe, { c16 });
      }
    };
    publishC16();
    await runC16Script({
      waitFor,
      sendIntentAndSettle,
      counts: () => deps.intentCounts(),
      enqueueSelectA1: () => deps.enqueueSelectA1(),
      settlePreProbe: async () => {
        const target = deps.intentCounts().sent;
        await waitFor(
          () => deps.intentCounts().acks + deps.intentCounts().rejects >= target,
          15000,
          "station pre-encounter settled",
        );
      },
      getSnapshot,
      setStatus,
      setPoseStreaming: (enabled) => {
        deps.setPoseStreaming(enabled);
      },
      evidence: c16,
      publish: publishC16,
    });
  } else if (deps.script === "c17") {
    // C17 scenario-voice session: every cast actor's opening line + caption
    // per cast station (server rotation), with the caption panel tracked in
    // the C17 evidence surface (same ceiling rationale as the C16 module: it
    // owns and publishes window.__syncProbeC17 itself).
    const c17: C17Evidence = createC17Evidence();
    const publishC17 = (): void => {
      window.__syncProbeC17 = c17;
      // The harness reads window.__syncProbe (harness-lib is shared and
      // frozen); sync-probe.ts sits at its file-size ceiling and cannot grow
      // a c17 field, so the C17 module attaches its data-only evidence here.
      if (window.__syncProbe !== undefined) {
        Object.assign(window.__syncProbe, { c17 });
      }
    };
    publishC17();
    await runC17Script({
      waitFor,
      sendIntentAndSettle,
      counts: () => deps.intentCounts(),
      enqueueSelectA1: () => deps.enqueueSelectA1(),
      settlePreProbe: async () => {
        const target = deps.intentCounts().sent;
        await waitFor(
          () => deps.intentCounts().acks + deps.intentCounts().rejects >= target,
          15000,
          "station pre-encounter settled",
        );
      },
      getSnapshot,
      setStatus,
      setPoseStreaming: (enabled) => {
        deps.setPoseStreaming(enabled);
      },
      evidence: c17,
      publish: publishC17,
    });
  } else if (deps.script === "c18") {
    // C18 faculty replay of a recorded cast station: the C10 flow verbatim
    // (one select-actor that must reject read-only, then watch the recorded
    // station) plus the visible replyId/emotion panel tracked in the C18
    // evidence surface (same ceiling rationale as the C16/C17 modules: it
    // owns and publishes window.__syncProbeC18 itself).
    const c18: C18Evidence = createC18Evidence();
    const publishC18 = (): void => {
      window.__syncProbeC18 = c18;
      // The harness reads window.__syncProbe (harness-lib is shared and
      // frozen); sync-probe.ts sits at its file-size ceiling and cannot grow
      // a c18 field, so the C18 module attaches its data-only evidence here.
      if (window.__syncProbe !== undefined) {
        Object.assign(window.__syncProbe, { c18 });
      }
    };
    publishC18();
    await runC18Script({
      waitFor,
      sendIntentAndSettle,
      getSnapshot,
      setStatus,
      evidence: c18,
      publish: publishC18,
    });
  } else if (deps.script === "c19") {
    // C19 server-clock schedule watch: no learner intent per station (the
    // connect-time doorway probe is the only intent), watch each scheduled
    // interjection on the server clock with the panel tracked in the C19
    // evidence surface (same ceiling rationale as the C16/C17/C18 modules: it
    // owns and publishes window.__syncProbeC19 itself).
    const c19: C19Evidence = createC19Evidence();
    const publishC19 = (): void => {
      window.__syncProbeC19 = c19;
      // The harness reads window.__syncProbe (harness-lib is shared and
      // frozen); sync-probe.ts sits at its file-size ceiling and cannot grow
      // a c19 field, so the C19 module attaches its data-only evidence here.
      if (window.__syncProbe !== undefined) {
        Object.assign(window.__syncProbe, { c19 });
      }
    };
    publishC19();
    await runC19Script({
      waitFor,
      enqueueSelectA1: () => deps.enqueueSelectA1(),
      settlePreProbe: async () => {
        const target = deps.intentCounts().sent;
        await waitFor(
          () => deps.intentCounts().acks + deps.intentCounts().rejects >= target,
          15000,
          "station pre-encounter settled",
        );
      },
      getSnapshot,
      setStatus,
      setPoseStreaming: (enabled) => {
        deps.setPoseStreaming(enabled);
      },
      evidence: c19,
      publish: publishC19,
    });
  } else if (deps.script === "c20" || deps.script === "c21") {
    // C20 scenario-rubric scoring: the lobby tiles (C12 flow verbatim), then
    // every station in server order is replayed and scored against its own
    // scenario rubric (checklist from the SERVER replayRubric, same ceiling
    // rationale as the C16-C19 modules: probe-c20 owns and publishes
    // window.__syncProbeC20 itself).
    const c20: C20Evidence = deps.script === "c21" ? createC21Evidence() : createC20Evidence();
    const publishC20 = (): void => {
      window.__syncProbeC20 = c20;
      // The harness reads window.__syncProbe (harness-lib is shared and
      // frozen); sync-probe.ts sits at its file-size ceiling and cannot grow
      // a c20 field, so the C20 module attaches its data-only evidence here.
      if (window.__syncProbe !== undefined) {
        Object.assign(window.__syncProbe, { c20 });
        if (deps.script === "c21") {
          window.__syncProbeC21 = c20 as ReturnType<typeof createC21Evidence>;
          Object.assign(window.__syncProbe, { c21: c20 });
        }
      }
    };
    publishC20();
    await waitFor(() => deps.c12.tiles.length > 0, 15000, "c20 lobby tiles tracked");
    setLobbyTileMeshes(buildLobbyTiles(deps.scene, deps.c12.tiles));
    const aimLobbyAndTrigger = createAimAndTrigger({
      dispatch: (method: string, params: Record<string, unknown>) => deps.dispatch(method, params),
      actorCenter: (id) => {
        const index = deps.c12.tiles.findIndex((t) => t.stationId === id);
        return tileCenterFor(Math.max(0, index), Math.max(1, deps.c12.tiles.length));
      },
      setCommandedAim: (aim) => {
        deps.setCommandedAim(aim);
      },
      sent: () => deps.intentCounts().sent,
      settled: () => deps.intentCounts().acks + deps.intentCounts().rejects,
      waitFor,
    });
    const aimScoreAndTrigger = createAimAndTrigger({
      dispatch: (method: string, params: Record<string, unknown>) => deps.dispatch(method, params),
      actorCenter: (id) => c20CenterFor(id),
      setCommandedAim: (aim) => {
        deps.setCommandedAim(aim);
      },
      sent: () => deps.intentCounts().sent,
      settled: () => deps.intentCounts().acks + deps.intentCounts().rejects,
      waitFor,
    });
    const flow: C20ScriptDeps = {
      waitFor,
      aimAndTriggerTile: (tileId, expectedIntents) => aimScoreAndTrigger(tileId, expectedIntents),
      aimLobbyAndTrigger: async (stationId) => {
        await aimLobbyAndTrigger(stationId, 1);
        markTileTriggerSettled(deps.c12, deps.intentCounts().acks, deps.intentCounts().rejects);
      },
      getSnapshot,
      setStatus,
      evidence: c20,
      counts: () => ({ acks: deps.intentCounts().acks, rejects: deps.intentCounts().rejects }),
      scene: deps.scene,
      stationIds: deps.c12.tiles.map((tile) => tile.stationId),
    };
    if (deps.script === "c21") {
      await runC21Script({ ...flow, evidence: c20 as ReturnType<typeof createC21Evidence> });
    } else {
      await runC20Script(flow);
    }
    publishC20();
  } else if (deps.script === "c22") {
    await runC22Probe(deps);
  } else {
    for (const actorId of PROBE_ACTOR_IDS) {
      // C3 semantics: the second trigger first closes the learner's open
      // utterance, so it sends 3 intents (end, select, start) instead of 2.
      const learnerOpen = deps.getSessionLearnerSpeaking();
      await aimAndTrigger(actorId, learnerOpen ? 3 : 2);
    }
  }
}
