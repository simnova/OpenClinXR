/**
 * C2/C3 headset thin client: IWSDK-spike page that owns NO game state.
 *
 * - World: floor + two primitive actors (a1, a2) rendered with three.js.
 * - Networking: ONLY @openclinxr/xr-sync-client (pose + select-actor +
 *   utterance intents out, snapshots in).
 * - Input: head pose from XRFrame viewer poses, right-controller select from
 *   the WebXR session `select` event, both driven programmatically through
 *   IWER (emulated immersive-vr) when ?iwer=1.
 * - Rendering follows server state only: actor colour = f(server speaking),
 *   turn indicator = f(server turnOwner/speaking). No local intent state
 *   ever drives a mesh.
 * - Read-only evidence surface: window.__syncProbe (data only, no mutators).
 * - Scripts: ?script=c2 (default: head sweep, aim+trigger a1 then a2) or
 *   ?script=c3 (server-driven actor turn: select a1 once, then three
 *   utterance start/end pairs with a mid-turn interrupt, all waits on
 *   observed server state).
 */
import * as THREE from "three";
import { connect, type ConnectOptions, type EncounterSnapshot, type IntentKind, type SyncConnection } from "@openclinxr/xr-sync-client/headset";
import {
  BASE_ACTOR_COLOUR,
  BASE_TURN_COLOUR,
  PROBE_ACTOR_IDS,
  quantizePoseComponent,
  resolveActorColour,
  resolveTurnIndicatorColour,
  sweepYawDegrees,
  yawQuaternionDegrees,
} from "./probe-state.js";
import { C4MouthRender, type SyncProbeCueObservation } from "./probe-c4.js";
import { parseProbeQuery } from "./probe-query.js";

interface ProbePose {
  x: number;
  y: number;
  z: number;
  seq: number;
}

type NavigatorWithXr = Navigator & {
  xr?: {
    isSessionSupported(mode: string): Promise<boolean>;
    requestSession(mode: string, options?: { optionalFeatures?: string[] }): Promise<XRSession>;
  };
};

interface SyncProbeTurnObservation {
  turnId: number;
  replyId: string;
  speaking: boolean;
  atMs: number;
}

interface SyncProbeEvidence {
  sent: number;
  sentSeqs: number[];
  sentByKind: Record<string, number>;
  sentSeqsByKind: Record<string, number[]>;
  lastSentPose: ProbePose | null;
  acks: number;
  ackSeqs: number[];
  rejects: number;
  rejectDetails: Array<{ seq: number; reason: string }>;
  rttMs: number[];
  lastServerState: EncounterSnapshot | null;
  turnsObserved: SyncProbeTurnObservation[];
  /** C4 (turnId, cueId) appended when the SERVER's turn/cue changes. */
  cuesObserved: SyncProbeCueObservation[];
  /** C4 server emotion values appended when the SERVER's emotion changes. */
  emotionsObserved: string[];
  /** C4 frames with mouth amplitude > 0 while the server says silent (must stay 0). */
  mouthActiveWhileSilentFrames: number;
  /** C4 frames with mouth amplitude > 0 while the server says speaking. */
  mouthActiveSpeakingFrames: number;
  frameMs: number[];
  selectedLocal: string[];
  selectMisses: number;
  phase: string;
  done: boolean;
  error: string | null;
}

declare global {
  interface Window {
    __syncProbe?: SyncProbeEvidence;
  }
}

const POSE_INTERVAL_MS = 50;
const SCRIPT_TIMEOUT_MS = 100000;

const ACTOR_POSITIONS: Record<string, [number, number, number]> = {
  a1: [-0.9, 1.0, -2.0],
  a2: [0.9, 1.0, -2.0],
};

function createEvidence(): SyncProbeEvidence {
  return {
    sent: 0,
    sentSeqs: [],
    sentByKind: {},
    sentSeqsByKind: {},
    lastSentPose: null,
    acks: 0,
    ackSeqs: [],
    rejects: 0,
    rejectDetails: [],
    rttMs: [],
    lastServerState: null,
    turnsObserved: [],
    cuesObserved: [],
    emotionsObserved: [],
    mouthActiveWhileSilentFrames: 0,
    mouthActiveSpeakingFrames: 0,
    frameMs: [],
    selectedLocal: [],
    selectMisses: 0,
    phase: "boot",
    done: false,
    error: null,
  };
}

const probe = createEvidence();
window.__syncProbe = probe;

function setStatus(text: string): void {
  const element = document.querySelector("#sync-probe-status");
  if (element) {
    element.textContent = text;
  }
}

function fail(message: string): void {
  probe.error = message;
  probe.done = true;
  probe.phase = "failed";
  setStatus(`sync-probe failed: ${message}`);
}

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    if (condition()) {
      return;
    }
    if (performance.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function main(): Promise<void> {
  let query: ReturnType<typeof parseProbeQuery>;
  try {
    query = parseProbeQuery(window.location.search);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  const canvas = document.querySelector<HTMLCanvasElement>("#sync-probe-canvas");
  if (!canvas) {
    fail("missing #sync-probe-canvas");
    return;
  }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600, false);
  renderer.xr.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1715);
  const camera = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 50);
  camera.position.set(0, 1.6, 0);
  scene.add(camera);

  scene.add(new THREE.HemisphereLight(0xf0fff5, 0x17322c, 2.0));
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshStandardMaterial({ color: 0x3b554e, roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.name = "sync-probe.floor";
  scene.add(floor);

  const actorMeshes = new Map<string, THREE.Mesh>();
  for (const id of PROBE_ACTOR_IDS) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.9, 0.5),
      new THREE.MeshStandardMaterial({ color: BASE_ACTOR_COLOUR, roughness: 0.7 }),
    );
    const position = ACTOR_POSITIONS[id] ?? [0, 1, -2];
    mesh.position.set(position[0], position[1], position[2]);
    mesh.name = `sync-probe.actor.${id}`;
    mesh.userData["actorId"] = id;
    scene.add(mesh);
    actorMeshes.set(id, mesh);
  }

  // C3 turn indicator: one small marker above each actor, coloured ONLY by
  // server turn state (turnOwner + that actor's server speaking flag).
  const indicatorMeshes = new Map<string, THREE.Mesh>();
  for (const id of PROBE_ACTOR_IDS) {
    const indicator = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 16, 16),
      new THREE.MeshStandardMaterial({ color: BASE_TURN_COLOUR, roughness: 0.6 }),
    );
    const position = ACTOR_POSITIONS[id] ?? [0, 1, -2];
    indicator.position.set(position[0], position[1] + 0.75, position[2]);
    indicator.name = `sync-probe.turn.${id}`;
    scene.add(indicator);
    indicatorMeshes.set(id, indicator);
  }

  // C4 mouth bars: one thin bar per actor, rendered ONLY from server state.
  // Scale = page-local cue envelope amplitude for the server cueId, animated
  // only while the server says that actor is speaking; colour = pure function
  // of the server emotion. No local intent state ever drives the bar.
  const c4Mouth = new C4MouthRender(scene, PROBE_ACTOR_IDS, ACTOR_POSITIONS);

  let connection: SyncConnection;
  try {
    const options: ConnectOptions = { roomOptions: { actors: [...PROBE_ACTOR_IDS] } };
    connection = await connect(query.syncUrl, options);
  } catch (error) {
    fail(`connect failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  // Last observed (turnId, replyId, speaking) per actor: turnsObserved grows
  // only when the SERVER's values change. Read-only to the harness.
  const lastTurnSeen = new Map<string, { turnId: number; replyId: string; speaking: boolean }>();
  connection.onState((snapshot) => {
    probe.lastServerState = snapshot;
    const actors = (snapshot.actors ?? {}) as Record<
      string,
      { speaking?: unknown; replyId?: unknown; cueId?: unknown; emotion?: unknown } | undefined
    >;
    const turnOwner = typeof snapshot.turnOwner === "string" ? snapshot.turnOwner : "none";
    const turnId = typeof snapshot.turnId === "number" ? snapshot.turnId : 0;
    for (const [id, mesh] of actorMeshes) {
      const speaking = actors[id]?.speaking === true;
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.color.setHex(resolveActorColour(speaking));
      const indicator = indicatorMeshes.get(id);
      if (indicator) {
        const indicatorMaterial = indicator.material as THREE.MeshStandardMaterial;
        indicatorMaterial.color.setHex(resolveTurnIndicatorColour(turnOwner, speaking));
      }
      const replyId = typeof actors[id]?.replyId === "string" ? (actors[id]?.replyId as string) : "";
      const seen = lastTurnSeen.get(id);
      if (!seen || seen.turnId !== turnId || seen.replyId !== replyId || seen.speaking !== speaking) {
        lastTurnSeen.set(id, { turnId, replyId, speaking });
        probe.turnsObserved.push({ turnId, replyId, speaking, atMs: Number(performance.now().toFixed(2)) });
      }
    }
    // C4: cue + emotion follow the SERVER only.
    const delta = c4Mouth.observe(actors, turnId);
    probe.cuesObserved.push(...delta.cues);
    probe.emotionsObserved.push(...delta.emotions);
  });

  // Sequential intent queue: arrival order == call order == seq order, so every
  // sent seq is acked in order on a healthy server.
  let callIndex = 0;
  let tail: Promise<void> = Promise.resolve();
  probe.phase = "connected";
  setStatus("sync-probe connected, waiting for session");

  function enqueueIntent(kind: IntentKind, payload: Record<string, unknown>): void {
    callIndex += 1;
    const seq = callIndex;
    if (kind === "pose") {
      const pose = payload as { x: number; y: number; z: number };
      probe.lastSentPose = { x: pose.x, y: pose.y, z: pose.z, seq };
    }
    probe.sent += 1;
    probe.sentSeqs.push(seq);
    probe.sentByKind[kind] = (probe.sentByKind[kind] ?? 0) + 1;
    (probe.sentSeqsByKind[kind] ??= []).push(seq);
    tail = tail.then(async () => {
      try {
        const result = await connection.sendIntent(kind, payload);
        if (result.status === "ack") {
          probe.acks += 1;
          probe.ackSeqs.push(result.seq);
          probe.rttMs.push(Number(result.rttMs.toFixed(2)));
        } else {
          probe.rejects += 1;
          probe.rejectDetails.push({ seq: result.seq, reason: result.reason });
        }
      } catch (error) {
        probe.rejects += 1;
        probe.rejectDetails.push({
          seq,
          reason: `send-failed:${error instanceof Error ? error.message : String(error)}`.slice(0, 120),
        });
      }
    });
  }

  let latestViewerPosition: { x: number; y: number; z: number } | null = null;
  let lastPoseSendAt = 0;
  let referenceSpace: XRReferenceSpace | null = null;
  let presenting = false;
  let poseStreaming = true;

  function onSelectEvent(event: Event): void {
    const source = (event as XRInputSourceEvent).inputSource;
    if (source?.handedness !== "right") {
      return;
    }
    const aim = commandedAim;
    if (!aim) {
      probe.selectMisses += 1;
      return;
    }
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(aim.origin.x, aim.origin.y, aim.origin.z),
      new THREE.Vector3(aim.direction.x, aim.direction.y, aim.direction.z).normalize(),
    );
    const hits = raycaster.intersectObjects([...actorMeshes.values()], false);
    const actorId = (hits[0]?.object.userData as { actorId?: unknown } | undefined)?.actorId;
    if (typeof actorId !== "string" || !actorMeshes.has(actorId)) {
      probe.selectMisses += 1;
      return;
    }
    probe.selectedLocal.push(actorId);
    if (query.script === "c3") {
      // C3 mode: select-actor ONLY. Utterance intents come from the scripted
      // turn sequence below, never from the trigger.
      enqueueIntent("select-actor", { actorId });
      return;
    }
    // C2 mode under C3 turn semantics: a new selection first closes the
    // learner's open utterance (if the server says one is open) so the server
    // can reply to the previous actor, then selects and starts the next.
    // Driver actions (sweep, two triggers) are unchanged from C2.
    const sessionLearner = probe.lastServerState?.learners?.[connection.sessionId];
    if (sessionLearner?.speaking === true) {
      enqueueIntent("utterance-end", {});
    }
    enqueueIntent("select-actor", { actorId });
    enqueueIntent("utterance-start", {});
  }

  let commandedAim: { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } } | null = null;
  let xrSession: XRSession | null = null;

  let lastFrameAt = performance.now();
  renderer.setAnimationLoop((time: number, frame?: XRFrame | null) => {
    const now = performance.now();
    probe.frameMs.push(Number((now - lastFrameAt).toFixed(2)));
    lastFrameAt = now;
    // C4 mouth animation: amplitude is a pure function of the SERVER's
    // (cueId, speaking) for each actor. A local utterance state must never
    // move the bar: the resolver returns 0 whenever server speaking is
    // false, so any local drive would surface as
    // mouthActiveWhileSilentFrames > 0.
    const serverActors = (probe.lastServerState?.actors ?? {}) as Record<
      string,
      { speaking?: unknown; cueId?: unknown } | undefined
    >;
    c4Mouth.update(serverActors, now);
    probe.mouthActiveWhileSilentFrames = c4Mouth.silentFrames;
    probe.mouthActiveSpeakingFrames = c4Mouth.speakingFrames;
    if (presenting && poseStreaming && frame && referenceSpace) {
      const viewerPose = frame.getViewerPose(referenceSpace);
      const position = viewerPose?.transform.position;
      if (position) {
        latestViewerPosition = { x: position.x, y: position.y, z: position.z };
        if (now - lastPoseSendAt >= POSE_INTERVAL_MS) {
          lastPoseSendAt = now;
          enqueueIntent("pose", {
            x: quantizePoseComponent(position.x),
            y: quantizePoseComponent(position.y),
            z: quantizePoseComponent(position.z),
          });
        }
      }
    }
    renderer.render(scene, camera);
    void time;
  });

  if (!query.useIwer) {
    probe.phase = "flat-preview";
    setStatus("sync-probe flat preview (no XR session without ?iwer=1)");
    return;
  }

  probe.phase = "script";
  const scriptTimeout = setTimeout(() => {
    if (!probe.done) {
      fail("script timeout: driver did not finish in time");
    }
  }, SCRIPT_TIMEOUT_MS);

  try {
    const iwer = await import("iwer");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const device = new iwer.XRDevice(iwer.metaQuest3, { canvasContainer: container });
    // Host: refuse to run against a real runtime (emulation only). Quest mode
    // (?forceIwer=1) explicitly installs the emulator over the native runtime
    // so root runs the identical deterministic script on-device; this is still
    // IWER emulation, never a native Quest runtime claim.
    if (!query.forceIwer && device.isNativeXRAvailable() !== false) {
      throw new Error("native XR runtime present; refusing to run emulated probe");
    }
    device.installRuntime(query.forceIwer ? { forceInstall: true } : undefined);
    const navigatorWithXr = navigator as NavigatorWithXr;
    if (!navigatorWithXr.xr) {
      throw new Error("navigator.xr unavailable after IWER installRuntime");
    }
    const supported = await navigatorWithXr.xr.isSessionSupported("immersive-vr");
    if (!supported) {
      throw new Error("immersive-vr unsupported after installRuntime");
    }
    const session = await navigatorWithXr.xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor"],
    });
    xrSession = session;
    session.addEventListener("select", onSelectEvent as EventListener);
    const space = await session.requestReferenceSpace("local-floor");
    referenceSpace = space;
    await renderer.xr.setSession(session);
    presenting = true;
    setStatus("sync-probe in emulated immersive-vr");

    await waitFor(
      () => probe.lastServerState?.actors?.["a1"] !== undefined && probe.lastServerState?.actors?.["a2"] !== undefined,
      15000,
      "probe actors in snapshot",
    );

    const rci = device.remote;
    await rci.dispatch("set_connected", { device: "controller-right", connected: true });

    // Fixed script part 1: head yaw sweep 0 -> +30 -> -30 -> 0 over 6 s.
    const SWEEP_STEPS = 120;
    for (let step = 0; step < SWEEP_STEPS; step += 1) {
      const yaw = sweepYawDegrees(step * 50);
      const quat = yawQuaternionDegrees(yaw);
      device.quaternion.set(quat.x, quat.y, quat.z, quat.w);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Fixed script part 2: aim right controller at each actor and pull trigger.
    async function aimAndTrigger(actorId: string, expectedIntents: number): Promise<void> {
      const center = ACTOR_POSITIONS[actorId] ?? [0, 1, -2];
      await rci.dispatch("look_at", {
        device: "controller-right",
        target: { x: center[0], y: center[1], z: center[2] },
      });
      const transform = (await rci.dispatch("get_transform", {
        device: "controller-right",
      })) as { position: { x: number; y: number; z: number }; orientation: { x: number; y: number; z: number; w: number } };
      const aimQuat = new THREE.Quaternion(
        transform.orientation.x,
        transform.orientation.y,
        transform.orientation.z,
        transform.orientation.w,
      );
      const aimDir = new THREE.Vector3(0, 0, -1).applyQuaternion(aimQuat);
      commandedAim = {
        origin: { x: transform.position.x, y: transform.position.y, z: transform.position.z },
        direction: { x: aimDir.x, y: aimDir.y, z: aimDir.z },
      };
      const expectedAcks = probe.sent + expectedIntents;
      await rci.dispatch("_select_press", { device: "controller-right" });
      await new Promise((resolve) => setTimeout(resolve, 600));
      await rci.dispatch("_select_release", { device: "controller-right" });
      await new Promise((resolve) => setTimeout(resolve, 400));
      await waitFor(() => probe.acks + probe.rejects >= expectedAcks, 10000, `select intents for ${actorId}`);
    }

    // One intent through the sequential queue; resolves once it is acked/rejected.
    async function sendIntentAndSettle(kind: IntentKind, payload: Record<string, unknown>): Promise<void> {
      const target = probe.sent + 1;
      enqueueIntent(kind, payload);
      await waitFor(() => probe.acks + probe.rejects >= target, 15000, `${kind} settled`);
    }

    const observedTurn = (): { turnId: number; owner: string; a1Speaking: boolean } => {
      const state = probe.lastServerState;
      return {
        turnId: typeof state?.turnId === "number" ? state.turnId : -1,
        owner: typeof state?.turnOwner === "string" ? state.turnOwner : "",
        a1Speaking: state?.actors?.["a1"]?.speaking === true,
      };
    };

    if (query.script === "c3") {
      // C3 script: select a1 ONCE via trigger (select-actor only in c3 mode),
      // then three learner utterance pairs. The interrupt waits on observed
      // server state: turn 2 must be speaking before the interrupting start.
      setStatus("sync-probe c3 turn script");
      await aimAndTrigger("a1", 1);

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
    } else {
      for (const actorId of PROBE_ACTOR_IDS) {
        // C3 semantics: the second trigger first closes the learner's open
        // utterance, so it sends 3 intents (end, select, start) instead of 2.
        const learnerOpen = probe.lastServerState?.learners?.[connection.sessionId]?.speaking === true;
        await aimAndTrigger(actorId, learnerOpen ? 3 : 2);
      }
    }

    // Fixed script ends: stop the pose stream FIRST so the tail is deterministic,
    // then drain every in-flight intent and wait for the server to catch up.
    poseStreaming = false;
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Drain: every sent intent settled, server learner caught up to the last seq.
    await waitFor(() => probe.sent > 0 && probe.acks + probe.rejects >= probe.sent, 15000, "intent drain");
    const finalSeq = probe.sent;
    await waitFor(
      () => probe.lastServerState?.learners?.[connection.sessionId]?.lastSeq === finalSeq,
      10000,
      "server learner caught up",
    );

    probe.phase = "complete";
    setStatus("sync-probe script complete");
    try {
      await session.end();
    } catch {
      // Session teardown is best-effort; evidence is already collected.
    }
    presenting = false;
    probe.done = true;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(scriptTimeout);
  }

  void xrSession;
}

void main().catch((error: unknown) => {
  if (!probe.done) {
    probe.error = error instanceof Error ? error.message : String(error);
    probe.phase = "failed";
    probe.done = true;
    setStatus(`sync-probe failed: ${probe.error}`);
  }
});
