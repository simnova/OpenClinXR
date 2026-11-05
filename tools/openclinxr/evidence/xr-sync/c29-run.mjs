#!/usr/bin/env node
/**
 * C29 host/Quest harness: recorded audio fixtures are recognized by a local open-source recognizer
 * (faster-whisper, stt/transcribe.py), the shell (apps/ui-xr) sends the recognized text + confidence through
 * xr-sync-client, and the room answers through the same server matcher as typed text.
 *
 * Host:  node c29-run.mjs --mode host --out <dir>
 * Quest: node c29-run.mjs --mode quest --serial <serial> --out <dir>
 *
 * Audio fixtures are generated at run time (macOS `say` -> 16 kHz mono wav; one is mixed with white noise to
 * lower the recognizer's confidence). Recognition runs on the host Mac, not on the headset: the Quest page
 * has no microphone capture in this slice. Flow: ed-chest one-slot cast with the SHIPPED seed bank ->
 * (1) speech "hello" (opening) (2) clear speech "when did the chest pressure start" (authored onset answer)
 * (3) the same sentence with noise (confidence under the authored threshold: fallback + speech_low_confidence)
 * (4) typed text (modality typed). Replay of the persisted trace must give the server's replyIds with zero
 * further recognizer calls. Exit 1 on any failed assertion.
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
const FIXTURES_DIST = join(ROOT, "packages/openclinxr/scenario-fixtures/dist/index.js");
const APP_DIST = join(ROOT, "apps/ui-xr/dist");
const STT_PYTHON = process.env.OPENCLINXR_STT_PYTHON ?? "/Volumes/files/openclinxr-assets/stt/venv/bin/python";
const STT_MODEL = process.env.OPENCLINXR_STT_MODEL ?? "base.en";
const TIMING = { doorwaySeconds: 1, encounterSeconds: 300, noteSeconds: 1, breakAfterStationOrders: [] };
const JOIN_TIMEOUT_MS = 240000;
const C3_IDS = ["c3-ack-open", "c3-ack-onset", "c3-ack-recap"];

const blueprint = {
  blueprintId: "bp-evidence-c29",
  title: "C29 speech intake",
  stationSlots: [{ slotId: "slot-a", order: 1, label: "C29 chest", requiredEnvironmentIds: [], requiredTraceTags: [] }],
  timing: TIMING,
  requiredTraceTags: [],
  requiredSafetyCriticalTraceTags: [],
};
const SPOKEN = { hello: "Hello, I am the student doctor.", onset: "When did the chest pressure start?" };
const TYPED = "What is your favourite colour?";

async function makeFixtures(dir) {
  await mkdir(dir, { recursive: true });
  const wav = async (name, sentence) => {
    await run_("say", ["-v", "Samantha", "-o", join(dir, `${name}.aiff`), sentence]);
    await run_("ffmpeg", ["-loglevel", "error", "-y", "-i", join(dir, `${name}.aiff`), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", join(dir, `${name}.wav`)]);
  };
  await wav("hello", SPOKEN.hello);
  await wav("onset", SPOKEN.onset);
  await run_("ffmpeg", ["-loglevel", "error", "-y", "-i", join(dir, "onset.wav"), "-f", "lavfi", "-i", "anoisesrc=color=white:amplitude=0.5:sample_rate=16000:duration=10", "-filter_complex", "[0:a]volume=0.5[a];[1:a][a]amix=inputs=2:duration=first:weights='0.5 1'", "-t", "3", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", join(dir, "noisy.wav")]);
}
let recognizerCalls = 0;
async function recognize(path) {
  recognizerCalls += 1;
  const { stdout } = await run_(STT_PYTHON, [join(HERE, "stt", "transcribe.py"), path, STT_MODEL], { maxBuffer: 1 << 20 });
  return JSON.parse(stdout.trim().split("\n").at(-1));
}

async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const traceDir = await mkdtemp(join(tmpdir(), "xr-sync-c29-trace-"));
  const run = { mode: options.mode, serial: options.mode === "quest" ? options.serial : null, script: "c29", recognizer: { engine: "faster-whisper", model: STT_MODEL }, assertions: [], probe: null, pageErrors: [], consoleErrors: [], notEvidenceFor: { questReadiness: true, clinicalValidity: true, examEquivalence: true, headsetMicrophoneCapture: true } };
  const check = (name, pass, detail = "") => {
    run.assertions.push({ name, pass: Boolean(pass), detail: String(detail) });
    if (!pass) process.exitCode = 1;
  };
  let syncServer = null;
  let staticServer = null;
  const startedMs = Date.now();
  try {
    const audioDir = join(outDir, "audio");
    await makeFixtures(audioDir);
    const heard = {};
    for (const name of ["hello", "onset", "noisy"]) heard[name] = await recognize(join(audioDir, `${name}.wav`));
    run.heard = heard;
    const callsAfterRecognition = recognizerCalls;
    const { createEncounterServer, replayConversationTrace } = await import(SERVER_DIST);    const { edChestPainScenario, scenarioDialogueSeedBank: shippedSeedBank } = await import(FIXTURES_DIST);
    const shippedEntry = shippedSeedBank.find((entry) => entry.scenarioId === edChestPainScenario.scenarioId);
    const shippedSeed = shippedEntry.seeds.find((seed) => seed.seedId === "patient_onset_history");
    const SHIPPED_LINE = shippedSeed.caption ?? shippedSeed.spokenText;
    const SHIPPED_FALLBACK = shippedEntry.utteranceFallback.line;
    const THRESHOLD = shippedEntry.utteranceFallback.minSpeechConfidence;
    const scenario = { ...edChestPainScenario, status: "approved", eventSchedule: edChestPainScenario.eventSchedule.map((slot) => ({ ...slot, atSecond: TIMING.encounterSeconds })) };
    const actor = scenario.actors.find((entry) => entry.actorId === shippedSeed.actorId);
    const name = actor.displayName;
    const expected = {
      actorId: actor.actorId,
      replyIds: [`${actor.actorId}:opening`, `${actor.actorId}:seed:patient_onset_history`, C3_IDS[2], C3_IDS[0]],
      captions: [`${name}: ${actor.openingUtterance ?? ""}`, `${name}: ${SHIPPED_LINE}`, `${name}: ${SHIPPED_FALLBACK}`, `${name}: ${SHIPPED_FALLBACK}`],
      tags: [heard.hello.confidence < THRESHOLD ? "speech_low_confidence" : "utterance_unmatched", "history_opqrst", "speech_low_confidence", "utterance_unmatched"],
      modalities: ["speech", "speech", "speech", "typed"],
    };
    run.expected = expected;
    run.threshold = THRESHOLD;
    syncServer = await createEncounterServer({ examBlueprint: blueprint, scenarios: [scenario], dialogueSeeds: shippedSeedBank, traceDir });
    staticServer = await startStaticServer(APP_DIST);
    run.pageUrl = `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({ encounterSync: syncServer.url })}`;

    const serverActorSpeaking = () => JSON.parse(syncServer.getStateJSON()).actors?.[actor.actorId]?.speaking === true;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const drive = async (page) => {
      await page.waitForFunction(() => { const e = globalThis.__openClinXrEncounterSync; return e !== undefined && e.state !== "joining"; }, undefined, { timeout: JOIN_TIMEOUT_MS });
      const readShell = () => page.evaluate(() => {
        const e = globalThis.__openClinXrEncounterSync;
        return {
          state: e.state, error: e.error, sessionId: e.sessionId, turns: e.turns, utterances: e.utterances ?? [], speechUtterances: e.speechUtterances ?? [],
          learnerCaption: document.getElementById("learner-caption")?.textContent ?? null,
          dialogue: document.getElementById("dialogue-line")?.textContent ?? null,
        };
      });
      const probe = { afterTurn: [], evidenceText: "" };
      const joined = await readShell();
      if (joined.state !== "joined") return { ...probe, final: joined };
      await page.locator("#utterance-input").waitFor({ timeout: 60000 });
      const heardSeq = [heard.hello, heard.onset, heard.noisy];
      for (const [index, result] of heardSeq.entries()) {
        const endBy = Date.now() + 30000;
        while (serverActorSpeaking() && Date.now() < endBy) await sleep(100);
        await page.evaluate(({ actorId, text, confidence }) => globalThis.__openClinXrEncounterSync.sendSpeech(actorId, text, confidence), { actorId: actor.actorId, text: result.text, confidence: result.confidence });
        await page.waitForFunction((count) => globalThis.__openClinXrEncounterSync.turns.length >= count, index + 1, { timeout: 60000 });
        await sleep(500);
        probe.afterTurn.push(await readShell());
      }
      const endBy = Date.now() + 30000;
      while (serverActorSpeaking() && Date.now() < endBy) await sleep(100);
      await page.locator("#utterance-input").fill(TYPED);
      await page.evaluate(({ target }) => {
        const camera = globalThis.__openClinXrGazeCamera;
        const gaze = globalThis.__openClinXrEncounterSync.gazedActorId;
        if (!camera || !gaze) return;
        const eye = camera.getWorldPosition(camera.position.clone());
        for (let degrees = 0; degrees < 360; degrees += 5) {
          const radians = (degrees * Math.PI) / 180;
          camera.lookAt(eye.x + Math.sin(radians), eye.y, eye.z - Math.cos(radians));
          camera.updateMatrixWorld(true);
          if (gaze() === target) return;
        }
      }, { target: actor.actorId });
      await page.locator("#utterance-send").evaluate((el) => el.click());
      await page.waitForFunction(() => globalThis.__openClinXrEncounterSync.turns.length >= 4, undefined, { timeout: 60000 });
      await sleep(500);
      probe.afterTurn.push(await readShell());
      probe.evidenceText = await page.evaluate(() => JSON.stringify({ utterances: globalThis.__openClinXrEncounterSync.utterances, speechUtterances: globalThis.__openClinXrEncounterSync.speechUtterances }));
      probe.final = await readShell();
      return probe;
    };

    const outcome = options.mode === "host" ? await runHostProbe({ pageUrl: run.pageUrl, outDir, drive }) : await runQuestProbe({ pageUrl: run.pageUrl, outDir, serial: options.serial, drive });
    run.probe = outcome.probe;
    run.pageErrors = outcome.pageErrors;
    run.consoleErrors = outcome.consoleErrors;
    run.browserProduct = outcome.browserProduct;
    const probe = outcome.probe;
    const final = probe.final;
    const turns = (final?.turns ?? []).slice(0, 4);
    check("S1 shell joined the room (state joined, session id set)", final?.state === "joined" && final.sessionId !== "", JSON.stringify({ state: final?.state, error: final?.error }));
    check("S2 the local recognizer heard all three audio fixtures: non-empty text, confidence in [0,1], clear speech at or above the authored threshold, noisy speech below it", ["hello", "onset", "noisy"].every((key) => heard[key].text.length > 0 && heard[key].confidence >= 0 && heard[key].confidence <= 1) && heard.onset.confidence >= THRESHOLD && heard.noisy.confidence < THRESHOLD, JSON.stringify({ threshold: THRESHOLD, heard }));
    check("S3 four server turns reached the shell: opening, authored onset answer, C3 row for the low-confidence speech, C3 row for the typed text", JSON.stringify(turns.map((t) => t.replyId)) === JSON.stringify(expected.replyIds) && turns.every((t) => t.actorId === expected.actorId), JSON.stringify(turns.map((t) => [t.actorId, t.replyId])));
    check("S4 plan caption equals server caption equals expected (opening, authored line, authored fallback x2)", JSON.stringify(turns.map((t) => t.planCaption)) === JSON.stringify(expected.captions) && turns.every((t) => t.caption === t.planCaption), JSON.stringify(turns.map((t) => t.planCaption)));
    const expectedLearner = [heard.hello, heard.onset, heard.noisy].map((r) => `You said (${r.confidence.toFixed(2)}): ${r.text.trim()}`);
    check("S5 the learner caption shows the recognized text with its confidence after each speech turn, and the typed text without one", probe.afterTurn?.length === 4 && JSON.stringify(probe.afterTurn.slice(0, 3).map((s) => s.learnerCaption)) === JSON.stringify(expectedLearner) && probe.afterTurn[3].learnerCaption === `You said: ${TYPED}`, JSON.stringify(probe.afterTurn?.map((s) => s.learnerCaption)));
    check("S6 the shell dialogue line shows each actor caption after its turn", probe.afterTurn?.length === 4 && probe.afterTurn.every((s, i) => s.dialogue === expected.captions[i]), JSON.stringify(probe.afterTurn?.map((s) => s.dialogue)));
    const speechEntries = final?.speechUtterances ?? [];
    const heardSeq = [heard.hello, heard.onset, heard.noisy];
    check("S7 speech evidence: three entries, intents acked, lengths and confidences match, no recognized text on the evidence", speechEntries.length === 3 && speechEntries.every((entry, i) => entry.actorId === expected.actorId && entry.statuses.join() === "ack,ack,ack" && entry.chars === heardSeq[i].text.trim().length && entry.confidence === heardSeq[i].confidence) && heardSeq.every((r) => !probe.evidenceText.includes(r.text.trim())) && !probe.evidenceText.includes(TYPED), JSON.stringify(speechEntries));
    const serverTurns = (syncServer.getProbeStats().turns ?? []).map((t) => t.replyId).slice(0, 4);
    check("S8 the server turn log equals the replyIds the shell played and the expected replyIds", JSON.stringify(serverTurns) === JSON.stringify(turns.map((t) => t.replyId)) && JSON.stringify(serverTurns) === JSON.stringify(expected.replyIds), JSON.stringify(serverTurns));
    const isAsset404 = (text) => /Failed to load resource.*404/iu.test(text);
    const otherConsoleErrors = outcome.consoleErrors.filter((text) => !isAsset404(text));
    run.assetNotFoundConsoleErrors = outcome.consoleErrors.length - otherConsoleErrors.length;
    check("S9 no page errors and no console errors other than missing-asset 404s", outcome.pageErrors.length === 0 && otherConsoleErrors.length === 0, [...outcome.pageErrors, ...otherConsoleErrors].join(" | ") || `${run.assetNotFoundConsoleErrors} asset 404s`);
    const chunkNames = (await readdir(join(APP_DIST, "assets"))).filter((n) => n.endsWith(".js"));
    const hits = [];
    for (const chunk of chunkNames) {
      const code = await readFile(join(APP_DIST, "assets", chunk), "utf8");
      for (const marker of ["@openclinxr/xr-sync-server", "@colyseus/core", "faster-whisper"]) if (code.includes(marker)) hits.push(`${chunk} contains ${marker.slice(0, 40)}`);
    }
    check("S10 no built chunk carries the server package, @colyseus/core or the recognizer", chunkNames.length > 0 && hits.length === 0, hits.join(" | ") || `${chunkNames.length} chunks`);
    const ownSource = await readFile(fileURLToPath(import.meta.url), "utf8");
    const overlayHits = [new RegExp("utterance" + "Phrases\\s*:"), new RegExp("utterance" + "Fallback\\s*:"), new RegExp("minSpeech" + "Confidence\\s*:")].filter((pattern) => pattern.test(ownSource)).map(String);
    check("S11 overlay absent: the server was handed the shipped seed bank, which authors a threshold in (0,1) and a fallback; the harness source authors none", typeof THRESHOLD === "number" && THRESHOLD > 0 && THRESHOLD < 1 && SHIPPED_FALLBACK.length > 0 && overlayHits.length === 0, JSON.stringify({ THRESHOLD, overlayHits }));
    await syncServer.close();
    syncServer = null;
    let traceFiles = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      traceFiles = (await readdir(traceDir)).filter((n) => n.endsWith(".conversation-trace.json"));
      if (traceFiles.length > 0) break;
      await sleep(200);
    }
    const raws = await Promise.all((await readdir(traceDir)).map((n) => readFile(join(traceDir, n), "utf8")));
    const trace = traceFiles.length > 0 ? JSON.parse(await readFile(join(traceDir, traceFiles[0]), "utf8")) : { events: [] };
    const ends = (trace.events ?? []).filter((event) => event.kind === "utterance-end");
    const round2 = (v) => Math.round(v * 100) / 100;
    const expectedConfidence = [round2(heard.hello.confidence), round2(heard.onset.confidence), round2(heard.noisy.confidence), undefined];
    check("S12 the persisted trace holds tag, modality and confidence (2 dp, speech only) per learner turn; low confidence carries speech_low_confidence", JSON.stringify(ends.slice(0, 4).map((e) => [e.tag, e.modality, e.confidence])) === JSON.stringify(expected.tags.map((tag, i) => [tag, expected.modalities[i], expectedConfidence[i]])), JSON.stringify(ends.map((e) => [e.tag, e.match, e.modality, e.confidence])));
    const forbidden = [heard.hello.text, heard.onset.text, heard.noisy.text, TYPED, ...(shippedSeed.utterancePhrases ?? []), SHIPPED_LINE, SHIPPED_FALLBACK].map((t) => t.trim()).filter((t) => t.length > 3);
    const leaks = forbidden.filter((text) => raws.some((raw) => raw.toLowerCase().includes(text.toLowerCase())));
    check("S13 the persisted trace holds none of the recognized text, typed text, phrases or authored lines", leaks.length === 0, JSON.stringify(leaks));
    const replayed = replayConversationTrace(trace);
    check("S14 replay of the persisted trace gives the server's replyIds with zero further recognizer calls", JSON.stringify(replayed.turns.slice(0, 4).map((t) => t.replyId)) === JSON.stringify(expected.replyIds) && recognizerCalls === callsAfterRecognition, JSON.stringify({ replay: replayed.turns.map((t) => t.replyId), recognizerCalls, callsAfterRecognition }));
    if (options.mode === "quest") {
      const lists = await collectQuestCleanupLists({ staticPort: staticServer.port, syncPort: new URL(run.pageUrl).searchParams.get("encounterSync").split(":").at(-1), serial: options.serial });
      run.adbReverseList = lists.adbReverseList;
      run.adbForwardList = lists.adbForwardList;
      check("S15 adb reverse/forward lists hold neither run port nor tcp:9222", !lists.leaked, `reverse=${lists.adbReverseList} forward=${lists.adbForwardList}`);
    }
  } catch (error) {
    process.exitCode = 1;
    run.fatal = String(error?.stack ?? error).slice(0, 1600);
  } finally {
    await syncServer?.close().catch(() => undefined);
    await staticServer?.close().catch(() => undefined);
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c29-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 300));
    if (run.fatal) console.log(`FATAL ${run.fatal.slice(0, 400)}`);
    console.log(`wrote ${join(outDir, "c29-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
