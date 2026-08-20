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

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { type PortlessDevServer, spawnPortlessDevServer, stopPortlessDevServer } from "./lib/portless-server.js";

const OUTPUT_DIR = ".openclinxr/evidence/viseme-drive-2026-08-06";
const INSPECTION_PATH = path.join(OUTPUT_DIR, "inspection.json");
const SUMMARY_PATH = path.join("tools", "openclinxr", "evidence", "parent-drives-a-real-viseme.json");
/** #465: tracked summary proving the reframe puts the subject's head IN frame (not just ran). */
const REFRAME_SUMMARY_PATH = path.join("tools", "openclinxr", "evidence", "reframe-subject-in-frame.json");

/**
 * face-detail alone keeps natural dialogue duration (~phonemeCount*90ms) so progress spans
 * many visemes. Camera is re-framed in-page onto the parent head (face-detail default looks left).
 */
const CAPTURE_QUERY =
  "openclinxrScenarioId=peds_asthma_parent_anxiety_v1" +
  "&openclinxrCaptureMode=face-detail" +
  "&openclinxrPortalStart=encounter" +
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
  peak: { targetName: string; influence: number; meshName: string } | null;
  /** NEW: why peak is null — "no viseme active" is a legitimate state, not an empty string. */
  noActiveVisemeReason?: string | null;
  speech?: { activeViseme?: string; activePhoneme?: string; activeMouthOpenness?: number } | null;
};

async function sampleParentVisemes(page: Page): Promise<SceneSample> {
  // String IIFE (not a TS arrow) so tsx/esbuild cannot inject `__name` into the browser.
  return page.evaluate(`(() => {
    const win = window;
    const scene = win.__openClinXrDebugScene;
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
        if (hasVisemeTargets) parentMesh = object;
      });
    }

    const readings = [];
    const dict = parentMesh && parentMesh.morphTargetDictionary;
    const influences = parentMesh && parentMesh.morphTargetInfluences;
    if (dict && influences) {
      for (const targetName of Object.keys(dict)) {
        // The parent also ships 32 MPFB FACS (mouth-*) targets driven by the expression
        // path; record only the named viseme_* drive this capture exists to verify.
        if (targetName.toLowerCase().indexOf("viseme_") !== 0) continue;
        const index = dict[targetName];
        if (typeof index !== "number" || index < 0 || index >= influences.length) continue;
        const influence = influences[index] || 0;
        if (influence <= 0.01) continue;
        readings.push({
          meshName: parentMesh.name || "",
          targetName,
          influence,
          index
        });
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
      peak,
      noActiveVisemeReason: peak
        ? null
        : (parentMesh
          ? "no_viseme_target_above_influence_0.01_at_this_instant"
          : "no_viseme_carrying_mesh_in_scene"),
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
  headY: number;
  /** NEW #465: where the head projects in normalised device coords — measured, not asserted. */
  headNdc: { x: number; y: number };
  /** NEW #465: derived from headNdc, never hand-typed. */
  subjectInFrame: boolean;
  /** NEW #465: the head's world Y, geometry-derived (not a literal offset). */
  headWorldY: number;
  /** NEW #465: the Y the camera actually aimed at via lookAt. */
  aimWorldY: number;
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
  status: "no-scene" | "no-camera" | "no-parent-mesh";
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
      if (hasVisemeTargets) {
        // First match wins — the sampler (sampleParentVisemes) stops at the first
        // viseme-carrying mesh, so the camera must frame the same object the sampler reads.
        if (!found.parentMesh) found.parentMesh = object;
      }
    });

    if (!hasPositionApi(found.camera)) return { status: "no-camera" };
    if (!isRecord(found.parentMesh)) return { status: "no-parent-mesh" };
    const camera = found.camera;
    const parentMesh = found.parentMesh;

    // Walk up to the humanoid root for the live actor identity — never a hardcoded label.
    let actorId = null;
    let cursor = parentMesh;
    while (cursor && cursor["parent"]) {
      const ud = cursor["userData"];
      if (ud && typeof ud["openClinXrActorId"] === "string") {
        actorId = ud["openClinXrActorId"];
        break;
      }
      cursor = cursor["parent"];
    }

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
    // #465: the head is the TOP of the body geometry in bind pose, not a literal +1.12 offset
    // calibrated for the child. Derive it from the mesh's own bounds so the adult parent is
    // framed at its actual head height.
    let localHeadY = 1.12;
    const geom = isRecord(parentMesh["geometry"]) ? parentMesh["geometry"] : undefined;
    if (geom) {
      if (typeof geom["computeBoundingBox"] === "function" && !isRecord(geom["boundingBox"])) {
        geom["computeBoundingBox"]();
      }
      const bb = geom["boundingBox"];
      const bbMax = isRecord(bb) ? bb["max"] : undefined;
      if (bbMax && typeof bbMax["y"] === "number") {
        localHeadY = Number(bbMax["y"]);
      }
    }
    // World head top = matrixWorld * local (0, localHeadY, 0). The body is ~centered on its
    // origin in X/Z, so the head projects onto the origin's X/Z at the top Y.
    const headWorld = {
      x: e ? Number(e[4] * localHeadY + e[12]) : px,
      y: e ? Number(e[5] * localHeadY + e[13]) : py + localHeadY,
      z: e ? Number(e[6] * localHeadY + e[14]) : pz
    };
    const aimWorldY = headWorld.y - 0.04;
    // Camera is parented under locomotionRig — convert world aim to parent-local.
    const worldCam = {
      x: headWorld.x + 0.04,
      y: headWorld.y + 0.04,
      z: headWorld.z + 0.72
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
    // lookAt expects world coordinates; aim AT the head, not the mesh origin (#465).
    camera.lookAt(headWorld.x, aimWorldY, headWorld.z);
    camera.fov = 28;
    if (typeof camera.updateProjectionMatrix === "function") camera.updateProjectionMatrix();
    if (typeof camera.updateMatrixWorld === "function") camera.updateMatrixWorld(true);

    // Project the head to normalised device coords so the artifact records WHETHER it is framed,
    // not merely that the reframe ran (#465). status:"ok" 88 times over a wall is the SS6e class.
    const headVec = camera.position.clone();
    headVec.set(headWorld.x, headWorld.y, headWorld.z);
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
    let rdx = headWorld.x - rox;
    let rdy = headWorld.y - roy;
    let rdz = headWorld.z - roz;
    const rlen = Math.sqrt(rdx * rdx + rdy * rdy + rdz * rdz) || 1;
    rdx /= rlen; rdy /= rlen; rdz /= rlen;

    const candidates = [];
    scene.traverse(function (object) {
      if (!isRecord(object)) return;
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
      headY: Number(headWorld.y),
      headNdc,
      subjectInFrame,
      headWorldY: Number(headWorld.y),
      aimWorldY: Number(aimWorldY),
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

export async function runVisemeCapture(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  let server: PortlessDevServer | undefined;
  try {
    server = await spawnPortlessDevServer({
      filter: "@openclinxr/ui-xr",
      readyTimeoutMs: 180_000,
    });

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
      const url = `${server.url}?${CAPTURE_QUERY}`;
      await page.goto(url, { waitUntil: "networkidle", timeout: 180_000 });

      // Wait for the viseme-carrying parent mesh (the only rebaked actor).
      await page.waitForFunction(
        `(() => {
          const scene = window.__openClinXrDebugScene;
          if (!scene || typeof scene.traverse !== "function") return false;
          let found = false;
          scene.traverse(function (o) {
            const dict = o.morphTargetDictionary;
            if (!dict) return;
            for (const k of Object.keys(dict)) {
              if (k.toLowerCase().indexOf("viseme_") === 0) {
                found = true;
                return;
              }
            }
          });
          return found;
        })()`,
        { timeout: 180_000 },
      );

      const reframeOutcomes: ReframeOutcome[] = [];
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
      const framePass: Array<{ t: number; framePath: string; targetName: string }> = [];
      for (let i = 0; i < FRAME_COUNT; i += 1) {
        const target = i * FRAME_STEP_MS;
        const elapsed = Date.now() - t0;
        if (target > elapsed) {
          await page.waitForTimeout(target - elapsed);
        }
        const frameName = `viseme_frame_${String(i).padStart(2, "0")}.png`;
        const framePath = path.join(OUTPUT_DIR, frameName);
        const { t, dominant } = await sampleStates(framePath);
        framePass.push({ t, framePath, targetName: dominant });
        await page.screenshot({ path: framePath, fullPage: false });
      }

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
