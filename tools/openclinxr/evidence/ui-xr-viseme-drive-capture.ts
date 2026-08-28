/**
 * #464 — prove the runtime mixer drives a real viseme on the peds parent (not just on paper).
 *
 * Reads mesh.morphTargetInfluences[mesh.morphTargetDictionary[name]] via page.evaluate on
 * window.__openClinXrDebugScene, sampling the peds PARENT mesh — the one mesh in the cast that
 * carries `viseme_*` targets after #462's bake. Driver self-report is not evidence.
 *
 * #462 baked 15 visemes02 targets onto the runtime parent GLB
 * (`mpfb-peds-parent-aisha.motion-bind.glb`, body mesh `mpfb_ob_patient_aisha_body`), and #463
 * made the resolver reach them (`viseme_AA -> viseme_aa`, FACS alias preserved for un-rebaked
 * actors). The child/patient and nurse still carry only the 32 MPFB FACS names (`mouth-*`),
 * driven through the #353 alias map. The sampler targets the viseme-carrying mesh and records
 * only `viseme_*` drives, so a `mouth-*` FACS fallback cannot masquerade as a real viseme.
 *
 * The states artifact (inspection.json) stays gitignored (#396, no land path); a small TRACKED
 * summary is derived from the live run and written to `parent-drives-a-real-viseme.json`, which
 * is the contract surface. Frames are graded by the orchestrator.
 *
 * claimScope: mouth (named viseme drive on the parent). notEvidenceFor: anatomy bind-pose,
 * production phoneme timing, legible-speech judgement, Quest.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { type PortlessDevServer, spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";

const OUTPUT_DIR = ".openclinxr/evidence/viseme-drive-2026-08-06";
const INSPECTION_PATH = path.join(OUTPUT_DIR, "inspection.json");
const SUMMARY_PATH = path.join("tools", "openclinxr", "evidence", "parent-drives-a-real-viseme.json");
/** #465: tracked summary proving the reframe puts the subject's head IN frame (not just ran). */
const REFRAME_SUMMARY_PATH = path.join("tools", "openclinxr", "evidence", "reframe-subject-in-frame.json");
/** #468: tracked summary proving the review panel leaves the exam volume after a real crossing. */
const REVIEW_PANEL_SUMMARY_PATH = path.join("tools", "openclinxr", "evidence", "review-panel-leaves-exam-volume.json");
/** #472: tracked summary proving the capture anchors on the mouth joint, not the crown apex. */
const MOUTH_ANCHOR_SUMMARY_PATH = path.join("tools", "openclinxr", "evidence", "capture-aims-at-the-mouth.json");
/** #730: tracked artifact recording EVERY nonzero morph on the subject (not only viseme_*), so
 * the openness channel's `mouth-open` write is visible to the cap contract. */
const MOUTH_OPEN_CHANNEL_PATH = path.join("tools", "openclinxr", "evidence", "mouth-open-channel.json");
/** #729: TRACKED record of the frame pass's own timing — one row per frame (label instant + PNG
 * bytes) and the utterance duration those frames claim to sample, read live from the speech
 * state. The gitignored inspection.json cannot be a contract input. */
const FRAME_PASS_TIMING_PATH = path.join("tools", "openclinxr", "evidence", "frame-pass-timing.json");

/**
 * #726: the subject is pinned by actor id, never by "first mesh with viseme_ keys". The child now
 * carries driven visemes (measured 2026-08-27: 5 distinct strong targets at influence 1.0 across
 * 48 live samples), so traversal order no longer selects the parent — the one mesh in the cast
 * whose dialogue this capture exists to verify (retriggerParentDialogue). Mirrors the scenario's
 * parent actor id, stamped on the humanoid root as userData.openClinXrActorId (main.ts:6964).
 */
const EXPECTED_SUBJECT_ACTOR_ID = "parent_tara_johnson_v1";
/** #726: the producer path the artifact records among its sources — the freshness gate's contract. */
const PRODUCER_REPO_PATH = "tools/openclinxr/evidence/ui-xr-viseme-drive-capture.ts";

/**
 * face-detail alone keeps natural dialogue duration (~phonemeCount*90ms) so progress spans
 * many visemes. Camera is re-framed in-page onto the parent head (face-detail default looks left).
 * The portal crossing is earned by locomotion in-page, never by `openclinxrPortalStart` (#468).
 */
const CAPTURE_QUERY =
  "openclinxrScenarioId=peds_asthma_parent_anxiety_v1" +
  "&openclinxrCaptureMode=face-detail" +
  "&openclinxrAcceleratedExam=1";

type Reading = {
  meshName: string;
  targetName: string;
  influence: number;
  index: number;
};

type SceneSample = {
  t: number;
  /** NEW: the viseme-carrying mesh the sampler read — known even when no viseme is active. */
  meshName: string;
  readings: Reading[];
  /** #730: every nonzero morph on the subject, whatever its prefix — the openness channel's
   * `mouth-open` write is invisible to the viseme_* filter this capture used to ship. */
  allNonZero: Reading[];
  /** #730: the subject mesh's morphTargetDictionary keys, for the runtime resolution record. */
  availableTargets: string[];
  peak: { targetName: string; influence: number; meshName: string } | null;
  /** NEW: why peak is null — "no viseme active" is a legitimate state, not an empty string. */
  noActiveVisemeReason?: string | null;
  speech?: { activeViseme?: string; activePhoneme?: string; activeMouthOpenness?: number } | null;
};

async function sampleParentVisemes(page: Page): Promise<SceneSample> {
  // String IIFE (not a TS arrow) so tsx/esbuild cannot inject `__name` into the browser.
  return page.evaluate(`(() => {
    const EXPECTED_ACTOR = ${JSON.stringify(EXPECTED_SUBJECT_ACTOR_ID)};
    const win = window;
    const scene = win.__openClinXrDebugScene;
    // #726: actor identity is stamped on the humanoid root (userData.openClinXrActorId) — walk
    // up from any mesh to find it. Used to pin the subject instead of first-viseme-in-traversal.
    const actorIdOf = function (object) {
      let cursor = object;
      while (cursor) {
        const ud = cursor["userData"];
        if (ud && typeof ud["openClinXrActorId"] === "string") return ud["openClinXrActorId"];
        cursor = cursor["parent"];
      }
      return null;
    };
    let parentMesh = null;
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (object) {
        if (parentMesh) return;
        const dict = object.morphTargetDictionary;
        if (!dict) return;
        const keys = Object.keys(dict);
        const hasVisemeTargets = keys.some(function (k) {
          return k.toLowerCase().indexOf("viseme_") === 0;
        });
        if (!hasVisemeTargets) return;
        // The child now carries driven visemes too — only the parent's mesh may be sampled.
        if (actorIdOf(object) !== EXPECTED_ACTOR) return;
        parentMesh = object;
      });
    }

    const readings = [];
    const allNonZero = [];
    const dict = parentMesh && parentMesh.morphTargetDictionary;
    const influences = parentMesh && parentMesh.morphTargetInfluences;
    if (dict && influences) {
      for (const targetName of Object.keys(dict)) {
        // #730: record EVERY nonzero morph on the subject, whatever its prefix. The openness
        // channel writes "mouth-open" (a FACS name, not a viseme_*), and the cap contract needs
        // to see it; the viseme_* filter below is kept for the peak/readings consumers.
        const index = dict[targetName];
        if (typeof index !== "number" || index < 0 || index >= influences.length) continue;
        const influence = influences[index] || 0;
        if (influence <= 0.01) continue;
        const reading = {
          meshName: parentMesh.name || "",
          targetName,
          influence,
          index
        };
        allNonZero.push(reading);
        if (targetName.toLowerCase().indexOf("viseme_") === 0) {
          readings.push(reading);
        }
      }
    }
    readings.sort(function (a, b) { return b.influence - a.influence; });
    const peak = readings[0]
      ? { targetName: readings[0].targetName, influence: readings[0].influence, meshName: readings[0].meshName }
      : null;

    const speech = win.__openClinXrHumanoidSpeechEvidence;
    const meshName = parentMesh && typeof parentMesh["name"] === "string" ? parentMesh["name"] : "";
    return {
      t: 0,
      meshName,
      readings,
      allNonZero,
      availableTargets: dict ? Object.keys(dict) : [],
      peak,
      noActiveVisemeReason: peak
        ? null
        : (parentMesh
          ? "no_viseme_target_above_influence_0.01_at_this_instant"
          : "no_viseme_carrying_mesh_for_subject_actor_in_scene"),
      speech: speech
        ? {
            activeViseme: speech.activeViseme,
            activePhoneme: speech.activePhoneme,
            activeMouthOpenness: speech.activeMouthOpenness
          }
        : null
    };
  })()`);
}

type ReframeOkOutcome = {
  status: "ok";
  targetMeshName: string;
  targetWorldPosition: { x: number; y: number; z: number };
  /** Live actor identity stamped on the humanoid root (userData.openClinXrActorId), or null. */
  actorId: string | null;
  /** #726: the loaded asset URL of the subject's humanoid root (userData.openClinXrAssetPath), or null. */
  subjectAssetPath: string | null;
  headY: number;
  /** NEW #465: where the head projects in normalised device coords — measured, not asserted. */
  headNdc: { x: number; y: number };
  /** NEW #465: derived from headNdc, never hand-typed. */
  subjectInFrame: boolean;
  /** NEW #465: the head's world Y, geometry-derived (not a literal offset). */
  headWorldY: number;
  /** NEW #465: the Y the camera actually aimed at via lookAt. */
  aimWorldY: number;
  /** NEW #472: the resolved anchor joint — jaw, eye_midpoint or head. Never an AABB extreme. */
  aimJointName: string | null;
  /** NEW #472: crown apex world Y, kept only as the reference for the drop measurement. */
  crownApexWorldY: number;
  /** NEW #472: the anchor's full world position — diagnostic for the raycast verdict. */
  anchorWorldPosition: { x: number; y: number; z: number };
  /** NEW #472: the camera's world position the ray was cast from. */
  cameraWorldPosition: { x: number; y: number; z: number };
  /** NEW #465: first mesh the camera->head ray hits — visibility, not just projection. */
  firstHitMeshName: string | null;
  /** NEW #465: distance along the ray to the first hit, in metres. */
  firstHitDistance: number | null;
  /** NEW #465: first hit belongs to the target actor (head/body), not an occluder. */
  subjectVisible: boolean;
  /** NEW #465: the occluder's mesh name when subjectVisible is false. */
  occluderMeshName: string | null;
  fov: number;
  cameraLocal: { x: number; y: number; z: number };
};

type ReframeFailureOutcome = {
  status: "no-scene" | "no-camera" | "no-parent-mesh" | "no-anchor-joint";
};

type ReframeOutcome = ReframeOkOutcome | ReframeFailureOutcome;

function reframeOutcomeSummary(outcome: ReframeOutcome): string {
  if (outcome.status !== "ok") {
    return `in-page face reframe FAILED: ${outcome.status}`;
  }
  const p = outcome.targetWorldPosition;
  const c = outcome.cameraLocal;
  return (
    `in-page head-and-shoulders reframe on ${outcome.targetMeshName} ` +
    `(world ${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)} ` +
    `headY=${outcome.headY.toFixed(2)} fov=${outcome.fov} ` +
    `camLocal=${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)})`
  );
}

async function reframeCameraOnParentFace(page: Page): Promise<ReframeOutcome> {
  // String IIFE (not a TS arrow) so tsx/esbuild cannot inject `__name` into the browser.
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

    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return { status: "no-scene" };

    // #726: actor identity is stamped on the humanoid root (userData.openClinXrActorId), and the
    // loaded asset URL on the same root (openClinXrAssetPath). One walk collects both — the
    // subject is pinned by id, never by first-viseme-in-traversal.
    const EXPECTED_ACTOR = ${JSON.stringify(EXPECTED_SUBJECT_ACTOR_ID)};
    const rootUserData = function (object) {
      let cursor = object;
      while (cursor && cursor["parent"]) {
        const ud = cursor["userData"];
        if (ud && typeof ud["openClinXrActorId"] === "string") return ud;
        cursor = cursor["parent"];
      }
      return null;
    };

    // Collector avoids let-null + closure assignment narrowing to never under some TS checkers.
    const found = {
      camera: null,
      parentMesh: null
    };
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
      // The child now carries driven visemes too — only the parent's mesh may be framed.
      const rootUd = rootUserData(object);
      if (!rootUd || rootUd["openClinXrActorId"] !== EXPECTED_ACTOR) return;
      // First match wins among the SUBJECT's own meshes — the camera must frame the same object
      // the sampler (sampleParentVisemes) reads.
      if (!found.parentMesh) found.parentMesh = object;
    });

    if (!hasPositionApi(found.camera)) return { status: "no-camera" };
    if (!isRecord(found.parentMesh)) return { status: "no-parent-mesh" };
    const camera = found.camera;
    const parentMesh = found.parentMesh;

    // Live actor identity + loaded asset URL from the subject's own root — never a hardcoded label.
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
    // matrixWorld translation = elements[12,13,14]
    const px = e ? Number(e[12]) : 0;
    const py = e ? Number(e[13]) : 1.0;
    const pz = e ? Number(e[14]) : 0;
    // #472: the crown apex world Y is kept ONLY as a reference for the drop measurement — never as
    // the anchor. The anchor is the mouth (jaw joint, or eye midpoint / head fallback), read at
    // runtime from the live scene graph via getWorldPosition. No AABB extreme, no child literal.
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

    // Resolve the mouth anchor from the parent's OWN skeleton (skinned mesh -> skeleton.bones),
    // never another actor's rig. three.js strips dots (eye.L -> eyeL).
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
        v.x = Number(tmp.x);
        v.y = Number(tmp.y);
        v.z = Number(tmp.z);
      }
      return v;
    };
    let anchorWorld = null;
    let aimJointName = null;
    const jawBone = boneBySanitised(JAW);
    if (jawBone) {
      anchorWorld = boneWorld(jawBone);
      aimJointName = "jaw";
    }
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
      if (headBone) {
        anchorWorld = boneWorld(headBone);
        aimJointName = "head";
      }
    }
    // Fail closed: no joint resolves -> refuse the reframe. Never a silent child constant.
    if (!anchorWorld || aimJointName === null) {
      return { status: "no-anchor-joint" };
    }
    const aimWorldY = anchorWorld.y;
    // Camera is parented under locomotionRig — convert world aim to parent-local.
    const worldCam = {
      x: anchorWorld.x + 0.04,
      y: anchorWorld.y + 0.04,
      z: anchorWorld.z + 0.72
    };
    const worldToLocal = parent && typeof parent["worldToLocal"] === "function"
      ? parent["worldToLocal"]
      : undefined;
    if (worldToLocal) {
      const local = camera.position.clone();
      local.set(worldCam.x, worldCam.y, worldCam.z);
      worldToLocal.call(parent, local);
      camera.position.copy(local);
    } else {
      camera.position.set(worldCam.x, worldCam.y, worldCam.z);
    }
    // lookAt expects world coordinates; aim AT the mouth anchor, not the mesh origin (#472).
    camera.lookAt(anchorWorld.x, anchorWorld.y, anchorWorld.z);
    camera.fov = 28;
    if (typeof camera.updateProjectionMatrix === "function") camera.updateProjectionMatrix();
    if (typeof camera.updateMatrixWorld === "function") camera.updateMatrixWorld(true);

    // Project the anchor to normalised device coords so the artifact records WHETHER it is framed,
    // not merely that the reframe ran (#465). status:"ok" 88 times over a wall is the SS6e class.
    const headVec = camera.position.clone();
    headVec.set(anchorWorld.x, anchorWorld.y, anchorWorld.z);
    headVec.project(camera);
    const headNdc = { x: Number(headVec.x), y: Number(headVec.y) };
    const subjectInFrame = Math.abs(headNdc.x) <= 1 && Math.abs(headNdc.y) <= 1;

    // #465: projection says the head is IN frame but not whether it is VISIBLE. Raycast from the
    // camera toward the head and record the FIRST hit mesh, so an in-world panel between the
    // camera and the head is named rather than graded as "no face".
    const transformPoint = function (m, x, y, z) {
      return {
        x: m[0] * x + m[4] * y + m[8] * z + m[12],
        y: m[1] * x + m[5] * y + m[9] * z + m[13],
        z: m[2] * x + m[6] * y + m[10] * z + m[14]
      };
    };
    // Column-major 4x4 multiply (three.js Matrix4.elements layout). Used to build each
    // bone's skinning matrix bone.matrixWorld * boneInverse (Skeleton.update()).
    const mat4Mul = function (a, b) {
      const out = new Array(16);
      for (let c = 0; c < 4; c += 1) {
        for (let r = 0; r < 4; r += 1) {
          let s = 0;
          for (let k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k];
          out[c * 4 + r] = s;
        }
      }
      return out;
    };
    const rayAabb = function (ox, oy, oz, dx, dy, dz, wmin, wmax) {
      let tmin = -1e30;
      let tmax = 1e30;
      const slabs = [[wmin.x, wmax.x, ox, dx], [wmin.y, wmax.y, oy, dy], [wmin.z, wmax.z, oz, dz]];
      for (let i = 0; i < 3; i += 1) {
        const lo = slabs[i][0];
        const hi = slabs[i][1];
        const o = slabs[i][2];
        const d = slabs[i][3];
        if (Math.abs(d) < 1e-12) {
          if (o < lo || o > hi) return null;
        } else {
          let t1 = (lo - o) / d;
          let t2 = (hi - o) / d;
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) return null;
        }
      }
      return tmin >= 0 ? tmin : (tmax >= 0 ? tmax : null);
    };
    const rayTriangle = function (ox, oy, oz, dx, dy, dz, a, b, c) {
      const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
      const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-12 && det < 1e-12) return null;
      const inv = 1 / det;
      const tx = ox - a.x, ty = oy - a.y, tz = oz - a.z;
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) return null;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) return null;
      const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
      return dist > 1e-6 ? dist : null;
    };

    const camM = isRecord(camera["matrixWorld"]) ? camera["matrixWorld"]["elements"] : undefined;
    const rox = camM ? Number(camM[12]) : worldCam.x;
    const roy = camM ? Number(camM[13]) : worldCam.y;
    const roz = camM ? Number(camM[14]) : worldCam.z;
    let rdx = anchorWorld.x - rox;
    let rdy = anchorWorld.y - roy;
    let rdz = anchorWorld.z - roz;
    const rlen = Math.sqrt(rdx * rdx + rdy * rdy + rdz * rdz) || 1;
    rdx /= rlen; rdy /= rlen; rdz /= rlen;

    // #472: the parent is a SkinnedMesh. Its bind-pose geometry is NOT where the face renders —
    // the skeleton (root rotation + bones) moves the head. Skin the head-region vertices through
    // the live skeleton and test the ray against the DEFORMED surface, so "first hit" is the face
    // the camera is actually looking at, not the room hull behind the bind pose.
    let parentSkinnedHit = null;
    (function () {
      const geomP = parentMesh["geometry"];
      if (!isRecord(geomP)) return;
      const posAttr = geomP["attributes"] && geomP["attributes"]["position"];
      const idxAttr = geomP["index"];
      const skinIdxAttr = geomP["attributes"] && geomP["attributes"]["skinIndex"];
      const skinWgtAttr = geomP["attributes"] && geomP["attributes"]["skinWeight"];
      const skeleton = parentMesh["skeleton"];
      if (!isRecord(posAttr) || !isRecord(posAttr["array"])) return;
      const posArr = posAttr["array"];
      const idxArr = idxAttr && isRecord(idxAttr["array"]) ? idxAttr["array"] : undefined;
      const bindM = isRecord(parentMesh["bindMatrix"]) ? parentMesh["bindMatrix"]["elements"] : undefined;
      const bones = skeleton && Array.isArray(skeleton["bones"]) ? skeleton["bones"] : undefined;
      const boneInverses = skeleton && Array.isArray(skeleton["boneInverses"]) ? skeleton["boneInverses"] : undefined;
      if (!bindM || !bones || !boneInverses) return;
      const boneMats = [];
      for (let bi = 0; bi < bones.length; bi += 1) {
        const bw = bones[bi] && isRecord(bones[bi]["matrixWorld"]) ? bones[bi]["matrixWorld"]["elements"] : undefined;
        const inv = boneInverses[bi] && isRecord(boneInverses[bi]) ? boneInverses[bi]["elements"] : undefined;
        boneMats.push(bw && inv ? mat4Mul(bw, inv) : null);
      }
      const skinIdxArr = skinIdxAttr && isRecord(skinIdxAttr["array"]) ? skinIdxAttr["array"] : undefined;
      const skinWgtArr = skinWgtAttr && isRecord(skinWgtAttr["array"]) ? skinWgtAttr["array"] : undefined;
      const skinVert = function (vi) {
        const sv = transformPoint(bindM, posArr[vi * 3], posArr[vi * 3 + 1], posArr[vi * 3 + 2]);
        if (!skinIdxArr || !skinWgtArr) return sv;
        let wx = 0, wy = 0, wz = 0;
        for (let k = 0; k < 4; k += 1) {
          const bi = skinIdxArr[vi * 4 + k];
          const w = skinWgtArr[vi * 4 + k];
          if (!(w > 0)) continue;
          const bm = boneMats[bi];
          if (!bm) continue;
          const dv = transformPoint(bm, sv.x, sv.y, sv.z);
          wx += dv.x * w; wy += dv.y * w; wz += dv.z * w;
        }
        return { x: wx, y: wy, z: wz };
      };
      // Head-region triangles only (bind-pose Y above the neck) — the ray targets the jaw.
      const HEAD_REGION_Y = 1.25;
      const count = idxArr ? idxArr.length / 3 : posArr.length / 3;
      for (let ti = 0; ti < count; ti += 1) {
        const i0 = idxArr ? idxArr[ti * 3] : ti * 3;
        const i1 = idxArr ? idxArr[ti * 3 + 1] : ti * 3 + 1;
        const i2 = idxArr ? idxArr[ti * 3 + 2] : ti * 3 + 2;
        if (posArr[i0 * 3 + 1] < HEAD_REGION_Y && posArr[i1 * 3 + 1] < HEAD_REGION_Y && posArr[i2 * 3 + 1] < HEAD_REGION_Y) continue;
        const a = skinVert(i0);
        const b = skinVert(i1);
        const c = skinVert(i2);
        const d = rayTriangle(rox, roy, roz, rdx, rdy, rdz, a, b, c);
        if (d !== null && (parentSkinnedHit === null || d < parentSkinnedHit)) parentSkinnedHit = d;
      }
    })();

    const candidates = [];
    scene.traverse(function (object) {
      if (!isRecord(object)) return;
      // The parent skinned mesh is handled above against its DEFORMED head surface, not its
      // bind-pose AABB, which would be tested at the wrong location (#472).
      if (object === parentMesh) return;
      // A mesh renders only if it and every ancestor are visible. The ragdoll collision proxy
      // (main.ts:6513 group.visible=false) and other debug volumes must not read as the first hit.
      let vis = object;
      while (vis) {
        if (vis["visible"] === false) return;
        vis = vis["parent"];
      }
      const geometry = object["geometry"];
      if (!isRecord(geometry)) return;
      const attrs = geometry["attributes"];
      const position = attrs && isRecord(attrs["position"]) ? attrs["position"] : undefined;
      if (!isRecord(position) || !isRecord(position["array"])) return;
      if (typeof object["updateWorldMatrix"] === "function") object["updateWorldMatrix"](true, false);
      const mw = isRecord(object["matrixWorld"]) ? object["matrixWorld"]["elements"] : undefined;
      if (!mw) return;
      if (typeof geometry["computeBoundingBox"] === "function" && !isRecord(geometry["boundingBox"])) {
        geometry["computeBoundingBox"]();
      }
      const bb = geometry["boundingBox"];
      if (!isRecord(bb) || !isRecord(bb["min"]) || !isRecord(bb["max"])) return;
      const mn = bb["min"], mx = bb["max"];
      const wmin = { x: Infinity, y: Infinity, z: Infinity };
      const wmax = { x: -Infinity, y: -Infinity, z: -Infinity };
      const corners = [
        transformPoint(mw, mn["x"], mn["y"], mn["z"]),
        transformPoint(mw, mx["x"], mn["y"], mn["z"]),
        transformPoint(mw, mn["x"], mx["y"], mn["z"]),
        transformPoint(mw, mn["x"], mn["y"], mx["z"]),
        transformPoint(mw, mx["x"], mx["y"], mn["z"]),
        transformPoint(mw, mx["x"], mn["y"], mx["z"]),
        transformPoint(mw, mn["x"], mx["y"], mx["z"]),
        transformPoint(mw, mx["x"], mx["y"], mx["z"])
      ];
      for (let ci = 0; ci < 8; ci += 1) {
        const c = corners[ci];
        if (c.x < wmin.x) wmin.x = c.x;
        if (c.y < wmin.y) wmin.y = c.y;
        if (c.z < wmin.z) wmin.z = c.z;
        if (c.x > wmax.x) wmax.x = c.x;
        if (c.y > wmax.y) wmax.y = c.y;
        if (c.z > wmax.z) wmax.z = c.z;
      }
      const entry = rayAabb(rox, roy, roz, rdx, rdy, rdz, wmin, wmax);
      if (entry === null) return;
      candidates.push({ object: object, entry: entry });
    });
    candidates.sort(function (a, b) { return a.entry - b.entry; });

    let firstHitObject = null;
    let firstHitDistance = Infinity;
    for (let k = 0; k < candidates.length && firstHitObject === null; k += 1) {
      const cand = candidates[k];
      const geometry = cand.object["geometry"];
      const position = geometry["attributes"]["position"];
      const arr = position["array"];
      const indexAttr = geometry["index"];
      const index = indexAttr && isRecord(indexAttr["array"]) ? indexAttr["array"] : undefined;
      const mw = cand.object["matrixWorld"]["elements"];
      const count = index ? index.length / 3 : arr.length / 3;
      let best = null;
      for (let ti = 0; ti < count; ti += 1) {
        const i0 = index ? index[ti * 3] : ti * 3;
        const i1 = index ? index[ti * 3 + 1] : ti * 3 + 1;
        const i2 = index ? index[ti * 3 + 2] : ti * 3 + 2;
        const a = transformPoint(mw, arr[i0 * 3], arr[i0 * 3 + 1], arr[i0 * 3 + 2]);
        const b = transformPoint(mw, arr[i1 * 3], arr[i1 * 3 + 1], arr[i1 * 3 + 2]);
        const c = transformPoint(mw, arr[i2 * 3], arr[i2 * 3 + 1], arr[i2 * 3 + 2]);
        const d = rayTriangle(rox, roy, roz, rdx, rdy, rdz, a, b, c);
        if (d !== null && (best === null || d < best)) best = d;
      }
      if (best !== null) {
        firstHitObject = cand.object;
        firstHitDistance = best;
      }
    }

    // #472: if the ray reached the parent's skinned face closer than any static mesh, that face
    // is the first hit — the ray now aims at the jaw, so the face lies between camera and anchor.
    if (parentSkinnedHit !== null && (firstHitObject === null || parentSkinnedHit < firstHitDistance)) {
      firstHitObject = parentMesh;
      firstHitDistance = parentSkinnedHit;
    }

    const firstHitMeshName = firstHitObject && typeof firstHitObject["name"] === "string" ? firstHitObject["name"] : null;
    let firstHitActorId = null;
    let hc = firstHitObject;
    while (hc && hc["parent"]) {
      const hud = hc["userData"];
      if (hud && typeof hud["openClinXrActorId"] === "string") {
        firstHitActorId = hud["openClinXrActorId"];
        break;
      }
      hc = hc["parent"];
    }
    const subjectVisible = firstHitMeshName !== null
      && (firstHitActorId !== null ? firstHitActorId === actorId : firstHitMeshName === parentMesh["name"]);

    return {
      status: "ok",
      targetMeshName: typeof parentMesh["name"] === "string" ? parentMesh["name"] : "",
      targetWorldPosition: { x: Number(px), y: Number(py), z: Number(pz) },
      actorId: actorId,
      subjectAssetPath: subjectAssetPath,
      headY: Number(crownApexWorldY),
      headNdc,
      subjectInFrame,
      headWorldY: Number(crownApexWorldY),
      aimWorldY: Number(aimWorldY),
      aimJointName: aimJointName,
      crownApexWorldY: Number(crownApexWorldY),
      anchorWorldPosition: { x: Number(anchorWorld.x), y: Number(anchorWorld.y), z: Number(anchorWorld.z) },
      cameraWorldPosition: { x: Number(rox), y: Number(roy), z: Number(roz) },
      firstHitMeshName,
      firstHitDistance: firstHitMeshName !== null ? Number(firstHitDistance.toFixed(4)) : null,
      subjectVisible,
      occluderMeshName: subjectVisible ? null : firstHitMeshName,
      fov: 28,
      cameraLocal: {
        x: Number(camera.position.x),
        y: Number(camera.position.y),
        z: Number(camera.position.z)
      }
    };
  })()`);
}

async function retriggerParentDialogue(page: Page): Promise<void> {
  // Click the parent-communication trace to make the PARENT speak (its turn is authored on
  // `parent_communication`, actor `parent_tara_johnson_v1`), so the sampling window covers a
  // full parent utterance from t≈0.
  const button = page.getByRole("button", { name: /parent communication/i });
  if (await button.count()) {
    await button.first().click({ timeout: 5_000 }).catch(() => undefined);
  }
}

type PortalTransitionSnapshot = {
  side: string;
  portalInteriorHiddenObjectNames: string[];
  transitionProbeZ: number;
  locomotionRigZ: number;
};

async function setLocomotionRigZ(page: Page, z: number): Promise<void> {
  await page.evaluate(`((z) => {
    const scene = window.__openClinXrDebugScene;
    if (!scene || typeof scene.traverse !== "function") return;
    let rig = null;
    scene.traverse(function (o) {
      if (!rig && typeof o["name"] === "string" && o["name"].indexOf("locomotion-rig") !== -1) rig = o;
    });
    if (rig && rig["position"] && typeof rig["position"]["z"] === "number") {
      rig["position"]["z"] = z;
    }
  })(${z})`);
}

async function readPortalTransitionSnapshot(page: Page): Promise<PortalTransitionSnapshot | null> {
  return page.evaluate(`(() => {
    const evidence = window.__openClinXrPortalTransitionEvidence;
    if (!evidence) return null;
    return {
      side: evidence.side,
      portalInteriorHiddenObjectNames: Array.isArray(evidence.portalInteriorHiddenObjectNames)
        ? evidence.portalInteriorHiddenObjectNames.slice()
        : [],
      transitionProbeZ: evidence.transitionProbeZ,
      locomotionRigZ: evidence.locomotionRigZ
    };
  })()`);
}

async function readReviewPanelState(page: Page): Promise<{ present: boolean; visible: boolean }> {
  return page.evaluate(`(() => {
    const scene = window.__openClinXrDebugScene;
    let panel = null;
    if (scene && typeof scene.traverse === "function") {
      scene.traverse(function (o) {
        if (!panel && o.userData && o.userData.openClinXrPortalInteriorReviewAffordance === true) panel = o;
      });
    }
    return {
      present: Boolean(panel),
      visible: Boolean(panel) && panel.visible !== false
    };
  })()`);
}

export async function runVisemeCapture(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  let server: PortlessDevServer | undefined;
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
    });

    // #729: force the ANGLE Metal backend on macOS. Headless Chromium otherwise falls back to
    // SwiftShader (software WebGL), which renders this scene at ~6 fps — measured 2026-08-27:
    // ~1.8 s per screenshot and ~300 ms per page.evaluate, so the frame pass spans ~14 s of a
    // ~2.9 s utterance. With the Metal GPU the same screenshot is ~90 ms and evaluates ~10 ms.
    const browser = await chromium.launch({
      headless: true,
      args: process.platform === "darwin" ? ["--use-angle=metal"] : [],
    });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
      const url = `${server.url}?${CAPTURE_QUERY}`;
      await page.goto(url, { waitUntil: "networkidle", timeout: 180_000 });

      // Wait for the viseme-carrying parent mesh (the only rebaked actor).
      // NOTE: waitForFunction(pageFunction, arg, options) — the timeout must be the THIRD
      // argument. Passing it second (as `arg`) silently keeps the 30s default, which under a
      // loaded machine fails before the humanoids finish loading.
      await page.waitForFunction(
        `(() => {
          const EXPECTED_ACTOR = ${JSON.stringify(EXPECTED_SUBJECT_ACTOR_ID)};
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

      // #468: cross the portal by locomotion — not by a query parameter — so the review panel is
      // hidden inside the exam volume, and observe it is still present and visible outside it.
      // `side` is level-triggered by the rig's world Z and read live from the portal evidence.
      await setLocomotionRigZ(page, 1.35);
      await page.waitForTimeout(180);
      const exteriorSnapshot = await readPortalTransitionSnapshot(page);
      const exteriorPanel = await readReviewPanelState(page);
      await setLocomotionRigZ(page, -0.62);
      await page.waitForTimeout(180);
      const interiorSnapshot = await readPortalTransitionSnapshot(page);
      process.stdout.write(
        `portal: exterior side=${exteriorSnapshot?.side ?? "n/a"} panel=${exteriorPanel.present}/${exteriorPanel.visible} -> interior side=${interiorSnapshot?.side ?? "n/a"} hidden=${(interiorSnapshot?.portalInteriorHiddenObjectNames ?? []).length}\n`,
      );

      const reframeOutcomes: ReframeOutcome[] = [];
      /** #473: per-frame reframe verdict — one row per captured frame, not one scalar for the run. */
      const frameReframes: Array<{
        framePath: string;
        subjectInFrame: boolean;
        headNdc: { x: number; y: number };
      }> = [];
      const initialReframe = await reframeCameraOnParentFace(page);
      reframeOutcomes.push(initialReframe);
      process.stdout.write(`camera: ${reframeOutcomeSummary(initialReframe)}\n`);
      await page.waitForTimeout(600);
      // Restart the parent's dialogue so the sampling window covers a full utterance from t≈0.
      await retriggerParentDialogue(page);
      await page.waitForTimeout(120);

      const liveSamples: Array<{
        t: number;
        targetName: string;
        influence: number;
        meshName: string;
        framePath: string | null;
        reframeStatus: ReframeOutcome["status"];
      }> = [];
      const rawTimeline: SceneSample[] = [];
      const t0 = Date.now();
      const strongByName = new Map<string, { t: number; influence: number; framePath: string | null }>();

      // One state sample per step. The page's render loop is slow (measured ~6 fps in
      // headless), so screenshots (~500 ms each) are kept OFF the states pass — a screenshot
      // between every sample would halve the distinct visemes the timeline actually visits.
      async function sampleStates(framePath: string | null): Promise<{ t: number; dominant: string }> {
        const t = (Date.now() - t0) / 1000;
        // Keep framing locked (runtime may tweak camera) and record every outcome.
        const reframeOutcome = await reframeCameraOnParentFace(page);
        reframeOutcomes.push(reframeOutcome);
        // #473: the reframe verdict is a per-frame phenomenon (one headNdc/subjectInFrame per
        // captured frame), not one scalar for the whole run. Only the frame pass carries a real
        // framePath, so link the verdict to its frame there — the dense states pass passes null.
        if (framePath !== null && reframeOutcome.status === "ok") {
          frameReframes.push({
            framePath,
            subjectInFrame: reframeOutcome.subjectInFrame,
            headNdc: reframeOutcome.headNdc,
          });
        }
        const sceneSample = await sampleParentVisemes(page);
        rawTimeline.push({ ...sceneSample, t });

        const peak = sceneSample.peak;
        const dominant = peak?.targetName ?? "none";
        liveSamples.push({
          t,
          targetName: dominant,
          influence: peak?.influence ?? 0,
          meshName: sceneSample.meshName,
          framePath,
          reframeStatus: reframeOutcome.status,
        });
        for (const r of sceneSample.readings) {
          if (r.influence < 0.5) continue;
          const prev = strongByName.get(r.targetName);
          if (!prev || r.influence > prev.influence) {
            strongByName.set(r.targetName, { t, influence: r.influence, framePath });
          }
        }
        return { t, dominant };
      }

      const distinctStrong = (): Set<string> =>
        new Set(
          liveSamples
            .filter((s) => s.influence >= 0.5 && s.targetName !== "none")
            .map((s) => s.targetName),
        );

      // Dense states pass across the full dialogue window (~110 ms steps, up to the 4.8 s cap).
      const SAMPLE_STEP_MS = 110;
      const SAMPLE_SPAN_MS = 4_400;
      async function denseStatesPass(): Promise<void> {
        for (let target = SAMPLE_STEP_MS; target <= SAMPLE_SPAN_MS; target += SAMPLE_STEP_MS) {
          const elapsed = Date.now() - t0;
          if (target > elapsed) {
            await page.waitForTimeout(target - elapsed);
          }
          await sampleStates(null);
        }
      }

      await denseStatesPass();
      // If one utterance's samples did not cover five distinct viseme shapes, replay the
      // dialogue and keep sampling (the retrigger restarts the phoneme timeline).
      if (distinctStrong().size < 5) {
        await retriggerParentDialogue(page);
        await page.waitForTimeout(120);
        await denseStatesPass();
      }

      // Frame pass — sparse screenshots for the orchestrator's pixel grade, labelled with the
      // live dominant value sampled at the same instant. Each frame also records its dominant
      // viseme so strong instants can be attributed to a frame (#465's second defect).
      await retriggerParentDialogue(page);
      await page.waitForTimeout(120);
      const FRAME_STEP_MS = 250;
      const FRAME_COUNT = 8;
      // #729: the pass paces against its OWN start, not the sampling-wide t0 (which precedes the
      // dense pass, so every target was already in the past and the frames fired back-to-back).
      // With the reframe cheap under the Metal GPU, the 250 ms step actually paces now, so the
      // eight frames land inside the retriggered utterance instead of spanning ~14 s after it.
      const t0FramePass = Date.now();
      const framePass: Array<{ t: number; tMs: number; framePath: string; targetName: string; bytes: number }> = [];
      for (let i = 0; i < FRAME_COUNT; i += 1) {
        const target = i * FRAME_STEP_MS;
        const elapsed = Date.now() - t0FramePass;
        if (target > elapsed) {
          await page.waitForTimeout(target - elapsed);
        }
        const frameName = `viseme_frame_${String(i).padStart(2, "0")}.png`;
        const framePath = path.join(OUTPUT_DIR, frameName);
        const { t, dominant } = await sampleStates(framePath);
        const tMs = Date.now() - t0FramePass;
        await page.screenshot({ path: framePath, fullPage: false });
        framePass.push({ t, tMs, framePath, targetName: dominant, bytes: statSync(framePath).size });
      }

      // #729: TRACKED timing record — the gitignored inspection.json cannot be a contract input.
      // The utterance duration is read live from the subject's baked viseme timeline (the
      // runtime's own speech state), falling back to the runtime's deterministic text-derived
      // formula (phonemeCount * 90, clamped 900-4800) when no baked cue file was served.
      const utteranceDurationMs = await page.evaluate(`(() => {
        const EXPECTED_ACTOR = ${JSON.stringify(EXPECTED_SUBJECT_ACTOR_ID)};
        const scene = window.__openClinXrDebugScene;
        if (!scene || typeof scene.traverse !== "function") return null;
        let duration = null;
        let phonemeCount = null;
        scene.traverse(function (o) {
          const ud = o.userData;
          if (!ud) return;
          const actorId = typeof ud.openClinXrActorId === "string" ? ud.openClinXrActorId : null;
          const timeline = ud.openClinXrBakedVisemeTimeline;
          if (timeline && typeof timeline.durationMs === "number") {
            if (actorId === EXPECTED_ACTOR || duration === null) duration = timeline.durationMs;
          }
          const mapping = ud.openClinXrDialoguePhonemeMapping;
          if (mapping && Array.isArray(mapping.phonemeSequence)) {
            if (actorId === EXPECTED_ACTOR || phonemeCount === null) phonemeCount = mapping.phonemeSequence.length;
          }
        });
        if (duration !== null) return duration;
        if (phonemeCount !== null) return Math.max(900, Math.min(4800, phonemeCount * 90));
        return null;
      })()`);
      if (typeof utteranceDurationMs !== "number" || utteranceDurationMs <= 0) {
        throw new Error("frame pass: no utterance duration found in the live speech state");
      }
      const frameTimingReport = {
        schemaVersion: "openclinxr.ui-xr-viseme-drive-capture.frame-pass-timing.v1",
        capturedFrom: `${INSPECTION_PATH} (pnpm asset:ui-xr:viseme-drive-capture)`,
        generatedAt: new Date().toISOString(),
        utteranceDurationMs,
        frameStepMs: FRAME_STEP_MS,
        frameCount: FRAME_COUNT,
        frames: framePass.map((f) => ({ framePath: f.framePath, tMs: f.tMs, bytes: f.bytes })),
      };
      await writeFile(FRAME_PASS_TIMING_PATH, `${JSON.stringify(frameTimingReport, null, 2)}\n`, "utf8");
      process.stdout.write(
        `frameTiming: ${FRAME_PASS_TIMING_PATH} utterance=${utteranceDurationMs}ms span=${frameTimingReport.frames.length > 0 ? Math.max(...frameTimingReport.frames.map((f) => f.tMs)) - Math.min(...frameTimingReport.frames.map((f) => f.tMs)) : 0}ms\n`,
      );

      // #465 second defect: attribute every strong viseme instant to a frame. A frame whose
      // dominant viseme matches the instant is the honest link; otherwise the nearest-timestamp
      // frame is used and the approximation is recorded rather than silently shipped.
      const frameByDominant = new Map<string, string>();
      for (const f of framePass) {
        if (f.targetName !== "none" && !frameByDominant.has(f.targetName)) {
          frameByDominant.set(f.targetName, f.framePath);
        }
      }
      const frameLinkage: Record<string, { framePath: string; linkage: "dominant-match" | "nearest-timestamp" }> = {};
      for (const [targetName, v] of strongByName) {
        const matched = frameByDominant.get(targetName);
        if (matched) {
          v.framePath = matched;
          frameLinkage[targetName] = { framePath: matched, linkage: "dominant-match" };
        } else if (framePass.length > 0) {
          let nearest = framePass[0];
          for (const f of framePass) {
            if (Math.abs(f.t - v.t) < Math.abs(nearest.t - v.t)) nearest = f;
          }
          v.framePath = nearest.framePath;
          frameLinkage[targetName] = { framePath: nearest.framePath, linkage: "nearest-timestamp" };
        }
      }

      // #730 land-path artifact: every nonzero morph recorded on the subject (not only the
      // viseme_* prefix), so the openness channel's `mouth-open` write is visible to the cap
      // contract. The resolved names come from the runtime's own morph cue (resolvedTargets),
      // which resolveMorphTarget populated against the live dictionaries.
      const resolvedTargets = await page.evaluate(`(() => {
        const scene = window.__openClinXrDebugScene;
        let resolved = null;
        if (scene && typeof scene.traverse === "function") {
          scene.traverse(function (o) {
            if (resolved) return;
            const cue = o.userData && o.userData.openClinXrMorphTargetRuntimeCue;
            if (cue && cue.resolvedTargets) resolved = cue.resolvedTargets;
          });
        }
        return resolved;
      })()`);
      const mouthOpenChannel = {
        capturedFrom: `${INSPECTION_PATH} (pnpm asset:ui-xr:viseme-drive-capture)`,
        meshName: rawTimeline[0]?.meshName ?? "",
        resolved: resolvedTargets,
        samples: rawTimeline.map((s) => ({
          t: Number(s.t.toFixed(3)),
          activeMouthOpenness: s.speech?.activeMouthOpenness ?? null,
          nonZeroMorphs: (s.allNonZero ?? []).map((m) => ({
            targetName: m.targetName,
            influence: Number(m.influence.toFixed(4)),
          })),
        })),
      };
      await writeFile(MOUTH_OPEN_CHANNEL_PATH, `${JSON.stringify(mouthOpenChannel, null, 2)}\n`, "utf8");
      process.stdout.write(
        `mouthOpenChannel: ${MOUTH_OPEN_CHANNEL_PATH} mesh=${mouthOpenChannel.meshName} resolved=${JSON.stringify(mouthOpenChannel.resolved)} samples=${mouthOpenChannel.samples.length}\n`,
      );

      // #368 remaining half: the artifact must record the reframe's OUTCOME — the mesh the
      // camera actually framed and its world position (or the failure code), never a
      // hardcoded description. The actor label is derived from the live scene, not restated.
      const firstReframe: ReframeOutcome = reframeOutcomes[0] ?? { status: "no-scene" };
      const reappliedFailures = [
        ...new Set(
          reframeOutcomes
            .slice(1)
            .filter((o) => o.status !== "ok")
            .map((o) => o.status),
        ),
      ];
      const drivenMeshNames = [
        ...new Set(liveSamples.map((s) => s.meshName).filter((n) => n !== "")),
      ];
      const actorLabel =
        firstReframe.status === "ok" && firstReframe.actorId
          ? `${firstReframe.actorId} — driven mesh: ${drivenMeshNames.length > 0 ? drivenMeshNames.join(", ") : "none observed"}`
          : `peds parent (actor id not stamped on the framed root) — driven mesh: ${drivenMeshNames.length > 0 ? drivenMeshNames.join(", ") : "none observed"}`;
      const reframeRecord = {
        status: firstReframe.status,
        targetMeshName: firstReframe.status === "ok" ? firstReframe.targetMeshName : null,
        targetWorldPosition:
          firstReframe.status === "ok" ? firstReframe.targetWorldPosition : null,
        subjectAssetPath: firstReframe.status === "ok" ? firstReframe.subjectAssetPath : null,
        framingDescription: reframeOutcomeSummary(firstReframe),
        reappliedCount: reframeOutcomes.length - 1,
        reappliedFailures,
        headNdc: firstReframe.status === "ok" ? firstReframe.headNdc : null,
        subjectInFrame: firstReframe.status === "ok" ? firstReframe.subjectInFrame : false,
        headWorldY: firstReframe.status === "ok" ? firstReframe.headWorldY : null,
        aimWorldY: firstReframe.status === "ok" ? firstReframe.aimWorldY : null,
        firstHitMeshName: firstReframe.status === "ok" ? firstReframe.firstHitMeshName : null,
        firstHitDistance: firstReframe.status === "ok" ? firstReframe.firstHitDistance : null,
        subjectVisible: firstReframe.status === "ok" ? firstReframe.subjectVisible : false,
        occluderMeshName: firstReframe.status === "ok" ? firstReframe.occluderMeshName : null,
      };

      const inspection = {
        schemaVersion: "openclinxr.ui-xr-viseme-drive-capture.v1",
        generatedAt: new Date().toISOString(),
        claimScope: "mouth_named_viseme_morph_drive_runtime_evidence",
        actor: actorLabel,
        url,
        framing: reframeRecord.framingDescription,
        reframe: reframeRecord,
        liveVisemeSamples: liveSamples.map((s) => ({
          t: Number(s.t.toFixed(3)),
          targetName: s.targetName,
          influence: Number(s.influence.toFixed(4)),
          meshName: s.meshName,
          framePath: s.framePath,
          reframeStatus: s.reframeStatus,
        })),
        strongVisemeTargets: [...strongByName.entries()].map(([targetName, v]) => ({
          targetName,
          t: Number(v.t.toFixed(3)),
          influence: Number(v.influence.toFixed(4)),
          framePath: v.framePath,
        })),
        frameLinkage,
        distinctStrongVisemeCount: strongByName.size,
        distinctDominantStrongCount: distinctStrong().size,
        maxInfluence: Math.max(...liveSamples.map((s) => s.influence), 0),
        reframeOkSamples: liveSamples.filter((s) => s.reframeStatus === "ok").length,
        rawTimeline: rawTimeline.map((s) => ({
          t: Number(s.t.toFixed(3)),
          meshName: s.meshName,
          peak: s.peak,
          noActiveVisemeReason: s.noActiveVisemeReason ?? null,
          speech: s.speech,
          nonZeroVisemes: s.readings
            .filter((r) => r.influence > 0.01)
            .map((r) => ({
              targetName: r.targetName,
              influence: Number(r.influence.toFixed(4)),
              index: r.index,
              meshName: r.meshName,
            })),
        })),
        speechEvidence: await page.evaluate(
          `(() => (window.__openClinXrHumanoidSpeechEvidence || null))()`,
        ),
        morphCue: await page.evaluate(`(() => {
          const scene = window.__openClinXrDebugScene;
          let cue = null;
          if (scene && typeof scene.traverse === "function") {
            scene.traverse(function (o) {
              if (!cue && o.userData && (o.userData.openClinXrNamedVisemeDrive || o.userData.openClinXrMorphTargetRuntimeCue)) {
                cue = {
                  meshName: o.name || "",
                  named: o.userData.openClinXrNamedVisemeDrive || null,
                  morph: o.userData.openClinXrMorphTargetRuntimeCue || null
                };
              }
            });
          }
          return cue;
        })()`),
        framePaths: liveSamples.filter((s) => s.framePath !== null).map((s) => s.framePath as string),
        notEvidenceFor: [
          "anatomy_bind_pose",
          "school_age_mpfb2_comparator",
          "production_phoneme_timing",
          "validated_facial_animation",
          "clinical_affect_scoring",
          "quest_readiness",
          "b_plus_visual_realism_gate",
          "learner_readiness",
        ],
        verificationNotes: {
          liveSceneGraph:
            "influences read from mesh.morphTargetInfluences[dict[name]] via __openClinXrDebugScene (parent mesh)",
          gateNotReliedOn: "morphTargetAppliedTargetCount > 0 (satisfied by mouth-open alone)",
          required: "≥3 timestamps; ≥2 distinct viseme_* names at influence ≥ 0.5",
          framesAreSparse:
            "screenshots are ~500 ms each on this slow render loop, so frames are taken on a separate pass from the dense states; each frame is labelled with the dominant value at its instant",
        },
      };

      await writeFile(INSPECTION_PATH, `${JSON.stringify(inspection, null, 2)}\n`, "utf8");
      process.stdout.write(`${INSPECTION_PATH}\n`);
      process.stdout.write(
        `strongVisemes=${strongByName.size} nonSilence=${[...strongByName.keys()].filter((n) => !n.toLowerCase().includes("silence")).length} samples=${liveSamples.length}\n`,
      );

      if (liveSamples.length < 3) {
        throw new Error(`Need ≥3 live samples; got ${liveSamples.length}`);
      }
      if (strongByName.size < 2) {
        throw new Error(
          `Need ≥2 distinct viseme_* at influence ≥0.5; got ${strongByName.size}: ${[...strongByName.keys()].join(",")}`,
        );
      }

      // #464 land-path summary: the inspection.json is gitignored (#396), so derive a small
      // TRACKED summary from the live run — capturedFrom/meshName/actor come from the live
      // scene, never typed. Only the viseme_* drive is recorded (the sampler reads visemes
      // exclusively), so a `mouth-*` FACS fallback cannot satisfy the contract.
      const summary = {
        capturedFrom: `${INSPECTION_PATH} (pnpm asset:ui-xr:viseme-drive-capture)`,
        meshName:
          (firstReframe.status === "ok" && firstReframe.targetMeshName) ||
          drivenMeshNames[0] ||
          "",
        actor:
          (firstReframe.status === "ok" && firstReframe.actorId) ||
          "peds parent (actor id not stamped on the framed root)",
        samples: [...strongByName.entries()].map(([drivenTargetName, v]) => ({
          drivenTargetName,
          influence: Number(v.influence.toFixed(4)),
        })),
      };
      await writeFile(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
      process.stdout.write(`summary: ${SUMMARY_PATH} mesh=${summary.meshName} actor=${summary.actor}\n`);

      // #465 land-path summary: prove the reframe put the subject's head IN frame (measured
      // via the head's normalised device coords, not asserted), and that every strong viseme
      // instant is attributable to a frame. Derived from the same live run, never typed.
      const reframeSummary = {
        capturedFrom: `${INSPECTION_PATH} (pnpm asset:ui-xr:viseme-drive-capture)`,
        reframe: {
          status: firstReframe.status,
          targetMeshName: firstReframe.status === "ok" ? firstReframe.targetMeshName : null,
          reappliedCount: reframeOutcomes.length - 1,
          headNdc: firstReframe.status === "ok" ? firstReframe.headNdc : null,
          subjectInFrame: firstReframe.status === "ok" ? firstReframe.subjectInFrame : false,
          headWorldY: firstReframe.status === "ok" ? firstReframe.headWorldY : null,
          aimWorldY: firstReframe.status === "ok" ? firstReframe.aimWorldY : null,
          firstHitMeshName: firstReframe.status === "ok" ? firstReframe.firstHitMeshName : null,
          firstHitDistance: firstReframe.status === "ok" ? firstReframe.firstHitDistance : null,
          subjectVisible: firstReframe.status === "ok" ? firstReframe.subjectVisible : false,
          occluderMeshName: firstReframe.status === "ok" ? firstReframe.occluderMeshName : null,
        },
        visemeInstants: [...strongByName.entries()].map(([targetName, v]) => ({
          targetName,
          framePath: v.framePath,
        })),
        frameLinkage,
        reframePerFrame: frameReframes.map((r) => ({
          framePath: r.framePath,
          subjectInFrame: r.subjectInFrame,
          headNdc: r.headNdc,
        })),
        linkageApproximation:
          "strong instants whose viseme was dominant in a frame are linked to that frame; "
          + "any remaining instant is linked to the nearest-timestamp frame (see frameLinkage)",
        notEvidenceFor: [
          "legible_lip_motion_is_the_orchestrators_pixel_grade_not_this_contracts_business",
          "other_captures_using_the_same_reframe_helper_unaudited",
          "quest_readiness",
          "frame_budget",
          "on_device_rendering",
        ],
      };
      await writeFile(REFRAME_SUMMARY_PATH, `${JSON.stringify(reframeSummary, null, 2)}\n`, "utf8");
      process.stdout.write(
        `reframeSummary: ${REFRAME_SUMMARY_PATH} subjectInFrame=${reframeSummary.reframe.subjectInFrame} headNdc=${JSON.stringify(reframeSummary.reframe.headNdc)}\n`,
      );

      // #468 land-path summary: the review panel leaves the learner exam volume on a real
      // locomotion crossing (side + hidden names read live from portal evidence), while still
      // existing outside it. subjectVisible/firstHitMeshName record the live camera->head raycast
      // verdict and the viseme mixer's driven influences. Derived from the same live run, never typed.
      const reviewPanelSummary = {
        capturedFrom: `${INSPECTION_PATH} (pnpm asset:ui-xr:viseme-drive-capture)`,
        queryUsed: new URL(url).search,
        side: interiorSnapshot?.side ?? "no_portal_evidence",
        portalInteriorHiddenObjectNames: interiorSnapshot?.portalInteriorHiddenObjectNames ?? [],
        panelPresentOutsideEncounter: exteriorPanel.present && exteriorPanel.visible,
        subjectVisible: firstReframe.status === "ok" ? firstReframe.subjectVisible : false,
        firstHitMeshName: firstReframe.status === "ok" ? firstReframe.firstHitMeshName : null,
        visemeInfluences: [...strongByName.entries()].map(([drivenTargetName, v]) => ({
          drivenTargetName,
          influence: Number(v.influence.toFixed(4)),
        })),
      };
      await writeFile(REVIEW_PANEL_SUMMARY_PATH, `${JSON.stringify(reviewPanelSummary, null, 2)}\n`, "utf8");
      process.stdout.write(
        `reviewPanelSummary: ${REVIEW_PANEL_SUMMARY_PATH} side=${reviewPanelSummary.side} panelOutside=${reviewPanelSummary.panelPresentOutsideEncounter} subjectVisible=${reviewPanelSummary.subjectVisible} firstHit=${reviewPanelSummary.firstHitMeshName}\n`,
      );

      // #472 land-path summary: prove the camera anchored on the mouth joint (jaw, or the ruled
      // eye-midpoint / head fallback), not the crown apex. The drop (crown -> aim) and the
      // first-hit verdict are measured in-page; nothing here is typed. fail-closed statuses are
      // recorded as nulls so a broken reframe cannot masquerade as a framed mouth.
      //
      // #726: the artifact also records WHAT it measured — the producer path and the subject's
      // loaded GLB, with per-source fingerprints (bytes + sha256) computed from the bytes this
      // run read. findStaleMeasuredGeometry (#707) refuses the artifact the moment either source
      // no longer matches the tree, so a snapshot can never again be green about a different tree.
      const subjectGlbRepoPath =
        firstReframe.status === "ok"
        && firstReframe.subjectAssetPath
        && firstReframe.subjectAssetPath.startsWith("/")
          ? `apps/ui-xr/public${firstReframe.subjectAssetPath}`
          : null;
      if (subjectGlbRepoPath === null) {
        throw new Error("reframe ok but the subject's loaded GLB path could not be read from the live scene");
      }
      if (!existsSync(subjectGlbRepoPath)) {
        throw new Error(`subject GLB missing from this tree: ${subjectGlbRepoPath}`);
      }
      const fingerprintOf = (repoRelativePath: string): { bytes: number; sha256: string } => {
        const bytes = readFileSync(repoRelativePath);
        return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
      };
      const mouthAnchorSummary = {
        capturedFrom: `${INSPECTION_PATH} (pnpm asset:ui-xr:viseme-drive-capture)`,
        aimJointName: firstReframe.status === "ok" ? firstReframe.aimJointName : null,
        aimWorldY: firstReframe.status === "ok" ? firstReframe.aimWorldY : null,
        crownApexWorldY: firstReframe.status === "ok" ? firstReframe.crownApexWorldY : null,
        anchorWorldPosition: firstReframe.status === "ok" ? firstReframe.anchorWorldPosition : null,
        cameraWorldPosition: firstReframe.status === "ok" ? firstReframe.cameraWorldPosition : null,
        subjectVisible: firstReframe.status === "ok" ? firstReframe.subjectVisible : false,
        firstHitMeshName: firstReframe.status === "ok" ? firstReframe.firstHitMeshName : null,
        subjectInFrame: firstReframe.status === "ok" ? firstReframe.subjectInFrame : false,
        headNdc: firstReframe.status === "ok" ? firstReframe.headNdc : null,
        sources: {
          producer: PRODUCER_REPO_PATH,
          subject_glb: subjectGlbRepoPath,
        },
        fingerprints: {
          producer: fingerprintOf(PRODUCER_REPO_PATH),
          subject_glb: fingerprintOf(subjectGlbRepoPath),
        },
      };
      await writeFile(MOUTH_ANCHOR_SUMMARY_PATH, `${JSON.stringify(mouthAnchorSummary, null, 2)}\n`, "utf8");
      process.stdout.write(
        `mouthAnchor: ${MOUTH_ANCHOR_SUMMARY_PATH} aimJoint=${mouthAnchorSummary.aimJointName} aimY=${mouthAnchorSummary.aimWorldY} crownY=${mouthAnchorSummary.crownApexWorldY} subjectVisible=${mouthAnchorSummary.subjectVisible} firstHit=${mouthAnchorSummary.firstHitMeshName}\n`,
      );
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
  void runVisemeCapture().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
