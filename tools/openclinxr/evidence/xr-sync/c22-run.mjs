#!/usr/bin/env node
/** C22 host harness: scenario topic menus drive learner-tagged cast utterances and C21 review coverage. */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectBundleSentry,
  parseArgs,
  runHostProbe,
  startStaticServer,
  summarize,
} from "./harness-lib.mjs";
import { observerStationOf } from "./c19-run.mjs";
import { producedTags, split } from "./c21-run.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const SERVER_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/index.js");
const REVIEW_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/session-review-index.js");
const FIXTURES_DIST = join(ROOT, "packages/openclinxr/scenario-fixtures/dist/index.js");
const APP_DIST = join(ROOT, "apps/arena/ui-xr-iwsdk-spike/dist");
const APP_SRC = join(ROOT, "apps/arena/ui-xr-iwsdk-spike/src/sync-probe");
const TIMING = { doorwaySeconds: 1, encounterSeconds: 12, noteSeconds: 1, breakAfterStationOrders: [] };
const NOTE_TAG = "patient_note_submitted";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const blueprint = {
  blueprintId: "bp-evidence-c22",
  title: "C22 learner topic form",
  stationSlots: [
    { slotId: "slot-a", order: 1, label: "C22 chest", requiredEnvironmentIds: [], requiredTraceTags: [] },
    { slotId: "slot-b", order: 2, label: "C22 knee", requiredEnvironmentIds: [], requiredTraceTags: [] },
  ],
  timing: TIMING,
  requiredTraceTags: [],
  requiredSafetyCriticalTraceTags: [],
};

function topicMenu(scenario) {
  return [...new Set(scenario.requiredTraceTags)].filter((tag) => tag !== NOTE_TAG);
}

async function waitFor(condition, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.mode !== "host") throw new Error("C22 worker evidence is HOST-only; root owns Quest runs");
  const outDir = resolve(options.out);
  const traceDir = join(outDir, "trace");
  await mkdir(traceDir, { recursive: true });
  const run = {
    mode: options.mode,
    script: "c22",
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
    const { SESSION_REVIEW_INDEX_FILE } = await import(REVIEW_DIST);
    const { edChestPainScenario, clinicKneePainScenario } = await import(FIXTURES_DIST);
    const neverFire = (scenario) => ({
      ...scenario,
      status: "approved",
      eventSchedule: scenario.eventSchedule.map((entry) => ({ ...entry, atSecond: TIMING.encounterSeconds })),
    });
    const scenarios = [neverFire(edChestPainScenario), neverFire(clinicKneePainScenario)];
    run.expectedMenus = Object.fromEntries(blueprint.stationSlots.map((slot, index) => [slot.slotId, topicMenu(scenarios[index])]));
    run.scheduleOverride = scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      entries: scenario.eventSchedule.map((entry) => ({ eventId: entry.eventId, atSecond: entry.atSecond })),
    }));
    syncServer = await createEncounterServer({ traceDir, examBlueprint: blueprint, scenarios });
    staticServer = await startStaticServer(APP_DIST);
    const params = new URLSearchParams({ sync: syncServer.url, iwer: "1", autostart: "1", script: "c22" });
    run.pageUrl = `http://127.0.0.1:${staticServer.port}/sync-probe.html?${params}`;
    const outcome = await runHostProbe({ pageUrl: run.pageUrl, outDir });
    run.probe = outcome.probe;
    run.pageErrors = outcome.pageErrors;
    run.consoleErrors = outcome.consoleErrors;
    run.rttMs = summarize(outcome.probe.rttMs ?? []);
    run.frameMs = summarize(outcome.probe.frameMs ?? []);
    await waitFor(async () => (await readdir(traceDir)).includes(SESSION_REVIEW_INDEX_FILE), 20000, "C22 review index");
    const indexRaw = await readFile(join(traceDir, SESSION_REVIEW_INDEX_FILE), "utf8");
    const index = JSON.parse(indexRaw);
    run.reviewIndex = index;
    const traces = new Map();
    const persisted = [indexRaw];
    for (const entry of index.stations) {
      const raw = await readFile(join(traceDir, entry.traceFile), "utf8");
      persisted.push(raw);
      traces.set(entry.stationId, JSON.parse(raw));
    }
    const stations = outcome.probe.c22?.stations ?? [];
    for (const [indexNumber, slot] of blueprint.stationSlots.entries()) {
      const page = stations.find((entry) => entry.stationId === slot.slotId);
      const expectedMenu = topicMenu(scenarios[indexNumber]);
      check(`V1 ${slot.slotId} page topicMenu equals scenario menu`, JSON.stringify(page?.menu) === JSON.stringify(expectedMenu), JSON.stringify(page?.menu));
      const asked = (page?.askedTopics ?? []).map((entry) => entry.topicTag);
      const utteranceTags = (traces.get(slot.slotId)?.events ?? []).filter((event) => event.kind === "utterance-end").map((event) => event.tag);
      check(`V2 ${slot.slotId} asked topics acked and traced`, page?.askedTopics?.length === 2 && page.askedTopics.every((entry) => entry.acked) && JSON.stringify(utteranceTags) === JSON.stringify(asked), JSON.stringify({ asked, utteranceTags }));
      check(`V3 ${slot.slotId} bad topic rejected unknown-topic`, page?.rejectReason === "unknown-topic", page?.rejectReason ?? "missing");
    }
    const slotAPage = stations.find((entry) => entry.stationId === "slot-a");
    const slotAEntry = index.stations.find((entry) => entry.stationId === "slot-a");
    const askedSet = new Set((slotAPage?.askedTopics ?? []).map((entry) => entry.topicTag));
    const expectedObserved = split(scenarios[0].requiredTraceTags, askedSet).observed;
    check("V4 slot-a observedTraceTags equals asked topics in scenario order", JSON.stringify(slotAEntry?.observedTraceTags) === JSON.stringify(expectedObserved), JSON.stringify({ expectedObserved, actual: slotAEntry?.observedTraceTags }));
    const traceProduced = [...producedTags(traces.get("slot-a"))];
    check("V4 slot-a trace produced tags equal asked topic set", traceProduced.length === askedSet.size && traceProduced.every((tag) => askedSet.has(tag)), JSON.stringify(traceProduced));
    const unsafe = persisted.some((raw) => raw.includes("sessionId") || UUID.test(raw) || scenarios.some((scenario) => scenario.actors.some((actor) => typeof actor.openingUtterance === "string" && actor.openingUtterance !== "" && raw.includes(actor.openingUtterance))));
    check("V5 persisted files contain no utterance text or session id", !unsafe, unsafe ? "unsafe marker found" : "review-safe");
    run.finalStation = observerStationOf(JSON.parse(syncServer.getStateJSON()));
    run.bundleCheck = await collectBundleSentry({ appDist: APP_DIST, appSrcSyncProbe: APP_SRC });
    check("thin page bundle has no server imports", run.bundleCheck.hits.length === 0, run.bundleCheck.hits.join(" | "));
    check("page completed with only expected rejects", outcome.probe.done === true && outcome.probe.error == null && outcome.probe.rejects === scenarios.length && outcome.pageErrors.length === 0 && outcome.consoleErrors.length === 0, JSON.stringify({ done: outcome.probe.done, error: outcome.probe.error, rejects: outcome.probe.rejects, pageErrors: outcome.pageErrors, consoleErrors: outcome.consoleErrors }));
  } catch (error) {
    process.exitCode = 1;
    run.fatal = String(error?.stack ?? error).slice(0, 1600);
  } finally {
    await syncServer?.close().catch(() => undefined);
    await staticServer?.close().catch(() => undefined);
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c22-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 260));
    console.log(`wrote ${join(outDir, "c22-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
