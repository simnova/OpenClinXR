#!/usr/bin/env node
/** C24 host/Quest harness: a seed's authored affect sets the answering actor's emotion. */
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
const FIXTURES_DIST = join(ROOT, "packages/openclinxr/scenario-fixtures/dist/index.js");
const APP_DIST = join(ROOT, "apps/arena/ui-xr-iwsdk-spike/dist");
const APP_SRC = join(ROOT, "apps/arena/ui-xr-iwsdk-spike/src/sync-probe");
const TIMING = { doorwaySeconds: 1, encounterSeconds: 20, noteSeconds: 1, breakAfterStationOrders: [] };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const blueprint = {
  blueprintId: "bp-evidence-c24",
  title: "C24 authored affect",
  stationSlots: [
    { slotId: "slot-a", order: 1, label: "C24 knee", requiredEnvironmentIds: [], requiredTraceTags: [] },
    { slotId: "slot-b", order: 2, label: "C24 chest", requiredEnvironmentIds: [], requiredTraceTags: [] },
  ],
  timing: TIMING,
  requiredTraceTags: [],
  requiredSafetyCriticalTraceTags: [],
};

function authoredLine(seed) {
  return typeof seed.caption === "string" ? seed.caption : typeof seed.spokenText === "string" ? seed.spokenText : null;
}

/** Two actors whose first topic seed carries an affect different from the scenario baseline, and from each other. */
function selectAsks(scenario, seeds) {
  const baseline = scenario.emotionPolicy?.baseline ?? "neutral";
  const menu = new Set(scenario.requiredTraceTags);
  const picked = [];
  for (const seed of seeds) {
    const topic = seed.expectedTraceTags.find((tag) => menu.has(tag));
    if (seed.safetyExpectation !== "responds_from_visible_facts" || authoredLine(seed) === null || topic === undefined) continue;
    if (seed.affect === undefined || seed.affect === baseline) continue;
    if (picked.some((entry) => entry.seed.actorId === seed.actorId || entry.seed.affect === seed.affect)) continue;
    picked.push({ topic, seed });
  }
  if (picked.length < 2) throw new Error("C24 fixtures need two actors with distinct non-baseline authored affects");
  return { baseline, picked: picked.slice(0, 2) };
}

async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  const traceDir = join(outDir, "trace");
  await mkdir(traceDir, { recursive: true });
  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    script: "c24",
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
    const { clinicKneePainScenario, edChestPainScenario, scenarioDialogueSeedBank } = await import(FIXTURES_DIST);
    const neverFire = (scenario) => ({
      ...scenario,
      status: "approved",
      eventSchedule: scenario.eventSchedule.map((entry) => ({ ...entry, atSecond: TIMING.encounterSeconds })),
    });
    const scenarios = [neverFire(clinicKneePainScenario), neverFire(edChestPainScenario)];
    const seeds = scenarioDialogueSeedBank.find((entry) => entry.scenarioId === scenarios[0].scenarioId)?.seeds ?? [];
    const { baseline, picked } = selectAsks(scenarios[0], seeds);
    const expectedAsks = picked.flatMap(({ topic, seed }) => [
      { actorId: seed.actorId, topic: null, emotion: baseline },
      { actorId: seed.actorId, topic, emotion: seed.affect },
    ]);
    run.expected = expectedAsks;
    syncServer = await createEncounterServer({ traceDir, examBlueprint: blueprint, scenarios, dialogueSeeds: scenarioDialogueSeedBank });
    staticServer = await startStaticServer(APP_DIST);
    const params = new URLSearchParams({
      sync: syncServer.url,
      iwer: "1",
      autostart: "1",
      script: "c24",
      ...(options.mode === "quest" ? { forceIwer: "1" } : {}),
    });
    for (const ask of expectedAsks) params.append("c24Ask", `${ask.actorId}|${ask.topic ?? ""}`);
    run.pageUrl = `http://127.0.0.1:${staticServer.port}/sync-probe.html?${params}`;
    const outcome = options.mode === "host"
      ? await runHostProbe({ pageUrl: run.pageUrl, outDir })
      : await runQuestProbe({ pageUrl: run.pageUrl, outDir, serial: options.serial });
    run.probe = outcome.probe;
    run.pageErrors = outcome.pageErrors;
    run.consoleErrors = outcome.consoleErrors;
    run.rttMs = summarize(outcome.probe.rttMs ?? []);
    run.frameMs = summarize(outcome.probe.frameMs ?? []);
    const page = outcome.probe.c24;
    check("T1 page emotions per ask equal the opening baseline then the seed's authored affect", JSON.stringify(page?.asks?.map(({ actorId, topic, emotion }) => ({ actorId, topic, emotion }))) === JSON.stringify(expectedAsks), JSON.stringify(page?.asks));
    check("T2 the two authored affects differ from each other and from the baseline", new Set([baseline, ...picked.map((entry) => entry.seed.affect)]).size === 3, JSON.stringify(picked.map((entry) => entry.seed.affect)));
    check("T3 tints on the page differ per authored affect", new Set(page?.asks?.map((ask) => ask.tint)).size === 3, JSON.stringify(page?.asks?.map((ask) => ask.tint)));
    check("T4 panel text names the emotion", page?.panelTexts?.length === expectedAsks.length && page.panelTexts.every((text, index) => text.startsWith(`${expectedAsks[index].actorId} ${expectedAsks[index].emotion}:`)), JSON.stringify(page?.panelTexts));
    check("page acknowledged all turns", page?.asks?.length === expectedAsks.length && page.asks.every((ask) => ask.ack), JSON.stringify(page?.asks?.map((ask) => ask.ack)));
    await syncServer.close();
    syncServer = null;
    const files = await readdir(traceDir);
    const persisted = await Promise.all(files.map(async (name) => ({ name, raw: await readFile(join(traceDir, name), "utf8") })));
    const slotA = persisted.map((entry) => JSON.parse(entry.raw)).find((trace) => trace.stationId === "slot-a");
    check("T5 slot-a persisted emotions equal the page emotions", JSON.stringify(slotA?.emotions?.map((entry) => entry.to)) === JSON.stringify(expectedAsks.map((ask) => ask.emotion)), JSON.stringify(slotA?.emotions?.map((entry) => entry.to)));
    const seedLines = scenarioDialogueSeedBank.flatMap((entry) => entry.seeds.flatMap((seed) => [seed.caption, seed.spokenText])).filter((line) => typeof line === "string");
    const utteranceLines = scenarios.flatMap((scenario) => scenario.actors.map((actor) => actor.openingUtterance)).filter((line) => typeof line === "string" && line !== "");
    const unsafe = persisted.flatMap((entry) => [
      ...seedLines.filter((line) => entry.raw.includes(line)),
      ...utteranceLines.filter((line) => entry.raw.includes(line)),
      ...(entry.raw.includes("sessionId") || UUID.test(entry.raw) ? ["session"] : []),
    ]);
    check("T6 persisted files contain no seed line, utterance text, or session id", unsafe.length === 0, unsafe.join(" | "));
    run.bundleCheck = await collectBundleSentry({ appDist: APP_DIST, appSrcSyncProbe: APP_SRC, extraBanned: seedLines });
    check("T7 page bundle contains no seed line text", run.bundleCheck.hits.length === 0, run.bundleCheck.hits.join(" | "));
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
    await writeFile(join(outDir, "c24-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 300));
    console.log(`wrote ${join(outDir, "c24-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
