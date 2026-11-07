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
async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const traceDir = await mkdtemp(join(tmpdir(), "xr-sync-c37-trace-"));
  const run = { mode: options.mode, serial: options.mode === "quest" ? options.serial : null, script: "c37", assertions: [], pageErrors: [], consoleErrors: [], notEvidenceFor: { soundHeardByPerson: true, clinicalValidity: true, phraseReadsWellAsLabel: true } };
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
    const expectedLabel = (tag) => answerSeed(tag)?.utterancePhrases[0] ?? tag;
    const patientSeed = bank.seeds.find((s) => s.seedId === "patient_onset_history");
    const patientId = patientSeed.actorId;
    const SPOKEN = patientSeed.utterancePhrases[0];
    const SPOKEN_TAG = patientSeed.expectedTraceTags.find((t) => menuTags.includes(t));
    const TAPS = menuTags.filter((t) => answerSeed(t) === undefined).slice(0, 1).concat(menuTags.filter((t) => answerSeed(t) !== undefined && t !== SPOKEN_TAG).slice(0, 1));
    run.expected = { menuTags, labels: Object.fromEntries(menuTags.map((t) => [t, expectedLabel(t)])), taps: TAPS, spoken: SPOKEN_TAG, patientId };

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
    const probeFn = (drive) => (options.mode === "host" ? runHostProbe({ pageUrl, outDir, drive, launchArgs, initScript }) : runQuestProbe({ pageUrl, outDir, serial: options.serial, drive, initScript }));
    const readMenu = (page) => page.evaluate(() => {
      const e = globalThis.__openClinXrEncounterSync;
      const buttons = [...document.querySelectorAll("#room-topics button")].map((b) => ({ id: b.id, text: b.textContent, asked: b.getAttribute("data-asked") }));
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
      let have = 0;
      for (const tag of TAPS) {
        await page.evaluate((id) => document.getElementById(id).click(), `topic-${tag}`);
        await page.waitForFunction((count) => globalThis.__openClinXrEncounterSync.turns.length >= count, have + 1, { timeout: 120000 });
        have += 1;
        await sleep(800);
      }
      probe.afterTaps = await readMenu(page);
      await shootPanel(page, join(outDir, "c37-menu-after-taps.png"));
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
    check("H2 one button per menu tag in scenario order, each labelled with the shipped seed phrase or the tag text", JSON.stringify((p.start?.buttons ?? []).map((b) => [b.id, b.text])) === JSON.stringify(menuTags.map((t) => [`topic-${t}`, expectedLabel(t)])), JSON.stringify((p.start?.buttons ?? []).map((b) => b.text)));
    check("H3 at least one button shows a seed phrase and one shows a tag, and a shipped label differs from the prettified tag", menuTags.some((t) => answerSeed(t) !== undefined) && menuTags.some((t) => answerSeed(t) === undefined) && menuTags.some((t) => expectedLabel(t) !== t.replaceAll("_", " ")), JSON.stringify(run.expected.labels));
    check("H4 every button starts data-asked=false", (p.start?.buttons ?? []).every((b) => b.asked === "false"), JSON.stringify((p.start?.buttons ?? []).map((b) => b.asked)));
    check("H5 the view was aimed at the patient before the taps", p.aimed === true, String(p.aimed));
    check("H6 after two taps exactly the tapped buttons read data-asked=true", JSON.stringify([...askedOf(p.afterTaps)].sort()) === JSON.stringify([...TAPS].sort()), JSON.stringify(askedOf(p.afterTaps)));
    check("H7 the page sent the two taps as trace actions with those topicTags, both acked", JSON.stringify((p.afterSpeech?.intents ?? []).map((i) => i.topicTag)) === JSON.stringify(TAPS) && (p.afterSpeech?.intents ?? []).every((i) => i.statuses.join() === "ack,ack,ack"), JSON.stringify(p.afterSpeech?.intents));
    const ends = (trace.events ?? []).filter((e) => e.kind === "utterance-end");
    check("H8 the persisted trace holds the tap tags in order, then the spoken turn's tag (speech modality, matched)", JSON.stringify(ends.map((e) => e.tag)) === JSON.stringify([...TAPS, SPOKEN_TAG]) && ends.at(-1)?.modality === "speech", JSON.stringify(ends.map((e) => [e.tag, e.modality, e.match, e.confidence])));
    check("H9 the page's asked set equals the review's observed set (traceTagCoverage on the persisted trace, note tag excluded)", JSON.stringify([...finalAsked].sort()) === JSON.stringify([...reviewObserved].sort()) && finalAsked.length === TAPS.length + 1, JSON.stringify({ finalAsked, reviewObserved }));
    const ownSource = await readFile(fileURLToPath(import.meta.url), "utf8");
    const literals = [...menuTags, ...bank.seeds.flatMap((s) => s.utterancePhrases ?? [])].filter((t) => t.length > 6);
    const copied = literals.filter((text) => ownSource.includes(`"${text}"`) || ownSource.includes(`'${text}'`));
    check("H10 the harness source holds none of the shipped tags or phrases (expected values come from the shipped bank)", copied.length === 0, copied.join(", "));
    const other = out.consoleErrors.filter((text) => !isAsset404(text));
    check("H11 no page errors and no console errors other than missing-asset 404s", out.pageErrors.length === 0 && other.length === 0, [...out.pageErrors, ...other].join(" | ") || `${out.consoleErrors.length} asset 404s`);
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
