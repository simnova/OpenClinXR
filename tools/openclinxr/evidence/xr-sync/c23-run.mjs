#!/usr/bin/env node
/** C23 host/Quest harness: authored dialogue seeds answer learner-selected scenario topics. */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectBundleSentry,
  collectQuestCleanupLists,
  parseArgs,
  runHostProbe,
  runQuestProbe,
  startStaticServer,
  summarize,
} from "./harness-lib.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const SERVER_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/index.js");
const ROOM_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/room.js");
const FIXTURES_DIST = join(ROOT, "packages/openclinxr/scenario-fixtures/dist/index.js");
const APP_DIST = join(ROOT, "apps/arena/ui-xr-iwsdk-spike/dist");
const APP_SRC = join(ROOT, "apps/arena/ui-xr-iwsdk-spike/src/sync-probe");
const TIMING = { doorwaySeconds: 1, encounterSeconds: 20, noteSeconds: 1, breakAfterStationOrders: [] };
// C3 contract (xr-sync-c23-topic-answers.test.ts): the actor's 4th turn takes C3 row 1, "c3-ack-open".
const C3_FOURTH_TURN_ID = "c3-ack-open";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const blueprint = {
  blueprintId: "bp-evidence-c23",
  title: "C23 authored topic answers",
  stationSlots: [
    { slotId: "slot-a", order: 1, label: "C23 knee", requiredEnvironmentIds: [], requiredTraceTags: [] },
    { slotId: "slot-b", order: 2, label: "C23 chest", requiredEnvironmentIds: [], requiredTraceTags: [] },
  ],
  timing: TIMING,
  requiredTraceTags: [],
  requiredSafetyCriticalTraceTags: [],
};

function authoredLine(seed) {
  return typeof seed.caption === "string" ? seed.caption : typeof seed.spokenText === "string" ? seed.spokenText : null;
}

function selectTopics(scenario, seeds, actorId) {
  const menu = [...new Set(scenario.requiredTraceTags)].filter((tag) => tag !== "patient_note_submitted");
  const answerFor = (topic) => seeds.find((seed) =>
    seed.actorId === actorId &&
    seed.safetyExpectation === "responds_from_visible_facts" &&
    seed.expectedTraceTags.includes(topic) &&
    authoredLine(seed) !== null);
  const authored = [];
  for (const topic of menu) {
    const seed = answerFor(topic);
    if (seed !== undefined && !authored.some((entry) => entry.seed.seedId === seed.seedId)) authored.push({ topic, seed });
  }
  const fallback = menu.find((topic) => answerFor(topic) === undefined);
  if (authored.length < 2 || fallback === undefined) throw new Error("C23 fixtures need two distinct authored answers and one fallback topic");
  return { authored: authored.slice(0, 2), fallback };
}

async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  const traceDir = join(outDir, "trace");
  await mkdir(traceDir, { recursive: true });
  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    script: "c23",
    timingOverride: TIMING,
    assertions: [],
    probe: null,
    pageErrors: [],
    consoleErrors: [],
    notEvidenceFor: { questReadiness: true, clinicalValidity: true, examEquivalence: true },
  };
  const check = (name, pass, detail = "") => {
    run.assertions.push({ name, pass: Boolean(pass), detail: String(detail) });
    if (!pass) process.exitCode = 1;
  };
  let syncServer = null;
  let staticServer = null;
  const startedMs = Date.now();
  try {
    const { createEncounterServer } = await import(SERVER_DIST);
    const { C3_REPLY_TABLE } = await import(ROOM_DIST);
    const { clinicKneePainScenario, edChestPainScenario, scenarioDialogueSeedBank } = await import(FIXTURES_DIST);
    const neverFire = (scenario) => ({
      ...scenario,
      status: "approved",
      eventSchedule: scenario.eventSchedule.map((entry) => ({ ...entry, atSecond: TIMING.encounterSeconds })),
    });
    const scenarios = [neverFire(clinicKneePainScenario), neverFire(edChestPainScenario)];
    const firstActor = scenarios[0].actors[0];
    const seeds = scenarioDialogueSeedBank.find((entry) => entry.scenarioId === scenarios[0].scenarioId)?.seeds ?? [];
    const selected = selectTopics(scenarios[0], seeds, firstActor.actorId);
    const expectedSeedTurns = selected.authored.map(({ topic, seed }) => ({
      topic,
      replyId: `${firstActor.actorId}:seed:${seed.seedId}`,
      caption: `${firstActor.displayName}: ${authoredLine(seed)}`,
    }));
    const expected = {
      stationId: "slot-a",
      actorId: firstActor.actorId,
      askedTopics: [null, ...selected.authored.map((entry) => entry.topic), selected.fallback],
      replyIds: [`${firstActor.actorId}:opening`, ...expectedSeedTurns.map((entry) => entry.replyId), C3_FOURTH_TURN_ID],
      captionsShown: [`${firstActor.displayName}: ${firstActor.openingUtterance ?? ""}`, ...expectedSeedTurns.map((entry) => entry.caption), ""],
    };
    run.expected = expected;
    syncServer = await createEncounterServer({
      traceDir,
      examBlueprint: blueprint,
      scenarios,
      dialogueSeeds: scenarioDialogueSeedBank,
    });
    staticServer = await startStaticServer(APP_DIST);
    const params = new URLSearchParams({
      sync: syncServer.url,
      iwer: "1",
      autostart: "1",
      script: "c23",
      c23FallbackTopic: selected.fallback,
      ...(options.mode === "quest" ? { forceIwer: "1" } : {}),
    });
    for (const entry of selected.authored) params.append("c23SeedTopic", entry.topic);
    run.pageUrl = `http://127.0.0.1:${staticServer.port}/sync-probe.html?${params}`;
    const outcome = options.mode === "host"
      ? await runHostProbe({ pageUrl: run.pageUrl, outDir })
      : await runQuestProbe({ pageUrl: run.pageUrl, outDir, serial: options.serial });
    run.probe = outcome.probe;
    run.pageErrors = outcome.pageErrors;
    run.consoleErrors = outcome.consoleErrors;
    run.rttMs = summarize(outcome.probe.rttMs ?? []);
    run.frameMs = summarize(outcome.probe.frameMs ?? []);
    const page = outcome.probe.c23;
    check("T1 page replyIds and captions equal scenario and seed bank", JSON.stringify({
      stationId: page?.stationId,
      actorId: page?.actorId,
      askedTopics: page?.askedTopics,
      replyIds: page?.replyIds,
      captionsShown: page?.captionsShown,
    }) === JSON.stringify(expected), JSON.stringify(page));
    const c3Texts = C3_REPLY_TABLE.map((entry) => entry.text);
    check("T2 authored captions are distinct and not C3 text", new Set(page?.captionsShown?.slice(1, 3)).size === 2 && page.captionsShown.slice(1, 3).every((caption) => !c3Texts.some((text) => caption.includes(text))), JSON.stringify(page?.captionsShown));
    check("page acknowledged all four turns", page?.acks?.length === 4 && page.acks.every(Boolean), JSON.stringify(page?.acks));
    await syncServer.close();
    syncServer = null;
    const files = await readdir(traceDir);
    const persisted = await Promise.all(files.map(async (name) => ({ name, raw: await readFile(join(traceDir, name), "utf8") })));
    const slotA = persisted.map((entry) => JSON.parse(entry.raw)).find((trace) => trace.stationId === "slot-a");
    check("T3 slot-a persisted replyIds equal page replyIds", JSON.stringify(slotA?.turns?.map((turn) => turn.replyId)) === JSON.stringify(page?.replyIds), JSON.stringify(slotA?.turns));
    const seedLines = scenarioDialogueSeedBank.flatMap((entry) => entry.seeds.flatMap((seed) => [seed.caption, seed.spokenText])).filter((line) => typeof line === "string");
    const utteranceLines = scenarios.flatMap((scenario) => scenario.actors.map((actor) => actor.openingUtterance)).filter((line) => typeof line === "string" && line !== "");
    const unsafe = persisted.flatMap((entry) => [
      ...seedLines.filter((line) => entry.raw.includes(line)),
      ...utteranceLines.filter((line) => entry.raw.includes(line)),
      ...(entry.raw.includes("sessionId") || UUID.test(entry.raw) ? ["session"] : []),
    ]);
    check("T4 persisted files contain no seed line, utterance text, or session id", unsafe.length === 0, unsafe.join(" | "));
    run.bundleCheck = await collectBundleSentry({ appDist: APP_DIST, appSrcSyncProbe: APP_SRC, extraBanned: seedLines });
    check("T5 page bundle contains no seed line text", run.bundleCheck.hits.length === 0, run.bundleCheck.hits.join(" | "));
    check("page completed without error", outcome.probe.done === true && outcome.probe.error == null && outcome.pageErrors.length === 0, JSON.stringify({ done: outcome.probe.done, error: outcome.probe.error, pageErrors: outcome.pageErrors }));
    if (options.mode === "quest") {
      const lists = await collectQuestCleanupLists({ staticPort: staticServer.port, syncPort: new URL(run.pageUrl).searchParams.get("sync").split(":").at(-1), serial: options.serial });
      run.adbReverseList = lists.adbReverseList;
      run.adbForwardList = lists.adbForwardList;
      check("Quest port cleanup", !lists.leaked, `reverse=${lists.adbReverseList} forward=${lists.adbForwardList}`);
    }
  } catch (error) {
    process.exitCode = 1;
    run.fatal = String(error?.stack ?? error).slice(0, 1600);
  } finally {
    await syncServer?.close().catch(() => undefined);
    await staticServer?.close().catch(() => undefined);
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c23-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 300));
    console.log(`wrote ${join(outDir, "c23-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
