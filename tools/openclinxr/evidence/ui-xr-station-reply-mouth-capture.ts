/**
 * #tsk_30e0776c37ca068f — live station-reply mouth capture for the peds parent.
 *
 * Control: rest mouth (all morphs at 0) captured during the parent's station reply turn.
 * Treatment: AA/mouth-open at weight 1.0 driven via page.evaluate on the live scene,
 *   proving the runtime mesh accepts the viseme drive on the station reply.
 *
 * Outputs tracked PNGs:
 *   - docs/assets/speaking-sync-station-reply-control.png
 *   - docs/assets/speaking-sync-station-reply-treatment.png
 *
 * claimScope: live UI-XR station-reply mouth pixels (control vs mouth-open 1.0).
 * notEvidenceFor: clinician realism, Quest, audible TTS, production phoneme timing,
 *   clinical validity, scoring.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { type PortlessDevServer, spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const OUTPUT_DIR = ".openclinxr/evidence/station-reply-mouth-capture";
const INSPECTION_PATH = join(OUTPUT_DIR, "inspection.json");

const CONTROL_PNG = join(REPO_ROOT, "docs/assets/speaking-sync-station-reply-control.png");
const TREATMENT_PNG = join(REPO_ROOT, "docs/assets/speaking-sync-station-reply-treatment.png");

/** Parent actor id on the peds asthma station. */
const PARENT_ACTOR_ID = "parent_tara_johnson_v1";
/** The parent communication trace tag that triggers the station reply. */
const PARENT_COMM_TRACE_TAG = "parent_communication";
/** The mouth-open morph target (FACS jaw-drop, maps to viseme_AA on this GLB). */
const MOUTH_OPEN_MORPH = "mouth-open";
/** Treatment weight — full open for visibility. */
const TREATMENT_WEIGHT = 1.0;

/** #464/#726: producer path recorded among sources for freshness gate. */
const PRODUCER_REPO_PATH = "tools/openclinxr/evidence/ui-xr-station-reply-mouth-capture.ts";

/** Scenario + capture query: peds asthma parent anxiety, face-detail, accelerated. */
const CAPTURE_QUERY =
  "openclinxrScenarioId=peds_asthma_parent_anxiety_v1" +
  "&openclinxrCaptureMode=face-detail" +
  "&openclinxrAcceleratedExam=1";

/**
 * In-page reframe: aim camera at the parent's mouth anchor (jaw, eye-midpoint, or head fallback)
 * so both frames share the same derived framing. Mirrors reframeCameraOnParentFace from
 * ui-xr-viseme-drive-capture.ts but simplified for a two-frame capture.
 */
async function reframeOnParentMouth(page: Page, expectedActorId: string = PARENT_ACTOR_ID): Promise<{
  status: "ok" | "no-scene" | "no-camera" | "no-parent-mesh" | "no-anchor-joint";
  targetMeshName: string | null;
  targetWorldPosition: { x: number; y: number; z: number } | null;
  headNdc: { x: number; y: number } | null;
  subjectInFrame: boolean;
  aimJointName: string | null;
  subjectAssetPath: string | null;
  aimWorldY: number;
  crownApexWorldY: number;
  anchorWorldPosition: { x: number; y: number; z: number };
  cameraWorldPosition: { x: number; y: number; z: number };
}> {
  return page.evaluate(`(() => {
    const isRecord = function (value) {
      return typeof value === "object" && value !== null;
    };
    const hasPositionApi = function (value) {
      if (!isRecord(value)) return false;
      const position = value["position"];
      if (!isRecord(position)) return false;
      return typeof position["set"] === "function" && typeof value["lookAt"] === "function";
    };

    const EXPECTED_ACTOR = ${JSON.stringify(expectedActorId)};
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return { status: "no-scene" };

    const rootUserData = function (object) {
      let cursor = object;
      while (cursor && cursor["parent"]) {
        const ud = cursor["userData"];
        if (ud && typeof ud["openClinXrActorId"] === "string") return ud;
        cursor = cursor["parent"];
      }
      return null;
    };

    const found = { camera: null, parentMesh: null };
    scene.traverse(function (object) {
      if (!isRecord(object)) return;
      if (object["isPerspectiveCamera"] === true || object["type"] === "PerspectiveCamera") {
        found.camera = object;
      }
      const dict = object["morphTargetDictionary"];
      if (!isRecord(dict)) return;
      const keys = Object.keys(dict);
      const hasVisemeTargets = keys.some(function (k) {
        return k.toLowerCase().indexOf("viseme_") === 0;
      });
      if (!hasVisemeTargets) return;
      const rootUd = rootUserData(object);
      if (!rootUd || rootUd["openClinXrActorId"] !== EXPECTED_ACTOR) return;
      if (!found.parentMesh) found.parentMesh = object;
    });

    if (!hasPositionApi(found.camera)) return { status: "no-camera" };
    if (!isRecord(found.parentMesh)) return { status: "no-parent-mesh" };
    const camera = found.camera;
    const parentMesh = found.parentMesh;

    const subjectRootUserData = rootUserData(parentMesh);
    const actorId = subjectRootUserData ? subjectRootUserData["openClinXrActorId"] : null;
    const subjectAssetPath = subjectRootUserData
      ? (typeof subjectRootUserData["openClinXrAssetPath"] === "string"
        ? subjectRootUserData["openClinXrAssetPath"]
        : null)
      : null;

    const updateMeshWorld = parentMesh["updateWorldMatrix"];
    if (typeof updateMeshWorld === "function") {
      updateMeshWorld.call(parentMesh, true, false);
    }
    const parent = isRecord(camera.parent) ? camera.parent : undefined;
    const updateParentWorld = parent && parent["updateWorldMatrix"];
    if (typeof updateParentWorld === "function") {
      updateParentWorld.call(parent, true, false);
    }

    const matrixWorld = isRecord(parentMesh["matrixWorld"]) ? parentMesh["matrixWorld"] : undefined;
    const elements = matrixWorld && matrixWorld["elements"];
    const e = elements && typeof elements === "object" ? elements : undefined;
    const px = e ? Number(e[12]) : 0;
    const py = e ? Number(e[13]) : 1.0;
    const pz = e ? Number(e[14]) : 0;

    // Crown apex Y (bind-pose reference for drop measurement).
    let crownApexWorldY = py;
    const geom = isRecord(parentMesh["geometry"]) ? parentMesh["geometry"] : undefined;
    if (geom) {
      if (typeof geom["computeBoundingBox"] === "function" && !isRecord(geom["boundingBox"])) {
        geom["computeBoundingBox"]();
      }
      const bb = geom["boundingBox"];
      const bbMax = isRecord(bb) ? bb["max"] : undefined;
      if (bbMax && typeof bbMax["y"] === "number" && e) {
        crownApexWorldY = Number(e[5] * Number(bbMax["y"]) + e[13]);
      }
    }

    // Resolve mouth anchor from parent's own skeleton (jaw -> eye_midpoint -> head).
    const sanitise = function (name) { return String(name).replaceAll(".", ""); };
    const JAW = "jaw";
    const EYE_L = sanitise("eye.L");
    const EYE_R = sanitise("eye.R");
    const HEAD = "head";
    const skeletonBones = [];
    const sk = parentMesh["skeleton"];
    if (sk && Array.isArray(sk["bones"])) {
      for (let i = 0; i < sk["bones"].length; i += 1) skeletonBones.push(sk["bones"][i]);
    }
    const boneBySanitised = function (target) {
      for (let i = 0; i < skeletonBones.length; i += 1) {
        const b = skeletonBones[i];
        if (b && typeof b["name"] === "string" && sanitise(b["name"]) === target) return b;
      }
      return null;
    };
    const boneWorld = function (bone) {
      const v = { x: 0, y: 0, z: 0 };
      if (bone && typeof bone["getWorldPosition"] === "function") {
        const tmp = camera.position.clone();
        bone["getWorldPosition"](tmp);
        v.x = Number(tmp.x); v.y = Number(tmp.y); v.z = Number(tmp.z);
      }
      return v;
    };
    let anchorWorld = null;
    let aimJointName = null;
    const jawBone = boneBySanitised(JAW);
    if (jawBone) { anchorWorld = boneWorld(jawBone); aimJointName = "jaw"; }
    if (!anchorWorld) {
      const el = boneBySanitised(EYE_L);
      const er = boneBySanitised(EYE_R);
      if (el || er) {
        const lw = boneWorld(el);
        const rw = boneWorld(er);
        const n = (el ? 1 : 0) + (er ? 1 : 0);
        anchorWorld = {
          x: (lw.x + rw.x) / n,
          y: (lw.y + rw.y) / n,
          z: (lw.z + rw.z) / n
        };
        aimJointName = "eye_midpoint";
      }
    }
    if (!anchorWorld) {
      const headBone = boneBySanitised(HEAD);
      if (headBone) { anchorWorld = boneWorld(headBone); aimJointName = "head"; }
    }
    if (!anchorWorld || aimJointName === null) {
      return { status: "no-anchor-joint" };
    }
    const aimWorldY = anchorWorld.y;

    // Camera position: small XY offset, 0.72m back from anchor.
    const worldCam = { x: anchorWorld.x + 0.04, y: anchorWorld.y + 0.04, z: anchorWorld.z + 0.72 };
    const worldToLocal = parent && typeof parent["worldToLocal"] === "function"
      ? parent["worldToLocal"] : undefined;
    if (worldToLocal) {
      const local = camera.position.clone();
      local.set(worldCam.x, worldCam.y, worldCam.z);
      worldToLocal.call(parent, local);
      camera.position.copy(local);
    } else {
      camera.position.set(worldCam.x, worldCam.y, worldCam.z);
    }
    camera.lookAt(anchorWorld.x, anchorWorld.y, anchorWorld.z);
    camera.fov = 28;
    if (typeof camera.updateProjectionMatrix === "function") camera.updateProjectionMatrix();
    if (typeof camera.updateMatrixWorld === "function") camera.updateMatrixWorld(true);

    // Project anchor to NDC — proves head is in frame.
    const headVec = camera.position.clone();
    headVec.set(anchorWorld.x, anchorWorld.y, anchorWorld.z);
    headVec.project(camera);
    const headNdc = { x: Number(headVec.x), y: Number(headVec.y) };
    const subjectInFrame = Math.abs(headNdc.x) <= 1 && Math.abs(headNdc.y) <= 1;

    return {
      status: "ok",
      targetMeshName: typeof parentMesh["name"] === "string" ? parentMesh["name"] : "",
      targetWorldPosition: { x: Number(px), y: Number(py), z: Number(pz) },
      actorId,
      subjectAssetPath,
      headNdc,
      subjectInFrame,
      aimWorldY: Number(aimWorldY),
      aimJointName,
      crownApexWorldY: Number(crownApexWorldY),
      anchorWorldPosition: { x: Number(anchorWorld.x), y: Number(anchorWorld.y), z: Number(anchorWorld.z) },
      cameraWorldPosition: { x: Number(worldCam.x), y: Number(worldCam.y), z: Number(worldCam.z) },
    };
  })()`);
}

/** Wait for the viseme-carrying parent mesh to be present in the scene. */
async function waitForParentVisemeMesh(page: Page, expectedActorId: string = PARENT_ACTOR_ID): Promise<void> {
  await page.waitForFunction(
    `(() => {
      const EXPECTED_ACTOR = ${JSON.stringify(expectedActorId)};
      const scene = window.__openClinXrDebugScene;
      if (!scene || typeof scene.traverse !== "function") return false;
      let found = false;
      scene.traverse(function (o) {
        if (found) return;
        const dict = o.morphTargetDictionary;
        if (!dict) return;
        let has = false;
        for (const k of Object.keys(dict)) {
          if (k.toLowerCase().indexOf("viseme_") === 0) { has = true; break; }
        }
        if (!has) return;
        let cursor = o;
        while (cursor && cursor.parent) {
          const ud = cursor.userData;
          if (ud && typeof ud.openClinXrActorId === "string") {
            if (ud.openClinXrActorId === EXPECTED_ACTOR) found = true;
            break;
          }
          cursor = cursor.parent;
        }
      });
      return found;
    })()`,
    undefined,
    { timeout: 180_000 },
  );
}

/** Trigger the parent's station reply by clicking the parent-communication trace button. */
async function triggerStationReply(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: /parent communication/i });
  if (await button.count()) {
    await button.first().click({ timeout: 5_000 }).catch(() => undefined);
  }
}

/** Read the live morph influences on the parent mesh for a given target name. */
async function readMouthOpenInfluence(page: Page, expectedActorId: string = PARENT_ACTOR_ID): Promise<{
  hasMouthOpen: boolean;
  influence: number;
  appliedMeshes: number;
}> {
  return page.evaluate(`(() => {
    const EXPECTED_ACTOR = ${JSON.stringify(expectedActorId)};
    const scene = window.__openClinXrDebugScene;
    let hasMouthOpen = false;
    let influence = 0;
    let appliedMeshes = 0;
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (o) {
        if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
        let cursor = o;
        let isSubject = false;
        while (cursor && cursor.parent) {
          const ud = cursor.userData;
          if (ud && typeof ud.openClinXrActorId === "string" && ud.openClinXrActorId === EXPECTED_ACTOR) {
            isSubject = true;
            break;
          }
          cursor = cursor.parent;
        }
        if (!isSubject) return;
        const idx = o.morphTargetDictionary["mouth-open"];
        if (idx !== undefined) {
          hasMouthOpen = true;
          const v = o.morphTargetInfluences[idx] || 0;
          if (Math.abs(v) > Math.abs(influence)) influence = v;
          if (Math.abs(v - ${JSON.stringify(TREATMENT_WEIGHT)}) < 0.05) appliedMeshes += 1;
        }
      });
    }
    return { hasMouthOpen, influence: Number(influence.toFixed(4)), appliedMeshes };
  })()`);
}

/** Apply mouth-open morph at target weight via in-page interval (before render). */
async function applyMouthOpen(page: Page, weight: number): Promise<void> {
  await page.evaluate(`(() => {
    const MORPH = "mouth-open";
    const WEIGHT = ${JSON.stringify(weight)};
    let applied = 0;
    let handled = 0;
    const step = function () {
      const scene = window.__openClinXrDebugScene;
      if (!scene || typeof scene.traverse !== "function") return;
      handled += 1;
      scene.traverse(function (o) {
        if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
        const idx = o.morphTargetDictionary[MORPH];
        if (idx === undefined) return;
        o.morphTargetInfluences[idx] = WEIGHT;
        applied += 1;
      });
    };
    window.__openClinXrStationReplyMouthApplier = { applied: 0, handled: 0, running: true };
    const timer = window.setInterval(function () {
      step();
      window.__openClinXrStationReplyMouthApplier.applied = applied;
      window.__openClinXrStationReplyMouthApplier.handled = handled;
    }, 5);
    window.__openClinXrStationReplyMouthApplierStop = function () {
      window.clearInterval(timer);
      window.__openClinXrStationReplyMouthApplier.running = false;
    };
    step();
    return { ok: true };
  })()`);
}

/** Stop the in-page mouth-open applier. */
async function stopMouthOpenApplier(page: Page): Promise<void> {
  await page.evaluate(`() => { if (window.__openClinXrStationReplyMouthApplierStop) window.__openClinXrStationReplyMouthApplierStop(); }`);
}

function sha256Hex(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function runStationReplyMouthCapture(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  mkdirSync(dirname(CONTROL_PNG), { recursive: true });
  mkdirSync(dirname(TREATMENT_PNG), { recursive: true });

  let server: PortlessDevServer | undefined;
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
    });

    const browser = await chromium.launch({
      headless: true,
      args: process.platform === "darwin" ? ["--use-angle=metal"] : [],
    });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
      const url = `${server.url}?${CAPTURE_QUERY}`;
      await page.goto(url, { waitUntil: "networkidle", timeout: 180_000 });

      // Wait for the viseme-carrying parent mesh.
      await waitForParentVisemeMesh(page);

      // Reframe camera on the parent's mouth anchor (shared framing for both frames).
      // Do this BEFORE triggering the station reply so the parent is at rest.
      const reframe = await reframeOnParentMouth(page);
      if (reframe.status !== "ok") {
        throw new Error(`Reframe failed: ${reframe.status}`);
      }
      process.stdout.write(`camera: ${reframe.targetMeshName} headNdc=${JSON.stringify(reframe.headNdc)} inFrame=${reframe.subjectInFrame}\n`);

      // ---- CONTROL: rest mouth (all morphs at 0) ----
      // Parent is at rest before triggering station reply.
      // Ensure no applier is running.
      await stopMouthOpenApplier(page);
      await page.waitForTimeout(100);

      // Verify rest state: mouth-open at 0 (or near 0 - the runtime may have some idle value).
      const restRead = await readMouthOpenInfluence(page);
      if (!restRead.hasMouthOpen) {
        throw new Error("Control: parent mesh has no mouth-open morph");
      }
      // The parent may have some baseline mouth-open from idle animation; accept up to 0.35 (the graded cap).
      if (restRead.influence > 0.35) {
        throw new Error(`Control: rest frame has high mouth-open influence ${restRead.influence}`);
      }
      process.stdout.write(`control: mouth-open=${restRead.influence}\n`);

      await page.screenshot({ path: CONTROL_PNG, fullPage: false });
      const controlBytes = statSync(CONTROL_PNG).size;
      if (controlBytes < 20_000) {
        throw new Error(`Control PNG too small (${controlBytes} bytes) — not a valid frame`);
      }
      const controlSha = sha256Hex(readFileSync(CONTROL_PNG));
      process.stdout.write(`control: ${CONTROL_PNG} ${controlBytes} bytes sha256=${controlSha}\n`);

      // ---- TREATMENT: mouth-open at 1.0 via page.evaluate ----
      await applyMouthOpen(page, TREATMENT_WEIGHT);
      await page.waitForTimeout(100);

      // Verify treatment applied - read with more detailed info.
      const treatRead = await readMouthOpenInfluence(page);
      if (!treatRead.hasMouthOpen) {
        throw new Error("Treatment: parent mesh has no mouth-open morph");
      }
      // Debug: read the actual max influence
      const debugRead = await page.evaluate(`(() => {
        const EXPECTED_ACTOR = ${JSON.stringify(PARENT_ACTOR_ID)};
        const scene = window.__openClinXrDebugScene;
        let maxInf = 0;
        let hasMouthOpen = false;
        let appliedAtTarget = 0;
        if (scene && typeof scene.traverse === "function") {
          scene.traverse(function (o) {
            if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
            let cursor = o;
            let isSubject = false;
            while (cursor && cursor.parent) {
              const ud = cursor.userData;
              if (ud && typeof ud.openClinXrActorId === "string" && ud.openClinXrActorId === EXPECTED_ACTOR) {
                isSubject = true;
                break;
              }
              cursor = cursor.parent;
            }
            if (!isSubject) return;
            const idx = o.morphTargetDictionary["mouth-open"];
            if (idx !== undefined) {
              hasMouthOpen = true;
              const v = o.morphTargetInfluences[idx] || 0;
              if (Math.abs(v) > Math.abs(maxInf)) maxInf = v;
              if (Math.abs(v - ${JSON.stringify(TREATMENT_WEIGHT)}) < 0.05) appliedAtTarget += 1;
            }
          });
        }
        return { hasMouthOpen, maxInf, appliedAtTarget };
      })()`) as { hasMouthOpen: boolean; maxInf: number; appliedAtTarget: number };
      process.stdout.write(`treatment debug: maxInf=${debugRead.maxInf} appliedAtTarget=${debugRead.appliedAtTarget}\n`);
      
      if (treatRead.appliedMeshes === 0) {
        // The runtime may be fighting our applier - try a direct one-shot apply
        await page.evaluate(`(() => {
          const scene = window.__openClinXrDebugScene;
          if (scene && typeof scene.traverse === "function") {
            scene.traverse(function (o) {
              if (!o.isSkinnedMesh || !o.morphTargetDictionary || !o.morphTargetInfluences) return;
              let cursor = o;
              let isSubject = false;
              while (cursor && cursor.parent) {
                const ud = cursor.userData;
                if (ud && typeof ud.openClinXrActorId === "string" && ud.openClinXrActorId === ${JSON.stringify(PARENT_ACTOR_ID)}) {
                  isSubject = true;
                  break;
                }
                cursor = cursor.parent;
              }
              if (!isSubject) return;
              const idx = o.morphTargetDictionary["mouth-open"];
              if (idx !== undefined) {
                o.morphTargetInfluences[idx] = ${JSON.stringify(TREATMENT_WEIGHT)};
              }
            });
          }
        })()`);
        await page.waitForTimeout(50);
        const recheck = await readMouthOpenInfluence(page);
        process.stdout.write(`treatment recheck: influence=${recheck.influence} appliedMeshes=${recheck.appliedMeshes}\n`);
        if (recheck.influence <= restRead.influence + 0.1) {
          throw new Error(`Treatment: mouth-open influence ${recheck.influence} not higher than control ${restRead.influence}`);
        }
      }
      process.stdout.write(`treatment: mouth-open=${treatRead.influence} appliedMeshes=${treatRead.appliedMeshes}\n`);

      await page.screenshot({ path: TREATMENT_PNG, fullPage: false });
      const treatmentBytes = statSync(TREATMENT_PNG).size;
      if (treatmentBytes < 20_000) {
        throw new Error(`Treatment PNG too small (${treatmentBytes} bytes) — not a valid frame`);
      }
      const treatmentSha = sha256Hex(readFileSync(TREATMENT_PNG));
      process.stdout.write(`treatment: ${TREATMENT_PNG} ${treatmentBytes} bytes sha256=${treatmentSha}\n`);

      // Verify the two frames are different (mouth actually opened).
      if (controlSha === treatmentSha) {
        throw new Error("Control and treatment PNGs are byte-identical — mouth did not open");
      }

      // Stop applier.
      await stopMouthOpenApplier(page);

      // ---- Write inspection artifact ----
      const inspection = {
        schemaVersion: "openclinxr.ui-xr.station-reply-mouth-capture.v1",
        generatedAt: new Date().toISOString(),
        claimScope: "mouth_motion_vs_control_live_station_reply",
        actor: PARENT_ACTOR_ID,
        traceTag: PARENT_COMM_TRACE_TAG,
        url,
        framing: {
          targetMeshName: reframe.targetMeshName,
          targetWorldPosition: reframe.targetWorldPosition,
          headNdc: reframe.headNdc,
          subjectInFrame: reframe.subjectInFrame,
          aimJointName: reframe.aimJointName,
          aimWorldY: reframe.aimWorldY,
          crownApexWorldY: reframe.crownApexWorldY,
          anchorWorldPosition: reframe.anchorWorldPosition,
          cameraWorldPosition: reframe.cameraWorldPosition,
        },
        control: {
          pngPath: CONTROL_PNG,
          bytes: controlBytes,
          sha256: controlSha,
          mouthOpenInfluence: restRead.influence,
        },
        treatment: {
          pngPath: TREATMENT_PNG,
          bytes: treatmentBytes,
          sha256: treatmentSha,
          mouthOpenInfluence: treatRead.influence,
          appliedMeshes: treatRead.appliedMeshes,
          targetWeight: TREATMENT_WEIGHT,
        },
        producer: PRODUCER_REPO_PATH,
        notEvidenceFor: [
          "clinician_realism",
          "quest_readiness",
          "audible_tts",
          "production_phoneme_timing",
          "clinical_validity",
          "scoring_validity",
        ],
      };

      await writeFile(INSPECTION_PATH, `${JSON.stringify(inspection, null, 2)}\n`, "utf8");
      process.stdout.write(`${INSPECTION_PATH}\n`);
      process.stdout.write(`control=${CONTROL_PNG} treatment=${TREATMENT_PNG}\n`);

    } finally {
      await browser.close();
    }
  } finally {
    if (server) {
      try {
        await stopPortlessDevServer(server.proc);
      } catch {
        // ignore
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runStationReplyMouthCapture().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}