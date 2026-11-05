#!/usr/bin/env node
/**
 * C27 host/Quest harness: a learner's typed free text, sent by the production shell (apps/ui-xr)
 * through xr-sync-client, becomes the scenario-authored topic answer (deterministic phrase match, no LLM).
 *
 * Host:  node c27-run.mjs --mode host --out <dir>
 * Quest: node c27-run.mjs --mode quest --serial <serial> --out <dir>
 *
 * Flow: createEncounterServer with a one-slot ed-chest-pain cast whose onset seed carries authored utterancePhrases and
 * the scenario carries an authored utteranceFallback -> serve the built shell (apps/ui-xr/dist, `vite build` first) ->
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
  blueprintId: "bp-evidence-c27",
  title: "C27 typed free text",
  stationSlots: [{ slotId: "slot-a", order: 1, label: "C27 chest", requiredEnvironmentIds: [], requiredTraceTags: [] }],
  timing: TIMING,
  requiredTraceTags: [],
  requiredSafetyCriticalTraceTags: [],
};

// Harness fixtures (scenario-authored data handed to the server as seed data; the shipped ed-chest seeds carry no line yet).
const HARNESS_LINE = "It started about an hour ago, right after I carried the groceries up the stairs.";
const HARNESS_AFFECT = "concerned";
const HARNESS_PHRASES = ["when did the chest pressure start", "how long have you had the pain"];
const HARNESS_FALLBACK = "Sorry, I did not follow that. Could you ask it another way?";
const TYPED = ["Hello, I am the student doctor.", "Doctor, WHEN did the chest pressure start?", "What is your favourite colour?"];
const C3_ROW_3 = "c3-ack-recap";

async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const traceDir = await mkdtemp(join(tmpdir(), "xr-sync-c27-trace-"));
  const run = { mode: options.mode, serial: options.mode === "quest" ? options.serial : null, script: "c27", assertions: [], probe: null, pageErrors: [], consoleErrors: [], notEvidenceFor: { questReadiness: true, clinicalValidity: true, examEquivalence: true } };
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
    const scenarioDialogueSeedBank = shippedSeedBank.map((entry) => entry.scenarioId !== edChestPainScenario.scenarioId ? entry : { ...entry, utteranceFallback: { line: HARNESS_FALLBACK }, seeds: entry.seeds.map((seed) => seed.seedId === "patient_onset_history" ? { ...seed, caption: HARNESS_LINE, affect: HARNESS_AFFECT, utterancePhrases: HARNESS_PHRASES } : seed) });
    const scenario = { ...edChestPainScenario, status: "approved", eventSchedule: edChestPainScenario.eventSchedule.map((entry) => ({ ...entry, atSecond: TIMING.encounterSeconds })) };
    const actor = scenario.actors[0];
    const expected = {
      actorId: actor.actorId,
      replyIds: [`${actor.actorId}:opening`, `${actor.actorId}:seed:patient_onset_history`, C3_ROW_3],
      captions: [`${actor.displayName}: ${actor.openingUtterance ?? ""}`, `${actor.displayName}: ${HARNESS_LINE}`, `${actor.displayName}: ${HARNESS_FALLBACK}`],
    };
    run.expected = expected;
    syncServer = await createEncounterServer({ examBlueprint: blueprint, scenarios: [scenario], dialogueSeeds: scenarioDialogueSeedBank, traceDir });
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
      const probe = { afterTurn: [], typed: 0, inputAfterSend: [], directSendIntentCalls: 0, evidenceText: "" };
      const joined = await readShell();
      if (joined.state !== "joined") return { ...probe, final: joined };
      await page.evaluate(() => { const e = globalThis.__openClinXrEncounterSync; globalThis.__directSendIntentCalls = 0; const original = e.sendIntent; e.sendIntent = (...args) => { globalThis.__directSendIntentCalls += 1; return original(...args); }; });
      await page.locator("#utterance-input").waitFor({ timeout: 60000 });
      for (const [index, text] of TYPED.entries()) {
        const endBy = Date.now() + 30000;
        while (serverActorSpeaking() && Date.now() < endBy) await sleep(100);
        await page.locator("#utterance-input").fill(text);
        await page.locator("#utterance-send").evaluate((el) => el.click());
        probe.typed += 1;
        probe.inputAfterSend.push(await page.evaluate(() => document.getElementById("utterance-input")?.value ?? null));
        await page.waitForFunction((count) => globalThis.__openClinXrEncounterSync.turns.length >= count, index + 1, { timeout: 60000 }).catch(async (error) => { const dbg = await page.evaluate(() => JSON.stringify(globalThis.__openClinXrEncounterSync.utterances)).catch(() => "?"); throw new Error(`typed turn ${index + 1} never reached the shell; utterances=${dbg}; server=${syncServer.getStateJSON().slice(0, 300)}; ${String(error).slice(0, 80)}`); });
        await sleep(500);
        probe.afterTurn.push(await readShell());
      }
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
    const turns = final?.turns ?? [];
    check("S2 three server turns reached the shell: the opening, the phrase-matched onset seed, the C3 row for the unmatched text", JSON.stringify(turns.map((t) => t.replyId)) === JSON.stringify(expected.replyIds) && turns.every((t) => t.actorId === expected.actorId), JSON.stringify(turns.map((t) => [t.actorId, t.replyId])));
    check("S3 plan caption equals the server caption equals the expected caption (opening, authored line, authored fallback)", JSON.stringify(turns.map((t) => t.planCaption)) === JSON.stringify(expected.captions) && turns.every((t) => t.caption === t.planCaption), JSON.stringify(turns.map((t) => t.planCaption)));
    check("S4 face emotion read from the registered plan equals the server emotion, and the matched seed's authored affect reaches the face", turns.length === 3 && turns.every((t) => t.faceEmotion === t.emotion) && turns[1].emotion === HARNESS_AFFECT && turns[1].emotion !== turns[0].emotion, JSON.stringify(turns.map((t) => [t.emotion, t.faceEmotion])));
    check("S5 the shell dialogue line shows each caption after its turn", probe.afterTurn?.length === 3 && probe.afterTurn.every((s, i) => s.dialogue === expected.captions[i]), JSON.stringify(probe.afterTurn?.map((s) => s.dialogue)));
    check("S6 the humanoid speech player took each turn: actor, text, emotionSource plan.dialogueEmotionTo, emotion state", probe.afterTurn?.length === 3 && probe.afterTurn.every((s, i) => s.speech.activeActorId === expected.actorId && s.speech.lastText === expected.captions[i] && s.speech.emotionSource === "plan.dialogueEmotionTo" && s.speech.activeEmotionState === turns[i]?.faceEmotion), JSON.stringify(probe.afterTurn?.map((s) => s.speech)));
    check("S7 the shell sent the typed text itself: three entries, every intent acked, lengths match the typed texts, the input cleared after each send, no text on the evidence, and the harness called no sendIntent", final?.utterances?.length === 3 && final.utterances.every((entry, i) => entry.actorId === expected.actorId && entry.statuses.join() === "ack,ack,ack" && entry.chars === TYPED[i].length) && probe.inputAfterSend?.every((value) => value === "") && TYPED.every((text) => !probe.evidenceText.includes(text)) && probe.directSendIntentCalls === 0, JSON.stringify({ utterances: final?.utterances, input: probe.inputAfterSend, direct: probe.directSendIntentCalls }));
    const serverTurns = (syncServer.getProbeStats().turns ?? []).map((t) => t.replyId);
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
      for (const marker of ["@openclinxr/xr-sync-server", "@colyseus/core", HARNESS_LINE, HARNESS_FALLBACK, ...HARNESS_PHRASES]) if (code.includes(marker)) hits.push(`${name} contains ${marker.slice(0, 40)}`);
    }
    check("S10 no built chunk carries the server package, @colyseus/core, or any server-only authored line, phrase or fallback", chunkNames.length > 0 && hits.length === 0, hits.join(" | ") || `${chunkNames.length} chunks`);
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
    const forbidden = [...TYPED, ...HARNESS_PHRASES, HARNESS_LINE, HARNESS_FALLBACK];
    const leaks = forbidden.filter((text) => raws.some((raw) => raw.toLowerCase().includes(text.toLowerCase())));
    check("S12 the persisted trace holds topic id + match kind per typed turn and none of the typed text, phrases or authored lines", JSON.stringify(ends.map((e) => [e.tag, e.match])) === JSON.stringify([["utterance_unmatched", "fallback"], ["history_opqrst", "phrase"], ["utterance_unmatched", "fallback"]]) && leaks.length === 0, JSON.stringify({ ends: ends.map((e) => [e.tag, e.match]), leaks }));
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
    await writeFile(join(outDir, "c27-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 300));
    if (run.fatal) console.log(`FATAL ${run.fatal.slice(0, 400)}`);
    console.log(`wrote ${join(outDir, "c27-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
