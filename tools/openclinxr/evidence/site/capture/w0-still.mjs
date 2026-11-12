#!/usr/bin/env node
/**
 * W0 proof still (card W0): one settled frame of the ED chest pain encounter
 * in the apps/ui-xr shell, shot three times (control-a, control-b without the
 * presentation CSS, w0-proof with it).
 *
 * Stack (same host stack c36-run.mjs uses, no runner code copied):
 * - sync server: in-process createEncounterServer with resolveDevStack env
 *   { XR_SYNC_DOORWAY_SECONDS: "90" } (c36-run.mjs:190 parity), the library
 *   entrypoint dev-server.ts:92-96 blesses for harnesses; no pnpm/portless
 *   child process is spawned.
 * - static app: startStaticServer imported from harness-lib.mjs (the helper
 *   c36-run.mjs:149 uses to serve apps/ui-xr/dist).
 * - browser: repo-canonical GPU launch (channel chromium, --use-angle=metal,
 *   cf. c55-stills.mjs:37). runHostProbe (harness-lib.mjs:221) hardcodes
 *   chromium.launch without a channel, which cannot take channel chromium, so
 *   the drive contract below mirrors runHostProbe (viewport 960x600, pageerror
 *   and console-error collectors, waitUntil load) with the GPU launch inline.
 * - no spoken or typed turn: the drive only joins, waits for the encounter
 *   phase, waits for a 2 s-stable humanoid count, then shoots. No say/ffmpeg
 *   fixture, no getUserMedia shim, no encounterMicInject param.
 * - camera/scene time: default station-layout view, no capture query param
 *   (generated-scene default already hides in-scene evidence panels, identity
 *   labels, affordance markers and primitive fallbacks), no input dispatched,
 *   viewport 800x600 dpr 1 fixed; the three stills are taken back-to-back with
 *   only the CSS injection between control-b and w0-proof. Per-still server
 *   phase/remaining, perfNowMs and humanoid signature are recorded to show
 *   one settled frame.
 *
 * Subject bbox: projected bounding box of the patient humanoid, computed
 * in-page from window.__openClinXrDebugScene (apps/ui-xr/src/main.ts:2783)
 * via the userData.openClinXrActorId stamp
 * (packages/openclinxr/xr-station-room/src/actor-staging.ts patient slot),
 * projected with window.__openClinXrGazeCamera (main.ts:2809) into
 * #station-canvas CSS pixels (= screenshot pixels at dpr 1).
 *
 * Usage: node w0-still.mjs --out /Volumes/files/openclinxr-assets/store/site-reimagine/w0
 * Writes <out>/run-<n>/{control-a,control-b,w0-proof}.png + capture.json and
 * refreshes <out>/capture.json to the newest run's content plus run: <n>.
 * Exit 1 prints BLOCKED and writes no capture.json pointer.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GPU_ARGS, VIEWPORT } from "./capture-instrument.mjs";
import { planCapture } from "./rr1.mjs";
import { startStaticServer } from "../../xr-sync/harness-lib.mjs";
import { readCamera } from "./inspector-still.mjs";

export { GPU_ARGS, VIEWPORT } from "./capture-instrument.mjs";

export const SCRIPT_DIR = fileURLToPath(new URL("./", import.meta.url));
export const TREE_TOP = resolve(SCRIPT_DIR, "..", "..", "..", "..", "..");
export const APP_DIST = join(TREE_TOP, "apps", "ui-xr", "dist");
export const SERVER_INDEX = join(TREE_TOP, "packages", "openclinxr", "xr-sync-server", "dist", "index.js");
export const SERVER_STACK = join(TREE_TOP, "packages", "openclinxr", "xr-sync-server", "dist", "dev-stack.js");
export const FIXTURES_INDEX = join(TREE_TOP, "packages", "openclinxr", "scenario-fixtures", "dist", "index.js");
export const CSS_PATH = join(SCRIPT_DIR, "presentation.css");

export const DOORWAY_SECONDS = "90";
const POLL_MS = 250;
const STABLE_POLLS = 8;
const STABLE_WAIT_MS = 120000;
export const JOIN_WAIT_MS = 240000;
export const ENCOUNTER_WAIT_MS = 240000;

// Debug-chrome selectors hidden for the proof still (presentation.css owns
// the rules; this table owns the order, source lines, and runtime checks).
const SELECTORS = [
  { selector: ".status-strip", source: "apps/ui-xr/src/main.ts:1532" },
  { selector: ".trace-panel", source: "apps/ui-xr/src/main.ts:1561" },
  { selector: ".exam-flow-panel", source: "apps/ui-xr/src/main.ts:1565" },
  { selector: 'section[aria-label="Reactive room state"]', source: "apps/ui-xr/src/main.ts:1580" },
  { selector: 'section[aria-label="Runtime posture"]', source: "apps/ui-xr/src/main.ts:1584" },
  { selector: 'section[aria-label="Quest manual evidence"]', source: "apps/ui-xr/src/main.ts:1596" },
];

// Lane-owner STEER 2: capability UI the site claims (doorway countdown, typed
// question box, captions, repeat prompt) must stay visible. This PROTECTED
// table names them so capture.json records per-element visibility in the
// control and proof stills, and the artifact test reds if any of them is
// hidden by the presentation CSS.
export const PROTECTED = [
  { selector: "#room-countdown", source: "packages/openclinxr/xr-sync-client/src/encounter-room-panel.ts:19" },
  { selector: "#room-refusal", source: "packages/openclinxr/xr-sync-client/src/encounter-room-panel.ts:23" },
  { selector: "#room-note", source: "packages/openclinxr/xr-sync-client/src/encounter-room-panel.ts:39" },
  { selector: "#utterance-input", source: "packages/openclinxr/xr-sync-client/src/encounter-turns.ts:448" },
  { selector: "#utterance-send", source: "packages/openclinxr/xr-sync-client/src/encounter-turns.ts:452" },
  { selector: "#learner-caption", source: "packages/openclinxr/xr-sync-client/src/encounter-turns.ts:434" },
  { selector: "#repeat-prompt", source: "packages/openclinxr/xr-sync-client/src/encounter-turns.ts:431" },
];

function failBlocked(why) {
  console.error(`BLOCKED ${why}`);
  process.exitCode = 1;
  throw new Error(why);
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function readPngSize(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") {
    failBlocked(`not a PNG still: ${path}`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length };
}

export function pause(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

export function buildSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: TREE_TOP, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export function pickRunDir(root) {
  let n = 1;
  while (existsSync(join(root, `run-${n}`))) n += 1;
  const dir = join(root, `run-${n}`);
  mkdirSync(dir, { recursive: true });
  return { dir, n };
}

export function phaseLog(runDir, mark) {
  writeFileSync(join(runDir, "w0-progress.log"), `${new Date().toISOString()} ${mark}\n`, { flag: "a" });
}

let liveRunDir = null;
process.on("uncaughtException", (error) => {
  const line = `UNCAUGHT ${String(error?.stack ?? error).slice(0, 500)}`;
  if (liveRunDir !== null) {
    try {
      phaseLog(liveRunDir, line);
    } catch {}
  }
  console.error(line);
  process.exitCode = 1;
});
process.on("unhandledRejection", (reason) => {
  const line = `UNHANDLED ${String(reason).slice(0, 500)}`;
  if (liveRunDir !== null) {
    try {
      phaseLog(liveRunDir, line);
    } catch {}
  }
  console.error(line);
  process.exitCode = 1;
});

async function humanoidSignature(page) {
  return page.evaluate(() => {
    const scene = window.__openClinXrDebugScene;
    if (scene === undefined || scene === null) return JSON.stringify([]);
    const tops = [];
    scene.traverse((node) => {
      if (node.isSkinnedMesh !== true) return;
      let cursor = node;
      let top = node;
      while (cursor !== undefined && cursor !== null && cursor !== scene) {
        top = cursor;
        cursor = cursor.parent;
      }
      if (tops.includes(top.name) === false) tops.push(top.name);
    });
    tops.sort();
    return JSON.stringify(tops);
  });
}

export async function waitStableHumanoids(page) {
  const series = [];
  const started = Date.now();
  let last = "";
  let same = 0;
  for (;;) {
    const sig = await humanoidSignature(page);
    series.push({ atMs: Date.now() - started, count: JSON.parse(sig).length, sig });
    same = sig === last ? same + 1 : 1;
    last = sig;
    if (same >= STABLE_POLLS) {
      return { signature: sig, count: JSON.parse(sig).length, polls: series.length, waitedMs: Date.now() - started, series };
    }
    if (Date.now() - started > STABLE_WAIT_MS) {
      failBlocked(`humanoid count never stable for 2 s: ${JSON.stringify(series)}`);
    }
    await pause(POLL_MS);
  }
}

async function patientBbox(page, patientId) {
  return page.evaluate((wanted) => {
    const scene = window.__openClinXrDebugScene;
    const cam = window.__openClinXrGazeCamera;
    const canvas = document.getElementById("station-canvas");
    if (scene === undefined || cam === undefined || canvas === null) {
      return { ok: false, why: "missing debug scene, gaze camera or canvas" };
    }
    let slot = null;
    scene.traverse((node) => {
      if (node.userData !== undefined && node.userData !== null && node.userData.openClinXrActorId === wanted) slot = node;
    });
    if (slot === null) return { ok: false, why: `no slot stamped ${wanted}` };
    scene.updateMatrixWorld(true);
    const V3 = slot.position.constructor;
    const corners = [];
    slot.traverse((node) => {
      const geo = node.geometry;
      if (geo === undefined || geo === null) return;
      if (geo.boundingBox === null || geo.boundingBox === undefined) geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (bb === null || bb === undefined) return;
      for (const [cx, cy, cz] of [[bb.min.x, bb.min.y, bb.min.z], [bb.min.x, bb.min.y, bb.max.z], [bb.min.x, bb.max.y, bb.min.z], [bb.min.x, bb.max.y, bb.max.z], [bb.max.x, bb.min.y, bb.min.z], [bb.max.x, bb.min.y, bb.max.z], [bb.max.x, bb.max.y, bb.min.z], [bb.max.x, bb.max.y, bb.max.z]]) {
        corners.push(new V3(cx, cy, cz).applyMatrix4(node.matrixWorld).project(cam));
      }
    });
    const rect = canvas.getBoundingClientRect();
    let loX = Infinity;
    let loY = Infinity;
    let hiX = -Infinity;
    let hiY = -Infinity;
    let seen = 0;
    for (const p of corners) {
      if (p.z > 1) continue;
      const px = rect.left + (p.x * 0.5 + 0.5) * rect.width;
      const py = rect.top + (-p.y * 0.5 + 0.5) * rect.height;
      const qx = Math.min(Math.max(px, rect.left), rect.right);
      const qy = Math.min(Math.max(py, rect.top), rect.bottom);
      if (qx < loX) loX = qx;
      if (qy < loY) loY = qy;
      if (qx > hiX) hiX = qx;
      if (qy > hiY) hiY = qy;
      seen += 1;
    }
    if (seen === 0) return { ok: false, why: "patient entirely behind camera" };
    const box = { x: Math.round(loX), y: Math.round(loY), width: Math.round(hiX - loX), height: Math.round(hiY - loY) };
    if (box.width <= 0 || box.height <= 0) return { ok: false, why: `degenerate bbox ${JSON.stringify(box)}` };
    return { ok: true, bbox: box, canvasRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
  }, patientId);
}

async function hiddenCounts(page) {
  return page.evaluate((rows) => rows.map((row) => {
    const nodes = [...document.querySelectorAll(row.selector)];
    const canvas = document.getElementById("station-canvas");
    return {
      selector: row.selector,
      count: nodes.length,
      hitsCanvas: nodes.some((node) => node === canvas || (node.contains !== undefined && node.contains(canvas))),
    };
  }), SELECTORS);
}

async function hiddenRects(page) {
  return page.evaluate((rows) => rows.map((row) => {
    const rects = [...document.querySelectorAll(row.selector)].map((node) => {
      const r = node.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    });
    return { selector: row.selector, rects };
  }), SELECTORS);
}

export async function protectedVisibility(page) {
  return page.evaluate((rows) => rows.map((row) => {
    const nodes = [...document.querySelectorAll(row.selector)];
    const shown = nodes.filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && window.getComputedStyle(node).display !== "none";
    });
    return { selector: row.selector, count: nodes.length, visible: shown.length > 0 };
  }), PROTECTED);
}

function overlapArea(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export async function applyPresentationCss(page) {
  const cssText = readFileSync(CSS_PATH, "utf8");
  await page.addStyleTag({ content: cssText });
}

/**
 * Shared settled-frame stage: exactly what captureRun does up to the
 * settled frame (same server stack, GPU launch, viewport, join and
 * encounter waits, settled-frame wait, collectors, progress marks).
 * css:true applies presentation.css exactly as the w0-proof still does;
 * css:false matches control-a. Callers own their run dir, heartbeat and
 * still logic; close() is captureRun's finally cleanup.
 */
export async function openW0Stage({ css = false, runDir = null } = {}) {
  const log = (mark) => {
    if (runDir !== null) phaseLog(runDir, mark);
  };
  const { createEncounterServer } = await import(SERVER_INDEX);
  const { resolveDevStack } = await import(SERVER_STACK);
  const fixtures = await import(FIXTURES_INDEX);
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
  try {
    staticServer = await startStaticServer(
      APP_DIST,
    );
    log(`server-up port=${server.port} static-up port=${staticServer.port}`);
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
    log("page-load");
    await page.waitForFunction(
      () => window.__openClinXrEncounterSync !== undefined && window.__openClinXrEncounterSync.state !== "joining",
      undefined,
      { timeout: JOIN_WAIT_MS },
    );
    log("joined");
    const openedBy = Date.now() + ENCOUNTER_WAIT_MS;
    for (;;) {
      let snap = null;
      try {
        snap = JSON.parse(server.getStateJSON());
      } catch {
        snap = null;
      }
      if (snap !== null && snap.phase === "encounter") break;
      if (Date.now() > openedBy) failBlocked(`encounter phase never opened: ${JSON.stringify(snap)}`);
      await pause(500);
    }
    const stable = await waitStableHumanoids(page);
    log(`stable count=${stable.count} polls=${stable.polls}`);
    if (css) {
      await applyPresentationCss(page);
    }
    return { page, server, staticServer, browser, pageErrors, consoleErrors, close, stable, stack };
  } catch (error) {
    await close();
    throw error;
  }
}

async function captureRun() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  if (outIdx === -1 || typeof argv[outIdx + 1] !== "string" || argv[outIdx + 1] === "") {
    failBlocked("usage: node w0-still.mjs --out <w0 root>");
  }
  const root = resolve(argv[outIdx + 1]);
  const { dir: runDir, n: runN } = pickRunDir(root);
  const runTag = `run-${runN}`;
  liveRunDir = runDir;
  phaseLog(runDir, "start");
  phaseLog(runDir, `argv ${JSON.stringify(argv)}`);
  const heartbeat = setInterval(() => phaseLog(runDir, "alive"), 5000);
  heartbeat.unref();

  const plan = planCapture({ out: runDir });
  const base = plan.captureJson;
  const patientId = "patient_robert_hayes_v1";

  const { page, server, pageErrors, consoleErrors, close, stable, stack } = await openW0Stage({ css: false, runDir });
  const stills = [];
  try {
    const renderer = await page.evaluate(() => {
      const probe = document.createElement("canvas").getContext("webgl");
      const ext = probe !== null ? probe.getExtension("WEBGL_debug_renderer_info") : null;
      return ext !== null && probe !== null ? probe.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    });
    phaseLog(runDir, `renderer ${String(renderer).slice(0, 80)}`);
    const phaseOf = () => {
      try {
        return JSON.parse(server.getStateJSON());
      } catch {
        return null;
      }
    };

    const readStill = async (name) => {
      const path = join(runDir, `${name}.png`);
      await page.screenshot({ path, timeout: 30000 });
      const size = readPngSize(path);
      const boxRead = await patientBbox(page, patientId);
      if (boxRead.ok !== true) failBlocked(`patient bbox failed on ${name}: ${boxRead.why}`);
      const snap = phaseOf();
      return {
        file: `${runTag}/${name}.png`,
        sha256: sha256File(path),
        bytes: size.bytes,
        innerText: await page.evaluate(() => document.body.innerText),
        bbox: boxRead.bbox,
        canvasRect: boxRead.canvasRect,
        frameHeight: size.height,
        frameWidth: size.width,
        serverPhase: snap !== null ? snap.phase : null,
        serverRemainingS: snap !== null ? snap.phaseRemainingS : null,
        perfNowMs: await page.evaluate(() => performance.now()),
        humanoidCount: stable.count,
        humanoidSignature: stable.signature,
      };
    };

    stills.push(await readStill("control-a"));
    phaseLog(runDir, "shot control-a");
    await pause(1000);
    stills.push(await readStill("control-b"));
    phaseLog(runDir, "shot control-b");

    // Pre-CSS layout rects are the honest hidden zones (post-CSS they are 0).
    const rectRows = await hiddenRects(page);
    const controlProtected = await protectedVisibility(page);
    await applyPresentationCss(page);
    const proofCounts = await hiddenCounts(page);
    for (const row of proofCounts) {
      if (row.hitsCanvas) failBlocked(`selector matches canvas or canvas ancestor: ${row.selector}`);
      if (row.count !== 1) failBlocked(`selector matches ${row.count}, want 1: ${row.selector}`);
    }
    const proofProtected = await protectedVisibility(page);
    stills.push(await readStill("w0-proof"));
    phaseLog(runDir, "shot w0-proof");
    const camera = await readCamera(page);

    const hiddenSelectors = SELECTORS.map((row) => ({
      selector: row.selector,
      source: row.source,
      count: 1,
      rects: (rectRows.find((r) => r.selector === row.selector) ?? { rects: [] }).rects,
    }));
    const controlBySelector = new Map(controlProtected.map((row) => [row.selector, row]));
    const proofBySelector = new Map(proofProtected.map((row) => [row.selector, row]));
    const protectedRows = PROTECTED.map((row) => ({
      selector: row.selector,
      source: row.source,
      count: controlBySelector.get(row.selector)?.count ?? 0,
      visibleInControl: controlBySelector.get(row.selector)?.visible ?? false,
      visibleInProof: proofBySelector.get(row.selector)?.visible ?? false,
    }));
    const canvasRect = stills[2].canvasRect;
    // A7' speaks for the still: canvas rect minus hidden-chrome rects.
    const hiddenArea = hiddenSelectors.flatMap((h) => h.rects).reduce((sum, r) => sum + overlapArea(canvasRect, r), 0);
    const canvasArea = canvasRect.width * canvasRect.height;
    const captureJson = {
      ...base,
      seed: "w0-ed-chest-pain-settled",
      cameraPreset: "station-layout-desktop-960x600",
      camera,
      clientRoles: ["learner"],
      stills,
      presentationCss: "tools/openclinxr/evidence/site/capture/presentation.css",
      gpuArgs: ["channel:chromium", ...GPU_ARGS],
      renderer,
      hiddenSelectors,
      protected: protectedRows,
      canvasRect,
      viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
      excludedFraction: canvasArea > 0 ? hiddenArea / canvasArea : 0,
      comparedPixels: canvasArea - hiddenArea,
      joinState: "encounter",
      doorwaySeconds: Number(DOORWAY_SECONDS),
      server: { mode: "in-process", port: server.port, scenarioId: stack.scenarioId, url: server.url },
      humanoidStability: { polls: stable.polls, waitedMs: stable.waitedMs, count: stable.count, signature: stable.signature },
      cameraHandling: "default station-layout view, no capture query param (generated-scene default hides in-scene panels, identity labels, affordance markers, primitive fallbacks); no input dispatched; viewport 960x600 dpr 1 side-by-side shell (full-height canvas); back-to-back stills with only CSS injection between control-b and proof",
      pageErrors,
      consoleErrors: consoleErrors.filter((text) => /Failed to load resource.*404/iu.test(text) === false),
      asset404s: consoleErrors.filter((text) => /Failed to load resource.*404/iu.test(text)).length,
      provenance: {
        planCaptureBase: base,
        overrides: { seed: "w0 capture, not an RR1 chapter", cameraPreset: "desktop shell view, no IWER", clientRoles: "single learner shell, no faculty console" },
        noMic: "no spoken turn in this drive; no say/ffmpeg fixture, no getUserMedia shim, no encounterMicInject param",
      },
    };
    writeFileSync(join(runDir, "capture.json"), `${JSON.stringify(captureJson, null, 2)}\n`, "utf8");
    writeFileSync(join(root, "capture.json"), `${JSON.stringify({ ...captureJson, run: runTag }, null, 2)}\n`, "utf8");
    console.log(`w0 stills done ${runTag} bytes=${stills.map((s) => s.bytes).join(",")}`);
    console.log(`wrote ${join(runDir, "capture.json")}`);
  } finally {
    clearInterval(heartbeat);
    await close();
  }
}

const isEntryScript =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntryScript) {
  await captureRun().catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
