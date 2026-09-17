import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import fixture from "./fixture-manifest.mjs";
import { prepareViteOptimization } from "./reproduce-vite-modules.mjs";
import { runBrowserCapture } from "./capture-page.mjs";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const packetRoot = dirname(fixture.proofReportPath);
const actorId = "patient_robert_hayes_v1";
const scenarioId = "ed_chest_pain_priority_v1";
const responseText = "diagnostic prepared actor pcm riddle";
const runnerConversationTurn = 1;
const requiredModules = [
  { sourcePath: "apps/ui-xr/src/main.ts", match: /\/src\/main\.ts/ },
  { sourcePath: "apps/ui-xr/src/prepared-actor-audio.ts", match: /prepared-actor-audio/ },
  { sourcePath: "packages/openclinxr/xr-dialogue/dist/viseme-runtime-wire.js", match: /viseme-runtime-wire/ },
  { sourcePath: "packages/openclinxr/xr-dialogue/dist/viseme-baked-cues.js", match: /viseme-baked-cues/ },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeUnique(dir, name, bytes) {
  const path = resolve(dir, name);
  if (existsSync(path)) throw new Error("artifact-restamp-refused:" + path);
  writeFileSync(path, bytes);
  return { path: name, sha256: sha256(bytes) };
}

function readViteDepMetadata(repo) {
  const path = resolve(repo, "apps/ui-xr/node_modules/.vite/deps/_metadata.json");
  if (!existsSync(path)) return { present: false };
  const meta = JSON.parse(readFileSync(path, "utf8"));
  return {
    present: true,
    hash: meta.hash ?? null,
    configHash: meta.configHash ?? null,
    lockfileHash: meta.lockfileHash ?? null,
    browserHash: meta.browserHash ?? null,
    optimized: Object.keys(meta.optimized ?? {}),
  };
}

async function waitStableMainTransform(base) {
  let previous;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(new URL("/src/main.ts", base), { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("capture-main-warmup-refused:" + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (previous?.equals(bytes)) return { attempts: attempt + 1, bytes: bytes.length };
    previous = bytes;
  }
  throw new Error("capture-main-transform-unstable");
}

async function startVite(repoRoot, metadata) {
  const app = resolve(repoRoot, "apps/ui-xr");
  const child = spawn(resolve(app, "node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", "0"], {
    cwd: app,
    env: { ...process.env, NO_COLOR: "1", OPENCLINXR_BUILD_COMMIT: metadata.gitCommit, OPENCLINXR_BUILD_TIME: metadata.buildTime },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  child.stdout.on("data", (b) => { output += b; });
  child.stderr.on("data", (b) => { errors += b; });
  const deadline = Date.now() + 40000;
  let base;
  while (Date.now() < deadline) {
    base = output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
    if (base) break;
    if (child.exitCode !== null) throw new Error("capture-vite-exited:" + errors);
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!base) throw new Error("capture-vite-start-timeout:" + errors);
  return { child, base };
}

export async function captureAudibleLipSync(repo = repoRoot) {
  const captureHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const buildTime = new Date().toISOString();
  const metadata = { gitCommit: captureHead, buildTime };
  // Frozen reproduce inherits ambient NODE_ENV into Vite getConfigHash. Vitest sets
  // NODE_ENV=test; standalone `node capture.mjs` would otherwise hash development.
  if (!process.env.NODE_ENV) process.env.NODE_ENV = "test";
  const viteDiagnostics = {
    nodeEnv: process.env.NODE_ENV,
    preOptimize: readViteDepMetadata(repo),
  };
  prepareViteOptimization(repo, metadata);
  viteDiagnostics.postOptimize = readViteDepMetadata(repo);
  const runId = "run-" + Date.now().toString(16) + "-" + process.pid;
  const runDir = resolve(packetRoot, runId);
  mkdirSync(runDir, { recursive: true });
  copyFileSync(fixture.retainedPrivatePath, resolve(runDir, "input.wav"));
  copyFileSync(fixture.cuePath, resolve(runDir, "cues.json"));
  const wavBytes = readFileSync(resolve(runDir, "input.wav"));
  const cueBytes = readFileSync(resolve(runDir, "cues.json"));
  const attemptBytes = Buffer.from(JSON.stringify({
    purpose: "actual-ui-xr-vite-ingress-capture",
    runId,
    startedAt: buildTime,
  }, null, 2));
  writeUnique(runDir, "attempt.json", attemptBytes);
  const attempt = { manifestPath: `${runId}/attempt.json`, sha256: sha256(attemptBytes) };
  const tapSource = readFileSync(new URL("./audio-tap.mjs", import.meta.url), "utf8");
  const { child, base } = await startVite(repo, metadata);
  const browser = await chromium.launch({
    args: ["--autoplay-policy=no-user-gesture-required", "--use-angle=metal", "--disable-background-timer-throttling"],
    ignoreDefaultArgs: ["--mute-audio"],
  });
  const context = await browser.newContext({
    viewport: { width: 960, height: 720 },
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(180000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Debugger.enable");
    await cdp.send("Network.enable");
    const parsed = [];
    const network = [];
    cdp.on("Debugger.scriptParsed", (event) => {
      parsed.push(event);
    });
    cdp.on("Network.responseReceived", (event) => {
      if (event.response?.url) network.push(event);
    });
    const url = `${base}?openclinxrScenarioId=${scenarioId}&openclinxrSpeakFixture=1&openclinxrCaptureMode=face-detail&openclinxrAcceleratedExam=1`;
    viteDiagnostics.warmup = await waitStableMainTransform(base);
    viteDiagnostics.hostStartup = readViteDepMetadata(repo);
    await page.goto(url, { waitUntil: "networkidle", timeout: 180000 });
    await page.waitForFunction(() => window.__openClinXrSpeakFixtureBridge && window.__openClinXrPreparedActorAudio, null, { timeout: 120000 });
    await page.waitForFunction((expected) => {
      const scene = window.__openClinXrDebugScene;
      if (!scene) return false;
      let found = false;
      scene.traverse((object) => {
        if (found) return;
        const dict = object.morphTargetDictionary;
        if (!dict) return;
        if (!Object.keys(dict).some((k) => k.startsWith("viseme_"))) return;
        let cursor = object;
        while (cursor) {
          if (cursor.userData?.openClinXrActorId === expected) { found = true; break; }
          cursor = cursor.parent;
        }
      });
      return found;
    }, actorId, { timeout: 180000 });
    await page.bringToFront();
    await page.click("canvas", { timeout: 10000 });
    async function readCdpTimeTicksBracketed() {
      const pageBefore = await page.evaluate(() => ({ now: performance.now(), timeOrigin: performance.timeOrigin }));
      let metric = { status: "unavailable" };
      try {
        const { metrics } = await cdp.send("Performance.getMetrics");
        const map = Object.fromEntries((metrics ?? []).map((m) => [m.name, m.value]));
        const timestamp = map.Timestamp;
        const navigationStart = map.NavigationStart;
        const finite = Number.isFinite(timestamp) && Number.isFinite(navigationStart);
        metric = {
          status: finite ? "available" : "unavailable",
          reason: finite ? null : "non-finite-Timestamp-or-NavigationStart",
          timestamp,
          navigationStart,
          timestampMs: Number.isFinite(timestamp) ? timestamp * 1000 : null,
          navigationStartMs: Number.isFinite(navigationStart) ? navigationStart * 1000 : null,
          units: { timestamp: "seconds", timestampMs: "milliseconds" },
          timeDomain: "timeTicks",
        };
      } catch (error) {
        metric = { status: "unavailable", reason: String(error?.message ?? error) };
      }
      const pageAfter = await page.evaluate(() => ({ now: performance.now(), timeOrigin: performance.timeOrigin }));
      return { pageBefore, cdp: metric, pageAfter };
    }
    let cdpEnable = { status: "unavailable" };
    try {
      await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
      cdpEnable = { status: "available", timeDomain: "timeTicks" };
    } catch (error) {
      cdpEnable = { status: "unavailable", reason: String(error?.message ?? error) };
    }
    const cdpStart = await readCdpTimeTicksBracketed();
    const result = await page.evaluate(runBrowserCapture, {
      neutralFaceModuleUrl: "/@fs/" + resolve(repo, "tools/openclinxr/evidence/audible-lip-sync-proof/neutral-face-view.mjs"),
      audioGraphClockModuleUrl: "/@fs/" + resolve(repo, "tools/openclinxr/evidence/audible-lip-sync-proof/audio-graph-clock.mjs"),
      nativeTrackObserverModuleUrl: "/@fs/" + resolve(repo, "tools/openclinxr/evidence/audible-lip-sync-proof/native-track-observer.mjs"),
      wavBase64: wavBytes.toString("base64"),
      mouthCues: JSON.parse(cueBytes.toString("utf8")),
      tapSource,
      scenarioId,
      actorId,
      responseText,
      runnerConversationTurn,
      waveformSha256: fixture.sha256,
      cueSha256: fixture.cueSha256,
      sampleRate: fixture.sampleRate,
      sampleCount: fixture.sampleCount,
    });
    const cdpEnd = await readCdpTimeTicksBracketed();
    viteDiagnostics.postHelper = readViteDepMetadata(repo);
    const played = Float32Array.from(result.playedSamples);
    const playedBytes = Buffer.from(played.buffer, played.byteOffset, played.byteLength);
    const playedRef = { path: `${runId}/played.f32`, sha256: writeUnique(runDir, "played.f32", playedBytes).sha256 };
    const rawMixed = Buffer.from(Uint8Array.from(result.videoBytes ?? []));
    if (rawMixed.length < 1024) throw new Error("combined-mediarecorder-unstartable");
    const videoRef = { path: `${runId}/mixed-raw.webm`, sha256: writeUnique(runDir, "mixed-raw.webm", rawMixed).sha256 };
    let nativeTrackAudioRef = null;
    if (result.nativeTrackAudioBase64) {
      const pcm = Buffer.from(result.nativeTrackAudioBase64, "base64");
      nativeTrackAudioRef = { path: `${runId}/native-track-audio.f32`, sha256: writeUnique(runDir, "native-track-audio.f32", pcm).sha256 };
    }
    const executedModules = [];
    for (const required of requiredModules) {
      const script = parsed.find((row) => required.match.test(row.url ?? ""));
      if (!script) throw new Error("executed-module-observation:" + required.sourcePath);
      const source = await cdp.send("Debugger.getScriptSource", { scriptId: script.scriptId });
      const net = network.find((row) => row.response.url === script.url);
      let servedBytes = Buffer.from(source.scriptSource ?? "", "utf8");
      if (net?.requestId) {
        try {
          const body = await cdp.send("Network.getResponseBody", { requestId: net.requestId });
          servedBytes = Buffer.from(body.body, body.base64Encoded ? "base64" : "utf8");
        } catch {
          servedBytes = Buffer.from(source.scriptSource ?? "", "utf8");
        }
      }
      const executedBytes = Buffer.from(source.scriptSource ?? "", "utf8");
      const servedName = required.sourcePath.replaceAll("/", "_") + ".served.js";
      const executedName = required.sourcePath.replaceAll("/", "_") + ".executed.js";
      const served = { path: `${runId}/${servedName}`, sha256: writeUnique(runDir, servedName, servedBytes).sha256 };
      const executed = { path: `${runId}/${executedName}`, sha256: writeUnique(runDir, executedName, executedBytes).sha256 };
      executedModules.push({
        sourcePath: required.sourcePath,
        url: script.url,
        scriptId: script.scriptId,
        scriptParsedEvent: "Debugger.scriptParsed",
        served,
        executed,
      });
    }
    const helperScript = parsed.find((row) => /neutral-face-view/.test(row.url ?? ""));
    let helperModule = null;
    if (helperScript) {
      const source = await cdp.send("Debugger.getScriptSource", { scriptId: helperScript.scriptId });
      const net = network.find((row) => row.response.url === helperScript.url);
      let servedBytes = Buffer.from(source.scriptSource ?? "", "utf8");
      if (net?.requestId) {
        try {
          const body = await cdp.send("Network.getResponseBody", { requestId: net.requestId });
          servedBytes = Buffer.from(body.body, body.base64Encoded ? "base64" : "utf8");
        } catch {
          servedBytes = Buffer.from(source.scriptSource ?? "", "utf8");
        }
      }
      const executedBytes = Buffer.from(source.scriptSource ?? "", "utf8");
      helperModule = {
        sourcePath: "tools/openclinxr/evidence/audible-lip-sync-proof/neutral-face-view.mjs",
        url: helperScript.url,
        scriptId: helperScript.scriptId,
        scriptParsedEvent: "Debugger.scriptParsed",
        served: { path: `${runId}/neutral-face-view.mjs.served.js`, sha256: writeUnique(runDir, "neutral-face-view.mjs.served.js", servedBytes).sha256 },
        executed: { path: `${runId}/neutral-face-view.mjs.executed.js`, sha256: writeUnique(runDir, "neutral-face-view.mjs.executed.js", executedBytes).sha256 },
      };
    }
    const markerHelperModules = [];
    for (const name of ["observed-row-overlay.mjs", "observed-row-barcode.mjs", "audio-graph-clock.mjs", "native-track-observer.mjs"]) {
      const script = parsed.find((row) => (row.url ?? "").includes("/" + name));
      const net = script && network.find((row) => row.response.url === script.url);
      if (!script || !net?.requestId) throw new Error("marker-helper-provenance-missing:" + name);
      const body = await cdp.send("Network.getResponseBody", {requestId: net.requestId});
      const servedBytes = Buffer.from(body.body, body.base64Encoded ? "base64" : "utf8");
      const source = await cdp.send("Debugger.getScriptSource", {scriptId: script.scriptId});
      const executedBytes = Buffer.from(source.scriptSource, "utf8");
      markerHelperModules.push({
        sourcePath: "tools/openclinxr/evidence/audible-lip-sync-proof/" + name,
        url: script.url, scriptId: script.scriptId, scriptParsedEvent: "Debugger.scriptParsed",
        served: {path: `${runId}/${name}.served.js`, sha256: writeUnique(runDir, name + ".served.js", servedBytes).sha256},
        executed: {path: `${runId}/${name}.executed.js`, sha256: writeUnique(runDir, name + ".executed.js", executedBytes).sha256},
      });
    }
    const wavRef = { path: `${runId}/input.wav`, sha256: sha256(wavBytes) };
    const cueRef = { path: `${runId}/cues.json`, sha256: sha256(cueBytes) };
    const sourceBindings = Object.entries(fixture.requiredSourceRoles).map(([role, path]) => ({
      role,
      path,
      sha256: sha256(readFileSync(resolve(repo, path))),
    }));
    const report = {
      schemaVersion: 1,
      claimScope: "local-prerecorded-coarse-mouth-clock-proof",
      notTested: ["physical-speaker-output-and-perceptual-phonetic-sync"],
      captureHead,
      runId,
      attempts: [attempt],
      segments: result.segments,
      frames: result.frames,
      decodedSampleRate: result.decodedSampleRate,
      decodedSampleCount: result.decodedSampleCount,
      contextSampleRate: result.contextSampleRate,
      contextStateAtStart: result.contextStateAtStart,
      userActivated: result.userActivated,
      fixtureRights: "installed-rhubarb-demo-local-diagnostic-only",
      cueInterpretation: "approximate-rhubarb-nine-shape-not-phone-precision",
      framing: result.framing,
      sourceBindings,
      executedModules,
      helperModule,
      markerHelperModules,
      viteDiagnostics,
      prerender: result.prerender,
      recorderStartedAtMs: result.recorderStartedAtMs,
      recorderStartCallAtMs: result.recorderStartCallAtMs,
      recorderOnStartAtMs: result.recorderOnStartAtMs,
      recorderEvents: result.recorderEvents,
      nativeTrackObservation: result.nativeTrackObservation,
      cdpPerformance: {
        enable: cdpEnable,
        start: cdpStart,
        end: cdpEnd,
        audioTimestampMapping: "AudioData.timestamp_us/1000 - NavigationStart_s*1000 is Chromium TimeTicks identity, not a fitted delay",
      },
      buildMetadata: metadata,
      authoredMaterialRows: result.authoredMaterialRows,
      playedTap: result.playedTap,
      files: { inputWav: wavRef, cues: cueRef, video: videoRef, playedPcm: playedRef, nativeTrackAudio: nativeTrackAudioRef },
    };
    const reportBytes = Buffer.from(JSON.stringify(report, null, 2));
    writeUnique(runDir, "report.json", reportBytes);
    const latest = fixture.proofReportPath;
    mkdirSync(dirname(latest), { recursive: true });
    writeFileSync(latest, reportBytes);
    return { report, runDir, latest };
  } catch (error) {
    writeUnique(runDir, "failure.json", Buffer.from(JSON.stringify({outcome:"instrument-failure",captureHead,message:String(error?.message ?? error),sourceDirty:execFileSync("git",["status","--porcelain"],{cwd:repo,encoding:"utf8"}).trim().length>0},null,2)));
    throw error;
  } finally {
    await context.close().catch(() => undefined);
    await browser.close();
    child.kill("SIGTERM");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  captureAudibleLipSync().then((result) => {
    console.log(JSON.stringify({ runDir: result.runDir, latest: result.latest, frames: result.report.frames.length }));
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
