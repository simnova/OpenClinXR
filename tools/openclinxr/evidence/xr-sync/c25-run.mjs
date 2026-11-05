#!/usr/bin/env node
/**
 * C25 host/Quest harness: the production shell (apps/ui-xr) joins the encounter room.
 *
 * Host:  node c25-run.mjs --mode host --out <dir>
 * Quest: node c25-run.mjs --mode quest --serial <serial> --out <dir>
 *
 * Flow: createEncounterServer with a one-slot ed-chest-pain cast -> serve the built shell
 * (apps/ui-xr/dist, `vite build` first) -> open /?encounterSync=<ws url> -> the harness sends
 * select-actor + utterance-start/end through window.__openClinXrEncounterSync.sendIntent (the
 * learner side) for the opening and one authored topic -> read the shell back (evidence turns,
 * #dialogue-line, __openClinXrHumanoidSpeechEvidence) and the server turn log.
 * Exit 1 on any failed assertion. The run file is always written first.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectQuestCleanupLists, parseArgs, runHostProbe, runQuestProbe, startStaticServer } from "./harness-lib.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const SERVER_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/index.js");
const FIXTURES_DIST = join(ROOT, "packages/openclinxr/scenario-fixtures/dist/index.js");
const APP_DIST = join(ROOT, "apps/ui-xr/dist");
const TIMING = { doorwaySeconds: 1, encounterSeconds: 90, noteSeconds: 1, breakAfterStationOrders: [] };
const JOIN_TIMEOUT_MS = 240000;

const blueprint = {
  blueprintId: "bp-evidence-c25",
  title: "C25 shell joins the room",
  stationSlots: [{ slotId: "slot-a", order: 1, label: "C25 chest", requiredEnvironmentIds: [], requiredTraceTags: [] }],
  timing: TIMING,
  requiredTraceTags: [],
  requiredSafetyCriticalTraceTags: [],
};

const authoredLine = (seed) => (typeof seed.caption === "string" ? seed.caption : typeof seed.spokenText === "string" ? seed.spokenText : null);

function selectTopic(scenario, seeds, actorId) {
  const menu = [...new Set(scenario.requiredTraceTags)].filter((tag) => tag !== "patient_note_submitted");
  for (const topic of menu) {
    const seed = seeds.find((entry) => entry.actorId === actorId && entry.safetyExpectation === "responds_from_visible_facts" && entry.expectedTraceTags.includes(topic) && authoredLine(entry) !== null);
    if (seed !== undefined) return { topic, seed };
  }
  throw new Error("C25 fixtures need one authored topic answer");
}

async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const run = { mode: options.mode, serial: options.mode === "quest" ? options.serial : null, script: "c25", assertions: [], probe: null, pageErrors: [], consoleErrors: [], notEvidenceFor: { questReadiness: true, clinicalValidity: true, examEquivalence: true } };
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
    let HARNESS_LINE;
    // The shipped ed-chest seeds carry no authored line yet (only knee does); the harness authors one so the
    // shell has a topic answer to play. The line is a harness fixture, not scenario content.
    HARNESS_LINE = "It started about an hour ago, right after I carried the groceries up the stairs.";
    const scenarioDialogueSeedBank = shippedSeedBank.map((entry) => entry.scenarioId !== edChestPainScenario.scenarioId ? entry : { ...entry, seeds: entry.seeds.map((seed) => seed.seedId === "patient_onset_history" ? { ...seed, caption: HARNESS_LINE } : seed) });
    const scenario = { ...edChestPainScenario, status: "approved", eventSchedule: edChestPainScenario.eventSchedule.map((entry) => ({ ...entry, atSecond: TIMING.encounterSeconds })) };
    const actor = scenario.actors[0];
    const seeds = scenarioDialogueSeedBank.find((entry) => entry.scenarioId === scenario.scenarioId)?.seeds ?? [];
    const picked = selectTopic(scenario, seeds, actor.actorId);
    const expected = {
      actorId: actor.actorId,
      replyIds: [`${actor.actorId}:opening`, `${actor.actorId}:seed:${picked.seed.seedId}`],
      captions: [`${actor.displayName}: ${actor.openingUtterance ?? ""}`, `${actor.displayName}: ${authoredLine(picked.seed)}`],
      topics: [null, picked.topic],
    };
    run.expected = expected;
    syncServer = await createEncounterServer({ examBlueprint: blueprint, scenarios: [scenario], dialogueSeeds: scenarioDialogueSeedBank });
    staticServer = await startStaticServer(APP_DIST);
    run.pageUrl = `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({ encounterSync: syncServer.url })}`;

    const serverActorSpeaking = () => JSON.parse(syncServer.getStateJSON()).actors?.[actor.actorId]?.speaking === true;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const drive = async (page) => {
      await page.waitForFunction(() => { const e = globalThis.__openClinXrEncounterSync; return e !== undefined && e.state !== "joining"; }, undefined, { timeout: JOIN_TIMEOUT_MS });
      const readShell = () => page.evaluate(() => {
        const e = globalThis.__openClinXrEncounterSync;
        const speech = globalThis.__openClinXrHumanoidSpeechEvidence ?? {};
        return {
          state: e.state, error: e.error, sessionId: e.sessionId, turns: e.turns,
          dialogue: document.getElementById("dialogue-line")?.textContent ?? null,
          speech: { activeActorId: speech.activeActorId ?? null, lastText: speech.lastText ?? null, emotionSource: speech.emotionSource ?? null, activeEmotionState: speech.activeEmotionState ?? null },
        };
      });
      // The shell renders on the page main thread; under load an ack can miss the client's 5 s intent timeout.
      const send = (kind, payload) => page.evaluate(([k, p]) => globalThis.__openClinXrEncounterSync.sendIntent(k, p).catch((error) => ({ status: "error", reason: String(error).slice(0, 120) })), [kind, payload]);
      const probe = { afterTurn: [], acks: [], selectedAfterMs: 0 };
      const joined = await readShell();
      if (joined.state !== "joined") return { ...probe, final: joined };
      const t0 = Date.now();
      for (;;) {
        const result = await send("select-actor", { actorId: actor.actorId });
        if (result.status === "ack") break;
        if (Date.now() - t0 > 30000) throw new Error(`select-actor never acked: ${JSON.stringify(result)}`);
        await sleep(300);
      }
      probe.selectedAfterMs = Date.now() - t0;
      for (const [index, topic] of expected.topics.entries()) {
        await send("select-actor", { actorId: actor.actorId });
        await send("utterance-start", {});
        const end = await send("utterance-end", topic === null ? {} : { topicTag: topic });
        probe.acks.push(end.status);
        await page.waitForFunction((n) => globalThis.__openClinXrEncounterSync.turns.length > n, index, { timeout: 30000 });
        await sleep(500);
        probe.afterTurn.push(await readShell());
        const endBy = Date.now() + 30000;
        while (serverActorSpeaking() && Date.now() < endBy) await sleep(100);
      }
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
    check("S2 two server turns reached the shell: replyIds equal the cast opening and the authored seed", JSON.stringify(turns.map((t) => t.replyId)) === JSON.stringify(expected.replyIds) && turns.every((t) => t.actorId === expected.actorId), JSON.stringify(turns.map((t) => [t.actorId, t.replyId])));
    check("S3 plan caption equals the server caption equals the cast caption", JSON.stringify(turns.map((t) => t.planCaption)) === JSON.stringify(expected.captions) && turns.every((t) => t.caption === t.planCaption), JSON.stringify(turns.map((t) => t.planCaption)));
    check("S4 face emotion read from the registered plan equals the server emotion", turns.length === 2 && turns.every((t) => t.faceEmotion === t.emotion), JSON.stringify(turns.map((t) => [t.emotion, t.faceEmotion])));
    check("S5 the shell dialogue line shows each caption after its turn", probe.afterTurn?.length === 2 && probe.afterTurn.every((s, i) => s.dialogue === expected.captions[i]), JSON.stringify(probe.afterTurn?.map((s) => s.dialogue)));
    check("S6 the humanoid speech player took the turn: actor, text, emotionSource plan.dialogueEmotionTo, emotion state", probe.afterTurn?.length === 2 && probe.afterTurn.every((s, i) => s.speech.activeActorId === expected.actorId && s.speech.lastText === expected.captions[i] && s.speech.emotionSource === "plan.dialogueEmotionTo" && s.speech.activeEmotionState === turns[i]?.faceEmotion), JSON.stringify(probe.afterTurn?.map((s) => s.speech)));
    check("S7 no utterance-end was rejected (ack or client-side error such as the 5 s timeout, never reject)", probe.acks?.length === 2 && probe.acks.every((status) => status !== "reject"), JSON.stringify(probe.acks));
    const serverTurns = (syncServer.getProbeStats().turns ?? []).map((t) => t.replyId);
    check("S8 the server turn log equals the replyIds the shell played and the expected replyIds", JSON.stringify(serverTurns) === JSON.stringify(turns.map((t) => t.replyId)) && JSON.stringify(serverTurns) === JSON.stringify(expected.replyIds), JSON.stringify(serverTurns));
    check("S9 no page errors", outcome.pageErrors.length === 0, outcome.pageErrors.join(" | "));
    const chunkNames = (await readdir(join(APP_DIST, "assets"))).filter((name) => name.endsWith(".js"));
    const hits = [];
    for (const name of chunkNames) {
      const code = await readFile(join(APP_DIST, "assets", name), "utf8");
      for (const marker of ["@openclinxr/xr-sync-server", "@colyseus/core", HARNESS_LINE]) if (code.includes(marker)) hits.push(`${name} contains ${marker.slice(0, 40)}`);
    }
    check("S10 no built chunk carries the server package, @colyseus/core, or the server-only authored line", chunkNames.length > 0 && hits.length === 0, hits.join(" | ") || `${chunkNames.length} chunks`);
    await syncServer.close();
    syncServer = null;
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
    await writeFile(join(outDir, "c25-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 300));
    if (run.fatal) console.log(`FATAL ${run.fatal.slice(0, 400)}`);
    console.log(`wrote ${join(outDir, "c25-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
