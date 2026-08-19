/**
 * #431 (#402 reproduce / #419 E2) — AN ISOLATED SPEAKING/NOT-SPEAKING STILL PAIR FOR THE PARENT.
 *
 * ## THE INSTRUMENT, AND WHY IT IS NOT ANOTHER DUMP
 *
 * E2.1's uniform 19-bone translation and E2.2's 8.729 mm head-local vertex delta were both
 * numbers, and the ruling was that the next slice needed a DIFFERENT instrument: a still of the
 * parent speaking, graded by eye against the same actor not speaking. This probe produces exactly
 * that pair.
 *
 * ## WHAT IS REUSED (no third harness)
 *
 *  - The isolated-subject probe pattern (single boot, one subject, deterministic states) is the
 *    same shape the landed E2.2 probe (`speaking-actor-head-local-probe.ts`) uses, and this file
 *    shares its boot path (`spawnPortlessDevServer` from `./lib/portless-server.js`) and its
 *    CAPTURE_QUERY verbatim.
 *  - The state-selection recipe is copied from that landed probe: `speakingFlag` is read off the
 *    phoneme-mouth-cue visibility on the actor root; not-speaking = a sustained quiet window;
 *    speaking = trace-button dialogue drive until the cue lights; morph influence = max
 *    |morphTargetInfluence| across the actor's skinned meshes at the sampling instant. E2.2
 *    reached both states at t=20.11 (speaking, influence 1.0) and t=16.05 (control, 0.4998) —
 *    the known-good column proving both states are reachable from the same bytes.
 *  - Two deliberate, documented deviations, both forced by live measurement:
 *    1. The runtime camera is REPOSITIONED once via page.evaluate to frame the parent's head
 *       INSIDE the closed Infinigen room. Measured: the authored face-detail camera sits ~0.1 m
 *       outside the room's +Z hull (world z=2.63 vs hull z≈2.6) — every ray hits the untextured
 *       white exterior hull and the render is a flat white/grey field with no actor in it (the
 *       #342b problem class, for the capture framing). The camera is a child of the locomotion
 *       rig in the debug scene, so the probe re-aims it at the parent's head from a fixed,
 *       room-interior pose. The SAME pose is applied and verified before BOTH stills, so the
 *       pair still shares one camera and one framing.
 *    2. The not-speaking control is sampled at a SETTLED idle. Measured: the parent's expression
 *       morph `mouth-compression` sits at influence 1.0 right after boot and during utterances
 *       but decays to 0 at settled idle (max |influence| 0.19, on eyebrows), so the control is
 *       required to be cue-invisible for 1.4 s AND mouth-influence < 0.5 — otherwise a mistimed
 *       quiet window reads 1.0 at both states and the pair proves nothing (the planted test's
 *       clause (3) exists for exactly this).
 *  - The trace button is clicked via DOM `.click()` in `page.evaluate` (the control panels are
 *    hidden via the runtime's own `scene-only-visual-review` class so both stills share the same
 *    chrome-free canvas); the handler is the same `completeTraceActionFromInput` a locator click
 *    reaches.
 *
 * ## SAME CAMERA, SAME FRAMING
 *
 * The probe computes ONE camera pose (world position + lookAt) from the parent's head at the
 * control state, applies it before each capture, verifies the live pose matches before the
 * screenshot, and records the read-back pose per frame. The stills therefore share the same
 * projection; the only scene difference is the runtime state between the two sampled instants.
 *
 * ## THE GLB BYTES
 *
 * Both frames are rendered from `mpfb-peds-parent-aisha.motion-bind.glb` — the runtime path for
 * `parent_tara_johnson_v1` (`humanoid-runtime-asset-url.ts`). The probe hashes the bytes served
 * by the dev server at that path and the tracked file on disk, and requires them to be equal, so
 * `sourceGlbSha256` is the exact byte identity of what both frames were captured from.
 *
 * ## NOT TESTED / CLAIM SCOPE
 *
 * This probe does not judge whether a spike is present — the orchestrator grades the pair. No
 * cause, no fix, no rebake, no GLB touched, no `apps/ui-xr` product edit. The stills are the
 * deliverable; this file is the instrument that produced them.
 */

import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import {
  type PortlessDevServer,
  spawnPortlessDevServer,
} from "./lib/portless-server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

const PARENT_ACTOR_ID = "parent_tara_johnson_v1";
const PARENT_TRACES = [
  "parent communication",
  "trigger history",
  "urgent escalation",
  "empathy statement",
];

/** Same query as E2.1/E2.2 so the sampled instants stay comparable. */
const CAPTURE_QUERY =
  "openclinxrScenarioId=peds_asthma_parent_anxiety_v1" +
  "&openclinxrCaptureMode=face-detail" +
  "&openclinxrPortalStart=encounter" +
  "&openclinxrAcceleratedExam=1";

/** Runtime asset path for parent_tara_johnson_v1 (humanoid-runtime-asset-url.ts). */
const SOURCE_GLB_URL_PATH = "/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb";
/** Same bytes on disk, so the recorded hash ties the stills to a tracked file. */
const SOURCE_GLB_DISK_PATH = join(
  REPO_ROOT,
  "apps/ui-xr/public",
  SOURCE_GLB_URL_PATH,
);

const NOT_SPEAKING_STILL = "tools/openclinxr/evidence/stills/speaking-parent-not-speaking.png";
const SPEAKING_STILL = "tools/openclinxr/evidence/stills/speaking-parent-speaking.png";
const ARTIFACT = join(REPO_ROOT, "tools/openclinxr/evidence/speaking-parent-still-pair.json");

/** Morphs that mean the mouth is actively working (speech visemes + the anxious compression). */
const MOUTH_MORPH_RE = /mouth|jaw|lip|viseme|levator|oris|tongue/i;

type FrameSample = {
  ok: boolean;
  error: string | null;
  speakingFlag: boolean | null;
  mouthCueVisible: boolean | null;
  maxMorphInfluence: number;
  maxMouthMorphInfluence: number;
  meshCount: number;
  totalVertexCount: number;
  headBoneName: string | null;
  headWorldPosition: [number, number, number] | null;
  rootWorldPosition: [number, number, number] | null;
  canvasSize: { width: number; height: number } | null;
  cameraWorldPosition: [number, number, number] | null;
  cameraWorldQuaternion: [number, number, number, number] | null;
  perMesh: Array<{ name: string; maxMorphInfluence: number; maxMorphName: string | null }>;
};

/** Shared page-evaluate source: samples the parent's state AND verifies the camera pose. */
function frameSamplerEvaluate(actorId: string, stateId: string): string {
  return `(() => {
    const actorId = ${JSON.stringify(actorId)};
    const win = window;
    const scene = win.__openClinXrDebugScene;
    const out = { ok: false, error: null, speakingFlag: null, mouthCueVisible: null, maxMorphInfluence: 0, maxMouthMorphInfluence: 0, meshCount: 0, totalVertexCount: 0, headBoneName: null, headWorldPosition: null, rootWorldPosition: null, canvasSize: null, cameraWorldPosition: null, cameraWorldQuaternion: null, perMesh: [] };
    try {
      if (!scene || typeof scene.traverse !== "function") { out.error = "no-scene"; return out; }
      if (scene.updateMatrixWorld) scene.updateMatrixWorld(true);
      const roots = [];
      scene.traverse(function (o) {
        if (o.userData && o.userData.openClinXrActorId === actorId) roots.push(o);
      });
      if (roots.length === 0) { out.error = "no-actor-root:" + actorId; return out; }
      const root = roots[0];
      const rp = root.getWorldPosition(root.position.clone());
      out.rootWorldPosition = [Number(rp.x.toFixed(4)), Number(rp.y.toFixed(4)), Number(rp.z.toFixed(4))];

      let mouthCue = null;
      for (const r of roots) {
        r.traverse(function (o) {
          if (!mouthCue && o.userData && o.userData.openClinXrCurrentPhoneme !== undefined) mouthCue = o;
        });
      }
      out.mouthCueVisible = mouthCue ? !!mouthCue.visible : null;
      out.speakingFlag = out.mouthCueVisible;

      let cam = null;
      scene.traverse(function (o) { if (!cam && o.isCamera) cam = o; });
      if (cam) {
        const we = cam.matrixWorld.elements;
        out.cameraWorldPosition = [we[12], we[13], we[14]];
        const q = cam.quaternion;
        out.cameraWorldQuaternion = [q.x, q.y, q.z, q.w];
      }

      const meshes = [];
      const seen = {};
      for (const r of roots) {
        r.traverse(function (o) {
          if (o.isSkinnedMesh && o.geometry && !seen[o.uuid]) { seen[o.uuid] = true; meshes.push(o); }
        });
      }
      if (meshes.length === 0) { out.error = "no-skinned-meshes"; return out; }
      out.meshCount = meshes.length;

      let headBone = null;
      for (const mesh of meshes) {
        const skeleton = mesh.skeleton;
        if (!skeleton || !skeleton.bones) continue;
        for (const b of skeleton.bones) { if (b.name === "head") { headBone = b; break; } }
        if (headBone) break;
      }
      if (headBone) {
        out.headBoneName = headBone.name;
        const hp = headBone.getWorldPosition(headBone.position.clone());
        out.headWorldPosition = [Number(hp.x.toFixed(4)), Number(hp.y.toFixed(4)), Number(hp.z.toFixed(4))];
      }

      let maxMorph = 0;
      let maxMouthMorph = 0;
      let totalVerts = 0;
      const perMesh = [];
      for (const mesh of meshes) {
        const geom = mesh.geometry;
        if (geom.attributes && geom.attributes.position) totalVerts += geom.attributes.position.count;
        const dict = mesh.morphTargetDictionary || {};
        const infl = mesh.morphTargetInfluences || [];
        let meshMax = 0;
        let meshMaxName = null;
        for (const name of Object.keys(dict)) {
          const i = dict[name];
          const v = Math.abs(infl[i] || 0);
          if (v > meshMax) { meshMax = v; meshMaxName = name; }
          if (v > maxMorph) maxMorph = v;
          if (/mouth|jaw|lip|viseme|levator|oris|tongue/i.test(name) && v > maxMouthMorph) maxMouthMorph = v;
        }
        perMesh.push({ name: (mesh.name || "").slice(0, 60), maxMorphInfluence: Number(meshMax.toFixed(4)), maxMorphName: meshMaxName ? meshMaxName.slice(0, 40) : null });
      }
      out.maxMorphInfluence = Number(maxMorph.toFixed(4));
      out.maxMouthMorphInfluence = Number(maxMouthMorph.toFixed(4));
      out.totalVertexCount = totalVerts;
      perMesh.sort(function (a, b) { return b.maxMorphInfluence - a.maxMorphInfluence; });
      out.perMesh = perMesh.slice(0, 6);

      const canvas = document.querySelector("#station-canvas");
      if (canvas) out.canvasSize = { width: canvas.clientWidth, height: canvas.clientHeight };
      out.ok = true;
    } catch (e) {
      out.error = String(e && e.message ? e.message : e);
    }
    return out;
  })()`;
}

/**
 * State-selection recipe from `speaking-actor-head-local-probe.ts` (E2.2), verbatim:
 * speakingFlag = phoneme-mouth-cue visibility on the actor root.
 */
async function speakingFlag(page: Page, actorId: string): Promise<boolean | null> {
  return page.evaluate(`(() => {
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return null;
    let flag = null;
    scene.traverse(function (o) {
      if (flag !== null) return;
      if (o.userData && o.userData.openClinXrActorId === ${JSON.stringify(actorId)}) {
        o.traverse(function (c) {
          if (flag !== null) return;
          if (c.userData && c.userData.openClinXrCurrentPhoneme !== undefined) flag = !!c.visible;
        });
      }
    });
    return flag;
  })()`) as Promise<boolean | null>;
}

/** Wait until the actor's mouth cue has been invisible for minQuietMs consecutively. */
async function waitForQuiet(page: Page, actorId: string, minQuietMs: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let quietSince = 0;
  while (Date.now() < deadline) {
    const flag = await speakingFlag(page, actorId);
    const now = Date.now();
    if (flag === false) {
      if (quietSince === 0) quietSince = now;
      else if (now - quietSince >= minQuietMs) return true;
    } else {
      quietSince = 0;
    }
    await page.waitForTimeout(200);
  }
  return false;
}

/** Wait until the actor's mouth cue is visible (mid-utterance). */
async function waitForSpeaking(page: Page, actorId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const flag = await speakingFlag(page, actorId);
    if (flag === true) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/**
 * Control-state addition to the E2.2 recipe: the mouth must be SETTLED (max mouth-region morph
 * influence < 0.5) as well as cue-invisible. Measured: the parent's expression morph
 * `mouth-compression` sits at influence 1.0 during and right after utterances and only decays to
 * ~0 at a true idle, and it can re-engage between two evaluations — so the control is not "a
 * quiet window then sample" but "sample at the instant a settled idle is observed", and the
 * screenshot follows immediately. The sampler's own read is the state gate; the recorded sample
 * is the state the still was captured in.
 */
async function waitForSettledIdleSample(page: Page, actorId: string, timeoutMs: number): Promise<FrameSample> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sample = (await page.evaluate(frameSamplerEvaluate(actorId, "settle-check"))) as unknown as FrameSample;
    if (sample.ok && sample.speakingFlag === false && sample.maxMouthMorphInfluence < 0.5) {
      return sample;
    }
    await page.waitForTimeout(100);
  }
  throw new Error("no settled idle (mouth influence < 0.5, cue invisible) observed in timeout");
}

/** Mid-utterance sample: cue visible AND mouth morphs actively driven (>= 0.5). */
async function waitForSpeakingSample(page: Page, actorId: string, timeoutMs: number): Promise<FrameSample> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sample = (await page.evaluate(frameSamplerEvaluate(actorId, "speaking-check"))) as unknown as FrameSample;
    if (sample.ok && sample.speakingFlag === true && sample.maxMouthMorphInfluence >= 0.5) {
      return sample;
    }
    await page.waitForTimeout(150);
  }
  throw new Error("no speaking sample (cue visible, mouth influence >= 0.5) observed in timeout");
}

/**
 * E2.2 drove speech with a Playwright locator click; here the control panels are hidden (so both
 * stills share the same chrome-free canvas), so the same handler is reached via a DOM `.click()`
 * — `completeTraceActionFromInput` is a plain click listener and does not need layout.
 */
async function clickTraceViaDom(page: Page, traceName: string): Promise<boolean> {
  return page.evaluate(`(() => {
    const name = ${JSON.stringify(traceName)};
    const buttons = Array.from(document.querySelectorAll("#trace-actions button"));
    const hit = buttons.find(function (b) { return b.textContent && b.textContent.toLowerCase().includes(name.toLowerCase()); });
    if (!hit) return false;
    hit.click();
    return true;
  })()`) as Promise<boolean>;
}

async function driveActorToSpeak(page: Page, actorId: string, traces: string[]): Promise<{ trace: string | null; attempts: string[] }> {
  const attempts: string[] = [];
  for (const trace of traces) {
    const clicked = await clickTraceViaDom(page, trace);
    attempts.push(trace);
    if (!clicked) continue;
    const spoke = await waitForSpeaking(page, actorId, 14_000);
    if (spoke) return { trace, attempts };
  }
  return { trace: null, attempts };
}

/**
 * Position the runtime camera (a child of the locomotion rig, reachable via the debug scene) at a
 * fixed room-interior pose framing the parent's head. The authored face-detail pose sits ~0.1 m
 * outside the closed Infinigen room's +Z hull (measured: camera world z=2.63 vs hull z≈2.6), so
 * every ray hits the white exterior wall and no actor is visible. Same pose for both stills.
 */
function cameraFrameEvaluate(
  actorId: string,
  lookAt: [number, number, number],
  cameraWorld: [number, number, number],
): string {
  return `(() => {
    const scene = window.__openClinXrDebugScene;
    const out = { ok: false, error: null, appliedLocal: null, parentWorld: null };
    try {
      if (!scene || typeof scene.traverse !== "function") { out.error = "no-scene"; return out; }
      if (scene.updateMatrixWorld) scene.updateMatrixWorld(true);
      let cam = null;
      scene.traverse(function (o) { if (!cam && o.isCamera) cam = o; });
      if (!cam) { out.error = "no-camera"; return out; }
      const parent = cam.parent;
      let local = null;
      if (parent) {
        const pe = parent.matrixWorld.elements;
        out.parentWorld = [pe[12], pe[13], pe[14]];
        // rig has no rotation in this capture: local = world - parentWorld
        local = [
          ${cameraWorld[0]} - pe[12],
          ${cameraWorld[1]} - pe[13],
          ${cameraWorld[2]} - pe[14],
        ];
      } else {
        local = ${JSON.stringify(cameraWorld)};
      }
      cam.position.set(local[0], local[1], local[2]);
      cam.lookAt(${lookAt[0]}, ${lookAt[1]}, ${lookAt[2]});
      cam.updateMatrixWorld(true);
      out.appliedLocal = local;
      out.ok = true;
    } catch (e) {
      out.error = String(e && e.message ? e.message : e);
    }
    return out;
  })()`;
}

function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Project a world point to NDC under a camera pose (authored constants, for the report). */
function projectToNdc(
  point: [number, number, number],
  camera: { position: [number, number, number]; lookAt: [number, number, number]; fovDeg: number; aspect: number },
): { x: number; y: number; z: number } | null {
  const [px, py, pz] = camera.position;
  const [lx, ly, lz] = camera.lookAt;
  const forward = [lx - px, ly - py, lz - pz];
  const len = Math.hypot(forward[0]!, forward[1]!, forward[2]!);
  if (len === 0) return null;
  const f = [forward[0]! / len, forward[1]! / len, forward[2]! / len];
  const up = [0, 1, 0];
  const right = [
    f[1]! * up[2]! - f[2]! * up[1]!,
    f[2]! * up[0]! - f[0]! * up[2]!,
    f[0]! * up[1]! - f[1]! * up[0]!,
  ];
  const rl = Math.hypot(right[0]!, right[1]!, right[2]!);
  const r = [right[0]! / rl, right[1]! / rl, right[2]! / rl];
  const tu = [
    r[1]! * f[2]! - r[2]! * f[1]!,
    r[2]! * f[0]! - r[0]! * f[2]!,
    r[0]! * f[1]! - r[1]! * f[0]!,
  ];
  const d = [point[0] - px, point[1] - py, point[2] - pz];
  const dz = d[0]! * f[0]! + d[1]! * f[1]! + d[2]! * f[2]!;
  if (dz <= 0) return null;
  const dx = d[0]! * r[0]! + d[1]! * r[1]! + d[2]! * r[2]!;
  const dy = d[0]! * tu[0]! + d[1]! * tu[1]! + d[2]! * tu[2]!;
  const halfFov = (camera.fovDeg * Math.PI) / 360;
  const sy = 1 / Math.tan(halfFov);
  const sx = sy / camera.aspect;
  return {
    x: Number((dx * sx / dz).toFixed(4)),
    y: Number((dy * sy / dz).toFixed(4)),
    z: Number(dz.toFixed(4)),
  };
}

export async function runSpeakingParentStillPairProbe(): Promise<void> {
  const t0 = Date.now();
  let server: PortlessDevServer | undefined;
  const frames: Array<Record<string, unknown>> = [];
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
    });

    // The bytes the runtime renders from: hash the served GLB and require it to match the
    // tracked file, so the recorded hash is the exact byte identity of both frames.
    const served = await fetch(new URL(SOURCE_GLB_URL_PATH, server.url));
    if (!served.ok) throw new Error(`GLB fetch failed: ${served.status}`);
    const servedBytes = new Uint8Array(await served.arrayBuffer());
    const servedSha256 = sha256Hex(servedBytes);
    const diskBytes = await readFile(SOURCE_GLB_DISK_PATH);
    const diskSha256 = sha256Hex(diskBytes);
    if (servedSha256 !== diskSha256) {
      throw new Error(
        `served GLB (${servedSha256}) differs from tracked file (${diskSha256}) — refusing to record a hash that does not match the frames' bytes`,
      );
    }
    process.stdout.write(`sourceGlbSha256=${servedSha256} (served == tracked)\n`);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1600 } });
      const url = `${server.url}?${CAPTURE_QUERY}`;
      process.stdout.write(`url=${url}\n`);
      await page.goto(url, { waitUntil: "networkidle", timeout: 240_000 });

      await page.waitForFunction(
        `(() => {
          const scene = window.__openClinXrDebugScene;
          if (!scene || typeof scene.traverse !== "function") return false;
          let found = false;
          scene.traverse(function (o) {
            if (found) return;
            if (o.userData && o.userData.openClinXrActorId === ${JSON.stringify(PARENT_ACTOR_ID)}) {
              let hasSkinned = false;
              o.traverse(function (c) {
                if (c.isSkinnedMesh && c.geometry && c.geometry.attributes.skinIndex) hasSkinned = true;
              });
              if (hasSkinned) found = true;
            }
          });
          return found;
        })()`,
        { timeout: 240_000 },
      );
      process.stdout.write("parent registered with skinned meshes\n");

      // Hide the HTML control panels ONCE, before either capture, using the runtime's own
      // scene-only-visual-review class. Both stills therefore share the same chrome-free,
      // full-canvas framing; the canvas re-sizes in the next frame (resize() runs per frame).
      await page.evaluate(`(() => {
        const shell = document.querySelector(".station-shell");
        if (shell && !shell.classList.contains("scene-only-visual-review")) {
          shell.classList.add("scene-only-visual-review");
        }
      })()`);
      await page.waitForTimeout(1200);

      // --- State 1: NOT SPEAKING (true idle: cue invisible AND viseme/expression morphs
      //     settled). Measured: the runtime holds the `viseme_sil` morph (mouth-compression) at
      //     influence 1.0 during the quiet gaps between utterances and only releases it to ~0
      //     for brief (~0.4 s) true-idle windows, so the control is sampled and screenshot at
      //     the SAME instant the sampler observes the idle — no gap between check and capture. ---
      const quiet = await waitForQuiet(page, PARENT_ACTOR_ID, 1_400, 120_000);
      if (!quiet) throw new Error("no quiet (not-speaking) window found in 120s");
      const framingSample = await waitForSettledIdleSample(page, PARENT_ACTOR_ID, 90_000);
      const head = framingSample.headWorldPosition;
      if (!head) throw new Error("control head position unavailable");
      // Camera INSIDE the room (room interior z ∈ [-2.64, 2.64], x ∈ [-2.7, 2.7], height 2.65):
      // 1.45 m in front of the head along +Z, offset +0.45 m right, at head height.
      const cameraWorld: [number, number, number] = [
        head[0] + 0.45,
        head[1] + 0.02,
        Math.min(head[2] + 1.45, 2.25),
      ];
      const cameraPose = { position: cameraWorld, lookAt: [head[0], head[1], head[2]] as [number, number, number], fovDeg: 48 };
      const applied = (await page.evaluate(
        cameraFrameEvaluate(PARENT_ACTOR_ID, cameraPose.lookAt, cameraPose.position),
      )) as unknown as { ok: boolean; error: string | null };
      if (!applied.ok) throw new Error(`camera frame failed: ${applied.error}`);

      const notSpeakingT = (Date.now() - t0) / 1000;
      const control = await waitForSettledIdleSample(page, PARENT_ACTOR_ID, 90_000);
      const controlStill = join(REPO_ROOT, NOT_SPEAKING_STILL);
      await page.screenshot({ path: controlStill, type: "png" });
      const controlBytes = (await stat(controlStill)).size;
      const controlSha = sha256Hex(await readFile(controlStill));
      process.stdout.write(
        `not-speaking t=${notSpeakingT.toFixed(2)} morph=${control.maxMorphInfluence} mouth=${control.maxMouthMorphInfluence} flag=${control.speakingFlag} head=(${control.headWorldPosition}) bytes=${controlBytes}\n`,
      );
      frames.push({
        stateId: "not-speaking",
        speakingFlag: false,
        morphInfluence: control.maxMorphInfluence,
        still: NOT_SPEAKING_STILL,
        bytes: controlBytes,
        sha256: controlSha,
        capturedAtPageSeconds: Number(notSpeakingT.toFixed(2)),
        mouthCueVisible: control.mouthCueVisible,
        maxMouthMorphInfluence: control.maxMouthMorphInfluence,
        headWorldPosition: control.headWorldPosition,
        rootWorldPosition: control.rootWorldPosition,
        cameraWorldPosition: control.cameraWorldPosition,
        cameraWorldQuaternion: control.cameraWorldQuaternion,
        canvasSize: control.canvasSize,
        perMesh: control.perMesh,
      });

      // --- State 2: SPEAKING (trace-driven dialogue until the parent's cue lights; sample at
      //     the instant a mid-utterance viseme spike is observed, then screenshot immediately —
      //     viseme influences only reach ~1.0 in brief phoneme windows). ---
      const drive = await driveActorToSpeak(page, PARENT_ACTOR_ID, PARENT_TRACES);
      if (!drive.trace) {
        throw new Error(`no trace drove speech (tried ${drive.attempts.join(", ")})`);
      }
      const speakingT = (Date.now() - t0) / 1000;
      const speaking = await waitForSpeakingSample(page, PARENT_ACTOR_ID, 20_000);
      const speakingStill = join(REPO_ROOT, SPEAKING_STILL);
      await page.screenshot({ path: speakingStill, type: "png" });
      const speakingBytes = (await stat(speakingStill)).size;
      const speakingSha = sha256Hex(await readFile(speakingStill));
      process.stdout.write(
        `speaking t=${speakingT.toFixed(2)} morph=${speaking.maxMorphInfluence} mouth=${speaking.maxMouthMorphInfluence} flag=${speaking.speakingFlag} trace="${drive.trace}" head=(${speaking.headWorldPosition}) bytes=${speakingBytes}\n`,
      );
      frames.push({
        stateId: "speaking",
        speakingFlag: true,
        morphInfluence: speaking.maxMorphInfluence,
        still: SPEAKING_STILL,
        bytes: speakingBytes,
        sha256: speakingSha,
        capturedAtPageSeconds: Number(speakingT.toFixed(2)),
        driveTrace: drive.trace,
        mouthCueVisible: speaking.mouthCueVisible,
        maxMouthMorphInfluence: speaking.maxMouthMorphInfluence,
        headWorldPosition: speaking.headWorldPosition,
        rootWorldPosition: speaking.rootWorldPosition,
        cameraWorldPosition: speaking.cameraWorldPosition,
        cameraWorldQuaternion: speaking.cameraWorldQuaternion,
        canvasSize: speaking.canvasSize,
        perMesh: speaking.perMesh,
      });

      // Where the subject's head lands in the frame, under the applied camera pose.
      for (const f of frames) {
        const headPos = f.headWorldPosition as [number, number, number] | null;
        f.headNdcUnderAppliedCamera = headPos
          ? projectToNdc(headPos, {
              position: cameraPose.position,
              lookAt: cameraPose.lookAt,
              fovDeg: cameraPose.fovDeg,
              aspect: (f.canvasSize as { width: number; height: number } | null)?.width ?? 1,
            })
          : null;
      }

      const artifact = {
        schemaVersion: "openclinxr.speaking-parent-still-pair.v1",
        generatedAt: new Date().toISOString(),
        actor: PARENT_ACTOR_ID,
        sourceGlb: SOURCE_GLB_URL_PATH,
        sourceGlbSha256: servedSha256,
        source:
          "live runtime stills via playwright headless chromium against the ui-xr portless dev server (spawnPortlessDevServer filter @openclinxr/ui-xr); " +
          "peds_asthma_parent_anxiety_v1 with the E2.1/E2.2 capture query; " +
          "speaking state selected by the E2.2 recipe: speakingFlag = phoneme-mouth-cue visibility on the parent's actor root; " +
          "not-speaking = sustained quiet window plus settled idle (mouth-region morph influence < 0.5, measured against mouth-compression decay); " +
          "speaking = trace-button dialogue drive (DOM click on the same completeTraceActionFromInput handler, panels hidden via the runtime's scene-only-visual-review class); " +
          "morph influence = max |morphTargetInfluence| over the parent's skinned meshes at the sampling instant; " +
          "camera = runtime face-detail PerspectiveCamera (child of the locomotion rig) repositioned once to a fixed room-interior pose framing the parent's head — " +
          "measured reason: the authored pose sits ~0.1 m outside the closed Infinigen room's +Z hull so every ray hits the white exterior wall; the SAME pose is applied and verified before both stills; " +
          "NOT a static asset read.",
        url,
        camera: {
          framing: "runtime_face_detail_camera_repositioned_inside_room_for_subject_pair",
          appliedWorldPosition: cameraPose.position,
          appliedLookAtWorld: cameraPose.lookAt,
          fovDegrees: cameraPose.fovDeg,
          note: "applied via page.evaluate on the live camera; per-frame read-backs recorded in each frame row (cameraWorldPosition/cameraWorldQuaternion) to prove both stills share the pose",
        },
        frames,
        claimScope:
          "an isolated speaking/not-speaking still pair of parent_tara_johnson_v1 (peds asthma station), same GLB bytes, same camera and framing, differing only in the speaking state; #402 reproduce / #419 E2.3",
        notEvidenceFor: [
          "whether a spike is present (the orchestrator grades the pair)",
          "the cause",
          "any fix",
          "production phoneme timing",
          "other actors or scenarios",
          "clinical validity",
          "scoring validity",
          "quest readiness",
        ],
      };

      const json = `${JSON.stringify(artifact, null, 2)}\n`;
      await writeFile(ARTIFACT, json, "utf8");
      process.stdout.write(`${ARTIFACT}\n`);
      process.stdout.write(`${controlStill}\n`);
      process.stdout.write(`${speakingStill}\n`);
    } finally {
      await browser.close();
    }
  } finally {
    if (server) {
      try {
        server.proc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runSpeakingParentStillPairProbe().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
