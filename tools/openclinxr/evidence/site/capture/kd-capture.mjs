#!/usr/bin/env node
/**
 * KD capture driver (card WKD stage 2, S3). The OWNER runs this, one label at a
 * time, against the matching tree's own build:
 *
 *   node tools/openclinxr/evidence/site/capture/kd-capture.mjs \
 *     --tree <worktree path> --label A1 --out /Volumes/files/openclinxr-assets/store/site-reimagine/kd
 *   ... --label A2|A3|B|C (same --out; A2+ reuse the A1 run dir)
 *
 * A1 creates kd/run-N/; later labels append to the latest run. Each label shells
 * out to THAT TREE's own inspector-still.mjs (the exact inspector capture path:
 * same seed, camera preset, viewport 960x600, channel chromium,
 * --use-angle=metal), then lays out kd/run-N/<label>/{still.png,regions.json}
 * and appends the label to kd/run-N/capture.json.
 *
 * The fixture edit lives only in the B and C trees (made by the owner). This
 * driver never edits a fixture; it records the tree's blueprint diff sha256.
 * B/C trees must carry the edit as an UNCOMMITTED diff vs their HEAD, so that
 * `git diff HEAD -- <blueprint>` shows it; kd-verdict.mjs fails closed otherwise.
 *
 * PINNED PAIR (stage 4, P1): `--camera-from <run-N/A1/regions.json>` drives the
 * driver's OWN Playwright page (new code, website-wkd only) against the TARGET
 * tree's build — no code is copied into B/C, which are detached at 24a5314b8
 * and carry none of this. ROUTE: serve `<tree>/apps/ui-xr/dist` (the target's
 * built app, including its refreshed public bundles) with the shared static
 * server, and boot the encounter server from `<tree>`'s own dist server +
 * stack + fixtures (dynamic file-URL import; bare imports inside resolve via
 * that tree's node_modules, which the owner installed to refresh the bundles).
 * The driver code (waits, pin, screenshot, masks) runs from website-wkd, but
 * every rendered byte and every scenario datum comes from the target tree.
 * After the cast-complete latch the driver sets `__openClinXrGazeCamera`
 * position/quaternion/fov from A1's recorded camera (in-page evaluate — no
 * shipped hook is touched), re-renders, screenshots, reads the camera back,
 * and records it. A2/A3/B/C require --camera-from pointing at their own run's
 * A1 regions.json; A1 with --camera-from is BLOCKED (A1 is the pin source).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GPU_ARGS, VIEWPORT } from "./capture-instrument.mjs";
import { KD_PINNED_DRIVER, liveCameraDiff, liveCamerasEqual } from "./kd-diff.mjs";
import { startStaticServer } from "../../xr-sync/harness-lib.mjs";
import { maskExtent } from "./inspector-mask.mjs";
import {
  blueprintActorBlocks,
  blueprintActorLines,
  ratiosOf,
  redactHiddenFacts,
} from "./inspector-regions.mjs";
import {
  DOORWAY_SECONDS,
  ENCOUNTER_WAIT_MS,
  JOIN_WAIT_MS,
  applyPresentationCss,
  pause,
  readPngSize,
  waitStableHumanoids,
} from "./w0-still.mjs";
import { readCamera, regionFor, waitForCastComplete } from "./inspector-still.mjs";

export const KD_SEED = "kd-ed-chest-pain-settled";
export const KD_CAMERA_PRESET = "station-layout-default";
export const KD_LABELS = ["A1", "A2", "A3", "B", "C"];
export const KD_BLUEPRINT_REPO_PATH = "packages/openclinxr/scenario-fixtures/src/ed-chest-pain-mod.ts";
export const KD_CAPTURE_SCHEMA = "openclinxr.site-reimagine.kd-capture.v1";
export const KD_PINNED_SCHEMA = "openclinxr.site-reimagine.kd-pinned-regions.v1";

/**
 * Driver fingerprint (stage 4c, F3): sha256 of presentation.css and of every
 * website-wkd capture module this driver loads, plus the driver tree HEAD and
 * whether those files are dirty. Recorded per label; kd-verdict refuses runs
 * whose labels disagree.
 */
const KD_DRIVER_FILES = [
  "tools/openclinxr/evidence/site/capture/kd-capture.mjs",
  "tools/openclinxr/evidence/site/capture/capture-instrument.mjs",
  "tools/openclinxr/evidence/site/capture/kd-diff.mjs",
  "tools/openclinxr/evidence/xr-sync/harness-lib.mjs",
  "tools/openclinxr/evidence/site/capture/inspector-mask.mjs",
  "tools/openclinxr/evidence/site/capture/inspector-regions.mjs",
  "tools/openclinxr/evidence/site/capture/w0-still.mjs",
  "tools/openclinxr/evidence/site/capture/inspector-still.mjs",
  "tools/openclinxr/evidence/site/capture/presentation.css",
];
const DRIVER_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../../");

function driverFingerprint() {
  const files = {};
  for (const rel of KD_DRIVER_FILES) {
    files[rel] = createHash("sha256").update(readFileSync(join(DRIVER_ROOT, rel))).digest("hex");
  }
  const head = execFileSync("git", ["-C", DRIVER_ROOT, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 60000 }).trim();
  const status = execFileSync("git", ["-C", DRIVER_ROOT, "status", "--short", "--", ...KD_DRIVER_FILES], { encoding: "utf8", timeout: 60000 }).trim();
  return {
    driverTreeHead: head,
    dirty: status !== "",
    dirtyFiles: status === "" ? [] : status.split("\n"),
    files,
  };
}

function fail(why) {
  console.error(`KD-CAPTURE BLOCKED ${why}`);
  process.exitCode = 1;
  throw new Error(why);
}

function runNumbers(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^run-\d+$/.test(entry.name))
    .map((entry) => Number(entry.name.slice(4)))
    .filter((n) => Number.isInteger(n));
}

function latestRunDir(root) {
  const numbers = runNumbers(root);
  if (numbers.length === 0) return null;
  return join(root, `run-${Math.max(...numbers)}`);
}

function git(tree, args) {
  return execFileSync("git", ["-C", tree, ...args], { encoding: "utf8", timeout: 60000 });
}

export async function runCapture({ tree, label, out, cameraFrom } = {}) {
  if (typeof tree !== "string" || tree === "") fail("usage: kd-capture.mjs --tree <path> --label <A1|A2|A3|B|C> --out <kd root> --camera-from <A1 regions.json>");
  if (!KD_LABELS.includes(label)) fail(`label must be one of ${KD_LABELS.join(",")}, got ${label}`);
  if (typeof out !== "string" || out === "") fail("usage: kd-capture.mjs --tree <path> --label <A1|A2|A3|B|C> --out <kd root> --camera-from <A1 regions.json>");
  if (typeof cameraFrom !== "string" || cameraFrom === "") {
    fail("one path: every arm A1-C goes through runPinnedCapture with the SAME --camera-from source");
  }
  return runPinnedCapture({ tree, label, out, cameraFrom });
}

async function writeCaptureEntry({ runDir, runTag, entry, pinned, cameraFrom }) {
  const capturePath = join(runDir, "capture.json");
  let capture;
  if (entry.label === "A1" || !existsSync(capturePath)) {
    capture = { schema: KD_CAPTURE_SCHEMA, run: runTag, seed: KD_SEED, cameraPreset: KD_CAMERA_PRESET, viewport: { width: VIEWPORT.width, height: VIEWPORT.height }, labels: {} };
  } else {
    capture = JSON.parse(readFileSync(capturePath, "utf8"));
  }
  capture.labels[entry.label] = entry;
  capture.updatedAt = entry.capturedAt;
  if (pinned === true) {
    capture.pinned = true;
    capture.cameraFrom = cameraFrom;
  }
  writeFileSync(capturePath, `${JSON.stringify(capture, null, 2)}\n`, "utf8");
}

/**
 * Pinned capture (stage 4, P1; stage 4b: the ONLY path — every arm A1-C runs
 * here with the SAME --camera-from source, so the noise floor never mixes
 * capture paths). The driver's own page against the TARGET tree's build.
 */
export async function runPinnedCapture({ tree, label, out, cameraFrom } = {}) {
  const treeRoot = resolve(tree);
  const kdRoot = resolve(out);
  mkdirSync(kdRoot, { recursive: true });
  const pinPath = resolve(cameraFrom);
  if (!existsSync(pinPath)) fail(`pin source not found: ${pinPath}`);
  const pinBytes = readFileSync(pinPath);
  const pinSha = createHash("sha256").update(pinBytes).digest("hex");

  let runDir;
  if (label === "A1") {
    const numbers = runNumbers(kdRoot);
    const n = numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
    runDir = join(kdRoot, `run-${n}`);
    mkdirSync(runDir, { recursive: true });
  } else {
    const latest = latestRunDir(kdRoot);
    if (latest === null) fail(`no run dir yet for label ${label}: capture A1 first`);
    runDir = latest;
  }
  const runTag = runDir.split("/").at(-1);
  const runCapturePath = join(runDir, "capture.json");
  if (existsSync(runCapturePath)) {
    const runCapture = JSON.parse(readFileSync(runCapturePath, "utf8"));
    const first = runCapture?.cameraFrom;
    if (first != null && (first.path !== pinPath || first.sha256 !== pinSha)) {
      fail(`${label} cameraFrom mismatch: got {path: ${pinPath}, sha256: ${pinSha.slice(0, 12)}} but run ${runTag} pins {path: ${first.path}, sha256: ${String(first.sha256).slice(0, 12)}}`);
    }
  }
  const pinDoc = JSON.parse(pinBytes.toString("utf8"));
  const pinCam = pinDoc?.camera;
  for (const key of ["position", "quaternion", "fov"]) {
    if (pinCam?.[key] == null) fail(`pin source carries no camera.${key}: ${pinPath}`);
  }
  const pinEye = pinCam?.interiorPreviewCamera?.eyeWorld;
  const pinLook = pinCam?.interiorPreviewCamera?.lookAtWorld;
  if (!Array.isArray(pinEye) || !Array.isArray(pinLook)) {
    fail(`pin source carries no interiorPreviewCamera eyeWorld/lookAtWorld: ${pinPath}`);
  }

  const appDist = join(treeRoot, "apps", "ui-xr", "dist");
  if (!existsSync(join(appDist, "index.html"))) fail(`no built app in tree: ${appDist}`);
  const toUrl = (rel) => pathToFileURL(join(treeRoot, rel)).href;
  const { createEncounterServer } = await import(toUrl("packages/openclinxr/xr-sync-server/dist/index.js"));
  const { resolveDevStack } = await import(toUrl("packages/openclinxr/xr-sync-server/dist/dev-stack.js"));
  const fixtures = await import(toUrl("packages/openclinxr/scenario-fixtures/dist/index.js"));
  const stack = resolveDevStack({ XR_SYNC_DOORWAY_SECONDS: DOORWAY_SECONDS }, {
    scenarioBank: fixtures.scenarioBank,
    scenarioDialogueSeedBank: fixtures.scenarioDialogueSeedBank,
  });
  const server = await createEncounterServer({
    examBlueprint: stack.examBlueprint,
    scenarios: stack.scenarios,
    dialogueSeeds: stack.dialogueSeeds,
  });
  let staticServer = null;
  let browser = null;
  const close = async () => {
    if (browser !== null) await browser.close().catch(() => undefined);
    if (staticServer !== null) await staticServer.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  };
  const labelDir = join(runDir, label);
  try {
    staticServer = await startStaticServer(appDist);
    const pageUrl = `http://127.0.0.1:${staticServer.port}/?encounterSync=${encodeURIComponent(server.url)}`;
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true, channel: "chromium", args: GPU_ARGS });
    const pageErrors = [];
    const consoleErrors = [];
    const context = await browser.newContext({ viewport: { width: VIEWPORT.width, height: VIEWPORT.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 300)));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
    });
    await page.goto(pageUrl, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(
      () => window.__openClinXrEncounterSync !== undefined && window.__openClinXrEncounterSync.state !== "joining",
      undefined,
      { timeout: JOIN_WAIT_MS },
    );
    const openedBy = Date.now() + ENCOUNTER_WAIT_MS;
    for (;;) {
      let snap = null;
      try {
        snap = JSON.parse(server.getStateJSON());
      } catch {
        snap = null;
      }
      if (snap !== null && snap.phase === "encounter") break;
      if (Date.now() > openedBy) fail(`encounter phase never opened: ${JSON.stringify(snap)}`);
      await pause(500);
    }
    await waitStableHumanoids(page);
    await applyPresentationCss(page);

    const blueprintText = git(treeRoot, ["show", `HEAD:${KD_BLUEPRINT_REPO_PATH}`]);
    const blueprintSha = createHash("sha256").update(blueprintText, "utf8").digest("hex");
    const actorLines = blueprintActorLines(blueprintText);
    const actorBlocks = redactHiddenFacts(blueprintActorBlocks(blueprintText, KD_BLUEPRINT_REPO_PATH));
    const actorIds = [...actorLines.keys()];
    const castWait = await waitForCastComplete(page, actorIds);
    if (!castWait.ok) fail(`cast never completed: ${castWait.why}`);

    await page.evaluate(({ position, quaternion, fov }) => {
      const cam = window.__openClinXrGazeCamera;
      cam.position.set(position[0], position[1], position[2]);
      cam.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
      cam.fov = fov;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
    }, { position: pinCam.position, quaternion: pinCam.quaternion, fov: pinCam.fov });
    await page.evaluate(
      () => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))),
    );

    rmSync(labelDir, { recursive: true, force: true });
    mkdirSync(labelDir, { recursive: true });
    const readBackBefore = await readCamera(page);
    if (readBackBefore === null) fail("no live gaze camera after pin");
    const stillPath = join(labelDir, "still.png");
    await page.screenshot({ path: stillPath, timeout: 30000 });
    const stillBytes = readFileSync(stillPath);
    const size = readPngSize(stillPath);
    const readBackAfter = await readCamera(page);
    if (readBackAfter === null) fail("no live gaze camera after shot");
    if (!liveCamerasEqual(readBackBefore, readBackAfter)) {
      fail(`pinned ${label} read-back moved between shot: before=${JSON.stringify(liveCameraDiff(readBackBefore, readBackAfter))}`);
    }

    const camera = {
      requestedPin: {
        position: [...pinCam.position],
        quaternion: [...pinCam.quaternion],
        fov: pinCam.fov,
        eyeWorld: [...pinEye],
        lookAtWorld: [...pinLook],
      },
      readBackBefore,
      readBackAfter,
      derivedInteriorPreviewCamera: readBackAfter.interiorPreviewCamera,
    };
    const canvasRect = await page.evaluate(() => {
      const canvas = document.getElementById("station-canvas");
      if (canvas === null) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const devicePixelRatio = await page.evaluate(() => globalThis.window?.devicePixelRatio ?? 1);

    const regions = [];
    const missing = [];
    for (const actorId of actorIds) {
      const row = await regionFor(page, actorId);
      if ("bbox" in row) {
        regions.push({ actorId: row.actorId, lines: actorLines.get(actorId) ?? [], blocks: actorBlocks.get(actorId) ?? [], bbox: row.bbox });
      } else {
        missing.push({ actorId: row.actorId, why: row.why });
      }
    }
    for (const region of regions) {
      const maskRead = await maskExtent(page, region.actorId);
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
    }

    const headSha = git(treeRoot, ["rev-parse", "HEAD"]).trim();
    const sourceSha = headSha;
    const blockers = missing.map((row) => `missing:${row.actorId}`);
    if (pageErrors.length > 0) blockers.push("page-errors");
    const regionsDoc = {
      schema: KD_PINNED_SCHEMA,
      run: runTag,
      label,
      sourceSha,
      buildSha: headSha,
      viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
      camera,
      canvasRect,
      still: {
        file: `${label}/still.png`,
        sha256: createHash("sha256").update(stillBytes).digest("hex"),
        width: size.width,
        height: size.height,
      },
      stillView: { camera, canvasRect, devicePixelRatio },
      castComplete: castWait.ok,
      blueprint: {
        path: KD_BLUEPRINT_REPO_PATH,
        sha256: blueprintSha,
        actorLines: Object.fromEntries(actorLines),
      },
      regions,
      missing,
      protected: [],
      pageErrors,
      consoleErrors,
      blockers,
      pinnedFrom: { path: pinPath, sha256: pinSha },
    };
    writeFileSync(join(labelDir, "regions.json"), `${JSON.stringify(regionsDoc, null, 2)}\n`, "utf8");
    if (blockers.length > 0) fail(`pinned ${label} blocked: ${JSON.stringify(blockers)}`);

    const diffText = git(treeRoot, ["diff", "HEAD", "--", KD_BLUEPRINT_REPO_PATH]);
    const entry = {
      label,
      tree: treeRoot,
      buildSha: headSha,
      sourceSha,
      treeDiffSha256: createHash("sha256").update(diffText, "utf8").digest("hex"),
      blueprint: { path: KD_BLUEPRINT_REPO_PATH, sha256: blueprintSha },
      seed: KD_SEED,
      cameraPreset: KD_CAMERA_PRESET,
      camera,
      stillView: regionsDoc.stillView,
      cameraMode: null,
      viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
      browserArgs: ["channel:chromium", ...GPU_ARGS],
      still: {
        file: `${label}/still.png`,
        sha256: createHash("sha256").update(stillBytes).digest("hex"),
        width: size.width,
        height: size.height,
      },
      regionsFile: `${label}/regions.json`,
      pinned: true,
      capturePath: KD_PINNED_DRIVER,
      pinnedFrom: { path: pinPath, sha256: pinSha },
      driverFingerprint: driverFingerprint(),
      capturedAt: new Date().toISOString(),
    };
    await writeCaptureEntry({
      runDir,
      runTag,
      entry,
      pinned: true,
      cameraFrom: { path: pinPath, sha256: pinSha },
    });
    console.log(`kd pinned capture ${runTag}/${label} build=${headSha.slice(0, 12)}`);
    return { runDir, label };
  } finally {
    await close();
  }
}

const isEntryScript =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntryScript) {
  const argv = process.argv.slice(2);
  const pick = (flag) => {
    const idx = argv.indexOf(flag);
    return idx === -1 ? undefined : argv[idx + 1];
  };
  await runCapture({ tree: pick("--tree"), label: pick("--label"), out: pick("--out"), cameraFrom: pick("--camera-from") }).catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
