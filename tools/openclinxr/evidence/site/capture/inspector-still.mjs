#!/usr/bin/env node
/**
 * Inspector regions capture (card W4a-0): one settled frame of the ED chest
 * pain encounter in the apps/ui-xr shell, recording one projected actor
 * region per blueprint actor id from ed-chest-pain-mod.ts.
 *
 * Drive comes only through openW0Stage({ css: true }) from w0-still.mjs:
 * the same settled frame the w0-proof still shoots. Per-actor regions come
 * from projectActorBbox (harness-lib.mjs); ok rows land under regions,
 * failed rows under missing with their why.
 *
 * Usage: node inspector-still.mjs --out /Volumes/files/openclinxr-assets/store/site-reimagine/inspector
 * Writes <out>/run-<n>/{still.png,regions.json}. No top-level pointer file
 * is written (unlike w0-still.mjs).
 * Card W4a-1a: still.png is shot BEFORE any mask pass; after the shot, one
 * maskExtent per region records mask/ratios/bboxClampedAtCanvasEdge/
 * maskInsideBbox/maskView/viewEqual beside each region. stillView holds the
 * camera + canvas CSS size + devicePixelRatio at the still. These fields are
 * recorded, not gated: no threshold is chosen here.
 * Card w4a1-followup-2: regions.json also records interiorPreviewCamera
 * (camera.userData.openClinXrInteriorPreviewCamera verbatim, null when
 * absent), cameraMode (partial-cast | full-cast | unknown from the
 * recomputed eye height), cameraModeEvidence and cameraModeDetail. Mode never
 * blocks; only a timed-out cast wait pushes the cast-timeout blocker.
 * BLOCKED (exit 1, regions.json is still written in the run dir) when
 * sourceSha != buildSha, pageErrors is
 * non-empty, or blockers is non-empty. PROTECTED rows are recorded, not
 * gated: the W0 rule is control-vs-proof visibility equality, and this
 * script takes only the CSS-on still; the shared drive is gated by the W0
 * same-sha A/B (jobs/w4a0/ab).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  TREE_TOP,
  VIEWPORT,
  buildSha,
  openW0Stage,
  phaseLog,
  pickRunDir,
  protectedVisibility,
  readPngSize,
} from "./w0-still.mjs";
import { projectActorBbox } from "../../xr-sync/harness-lib.mjs";
import { blueprintActorLines, ratiosOf, validateRegions } from "./inspector-regions.mjs";
import { maskExtent } from "./inspector-mask.mjs";

const BLUEPRINT_REPO_PATH = "packages/openclinxr/scenario-fixtures/src/ed-chest-pain-mod.ts";
const SCHEMA = "openclinxr.site-reimagine.inspector-regions.v1";

/**
 * Camera-mode record (card w4a1-followup-2): the run-3/run-4 poses are
 * partial-cast vs full-cast at the product's first-frame latch, not
 * seated/standing (ruling super-ceo-cap23 2026-11-12). Pose source: eyeY =
 * min(castBox.max.y, room cap) at
 * packages/openclinxr/xr-scene/src/interior-preview-camera.ts:181, castBox =
 * union of all scene SkinnedMesh world boxes (collectActorWorldBoxes, same
 * file :256-270), latched on the first frame with roomRoot + >=1 box by
 * applyInteriorPreviewCameraOnce (apps/ui-xr/src/main.ts:3249-3281).
 * Discriminator: at the still, eyeWorld[1] vs the formula recomputed from the
 * recorded userData fields plus per-actor SkinnedMesh world-box tops, within
 * < CAST_MODE_TOLERANCE_M (half the measured mode gap 1.6394 - 1.0949 =
 * 0.5445 m; skinned boxes move with idle animation so no exact match).
 * Mode never blocks: the only camera blocker is a timed-out cast wait.
 */
export const CAST_MODE_TOLERANCE_M = 0.27;
export const CAST_TIMEOUT_BLOCKER = "cast-timeout";
export const CAMERA_MODE_RULE =
  "full-cast iff eyeWorld[1] within < 0.27 m of min(max actor SkinnedMesh world-box top, " +
  "interiorMax[1] - wallThicknessMeters) recomputed at the still from the recorded " +
  "interiorPreviewCamera userData + per-actor tops (formula: interior-preview-camera.ts:181); " +
  "partial-cast iff lower by >= 0.27 m (half the measured run-3/run-4 gap 0.5445 m); " +
  "unknown iff userData absent/incomplete or the cast wait timed out; " +
  "mode never blocks, only a cast timeout pushes cast-timeout";

/** full-cast | partial-cast | unknown from the recomputed eye height. */
export function classifyCastMode({ eyeY, castTopY, roomCapY, castComplete, userDataPresent, toleranceM = CAST_MODE_TOLERANCE_M }) {
  if (castComplete !== true || userDataPresent !== true) {
    return { mode: "unknown", expectedTopY: null, deltaM: null };
  }
  const eye = Number(eyeY);
  const top = Number(castTopY);
  const cap = Number(roomCapY);
  const tol = Number(toleranceM);
  if (Number.isFinite(eye) === false || Number.isFinite(top) === false || Number.isFinite(cap) === false || Number.isFinite(tol) === false) {
    return { mode: "unknown", expectedTopY: null, deltaM: null };
  }
  const expectedTopY = Math.min(top, cap);
  const deltaM = expectedTopY - eye;
  if (deltaM < tol) return { mode: "full-cast", expectedTopY, deltaM };
  return { mode: "partial-cast", expectedTopY, deltaM };
}

/** [] when the cast completed; [CAST_TIMEOUT_BLOCKER] only on cast timeout. Mode never blocks. */
export function castModeBlockers(castOk) {
  return castOk === true ? [] : [CAST_TIMEOUT_BLOCKER];
}

/**
 * Full-cast predicate (the P1 state): every expected actor id is stamped on
 * the debug scene AND roots >=1 SkinnedMesh descendant. Self-contained for
 * page.waitForFunction: (actorIds) -> boolean.
 */
export function castCompletePredicate(actorIds) {
  const debugScene = globalThis.__openClinXrDebugScene;
  if (debugScene === undefined || debugScene === null) return false;
  const ids = Array.isArray(actorIds) ? actorIds : [];
  if (ids.length === 0) return false;
  const roots = [];
  debugScene.traverse((node) => {
    if (node?.userData?.openClinXrActorId === undefined) return;
    if (ids.indexOf(node.userData.openClinXrActorId) === -1) return;
    roots.push(node);
  });
  if (roots.length < ids.length) return false;
  for (const root of roots) {
    let skinned = 0;
    root.traverse((node) => {
      if (node?.isSkinnedMesh === true) skinned += 1;
    });
    if (skinned === 0) return false;
  }
  return true;
}

export const CAST_COMPLETE_TIMEOUT_MS = 120000;

/** Bounded wait on the full-cast predicate. No sleep: page polls the predicate. */
export async function waitForCastComplete(page, actorIds, { timeoutMs = CAST_COMPLETE_TIMEOUT_MS } = {}) {
  try {
    await page.waitForFunction(castCompletePredicate, actorIds, { timeout: timeoutMs });
    return { ok: true };
  } catch (error) {
    return { ok: false, why: `cast never completed: ${error?.message ?? String(error)}` };
  }
}

/** One actor region from exactly one projectActorBbox call. */
export async function regionFor(page, actorId) {
  const read = await projectActorBbox(page, actorId);
  if (read?.ok === true) {
    return { actorId, bbox: read.bbox };
  }
  return { actorId, why: read?.why ?? "unknown projectActorBbox failure" };
}

function blueprintAtHead() {
  const text = execFileSync("git", ["-C", TREE_TOP, "show", `HEAD:${BLUEPRINT_REPO_PATH}`], { encoding: "utf8" });
  return { text, sha256: createHash("sha256").update(text).digest("hex") };
}

export async function readCamera(page) {
  const camera = await page.evaluate(() => {
    const live = globalThis.__openClinXrGazeCamera;
    if (live === undefined || live === null) return null;
    const framing = live.userData?.["openClinXrInteriorPreviewCamera"] ?? null;
    return {
      position: [live.position.x, live.position.y, live.position.z],
      quaternion: [live.quaternion.x, live.quaternion.y, live.quaternion.z, live.quaternion.w],
      fov: live.fov ?? null,
      interiorPreviewCamera: framing === null ? null : { ...framing },
    };
  });
  if (camera === null) return null;
  return { source: "__openClinXrGazeCamera", ...camera };
}

/**
 * Per-actor SkinnedMesh world-box tops at the still (in-page, self-contained).
 * Mirrors the projectActorBbox corner projection (harness-lib.mjs) but keeps
 * only max world y per stamped actor root. Returns { ok, tops, missing }.
 */
export function readCastTops(actorIds) {
  const scene = globalThis.__openClinXrDebugScene;
  if (scene === undefined || scene === null) {
    return { ok: false, why: "no window.__openClinXrDebugScene", tops: {}, missing: [] };
  }
  const ids = Array.isArray(actorIds) ? actorIds : [];
  if (typeof scene.updateMatrixWorld === "function") scene.updateMatrixWorld(true);
  const tops = {};
  const missing = [];
  for (const actorId of ids) {
    let root = null;
    scene.traverse((node) => {
      if (root !== null) return;
      if (node?.userData?.openClinXrActorId === actorId) root = node;
    });
    if (root === null) {
      tops[actorId] = null;
      missing.push(actorId);
      continue;
    }
    let top = -Infinity;
    root.traverse((node) => {
      if (node?.isSkinnedMesh !== true) return;
      const geometry = node.geometry;
      if (geometry === null || geometry === undefined) return;
      if (geometry.boundingBox === null || geometry.boundingBox === undefined) {
        if (typeof geometry.computeBoundingBox === "function") geometry.computeBoundingBox();
      }
      const box = geometry.boundingBox;
      if (box === null || box === undefined) return;
      const Vector3 = node.position.constructor;
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            const v = new Vector3(x, y, z).applyMatrix4(node.matrixWorld);
            if (v.y > top) top = v.y;
          }
        }
      }
    });
    if (top === -Infinity) {
      tops[actorId] = null;
      missing.push(actorId);
    } else {
      tops[actorId] = top;
    }
  }
  return { ok: true, tops, missing };
}

/** Fields the M2 discriminator needs from the recorded interiorPreviewCamera userData. */
export const CAST_MODE_USERDATA_FIELDS = ["eyeWorld", "interiorMax", "wallThicknessMeters"];

async function readCanvasRect(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("station-canvas");
    if (canvas === null) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

async function readDevicePixelRatio(page) {
  return page.evaluate(() => globalThis.window?.devicePixelRatio ?? 1);
}

/** View snapshot: camera + canvas CSS size + devicePixelRatio. Recorded, not gated. */
async function readView(page) {
  const camera = await readCamera(page);
  const canvasRect = await readCanvasRect(page);
  const devicePixelRatio = await readDevicePixelRatio(page);
  return { camera, canvasRect, devicePixelRatio };
}

function viewsEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** True when the bbox edge touches the canvas edge (projectActorBbox clamps). */
function bboxTouchesCanvasEdge(bbox, canvasRect) {
  if (bbox == null || canvasRect == null) return null;
  const edges = [
    bbox.x === canvasRect.x,
    bbox.y === canvasRect.y,
    bbox.x + bbox.width === canvasRect.x + canvasRect.width,
    bbox.y + bbox.height === canvasRect.y + canvasRect.height,
  ];
  return edges.some(Boolean);
}

/** True when the mask rect lies fully inside the bbox. Recorded, not gated. */
function maskInsideBboxRect(bbox, maskRect) {
  if (bbox == null || maskRect == null) return null;
  return (
    maskRect.x >= bbox.x &&
    maskRect.y >= bbox.y &&
    maskRect.x + maskRect.width <= bbox.x + bbox.width &&
    maskRect.y + maskRect.height <= bbox.y + bbox.height
  );
}

export async function captureInspectorRun({ out } = {}) {
  if (typeof out !== "string" || out === "") {
    const error = new Error("usage: node inspector-still.mjs --out <inspector root>");
    console.error(`BLOCKED ${error.message}`);
    process.exitCode = 1;
    throw error;
  }
  const root = resolve(out);
  const { dir: runDir, n: runN } = pickRunDir(root);
  const runTag = `run-${runN}`;
  phaseLog(runDir, "start");
  phaseLog(runDir, `argv ${JSON.stringify(process.argv.slice(2))}`);
  const heartbeat = setInterval(() => phaseLog(runDir, "alive"), 5000);
  heartbeat.unref();

  const sourceSha = execFileSync("git", ["-C", TREE_TOP, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const blueprint = blueprintAtHead();
  const actorLines = blueprintActorLines(blueprint.text);
  const actorIds = [...actorLines.keys()];

  const regions = [];
  const missing = [];
  let camera = null;
  let canvasRect = null;
  let still = null;
  let protectedRows = [];
  const stage = await openW0Stage({ css: true, runDir });
  const { page, pageErrors, consoleErrors, close } = stage;
  try {
    protectedRows = await protectedVisibility(page);

    const castWait = await waitForCastComplete(page, actorIds);
    phaseLog(runDir, `cast complete=${castWait.ok}${castWait.ok === true ? "" : ` why=${castWait.why}`}`);

    camera = await readCamera(page);
    canvasRect = await readCanvasRect(page);

    for (const actorId of actorIds) {
      const row = await regionFor(page, actorId);
      if ("bbox" in row) {
        regions.push({ actorId: row.actorId, lines: actorLines.get(actorId) ?? [], bbox: row.bbox });
      } else {
        missing.push({ actorId: row.actorId, why: row.why });
      }
    }
    const stillPath = join(runDir, "still.png");
    await page.screenshot({ path: stillPath, timeout: 30000 });
    const size = readPngSize(stillPath);
    still = {
      file: `${runTag}/still.png`,
      sha256: createHash("sha256").update(readFileSync(stillPath)).digest("hex"),
      width: size.width,
      height: size.height,
    };
    phaseLog(runDir, `shot still bytes=${size.bytes}`);
    const stillView = await readView(page);
    const castTops = await page.evaluate(readCastTops, actorIds);

    const framing = stillView.camera?.interiorPreviewCamera ?? null;
    const missingUserDataFields = CAST_MODE_USERDATA_FIELDS.filter(
      (field) => framing?.[field] === undefined || framing?.[field] === null,
    );
    const eyeY = Number(framing?.eyeWorld?.[1]);
    const roomCapY = Number(framing?.interiorMax?.[1]) - Number(framing?.wallThicknessMeters);
    const tops = castTops?.ok === true ? castTops.tops : null;
    const topValues = actorIds.map((actorId) => tops?.[actorId]).filter((value) => Number.isFinite(value));
    const missingTops = actorIds.filter((actorId) => Number.isFinite(tops?.[actorId]) === false);
    const userDataPresent = framing !== null && framing !== undefined && missingUserDataFields.length === 0
      && Number.isFinite(eyeY) && Number.isFinite(roomCapY) && missingTops.length === 0;
    const castMode = classifyCastMode({
      eyeY,
      castTopY: topValues.length > 0 ? Math.max(...topValues) : null,
      roomCapY,
      castComplete: castWait.ok === true,
      userDataPresent,
    });
    const cameraModeEvidence = userDataPresent && castWait.ok === true
      ? `eyeWorld.y=${eyeY} vs recomputed min(castTop=${Math.max(...topValues)}, roomCap=${roomCapY})=${castMode.expectedTopY} delta=${castMode.deltaM}m tol=${CAST_MODE_TOLERANCE_M}m -> ${castMode.mode}; cast complete`
      : `unknown: castComplete=${castWait.ok}` +
        (missingUserDataFields.length > 0 ? ` missingUserDataFields=${missingUserDataFields.join(",")}` : "") +
        (missingTops.length > 0 ? ` missingTops=${missingTops.join(",")}` : "") +
        (castTops?.ok === true ? "" : ` castTopsWhy=${castTops?.why ?? "unknown"}`);
    const cameraMode = castMode.mode;
    phaseLog(runDir, `camera mode ${cameraMode} ${cameraModeEvidence}`);

    for (const region of regions) {
      const maskRead = await maskExtent(page, region.actorId);
      const maskView = await readView(page);
      if (maskRead?.ok === true) {
        region.mask = {
          rect: maskRead.maskRect,
          pixelCount: maskRead.pixelCount,
          meshCount: maskRead.meshCount,
          meshNames: maskRead.meshNames,
          histogram: maskRead.histogram,
        };
        region.ratios = ratiosOf(region.bbox, maskRead.maskRect);
      } else {
        region.mask = null;
        region.ratios = null;
        region.maskError = maskRead?.why ?? "unknown maskExtent failure";
      }
      region.bboxClampedAtCanvasEdge = bboxTouchesCanvasEdge(region.bbox, stillView.canvasRect);
      region.maskInsideBbox = maskInsideBboxRect(region.bbox, maskRead?.maskRect ?? null);
      region.maskView = maskView;
      region.viewEqual = viewsEqual(stillView, maskView);
      if (region.viewEqual !== true) {
        phaseLog(runDir, `view moved during mask pass for ${region.actorId}`);
      }
    }

    const build = buildSha();
    const viewport = { width: VIEWPORT.width, height: VIEWPORT.height };
    const blockers = validateRegions({ canvasRect, viewport, regions }, actorIds);
    blockers.push(...castModeBlockers(castWait.ok));
    const regionsJson = {
      schema: SCHEMA,
      run: runTag,
      sourceSha,
      buildSha: build,
      viewport,
      camera,
      canvasRect,
      still,
      stillView,
      castComplete: castWait.ok,
      castError: castWait.why ?? null,
      interiorPreviewCamera: framing,
      cameraMode,
      cameraModeRule: CAMERA_MODE_RULE,
      cameraModeEvidence,
      cameraModeDetail: { expectedTopY: castMode.expectedTopY, deltaM: castMode.deltaM },
      blueprint: { path: BLUEPRINT_REPO_PATH, sha256: blueprint.sha256, actorLines: Object.fromEntries(actorLines) },
      regions,
      missing,
      protected: protectedRows,
      pageErrors,
      consoleErrors,
      blockers,
    };
    writeFileSync(join(runDir, "regions.json"), `${JSON.stringify(regionsJson, null, 2)}\n`, "utf8");
    const blocked = sourceSha !== build || pageErrors.length > 0 || blockers.length > 0;
    if (blocked) {
      console.error(`BLOCKED inspector ${runTag} sourceSha=${sourceSha} buildSha=${build} blockers=${JSON.stringify(blockers)}`);
      process.exitCode = 1;
    } else {
      console.log(`inspector regions done ${runTag} regions=${regions.length} missing=${missing.length}`);
    }
    console.log(`wrote ${join(runDir, "regions.json")}`);
  } finally {
    clearInterval(heartbeat);
    await close();
  }
}

const isEntryScript =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntryScript) {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  const root = outIdx === -1 ? undefined : argv[outIdx + 1];
  await captureInspectorRun({ out: root }).catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
