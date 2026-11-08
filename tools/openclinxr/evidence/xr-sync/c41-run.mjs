#!/usr/bin/env node
/**
 * C41 host/emulated harness: the synced shell submits the learner's patient note in the note phase and the panel shows it accepted.
 * Boots an in-process server (shipped scenario, trace dir), serves apps/ui-xr/dist, joins through ?encounterSync=, and drives the shell's
 * #patient-note-text and the panel's "Submit note" control across the encounter and note phases.
 * Counterweights: (a) encounter-phase submit refused, (b) note text never in the trace, (c) second submit wins, (d) empty note refused,
 * (e) review observedTraceTags holds patient_note_submitted only after an accepted submit.
 *
 * Host:     node c41-run.mjs --mode host --out <dir>
 * Emulated: node c41-run.mjs --mode emulated --out <dir>   (IWER Quest 3 injected by the harness)
 * Writes <dir>/report.json, note-before-submit.png, note-after-submit.png. Exit 1 on any failed assertion.
 */
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkStills, collectQuestCleanupLists, listTraceFiles, parseArgs, runHostProbe, runQuestProbe, shootPanel as shootPanelLib, startStaticServer } from "./harness-lib.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const SERVER_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/index.js");
const COVERAGE_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/trace-tag-coverage.js");
const FIXTURES_DIST = join(ROOT, "packages/openclinxr/scenario-fixtures/dist/index.js");
const APP_DIST = join(ROOT, "apps/ui-xr/dist");
const IWER_BUNDLE = join(ROOT, "apps/arena/ui-xr-iwsdk-spike/node_modules/iwer/build/iwer.min.js");
const TIMING = { doorwaySeconds: 1, encounterSeconds: 150, noteSeconds: 150, breakAfterStationOrders: [] };
const JOIN_TIMEOUT_MS = 240000;
const NOTE_TAG = "patient_note_submitted";
const NOTE_A = "Chest pressure began two hours ago and spreads to the left arm.";
const NOTE_B = "Likely acute coronary syndrome, ECG and troponin ordered now.";
const STILL_NAMES = ["note-before-submit.png", "note-after-submit.png"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = {};
// A failed capture throws (fails the run); each capture records the #room-panel box width read in the same call.
async function shootPanel(page, path) {
  shots[basename(path)] = await shootPanelLib(page, path);
}

// A direct intent can time out (5 s client deadline) while the machine is loaded; a thrown timeout is retried, a server reply never is.
async function directSend(page, text) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate((value) => globalThis.__openClinXrEncounterSync.sendIntent("note-submit", { text: value }).then((r) => JSON.parse(JSON.stringify(r))), text);
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  return null;
}

const blueprint = {
  blueprintId: "bp-evidence-c41",
  title: "C41 patient note submit",
  stationSlots: [{ slotId: "slot-a", order: 1, label: "C41 chest", requiredEnvironmentIds: [], requiredTraceTags: [] }],
  timing: TIMING,
  requiredTraceTags: [],
  requiredSafetyCriticalTraceTags: [],
};

function iwerGlue() {
  const device = new IWER.XRDevice(IWER.metaQuest3);
  device.installRuntime({ forceInstall: true });
  globalThis.__c41Xr = { device, sessions: [], ended: 0 };
  const xr = navigator.xr;
  const originalRequestSession = xr.requestSession.bind(xr);
  xr.requestSession = async function requestSession(...args) {
    const session = await originalRequestSession(...args);
    globalThis.__c41Xr.sessions.push(session);
    session.addEventListener("end", () => {
      globalThis.__c41Xr.ended += 1;
    });
    return session;
  };
}

// Counts outbound websocket frames that carry the note-submit intent name (binary frames are scanned as latin1).
function frameCounter() {
  globalThis.__c41NoteFrames = 0;
  const original = WebSocket.prototype.send;
  WebSocket.prototype.send = function send(data) {
    try {
      const bytes = typeof data === "string" ? data : new TextDecoder("latin1").decode(ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data));
      if (bytes.includes("note-submit")) globalThis.__c41NoteFrames += 1;
    } catch { /* counting only */ }
    return original.call(this, data);
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
  const traceDir = await mkdtemp(join(tmpdir(), "xr-sync-c41-trace-"));
  const run = { mode: emulated ? "emulated" : options.mode, serial: options.mode === "quest" ? options.serial : null, script: "c41", assertions: [], pageErrors: [], consoleErrors: [], notEvidenceFor: { realQuestKeyboardEntry: true, noteScoring: true, clinicalValidity: true } };
  const check = (name, pass, detail = "") => {
    run.assertions.push({ name, pass: Boolean(pass), detail: String(detail) });
    if (!pass) process.exitCode = 1;
  };
  const startedMs = Date.now();
  let syncServer = null;
  let staticServer = null;
  const isAsset404 = (text) => /Failed to load resource.*404/iu.test(text);
  try {
    if (options.mode === "quest") throw new Error("c41 has no Quest mode; use --mode host or --mode emulated");
    const { createEncounterServer } = await import(SERVER_DIST);
    const { traceTagCoverage } = await import(COVERAGE_DIST);
    const { edChestPainScenario, scenarioDialogueSeedBank } = await import(FIXTURES_DIST);
    const scenario = { ...edChestPainScenario, status: "approved", eventSchedule: edChestPainScenario.eventSchedule.map((slot) => ({ ...slot, atSecond: TIMING.encounterSeconds })) };
    syncServer = await createEncounterServer({ examBlueprint: blueprint, scenarios: [scenario], dialogueSeeds: scenarioDialogueSeedBank, traceDir });
    staticServer = await startStaticServer(APP_DIST);
    const pageUrl = `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({ encounterSync: syncServer.url })}`;
    run.pageUrl = pageUrl;
    const iwerBundleText = emulated ? await readFile(IWER_BUNDLE, "utf8") : null;
    const counterText = `(${frameCounter.toString()})();`;
    const initScript = { content: emulated ? `${iwerBundleText};(${iwerGlue.toString()})();globalThis.__c41Errors=[];addEventListener("error",(event)=>{globalThis.__c41Errors.push(String((event.error&&event.error.stack)||event.message));});${counterText}` : counterText };
    const probeFn = (drive) => runHostProbe({ pageUrl, outDir, drive, launchArgs: [], initScript });
    const serverState = () => JSON.parse(syncServer.getStateJSON());
    const serverPhase = () => serverState().phase;
    const serverNote = () => ({ status: serverState().noteStatus, chars: serverState().noteChars });
    const readNote = (page) => page.evaluate(() => {
      const submit = document.getElementById("room-note-submit");
      return { present: submit !== null, hidden: submit?.hidden ?? null, disabled: submit?.disabled ?? null, label: submit?.textContent ?? null, status: document.getElementById("room-note-status")?.textContent ?? null, refusal: document.getElementById("room-refusal")?.textContent ?? null, phaseLine: document.getElementById("room-countdown")?.textContent ?? null };
    });
    const setNoteText = (page, text) => page.evaluate((value) => { const area = document.getElementById("patient-note-text"); area.value = value; area.dispatchEvent(new Event("input", { bubbles: true })); }, text);
    const noteFrames = (page) => page.evaluate(() => globalThis.__c41NoteFrames);
    const clickSubmit = (page) => page.evaluate(() => document.getElementById("room-note-submit").click());
    const waitNote = (page, predicate, arg, timeout = 30000) => page.waitForFunction(predicate, arg, { timeout });
    const drive = async (page) => {
      await page.waitForFunction(() => { const e = globalThis.__openClinXrEncounterSync; return e !== undefined && e.state !== "joining"; }, undefined, { timeout: JOIN_TIMEOUT_MS });
      const probe = { xr: null };
      run.probe = probe;
      await page.locator("#room-panel").waitFor({ timeout: 60000 });
      while (serverPhase() !== "encounter") await sleep(200);
      if (emulated) {
        const supported = await page.evaluate(() => navigator.xr.isSessionSupported("immersive-vr"));
        await page.waitForFunction(() => { const button = document.getElementById("enter-xr-button"); return button !== null && !button.disabled; }, undefined, { timeout: 60000 });
        await page.click("#enter-xr-button");
        await page.waitForFunction(() => globalThis.__c41Xr.sessions.length === 1 && document.getElementById("enter-xr-button").textContent === "Exit Full VR", undefined, { timeout: 60000 });
        probe.xr = { supported, sessionCount: await page.evaluate(() => globalThis.__c41Xr.sessions.length) };
      }
      // Encounter phase: the control is withheld, a forced click sends nothing, and the server refuses a direct submit.
      await setNoteText(page, NOTE_A);
      probe.encounter = await readNote(page);
      probe.encounter.phase = serverPhase();
      await clickSubmit(page);
      await sleep(1500);
      probe.encounterAfterClick = await readNote(page);
      probe.encounterAfterClick.server = serverNote();
      probe.framesAfterForcedClick = await noteFrames(page);
      probe.encounterDirect = await directSend(page, NOTE_A);
      await sleep(1500);
      probe.framesAfterDirect = await noteFrames(page);
      probe.encounterAfterDirect = await readNote(page);
      probe.encounterAfterDirect.server = serverNote();
      probe.encounterAfterDirect.phase = serverPhase();
      // Note phase.
      while (serverPhase() !== "note") await sleep(250);
      await waitNote(page, () => { const b = document.getElementById("room-note-submit"); return b !== null && b.hidden === false && b.disabled === false; });
      await setNoteText(page, NOTE_A);
      probe.noteBefore = await readNote(page);
      probe.noteBefore.server = serverNote();
      await shootPanel(page, join(outDir, "note-before-submit.png"));
      await clickSubmit(page);
      await waitNote(page, () => /^Note accepted, \d+ characters$/u.test(document.getElementById("room-note-status").textContent));
      await sleep(500);
      probe.firstAccepted = await readNote(page);
      probe.firstAccepted.server = serverNote();
      probe.firstAccepted.shellText = await page.evaluate(() => document.getElementById("patient-note-text").value.length);
      await shootPanel(page, join(outDir, "note-after-submit.png"));
      // (c) the second in-phase submit replaces the first.
      await setNoteText(page, NOTE_B);
      await clickSubmit(page);
      await waitNote(page, (n) => document.getElementById("room-note-status").textContent === `Note accepted, ${n} characters`, NOTE_B.length).catch(() => undefined);
      probe.secondAccepted = await readNote(page);
      probe.secondAccepted.server = serverNote();
      // (d) an empty note is refused by the server and leaves the accepted state unchanged.
      // The click goes first, alone: it must put one note-submit frame on the wire and the refusal on screen without help from a direct send.
      await setNoteText(page, "");
      probe.framesBeforeEmptyClick = await noteFrames(page);
      probe.refusalBeforeEmptyClick = (await readNote(page)).refusal;
      await clickSubmit(page);
      await waitNote(page, () => document.getElementById("room-refusal").textContent === "Not accepted: invalid-note").catch(() => undefined);
      probe.emptyClick = await readNote(page);
      probe.emptyClick.server = serverNote();
      probe.framesAfterEmptyClick = await noteFrames(page);
      probe.emptyDirect = await directSend(page, "");
      probe.phaseAtEnd = serverPhase();
      if (emulated) {
        probe.xr.ended = await page.evaluate(() => globalThis.__c41Xr.ended);
        probe.xr.sessionActive = await page.evaluate(() => globalThis.__c41Xr.sessions.length === 1 && globalThis.__c41Xr.ended === 0);
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
    const traceFiles = await listTraceFiles(traceDir);
    check("T1 exactly 1 conversation-trace file persisted before it is read", traceFiles.length === 1, traceFiles.join(","));
    const trace = traceFiles.length === 1 ? JSON.parse(await readFile(join(traceDir, traceFiles[0]), "utf8")) : { events: [] };
    const traceText = JSON.stringify(trace);
    const coverage = traceTagCoverage(trace, scenario);
    const strippedCoverage = traceTagCoverage({ ...trace, events: (trace.events ?? []).filter((e) => e.kind !== "note-submitted") }, scenario);
    run.observedTraceTags = coverage.observedTraceTags;

    check("N1 the shell joined the room and mounted the panel", p.encounter?.present === true, JSON.stringify(p.encounter));
    check("N2 encounter phase: the Submit note control is hidden and disabled", p.encounter?.phase === "encounter" && p.encounter?.hidden === true && p.encounter?.disabled === true && p.encounter?.status === "", JSON.stringify(p.encounter));
    check("N3 counterweight (a): a forced click in the encounter phase sends nothing (0 note-submit frames on the wire, no refusal shown, noteStatus none)", p.framesAfterForcedClick === 0 && p.encounterAfterClick?.refusal === "" && p.encounterAfterClick?.status === "" && p.encounterAfterClick?.server?.status === "none", JSON.stringify(p.encounterAfterClick));
    check("N4 counterweight (a): a direct note-submit in the encounter phase is rejected outside-note-phase by the server (the frame counter reads 1, so it can see a send); noteStatus stays none and the panel shows no accepted line", p.encounterDirect?.status === "reject" && p.encounterDirect?.reason === "outside-note-phase" && p.framesAfterDirect === 1 && p.encounterAfterDirect?.server?.status === "none" && p.encounterAfterDirect?.status === "" && p.encounterAfterDirect?.phase === "encounter", JSON.stringify({ direct: p.encounterDirect, after: p.encounterAfterDirect }));
    check("N5 note phase: the control is visible, enabled and labelled Submit note, with no accepted line before the submit", p.noteBefore?.hidden === false && p.noteBefore?.disabled === false && p.noteBefore?.label === "Submit note" && p.noteBefore?.status === "" && p.noteBefore?.server?.status === "none", JSON.stringify(p.noteBefore));
    check("N6 after one submit the panel reads Note accepted, N characters with N == the server noteChars == the first note length", p.firstAccepted?.status === `Note accepted, ${NOTE_A.length} characters` && p.firstAccepted?.server?.status === "submitted" && p.firstAccepted?.server?.chars === NOTE_A.length, JSON.stringify(p.firstAccepted));
    check("N7 counterweight (c): the second in-phase submit replaces the first (noteChars and panel N == the second length)", NOTE_B.length !== NOTE_A.length && p.secondAccepted?.status === `Note accepted, ${NOTE_B.length} characters` && p.secondAccepted?.server?.chars === NOTE_B.length, JSON.stringify(p.secondAccepted));
    check("N8 counterweight (d): an empty note is refused invalid-note by the server reply and by the panel click, and the accepted state is unchanged", p.emptyDirect?.status === "reject" && p.emptyDirect?.reason === "invalid-note" && p.refusalBeforeEmptyClick !== "Not accepted: invalid-note" && p.framesAfterEmptyClick === p.framesBeforeEmptyClick + 1 && p.emptyClick?.refusal === "Not accepted: invalid-note" && p.emptyClick?.status === `Note accepted, ${NOTE_B.length} characters` && p.emptyClick?.server?.chars === NOTE_B.length && p.phaseAtEnd === "note", JSON.stringify({ direct: p.emptyDirect, click: p.emptyClick }));
    const noteEvents = (trace.events ?? []).filter((e) => e.kind === "note-submitted");
    check("N9 counterweight (c): the trace holds exactly 2 note-submitted events with those chars in order", JSON.stringify(noteEvents.map((e) => e.chars)) === JSON.stringify([NOTE_A.length, NOTE_B.length]), JSON.stringify(noteEvents));
    const leaked = [];
    for (const text of [NOTE_A, NOTE_B]) for (let i = 0; i + 12 <= text.length; i += 1) if (traceText.includes(text.slice(i, i + 12))) leaked.push(text.slice(i, i + 12));
    check("N10 counterweight (b): no trace event holds a 12-character substring of either submitted note", leaked.length === 0 && traceText.length > 0, leaked.slice(0, 3).join(" | "));
    check("N11 counterweight (e): the review observedTraceTags holds patient_note_submitted after the accepted submit, and not once the note-submitted events are removed", coverage.observedTraceTags.includes(NOTE_TAG) && !strippedCoverage.observedTraceTags.includes(NOTE_TAG), JSON.stringify({ observed: coverage.observedTraceTags, stripped: strippedCoverage.observedTraceTags }));
    if (emulated) check("E1 one XR session entered and none ended; isSessionSupported true", p.xr?.supported === true && p.xr?.sessionCount === 1 && p.xr?.sessionActive === true, JSON.stringify(p.xr));
    const stillCheck = await checkStills(STILL_NAMES, shots);
    run.stills = stillCheck.rows;
    check("S1 every named still exists, is > 0 bytes and is as wide as the #room-panel box read in the same run", stillCheck.pass, JSON.stringify(stillCheck.rows.map((r) => [r.name, r.bytes, r.width, r.boxWidth, r.why])));
    const other = out.consoleErrors.filter((text) => !isAsset404(text));
    check("H11 no page errors and no console errors other than missing-asset 404s", out.pageErrors.length === 0 && other.length === 0, [...out.pageErrors, ...other].join(" | ") || `${out.consoleErrors.length} console errors tolerated (asset 404s)`);
  } catch (error) {
    process.exitCode = 1;
    run.fatal = String(error?.stack ?? error).slice(0, 1600);
  } finally {
    await syncServer?.close().catch(() => undefined);
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
