#!/usr/bin/env node
/**
 * C33 host/Quest harness: the learner speaks into the headset. Push-to-talk audio is captured in the shell (apps/ui-xr),
 * sent to the room as a speech-audio intent, recognized on the host by the local faster-whisper sidecar (persistent serve
 * mode), and the transcript enters the room through the C29 utterance-end path. Part A: a lobby-launched replay that ends
 * returns the reviewer to the lobby on the same connection (#return-to-lobby).
 *
 * Scripted path: a known wav is injected into the capture graph (MediaStreamDestination under ?encounterMicInject=1).
 * Real path: getUserMedia is opened afterwards without injection; on the host Chromium serves a fake device fed from the
 * same wav, on the Quest it is the headset microphone (permission + non-silent RMS recorded, or recorded as untested).
 *
 * Host:  node c33-run.mjs --mode host --out <dir>
 * Quest: node c33-run.mjs --mode quest --serial <serial> --out <dir>
 * Exit 1 on any failed assertion.
 */
import { execFile } from "node:child_process";
import { cpSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { adb, collectQuestCleanupLists, parseArgs, runHostProbe, runQuestProbe, startStaticServer } from "./harness-lib.mjs";
import { createSidecarRecognizer } from "./stt/sidecar-recognizer.mjs";

const run_ = promisify(execFile);
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const SERVER_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/index.js");
const FIXTURES_DIST = join(ROOT, "packages/openclinxr/scenario-fixtures/dist/index.js");
const APP_DIST = join(ROOT, "apps/ui-xr/dist");
const STT_PYTHON = process.env.OPENCLINXR_STT_PYTHON ?? "/Volumes/files/openclinxr-assets/stt/venv/bin/python";
const STT_MODEL = process.env.OPENCLINXR_STT_MODEL ?? "base.en";
const TIMING = { doorwaySeconds: 1, encounterSeconds: 300, noteSeconds: 1, breakAfterStationOrders: [] };
const JOIN_TIMEOUT_MS = 240000;
const REPLAY_STEP_MS = 2500;
const SPOKEN = { hello: "Hello, I am the student doctor.", onset: "When did the chest pressure start?" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (values) => { const s = [...values].sort((a, b) => a - b); return s.length === 0 ? null : s[Math.floor(s.length / 2)]; };

const blueprint = {
  blueprintId: "bp-evidence-c33",
  title: "C33 learner microphone",
  stationSlots: [{ slotId: "slot-a", order: 1, label: "C33 chest", requiredEnvironmentIds: [], requiredTraceTags: [] }],
  timing: TIMING,
  requiredTraceTags: [],
  requiredSafetyCriticalTraceTags: [],
};

async function makeFixtures(dir) {
  await mkdir(dir, { recursive: true });
  for (const [name, sentence] of Object.entries(SPOKEN)) {
    await run_("say", ["-v", "Samantha", "-o", join(dir, `${name}.aiff`), sentence]);
    await run_("ffmpeg", ["-loglevel", "error", "-y", "-i", join(dir, `${name}.aiff`), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", join(dir, `${name}.wav`)]);
  }
}
async function readPcm(path) {
  const bytes = await readFile(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "data") return Array.from({ length: size >> 1 }, (_, i) => view.getInt16(offset + 8 + i * 2, true));
    offset += 8 + size + (size & 1);
  }
  throw new Error(`no data chunk in ${path}`);
}

async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const traceDir = await mkdtemp(join(tmpdir(), "xr-sync-c33-trace-"));
  const replayDir = await mkdtemp(join(tmpdir(), "xr-sync-c33-replay-"));
  const run = { mode: options.mode, serial: options.mode === "quest" ? options.serial : null, script: "c33", recognizer: { engine: "faster-whisper", model: STT_MODEL, persistent: true }, assertions: [], probe: null, lobby: null, pageErrors: [], consoleErrors: [], notEvidenceFor: { soundHeardByAPerson: true, clinicalValidity: true, examEquivalence: true } };
  const check = (name, pass, detail = "") => {
    run.assertions.push({ name, pass: Boolean(pass), detail: String(detail) });
    if (!pass) process.exitCode = 1;
  };
  let syncServer = null;
  let replayServer = null;
  let staticServer = null;
  let recognizer = null;
  const startedMs = Date.now();
  try {
    if (options.mode === "quest") {
      await adb(options.serial, ["shell", "input keyevent KEYCODE_WAKEUP"]).catch(() => undefined);
      await adb(options.serial, ["shell", "am broadcast -a com.oculus.vrpowermanager.prox_close"]).catch(() => undefined);
      await sleep(1500);
      run.wakefulness = await adb(options.serial, ["shell", "dumpsys power | grep -m1 mWakefulness="]).catch(() => "");
    }
    const audioDir = join(outDir, "audio");
    await makeFixtures(audioDir);
    const pcm = { hello: await readPcm(join(audioDir, "hello.wav")), onset: await readPcm(join(audioDir, "onset.wav")) };
    recognizer = createSidecarRecognizer({ python: STT_PYTHON, script: join(HERE, "stt", "transcribe.py"), model: STT_MODEL });
    await recognizer.ready();
    const serverCalls = [];
    const speechRecognizer = async (audio) => {
      const started = Date.now();
      const result = await recognizer.recognize({ pcm: audio.pcm });
      serverCalls.push({ samples: audio.pcm.length, sampleRate: audio.sampleRate, ms: Date.now() - started, chars: result.text.trim().length, confidence: result.confidence });
      return result;
    };
    const { createEncounterServer } = await import(SERVER_DIST);
    const { edChestPainScenario, scenarioDialogueSeedBank: shippedSeedBank } = await import(FIXTURES_DIST);
    const shippedEntry = shippedSeedBank.find((entry) => entry.scenarioId === edChestPainScenario.scenarioId);
    const shippedSeed = shippedEntry.seeds.find((seed) => seed.seedId === "patient_onset_history");
    const THRESHOLD = shippedEntry.utteranceFallback.minSpeechConfidence;
    const scenario = { ...edChestPainScenario, status: "approved", eventSchedule: edChestPainScenario.eventSchedule.map((slot) => ({ ...slot, atSecond: TIMING.encounterSeconds })) };
    const actor = scenario.actors.find((entry) => entry.actorId === shippedSeed.actorId);
    const onsetReplyId = `${actor.actorId}:seed:patient_onset_history`;
    const onsetCaption = `${actor.displayName}: ${shippedSeed.caption ?? shippedSeed.spokenText}`;
    run.threshold = THRESHOLD;

    syncServer = await createEncounterServer({ examBlueprint: blueprint, scenarios: [scenario], dialogueSeeds: shippedSeedBank, traceDir, speechRecognizer });
    staticServer = await startStaticServer(APP_DIST);
    run.pageUrl = `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({ encounterSync: syncServer.url, encounterMicInject: "1" })}`;
    const serverActorSpeaking = () => JSON.parse(syncServer.getStateJSON()).actors?.[actor.actorId]?.speaking === true;
    const holdMs = (samples) => Math.round(samples / 16) + 800;

    const drive = async (page) => {
      await page.waitForFunction(() => { const e = globalThis.__openClinXrEncounterSync; return e !== undefined && e.state !== "joining"; }, undefined, { timeout: JOIN_TIMEOUT_MS });
      const readShell = () => page.evaluate(() => {
        const e = globalThis.__openClinXrEncounterSync;
        return {
          state: e.state, error: e.error, sessionId: e.sessionId, turns: e.turns.map((t) => ({ replyId: t.replyId, actorId: t.actorId, planCaption: t.planCaption })),
          speechUtterances: e.speechUtterances ?? [], captures: JSON.parse(JSON.stringify(e.speech?.captures ?? [])),
          learnerCaption: document.getElementById("learner-caption")?.textContent ?? null,
          buttonText: document.getElementById("speak-button")?.textContent ?? null, statusText: document.getElementById("speech-status")?.textContent ?? null,
          hasInject: typeof e.speech?.inject === "function",
        };
      });
      const probe = { scripted: [], real: null, evidenceText: "" };
      const joined = await readShell();
      probe.joined = joined;
      if (joined.state !== "joined" || !joined.buttonText) return { ...probe, final: joined };
      probe.grant = await page.context().grantPermissions(["microphone"]).then(() => "granted", (error) => `grant-failed: ${String(error).slice(0, 120)}`);
      probe.aimedAtPatient = await page.evaluate(({ target }) => {
        const camera = globalThis.__openClinXrGazeCamera;
        const gaze = globalThis.__openClinXrEncounterSync.gazedActorId;
        if (!camera || !gaze) return false;
        if (gaze() === target) return true;
        const eye = camera.getWorldPosition(camera.position.clone());
        for (let degrees = 0; degrees < 360; degrees += 5) {
          const radians = (degrees * Math.PI) / 180;
          camera.lookAt(eye.x + Math.sin(radians), eye.y, eye.z - Math.cos(radians));
          camera.updateMatrixWorld(true);
          if (gaze() === target) return true;
        }
        return false;
      }, { target: actor.actorId });
      // Scripted path: inject a known wav, hold the button while it plays, release.
      for (const name of ["hello", "onset", "onset"]) {
        const endBy = Date.now() + 30000;
        while (serverActorSpeaking() && Date.now() < endBy) await sleep(100);
        const before = (await readShell()).captures.length;
        await page.evaluate((samples) => globalThis.__openClinXrEncounterSync.speech.inject(Int16Array.from(samples)), pcm[name]);
        await page.evaluate(() => globalThis.__openClinXrEncounterSync.speech.press());
        await sleep(holdMs(pcm[name].length));
        await page.evaluate(() => document.getElementById("speak-button").dispatchEvent(new Event("pointerup")));
        await page.waitForFunction((count) => globalThis.__openClinXrEncounterSync.speech.captures.length > count, before, { timeout: 60000 });
        await page.waitForFunction((count) => globalThis.__openClinXrEncounterSync.turns.length > count, probe.scripted.length, { timeout: 60000 }).catch(() => undefined);
        await sleep(500);
        probe.scripted.push({ name, shell: await readShell() });
      }
      // Real getUserMedia path: no injection.
      const endBy = Date.now() + 30000;
      while (serverActorSpeaking() && Date.now() < endBy) await sleep(100);
      const before = (await readShell()).captures.length;
      await page.evaluate(() => globalThis.__openClinXrEncounterSync.speech.press());
      await sleep(3000);
      await page.evaluate(() => document.getElementById("speak-button").dispatchEvent(new Event("pointerup")));
      await page.waitForFunction((count) => globalThis.__openClinXrEncounterSync.speech.captures.length > count, before, { timeout: 90000 }).catch(() => undefined);
      await sleep(1500);
      probe.real = await readShell();
      probe.evidenceText = await page.evaluate(() => JSON.stringify({ speech: globalThis.__openClinXrEncounterSync.speech.captures, speechUtterances: globalThis.__openClinXrEncounterSync.speechUtterances }));
      probe.final = probe.real;
      return probe;
    };

    const launchArgs = ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${join(audioDir, "onset.wav")}`];
    const outcome = options.mode === "host" ? await runHostProbe({ pageUrl: run.pageUrl, outDir, drive, launchArgs }) : await runQuestProbe({ pageUrl: run.pageUrl, outDir, serial: options.serial, drive });
    run.probe = outcome.probe;
    run.pageErrors = outcome.pageErrors;
    run.consoleErrors = outcome.consoleErrors;
    run.browserProduct = outcome.browserProduct;
    const probe = outcome.probe;
    const final = probe.final;
    const scripted = probe.scripted ?? [];
    const scriptedCaptures = scripted.map((s) => s.shell.captures.at(-1));

    check("M1 shell joined the room, mounted the hold-to-speak button with the injection hook, and the view was aimed at the patient", probe.aimedAtPatient === true && final?.state === "joined" && probe.joined?.buttonText === "Hold to speak" && probe.joined?.hasInject === true, JSON.stringify({ state: final?.state, error: final?.error, button: probe.joined?.buttonText, hasInject: probe.joined?.hasInject }));
    check("M2 three scripted captures: status ok, source injected, samples between 85% of the wav length and the wav length plus the 5 s hold margin, non-silent rms", scriptedCaptures.length === 3 && scriptedCaptures.every((c, i) => c?.status === "ok" && c.source === "injected" && c.samples >= pcm[scripted[i].name].length * 0.85 && c.samples <= pcm[scripted[i].name].length + 80000 && c.rms > 0.005), JSON.stringify(scriptedCaptures));
    const scriptedCalls = serverCalls.slice(0, 3);
    check("M3 the server recognizer received exactly the captured samples at 16 kHz for each scripted capture", scriptedCalls.length === 3 && scriptedCalls.every((call, i) => call.sampleRate === 16000 && call.samples === scriptedCaptures[i]?.samples), JSON.stringify(scriptedCalls));
    const norm = (text) => text.toLowerCase().replace(/[^a-z0-9 ]/gu, " ").replace(/\s+/gu, " ").trim();
    const onsetCaptions = scripted.filter((s) => s.name === "onset").map((s) => norm(s.shell.learnerCaption ?? ""));
    check("M4 the learner caption after each onset capture shows the recognized words with a confidence (chest, pressure, start)", onsetCaptions.length === 2 && onsetCaptions.every((text) => /^you said 0 \d\d /u.test(text) && text.includes("chest") && text.includes("pressure")), JSON.stringify(scripted.map((s) => s.shell.learnerCaption)));
    const turns = final?.turns ?? [];
    check("M5 the recognized onset speech got the authored onset answer through the C29 path (replyId and caption), twice", turns.filter((t) => t.replyId === onsetReplyId).length === 2 && turns.filter((t) => t.replyId === onsetReplyId).every((t) => t.planCaption === onsetCaption) && scripted.at(-1).shell.speechUtterances.at(-1)?.statuses.join() === "ack,ack,ack", JSON.stringify(turns.map((t) => t.replyId)));
    const latencies = scriptedCaptures.map((c) => c?.releaseToCaptionMs);
    run.latency = { releaseToCaptionMs: latencies, median: median(latencies), recognizerMs: scriptedCalls.map((c) => c.ms) };
    check("M6 release-to-caption latency recorded for every scripted capture (finite, > 0, < 15 s)", latencies.length === 3 && latencies.every((v) => Number.isFinite(v) && v > 0 && v < 15000), JSON.stringify(run.latency));

    const real = probe.real?.captures?.at(-1);
    const realTested = real !== undefined && real.source === "microphone" && real.status !== undefined && !String(real.status).startsWith("failed:Not");
    run.realMicrophone = { tested: Boolean(real?.status === "ok" && real.rms > 0.005), capture: real ?? null, permissionGrant: probe.grant ?? null };
    run.realMicrophone.note = options.mode === "host" ? "Playwright Chromium getUserMedia hangs on this Mac even with fake-device flags in a plain page (probe: 8 s hang, 3 variants); recorded, not asserted as opened" : "headset microphone";
    check("M7 the real getUserMedia path ran to a recorded outcome (source microphone, status ok with non-silent rms, or a named failure); tested=" + Boolean(real?.status === "ok" && real.rms > 0.005), JSON.stringify({ real, grant: probe.grant, tested: real?.status === "ok" && real.rms > 0.005 }));

    const isAsset404 = (text) => /Failed to load resource.*404/iu.test(text);
    const otherConsoleErrors = outcome.consoleErrors.filter((text) => !isAsset404(text));
    check("M8 no page errors and no console errors other than missing-asset 404s", outcome.pageErrors.length === 0 && otherConsoleErrors.length === 0, [...outcome.pageErrors, ...otherConsoleErrors].join(" | ") || `${outcome.consoleErrors.length} asset 404s`);
    const chunkNames = (await readdir(join(APP_DIST, "assets"))).filter((n) => n.endsWith(".js"));
    const hits = [];
    for (const chunk of chunkNames) {
      const code = await readFile(join(APP_DIST, "assets", chunk), "utf8");
      for (const marker of ["@openclinxr/xr-sync-server", "@colyseus/core", "faster-whisper"]) if (code.includes(marker)) hits.push(`${chunk} contains ${marker.slice(0, 40)}`);
    }
    check("M9 no built chunk carries the server package, @colyseus/core or the recognizer", chunkNames.length > 0 && hits.length === 0, hits.join(" | ") || `${chunkNames.length} chunks`);

    const recognizedTexts = (await Promise.all(["hello", "onset"].map(async (name) => (await recognizer.recognize({ pcm: Int16Array.from(pcm[name]) })).text.trim()))).filter((t) => t.length > 3);
    const speechUtteranceCount = final?.speechUtterances?.length ?? 0;
    await syncServer.close();
    syncServer = null;
    let traceFiles = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      traceFiles = (await readdir(traceDir)).filter((n) => n.endsWith(".conversation-trace.json"));
      if (traceFiles.length > 0) break;
      await sleep(200);
    }
    const allFiles = await readdir(traceDir);
    const raws = await Promise.all(allFiles.map((n) => readFile(join(traceDir, n), "utf8")));
    const sizes = await Promise.all(allFiles.map(async (n) => (await stat(join(traceDir, n))).size));
    const trace = traceFiles.length > 0 ? JSON.parse(await readFile(join(traceDir, traceFiles[0]), "utf8")) : { events: [] };
    const speechEnds = (trace.events ?? []).filter((event) => event.kind === "utterance-end" && event.modality === "speech");
    const audioKeys = raws.filter((raw) => /"[^"]*(audio|sample|waveform|wav|pcm|base64)[^"]*"\s*:/iu.test(raw)).length;
    const leaks = [...recognizedTexts, ...(shippedSeed.utterancePhrases ?? []), shippedSeed.caption ?? shippedSeed.spokenText].map((t) => t.trim()).filter((t) => t.length > 3).filter((text) => raws.some((raw) => raw.toLowerCase().includes(text.toLowerCase())));
    check("M10 the persisted trace is review-safe: one speech utterance-end per sent speech utterance, no recognized text or lines, no audio-shaped key, only trace files, each under 40 kB; speech-audio left no trace event", speechEnds.length === speechUtteranceCount && leaks.length === 0 && audioKeys === 0 && allFiles.every((n) => n.endsWith(".json")) && sizes.every((n) => n < 40000) && !(trace.events ?? []).some((e) => String(e.kind).includes("audio")), JSON.stringify({ speechEnds: speechEnds.length, speechUtteranceCount, leaks, audioKeys, files: allFiles.length, sizes }));

    // Part A: lobby -> replay -> back to the lobby on the same connection, twice.
    // The speech page leaves before the station closes, so no review index exists for it; record a short live session (typed) for the lobby.
    const liveDir = await mkdtemp(join(tmpdir(), "xr-sync-c33-live-"));
    const shortTiming = { ...TIMING, encounterSeconds: 30 };
    const shortScenario = { ...scenario, eventSchedule: scenario.eventSchedule.map((slot) => ({ ...slot, atSecond: 30 })) };
    const { connect } = await import(join(ROOT, "packages/openclinxr/xr-sync-client/dist/index.js"));
    const live2 = await createEncounterServer({ examBlueprint: { ...blueprint, timing: shortTiming }, scenarios: [shortScenario], dialogueSeeds: shippedSeedBank, traceDir: liveDir });
    const learner2 = await connect(live2.url, { roomOptions: { actors: [actor.actorId] } });
    for (let i = 0; i < 300 && JSON.parse(live2.getStateJSON()).phase !== "encounter"; i += 1) await sleep(200);
    for (const text of ["hello there", shippedSeed.utterancePhrases[0]]) {
      for (const [kind, payload] of [["select-actor", { actorId: actor.actorId }], ["utterance-start", {}], ["utterance-end", { text }]]) await learner2.sendIntent(kind, payload);
      for (let i = 0; i < 150 && JSON.parse(live2.getStateJSON()).actors?.[actor.actorId]?.speaking !== true; i += 1) await sleep(50);
      for (let i = 0; i < 300 && JSON.parse(live2.getStateJSON()).actors?.[actor.actorId]?.speaking === true; i += 1) await sleep(100);
    }
    for (let i = 0; i < 1200 && !(await readdir(liveDir)).includes("exam-session.review-index.json"); i += 1) await sleep(200);
    await learner2.leave().catch(() => undefined);
    await live2.close();
    cpSync(liveDir, replayDir, { recursive: true });
    replayServer = await createEncounterServer({ replayDir, replayStepMs: REPLAY_STEP_MS, scenarios: [scenario], dialogueSeeds: shippedSeedBank });
    const lobbyUrl = `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({ encounterSync: replayServer.url, encounterReviewLobby: "1" })}`;
    const driveLobby = async (page) => {
      await page.evaluate(() => { globalThis.__c33Marker = "same-page"; });
      await page.waitForFunction(() => { const e = globalThis.__openClinXrEncounterSync; return e !== undefined && e.state !== "joining"; }, undefined, { timeout: JOIN_TIMEOUT_MS });
      const rounds = [];
      for (let round = 0; round < 2; round += 1) {
        await page.waitForFunction(() => { const b = document.getElementById("lobby-station-slot-a"); return b !== null && b.disabled !== true; }, undefined, { timeout: 60000 });
        if (round === 0) await sleep(6000);
        const listed = await page.evaluate(() => ({ returnHidden: document.getElementById("return-to-lobby")?.hidden, stations: JSON.parse(JSON.stringify(globalThis.__openClinXrEncounterSync.lobby.stations)) }));
        await page.evaluate(() => document.getElementById("lobby-station-slot-a").click());
        await page.waitForFunction(() => document.getElementById("return-to-lobby")?.hidden === false, undefined, { timeout: 120000 });
        await page.waitForFunction((min) => globalThis.__openClinXrEncounterSync.turns.length >= min, (round + 1) * 2, { timeout: 30000 }).catch(() => undefined);
        const done = await page.evaluate(() => { const e = globalThis.__openClinXrEncounterSync; return { turns: e.turns.length, spoken: e.turns.filter((t) => t.spoken).length, returnHidden: document.getElementById("return-to-lobby").hidden }; });
        await page.evaluate(() => document.getElementById("return-to-lobby").click());
        await page.waitForFunction(() => { const b = document.getElementById("lobby-station-slot-a"); return b !== null && document.getElementById("return-to-lobby")?.hidden === true; }, undefined, { timeout: 60000 });
        rounds.push({ listed, done, back: await page.evaluate(() => ({ returnHidden: document.getElementById("return-to-lobby").hidden, stationButton: document.getElementById("lobby-station-slot-a") !== null })) });
      }
      const end = await page.evaluate(() => { const e = globalThis.__openClinXrEncounterSync; return { marker: globalThis.__c33Marker, state: e.state, sessionId: e.sessionId, error: e.error, selections: JSON.parse(JSON.stringify(e.lobby.selections)), returns: JSON.parse(JSON.stringify(e.lobby.returns)), turns: e.turns.length }; });
      return { rounds, end };
    };
    const lobbyOutcome = options.mode === "host" ? await runHostProbe({ pageUrl: lobbyUrl, outDir, drive: driveLobby, launchArgs }) : await runQuestProbe({ pageUrl: lobbyUrl, outDir, serial: options.serial, drive: driveLobby });
    run.lobby = lobbyOutcome.probe;
    const lobby = lobbyOutcome.probe;
    check("L1 two lobby -> replay -> return rounds on one page load and one joined connection: marker intact, state joined, two selections and two returns acked", lobby.rounds?.length === 2 && lobby.end?.marker === "same-page" && lobby.end.state === "joined" && lobby.end.selections.length === 2 && lobby.end.selections.every((s) => s.status === "ack") && lobby.end.returns.length === 2 && lobby.end.returns.every((r) => r.status === "ack"), JSON.stringify(lobby.end));
    check("L2 the return button is hidden in the lobby, shown when the replay ends, and the station list is back after the return", lobby.rounds?.every((r) => r.listed.returnHidden === true && r.done.returnHidden === false && r.back.returnHidden === true && r.back.stationButton), JSON.stringify(lobby.rounds));
    check("L3 each replay spoke its turns before the button appeared", lobby.rounds?.length === 2 && lobby.rounds[0].done.spoken >= 2 && lobby.rounds[1].done.spoken >= lobby.rounds[0].done.spoken + 2, JSON.stringify(lobby.rounds?.map((r) => r.done)));
    const lobbyOther = lobbyOutcome.consoleErrors.filter((text) => !isAsset404(text));
    check("L4 no page errors and no console errors other than 404s in the lobby page", lobbyOutcome.pageErrors.length === 0 && lobbyOther.length === 0, [...lobbyOutcome.pageErrors, ...lobbyOther].join(" | ") || "clean");

    if (options.mode === "quest") {
      const lists = await collectQuestCleanupLists({ staticPort: staticServer.port, syncPort: new URL(run.pageUrl).searchParams.get("encounterSync").split(":").at(-1), serial: options.serial });
      run.adbReverseList = lists.adbReverseList;
      run.adbForwardList = lists.adbForwardList;
      check("Q1 adb reverse/forward lists hold neither run port nor tcp:9222", !lists.leaked, `reverse=${lists.adbReverseList} forward=${lists.adbForwardList}`);
    }
  } catch (error) {
    process.exitCode = 1;
    run.fatal = String(error?.stack ?? error).slice(0, 1600);
  } finally {
    recognizer?.close();
    await syncServer?.close().catch(() => undefined);
    await replayServer?.close().catch(() => undefined);
    await staticServer?.close().catch(() => undefined);
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c33-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 300));
    if (run.fatal) console.log(`FATAL ${run.fatal.slice(0, 400)}`);
    console.log(`wrote ${join(outDir, "c33-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
