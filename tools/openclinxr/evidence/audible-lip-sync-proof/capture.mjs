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
  prepareViteOptimization(repo, metadata);
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
    const result = await page.evaluate(runBrowserCapture, {
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
    const played = Float32Array.from(result.playedSamples);
    const playedBytes = Buffer.from(played.buffer, played.byteOffset, played.byteLength);
    const playedRef = { path: `${runId}/played.f32`, sha256: writeUnique(runDir, "played.f32", playedBytes).sha256 };
    const rawMixed = Buffer.from(Uint8Array.from(result.videoBytes ?? []));
    if (rawMixed.length < 1024) throw new Error("combined-mediarecorder-unstartable");
    const videoRef = { path: `${runId}/mixed-raw.webm`, sha256: writeUnique(runDir, "mixed-raw.webm", rawMixed).sha256 };
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
      buildMetadata: metadata,
      authoredMaterialRows: result.authoredMaterialRows,
      playedTap: result.playedTap,
      files: { inputWav: wavRef, cues: cueRef, video: videoRef, playedPcm: playedRef },
    };
    const reportBytes = Buffer.from(JSON.stringify(report, null, 2));
    writeUnique(runDir, "report.json", reportBytes);
    const latest = fixture.proofReportPath;
    mkdirSync(dirname(latest), { recursive: true });
    writeFileSync(latest, reportBytes);
    return { report, runDir, latest };
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
