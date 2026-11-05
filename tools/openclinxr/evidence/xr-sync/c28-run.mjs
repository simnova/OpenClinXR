#!/usr/bin/env node
/**
 * C28 host/Quest harness: a learner's typed free text, sent by the production shell (apps/ui-xr)
 * through xr-sync-client, becomes the scenario-authored topic answer (deterministic phrase match, no LLM).
 *
 * Host:  node c28-run.mjs --mode host --out <dir>
 * Quest: node c28-run.mjs --mode quest --serial <serial> --out <dir>
 *
 * C28: the server boots with the SHIPPED scenarioDialogueSeedBank object itself (no overlay of phrases, lines, affect or
 * fallback); the typed box addresses the gazed / last-speaking actor and Enter submits.
 * Flow: createEncounterServer with a one-slot ed-chest-pain cast, shipped seed bank -> serve the built shell (apps/ui-xr/dist, `vite build` first) ->
 * open /?encounterSync=<ws url> -> the harness TYPES three texts into #utterance-input and clicks #utterance-send:
 * (1) unmatched text -> the actor's opening; (2) text containing an authored phrase -> the onset seed answer with its
 * authored affect; (3) unmatched text -> the authored fallback caption. Read back the shell (evidence, #dialogue-line,
 * __openClinXrHumanoidSpeechEvidence), the server turn log and the persisted trace. Exit 1 on any failed assertion.
 */
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectQuestCleanupLists, parseArgs, runHostProbe, runQuestProbe, startStaticServer } from "./harness-lib.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const SERVER_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/index.js");
const FIXTURES_DIST = join(ROOT, "packages/openclinxr/scenario-fixtures/dist/index.js");
const APP_DIST = join(ROOT, "apps/ui-xr/dist");
const TIMING = { doorwaySeconds: 1, encounterSeconds: 300, noteSeconds: 1, breakAfterStationOrders: [] };
const JOIN_TIMEOUT_MS = 240000;

const blueprint = {
  blueprintId: "bp-evidence-c28",
  title: "C28 typed free text",
  stationSlots: [{ slotId: "slot-a", order: 1, label: "C28 chest", requiredEnvironmentIds: [], requiredTraceTags: [] }],
  timing: TIMING,
  requiredTraceTags: [],
  requiredSafetyCriticalTraceTags: [],
};

// Nothing below is authored here: line, affect, phrases and fallback are read from the shipped seed bank at run time.
const TYPED = ["Hello, I am the student doctor.", "Doctor, WHEN did the chest pressure start?", "What is your favourite colour?"];
const AIMED_TEXT = "Please get the ECG now.";
const C3_ROW_3 = "c3-ack-recap";

async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const traceDir = await mkdtemp(join(tmpdir(), "xr-sync-c28-trace-"));
  const run = { mode: options.mode, serial: options.mode === "quest" ? options.serial : null, script: "c28", assertions: [], probe: null, pageErrors: [], consoleErrors: [], notEvidenceFor: { questReadiness: true, clinicalValidity: true, examEquivalence: true } };
  const check = (name, pass, detail = "") => {
    run.assertions.push({ name, pass: Boolean(pass), detail: String(detail) });
    if (!pass) process.exitCode = 1;
  };
  let syncServer = null;
  let staticServer = null;
  const startedMs = Date.now();
  try {
    const { createEncounterServer } = await import(SERVER_DIST);
    const { edChestPainScenario, scenarioDialogueSeedBank: shippedSeedBank } = await import(FIXTURES_DIST);
    const shippedEntry = shippedSeedBank.find((entry) => entry.scenarioId === edChestPainScenario.scenarioId);
    const shippedSeed = shippedEntry.seeds.find((seed) => seed.seedId === "patient_onset_history");
    const SHIPPED_LINE = shippedSeed.caption ?? shippedSeed.spokenText;
    const SHIPPED_AFFECT = shippedSeed.affect;
    const SHIPPED_FALLBACK = shippedEntry.utteranceFallback.line;
    const SHIPPED_PHRASES = shippedSeed.utterancePhrases;
    const scenario = { ...edChestPainScenario, status: "approved", eventSchedule: edChestPainScenario.eventSchedule.map((slot) => ({ ...slot, atSecond: TIMING.encounterSeconds })) };
    const actor = scenario.actors.find((entry) => entry.actorId === shippedSeed.actorId);
    const expected = {
      actorId: actor.actorId,
      replyIds: [`${actor.actorId}:opening`, `${actor.actorId}:seed:patient_onset_history`, C3_ROW_3],
      captions: [`${actor.displayName}: ${actor.openingUtterance ?? ""}`, `${actor.displayName}: ${SHIPPED_LINE}`, `${actor.displayName}: ${SHIPPED_FALLBACK}`],
    };
    run.expected = expected;
    const bankHandedToServer = shippedSeedBank;
    syncServer = await createEncounterServer({ examBlueprint: blueprint, scenarios: [scenario], dialogueSeeds: bankHandedToServer, traceDir });
    staticServer = await startStaticServer(APP_DIST);
    run.pageUrl = `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({ encounterSync: syncServer.url })}`;

    const serverActorSpeaking = () => JSON.parse(syncServer.getStateJSON()).actors?.[actor.actorId]?.speaking === true;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const drive = async (page) => {
      await page.waitForFunction(() => { const e = globalThis.__openClinXrEncounterSync; return e !== undefined && e.state !== "joining"; }, undefined, { timeout: JOIN_TIMEOUT_MS });
      const readShell = () => page.evaluate(() => {
        const e = globalThis.__openClinXrEncounterSync;
        const speech = globalThis.__openClinXrHumanoidSpeechEvidence ?? {};
        const input = document.getElementById("utterance-input");
        return {
          state: e.state, error: e.error, sessionId: e.sessionId, turns: e.turns, utterances: e.utterances ?? [],
          inputValue: input === null ? null : input.value,
          dialogue: document.getElementById("dialogue-line")?.textContent ?? null,
          speech: { activeActorId: speech.activeActorId ?? null, lastText: speech.lastText ?? null, emotionSource: speech.emotionSource ?? null, activeEmotionState: speech.activeEmotionState ?? null },
        };
      });
      const probe = { aimPatient: [], aimed: null, gazeBefore: [], via: [], afterTurn: [], typed: 0, inputAfterSend: [], directSendIntentCalls: 0, evidenceText: "" };
      const joined = await readShell();
      if (joined.state !== "joined") return { ...probe, final: joined };
      await page.evaluate(() => { const e = globalThis.__openClinXrEncounterSync; globalThis.__directSendIntentCalls = 0; const original = e.sendIntent; e.sendIntent = (...args) => { globalThis.__directSendIntentCalls += 1; return original(...args); }; });
      await page.locator("#utterance-input").waitFor({ timeout: 60000 });
      for (const [index, text] of TYPED.entries()) {
        const endBy = Date.now() + 30000;
        while (serverActorSpeaking() && Date.now() < endBy) await sleep(100);
        await page.locator("#utterance-input").fill(text);
        // The view differs per device (the Quest opens facing another cast actor): turn it to the patient so the three sends have one known addressee.
        probe.aimPatient.push(await page.evaluate(({ target }) => {
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
        }, { target: expected.actorId }));
        probe.gazeBefore.push(await page.evaluate(() => globalThis.__openClinXrEncounterSync.gazedActorId?.() ?? null));
        // Send 2 submits with Enter in the input; sends 1 and 3 use the button.
        if (index === 1) { await page.locator("#utterance-input").press("Enter"); probe.via.push("enter"); } else { await page.locator("#utterance-send").evaluate((el) => el.click()); probe.via.push("click"); }
        probe.typed += 1;
        probe.inputAfterSend.push(await page.evaluate(() => document.getElementById("utterance-input")?.value ?? null));
        await page.waitForFunction((count) => globalThis.__openClinXrEncounterSync.turns.length >= count, index + 1, { timeout: 60000 }).catch(async (error) => { const dbg = await page.evaluate(() => JSON.stringify(globalThis.__openClinXrEncounterSync.utterances)).catch(() => "?"); throw new Error(`typed turn ${index + 1} never reached the shell; utterances=${dbg}; server=${syncServer.getStateJSON().slice(0, 300)}; ${String(error).slice(0, 80)}`); });
        await sleep(500);
        probe.afterTurn.push(await readShell());
      }
      // Turn the view until the gaze rule names an actor other than the first cast actor, then type to that actor in the same tick.
      const castActorIds = scenario.actors.map((entry) => entry.actorId);
      const aimed = await page.evaluate(({ castFirst, text }) => {
        const camera = globalThis.__openClinXrGazeCamera;
        const gaze = globalThis.__openClinXrEncounterSync.gazedActorId;
        if (!camera || !gaze) return { found: null, reason: "no camera or gaze hook" };
        const eye = camera.getWorldPosition(camera.position.clone());
        for (let degrees = 0; degrees < 360; degrees += 5) {
          const radians = (degrees * Math.PI) / 180;
          camera.lookAt(eye.x + Math.sin(radians), eye.y, eye.z - Math.cos(radians));
          camera.updateMatrixWorld(true);
          const gazed = gaze();
          if (gazed && gazed !== castFirst) {
            document.getElementById("utterance-input").value = text;
            document.getElementById("utterance-send").click();
            return { found: gazed, degrees };
          }
        }
        return { found: null, reason: "no other actor in any 5-degree gaze step" };
      }, { castFirst: castActorIds[0], text: AIMED_TEXT });
      probe.aimed = aimed;
      if (aimed.found) await page.waitForFunction((count) => globalThis.__openClinXrEncounterSync.utterances.length >= count, 4, { timeout: 60000 });
      probe.directSendIntentCalls = await page.evaluate(() => globalThis.__directSendIntentCalls);
      probe.evidenceText = await page.evaluate(() => JSON.stringify({ utterances: globalThis.__openClinXrEncounterSync.utterances }));
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
    check("S1 shell joined the room (state joined, session id set)", final?.state === "joined" && final.sessionId !== "", JSON.stringify({ state: final?.state, error: final?.error }));
    const turns = (final?.turns ?? []).slice(0, 3); // a 4th turn (the actor the view was turned to) is checked by S15
    check("S2 three server turns reached the shell: the opening, the phrase-matched onset seed, the C3 row for the unmatched text", JSON.stringify(turns.map((t) => t.replyId)) === JSON.stringify(expected.replyIds) && turns.every((t) => t.actorId === expected.actorId), JSON.stringify(turns.map((t) => [t.actorId, t.replyId])));
    check("S3 plan caption equals the server caption equals the expected caption (opening, authored line, authored fallback)", JSON.stringify(turns.map((t) => t.planCaption)) === JSON.stringify(expected.captions) && turns.every((t) => t.caption === t.planCaption), JSON.stringify(turns.map((t) => t.planCaption)));
    check("S4 face emotion read from the registered plan equals the server emotion, and the matched seed's authored affect reaches the face", turns.length === 3 && turns.every((t) => t.faceEmotion === t.emotion) && turns[1].emotion === SHIPPED_AFFECT && turns[1].emotion !== turns[0].emotion, JSON.stringify(turns.map((t) => [t.emotion, t.faceEmotion])));
    check("S5 the shell dialogue line shows each caption after its turn", probe.afterTurn?.length === 3 && probe.afterTurn.every((s, i) => s.dialogue === expected.captions[i]), JSON.stringify(probe.afterTurn?.map((s) => s.dialogue)));
    check("S6 the humanoid speech player took each turn: actor, text, emotionSource plan.dialogueEmotionTo, emotion state", probe.afterTurn?.length === 3 && probe.afterTurn.every((s, i) => s.speech.activeActorId === expected.actorId && s.speech.lastText === expected.captions[i] && s.speech.emotionSource === "plan.dialogueEmotionTo" && s.speech.activeEmotionState === turns[i]?.faceEmotion), JSON.stringify(probe.afterTurn?.map((s) => s.speech)));
    check("S7 the shell sent the typed text itself: three entries, every intent acked, lengths match the typed texts, the input cleared after each send, no text on the evidence, and the harness called no sendIntent", final?.utterances?.length >= 3 && final.utterances.slice(0, 3).every((entry, i) => entry.actorId === expected.actorId && entry.statuses.join() === "ack,ack,ack" && entry.chars === TYPED[i].length) && probe.inputAfterSend?.every((value) => value === "") && TYPED.every((text) => !probe.evidenceText.includes(text)) && probe.directSendIntentCalls === 0, JSON.stringify({ utterances: final?.utterances, input: probe.inputAfterSend, direct: probe.directSendIntentCalls }));
    const serverTurns = (syncServer.getProbeStats().turns ?? []).map((t) => t.replyId).slice(0, 3);
    check("S8 the server turn log equals the replyIds the shell played and the expected replyIds", JSON.stringify(serverTurns) === JSON.stringify(turns.map((t) => t.replyId)) && JSON.stringify(serverTurns) === JSON.stringify(expected.replyIds), JSON.stringify(serverTurns));
    // Part A (C26 S9 defect): a missing static asset (favicon-class 404) is not a sync fault; it is counted, every other console error fails.
    const isAsset404 = (text) => /Failed to load resource.*404/iu.test(text);
    const assetErrors = outcome.consoleErrors.filter(isAsset404);
    const otherConsoleErrors = outcome.consoleErrors.filter((text) => !isAsset404(text));
    run.assetNotFoundConsoleErrors = assetErrors.length;
    check("S9 no page errors and no console errors other than missing-asset 404s", outcome.pageErrors.length === 0 && otherConsoleErrors.length === 0, [...outcome.pageErrors, ...otherConsoleErrors].join(" | ") || `${assetErrors.length} asset 404s`);
    const chunkNames = (await readdir(join(APP_DIST, "assets"))).filter((name) => name.endsWith(".js"));
    const hits = [];
    for (const name of chunkNames) {
      const code = await readFile(join(APP_DIST, "assets", name), "utf8");
      for (const marker of ["@openclinxr/xr-sync-server", "@colyseus/core"]) if (code.includes(marker)) hits.push(`${name} contains ${marker.slice(0, 40)}`);
    }
    check("S10 no built chunk carries the server package or @colyseus/core", chunkNames.length > 0 && hits.length === 0, hits.join(" | ") || `${chunkNames.length} chunks`);
    // C28: the addressed actor follows the rule (gaze, else the last speaker, else the first cast actor); Enter submitted send 2.
    const castFirst = scenario.actors[0].actorId;
    check("S16 the view was turned to the patient before each of the three sends", JSON.stringify(probe.aimPatient) === JSON.stringify([true, true, true]), JSON.stringify(probe.aimPatient));
    const expectedAddressed = probe.gazeBefore.map((gazed, i) => gazed ?? turns[i - 1]?.actorId ?? castFirst);
    check("S13 each send addressed the gazed actor, else the last speaker, else the first cast actor; send 2 went through Enter", JSON.stringify((final?.utterances ?? []).slice(0, 3).map((u) => u.actorId)) === JSON.stringify(expectedAddressed) && JSON.stringify(probe.via) === JSON.stringify(["click", "enter", "click"]), JSON.stringify({ addressed: (final?.utterances ?? []).map((u) => u.actorId), expectedAddressed, gazeBefore: probe.gazeBefore, via: probe.via }));
    // C28: no overlay. The server booted with the exported seed bank object, and this file authors none of its fields.
    const ownSource = await readFile(fileURLToPath(import.meta.url), "utf8");
    const overlayPatterns = [new RegExp("utterance" + "Phrases\\s*:"), new RegExp("utterance" + "Fallback\\s*:"), new RegExp("\\.\\.\\.\\s*seed\\b"), new RegExp("\\.\\.\\.\\s*entry\\b")];
    const overlayHits = overlayPatterns.filter((pattern) => pattern.test(ownSource)).map(String);
    check("S14 overlay absent: the server was handed the shipped scenarioDialogueSeedBank, which carries phrases and a fallback, and the harness source has no overlay construct", bankHandedToServer === shippedSeedBank && Array.isArray(SHIPPED_PHRASES) && SHIPPED_PHRASES.length >= 4 && SHIPPED_FALLBACK.length > 0 && overlayHits.length === 0, JSON.stringify({ phrases: SHIPPED_PHRASES?.length, overlayHits }));
    const fourth = final?.utterances?.[3];
    check("S15 with the view turned to another cast actor, the typed text addresses that actor (not the first cast actor)", Boolean(probe.aimed?.found) && fourth?.actorId === probe.aimed.found && fourth.actorId !== castFirst && fourth.statuses.join() === "ack,ack,ack", JSON.stringify({ aimed: probe.aimed, fourth }));
    await syncServer.close();
    syncServer = null;
    let traceFiles = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      traceFiles = (await readdir(traceDir)).filter((name) => name.endsWith(".conversation-trace.json"));
      if (traceFiles.length > 0) break;
      await sleep(200);
    }
    const raws = await Promise.all((await readdir(traceDir)).map((name) => readFile(join(traceDir, name), "utf8")));
    const trace = traceFiles.length > 0 ? JSON.parse(await readFile(join(traceDir, traceFiles[0]), "utf8")) : { events: [] };
    const ends = (trace.events ?? []).filter((event) => event.kind === "utterance-end");
    const forbidden = [...TYPED, AIMED_TEXT, ...SHIPPED_PHRASES, SHIPPED_LINE, SHIPPED_FALLBACK];
    const leaks = forbidden.filter((text) => raws.some((raw) => raw.toLowerCase().includes(text.toLowerCase())));
    check("S12 the persisted trace holds topic id + match kind per typed turn and none of the typed text, phrases or authored lines", JSON.stringify(ends.slice(0, 3).map((e) => [e.tag, e.match])) === JSON.stringify([["utterance_unmatched", "fallback"], ["history_opqrst", "phrase"], ["utterance_unmatched", "fallback"]]) && leaks.length === 0, JSON.stringify({ ends: ends.map((e) => [e.tag, e.match]), leaks }));
    if (options.mode === "quest") {
      const lists = await collectQuestCleanupLists({ staticPort: staticServer.port, syncPort: new URL(run.pageUrl).searchParams.get("encounterSync").split(":").at(-1), serial: options.serial });
      run.adbReverseList = lists.adbReverseList;
      run.adbForwardList = lists.adbForwardList;
      check("S11 adb reverse/forward lists hold neither run port nor tcp:9222", !lists.leaked, `reverse=${lists.adbReverseList} forward=${lists.adbForwardList}`);
    }
  } catch (error) {
    process.exitCode = 1;
    run.fatal = String(error?.stack ?? error).slice(0, 1600);
  } finally {
    await syncServer?.close().catch(() => undefined);
    await staticServer?.close().catch(() => undefined);
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c28-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 300));
    if (run.fatal) console.log(`FATAL ${run.fatal.slice(0, 400)}`);
    console.log(`wrote ${join(outDir, "c28-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
