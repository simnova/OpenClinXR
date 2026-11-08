#!/usr/bin/env node
/**
 * C37 host/Quest harness: the shell's topic menu is server-authored. Boots an in-process server (shipped scenario + seed bank, local
 * faster-whisper recognizer) with a trace dir, serves apps/ui-xr/dist, then: reads the menu buttons (label, data-asked), taps two topics,
 * speaks one phrase through the getUserMedia override (as c35/c36), and compares the page's asked set with the review's observed set
 * (traceTagCoverage on the persisted trace) and the page's sent topicTags with the trace. Expected labels come from the shipped seed bank.
 *
 * Host:  node c37-run.mjs --mode host --out <dir>
 * Quest: node c37-run.mjs --mode quest --serial <serial> --out <dir>
 * Writes <dir>/report.json. Exit 1 on any failed assertion.
 */
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { collectQuestCleanupLists, parseArgs, runHostProbe, runQuestProbe, startStaticServer } from "./harness-lib.mjs";

const run_ = promisify(execFile);
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const SERVER_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/index.js");
const SIDECAR_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/sidecar-recognizer.js");
const COVERAGE_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/trace-tag-coverage.js");
const FIXTURES_DIST = join(ROOT, "packages/openclinxr/scenario-fixtures/dist/index.js");
const APP_DIST = join(ROOT, "apps/ui-xr/dist");
const IWER_BUNDLE = join(ROOT, "apps/arena/ui-xr-iwsdk-spike/node_modules/iwer/build/iwer.min.js");
const STT_PYTHON = process.env.OPENCLINXR_STT_PYTHON ?? "/Volumes/files/openclinxr-assets/stt/venv/bin/python";
const TIMING = { doorwaySeconds: 1, encounterSeconds: 300, noteSeconds: 1, breakAfterStationOrders: [] };
const JOIN_TIMEOUT_MS = 240000;
const NOTE_TAG = "patient_note_submitted";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const blueprint = {
  blueprintId: "bp-evidence-c37",
  title: "C37 topic menu",
  stationSlots: [{ slotId: "slot-a", order: 1, label: "C37 chest", requiredEnvironmentIds: [], requiredTraceTags: [] }],
  timing: TIMING,
  requiredTraceTags: [],
  requiredSafetyCriticalTraceTags: [],
};

async function makeFixtures(dir, spoken) {
  await mkdir(dir, { recursive: true });
  for (const [name, sentence] of Object.entries(spoken)) {
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

async function shootPanel(page, path) {
  try {
    const box = await page.locator("#room-panel").boundingBox({ timeout: 10000 });
    if (box === null) return;
    await page.screenshot({ path, fullPage: true, clip: { x: box.x, y: box.y + await page.evaluate(() => window.scrollY), width: box.width, height: box.height }, timeout: 30000 });
  } catch { /* evidence only */ }
}
function iwerGlue() {
  const device = new IWER.XRDevice(IWER.metaQuest3);
  device.installRuntime({ forceInstall: true });
  globalThis.__c37Xr = { device, sessions: [], ended: 0 };
  const xr = navigator.xr;
  const originalRequestSession = xr.requestSession.bind(xr);
  xr.requestSession = async function requestSession(...args) {
    const session = await originalRequestSession(...args);
    globalThis.__c37Xr.sessions.push(session);
    session.addEventListener("end", () => {
      globalThis.__c37Xr.ended += 1;
    });
    return session;
  };
}

async function main(argv) {
  const parsedArgv = [...argv];
  let emulated = false;
  const modeFlag = parsedArgv.indexOf("--mode");
  if (modeFlag !== -1 && parsedArgv[modeFlag + 1] === "emulated") {
    parsedArgv[modeFlag + 1] = "host";
    emulated = true;
  }
  const options = parseArgs(parsedArgv);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const traceDir = await mkdtemp(join(tmpdir(), "xr-sync-c37-trace-"));
  const run = { mode: emulated ? "emulated" : options.mode, serial: options.mode === "quest" ? options.serial : null, script: "c37", assertions: [], pageErrors: [], consoleErrors: [], notEvidenceFor: { soundHeardByPerson: true, clinicalValidity: true, phraseReadsWellAsLabel: true } };
  const check = (name, pass, detail = "") => {
    run.assertions.push({ name, pass: Boolean(pass), detail: String(detail) });
    if (!pass) process.exitCode = 1;
  };
  const startedMs = Date.now();
  let syncServer = null;
  let staticServer = null;
  let closeSpeech = () => undefined;
  const isAsset404 = (text) => /Failed to load resource.*404/iu.test(text);
  try {
    if (options.mode === "quest") {
      const { adb } = await import("./harness-lib.mjs");
      await adb(options.serial, ["shell", "input keyevent KEYCODE_WAKEUP"]).catch(() => undefined);
      await adb(options.serial, ["shell", "am broadcast -a com.oculus.vrpowermanager.prox_close"]).catch(() => undefined);
      await sleep(1500);
    }
    const { createEncounterServer } = await import(SERVER_DIST);
    const { bootSidecarRecognizer } = await import(SIDECAR_DIST);
    const { traceTagCoverage } = await import(COVERAGE_DIST);
    const { edChestPainScenario, scenarioDialogueSeedBank } = await import(FIXTURES_DIST);
    const bank = scenarioDialogueSeedBank.find((e) => e.scenarioId === edChestPainScenario.scenarioId);
    const scenario = { ...edChestPainScenario, status: "approved", eventSchedule: edChestPainScenario.eventSchedule.map((slot) => ({ ...slot, atSecond: TIMING.encounterSeconds })) };
    const castIds = new Set(scenario.actors.map((a) => a.actorId));
    const menuTags = [...new Set(scenario.requiredTraceTags)].filter((t) => t !== NOTE_TAG);
    const answerSeed = (tag) => bank.seeds.find((s) => s.safetyExpectation === "responds_from_visible_facts" && castIds.has(s.actorId) && (s.caption !== undefined || s.spokenText !== undefined) && s.expectedTraceTags.includes(tag) && (s.utterancePhrases ?? []).length > 0);
    const firstPhrase = (tag) => answerSeed(tag)?.utterancePhrases[0];
    // Ruling F2: a phrase shared by 2 or more menu tags labels none of them.
    const shared = (tag) => firstPhrase(tag) !== undefined && menuTags.filter((other) => firstPhrase(other) === firstPhrase(tag)).length > 1;
    const hasLabelPhrase = (tag) => firstPhrase(tag) !== undefined && !shared(tag);
    const expectedLabel = (tag) => (hasLabelPhrase(tag) ? firstPhrase(tag) : tag);
    // Client display (grade B1/B2): tag-labelled entries show the tag with underscores as spaces; an asked entry leads with a check mark.
    const displayOf = (tag, asked) => `${asked ? "\u2713 " : ""}${hasLabelPhrase(tag) ? firstPhrase(tag) : tag.replaceAll("_", " ")}`;
    const patientSeed = bank.seeds.find((s) => s.seedId === (emulated ? "nurse_team_escalation" : "patient_onset_history"));
    const patientId = patientSeed.actorId;
    const speakerId = patientSeed.actorId;
    const SPOKEN = patientSeed.utterancePhrases[0];
    // C39: a matched answer traces every on-menu tag it covers, so one spoken turn marks all of them; the first is the trace event's tag.
    const SPOKEN_TAGS = patientSeed.expectedTraceTags.filter((t) => menuTags.includes(t));
    const SPOKEN_TAG = SPOKEN_TAGS[0];
    const TAPS = [menuTags.find((t) => !SPOKEN_TAGS.includes(t) && !shared(t) && !hasLabelPhrase(t)), menuTags.find((t) => !SPOKEN_TAGS.includes(t) && shared(t))];
    run.expected = { menuTags, labels: Object.fromEntries(menuTags.map((t) => [t, expectedLabel(t)])), taps: TAPS, spoken: SPOKEN_TAG, spokenTags: SPOKEN_TAGS, patientId };

    const audioDir = join(outDir, "audio");
    await makeFixtures(audioDir, { spoken: SPOKEN });
    const pcm = await readPcm(join(audioDir, "spoken.wav"));
    const speech = await bootSidecarRecognizer(process.env, { script: join(HERE, "stt", "transcribe.py"), python: STT_PYTHON }, { onCreated: (close) => { closeSpeech = close; } });
    run.speech = { available: speech.recognizer !== null, reason: speech.reason };
    syncServer = await createEncounterServer({ examBlueprint: blueprint, scenarios: [scenario], dialogueSeeds: scenarioDialogueSeedBank, traceDir, ...(speech.recognizer === null ? {} : { speechRecognizer: speech.recognizer }) });
    staticServer = await startStaticServer(APP_DIST);
    const pageUrl = `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({ encounterSync: syncServer.url, encounterMicInject: "1" })}`;
    run.pageUrl = pageUrl;
    const launchArgs = ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${join(audioDir, "spoken.wav")}`];
    const initScript = () => {
      const ctl = { wav: null, calls: 0, opened: 0, played: 0, ctx: null, dest: null };
      globalThis.__c37Mic = ctl;
      const devices = navigator.mediaDevices;
      if (devices === undefined) return;
      devices.getUserMedia = async () => {
        ctl.calls += 1;
        const ctx = new AudioContext();
        await ctx.resume();
        ctl.ctx = ctx;
        ctl.dest = ctx.createMediaStreamDestination();
        ctl.opened += 1;
        return ctl.dest.stream;
      };
      ctl.play = () => {
        const buffer = ctl.ctx.createBuffer(1, ctl.wav.length, 16000);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < ctl.wav.length; i += 1) data[i] = ctl.wav[i] / 32768;
        const node = ctl.ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(ctl.dest);
        node.start();
        ctl.played += 1;
      };
    };
    const iwerBundleText = emulated ? await readFile(IWER_BUNDLE, "utf8") : null;
    const combinedInitScript = emulated ? { content: `${iwerBundleText};(${iwerGlue.toString()})();globalThis.__c37Errors=[];addEventListener("error",(event)=>{globalThis.__c37Errors.push(String((event.error&&event.error.stack)||event.message));});(${initScript.toString()})();` } : null;
    const probeFn = (drive) => (emulated ? runHostProbe({ pageUrl, outDir, drive, launchArgs, initScript: combinedInitScript }) : (options.mode === "host" ? runHostProbe({ pageUrl, outDir, drive, launchArgs, initScript }) : runQuestProbe({ pageUrl, outDir, serial: options.serial, drive, initScript })));
    const readMenu = (page) => page.evaluate(() => {
      const e = globalThis.__openClinXrEncounterSync;
      const buttons = [...document.querySelectorAll("#room-topics button")].map((b) => ({ id: b.id, text: b.textContent, asked: b.getAttribute("data-asked"), bg: b.style.background }));
      return { buttons, state: e?.state ?? null, error: e?.error ?? "", intents: JSON.parse(JSON.stringify(e?.intents ?? [])), turns: JSON.parse(JSON.stringify((e?.turns ?? []).map((t) => ({ actorId: t.actorId, replyId: t.replyId })))), captures: JSON.parse(JSON.stringify(e?.speech?.captures ?? [])) };
    });
    const serverPhase = () => JSON.parse(syncServer.getStateJSON()).phase;
    const drive = async (page) => {
      await page.waitForFunction(() => { const e = globalThis.__openClinXrEncounterSync; return e !== undefined && e.state !== "joining"; }, undefined, { timeout: JOIN_TIMEOUT_MS });
      const probe = {};
      await page.locator("#utterance-input").waitFor({ timeout: 60000 });
      await page.context().grantPermissions(["microphone"]).catch(() => undefined);
      await page.waitForFunction((n) => document.querySelectorAll("#room-topics button").length >= n, menuTags.length, { timeout: 60000 });
      while (serverPhase() !== "encounter") await sleep(200);
      probe.start = await readMenu(page);
      await shootPanel(page, join(outDir, "c37-menu-start.png"));
      if (!emulated) {
        probe.aimed = await page.evaluate(({ target }) => {
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
        }, { target: patientId });
      }
      let have = 0;
      if (emulated) {
        probe.xr = {};
        probe.xr.supported = await page.evaluate(() => navigator.xr.isSessionSupported("immersive-vr"));
        await page.waitForFunction(() => { const button = document.getElementById("enter-xr-button"); return button !== null && !button.disabled; }, undefined, { timeout: 60000 });
        await page.click("#enter-xr-button");
        await page.waitForFunction(() => globalThis.__c37Xr.sessions.length === 1 && document.getElementById("enter-xr-button").textContent === "Exit Full VR", undefined, { timeout: 60000 });
        probe.xr = {
          supported: probe.xr.supported,
          sessionCount: await page.evaluate(() => globalThis.__c37Xr.sessions.length),
          endedAfterEnter: await page.evaluate(() => globalThis.__c37Xr.ended),
        };
        const remote = (method, params) => page.evaluate(([m, p]) => globalThis.__c37Xr.device.remote.dispatch(m, p), [method, params]);
        await remote("set_connected", { device: "controller-right", connected: true });
        await remote("animate_to", { device: "headset", position: { x: 0, y: 1.6, z: 0 }, orientation: { x: 0, y: 0.1305, z: 0, w: 0.9914 }, duration: 0.5 });
        await sleep(800);
        const headTransform = await remote("get_transform", { device: "headset" });
        probe.xr.headPose = JSON.parse(JSON.stringify(headTransform.orientation));
        probe.aimed = false;
        const turnsBeforeSelect = await page.evaluate(() => globalThis.__openClinXrEncounterSync.turns.length);
        await remote("_select_press", { device: "controller-right" });
        await remote("_select_release", { device: "controller-right" });
        await page.waitForFunction(() => (globalThis.__openClinXrEncounterSync.intents ?? []).length >= 1, undefined, { timeout: 30000 });
        probe.xr.selectIntents = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__openClinXrEncounterSync.intents)));
        await page.waitForFunction((count) => globalThis.__openClinXrEncounterSync.turns.length >= count, turnsBeforeSelect + 1, { timeout: 120000 });
        have = await page.evaluate(() => globalThis.__openClinXrEncounterSync.turns.length);
      }
      const domTaps = emulated ? [menuTags.find((t) => !SPOKEN_TAGS.includes(t) && t !== scenario.requiredTraceTags.find((x) => menuTags.includes(x)))] : TAPS;
      for (const tag of domTaps) {
        await page.evaluate((id) => document.getElementById(id).click(), `topic-${tag}`);
        await page.waitForFunction((count) => globalThis.__openClinXrEncounterSync.turns.length >= count, have + 1, { timeout: 120000 });
        have += 1;
        await sleep(800);
      }
      probe.afterTaps = await readMenu(page);
      await shootPanel(page, join(outDir, "c37-menu-after-taps.png"));
      if (emulated) {
        // The shell also addresses the last actor that spoke, so open with a typed line to the nurse through the shell's own typed path, after the taps; the nurse's reply makes it the addressed actor.
        probe.openerVia = "evidence.sendUtterance (typed opener to the speaking actor)";
        probe.gazeAfterYaw = await page.evaluate(() => {
          const cam = globalThis.__openClinXrGazeCamera;
          const before = cam.getWorldDirection(cam.position.clone()).toArray();
          globalThis.__c37Xr.device.quaternion.set(0, 0.7071, 0, 0.7071);
          return { fwd: before };
        });
        await sleep(500);
        probe.gazeAfterYaw.fwdAfter = await page.evaluate(() => globalThis.__openClinXrGazeCamera.getWorldDirection(globalThis.__openClinXrGazeCamera.position.clone()).toArray());
        await page.evaluate(({ id }) => globalThis.__openClinXrEncounterSync.sendUtterance(id, "Hello, I am the student doctor."), { id: speakerId });
        await page.waitForFunction((id) => globalThis.__openClinXrEncounterSync.turns.at(-1)?.actorId === id, speakerId, { timeout: 60000 });
        await sleep(800);
        probe.aimed = await page.evaluate((id) => globalThis.__openClinXrEncounterSync.turns.at(-1)?.actorId === id, speakerId);
        have = await page.evaluate(() => globalThis.__openClinXrEncounterSync.turns.length);
      }
      await page.evaluate((samples) => { globalThis.__c37Mic.wav = samples; }, pcm);
      await page.evaluate(() => document.getElementById("speak-button").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
      await page.waitForFunction(() => globalThis.__c37Mic.opened > 0 && globalThis.__c37Mic.ctx !== null, undefined, { timeout: 20000 });
      await sleep(800);
      await page.evaluate(() => globalThis.__c37Mic.play());
      await sleep(Math.round(pcm.length / 16) + 800);
      await page.evaluate(() => document.getElementById("speak-button").dispatchEvent(new PointerEvent("pointerup", { bubbles: true })));
      await page.waitForFunction((count) => globalThis.__openClinXrEncounterSync.turns.length >= count, have + 1, { timeout: 120000 }).catch(async (error) => {
        run.diag = await page.evaluate(() => { const m = globalThis.__c37Mic; const e = globalThis.__openClinXrEncounterSync; return { mic: { calls: m.calls, opened: m.opened, played: m.played, ctxState: m.ctx?.state, ctxTime: m.ctx?.currentTime }, captures: JSON.parse(JSON.stringify(e.speech?.captures ?? [])), speechUtterances: JSON.parse(JSON.stringify(e.speechUtterances ?? [])), refusal: document.getElementById("room-refusal")?.textContent, turns: e.turns.length }; });
        throw error;
      });
      await sleep(1000);
      probe.afterSpeech = await readMenu(page);
      await shootPanel(page, join(outDir, "c37-menu-final.png"));
      if (emulated) {
        probe.xr.endedAfterTurns = await page.evaluate(() => globalThis.__c37Xr.ended);
        probe.xr.errorStacks = await page.evaluate(() => globalThis.__c37Errors.slice(0, 400));
        probe.xr.sessionActive = await page.evaluate(() => globalThis.__c37Xr.sessions.length === 1 && globalThis.__c37Xr.ended === 0);
        probe.xr.nullAxes = await page.evaluate(() => globalThis.__c37Xr.sessions.some((session) => Array.from(session.inputSources ?? []).some((source) => Array.from(source.gamepad?.axes ?? []).some((axis) => axis === null))));
      }
      return probe;
    };
    const out = await probeFn(drive);
    const p = out.probe;
    run.probe = p;
    run.pageErrors.push(...out.pageErrors);
    run.consoleErrors.push(...out.consoleErrors);
    await syncServer.close();
    syncServer = null;
    closeSpeech();
    let traceFiles = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      traceFiles = (await readdir(traceDir)).filter((n) => n.endsWith(".conversation-trace.json"));
      if (traceFiles.length > 0) break;
      await sleep(200);
    }
    const trace = traceFiles.length > 0 ? JSON.parse(await readFile(join(traceDir, traceFiles[0]), "utf8")) : { events: [] };
    const coverage = traceTagCoverage(trace, scenario);
    const reviewObserved = coverage.observedTraceTags.filter((t) => t !== NOTE_TAG);
    const askedOf = (menu) => (menu?.buttons ?? []).filter((b) => b.asked === "true").map((b) => b.id.replace(/^topic-/u, ""));
    const finalAsked = askedOf(p.afterSpeech);
    run.reviewObserved = reviewObserved;
    run.finalAsked = finalAsked;

    check("H1 the shell joined the room and mounted the topic menu", p.start?.state === "joined" && (p.start?.buttons?.length ?? 0) === menuTags.length, JSON.stringify({ state: p.start?.state, error: p.start?.error, n: p.start?.buttons?.length }));
    check("H2 one button per menu tag in scenario order, each labelled with the shipped seed phrase or the tag text", JSON.stringify((p.start?.buttons ?? []).map((b) => [b.id, b.text])) === JSON.stringify(menuTags.map((t) => [`topic-${t}`, displayOf(t, false)])), JSON.stringify((p.start?.buttons ?? []).map((b) => b.text)));
    check("H3 at least one button shows a seed phrase and one shows a tag, all labels are distinct, and a shipped label differs from the prettified tag", menuTags.some(hasLabelPhrase) && menuTags.some((t) => !hasLabelPhrase(t)) && new Set(menuTags.map(expectedLabel)).size === menuTags.length && menuTags.some((t) => expectedLabel(t) !== t.replaceAll("_", " ")), JSON.stringify(run.expected.labels));
    check("H4 every button starts data-asked=false", (p.start?.buttons ?? []).every((b) => b.asked === "false"), JSON.stringify((p.start?.buttons ?? []).map((b) => b.asked)));
    check(emulated ? "H5 the speaking actor answered a typed opener, so the shell addresses it" : "H5 the view was aimed at the speaking actor before the taps", p.aimed === true, String(p.aimed));
    // Emulated: the page's controller select completes the first required tag of the shipped scenario; the DOM tap is the harness's own choice; speech resolves from the nurse's shipped seed.
    const SELECT_TAG = scenario.requiredTraceTags.find((t) => menuTags.includes(t));
    const DOM_TAP_TAG = menuTags.find((t) => !SPOKEN_TAGS.includes(t) && t !== SELECT_TAG);
    const expectedTags = emulated ? [SELECT_TAG, DOM_TAP_TAG, ...SPOKEN_TAGS] : [...TAPS, ...SPOKEN_TAGS];
    const expectedTaps = expectedTags.slice(0, expectedTags.length - SPOKEN_TAGS.length);
    if (emulated) {
      check("H6 after two taps exactly the tapped buttons read data-asked=true", JSON.stringify([...askedOf(p.afterTaps)].sort()) === JSON.stringify([...expectedTaps].sort()), JSON.stringify(askedOf(p.afterTaps)));
      check("H7 the page sent the two taps as trace actions with those topicTags, both acked", JSON.stringify((p.afterSpeech?.intents ?? []).map((i) => i.topicTag)) === JSON.stringify(expectedTaps) && (p.afterSpeech?.intents ?? []).every((i) => i.statuses.join() === "ack,ack,ack"), JSON.stringify(p.afterSpeech?.intents));
    } else {
      check("H6 after two taps exactly the tapped buttons read data-asked=true", JSON.stringify([...askedOf(p.afterTaps)].sort()) === JSON.stringify([...TAPS].sort()), JSON.stringify(askedOf(p.afterTaps)));
      check("H7 the page sent the two taps as trace actions with those topicTags, both acked", JSON.stringify((p.afterSpeech?.intents ?? []).map((i) => i.topicTag)) === JSON.stringify(TAPS) && (p.afterSpeech?.intents ?? []).every((i) => i.statuses.join() === "ack,ack,ack"), JSON.stringify(p.afterSpeech?.intents));
    }
    const ends = (trace.events ?? []).filter((e) => e.kind === "utterance-end");
    if (emulated) {
      check("H8 the persisted trace holds the tap tags in order, the unmatched typed opener to the nurse, then the spoken turn's tag (speech modality, matched)", JSON.stringify(ends.map((e) => e.tag)) === JSON.stringify([...expectedTaps, "utterance_unmatched", SPOKEN_TAG]) && ends.at(-1)?.modality === "speech", JSON.stringify(ends.map((e) => [e.tag, e.modality, e.match, e.confidence])));
      check("H9 the page's asked set equals the review's observed set (traceTagCoverage on the persisted trace, note tag excluded)", JSON.stringify([...new Set(expectedTags)].sort()) === JSON.stringify([...finalAsked].sort()) && JSON.stringify([...finalAsked].sort()) === JSON.stringify([...reviewObserved].sort()) && finalAsked.length === new Set(expectedTags).size, JSON.stringify({ finalAsked, reviewObserved }));
    } else {
      check("H8 the persisted trace holds the tap tags in order, then the spoken turn's tag (speech modality, matched)", JSON.stringify(ends.map((e) => e.tag)) === JSON.stringify([...TAPS, SPOKEN_TAG]) && ends.at(-1)?.modality === "speech", JSON.stringify(ends.map((e) => [e.tag, e.modality, e.match, e.confidence])));
      check("H9 the page's asked set equals the review's observed set (traceTagCoverage on the persisted trace, note tag excluded)", JSON.stringify([...finalAsked].sort()) === JSON.stringify([...reviewObserved].sort()) && finalAsked.length === TAPS.length + SPOKEN_TAGS.length, JSON.stringify({ finalAsked, reviewObserved }));
    }
    if (emulated) {
      const selectTags = (p.xr?.selectIntents ?? []).map((i) => i.topicTag);
      check("E1 isSessionSupported(\"immersive-vr\") true", p.xr?.supported === true, String(p.xr?.supported));
      check("E2 exactly 1 XR session entered and 0 ended after the turns", p.xr?.sessionCount === 1 && p.xr?.endedAfterTurns === 0, JSON.stringify({ sessionCount: p.xr?.sessionCount, endedAfterEnter: p.xr?.endedAfterEnter, endedAfterTurns: p.xr?.endedAfterTurns }));
      check("E3 the head pose read back differs from identity (orientation.y > 0.05)", (p.xr?.headPose?.y ?? 0) > 0.05, JSON.stringify(p.xr?.headPose));
      check("E4 the controller select produced at least one acked intent", selectTags.length >= 1 && (p.afterSpeech?.intents ?? []).some((i) => selectTags.includes(i.topicTag) && (i.statuses ?? []).join() === "ack,ack,ack"), JSON.stringify(selectTags));
      check("E5 the controller select tag is the shipped first required tag, differs from the spoken tag, and both are in finalAsked", JSON.stringify(selectTags) === JSON.stringify([SELECT_TAG]) && !SPOKEN_TAGS.includes(SELECT_TAG) && !SPOKEN_TAGS.some((t) => selectTags.includes(t)) && [...selectTags, ...SPOKEN_TAGS].every((t) => finalAsked.includes(t)), JSON.stringify({ selectTags, spoken: SPOKEN_TAGS, finalAsked }));
      check("E6 finalAsked holds exactly the select, DOM tap and spoken tags and matches the review observed set", finalAsked.length === 2 + SPOKEN_TAGS.length && JSON.stringify([...finalAsked].sort()) === JSON.stringify([...expectedTags].sort()) && JSON.stringify([...finalAsked].sort()) === JSON.stringify([...reviewObserved].sort()), JSON.stringify({ finalAsked, expectedTags, reviewObserved }));
    }
    const finalButtons = p.afterSpeech?.buttons ?? [];
    check("H12 after the turns each button shows the display form: asked buttons lead with a check mark and carry a background, unasked buttons neither", finalButtons.length === menuTags.length && finalButtons.every((b, i) => b.text === displayOf(menuTags[i], b.asked === "true") && (b.asked === "true" ? b.bg !== "" : b.bg === "")) && finalButtons.some((b) => b.asked === "true") && finalButtons.some((b) => b.asked !== "true"), JSON.stringify(finalButtons.map((b) => [b.text, b.bg])));
    const ownSource = await readFile(fileURLToPath(import.meta.url), "utf8");
    const literals = [...menuTags, ...bank.seeds.flatMap((s) => s.utterancePhrases ?? [])].filter((t) => t.length > 6);
    const copied = literals.filter((text) => ownSource.includes(`"${text}"`) || ownSource.includes(`'${text}'`));
    check("H10 the harness source holds none of the shipped tags or phrases (expected values come from the shipped bank)", copied.length === 0, copied.join(", "));
    // C38: the shell rounds null gamepad axes to 0, so no page error is tolerated in any mode; any page error or non-404 console error fails the run.
    run.emulatorArtifacts = emulated ? { toleratedPageErrors: 0, pageErrors: out.pageErrors.length } : undefined;
    const other = out.consoleErrors.filter((text) => !isAsset404(text));
    check("H11 no page errors and no console errors other than missing-asset 404s", out.pageErrors.length === 0 && other.length === 0, [...out.pageErrors, ...other].join(" | ") || `${out.consoleErrors.length} console errors tolerated (asset 404s)`);
    if (options.mode === "quest") {
      const lists = await collectQuestCleanupLists({ staticPort: staticServer.port, syncPort: new URL(pageUrl).searchParams.get("encounterSync").split(":").at(-1), serial: options.serial });
      run.adbReverseList = lists.adbReverseList;
      run.adbForwardList = lists.adbForwardList;
      check("Q1 adb reverse/forward lists hold neither run port nor tcp:9222", !lists.leaked, `reverse=${lists.adbReverseList} forward=${lists.adbForwardList}`);
    }
  } catch (error) {
    process.exitCode = 1;
    run.fatal = String(error?.stack ?? error).slice(0, 1600);
  } finally {
    await syncServer?.close().catch(() => undefined);
    closeSpeech();
    await staticServer?.close().catch(() => undefined);
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "report.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 300));
    if (run.fatal) console.log(`FATAL ${run.fatal.slice(0, 400)}`);
    console.log(`wrote ${join(outDir, "report.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
