#!/usr/bin/env node
/**
 * RR1-min website evidence runner.
 *
 * Blockout attempts create only their named write-once composition directory.
 * The full-run mode is added only after an owner-graded blockout passes.
 *
 * Usage:
 *   node rr1-run.mjs --blockout-a2 --out /Volumes/files/openclinxr-assets/store/site-reimagine/rr1
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GPU_ARGS, VIEWPORT } from "../site/capture/capture-instrument.mjs";
import { createRr1FrameClassifier, imageCrop, rightmostTextColumn, signoffFrameSeries } from "../site/rr1-video-classifier.mjs";
import {
  installVisibleDomTextLog,
  projectActorBbox,
  shootRuntimePanel,
  shootRuntimePanelContentHeight,
  startStaticServer,
  takePhaseAgreementLog,
  takeVisibleDomTextLog,
} from "./harness-lib.mjs";
import { recordEnvironmentGlb, snapshotLearnerPose } from "./rr1-learner-framing.mjs";

/** Read-only learner camera pose: world position/direction plus lens numbers. */
export async function readLearnerCameraPose(page) {
  return page.evaluate(() => {
    const cam = globalThis.__openClinXrGazeCamera;
    if (cam == null) return null;
    const Vec = cam.position.constructor;
    const pos = cam.getWorldPosition(new Vec());
    const dir = cam.getWorldDirection(new Vec());
    return {
      position: { x: pos.x, y: pos.y, z: pos.z },
      direction: { x: dir.x, y: dir.y, z: dir.z },
      fov: cam.fov,
      aspect: cam.aspect,
      near: cam.near,
      far: cam.far,
    };
  });
}

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const APP_DIST = join(ROOT, "apps", "ui-xr", "dist");
const SERVER_DIST = join(ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "index.js");
const FIXTURES_DIST = join(ROOT, "packages", "openclinxr", "scenario-fixtures", "dist", "index.js");
const CLIENT_DIST = join(ROOT, "packages", "openclinxr", "xr-sync-client", "dist", "index.js");
const FACULTY_DIST = join(ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const IWER_BUNDLE = join(ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "node_modules", "iwer", "build", "iwer.min.js");
const CSS_PATH = join(ROOT, "tools", "openclinxr", "evidence", "site", "capture", "presentation.css");
const RR1_CLASSIFIER_FIXTURES = join(ROOT, "tools", "openclinxr", "evidence", "site", "fixtures", "rr1-video-classifier");
const CH5_FINALIZED_CROP = join(RR1_CLASSIFIER_FIXTURES, "run-18-ch5-finalized-80.00.png");
const CH5_OPEN_CROP = join(RR1_CLASSIFIER_FIXTURES, "run-18-ch5-open-65.84.png");
const G4_STRINGS = ["Trace 0/10", "WebXR unavailable", "local-only fallback"];
export const FACULTY_CAPTURE_SURFACE = Object.freeze({ viewport: VIEWPORT, deviceScaleFactor: 1 });
export const CH5_RECORDED_TAIL_HOLD_MS = 1000;
export const RR1_LEARNER_ROUTE_PATTERNS = Object.freeze([]);
export const RR1_CAPTURE_ASSERTION_SITES = Object.freeze([
  "server-clock", "learner-header-selection", "join-clocks", "sync-render", "sync-lag", "scene-ready", "learner-artifact-window", "artifact-png",
  "replay-score", "learner-trim-inputs", "learner-trim", "scene-ready-trim", "faculty-probe",
  "faculty-finalize-ack", "faculty-overlay-fit", "faculty-console-layout",
  "faculty-layout-release", "faculty-recorded-stop", "faculty-trim", "faculty-still-source", "faculty-text-bound",
  "faculty-layout", "topic-turn", "audio-alignment",
  "panel-luma", "audio-stream", "mux-frame-pts", "faculty-status-selection", "chapter-observed-time", "chapter-recording-origin",
  "chapter-content-transition", "chapter-window-end", "chapter-end-margin",
  "phase-agreement", "g4-dom", "ch1-window-margin",
]);
export const RR1_SETUP_THROW_ALLOWLIST = Object.freeze([
  { site: "required-build-inputs", reason: "capture cannot start without the built learner, server, faculty, IWER, and CSS inputs" },
  { site: "scenario-patient", reason: "capture cannot construct its required learner interaction without the fixture patient" },
  { site: "learner-static-start", reason: "an operational server-start failure occurs before any recording page exists" },
  { site: "browser-launch", reason: "an operational browser-launch failure occurs before any recording page exists" },
  { site: "recording-context-init", reason: "an operational context/init-script failure occurs before the first recorded page exists" },
]);

export function createDeferredErrorCollector() {
  const errors = [];
  return {
    errors,
    capture(site, assertion, fallback) {
      try {
        return assertion();
      } catch (error) {
        errors.push(`${site}: ${String(error instanceof Error ? error.message : error)}`);
        return typeof fallback === "function" ? fallback() : fallback;
      }
    },
    reject(site, message) {
      errors.push(`${site}: ${message}`);
    },
  };
}

function normalizedAssetName(specifier, importerName = "index.html") {
  const path = specifier.split(/[?#]/u, 1)[0];
  if (path.startsWith("/")) return posix.normalize(path.slice(1));
  if (!path.startsWith(".")) return null;
  return posix.normalize(posix.join(posix.dirname(importerName), path));
}

function viteMapDependencySpecifiers(source) {
  const specifiers = [];
  for (const marker of source.matchAll(/\b__vite__mapDeps\b/gu)) {
    const declarationEnd = source.indexOf(";", marker.index);
    const declaration = source.slice(marker.index, declarationEnd === -1 ? source.length : declarationEnd);
    const dependencyArray = declaration.match(/\.f\s*=\s*(\[[^\]]*\])/u)?.[1];
    if (dependencyArray === undefined) continue;
    for (const dependency of dependencyArray.matchAll(/["']([^"']+)["']/gu)) {
      specifiers.push(dependency[1]);
    }
  }
  return specifiers;
}

/** Return JS chunks reachable from index.html through static imports or Vite boot preload maps. */
export function parseStaticChunkGraph(indexHtml, assetsByName) {
  const normalizedAssets = new Map(Object.entries(assetsByName).map(([name, source]) => [
    posix.normalize(name.replace(/^\/+/, "")),
    source,
  ]));
  const roots = [];
  for (const match of indexHtml.matchAll(/<script\b([^>]*)>/giu)) {
    const attributes = match[1];
    if (!/\btype\s*=\s*["']module["']/iu.test(attributes)) continue;
    const source = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/iu)?.[1];
    const normalized = source === undefined ? null : normalizedAssetName(source);
    if (normalized !== null) roots.push(normalized);
  }

  const reachable = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const assetName = pending.pop();
    if (reachable.has(assetName)) continue;
    reachable.add(assetName);
    const source = normalizedAssets.get(assetName);
    if (typeof source !== "string") continue;
    const staticSpecifiers = [
      ...source.matchAll(/\bfrom\s*["']([^"']+\.js(?:[?#][^"']*)?)["']/gu),
      ...source.matchAll(/\bimport\s*["']([^"']+\.js(?:[?#][^"']*)?)["']/gu),
    ].map((match) => match[1]);
    for (const specifier of staticSpecifiers) {
      const importedName = normalizedAssetName(specifier, assetName);
      if (importedName !== null && !reachable.has(importedName)) pending.push(importedName);
    }
    for (const specifier of viteMapDependencySpecifiers(source)) {
      const importedName = normalizedAssetName(specifier, assetName)
        ?? posix.normalize(specifier.split(/[?#]/u, 1)[0].replace(/^\/+/, ""));
      if (!reachable.has(importedName)) pending.push(importedName);
    }
  }
  return [...reachable].sort();
}

/** Refuse route holds that can deadlock a statically reachable learner chunk. */
export function assertNoRouteHoldsStaticChunk({ routePatterns, indexHtml, assetsByName }) {
  const reachableStaticChunks = parseStaticChunkGraph(indexHtml, assetsByName);
  for (const routePattern of routePatterns) {
    if (!(routePattern instanceof RegExp)) {
      throw new TypeError(`RR1 static chunk route guard requires RegExp patterns; received ${String(routePattern)}`);
    }
    for (const assetName of reachableStaticChunks) {
      if (new RegExp(routePattern.source, routePattern.flags).test(`/${assetName}`)) {
        throw new Error(`REFUSED route hold ${String(routePattern)} matches statically reachable JS asset ${assetName}`);
      }
    }
  }
  return { reachableStaticChunks };
}

export function readStaticChunkInputs(distDir) {
  const assetsByName = {};
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".js")) {
        assetsByName[relative(distDir, path).split("\\").join("/")] = readFileSync(path, "utf8");
      }
    }
  };
  visit(distDir);
  return { indexHtml: readFileSync(join(distDir, "index.html"), "utf8"), assetsByName };
}

export async function closeRr1Handles(handles) {
  await Promise.allSettled(Object.values(handles).flatMap((handle) => Array.isArray(handle) ? handle : [handle])
    .filter((handle) => handle !== null && handle !== undefined)
    .map((handle) => Promise.resolve().then(() => handle.close())));
}

function requireCaptureValue(value, message) {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

function assertCaptureCondition(condition, message) {
  if (!condition) throw new Error(message);
  return true;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function parseArgs(argv) {
  const outAt = argv.indexOf("--out");
  const out = outAt === -1 ? null : argv[outAt + 1];
  const attempt = argv.includes("--blockout-a2") ? "blockout-a2" : argv.includes("--blockout") ? "blockout" : argv.includes("--run") ? "run" : null;
  if (attempt === null || typeof out !== "string" || out === "") {
    throw new Error("usage: node rr1-run.mjs --blockout-a2|--run --out <rr1-store-root>");
  }
  return { out: resolve(out), attempt };
}

function pickRunDir(root) {
  let n = 1;
  while (existsSync(join(root, `run-${n}`))) n += 1;
  const dir = join(root, `run-${n}`);
  mkdirSync(dir, { recursive: true });
  return { dir, n };
}

function measurePanelLumaRanges(videoPath) {
  const metadata = execFileSync("ffmpeg", [
    "-v", "error", "-i", videoPath,
    "-vf", "crop=420:600:540:0,signalstats,metadata=print:file=-",
    "-an", "-f", "null", "-",
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const mins = [...metadata.matchAll(/lavfi\.signalstats\.YMIN=(\d+)/gu)].map((match) => Number(match[1]));
  const maxs = [...metadata.matchAll(/lavfi\.signalstats\.YMAX=(\d+)/gu)].map((match) => Number(match[1]));
  if (mins.length === 0 || mins.length !== maxs.length) throw new Error("panel luma gate produced no aligned frames");
  const ranges = mins.map((value, index) => maxs[index] - value);
  return { frameCount: ranges.length, minimumRange: Math.min(...ranges), threshold: 5, metric: "per-frame YMAX-YMIN in x=540,y=0,w=420,h=600" };
}

function signalFrames(videoPath) {
  const metadata = execFileSync("ffmpeg", [
    "-v", "error", "-i", videoPath,
    "-vf", "crop=420:600:540:0,signalstats,metadata=print:file=-",
    "-an", "-f", "null", "-",
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return metadata.split(/(?=frame:\d+)/gu).flatMap((block) => {
    const time = /pts_time:([0-9.]+)/u.exec(block)?.[1];
    const ymin = /lavfi\.signalstats\.YMIN=(\d+)/u.exec(block)?.[1];
    const ymax = /lavfi\.signalstats\.YMAX=(\d+)/u.exec(block)?.[1];
    return time === undefined || ymin === undefined || ymax === undefined
      ? []
      : [{ ptsTime: Number(time), yMin: Number(ymin), yMax: Number(ymax) }];
  });
}

function videoFramePtsSeconds(videoPath) {
  const output = execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time", "-of", "csv=p=0", videoPath,
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const frames = output.split(/\r?\n/u).filter(Boolean).map(Number);
  if (frames.length === 0 || frames.some((value) => !Number.isFinite(value))) {
    throw new Error(`ffprobe returned no valid video frame PTS for ${videoPath}`);
  }
  return frames;
}

export function writeVideoFramePng(videoPath, ptsSeconds, outputPath) {
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-i", videoPath,
    "-vf", `select='gte(t,${ptsSeconds})'`, "-frames:v", "1", "-vsync", "0", outputPath,
  ]);
}

/** Convert measured signalstats frames into the exact first-painted inpoint. */
export function firstPaintTrim(frames, threshold = 5) {
  const firstPaintedIndex = frames.findIndex((frame) => frame.yMax - frame.yMin >= threshold);
  if (firstPaintedIndex === -1) throw new Error("video never paints a non-uniform frame");
  return {
    blankFrames: firstPaintedIndex,
    inpointSeconds: firstPaintedIndex === 0 ? 0 : frames[firstPaintedIndex].ptsTime,
    frameCount: frames.length,
    threshold,
  };
}

export function parseFramePeriodSeconds(rFrameRate) {
  const match = /^(\d+)\/(\d+)$/u.exec(rFrameRate);
  if (match === null || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
    throw new Error(`invalid learner r_frame_rate ${JSON.stringify(rFrameRate)}`);
  }
  return Number(match[2]) / Number(match[1]);
}

export function learnerChapterOffsetSeconds(chapterId, untrimmedOffsetSeconds, trimInpointSeconds, framePeriodSeconds, isFirstChapter, trimReason = "syncStart") {
  if (isFirstChapter) {
    if (!requiresSceneReadyCh1TrimCheck(trimReason) && trimInpointSeconds - untrimmedOffsetSeconds >= framePeriodSeconds) {
      throw new Error(`learner trim ${trimInpointSeconds} s exceeds ch1 untrimmed offset ${untrimmedOffsetSeconds} s by at least frame period ${framePeriodSeconds} s`);
    }
    return Math.max(0, untrimmedOffsetSeconds - trimInpointSeconds);
  }
  if (untrimmedOffsetSeconds < trimInpointSeconds) {
    throw new Error(`learner chapter ${chapterId} untrimmed offset ${untrimmedOffsetSeconds} s is before trim ${trimInpointSeconds} s`);
  }
  return untrimmedOffsetSeconds - trimInpointSeconds;
}

/** Publish a chapter on the first real frame at or after its continuous mark time. */
export function firstFramePtsAtOrAfter(framePtsSeconds, markVideoTimeSeconds) {
  const frame = framePtsSeconds.find((pts) => pts >= markVideoTimeSeconds);
  if (frame === undefined) {
    throw new Error(`video has no frame PTS at or after chapter mark ${markVideoTimeSeconds} s`);
  }
  return frame;
}

export function selectChapterByContentTransition({
  chapterId,
  previousChapterId = null,
  nextChapterId = null,
  framePtsSeconds,
  searchStartSeconds,
  readsCurrentState,
  readsPreviousState = null,
  readsNextState = null,
}) {
  const searchStartIndex = framePtsSeconds.findIndex((pts) => pts >= searchStartSeconds);
  if (searchStartIndex === -1) throw new Error(`chapter ${chapterId} has no frame at or after previous chapter offset ${searchStartSeconds}`);
  const nextStateIndex = readsNextState === null
    ? framePtsSeconds.length
    : framePtsSeconds.findIndex((pts, index) => index >= searchStartIndex && readsNextState(pts));
  const upperIndex = nextStateIndex === -1 ? framePtsSeconds.length : nextStateIndex;
  let lastPreviousStateIndex = -1;
  let chosenIndex = -1;
  for (let index = searchStartIndex; index <= upperIndex && index < framePtsSeconds.length; index += 1) {
    const pts = framePtsSeconds[index];
    if (readsPreviousState !== null && readsPreviousState(pts)) lastPreviousStateIndex = index;
    if (lastPreviousStateIndex >= searchStartIndex && lastPreviousStateIndex < index && readsCurrentState(pts)) {
      chosenIndex = index;
      break;
    }
    if (readsPreviousState === null && readsCurrentState(pts)) {
      chosenIndex = index;
      break;
    }
  }
  if (readsPreviousState !== null && lastPreviousStateIndex === -1) {
    throw new Error(`chapter ${chapterId} has no ${previousChapterId} previous-state frame after ${searchStartSeconds} s and before ${nextChapterId ?? "recording-end"}`);
  }
  if (chosenIndex === -1) throw new Error(`chapter ${chapterId} has no marked-state frame after ${previousChapterId ?? "recording-start"}`);
  const offsetSeconds = framePtsSeconds[chosenIndex];
  if (readsNextState !== null && readsNextState(offsetSeconds)) {
    throw new Error(`chapter ${chapterId} chosen frame ${offsetSeconds} s already reads next chapter ${nextChapterId} state`);
  }
  if (chosenIndex >= upperIndex) {
    throw new Error(`chapter ${chapterId} chosen frame ${offsetSeconds} s is not before first ${nextChapterId} state frame ${framePtsSeconds[upperIndex]} s`);
  }
  const previousPts = framePtsSeconds[chosenIndex - 1];
  if (previousPts !== undefined && readsCurrentState(previousPts)) {
    throw new Error(`chapter ${chapterId} frame before chosen PTS ${offsetSeconds} already reads the marked state at ${previousPts}`);
  }
  return {
    offsetSeconds,
    previousPts: previousPts ?? null,
    previousStatePts: lastPreviousStateIndex >= searchStartIndex ? framePtsSeconds[lastPreviousStateIndex] : null,
    nextStatePts: upperIndex < framePtsSeconds.length ? framePtsSeconds[upperIndex] : null,
  };
}

export function assertPublishedChapterEndMargin(chapterId, publishedOffsetSeconds, windowEndVideoTimeSeconds, minimumEndMarginMs = 100) {
  const endMarginMs = Number(((windowEndVideoTimeSeconds - publishedOffsetSeconds) * 1000).toFixed(6));
  if (endMarginMs < minimumEndMarginMs) {
    throw new Error(`chapter ${chapterId} published-frame end margin ${endMarginMs} ms is below ${minimumEndMarginMs} ms; offset=${publishedOffsetSeconds} windowEnd=${windowEndVideoTimeSeconds}`);
  }
  return endMarginMs;
}

export function learnerPanelPaintTrim(frames, firstChapterUntrimmedOffsetSeconds, framePeriodSeconds, threshold = 5) {
  const trim = firstPaintTrim(frames, threshold);
  learnerChapterOffsetSeconds("ch1", firstChapterUntrimmedOffsetSeconds, trim.inpointSeconds, framePeriodSeconds, true);
  return trim;
}

export function learnerSyncedPaintTrim(frames, syncStartOffsetSeconds, firstChapterUntrimmedOffsetSeconds, framePeriodSeconds, threshold = 5) {
  const painted = firstPaintTrim(frames, threshold);
  const firstSyncedIndex = frames.findIndex((frame) => frame.ptsTime >= syncStartOffsetSeconds);
  if (firstSyncedIndex === -1) throw new Error(`learner video has no frame at or after sync-start offset ${syncStartOffsetSeconds} s`);
  const syncedInpointSeconds = firstSyncedIndex === 0 ? 0 : frames[firstSyncedIndex].ptsTime;
  const inpointSeconds = Math.max(painted.inpointSeconds, syncedInpointSeconds);
  learnerChapterOffsetSeconds("ch1", firstChapterUntrimmedOffsetSeconds, inpointSeconds, framePeriodSeconds, true);
  return {
    ...painted,
    inpointSeconds,
    trimReason: syncedInpointSeconds > painted.inpointSeconds ? "syncStart" : "painted",
    paintedInpointSeconds: painted.inpointSeconds,
    syncedInpointSeconds,
    syncStartOffsetSeconds,
    trimmedFrames: frames.findIndex((frame) => frame.ptsTime >= inpointSeconds),
  };
}

export function learnerSceneReadyPaintTrim(
  frames,
  syncStartOffsetSeconds,
  sceneReadyOffsetSeconds,
  latchOffsetSeconds,
  firstChapterUntrimmedOffsetSeconds,
  framePeriodSeconds,
  threshold = 5,
) {
  if (!Number.isFinite(latchOffsetSeconds)) {
    throw new Error(`learner trim needs a finite latch offset; latchOffsetSeconds=${String(latchOffsetSeconds)}`);
  }
  const painted = firstPaintTrim(frames, threshold);
  const firstSyncedIndex = frames.findIndex((frame) => frame.ptsTime >= syncStartOffsetSeconds);
  const firstSceneReadyIndex = frames.findIndex((frame) => frame.ptsTime >= sceneReadyOffsetSeconds);
  const firstLatchIndex = frames.findIndex((frame) => frame.ptsTime >= latchOffsetSeconds);
  if (firstSyncedIndex === -1) throw new Error(`learner video has no frame at or after sync-start offset ${syncStartOffsetSeconds} s`);
  if (firstSceneReadyIndex === -1) throw new Error(`learner video has no frame at or after scene-ready offset ${sceneReadyOffsetSeconds} s`);
  if (firstLatchIndex === -1) throw new Error(`learner video has no frame at or after latch offset ${latchOffsetSeconds} s`);
  const syncedInpointSeconds = firstSyncedIndex === 0 ? 0 : frames[firstSyncedIndex].ptsTime;
  const sceneReadyInpointSeconds = firstSceneReadyIndex === 0 ? 0 : frames[firstSceneReadyIndex].ptsTime;
  const latchInpointSeconds = firstLatchIndex === 0 ? 0 : frames[firstLatchIndex].ptsTime;
  const baseInpointSeconds = Math.max(painted.inpointSeconds, syncedInpointSeconds);
  const inpointSeconds = Math.max(baseInpointSeconds, sceneReadyInpointSeconds, latchInpointSeconds);
  const trimReason = latchOffsetSeconds > sceneReadyOffsetSeconds && latchInpointSeconds >= baseInpointSeconds
    ? "latch"
    : sceneReadyInpointSeconds >= baseInpointSeconds
      ? "sceneReady"
      : syncedInpointSeconds > painted.inpointSeconds ? "syncStart" : "painted";
  learnerChapterOffsetSeconds("ch1", firstChapterUntrimmedOffsetSeconds, inpointSeconds, framePeriodSeconds, true, trimReason);
  return {
    ...painted,
    inpointSeconds,
    trimReason,
    paintedInpointSeconds: painted.inpointSeconds,
    syncedInpointSeconds,
    sceneReadyInpointSeconds,
    latchInpointSeconds,
    syncStartOffsetSeconds,
    sceneReadyOffsetSeconds,
    latchOffsetSeconds,
    trimmedFrames: frames.findIndex((frame) => frame.ptsTime >= inpointSeconds),
  };
}

/** The ch1 transition/end-margin window check applies to scene-anchored trims, including the latched inpoint. */
export function requiresSceneReadyCh1TrimCheck(trimReason) {
  return trimReason === "sceneReady" || trimReason === "latch";
}

/**
 * Fail-fast learner trim resolution. When the interior latch is present the
 * trim is scene-anchored and must hold: the throw propagates instead of
 * degrading to a fallback "painted" trim that would cut every artifact from
 * untrimmed video (run-10). With no latch the legacy deferred path stays
 * (assertCaptureAfterLatch already refuses).
 */
export function resolveLearnerTrim({ latchWallMs, computeTrim, captureTrim }) {
  if (Number.isFinite(latchWallMs)) return computeTrim();
  return captureTrim(computeTrim);
}

export function assertSceneReadyCh1Trim({ headerLog, ch1ObservedWallMs, trimWallMs, phase, station, artifacts, minimumEndMarginMs = 100 }) {
  const stateAtTrim = [...headerLog].reverse().find((entry) => entry.wallMs <= trimWallMs);
  const transition = headerLog.find((entry) =>
    entry.wallMs > ch1ObservedWallMs
      && entry.wallMs <= trimWallMs
      && (entry.eyebrow.toLowerCase() !== phase.toLowerCase() || entry.station.toLowerCase() !== station.toLowerCase()));
  if (stateAtTrim === undefined || transition !== undefined
    || stateAtTrim.eyebrow.toLowerCase() !== phase.toLowerCase()
    || stateAtTrim.station.toLowerCase() !== station.toLowerCase()) {
    throw new Error(`scene-ready trim ${trimWallMs} ms does not retain ch1 ${phase}/${station} observed at ${ch1ObservedWallMs} ms; transition=${JSON.stringify(transition ?? stateAtTrim ?? null)}`);
  }
  if (artifacts.length === 0) throw new Error("scene-ready trim has no ch1 artifacts to validate");
  const margins = artifacts.map((artifact) => {
    const windowEndWallMs = artifact.markedWindow?.endWallMs;
    if (typeof windowEndWallMs !== "number") throw new Error(`scene-ready trim artifact ${artifact.artifact} has no marked window end`);
    const endMarginMs = windowEndWallMs - trimWallMs;
    if (endMarginMs < minimumEndMarginMs) {
      throw new Error(`scene-ready trim artifact ${artifact.artifact} end margin ${endMarginMs} ms is below ${minimumEndMarginMs} ms; trim=${trimWallMs} windowEnd=${windowEndWallMs}`);
    }
    return { artifact: artifact.artifact, windowEndWallMs, endMarginMs };
  });
  return { trimWallMs, ch1ObservedWallMs, minimumEndMarginMs, margins };
}

export function assertPanelLumaFrames(frames, threshold = 5) {
  if (frames.length === 0) throw new Error("panel luma gate produced no frames");
  const flat = frames.find((frame) => frame.yMax - frame.yMin < threshold);
  if (flat !== undefined) {
    throw new Error(`panel luma gate failed at ${flat.ptsTime.toFixed(2)} s: YMAX-YMIN=${flat.yMax - flat.yMin} < ${threshold}`);
  }
  return { frameCount: frames.length, minimumRange: Math.min(...frames.map((frame) => frame.yMax - frame.yMin)), threshold };
}

export function assessFacultyOverlayFit(measurement) {
  const overflowingLines = measurement.lines.filter((line) => line.scrollWidth > line.clientWidth);
  const rightEdgeInside = measurement.overlayBoxRight <= measurement.viewportWidth;
  return {
    ...measurement,
    overflowingLines,
    rightEdgeInside,
    pass: overflowingLines.length === 0 && rightEdgeInside,
  };
}

export function assessFacultySignoffTextExtent(rightmostTextColumn, domTextRight, surface, antiAliasAllowancePx = 2) {
  if (typeof domTextRight !== "number") throw new Error(`faculty signoff ${surface} DOM text extent is missing`);
  if (typeof rightmostTextColumn !== "number") throw new Error(`faculty signoff ${surface} rightmost text column is missing`);
  const minimumRightmostColumn = domTextRight - antiAliasAllowancePx;
  if (rightmostTextColumn < minimumRightmostColumn) {
    throw new Error(`faculty signoff ${surface} rightmost text column ${rightmostTextColumn} is left of DOM text extent ${domTextRight} with ${antiAliasAllowancePx} px anti-alias allowance`);
  }
  return { rightmostTextColumn, domTextRight, antiAliasAllowancePx, pass: true };
}

export function assertFacultySignoffPointHits(measurement, surface) {
  if (!Array.isArray(measurement?.points) || measurement.points.length !== 3) {
    throw new Error(`faculty signoff ${surface} elementFromPoint measurement must contain 3 points`);
  }
  const occluded = measurement.points.filter((point) => point.isTargetOrDescendant !== true);
  if (occluded.length > 0) {
    throw new Error(`faculty signoff ${surface} elementFromPoint hits are not #sync-probe-c14 or descendants: ${JSON.stringify(occluded)}`);
  }
  return { pass: true, pointCount: measurement.points.length };
}

export const FACULTY_OVERLAY_LINE_SELECTORS = Object.freeze([
  "#sync-probe-status",
  "#sync-probe-note",
  "#sync-probe-lobby",
  "#sync-probe-c13",
  "#sync-probe-c14",
  "#sync-probe-c20",
  "#sync-probe-topics",
  "#sync-probe-station",
  "#sync-probe-observers",
]);

export function assertCh5StillSource(stillSource) {
  if (stillSource !== "video-frame") {
    throw new Error(`ch5 still source is ${JSON.stringify(stillSource)}; reinstate the nine-line still/recorded equality if a non-video still source returns`);
  }
  return { pass: true, stillSource };
}

export function assertFacultySignoffFrameSeries(frames, domTextRight, antiAliasAllowancePx = 2) {
  if (typeof domTextRight !== "number") throw new Error("faculty signoff frame-series DOM text extent is missing");
  const minimumRightmostColumn = domTextRight - antiAliasAllowancePx;
  const failure = frames.find((frame) => typeof frame.rightmostTextColumn !== "number" || frame.rightmostTextColumn < minimumRightmostColumn);
  if (failure !== undefined) {
    throw new Error(`faculty signoff frame series first fails at PTS ${failure.pts} s: rightmost text column ${failure.rightmostTextColumn ?? "missing"} < DOM text extent ${domTextRight} - ${antiAliasAllowancePx} px`);
  }
  return { pass: true, frameCount: frames.length, minimumRightmostColumn };
}

export function facultyIwerReleaseAfterFinalize(layoutLog) {
  const finalize = layoutLog.occlusionMeasurements?.find((entry) => entry.kind === "recorded:ch5-offset");
  if (typeof finalize?.wallMs !== "number") throw new Error("faculty layout log is missing recorded:ch5-offset wallMs");
  const release = layoutLog.events?.find((entry) => entry.kind === "window-resize" && entry.wallMs >= finalize.wallMs);
  if (typeof release?.wallMs !== "number") throw new Error("faculty layout log is missing window-resize after recorded:ch5-offset");
  return { finalizeWallMs: finalize.wallMs, releaseWallMs: release.wallMs, releaseAfterFinalizeMs: release.wallMs - finalize.wallMs };
}

export function assertCh5EndMargin(endMarginMs) {
  if (typeof endMarginMs !== "number") throw new Error("ch5 artifact endMarginMs is null");
  return endMarginMs;
}

export function assertCh5RecordedStop({
  recordedState,
  captureStartedWallMs,
  captureEndedWallMs,
  windowStartWallMs,
  stopWallMs,
  minimumEndMarginMs = 100,
}) {
  if (!recordedState.toLowerCase().includes("signoff:finalized")) {
    throw new Error(`recorded faculty state at stop must contain signoff:finalized; state=${JSON.stringify(recordedState)}`);
  }
  if (captureStartedWallMs < windowStartWallMs) {
    throw new Error(`ch5 still capture started ${captureStartedWallMs} before window start ${windowStartWallMs}`);
  }
  if (captureEndedWallMs > stopWallMs) {
    throw new Error(`ch5 still capture ended ${captureEndedWallMs} after recorded faculty stop ${stopWallMs}`);
  }
  const endMarginMs = stopWallMs - captureEndedWallMs;
  if (endMarginMs < minimumEndMarginMs) {
    throw new Error(`ch5 recorded-stop end margin ${endMarginMs} ms is below ${minimumEndMarginMs} ms; captureEnded=${captureEndedWallMs} stop=${stopWallMs}`);
  }
  return {
    window: { startWallMs: windowStartWallMs, endWallMs: stopWallMs },
    startMarginMs: captureStartedWallMs - windowStartWallMs,
    endMarginMs,
  };
}

export function writeEvidenceBeforeDeferredErrors(writeEvidence, deferredErrors) {
  writeEvidence();
  if (deferredErrors.length > 0) {
    throw new Error(`deferred RR1 capture assertions failed after evidence write: ${deferredErrors.join(" | ")}`);
  }
}

export function assertFacultyLayoutLog(log, expectedContainer = { tagName: "DIV", id: "sync-probe-iwer-container" }) {
  const overflow = log.animationFrames.find((entry) => entry.overlayBoxRight > entry.innerWidth);
  if (overflow !== undefined) {
    const facultyLocalMs = overflow.wallMs - log.facultyRecordingOriginWallMs - log.facultyTrimInpointSeconds * 1000;
    throw new Error(`faculty layout first exceeds innerWidth at faculty-local ${facultyLocalMs} ms: overlayBoxRight=${overflow.overlayBoxRight} innerWidth=${overflow.innerWidth}`);
  }
  const loadIdentity = log.events.find((entry) => entry.kind === "container:load");
  if (loadIdentity?.tagName !== expectedContainer.tagName || loadIdentity?.id !== expectedContainer.id) {
    throw new Error(`faculty layout load container identity ${JSON.stringify(loadIdentity ?? null)} does not equal ${expectedContainer.tagName}#${expectedContainer.id}`);
  }
  return { pass: true, loadIdentity, sampleCount: log.animationFrames.length };
}

/** Compute every disagreement span between the two phase labels. */
export function phaseDisagreement(log, endedAtMs) {
  const spans = [];
  for (let index = 0; index < log.length; index += 1) {
    const entry = log[index];
    if (entry.eyebrow.toLowerCase() === entry.phaseRow.toLowerCase()) continue;
    const endMs = log[index + 1]?.atMs ?? endedAtMs;
    spans.push({ startMs: entry.atMs, endMs, durationMs: Math.max(0, endMs - entry.atMs), eyebrow: entry.eyebrow, phaseRow: entry.phaseRow });
  }
  return { maxDisagreementMs: Math.max(0, ...spans.map((span) => span.durationMs)), spans };
}

export function selectLearnerSyncStartWallMs(headerLog) {
  const syncEntry = headerLog.find((entry) => typeof entry.station === "string" && entry.station.trim() !== "");
  if (syncEntry === undefined || typeof syncEntry.wallMs !== "number") {
    throw new Error("learner header log has no entry with a non-empty station line");
  }
  return syncEntry.wallMs;
}

export function sceneHumanoidAssetsReady(evidence) {
  return evidence?.expectedAssetCount > 0
    && evidence.loadedCount === evidence.expectedAssetCount
    && evidence.failedCount === 0
    && evidence.fallbackActiveCount === 0;
}

export function assertSceneReadyObserved(sceneReadyWallMs, evidence) {
  if (typeof sceneReadyWallMs === "number") return sceneReadyWallMs;
  throw new Error(`sceneReady was never observed; last evidence loadedCount=${String(evidence?.loadedCount)} expectedAssetCount=${String(evidence?.expectedAssetCount)} failedCount=${String(evidence?.failedCount)} fallbackActiveCount=${String(evidence?.fallbackActiveCount)}`);
}

export function assertLearnerSyncLag(syncStartWallMs, learnerJoinWallMs, maximumLagMs = 100) {
  const syncLagMs = syncStartWallMs - learnerJoinWallMs;
  if (syncLagMs > maximumLagMs) {
    throw new Error(`learner sync start ${syncStartWallMs} ms exceeds join ${learnerJoinWallMs} ms by ${syncLagMs} ms; limit ${maximumLagMs} ms`);
  }
  return { syncStartWallMs, syncLagMs };
}

/** Pure RR1 station-start and ch1 doorway-margin decision shared by the runner and regression fixtures. */
export function rr1DoorwayStartPlan({
  learnerLatchWallMs,
  evidenceLatchWallMs,
  ch2MarkWallMs,
  frameCaptureEndedWallMs,
  panelCaptureEndedWallMs,
  minimumMarginMs = 250,
}) {
  if (!Number.isFinite(learnerLatchWallMs) || !Number.isFinite(evidenceLatchWallMs)) {
    throw new Error("RR1 station start requires finite learner and evidence interior latch wall clocks");
  }
  const artifactTimes = [ch2MarkWallMs, frameCaptureEndedWallMs, panelCaptureEndedWallMs];
  const hasArtifactTimes = artifactTimes.some(Number.isFinite);
  if (hasArtifactTimes && !artifactTimes.every(Number.isFinite)) {
    throw new Error("RR1 ch1 window margin requires finite ch2, frame-end, and panel-end wall clocks");
  }
  const ch1WindowMargin = hasArtifactTimes
    ? { frameMs: ch2MarkWallMs - frameCaptureEndedWallMs, panelMs: ch2MarkWallMs - panelCaptureEndedWallMs }
    : { frameMs: null, panelMs: null };
  const accepted = !hasArtifactTimes
    || (ch1WindowMargin.frameMs >= minimumMarginMs && ch1WindowMargin.panelMs >= minimumMarginMs);
  return {
    startAfterWallMs: Math.max(learnerLatchWallMs, evidenceLatchWallMs),
    ch1WindowMargin,
    minimumMarginMs,
    accepted,
  };
}

export function phaseAgreementAfterSyncStart(log, syncStartWallMs, endedAtMs) {
  const labeledLog = log.map((entry) => ({ ...entry, preSync: entry.atMs < syncStartWallMs }));
  const evaluatedLog = labeledLog.filter((entry) => !entry.preSync);
  return {
    log: labeledLog,
    evaluatedLog,
    ...phaseDisagreement(evaluatedLog, endedAtMs),
  };
}

export function assertPhaseAgreementAfterSyncStart(log, syncStartWallMs, endedAtMs) {
  const evaluation = phaseAgreementAfterSyncStart(log, syncStartWallMs, endedAtMs);
  if (evaluation.maxDisagreementMs > 0) {
    throw new Error(`phase eyebrow/row disagreement: ${JSON.stringify({ maxDisagreementMs: evaluation.maxDisagreementMs, spans: evaluation.spans })}`);
  }
  return evaluation;
}

/** Alignment verdict shared by the runner and its offline regression fixture. */
export function audioLineAlignment(audioOnsetSeconds, lineFrameSeconds, limitSeconds = 0.12) {
  const differenceSeconds = Math.abs(audioOnsetSeconds - lineFrameSeconds);
  return { audioOnsetSeconds, lineFrameSeconds, differenceSeconds, limitSeconds, pass: differenceSeconds <= limitSeconds };
}

export function measuredAudioDelayMs(lineFrameSeconds, sourceSpeechOnsetSeconds) {
  return Math.max(0, Math.round((lineFrameSeconds - sourceSpeechOnsetSeconds) * 1000));
}

/** Chapter offset on the recording's own measured wall-clock origin. */
export function observedOffsetSeconds({ observedWallMs, recordingOriginWallMs, timelineStartSeconds = 0, trimInpointSeconds = 0 }) {
  return timelineStartSeconds + (observedWallMs - recordingOriginWallMs) / 1000 - trimInpointSeconds;
}

/**
 * Shared phase-entry rule for window selection and the header wait predicate:
 * (A) the entry with the GREATEST wallMs at or before serverMs wins; ties on
 * wallMs go to the LATER array index (the later observation supersedes). If it
 * matches -> that index, with startWallMs = serverMs (never the entry's own
 * wallMs, or the window would include pre-clock frames). (B) Else, among
 * matching entries with wallMs STRICTLY after serverMs, the one with the LEAST
 * wallMs wins (ties -> earlier array index) -> its index and its own wallMs.
 * (C) Else null. Selection is by wallMs, never by array position alone.
 */
export function rr1PhaseEntryIndex(log, matches, serverMs) {
  let beforeIndex = -1;
  let beforeWallMs = -Infinity;
  for (let index = 0; index < log.length; index += 1) {
    const wallMs = log[index].wallMs;
    if (wallMs <= serverMs && (wallMs > beforeWallMs || (wallMs === beforeWallMs && index > beforeIndex))) {
      beforeIndex = index;
      beforeWallMs = wallMs;
    }
  }
  if (beforeIndex !== -1 && matches(log[beforeIndex])) {
    return { index: beforeIndex, startWallMs: serverMs };
  }
  let afterIndex = -1;
  let afterWallMs = Infinity;
  for (let index = 0; index < log.length; index += 1) {
    const entry = log[index];
    if (entry.wallMs > serverMs && matches(entry)
      && (afterIndex === -1 || entry.wallMs < afterWallMs || (entry.wallMs === afterWallMs && index < afterIndex))) {
      afterIndex = index;
      afterWallMs = entry.wallMs;
    }
  }
  if (afterIndex !== -1) return { index: afterIndex, startWallMs: log[afterIndex].wallMs };
  return null;
}

function transitionWindow(log, matches, serverMs, label) {
  const found = rr1PhaseEntryIndex(log, matches, serverMs);
  if (found === null) {
    throw new Error(`no transition matching ${label} at or after ${serverMs}; last 3 entries: ${JSON.stringify(log.slice(-3))}`);
  }
  let endWallMs = null;
  for (const entry of log) {
    if (!matches(entry) && entry.wallMs > found.startWallMs && (endWallMs === null || entry.wallMs < endWallMs)) {
      endWallMs = entry.wallMs;
    }
  }
  return { startWallMs: found.startWallMs, endWallMs };
}

export function learnerHeaderWindow(log, phase, station, phaseServerMs) {
  const phaseName = phase.toLowerCase();
  const stationLabel = station.toLowerCase();
  return transitionWindow(
    log,
    (entry) => entry.eyebrow.toLowerCase() === phaseName && entry.station.toLowerCase() === stationLabel,
    phaseServerMs,
    `phase ${phase} and station ${station}`,
  );
}

export function selectObservedWallMs(log, phase, station, phaseServerMs) {
  return learnerHeaderWindow(log, phase, station, phaseServerMs).startWallMs;
}

export function facultyStatusWindow(log, statusNeedle, statusServerMs) {
  const needle = statusNeedle.toLowerCase();
  return transitionWindow(
    log,
    (entry) => entry.status.toLowerCase().includes(needle),
    statusServerMs,
    `status containing ${statusNeedle}`,
  );
}

export function selectFacultyStatusObservedWallMs(log, statusNeedle, statusServerMs) {
  return facultyStatusWindow(log, statusNeedle, statusServerMs).startWallMs;
}

/**
 * Header-phase predicate for the mark() waits: TRUE when the page already
 * showed the phase before the server clock started (the LAST entry at or
 * before phaseServerMs matches eyebrow+station, case-insensitive), or when
 * any entry at or after phaseServerMs matches (the pre-fix rule, unchanged).
 * Only the last entry at-or-before counts, never an earlier one.
 */
export function rr1HeaderShowsPhase(log, { phaseName, station, phaseServerMs }) {
  const needlePhase = String(phaseName).toLowerCase();
  const needleStation = String(station).toLowerCase();
  return rr1PhaseEntryIndex(
    log,
    (entry) => String(entry.eyebrow ?? "").toLowerCase() === needlePhase
      && String(entry.station ?? "").toLowerCase() === needleStation,
    phaseServerMs,
  ) !== null;
}

/** Production bound for the doorway clock-start wait: ready timeout plus one 25 ms poll. */
export function rr1DoorwayClockBoundMs(readyTimeoutSeconds) {
  return readyTimeoutSeconds * 1000 + 25;
}

/** Bound derivation for runCapture: reads the constant off the SERVER_DIST module it is handed. */
export function rr1DoorwayClockBoundFromServer(serverModule) {
  const readyTimeoutSeconds = serverModule?.DEFAULT_READY_TIMEOUT_SECONDS;
  if (typeof readyTimeoutSeconds !== "number" || !Number.isFinite(readyTimeoutSeconds)) {
    throw new Error(`SERVER_DIST module is missing a finite DEFAULT_READY_TIMEOUT_SECONDS: ${String(readyTimeoutSeconds)}`);
  }
  return rr1DoorwayClockBoundMs(readyTimeoutSeconds);
}

/**
 * Clock-start key check for a doorway wait, attributing probe keys to stations
 * exactly as phaseSnapshot does: every key belongs to the room's own station
 * except "prev-station-closed", which belongs to the previous station's close.
 */
export function rr1DoorwayClockStarted(stats, stationIndex) {
  const changedAtMs = stats?.phaseChangedAtMs;
  if (changedAtMs === null || typeof changedAtMs !== "object") return false;
  for (const [phase, serverMs] of Object.entries(changedAtMs)) {
    const actualStation = phase === "prev-station-closed" ? stationIndex - 1 : stationIndex;
    const actualPhase = phase === "prev-station-closed" ? "closed" : phase;
    if (actualStation === stationIndex && actualPhase === "doorway" && typeof serverMs === "number") return true;
  }
  return false;
}

/**
 * Phase-aware wait: "match" resolves ("passed" throws the named error on the
 * first poll, "wait" keeps the timeout), except a doorway "match" additionally
 * waits for the room's doorway clock-start key (rr1DoorwayClockStarted on the
 * latest probe stats) within doorwayClock.boundMs of the first match, else it
 * throws the named doorway error. Non-doorway targets never read stats.
 */
export async function waitForRr1Phase(read, target, order, timeoutMs, label, doorwayClock = {}) {
  const deadline = Date.now() + timeoutMs;
  let firstMatchAtMs = null;
  while (Date.now() < deadline) {
    const value = read();
    const status = order(value, target);
    if (status === "match" && target.phase !== "doorway") return value;
    if (status === "match") {
      if (rr1DoorwayClockStarted(doorwayClock.getStats(), target.stationIndex)) return value;
      if (firstMatchAtMs === null) firstMatchAtMs = Date.now();
      if (Date.now() - firstMatchAtMs >= doorwayClock.boundMs) {
        throw new Error(`doorway clock not started: waiting for ${label}, station ${target.stationIndex}`);
      }
      await sleep(25);
      continue;
    }
    if (status === "passed") {
      throw new Error(`phase passed: waiting for ${label}, observed station ${value.stationIndex} ${value.phase}`);
    }
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function assertCaptureWithinWindow({ artifact, captureStartedWallMs, captureEndedWallMs, window }) {
  const end = window.endWallMs ?? Number.POSITIVE_INFINITY;
  if (
    captureStartedWallMs < window.startWallMs
    || captureStartedWallMs >= end
    || captureEndedWallMs < window.startWallMs
    || captureEndedWallMs >= end
  ) {
    throw new Error(
      `${artifact} capture [${captureStartedWallMs}, ${captureEndedWallMs}] is outside marked window [${window.startWallMs}, ${window.endWallMs ?? "Infinity"})`,
    );
  }
  return window;
}

/** Refuse any chapter artifact whose screenshot started before the interior preview camera latched. */
export function assertCaptureAfterLatch({ artifact, captureStartedWallMs, latchWallMs }) {
  if (!Number.isFinite(latchWallMs)) {
    throw new Error(`${artifact} capture has no interior preview latch wall clock; latchWallMs=${String(latchWallMs)}`);
  }
  if (captureStartedWallMs < latchWallMs) {
    throw new Error(`${artifact} capture started ${captureStartedWallMs} before interior preview latch ${latchWallMs}`);
  }
  return true;
}

export function artifactCaptureMargins({ captureStartedWallMs, captureEndedWallMs, window }) {
  const startMarginMs = captureStartedWallMs - window.startWallMs;
  const endMarginMs = window.endWallMs === null ? null : window.endWallMs - captureEndedWallMs;
  return { startMarginMs, endMarginMs, endMarginLow: endMarginMs !== null && endMarginMs < 100 };
}

function recordArtifactMargins(artifact, window) {
  const margins = artifactCaptureMargins({ ...artifact, window });
  Object.assign(artifact, { markedWindow: window, startMarginMs: margins.startMarginMs, endMarginMs: margins.endMarginMs });
  console.log(`MARGIN ${artifact.artifact} start=${margins.startMarginMs} end=${margins.endMarginMs ?? "null"}`);
  if (margins.endMarginLow) console.log(`MARGIN_LOW ${artifact.artifact}`);
}

export function assertArtifactWithinMarkedWindow(input) {
  return assertCaptureWithinWindow({
    ...input,
    window: learnerHeaderWindow(input.log, input.phase, input.station, input.phaseServerMs),
  });
}

export function assertArtifactWithinFacultyStatusWindow(input) {
  return assertCaptureWithinWindow({
    ...input,
    window: facultyStatusWindow(input.log, input.statusNeedle, input.statusServerMs),
  });
}

/** One frame at the recorded 25 fps: a shorter hold encodes zero frames. */
export const HOLD_FRAME_SECONDS = 1 / 25;

/**
 * Pure hold-segment decision: a sub-frame hold would encode a header-only webm
 * with no video stream (run-1: 472 bytes, unopenable), which breaks the concat
 * demuxer and drops the trailing faculty segment. Skip it instead.
 */
export function holdConcatPlan(timelineHoldSeconds) {
  return { includeHold: timelineHoldSeconds >= HOLD_FRAME_SECONDS };
}

/** ffmpeg args for the learner-hold still segment (VP8/yuv420p/25fps like the learner raw). */
export function learnerHoldEncodeArgs({ framePng, seconds, outPath }) {
  return [
    "-y", "-v", "error", "-loop", "1", "-i", framePng, "-t", String(seconds), "-r", "25",
    "-an", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "5", "-pix_fmt", "yuv420p", outPath,
  ];
}

export function c14HostReviewUrl(base, sync, rubric) {
  return `${base}?${new URLSearchParams({ sync, iwer: "1", autostart: "1", script: "c14", rubric: JSON.stringify(rubric) })}`;
}

/** Leading-silence end in seconds (0 when the stream starts with sound). Shared with the offline regression fixture. */
export function speechOnsetSeconds(path) {
  const result = spawnSync("ffmpeg", ["-v", "info", "-i", path, "-af", "silencedetect=noise=-50dB:d=0.02", "-f", "null", "-"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`silencedetect failed for ${path}: ${String(result.stderr).slice(-500)}`);
  // Leading silence exists only when the stream STARTS silent: the first event
  // is a silence_start inside the d=0.02 detection window, followed by its end.
  // A stream that starts with sound has onset 0; its first silence_end is an
  // inter-word gap, not the onset (run-1: 0.987), and subtracting it places
  // speech early by that gap.
  const firstStart = /silence_start: (-?[0-9.]+)/u.exec(result.stderr)?.[1];
  const firstEnd = /silence_end: (-?[0-9.]+)/u.exec(result.stderr)?.[1];
  if (firstStart === undefined || firstEnd === undefined) return 0;
  const startSeconds = Number(firstStart);
  const endSeconds = Number(firstEnd);
  if (!(startSeconds <= 0.02) || !(endSeconds > startSeconds)) return 0;
  return endSeconds;
}

async function waitFor(read, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (predicate(value)) return value;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function iwerGlue() {
  const device = new IWER.XRDevice(IWER.metaQuest3);
  device.installRuntime({ forceInstall: true });
}

function learnerHeaderObserverInit() {
  globalThis.__openClinXrLearnerHeaderLog = [];
  const sample = () => {
    const eyebrow = document.querySelector("#doorway-eyebrow");
    const station = document.querySelector("#doorway-station");
    if (eyebrow === null || station === null) return;
    const next = {
      eyebrow: eyebrow.textContent?.trim() ?? "",
      station: station.textContent?.trim() ?? "",
      wallMs: Date.now(),
    };
    const prior = globalThis.__openClinXrLearnerHeaderLog.at(-1);
    if (prior?.eyebrow !== next.eyebrow || prior?.station !== next.station) {
      globalThis.__openClinXrLearnerHeaderLog.push(next);
    }
  };
  globalThis.__openClinXrLearnerHeaderObserver = new MutationObserver(sample);
  globalThis.__openClinXrLearnerHeaderObserver.observe(document, { childList: true, characterData: true, subtree: true });
  sample();
}

function learnerPageCaptureInit(config) {
  globalThis.__openClinXrSceneReadyWallMs = null;
  globalThis.__openClinXrInteriorLatchWallMs = null;
  const checkInteriorPreviewLatch = () => {
    if (globalThis.__openClinXrInteriorLatchWallMs !== null) return;
    if ((globalThis.__openClinXrGazeCamera?.userData?.openClinXrInteriorPreviewCamera ?? null) != null) {
      globalThis.__openClinXrInteriorLatchWallMs = Date.now();
      return;
    }
    requestAnimationFrame(() => { setTimeout(checkInteriorPreviewLatch, 0); });
  };
  requestAnimationFrame(() => { setTimeout(checkInteriorPreviewLatch, 0); });
  if (config.sceneReady) {
    let sceneAssetEvidence;
    let sceneReadyFrameScheduled = false;
    Object.defineProperty(globalThis, "__openClinXrSceneAssetEvidence", {
      configurable: true,
      get: () => sceneAssetEvidence,
      set: (value) => {
        sceneAssetEvidence = value;
        if (globalThis.__openClinXrSceneReadyWallMs === null && !sceneReadyFrameScheduled && sceneHumanoidAssetsReady(value)) {
          sceneReadyFrameScheduled = true;
          requestAnimationFrame(() => {
            globalThis.__openClinXrSceneReadyWallMs = Date.now();
          });
        }
      },
    });
  }
  globalThis.__openClinXrJoinWallMs = null;
  const joinObserver = setInterval(() => {
    if (globalThis.__openClinXrEncounterSync?.state !== "joined") return;
    globalThis.__openClinXrJoinWallMs = Date.now();
    clearInterval(joinObserver);
  }, 1);

  const installStyle = () => {
    if (document.head === null || document.querySelector("style[data-openclinxr-rr1]") !== null) return;
    const style = document.createElement("style");
    style.dataset.openclinxrRr1 = "";
    style.textContent = config.presentationCss;
    document.head.appendChild(style);
  };
  installStyle();

  globalThis.__openClinXrDialogueChangeLog = [];
  globalThis.__openClinXrPhaseAgreementLog = [];
  const sample = () => {
    installStyle();
    if (config.dialogue) {
      const next = { atMs: Date.now(), text: document.querySelector("#dialogue-line")?.textContent ?? "" };
      const prior = globalThis.__openClinXrDialogueChangeLog.at(-1);
      if (prior?.text !== next.text) globalThis.__openClinXrDialogueChangeLog.push(next);
    }
    if (config.phaseAgreement) {
      const next = {
        atMs: Date.now(),
        eyebrow: document.querySelector("#doorway-eyebrow")?.textContent?.trim() ?? "",
        phaseRow: document.querySelector("#station-clock-label")?.textContent?.trim() ?? "",
      };
      const prior = globalThis.__openClinXrPhaseAgreementLog.at(-1);
      if (prior?.eyebrow !== next.eyebrow || prior?.phaseRow !== next.phaseRow) globalThis.__openClinXrPhaseAgreementLog.push(next);
    }
  };
  sample();
  globalThis.__openClinXrDialogueObserver = new MutationObserver(sample);
  globalThis.__openClinXrDialogueObserver.observe(document, { childList: true, characterData: true, subtree: true });
  globalThis.__openClinXrPhaseAgreementObserver = globalThis.__openClinXrDialogueObserver;

  if (config.visibleDomText) {
    globalThis.__openClinXrVisibleDomTextLog = [];
    const sampleVisibleText = () => {
      const target = document.querySelector(".runtime-panel") ?? document.body;
      if (target === null) return;
      globalThis.__openClinXrVisibleDomTextLog.push({ atMs: Date.now(), innerText: target.innerText });
    };
    sampleVisibleText();
    globalThis.__openClinXrVisibleDomTextTimer = setInterval(sampleVisibleText, 250);
  }
}

function facultyStatusObserverInit(config) {
  globalThis.__openClinXrFacultyStatusLog = [];
  globalThis.__openClinXrFacultyLayoutEvents = [];
  globalThis.__openClinXrFacultyLayoutFrames = [];
  globalThis.__openClinXrFacultyOcclusionMeasurements = [];
  globalThis.__openClinXrFacultyLayoutActive = true;
  const overlayMeasurement = () => {
    const lines = [...document.querySelectorAll("body > div")].map((element) => ({
      id: element.id,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      boxRight: element.getBoundingClientRect().right,
    }));
    return {
      viewportWidth: innerWidth,
      overlayBoxRight: Math.max(0, ...lines.map((line) => line.boxRight)),
      lines,
    };
  };
  const dimensions = () => ({ innerWidth, innerHeight, devicePixelRatio });
  let priorDimensions = null;
  globalThis.__openClinXrFacultyLayoutEvent = (kind) => {
    globalThis.__openClinXrFacultyLayoutEvents.push({ wallMs: Date.now(), kind, ...dimensions() });
  };
  globalThis.__openClinXrFacultyContainerSnapshot = (kind) => {
    const element = document.querySelector("#sync-probe-iwer-container");
    const box = element?.getBoundingClientRect();
    globalThis.__openClinXrFacultyLayoutEvents.push({
      wallMs: Date.now(),
      kind,
      tagName: element?.tagName ?? null,
      id: element?.id ?? null,
      className: element?.className ?? null,
      firstChildTagName: element?.firstElementChild?.tagName ?? null,
      borderBoxWidth: box?.width ?? null,
      ...dimensions(),
    });
  };
  globalThis.__openClinXrFacultyOcclusionSnapshot = (kind, observedWallMs = Date.now()) => {
    const target = document.querySelector("#sync-probe-c14");
    if (target === null) throw new Error("faculty occlusion measurement is missing #sync-probe-c14");
    const range = document.createRange();
    range.selectNodeContents(target);
    const textBox = range.getBoundingClientRect();
    const targetStyle = getComputedStyle(target);
    const y = (textBox.top + textBox.bottom) / 2;
    const points = [20, 100, textBox.right - 4].map((x) => {
      const hit = document.elementFromPoint(x, y);
      const hitStyle = hit === null ? null : getComputedStyle(hit);
      return {
        x,
        y,
        tagName: hit?.tagName ?? null,
        id: hit?.id ?? null,
        className: hit?.className ?? null,
        position: hitStyle?.position ?? null,
        zIndex: hitStyle?.zIndex ?? null,
        isTargetOrDescendant: hit !== null && (hit === target || target.contains(hit)),
      };
    });
    const measurement = {
      wallMs: observedWallMs,
      kind,
      target: { tagName: target.tagName, id: target.id, position: targetStyle.position, zIndex: targetStyle.zIndex },
      textExtent: { left: textBox.left, right: textBox.right, top: textBox.top, bottom: textBox.bottom },
      points,
    };
    globalThis.__openClinXrFacultyOcclusionMeasurements.push(measurement);
    return measurement;
  };
  globalThis.__openClinXrFacultyLayoutEvent("initial-layout");
  addEventListener("resize", () => globalThis.__openClinXrFacultyLayoutEvent("window-resize"));
  const sampleFrame = () => {
    if (!globalThis.__openClinXrFacultyLayoutActive) return;
    const wallMs = Date.now();
    const currentDimensions = dimensions();
    if (priorDimensions !== null && (
      priorDimensions.innerWidth !== currentDimensions.innerWidth
      || priorDimensions.innerHeight !== currentDimensions.innerHeight
      || priorDimensions.devicePixelRatio !== currentDimensions.devicePixelRatio
    )) {
      globalThis.__openClinXrFacultyLayoutEvents.push({ wallMs, kind: "dimensions-change", ...currentDimensions });
    }
    priorDimensions = currentDimensions;
    const overlay = overlayMeasurement();
    globalThis.__openClinXrFacultyLayoutFrames.push({
      wallMs,
      ...currentDimensions,
      overlayBoxRight: overlay.overlayBoxRight,
      overlayClientWidth: Math.max(0, ...overlay.lines.map((line) => line.clientWidth)),
      maxLineScrollWidth: Math.max(0, ...overlay.lines.map((line) => line.scrollWidth)),
    });
    requestAnimationFrame(sampleFrame);
  };
  requestAnimationFrame(sampleFrame);
  const sample = () => {
    const status = document.querySelector("#sync-probe-c14");
    if (status === null) return;
    const next = { status: status.textContent?.trim() ?? "", wallMs: Date.now(), overlayFitMeasurement: overlayMeasurement() };
    const prior = globalThis.__openClinXrFacultyStatusLog.at(-1);
    if (prior?.status !== next.status) {
      globalThis.__openClinXrFacultyStatusLog.push(next);
      if (next.status.toLowerCase().includes("signoff:finalized")) {
        globalThis.__openClinXrFacultyOcclusionSnapshot(`${config.surface}:ch5-offset`, next.wallMs);
      }
    }
  };
  globalThis.__openClinXrFacultyStatusObserver = new MutationObserver(sample);
  globalThis.__openClinXrFacultyStatusObserver.observe(document, { childList: true, characterData: true, subtree: true });
  sample();
}

const RUBRIC = [
  { id: "hpi-onset", label: "Asked onset" },
  { id: "pe-lungs", label: "Examined lungs" },
  { id: "plan-shared", label: "Shared the plan" },
];

/** Pure regression seam for the count/equality wait used by the browser run. */
export function assessRecordedTurn({ turnsBefore, turnsAfter, displayedLine }) {
  const turn = turnsAfter[turnsBefore] ?? null;
  const renderedLine = turn?.planCaption ?? "";
  return {
    advanced: turnsAfter.length > turnsBefore,
    renderedLine,
    renderedLineMatches: renderedLine !== "" && displayedLine === renderedLine,
    turn,
  };
}

async function sendLearnerQuestion(page, liveServer, text, label) {
  const turnsBefore = await page.evaluate(() => globalThis.__openClinXrEncounterSync?.turns?.length ?? 0);
  await page.evaluate((utterance) => {
    document.getElementById("utterance-input").value = utterance;
    document.getElementById("utterance-send").click();
  }, text);
  await page.waitForFunction(
    (before) => (globalThis.__openClinXrEncounterSync?.turns?.length ?? 0) > before,
    turnsBefore,
    { timeout: 30000 },
  );
  const played = await page.evaluate((index) => {
    const turns = globalThis.__openClinXrEncounterSync?.turns ?? [];
    return { turns, displayedLine: document.getElementById("dialogue-line")?.innerText ?? "", indexedTurn: turns[index] ?? null };
  }, turnsBefore);
  const expectedLine = played.indexedTurn?.planCaption ?? "";
  await page.waitForFunction(
    (line) => line !== "" && (document.getElementById("dialogue-line")?.innerText ?? "") === line,
    expectedLine,
    { timeout: 30000 },
  );
  const displayedLine = await page.locator("#dialogue-line").innerText();
  const displayedAtMs = await page.evaluate((line) => {
    const found = [...(globalThis.__openClinXrDialogueChangeLog ?? [])].reverse().find((entry) => entry.text === line);
    return found?.atMs ?? Date.now();
  }, displayedLine);
  const assessed = assessRecordedTurn({ turnsBefore, turnsAfter: played.turns, displayedLine });
  if (!assessed.advanced || !assessed.renderedLineMatches || assessed.turn === null) {
    throw new Error(`${label} did not advance one rendered server turn: ${JSON.stringify({ turnsBefore, turnsAfter: played.turns.length, expectedLine, displayedLine })}`);
  }
  const actorState = JSON.parse(liveServer.getStateJSON()).actors?.[assessed.turn.actorId];
  return {
    label,
    turnsBefore,
    turnsAfter: played.turns.length,
    replyId: assessed.turn.replyId,
    cueId: actorState?.cueId ?? "",
    renderedLine: assessed.renderedLine,
    displayedLine,
    displayedAtMs,
  };
}

async function runCapture(storeRoot) {
  const { dir: runDir, n: runNumber } = pickRunDir(storeRoot);
  const traceDir = join(runDir, "trace");
  const scoreDir = join(runDir, "scores");
  const videoDir = join(runDir, "video-raw");
  const facultyVideoDir = join(runDir, "faculty-video-raw");
  const audioDir = join(runDir, "audio");
  const panelDir = join(runDir, "panels");
  const frameDir = join(runDir, "frames");
  for (const dir of [traceDir, scoreDir, videoDir, facultyVideoDir, audioDir, panelDir, frameDir]) mkdirSync(dir, { recursive: true });
  for (const path of [join(APP_DIST, "index.html"), SERVER_DIST, FIXTURES_DIST, CLIENT_DIST, join(FACULTY_DIST, "sync-probe.html"), IWER_BUNDLE, CSS_PATH]) {
    if (!existsSync(path)) throw new Error(`required build/input missing: ${path}`);
  }
  assertNoRouteHoldsStaticChunk({
    routePatterns: RR1_LEARNER_ROUTE_PATTERNS,
    ...readStaticChunkInputs(APP_DIST),
  });

  const timing = { doorwaySeconds: 4, encounterSeconds: 10, noteSeconds: 2, breakAfterStationOrders: [] };
  const blueprint = {
    blueprintId: "rr1-min-ed-chest-pain",
    title: "RR1-min ED chest pain",
    stationSlots: [slot(1), slot(2), slot(3)],
    timing,
    requiredTraceTags: [],
    requiredSafetyCriticalTraceTags: [],
  };
  const fixtures = await import(FIXTURES_DIST);
  const scenario = { ...fixtures.edChestPainScenario, status: "approved" };
  const patient = scenario.actors.find((actor) => actor.role === "patient");
  if (patient === undefined) throw new Error("ED chest-pain scenario has no patient actor");
  const onsetSeed = fixtures.scenarioDialogueSeedBank
    .find((entry) => entry.scenarioId === scenario.scenarioId)?.seeds
    .find((seed) => seed.actorId === patient.actorId && seed.seedId === "patient_onset_history");
  const learnerQuestion = onsetSeed?.utterancePhrases?.[0] ?? "When did the pain start?";
  const serverModule = await import(SERVER_DIST);
  const { createEncounterServer, stationPhaseOrder } = serverModule;
  const { chromium } = await import("playwright");
  let liveServer = null;
  const learnerStatic = await startStaticServer(APP_DIST);
  let facultyStatic = null;
  let replayServer = null;
  const replayClientHandles = new Set();
  let browser = null;
  let context = null;
  let evidenceContext = null;
  let evidencePage = null;
  let page = null;
  let pageVideo = null;
  let learnerRawVideo = null;
  let learnerRecordingOriginWallMs = null;
  let facultyRecordingOriginWallMs = null;
  let facultyRecordingStopWallMs = null;
  let facultyRecordingStopState = null;
  let learnerJoinWallMs = null;
  let evidenceJoinWallMs = null;
  let learnerSyncStartWallMs = null;
  let learnerSyncLagMs = null;
  let learnerSceneReadyWallMs = null;
  let learnerSceneLagMs = null;
  const environmentGlbResponses = [];
  let learnerPoseAtSceneReady = null;
  let learnerPoseAtCh1 = null;
  let ch1CaptureWallMs = null;
  const captureStartedAtMs = Date.now();
  const pageErrors = [];
  const consoleErrors = [];
  const serverClock = [];
  const clockKeys = new Set();
  const marks = [];
  const panelEvidence = [];
  const viewportFrames = [];
  const artifactCaptures = [];
  let learnerLatchWallMs = null;
  let evidenceLatchWallMs = null;
  let doorwayStartPlan = null;
  let ch1WindowMargin = { frameMs: null, panelMs: null };
  const ensureInteriorPreviewLatch = async (targetPage, kind) => {
    if (kind === "learner" && Number.isFinite(learnerLatchWallMs)) return learnerLatchWallMs;
    if (kind === "evidence" && Number.isFinite(evidenceLatchWallMs)) return evidenceLatchWallMs;
    await targetPage.waitForFunction(
      () => (globalThis.__openClinXrGazeCamera?.userData?.openClinXrInteriorPreviewCamera ?? null) != null,
      undefined,
      { timeout: 30000 },
    );
    const inPageLatchWallMs = await targetPage.evaluate(() => new Promise((resolve) => {
      const read = () => globalThis.__openClinXrInteriorLatchWallMs ?? null;
      if (Number.isFinite(read())) {
        resolve(read());
        return;
      }
      requestAnimationFrame(() => resolve(read()));
    }));
    if (!Number.isFinite(inPageLatchWallMs)) return undefined;
    if (kind === "learner") learnerLatchWallMs = inPageLatchWallMs;
    else evidenceLatchWallMs = inPageLatchWallMs;
    return inPageLatchWallMs;
  };
  const markTimings = [];
  const turnEvidence = [];
  let learnerDomLog = [];
  let learnerHeaderLog = [];
  let evidenceHeaderLog = [];
  let phaseAgreementLog = [];
  let facultyDomLog = [];
  let facultyStatusLog = [];
  let facultyLayoutLog = { events: [], animationFrames: [] };
  let facultyRecordedStopStateLines = null;
  let facultyProbe = null;
  const deferredAssertions = createDeferredErrorCollector();
  let actorReply = "";
  const phaseSnapshot = (stationIndex) => {
    const stats = liveServer.getProbeStats();
    for (const [phase, serverMs] of Object.entries(stats.phaseChangedAtMs ?? {})) {
      const actualStation = phase === "prev-station-closed" ? stationIndex - 1 : stationIndex;
      const actualPhase = phase === "prev-station-closed" ? "closed" : phase;
      if (actualStation < 0 || typeof serverMs !== "number") continue;
      const key = `${actualStation}|phase|${actualPhase}`;
      if (clockKeys.has(key)) continue;
      clockKeys.add(key);
      serverClock.push({ stationIndex: actualStation, phase: actualPhase, serverMs });
    }
  };
  const mark = async (id, stationIndex, phase) => {
    const hostMarkEnteredWallMs = Date.now();
    phaseSnapshot(stationIndex);
    const clock = deferredAssertions.capture(
      "server-clock",
      () => {
        const found = serverClock.find((entry) => entry.stationIndex === stationIndex && entry.phase === phase);
        if (found === undefined) throw new Error(`server clock missing (${stationIndex},${phase}) at ${id}`);
        return found;
      },
      { stationIndex, phase, serverMs: hostMarkEnteredWallMs },
    );
    const framePath = join(frameDir, `${id}.png`);
    const panelPath = join(panelDir, `${id}-runtime-panel.png`);
    const stationLabel = `Station ${stationIndex + 1} of 3`;
    const waitForPageHeader = async (targetPage) => {
      // waitForFunction serialises its closure, so the in-page predicate calls
      // THIS function via its own source (no second copy of the logic); the
      // shared entry rule travels alongside, also by source, self-contained.
      const predicateSource = rr1HeaderShowsPhase.toString();
      const entrySource = rr1PhaseEntryIndex.toString();
      try {
        await targetPage.waitForFunction(
          ({ phaseName, station, phaseServerMs, predicateSource, entrySource }) => {
            const entryIndex = new Function(`return (${entrySource});`)();
            const showsPhase = new Function("rr1PhaseEntryIndex", `return (${predicateSource});`)(entryIndex);
            return showsPhase(globalThis.__openClinXrLearnerHeaderLog ?? [], { phaseName, station, phaseServerMs });
          },
          { phaseName: phase, station: stationLabel, phaseServerMs: clock.serverMs, predicateSource, entrySource },
          { timeout: 15000 },
        );
      } catch {
        const timedOutLog = await targetPage.evaluate(() => JSON.parse(JSON.stringify(globalThis.__openClinXrLearnerHeaderLog ?? [])));
        deferredAssertions.capture("learner-header-selection", () => selectObservedWallMs(timedOutLog, phase, stationLabel, clock.serverMs));
      }
      return targetPage.evaluate(() => JSON.parse(JSON.stringify(globalThis.__openClinXrLearnerHeaderLog ?? [])));
    };
    const [recordedCapture, evidenceCapture] = await Promise.all([
      (async () => {
        const recordedHeaderLog = await waitForPageHeader(page);
        const observedWallMs = deferredAssertions.capture("learner-header-selection", () => selectObservedWallMs(recordedHeaderLog, phase, stationLabel, clock.serverMs), clock.serverMs);
        let latchWallMs = learnerLatchWallMs;
        if (!Number.isFinite(latchWallMs)) {
          try {
            latchWallMs = await ensureInteriorPreviewLatch(page, "learner");
          } catch (error) {
            deferredAssertions.reject("learner-artifact-window", `interior preview latch never observed on the learner page before frames/${id}.png: ${String(error instanceof Error ? error.message : error)}`);
            latchWallMs = undefined;
          }
        }
        const observationResolvedWallMs = Date.now();
        const captureStartedWallMs = Date.now();
        deferredAssertions.capture("learner-artifact-window", () => assertCaptureAfterLatch({ artifact: `frames/${id}.png`, captureStartedWallMs, latchWallMs }));
        await page.screenshot({ path: framePath, timeout: 30000 });
        const captureEndedWallMs = Date.now();
        return {
          observedWallMs,
          observationResolvedWallMs,
          artifact: {
            artifact: `frames/${id}.png`,
            page: "learner",
            phase,
            station: stationLabel,
            phaseServerMs: clock.serverMs,
            captureStartedWallMs,
            captureEndedWallMs,
            latchWallMs,
          },
        };
      })(),
      (async () => {
        const evidenceHeaderLog = await waitForPageHeader(evidencePage);
        deferredAssertions.capture("learner-header-selection", () => selectObservedWallMs(evidenceHeaderLog, phase, stationLabel, clock.serverMs), clock.serverMs);
        let latchWallMs = evidenceLatchWallMs;
        if (!Number.isFinite(latchWallMs)) {
          try {
            latchWallMs = await ensureInteriorPreviewLatch(evidencePage, "evidence");
          } catch (error) {
            deferredAssertions.reject("learner-artifact-window", `interior preview latch never observed on the evidence page before panels/${id}-runtime-panel.png: ${String(error instanceof Error ? error.message : error)}`);
            latchWallMs = undefined;
          }
        }
        const observationResolvedWallMs = Date.now();
        const panel = await shootRuntimePanelContentHeight(evidencePage, panelPath);
        deferredAssertions.capture("learner-artifact-window", () => assertCaptureAfterLatch({ artifact: `panels/${id}-runtime-panel.png`, captureStartedWallMs: panel.captureStartedWallMs, latchWallMs }));
        const eyebrow = await evidencePage.locator("#doorway-eyebrow").innerText();
        return {
          panel,
          eyebrow,
          observationResolvedWallMs,
          artifact: {
            artifact: `panels/${id}-runtime-panel.png`,
            page: "evidence",
            phase,
            station: stationLabel,
            phaseServerMs: clock.serverMs,
            captureStartedWallMs: panel.captureStartedWallMs,
            captureEndedWallMs: panel.captureEndedWallMs,
            latchWallMs,
          },
        };
      })(),
    ]);
    artifactCaptures.push(recordedCapture.artifact, evidenceCapture.artifact);
    const { observedWallMs } = recordedCapture;
    const { panel, eyebrow } = evidenceCapture;
    markTimings.push({
      id,
      stationIndex,
      phase,
      phaseServerMs: clock.serverMs,
      hostMarkEnteredWallMs,
      pages: {
        learner: {
          observationResolvedWallMs: recordedCapture.observationResolvedWallMs,
          captureStartedWallMs: recordedCapture.artifact.captureStartedWallMs,
        },
        evidence: {
          observationResolvedWallMs: evidenceCapture.observationResolvedWallMs,
          captureStartedWallMs: evidenceCapture.artifact.captureStartedWallMs,
        },
      },
    });
    marks.push({ id, stationIndex, phase, serverMs: clock.serverMs, observedWallMs, recording: "learner" });
    viewportFrames.push({
      id,
      file: `frames/${id}.png`,
      captureStartedWallMs: recordedCapture.artifact.captureStartedWallMs,
      captureEndedWallMs: recordedCapture.artifact.captureEndedWallMs,
      latchWallMs: recordedCapture.artifact.latchWallMs,
      ...deferredAssertions.capture("artifact-png", () => pngSize(framePath), { width: 0, height: 0, bytes: 0 }),
    });
    panelEvidence.push({ id, file: `panels/${id}-runtime-panel.png`, ...panel, eyebrow, path: undefined });
  };

  try {
    browser = await chromium.launch({ headless: true, channel: "chromium", args: GPU_ARGS });
    const presentationCss = readFileSync(CSS_PATH, "utf8");
    context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, recordVideo: { dir: videoDir, size: VIEWPORT } });
    await context.addInitScript({ content: `${readFileSync(IWER_BUNDLE, "utf8")};const sceneHumanoidAssetsReady=${sceneHumanoidAssetsReady.toString()};(${iwerGlue.toString()})();(${learnerHeaderObserverInit.toString()})();(${learnerPageCaptureInit.toString()})(${JSON.stringify({ presentationCss, dialogue: true, phaseAgreement: true, visibleDomText: true, sceneReady: true })});` });
    evidenceContext = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    await evidenceContext.addInitScript({ content: `${readFileSync(IWER_BUNDLE, "utf8")};const sceneHumanoidAssetsReady=${sceneHumanoidAssetsReady.toString()};(${iwerGlue.toString()})();(${learnerHeaderObserverInit.toString()})();(${learnerPageCaptureInit.toString()})(${JSON.stringify({ presentationCss, dialogue: false, phaseAgreement: false, visibleDomText: false, sceneReady: false })});` });
    // RR1_CAPTURE_THROW_SCAN_START: the first recorded page starts here.
    page = await context.newPage();
    pageVideo = page.video();
    evidencePage = await evidenceContext.newPage();
    learnerRecordingOriginWallMs = await page.evaluate(() => Date.now());
    liveServer = await createEncounterServer({
      examBlueprint: blueprint,
      scenarios: [scenario, scenario, scenario],
      dialogueSeeds: fixtures.scenarioDialogueSeedBank,
      traceDir,
    });
    page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 300)));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300)); });
    page.on("response", (response) => {
      const url = response.url();
      if (!url.includes("/xr-assets/environment/") || !url.endsWith(".glb")) return;
      const receivedWallMs = Date.now();
      void response.body().then((body) => {
        environmentGlbResponses.push({ url, body, wallMs: receivedWallMs });
      }).catch(() => undefined);
    });
    const learnerUrl = `http://127.0.0.1:${learnerStatic.port}/?${new URLSearchParams({ encounterSync: liveServer.url })}`;
    const pageNavigations = Promise.all([page, evidencePage].map((targetPage) => targetPage.goto(learnerUrl, { timeout: 60000, waitUntil: "load" })));
    void pageNavigations.catch(() => undefined);
    [learnerLatchWallMs, evidenceLatchWallMs] = await Promise.all([
      ensureInteriorPreviewLatch(page, "learner"),
      ensureInteriorPreviewLatch(evidencePage, "evidence"),
    ]);
    doorwayStartPlan = rr1DoorwayStartPlan({ learnerLatchWallMs, evidenceLatchWallMs });
    await pageNavigations;
    await Promise.all([page, evidencePage].map(async (targetPage) => {
      await targetPage.waitForFunction(() => globalThis.__openClinXrEncounterSync?.state === "joined", undefined, { timeout: 240000 });
      await targetPage.waitForFunction(() => typeof globalThis.__openClinXrJoinWallMs === "number", undefined, { timeout: 15000 });
    }));
    [learnerJoinWallMs, evidenceJoinWallMs] = await Promise.all([
      page.evaluate(() => globalThis.__openClinXrJoinWallMs),
      evidencePage.evaluate(() => globalThis.__openClinXrJoinWallMs),
    ]);
    deferredAssertions.capture("join-clocks", () => {
      assertCaptureCondition(typeof learnerJoinWallMs === "number" && typeof evidenceJoinWallMs === "number", `join wall clock missing: learner=${learnerJoinWallMs} evidence=${evidenceJoinWallMs}`);
    });
    learnerJoinWallMs ??= Date.now();
    evidenceJoinWallMs ??= learnerJoinWallMs;
    console.log(`JOIN_GAP ${evidenceJoinWallMs - learnerJoinWallMs}`);
    let syncRenderWaitError = null;
    try {
      await page.waitForFunction(
        () => (globalThis.__openClinXrLearnerHeaderLog ?? []).some((entry) => typeof entry.station === "string" && entry.station.trim() !== ""),
        undefined,
        { timeout: 15000 },
      );
    } catch (error) {
      syncRenderWaitError = error;
    }
    const initialLearnerHeaderLog = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__openClinXrLearnerHeaderLog ?? [])));
    learnerSyncStartWallMs = deferredAssertions.capture("sync-render", () => selectLearnerSyncStartWallMs(initialLearnerHeaderLog), learnerJoinWallMs);
    if (syncRenderWaitError !== null) deferredAssertions.reject("sync-render", String(syncRenderWaitError));
    learnerSyncLagMs = learnerSyncStartWallMs - learnerJoinWallMs;
    console.log(`SYNC_LAG ${learnerSyncLagMs}`);
    deferredAssertions.capture("sync-lag", () => assertLearnerSyncLag(learnerSyncStartWallMs, learnerJoinWallMs));
    const state = () => JSON.parse(liveServer.getStateJSON());
    // Production doorway clock-start bound: server ready timeout plus one poll.
    const doorwayClockBoundMs = rr1DoorwayClockBoundFromServer(serverModule);
    const doorwayClock = { getStats: () => liveServer.getProbeStats(), boundMs: doorwayClockBoundMs };
    await waitForRr1Phase(state, { stationIndex: 0, phase: "doorway" }, stationPhaseOrder, 60000, "station 0 doorway", doorwayClock);
    await mark("ch1", 0, "doorway");
    try {
      const diagDir = join(runDir, "diag");
      mkdirSync(diagDir, { recursive: true });
      const ch1LearnerHeaderLog = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__openClinXrLearnerHeaderLog ?? [])));
      const ch1EvidenceHeaderLog = await evidencePage.evaluate(() => JSON.parse(JSON.stringify(globalThis.__openClinXrLearnerHeaderLog ?? [])));
      const ch1Clock = serverClock.find((entry) => entry.stationIndex === 0 && entry.phase === "doorway") ?? null;
      const ch1PhaseServerMs = ch1Clock?.serverMs;
      writeFileSync(join(diagDir, "ch1-header-replay.json"), `${JSON.stringify({
        ch1: { phase: "doorway", station: "Station 1 of 3", phaseServerMs: ch1PhaseServerMs ?? null },
        serverClock: ch1Clock,
        learnerHeaderLog: ch1LearnerHeaderLog,
        evidenceHeaderLog: ch1EvidenceHeaderLog,
        rr1HeaderShowsPhase: typeof ch1PhaseServerMs === "number" ? {
          learner: rr1HeaderShowsPhase(ch1LearnerHeaderLog, { phaseName: "doorway", station: "Station 1 of 3", phaseServerMs: ch1PhaseServerMs }),
          evidence: rr1HeaderShowsPhase(ch1EvidenceHeaderLog, { phaseName: "doorway", station: "Station 1 of 3", phaseServerMs: ch1PhaseServerMs }),
        } : null,
      }, null, 2)}\n`);
    } catch (error) {
      console.error(`CH1_HEADER_REPLAY_DUMP_FAILED ${String(error instanceof Error ? error.message : error)}`);
    }
    const ch1LearnerArtifact = artifactCaptures.find((entry) => entry.artifact === "frames/ch1.png");
    ch1CaptureWallMs = ch1LearnerArtifact?.captureEndedWallMs ?? Date.now();
    let ch1PoseRaw = null;
    try {
      ch1PoseRaw = await readLearnerCameraPose(page);
    } catch {
      ch1PoseRaw = null;
    }
    const ch1PoseWallMs = Date.now();
    learnerPoseAtCh1 = deferredAssertions.capture(
      "learner-trim-inputs",
      () => snapshotLearnerPose(requireCaptureValue(ch1PoseRaw, "learner gaze camera missing at ch1"), ch1PoseWallMs),
      null,
    );
    await waitForRr1Phase(state, { stationIndex: 0, phase: "encounter" }, stationPhaseOrder, 60000, "station 0 encounter", doorwayClock);
    const openingTurn = await sendLearnerQuestion(page, liveServer, learnerQuestion, "opening-reply");
    turnEvidence.push(openingTurn);
    await waitFor(
      () => JSON.parse(liveServer.getStateJSON()).actors?.[patient.actorId]?.speaking,
      (speaking) => speaking === false,
      10000,
      "opening reply completion",
    );
    const topicTurn = await sendLearnerQuestion(page, liveServer, learnerQuestion, "patient-onset-history");
    turnEvidence.push(topicTurn);
    actorReply = topicTurn.renderedLine;
    await evidencePage.waitForFunction(
      (line) => (document.getElementById("dialogue-line")?.innerText ?? "") === line,
      actorReply,
      { timeout: 30000 },
    );
    await mark("ch2", 0, "encounter");
    await waitForRr1Phase(state, { stationIndex: 0, phase: "note" }, stationPhaseOrder, 60000, "station 0 note", doorwayClock);
    phaseSnapshot(0);
    await waitForRr1Phase(state, { stationIndex: 1, phase: "doorway" }, stationPhaseOrder, 60000, "station 1 doorway", doorwayClock);
    await mark("rot-doorway", 1, "doorway");
    await waitForRr1Phase(state, { stationIndex: 1, phase: "encounter" }, stationPhaseOrder, 60000, "station 1 encounter", doorwayClock);
    await mark("rot-encounter", 1, "encounter");
    await waitForRr1Phase(state, { stationIndex: 1, phase: "note" }, stationPhaseOrder, 60000, "station 1 note", doorwayClock);
    phaseSnapshot(1);
    await waitForRr1Phase(state, { stationIndex: 2, phase: "doorway" }, stationPhaseOrder, 60000, "station 2 doorway", doorwayClock);
    phaseSnapshot(2);
    await waitForRr1Phase(state, { stationIndex: 2, phase: "encounter" }, stationPhaseOrder, 60000, "station 2 encounter", doorwayClock);
    phaseSnapshot(2);
    await waitForRr1Phase(state, { stationIndex: 2, phase: "note" }, stationPhaseOrder, 60000, "station 2 note", doorwayClock);
    phaseSnapshot(2);
    await waitForRr1Phase(state, { stationIndex: 2, phase: "closed" }, stationPhaseOrder, 60000, "station 2 closed", doorwayClock);
    phaseSnapshot(2);
    try {
      await page.waitForFunction(() => typeof globalThis.__openClinXrSceneReadyWallMs === "number", undefined, { timeout: 180000 });
    } catch {
      const sceneReadySnapshot = await page.evaluate(() => ({
        sceneReadyWallMs: globalThis.__openClinXrSceneReadyWallMs,
        latchWallMs: globalThis.__openClinXrInteriorLatchWallMs ?? null,
        evidence: globalThis.__openClinXrSceneAssetEvidence,
      }));
      deferredAssertions.capture("scene-ready", () => assertSceneReadyObserved(sceneReadySnapshot.sceneReadyWallMs, sceneReadySnapshot.evidence));
    }
    const sceneReadySnapshot = await page.evaluate(() => ({
      sceneReadyWallMs: globalThis.__openClinXrSceneReadyWallMs,
      latchWallMs: globalThis.__openClinXrInteriorLatchWallMs ?? null,
      evidence: globalThis.__openClinXrSceneAssetEvidence,
    }));
    learnerSceneReadyWallMs = deferredAssertions.capture(
      "scene-ready",
      () => assertSceneReadyObserved(sceneReadySnapshot.sceneReadyWallMs, sceneReadySnapshot.evidence),
      learnerSyncStartWallMs,
    );
    if (Number.isFinite(sceneReadySnapshot.latchWallMs)) learnerLatchWallMs = sceneReadySnapshot.latchWallMs;
    learnerSceneLagMs = learnerSceneReadyWallMs - learnerSyncStartWallMs;
    console.log(`SCENE_LAG ${learnerSceneLagMs}`);
    let sceneReadyPoseRaw = null;
    try {
      sceneReadyPoseRaw = await readLearnerCameraPose(page);
    } catch {
      sceneReadyPoseRaw = null;
    }
    const sceneReadyPoseWallMs = Date.now();
    learnerPoseAtSceneReady = deferredAssertions.capture(
      "scene-ready",
      () => snapshotLearnerPose(requireCaptureValue(sceneReadyPoseRaw, "learner gaze camera missing at sceneReady"), sceneReadyPoseWallMs),
      null,
    );
    learnerDomLog = await takeVisibleDomTextLog(page);
    learnerHeaderLog = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__openClinXrLearnerHeaderLog ?? [])));
    evidenceHeaderLog = await evidencePage.evaluate(() => JSON.parse(JSON.stringify(globalThis.__openClinXrLearnerHeaderLog ?? [])));
    for (const artifact of artifactCaptures.filter((entry) => entry.page === "learner" || entry.page === "evidence")) {
      const log = artifact.page === "learner" ? learnerHeaderLog : evidenceHeaderLog;
      try {
        const window = assertArtifactWithinMarkedWindow({ ...artifact, log });
        recordArtifactMargins(artifact, window);
      } catch (error) {
        deferredAssertions.reject("learner-artifact-window", String(error instanceof Error ? error.message : error));
        try {
          recordArtifactMargins(artifact, learnerHeaderWindow(log, artifact.phase, artifact.station, artifact.phaseServerMs));
        } catch (windowError) {
          deferredAssertions.reject("learner-artifact-window", String(windowError instanceof Error ? windowError.message : windowError));
        }
      }
    }
    const ch1FrameArtifact = artifactCaptures.find((entry) => entry.artifact === "frames/ch1.png");
    const ch1PanelArtifact = artifactCaptures.find((entry) => entry.artifact === "panels/ch1-runtime-panel.png");
    const ch2MarkWallMs = Math.max(
      ch1FrameArtifact?.markedWindow?.endWallMs ?? Number.NaN,
      ch1PanelArtifact?.markedWindow?.endWallMs ?? Number.NaN,
    );
    const ch1MarginPlan = deferredAssertions.capture("ch1-window-margin", () => rr1DoorwayStartPlan({
      learnerLatchWallMs,
      evidenceLatchWallMs,
      ch2MarkWallMs,
      frameCaptureEndedWallMs: ch1FrameArtifact?.captureEndedWallMs,
      panelCaptureEndedWallMs: ch1PanelArtifact?.captureEndedWallMs,
    }), { ch1WindowMargin: { frameMs: null, panelMs: null }, minimumMarginMs: 250, accepted: false });
    ch1WindowMargin = ch1MarginPlan.ch1WindowMargin;
    doorwayStartPlan = { ...doorwayStartPlan, ch2MarkWallMs };
    if (!ch1MarginPlan.accepted) {
      deferredAssertions.reject("ch1-window-margin", `ch1 artifact margins ${JSON.stringify(ch1WindowMargin)} are below ${ch1MarginPlan.minimumMarginMs} ms`);
    }
    phaseAgreementLog = await takePhaseAgreementLog(page);
    const reviewIndexPath = join(traceDir, "exam-session.review-index.json");
    await waitFor(() => existsSync(reviewIndexPath), Boolean, 30000, "review index");
    const reviewIndex = JSON.parse(readFileSync(reviewIndexPath, "utf8"));
    await liveServer.close();
    liveServer = null;

    replayServer = await createEncounterServer({ replayDir: traceDir, scoreDir, reviewRubric: RUBRIC, replayStepMs: 200 });
    const { connect } = await import(CLIENT_DIST);
    for (const station of reviewIndex.stations ?? []) {
      const reviewer = await connect(replayServer.url, { roomOptions: { replayStationId: station.stationId } });
      const reviewerHandle = { close: () => reviewer.leave() };
      replayClientHandles.add(reviewerHandle);
      try {
        let latest = null;
        reviewer.onState((snapshot) => { latest = snapshot; });
        await waitFor(() => latest, (value) => value?.mode === "replay", 15000, `replay ${station.stationId}`);
        const score = await reviewer.sendIntent("score-station", { items: Object.fromEntries(RUBRIC.map((item, index) => [item.id, index !== 1])) });
        if (score.status !== "ack") deferredAssertions.reject("replay-score", `pre-score ${station.stationId} rejected: ${score.reason}`);
      } finally {
        await reviewer.leave().catch(() => undefined);
        replayClientHandles.delete(reviewerHandle);
      }
    }

    await evidenceContext.close();
    evidenceContext = null;
    await context.close();
    learnerRawVideo = await pageVideo.path();
    const firstLearnerMark = deferredAssertions.capture("learner-trim-inputs", () => requireCaptureValue(marks
      .filter((entry) => entry.recording === "learner")
      .sort((a, b) => a.observedWallMs - b.observedWallMs)[0], "learner trim needs a first chapter"), marks[0]);
    learnerRecordingOriginWallMs = deferredAssertions.capture(
      "learner-trim-inputs",
      () => requireCaptureValue(learnerRecordingOriginWallMs, "learner trim needs a recording origin"),
      captureStartedAtMs,
    );
    const firstChapterUntrimmedOffsetSeconds = (firstLearnerMark.observedWallMs - learnerRecordingOriginWallMs) / 1000;
    learnerSyncStartWallMs = deferredAssertions.capture("learner-trim-inputs", () => requireCaptureValue(learnerSyncStartWallMs, "learner trim needs syncStartWallMs"), learnerRecordingOriginWallMs);
    const learnerSyncStartOffsetSeconds = (learnerSyncStartWallMs - learnerRecordingOriginWallMs) / 1000;
    learnerSceneReadyWallMs = deferredAssertions.capture("learner-trim-inputs", () => requireCaptureValue(learnerSceneReadyWallMs, "learner trim needs sceneReadyWallMs"), learnerSyncStartWallMs);
    const learnerSceneReadyOffsetSeconds = (learnerSceneReadyWallMs - learnerRecordingOriginWallMs) / 1000;
    const learnerLatchOffsetSeconds = Number.isFinite(learnerLatchWallMs)
      ? (learnerLatchWallMs - learnerRecordingOriginWallMs) / 1000
      : Number.NaN;
    const learnerRawProbe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json", learnerRawVideo], { encoding: "utf8" }));
    const learnerFramePeriodSource = learnerRawProbe.streams?.[0]?.r_frame_rate;
    const safeLearnerFramePeriodSource = deferredAssertions.capture("learner-trim-inputs", () => requireCaptureValue(learnerFramePeriodSource, "learner video has no r_frame_rate"), "25/1");
    const learnerFramePeriodSeconds = deferredAssertions.capture("learner-trim", () => parseFramePeriodSeconds(safeLearnerFramePeriodSource), 0.04);
    const learnerTrim = resolveLearnerTrim({
      latchWallMs: learnerLatchWallMs,
      computeTrim: () => learnerSceneReadyPaintTrim(
        signalFrames(learnerRawVideo), learnerSyncStartOffsetSeconds, learnerSceneReadyOffsetSeconds, learnerLatchOffsetSeconds,
        firstChapterUntrimmedOffsetSeconds, learnerFramePeriodSeconds,
      ),
      captureTrim: (compute) => deferredAssertions.capture("learner-trim", compute, { blankFrames: 0, firstPaintedInpointSeconds: 0, syncStartInpointSeconds: learnerSyncStartOffsetSeconds, sceneReadyInpointSeconds: learnerSceneReadyOffsetSeconds, latchOffsetSeconds: learnerLatchOffsetSeconds, latchInpointSeconds: 0, inpointSeconds: 0, trimReason: "painted", frameCount: 0, threshold: 5 }),
    });
    const learnerTrimWallMs = learnerRecordingOriginWallMs + learnerTrim.inpointSeconds * 1000;
    let ch1SceneReadyValidation = null;
    if (requiresSceneReadyCh1TrimCheck(learnerTrim.trimReason)) {
      try {
        ch1SceneReadyValidation = assertSceneReadyCh1Trim({
          headerLog: learnerHeaderLog,
          ch1ObservedWallMs: firstLearnerMark.observedWallMs,
          trimWallMs: learnerTrimWallMs,
          phase: firstLearnerMark.phase,
          station: "Station 1 of 3",
          artifacts: artifactCaptures.filter((artifact) => artifact.artifact === "frames/ch1.png" || artifact.artifact === "panels/ch1-runtime-panel.png"),
        });
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        deferredAssertions.reject("scene-ready-trim", message);
        ch1SceneReadyValidation = { pass: false, error: message };
      }
    }
    const learnerPaintedVideo = join(runDir, "learner-painted.webm");
    if (learnerTrim.inpointSeconds === 0) {
      copyFileSync(learnerRawVideo, learnerPaintedVideo);
    } else {
      execFileSync("ffmpeg", [
        "-y", "-v", "error", "-i", learnerRawVideo,
        "-vf", `trim=start=${learnerTrim.inpointSeconds},setpts=PTS-STARTPTS`,
        "-an", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "5", "-pix_fmt", "yuv420p", learnerPaintedVideo,
      ]);
    }
    const learnerProbe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_format", "-of", "json", learnerPaintedVideo], { encoding: "utf8" }));
    const learnerDuration = Number(learnerProbe.format?.duration ?? 0);
    context = null;

    facultyStatic = await startStaticServer(FACULTY_DIST);
    const facultyRecordingStartedAtMs = Date.now();
    context = await browser.newContext({
      ...FACULTY_CAPTURE_SURFACE,
      recordVideo: { dir: facultyVideoDir, size: FACULTY_CAPTURE_SURFACE.viewport },
    });
    await context.addInitScript({ content: `(${facultyStatusObserverInit.toString()})(${JSON.stringify({ surface: "recorded" })});` });
    page = await context.newPage();
    pageVideo = page.video();
    facultyRecordingOriginWallMs = await page.evaluate(() => Date.now());
    page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 300)));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300)); });
    const facultyBase = `http://127.0.0.1:${facultyStatic.port}/sync-probe.html`;
    const c14Url = c14HostReviewUrl(facultyBase, replayServer.url, RUBRIC);
    await page.goto(c14Url, { timeout: 60000, waitUntil: "load" });
    await page.locator("#sync-probe-iwer-container").waitFor({ state: "attached", timeout: 60000 });
    await page.evaluate(() => globalThis.__openClinXrFacultyContainerSnapshot?.("container:load"));
    await installVisibleDomTextLog(page);
    await page.waitForFunction(() => globalThis.__syncProbe?.done === true, undefined, { timeout: 180000 });
    facultyProbe = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__syncProbe)));
    if (
      facultyProbe.error !== null ||
      facultyProbe.c13?.scoreAcked !== true ||
      facultyProbe.c13?.returnAcked !== true ||
      facultyProbe.c14?.signoffAcked !== true ||
      facultyProbe.c14?.reviewFinalized !== true
    ) {
      deferredAssertions.reject("faculty-probe", `c14 host-review console did not replay, mark, and lock: ${facultyProbe.error ?? JSON.stringify({ c13: facultyProbe.c13, c14: facultyProbe.c14 })}`);
    }
    const finalizeSeq = facultyProbe.sentSeqsByKind?.["finalize-review"]?.[0];
    const finalizeServerTs = facultyProbe.ackServerTsBySeq?.[finalizeSeq];
    const safeFinalizeServerTs = deferredAssertions.capture(
      "faculty-finalize-ack",
      () => {
        assertCaptureCondition(typeof finalizeSeq === "number" && typeof finalizeServerTs === "number" && Number.isFinite(finalizeServerTs) && finalizeServerTs > 0, `C14 finalize-review ack serverTs missing from probe ackServerTsBySeq for seq ${finalizeSeq}`);
        return finalizeServerTs;
      },
      Date.now(),
    );
    const ch5Clock = { stationIndex: 0, event: "finalize-review-ack", serverMs: safeFinalizeServerTs };
    serverClock.push(ch5Clock);
    const ch5HostMarkEnteredWallMs = Date.now();
    try {
      await page.waitForFunction(
        ({ statusNeedle, statusServerMs }) => (globalThis.__openClinXrFacultyStatusLog ?? []).some(
          (entry) => entry.wallMs >= statusServerMs && entry.status.toLowerCase().includes(statusNeedle.toLowerCase()),
        ),
        { statusNeedle: "signoff:finalized", statusServerMs: ch5Clock.serverMs },
        { timeout: 15000 },
      );
    } catch {
      const timedOutLog = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__openClinXrFacultyStatusLog ?? [])));
      deferredAssertions.capture("faculty-status-selection", () => selectFacultyStatusObservedWallMs(timedOutLog, "signoff:finalized", ch5Clock.serverMs));
    }
    facultyStatusLog = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__openClinXrFacultyStatusLog ?? [])));
    const ch5ObservedWallMs = deferredAssertions.capture("faculty-status-selection", () => selectFacultyStatusObservedWallMs(
      facultyStatusLog, "signoff:finalized", ch5Clock.serverMs,
    ), ch5Clock.serverMs);
    const ch5ObservationResolvedWallMs = Date.now();
    marks.push({ id: "ch5", ...ch5Clock, observedWallMs: ch5ObservedWallMs, recording: "faculty" });
    await page.evaluate(() => globalThis.__openClinXrFacultyContainerSnapshot?.("container:ch5"));
    const ch5StatusEntry = facultyStatusLog.find((entry) => entry.wallMs === ch5ObservedWallMs);
    const facultyOverlayFit = ch5StatusEntry?.overlayFitMeasurement === undefined
      ? { pass: false, error: `faculty overlay fit measurement is missing at ch5 mark ${ch5ObservedWallMs}` }
      : assessFacultyOverlayFit(ch5StatusEntry.overlayFitMeasurement);
    if (!facultyOverlayFit.pass) {
      deferredAssertions.reject("faculty-overlay-fit", `faculty overlay does not fit recorded viewport at ch5 mark ${ch5ObservedWallMs}: ${JSON.stringify(facultyOverlayFit)}`);
    }
    await page.evaluate(() => {
      globalThis.__openClinXrFacultyLayoutEvent?.("scrollIntoView:#sync-probe-status");
      document.querySelector("#sync-probe-status")?.scrollIntoView({ block: "start" });
    });
    await sleep(250);
    const facultyConsoleLayout = await page.evaluate(() => {
      const selectors = ["#sync-probe-status", "#sync-probe-note", "#sync-probe-lobby", "#sync-probe-c13", "#sync-probe-c14", "#sync-probe-topics", "#sync-probe-station", "#sync-probe-observers"];
      const labels = selectors.map((selector) => {
        const element = document.querySelector(selector);
        const box = element?.getBoundingClientRect();
        return {
          selector,
          text: element?.textContent ?? "",
          x: box?.x ?? -1,
          y: box?.y ?? -1,
          width: box?.width ?? 0,
          height: box?.height ?? 0,
          fontPx: element === null ? 0 : Number.parseFloat(getComputedStyle(element).fontSize),
        };
      });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        labels,
        allInside: labels.every((label) => label.x >= 0 && label.y >= 0 && label.x + label.width <= innerWidth && label.y + label.height <= innerHeight),
        minimumFontPx: Math.min(...labels.map((label) => label.fontPx)),
      };
    });
    if (!facultyConsoleLayout.allInside || facultyConsoleLayout.minimumFontPx < 12) {
      deferredAssertions.reject("faculty-console-layout", `C14 console labels do not fit the recorded 960x600 viewport: ${JSON.stringify(facultyConsoleLayout)}`);
    }
    markTimings.push({
      id: "ch5",
      stationIndex: 0,
      phase: "signoff:finalized",
      phaseServerMs: ch5Clock.serverMs,
      hostMarkEnteredWallMs: ch5HostMarkEnteredWallMs,
      pages: {
        faculty: {
          observationResolvedWallMs: ch5ObservationResolvedWallMs,
        },
      },
    });
    const facultyText = await page.evaluate(() => document.body.innerText);
    panelEvidence.push({ id: "ch5", file: null, innerText: facultyText, source: "C14 sign-off protocol probe body (protocol probe; no faculty console UI yet); .runtime-panel is learner-shell only", route: c14Url });
    facultyDomLog = await takeVisibleDomTextLog(page);
    await sleep(CH5_RECORDED_TAIL_HOLD_MS);

    const renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl !== null && ext !== null ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    });
    const facultyStopSnapshot = await page.evaluate((selectors) => {
      globalThis.__openClinXrFacultyOcclusionSnapshot?.("recorded:stop");
      globalThis.__openClinXrFacultyLayoutActive = false;
      return {
        state: document.querySelector("#sync-probe-c14")?.textContent?.trim() ?? "",
        stateLines: Object.fromEntries(selectors.map((selector) => [selector, document.querySelector(selector)?.textContent?.trim() ?? ""])),
        wallMs: Date.now(),
        layoutLog: {
          events: JSON.parse(JSON.stringify(globalThis.__openClinXrFacultyLayoutEvents ?? [])),
          animationFrames: JSON.parse(JSON.stringify(globalThis.__openClinXrFacultyLayoutFrames ?? [])),
          occlusionMeasurements: JSON.parse(JSON.stringify(globalThis.__openClinXrFacultyOcclusionMeasurements ?? [])),
        },
      };
    }, FACULTY_OVERLAY_LINE_SELECTORS);
    facultyLayoutLog = facultyStopSnapshot.layoutLog;
    facultyRecordingStopState = facultyStopSnapshot.state;
    facultyRecordedStopStateLines = facultyStopSnapshot.stateLines;
    facultyRecordingStopWallMs = facultyStopSnapshot.wallMs;
    await context.close();
    context = null;
    facultyLayoutLog.iwerRelease = deferredAssertions.capture("faculty-layout-release", () => facultyIwerReleaseAfterFinalize(facultyLayoutLog), null);
    deferredAssertions.capture("faculty-recorded-stop", () => assertCaptureCondition(
      facultyRecordingStopState.includes("signoff:finalized"),
      `recorded faculty state at stop must contain signoff:finalized; state=${JSON.stringify(facultyRecordingStopState)}`,
    ));
    const facultyRawVideo = await pageVideo.path();
    const facultyTrim = deferredAssertions.capture("faculty-trim", () => firstPaintTrim(signalFrames(facultyRawVideo)), { blankFrames: 0, inpointSeconds: 0, frameCount: 0, threshold: 5 });
    const facultyPaintOffsetSeconds = (facultyRecordingStartedAtMs - captureStartedAtMs) / 1000 + facultyTrim.inpointSeconds - learnerTrim.inpointSeconds;
    const timelineHoldSeconds = Math.max(0, facultyPaintOffsetSeconds - learnerDuration);
    const facultyPaintedVideo = join(runDir, "faculty-painted.webm");
    if (facultyTrim.inpointSeconds === 0) {
      copyFileSync(facultyRawVideo, facultyPaintedVideo);
    } else {
      execFileSync("ffmpeg", [
        "-y", "-v", "error", "-i", facultyRawVideo,
        "-vf", `trim=start=${facultyTrim.inpointSeconds},setpts=PTS-STARTPTS`,
        "-an", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "5", "-pix_fmt", "yuv420p", facultyPaintedVideo,
      ]);
    }
    const holdFrame = join(runDir, "learner-hold.png");
    const holdVideo = join(runDir, "learner-hold.webm");
    const { includeHold } = holdConcatPlan(timelineHoldSeconds);
    if (includeHold) {
      execFileSync("ffmpeg", ["-y", "-v", "error", "-sseof", "-0.04", "-i", learnerPaintedVideo, "-frames:v", "1", holdFrame]);
      execFileSync("ffmpeg", learnerHoldEncodeArgs({ framePng: holdFrame, seconds: timelineHoldSeconds, outPath: holdVideo }));
    }
    const concatList = join(runDir, "video-concat.txt");
    const quoteConcat = (path) => path.replaceAll("'", "'\\''");
    const concatFiles = includeHold ? [learnerPaintedVideo, holdVideo, facultyPaintedVideo] : [learnerPaintedVideo, facultyPaintedVideo];
    writeFileSync(concatList, `${concatFiles.map((path) => `file '${quoteConcat(path)}'`).join("\n")}\n`);
    const combinedVideo = join(runDir, "rr1-min-video-only.webm");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", combinedVideo]);
    const combinedProbe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_format", "-of", "json", combinedVideo], { encoding: "utf8" }));
    const combinedDuration = Number(combinedProbe.format?.duration ?? 0);
    const ttsAiff = join(audioDir, "actor-reply.aiff");
    const ttsWav = join(audioDir, "actor-reply.wav");
    execFileSync("say", ["-v", "Alex", "-r", "180", "-o", ttsAiff, actorReply]);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", ttsAiff, "-ar", "48000", "-ac", "1", ttsWav]);
    const videoPath = join(runDir, "rr1-min.webm");
    const topicEvidence = deferredAssertions.capture(
      "topic-turn",
      () => requireCaptureValue(turnEvidence.find((entry) => entry.label === "patient-onset-history"), "topic turn missing before audio mux"),
      { displayedAtMs: captureStartedAtMs },
    );
    const lineFrameSeconds = (topicEvidence.displayedAtMs - captureStartedAtMs) / 1000 - learnerTrim.inpointSeconds;
    const sourceSpeechOnsetSeconds = speechOnsetSeconds(ttsWav);
    const audioDelayMs = measuredAudioDelayMs(lineFrameSeconds, sourceSpeechOnsetSeconds);
    execFileSync("ffmpeg", [
      "-y", "-v", "error", "-i", combinedVideo, "-i", ttsWav,
      "-filter_complex", `[1:a]adelay=${audioDelayMs}:all=1,apad=whole_dur=${combinedDuration}[a]`,
      "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "libopus", "-t", String(combinedDuration), videoPath,
    ]);
    const audioOnsetSeconds = speechOnsetSeconds(videoPath);
    const audioAlignment = audioLineAlignment(audioOnsetSeconds, lineFrameSeconds);
    if (!audioAlignment.pass) deferredAssertions.reject("audio-alignment", `audio/line alignment exceeds 120 ms: ${JSON.stringify(audioAlignment)}`);
    const ffprobe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", videoPath], { encoding: "utf8" }));
    const panelLumaGate = deferredAssertions.capture("panel-luma", () => measurePanelLumaRanges(videoPath), { frameCount: 0, minimumRange: 0, threshold: 5, metric: "unavailable" });
    if (panelLumaGate.minimumRange < panelLumaGate.threshold) {
      deferredAssertions.reject("panel-luma", `recorded video contains a flat panel frame: ${JSON.stringify(panelLumaGate)}`);
    }
    if (!(ffprobe.streams ?? []).some((stream) => stream.codec_type === "audio")) {
      deferredAssertions.reject("audio-stream", "muxed RR1 video has no audio stream");
    }
    writeFileSync(join(runDir, "video.json"), `${JSON.stringify(ffprobe, null, 2)}\n`);
    const duration = Number(ffprobe.format?.duration ?? 0);
    const muxedFramePtsSeconds = deferredAssertions.capture("mux-frame-pts", () => videoFramePtsSeconds(videoPath), [0]);
    const readsMarkedState = createRr1FrameClassifier({
      video: videoPath,
      doorwayPanel: join(panelDir, "rot-doorway-runtime-panel.png"),
      encounterPanel: join(panelDir, "ch2-runtime-panel.png"),
      ch5FinalizedCrop: CH5_FINALIZED_CROP,
      ch5OpenCrop: CH5_OPEN_CROP,
      framePtsSeconds: muxedFramePtsSeconds,
    });
    const sortedClock = serverClock.sort((a, b) => a.serverMs - b.serverMs);
    const sortedMarks = marks.sort((a, b) => a.serverMs - b.serverMs);
    const preparedMarks = sortedMarks.map((entry) => {
      const observedWallMs = deferredAssertions.capture("chapter-observed-time", () => requireCaptureValue(entry.observedWallMs, `chapter ${entry.id} has no observed wall time`), captureStartedAtMs);
      const clock = entry.recording === "faculty"
        ? {
            recordingOriginWallMs: facultyRecordingOriginWallMs,
            timelineStartSeconds: learnerDuration + (includeHold ? timelineHoldSeconds : 0),
            trimInpointSeconds: facultyTrim.inpointSeconds,
          }
        : { recordingOriginWallMs: learnerRecordingOriginWallMs, trimInpointSeconds: learnerTrim.inpointSeconds };
      clock.recordingOriginWallMs = deferredAssertions.capture("chapter-recording-origin", () => requireCaptureValue(clock.recordingOriginWallMs, `chapter ${entry.id} has no recording origin`), captureStartedAtMs);
      const untrimmedOffsetSeconds = observedOffsetSeconds({ observedWallMs, ...clock, trimInpointSeconds: 0 });
      const markVideoTimeSeconds = entry.recording === "learner"
        ? deferredAssertions.capture("learner-trim", () => learnerChapterOffsetSeconds(
            entry.id, untrimmedOffsetSeconds, learnerTrim.inpointSeconds, learnerFramePeriodSeconds,
            entry.id === firstLearnerMark.id, learnerTrim.trimReason,
          ), Math.max(0, untrimmedOffsetSeconds - learnerTrim.inpointSeconds))
        : observedOffsetSeconds({ observedWallMs, ...clock });
      return { entry, clock, markVideoTimeSeconds };
    });
    const publishedChapters = [];
    for (const [index, prepared] of preparedMarks.entries()) {
      const { entry, clock, markVideoTimeSeconds } = prepared;
      const previous = preparedMarks[index - 1];
      const next = preparedMarks[index + 1];
      const searchStartSeconds = publishedChapters.at(-1)?.offsetSeconds ?? 0;
      const selectedFrame = deferredAssertions.capture("chapter-content-transition", () => selectChapterByContentTransition({
        chapterId: entry.id,
        previousChapterId: previous?.entry.id ?? null,
        nextChapterId: next?.entry.id ?? null,
        framePtsSeconds: muxedFramePtsSeconds,
        searchStartSeconds,
        readsCurrentState: (seconds) => readsMarkedState(entry.id, seconds),
        readsPreviousState: previous === undefined ? null : (seconds) => readsMarkedState(previous.entry.id, seconds),
        readsNextState: next === undefined ? null : (seconds) => readsMarkedState(next.entry.id, seconds),
      }), () => ({
        offsetSeconds: deferredAssertions.capture("chapter-content-transition", () => firstFramePtsAtOrAfter(muxedFramePtsSeconds, searchStartSeconds), searchStartSeconds),
        previousPts: null,
        previousStatePts: null,
        nextStatePts: null,
      }));
      const offsetSeconds = selectedFrame.offsetSeconds;
      const skewSeconds = offsetSeconds - markVideoTimeSeconds;
      console.log(`SKEW ${entry.id} ${Number((skewSeconds * 1000).toFixed(3))}`);
      let windowEndWallMs = entry.recording === "faculty"
        ? facultyRecordingStopWallMs
        : deferredAssertions.capture("chapter-window-end", () => learnerHeaderWindow(
            learnerHeaderLog, entry.phase, `Station ${entry.stationIndex + 1} of 3`, entry.serverMs,
          ).endWallMs, null);
      windowEndWallMs = deferredAssertions.capture("chapter-window-end", () => requireCaptureValue(windowEndWallMs, `chapter ${entry.id} marked window has no numeric end`), clock.recordingOriginWallMs);
      const windowEndVideoTimeSeconds = observedOffsetSeconds({ observedWallMs: windowEndWallMs, ...clock });
      const endMarginMs = deferredAssertions.capture(
        "chapter-end-margin",
        () => assertPublishedChapterEndMargin(entry.id, offsetSeconds, windowEndVideoTimeSeconds),
        Number(((windowEndVideoTimeSeconds - offsetSeconds) * 1000).toFixed(6)),
      );
      publishedChapters.push({
        ...entry,
        markVideoTimeSeconds,
        offsetSeconds,
        skewSeconds,
        previousFramePtsSeconds: selectedFrame.previousPts,
        previousStateFramePtsSeconds: selectedFrame.previousStatePts,
        nextStateFramePtsSeconds: selectedFrame.nextStatePts,
        stillSource: entry.id === "ch5" ? "video-frame" : undefined,
        endMarginMs,
      });
    }
    const ch5Published = publishedChapters.find((chapter) => chapter.id === "ch5");
    const ch5StillSource = ch5Published?.stillSource;
    deferredAssertions.capture("faculty-still-source", () => assertCh5StillSource(ch5StillSource));
    const ch5Frame = join(frameDir, "ch5.png");
    const ch5CaptureStartedWallMs = Date.now();
    const ch5FrameEvidence = deferredAssertions.capture("artifact-png", () => {
      const ch5OffsetSeconds = requireCaptureValue(ch5Published?.offsetSeconds, "published ch5 offset is missing");
      writeVideoFramePng(videoPath, ch5OffsetSeconds, ch5Frame);
      return pngSize(ch5Frame);
    }, { width: 0, height: 0, bytes: 0 });
    const ch5CaptureEndedWallMs = Date.now();
    viewportFrames.push({
      id: "ch5",
      file: "frames/ch5.png",
      source: "rr1-min.webm",
      sourceVideoPtsSeconds: ch5Published?.offsetSeconds ?? null,
      captureStartedWallMs: ch5CaptureStartedWallMs,
      captureEndedWallMs: ch5CaptureEndedWallMs,
      latchWallMs: null,
      latchExempt: "faculty-dist video frame: no learner camera; window checked by assertCh5RecordedStop",
      ...ch5FrameEvidence,
    });
    const recordedCh5Measurement = facultyLayoutLog.occlusionMeasurements?.find((entry) => entry.kind === "recorded:ch5-offset");
    deferredAssertions.capture("faculty-layout", () => assertFacultyLayoutLog(facultyLayoutLog));
    deferredAssertions.capture("faculty-text-bound", () => {
      const ch5OffsetSeconds = requireCaptureValue(ch5Published?.offsetSeconds, "published ch5 offset is missing");
      const crop = { x: 0, y: 92, width: 250, height: 20 };
      const videoFrames = signoffFrameSeries(videoPath, muxedFramePtsSeconds, ch5OffsetSeconds, crop);
      const stillColumn = rightmostTextColumn(imageCrop(join(frameDir, "ch5.png"), crop), crop);
      assertFacultySignoffFrameSeries(videoFrames, recordedCh5Measurement?.textExtent?.right, 2);
      assessFacultySignoffTextExtent(stillColumn, recordedCh5Measurement?.textExtent?.right, "still", 2);
    });
    const chapters = {
      clock: "host Date.now observations mapped to each recording segment's page-creation wall-clock origin",
      captureStartedAtMs,
      recordingClocks: {
        joinWallMs: { learner: learnerJoinWallMs, evidence: evidenceJoinWallMs },
        learner: {
          recordingOriginWallMs: learnerRecordingOriginWallMs,
          timelineStartSeconds: 0,
          trimInpointSeconds: learnerTrim.inpointSeconds,
          trimReason: learnerTrim.trimReason,
          syncStartWallMs: learnerSyncStartWallMs,
          syncLagMs: learnerSyncLagMs,
          sceneReadyWallMs: learnerSceneReadyWallMs,
          sceneLagMs: learnerSceneLagMs,
          latchWallMs: learnerLatchWallMs,
          framePeriodSeconds: learnerFramePeriodSeconds,
          framePeriodSource: learnerFramePeriodSource,
        },
        faculty: {
          recordingOriginWallMs: facultyRecordingOriginWallMs,
          recordingStopWallMs: facultyRecordingStopWallMs,
          recordingStopState: facultyRecordingStopState,
          timelineStartSeconds: learnerDuration + (includeHold ? timelineHoldSeconds : 0),
          trimInpointSeconds: facultyTrim.inpointSeconds,
        },
      },
      chapterOffsetPolicy: {
        rule: "first marked-state frame after the last previous-chapter-state frame, searching from the previous published offset; strictly before the first next-chapter-state frame",
        boundClock: "decoded video content only; wall clocks are diagnostic skew provenance",
        skewDiagnostic: "SKEW <chapter> <chosenPts - markVideoTime ms>; never a gate",
      },
      turns: turnEvidence,
      chapters: publishedChapters,
    };
    const domTextLog = [...learnerDomLog, ...facultyDomLog].sort((a, b) => a.atMs - b.atMs);
    const phaseAgreementEvaluation = deferredAssertions.capture(
      "phase-agreement",
      () => assertPhaseAgreementAfterSyncStart(phaseAgreementLog, learnerSyncStartWallMs, learnerDomLog.at(-1)?.atMs ?? Date.now()),
      () => ({ log: phaseAgreementLog, evaluatedLog: [], maxDisagreementMs: 0, spans: [] }),
    );
    phaseAgreementLog = phaseAgreementEvaluation.log;
    const phaseAgreement = {
      maxDisagreementMs: phaseAgreementEvaluation.maxDisagreementMs,
      spans: phaseAgreementEvaluation.spans,
      syncStartWallMs: learnerSyncStartWallMs,
      evaluatedEntryCount: phaseAgreementEvaluation.evaluatedLog.length,
    };
    const visibleG4Strings = G4_STRINGS.filter((text) => domTextLog.some((entry) => entry.innerText.includes(text)));
    if (visibleG4Strings.length > 0) deferredAssertions.reject("g4-dom", `G4 string visible in DOM log: ${visibleG4Strings.join(", ")}`);
    const traceFiles = readdirSync(traceDir).filter((name) => name.endsWith(".conversation-trace.json")).sort();
    const ch1WallMsForGlbs = ch1CaptureWallMs ?? learnerSceneReadyWallMs ?? learnerSyncStartWallMs ?? captureStartedAtMs;
    const sceneReadyMsForGlbs = learnerSceneReadyWallMs ?? learnerSyncStartWallMs ?? captureStartedAtMs;
    const environmentGlbs = environmentGlbResponses.map((entry) => recordEnvironmentGlb({
      url: entry.url,
      body: entry.body,
      wallMs: entry.wallMs,
      sceneReadyWallMs: sceneReadyMsForGlbs,
      ch1WallMs: ch1WallMsForGlbs,
    }));
    const distIndexHtml = join(APP_DIST, "index.html");
    const distIndexSha256 = sha256(distIndexHtml);
    let distMainChunk = "unknown";
    try {
      const distHtml = readFileSync(distIndexHtml, "utf8");
      const distMatch = /assets\/[^"']+\.js/u.exec(distHtml)?.[0] ?? null;
      if (distMatch !== null) distMainChunk = distMatch;
    } catch {
      distMainChunk = "unknown";
    }
    const distBuild = { indexSha256: distIndexSha256, mainChunk: distMainChunk };
    // RR1_CAPTURE_THROW_SCAN_END: the collector below is the only permitted capture-path throw.
    writeEvidenceBeforeDeferredErrors(() => {
    writeFileSync(join(runDir, "server-clock.json"), `${JSON.stringify(sortedClock, null, 2)}\n`);
    writeFileSync(join(runDir, "chapters.json"), `${JSON.stringify(chapters, null, 2)}\n`);
    writeFileSync(join(runDir, "dom-text-log.json"), `${JSON.stringify(domTextLog, null, 2)}\n`);
    writeFileSync(join(runDir, "phase-agreement-log.json"), `${JSON.stringify(phaseAgreementLog, null, 2)}\n`);
    writeFileSync(join(runDir, "faculty-layout-log.json"), `${JSON.stringify({
      facultyRecordingOriginWallMs,
      facultyRecordingStopWallMs,
      facultyRecordingStopState,
      facultyTrimInpointSeconds: facultyTrim.inpointSeconds,
      recordedTailHoldMs: CH5_RECORDED_TAIL_HOLD_MS,
      ...facultyLayoutLog,
    }, null, 2)}\n`);
    writeFileSync(join(runDir, "capture.json"), `${JSON.stringify({
      schema: "openclinxr.site-reimagine.rr1-min.v1",
      run: `run-${runNumber}`,
      buildSha: buildSha(),
      seed: "rr1-min-ed-chest-pain",
      blueprintId: blueprint.blueprintId,
      clientRoles: ["learner", "faculty"],
      learnerVoice: "synthetic, labelled; typed question drives the same reviewed learner-intent path",
      ttsTap: { file: "audio/actor-reply.wav", voice: "macOS Alex synthetic", text: actorReply, muxDelayMs: audioDelayMs, sourceSpeechOnsetSeconds, audioAlignment },
      learnerTrim: { ...learnerTrim, metric: "per-frame YMAX-YMIN in x=540,y=0,w=420,h=600", firstChapterUntrimmedOffsetSeconds, ch1SceneReadyValidation },
      facultyTrim: { ...facultyTrim, timelineHoldSeconds, strategy: "actual script=c14 host route; measured first-paint trim; final learner frame holds the trimmed pre-paint interval" },
      turnEvidence,
      phaseAgreement: { file: "phase-agreement-log.json", ...phaseAgreement },
      doorwayStart: doorwayStartPlan,
      ch1WindowMargin,
      panelLumaGate,
      camera: { preset: "shared-learner-viewport", source: "__openClinXrGazeCamera", chapters: ["CH1", "CH2", "ROT-doorway", "ROT-encounter"], blockoutGrade: "blockout-a2 ch1-doorway GRADED PASS", learnerPose: { sceneReady: learnerPoseAtSceneReady, ch1: learnerPoseAtCh1 } },
      environmentGlbs,
      distBuild,
      facultyCamera: { preset: "c14-signoff-protocol-probe", route: c14Url, chapters: ["CH5"] },
      facultyConsoleLayout,
      facultyOverlayFit,
      facultyLayoutLog: "faculty-layout-log.json",
      facultyStillSourceGuard: { source: ch5StillSource, recordedStop: facultyRecordedStopStateLines },
      facultyCaptureSurface: FACULTY_CAPTURE_SURFACE,
      viewport: VIEWPORT,
      video: "rr1-min.webm",
      durationSeconds: duration,
      presentationCss: "tools/openclinxr/evidence/site/capture/presentation.css",
      marks: sortedMarks,
      recordingClocks: chapters.recordingClocks,
      learnerHeaderLog,
      evidenceHeaderLog,
      facultyStatusLog,
      artifactCaptures,
      markTimings,
      viewportFrames,
      panelEvidence,
      domTextLog: "dom-text-log.json",
      visibleG4Strings,
      traceFiles,
      reviewPacket: "scores/exam-session.review-packet.json",
      facultyProbe: facultyProbe === null ? null : { done: facultyProbe.done, error: facultyProbe.error, c12: facultyProbe.c12, c13: facultyProbe.c13 },
      renderer,
      pageErrors,
      consoleErrors: consoleErrors.filter((text) => !/Failed to load resource.*404/iu.test(text)),
      notEvidenceFor: ["physical headset", "Quest readiness", "audio content heard by a person", "clinical validity", "exam equivalence"],
    }, null, 2)}\n`);
    writeFileSync(join(runDir, "renderer.json"), `${JSON.stringify({
      renderer,
      launchArgs: GPU_ARGS,
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      captureStartedAtMs,
      captureEndedAtMs: Date.now(),
      cameraSource: "__openClinXrGazeCamera",
    }, null, 2)}\n`);
    }, deferredAssertions.errors);
    console.log(`RR1-min full run wrote ${runDir}`);
  } finally {
    await closeRr1Handles({
      context,
      evidenceContext,
      browser,
      replayClients: [...replayClientHandles],
      replayServer,
      facultyStatic,
      learnerStatic,
      liveServer,
    });
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function pngSize(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") {
    throw new Error(`blockout is not a PNG: ${path}`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length };
}

function buildSha() {
  return execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function slot(order) {
  return {
    slotId: `station-${order}`,
    order,
    label: `Station ${order}`,
    requiredEnvironmentIds: [],
    requiredTraceTags: [],
  };
}

async function blockout(storeRoot, attempt) {
  const blockoutDir = join(storeRoot, attempt);
  if (existsSync(blockoutDir)) {
    throw new Error(`write-once blockout already exists: ${blockoutDir}`);
  }
  for (const path of [join(APP_DIST, "index.html"), SERVER_DIST, FIXTURES_DIST, CSS_PATH]) {
    if (!existsSync(path)) throw new Error(`required build/input missing: ${path}`);
  }
  mkdirSync(blockoutDir, { recursive: true });
  const blueprint = {
    blueprintId: "rr1-min-ed-chest-pain",
    title: "RR1-min ED chest pain",
    stationSlots: [slot(1), slot(2), slot(3)],
    timing: { doorwaySeconds: 90, encounterSeconds: 12, noteSeconds: 4, breakAfterStationOrders: [] },
    requiredTraceTags: [],
    requiredSafetyCriticalTraceTags: [],
  };
  const fixtures = await import(FIXTURES_DIST);
  const scenario = { ...fixtures.edChestPainScenario, status: "approved" };
  const patient = scenario.actors.find((actor) => actor.role === "patient");
  if (patient === undefined) throw new Error("ED chest-pain scenario has no patient actor");
  const { createEncounterServer } = await import(SERVER_DIST);
  const server = await createEncounterServer({
    examBlueprint: blueprint,
    scenarios: [scenario, scenario, scenario],
    dialogueSeeds: fixtures.scenarioDialogueSeedBank,
  });
  const staticServer = await startStaticServer(APP_DIST);
  const pageUrl = `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({ encounterSync: server.url })}`;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, channel: "chromium", args: GPU_ARGS });
  const pageErrors = [];
  const consoleErrors = [];
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 300)));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
    });
    await page.goto(pageUrl, { timeout: 60000, waitUntil: "load" });
    await page.waitForFunction(
      () => globalThis.__openClinXrEncounterSync?.state === "joined",
      undefined,
      { timeout: 240000 },
    );
    await page.locator(".runtime-panel").waitFor({ state: "visible", timeout: 60000 });
    await page.addStyleTag({ content: readFileSync(CSS_PATH, "utf8") });
    await page.waitForFunction(
      (actorId) => {
        let found = false;
        globalThis.__openClinXrDebugScene?.traverse((node) => {
          if (node.userData?.openClinXrActorId === actorId) found = true;
        });
        return found;
      },
      patient.actorId,
      { timeout: 120000 },
    );
    await sleep(2000);
    const runtimePath = join(blockoutDir, "runtime-panel.png");
    const runtimeShot = await shootRuntimePanel(page, runtimePath);
    const runtimeSize = pngSize(runtimePath);
    const visibleG4 = G4_STRINGS.filter((text) => runtimeShot.innerText.includes(text));
    if (visibleG4.length > 0) {
      throw new Error(`presentation CSS left G4 strings visible: ${visibleG4.join(", ")}`);
    }
    const cameraAdjustments = [];
    let projected = await projectActorBbox(page, patient.actorId);
    for (const factor of [0.85, 0.75]) {
      if (projected.ok === true && projected.bbox.height / VIEWPORT.height >= 0.1) break;
      const changed = await page.evaluate((scale) => {
        const camera = globalThis.__openClinXrGazeCamera;
        if (camera == null || typeof camera.fov !== "number") return null;
        camera.fov *= scale;
        camera.updateProjectionMatrix();
        return camera.fov;
      }, factor);
      cameraAdjustments.push({ kind: "narrow-active-camera-fov", factor, resultingFov: changed });
      await sleep(500);
      projected = await projectActorBbox(page, patient.actorId);
    }
    if (projected.ok !== true) throw new Error(`patient projection failed: ${projected.why}`);
    const subject = {
      ...projected.bbox,
      frameHeightFraction: projected.bbox.height / VIEWPORT.height,
      source: "scene graph projection",
      actorId: patient.actorId,
    };
    if (subject.frameHeightFraction < 0.1) {
      throw new Error(`ST3 patient bbox remains under 10% after ${cameraAdjustments.length} camera adjustments: ${subject.frameHeightFraction}`);
    }
    const presets = ["shared-learner-viewport"];
    const frames = [];
    for (const preset of presets) {
      const path = join(blockoutDir, `${preset}.png`);
      await page.screenshot({ path, timeout: 30000 });
      const size = pngSize(path);
      frames.push({ preset, file: `${preset}.png`, sha256: sha256(path), ...size, subjectBbox: subject });
    }
    const renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl !== null && ext !== null ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    });
    writeFileSync(join(blockoutDir, "blockout.json"), `${JSON.stringify({
      schema: "openclinxr.site-reimagine.rr1-blockout.v1",
      attempt,
      buildSha: buildSha(),
      blueprintId: blueprint.blueprintId,
      cameraPresets: frames,
      sharedByChapters: { "shared-learner-viewport": ["CH1", "CH2", "ROT-doorway", "ROT-encounter", "CH5 composition blockout only; no faculty console UI yet (protocol probe)"] },
      subjectBbox: subject,
      cameraAdjustments,
      runtimePanel: {
        file: "runtime-panel.png",
        sha256: sha256(runtimePath),
        bytes: statSync(runtimePath).size,
        image: runtimeSize,
        viewportBbox: runtimeShot.bbox,
        innerText: runtimeShot.innerText,
      },
      visibleG4Strings: visibleG4,
      presentationCss: "tools/openclinxr/evidence/site/capture/presentation.css",
      renderer,
      launch: { channel: "chromium", args: GPU_ARGS, viewport: VIEWPORT, deviceScaleFactor: 1 },
      server: { clock: "host Date.now, one process", stationCount: 3, stationIndex: 0, phase: JSON.parse(server.getStateJSON()).phase },
      pageErrors,
      consoleErrors: consoleErrors.filter((text) => !/Failed to load resource.*404/iu.test(text)),
      notEvidenceFor: ["physical headset", "Quest readiness", "audio content", "clinical validity"],
    }, null, 2)}\n`, "utf8");
    console.log(`RR1 blockout wrote ${frames.length} viewport frames to ${blockoutDir}`);
  } finally {
    await browser.close().catch(() => undefined);
    await staticServer.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { out, attempt } = parseArgs(process.argv.slice(2));
  await (attempt === "run" ? runCapture(out) : blockout(out, attempt)).catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
