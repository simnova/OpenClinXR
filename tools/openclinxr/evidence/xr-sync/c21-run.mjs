#!/usr/bin/env node
/** C21 trace-tag coverage harness: record cast evidence, then run the C20 replay flow with count labels. */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
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
const REVIEW_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/session-review-index.js");
const CLIENT_DIST = join(ROOT, "packages/openclinxr/xr-sync-client/dist/index.js");
const FIXTURES_DIST = join(ROOT, "packages/openclinxr/scenario-fixtures/dist/index.js");
const APP_DIST = join(ROOT, "apps/arena/ui-xr-iwsdk-spike/dist");
const APP_SRC = join(ROOT, "apps/arena/ui-xr-iwsdk-spike/src/sync-probe");
const TIMING = { doorwaySeconds: 1, encounterSeconds: 6, noteSeconds: 2, breakAfterStationOrders: [] };
const NOTE_TAG = "patient_note_submitted";
const SCORE_SUFFIX = ".faculty-score.json";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const blueprint = {
  blueprintId: "bp-evidence-c21",
  title: "C21 evidence form",
  stationSlots: [
    { slotId: "slot-a", order: 1, label: "C21 chest", requiredEnvironmentIds: [], requiredTraceTags: [] },
    { slotId: "slot-b", order: 2, label: "C21 knee", requiredEnvironmentIds: [], requiredTraceTags: [] },
  ],
  timing: TIMING,
  requiredTraceTags: [],
  requiredSafetyCriticalTraceTags: [],
};

function producedTags(trace) {
  const out = new Set();
  for (const event of trace.events ?? []) {
    if (typeof event.tag === "string") out.add(event.tag);
    if (event.kind === "note-submitted") out.add(NOTE_TAG);
  }
  return out;
}

function split(required, produced) {
  const unique = [...new Set(required)];
  return { observed: unique.filter((tag) => produced.has(tag)), missing: unique.filter((tag) => !produced.has(tag)) };
}

function expectedCoverage(scenario, trace) {
  const produced = producedTags(trace);
  const station = split(scenario.requiredTraceTags, produced);
  return {
    observedTraceTags: station.observed,
    missingRequiredTraceTags: station.missing,
    rubricCoverage: scenario.reviewRubric.map((item) => {
      const itemSplit = split(item.requiredTraceTags, produced);
      return { rubricId: item.rubricId, observedTags: itemSplit.observed, missingTags: itemSplit.missing };
    }),
  };
}

function countsOf(coverage) {
  return coverage.rubricCoverage.map((item) => ({
    id: item.rubricId,
    observedCount: item.observedTags.length,
    requiredCount: item.observedTags.length + item.missingTags.length,
  }));
}

async function hashDir(root) {
  const hashes = {};
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else hashes[relative(root, file)] = createHash("sha256").update(await readFile(file)).digest("hex");
    }
  }
  await walk(root);
  return hashes;
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
  const outDir = resolve(options.out);
  const traceDir = join(outDir, "trace");
  const scoreDir = join(outDir, "scores");
  await mkdir(traceDir, { recursive: true });
  await mkdir(scoreDir, { recursive: true });
  const startedMs = Date.now();
  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    script: "c21",
    timingOverride: TIMING,
    scheduleOverride: null,
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
  const connections = [];
  let recordServer = null;
  let replayServer = null;
  let staticServer = null;
  let replayPort = null;
  let staticPort = null;
  try {
    const { createEncounterServer } = await import(SERVER_DIST);
    const { SESSION_REVIEW_INDEX_FILE } = await import(REVIEW_DIST);
    const { connect } = await import(CLIENT_DIST);
    const { edChestPainScenario, clinicKneePainScenario } = await import(FIXTURES_DIST);
    const approve = (scenario, atSecond) => ({
      ...scenario,
      status: "approved",
      eventSchedule: scenario.eventSchedule.map((entry) => ({ ...entry, atSecond })),
    });
    const scenarios = [approve(edChestPainScenario, 2), approve(clinicKneePainScenario, TIMING.encounterSeconds)];
    run.scheduleOverride = scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      entries: scenario.eventSchedule.map((entry) => ({ eventId: entry.eventId, tag: entry.tag, atSecond: entry.atSecond })),
    }));

    // Phase A: direct thin client records the authoritative trace; note only at slot-a.
    recordServer = await createEncounterServer({ traceDir, examBlueprint: blueprint, scenarios });
    const learner = await connect(recordServer.url, { roomOptions: { actors: ["a1", "a2"] } });
    connections.push(learner);
    let live = null;
    learner.onState((state) => { live = state; });
    await waitFor(() => live?.stationId === "slot-a" && live?.phase === "note", 20000, "slot-a note phase");
    const noteAck = await learner.sendIntent("note-submit", { text: "C21 evidence note." });
    check("phase A slot-a note submit acked", noteAck.status === "ack", JSON.stringify(noteAck));
    await waitFor(async () => (await readdir(traceDir)).includes(SESSION_REVIEW_INDEX_FILE), 45000, "review index");
    await learner.leave();
    await recordServer.close();
    recordServer = null;

    const indexRaw = await readFile(join(traceDir, SESSION_REVIEW_INDEX_FILE), "utf8");
    const index = JSON.parse(indexRaw);
    run.reviewIndex = index;
    const traces = new Map();
    for (const entry of index.stations) traces.set(entry.stationId, JSON.parse(await readFile(join(traceDir, entry.traceFile), "utf8")));
    const scenarioFor = (stationId) => scenarios[stationId === "slot-a" ? 0 : 1];
    const expected = new Map(index.stations.map((entry) => [entry.stationId, expectedCoverage(scenarioFor(entry.stationId), traces.get(entry.stationId))]));
    run.expectedCoverage = Object.fromEntries(expected);
    for (const entry of index.stations) {
      const want = expected.get(entry.stationId);
      check(
        `U1 ${entry.stationId} index coverage equals scenario/trace split`,
        JSON.stringify({ observedTraceTags: entry.observedTraceTags, missingRequiredTraceTags: entry.missingRequiredTraceTags, rubricCoverage: entry.rubricCoverage }) === JSON.stringify(want),
        JSON.stringify(want),
      );
    }
    const slotATags = [...producedTags(traces.get("slot-a"))];
    const slotBTags = [...producedTags(traces.get("slot-b"))];
    const chestScheduleTags = scenarios[0].eventSchedule.map((entry) => entry.tag);
    check("U2 slot-a observes fired schedule tag and patient_note_submitted", chestScheduleTags.every((tag) => slotATags.includes(tag)) && slotATags.includes(NOTE_TAG), JSON.stringify(slotATags));
    check("U2 slot-b observes neither schedule nor note tag", slotBTags.length === 0, JSON.stringify(slotBTags));
    const rubricLabels = scenarios.flatMap((scenario) => scenario.reviewRubric.map((item) => item.label));
    check("U4 index has no rubric label text and no session id", rubricLabels.every((label) => !indexRaw.includes(label)) && !indexRaw.includes("sessionId") && !UUID.test(indexRaw), "review-safe");
    const traceHashesBefore = await hashDir(traceDir);

    // Phase B: C20 flow reused by ?script=c21; coverage is read from index state.
    replayServer = await createEncounterServer({ replayDir: traceDir, replayStepMs: 300, scoreDir, scenarios });
    replayPort = replayServer.port;
    staticServer = await startStaticServer(APP_DIST);
    staticPort = staticServer.port;
    const params = new URLSearchParams({ sync: replayServer.url, iwer: "1", autostart: "1", script: "c21", ...(options.mode === "quest" ? { forceIwer: "1" } : {}) });
    run.pageUrl = `http://127.0.0.1:${staticPort}/sync-probe.html?${params}`;
    const outcome = options.mode === "host"
      ? await runHostProbe({ pageUrl: run.pageUrl, outDir })
      : await runQuestProbe({ pageUrl: run.pageUrl, outDir, serial: options.serial });
    run.probe = outcome.probe;
    run.pageErrors = outcome.pageErrors;
    run.consoleErrors = outcome.consoleErrors;
    run.rttMs = summarize(outcome.probe.rttMs ?? []);
    run.frameMs = summarize(outcome.probe.frameMs ?? []);
    const c21 = outcome.probe.c21 ?? {};
    const c20 = outcome.probe.c20 ?? {};
    for (const entry of index.stations) {
      const coverageRecord = (c21.coverageStations ?? []).find((row) => row.stationId === entry.stationId);
      const expectedCounts = countsOf(expected.get(entry.stationId));
      check(
        `U3 ${entry.stationId} page coverage and labels equal U1 counts`,
        JSON.stringify(coverageRecord?.replayRubricCoverage) === JSON.stringify(expectedCounts) &&
          JSON.stringify(coverageRecord?.renderedCoverageLabels) === JSON.stringify(expectedCounts.map((row) => `${row.observedCount}/${row.requiredCount}`)),
        JSON.stringify(coverageRecord),
      );
      const pageRecord = (c20.stations ?? []).find((row) => row.stationId === entry.stationId);
      const scenario = scenarioFor(entry.stationId);
      check(`C20 T1/T4 ${entry.stationId} rubric order and score ack`, JSON.stringify(pageRecord?.rubric?.map((row) => row.id)) === JSON.stringify(scenario.reviewRubric.map((row) => row.rubricId)) && pageRecord?.scoreAcked === true, JSON.stringify(pageRecord));
      const scoreRaw = await readFile(join(scoreDir, `${entry.stationId}${SCORE_SUFFIX}`), "utf8");
      const score = JSON.parse(scoreRaw);
      check(`C20 T2 ${entry.stationId} score file has scenario/order and no labels`, score.scenarioId === scenario.scenarioId && JSON.stringify(score.items.map((row) => row.id)) === JSON.stringify(scenario.reviewRubric.map((row) => row.rubricId)) && scenario.reviewRubric.every((row) => !scoreRaw.includes(row.label)), scoreRaw.slice(0, 220));
    }

    // C20 T3: other-station rubric ids reject and leave the score byte-identical.
    const first = index.stations[0].stationId;
    const otherScenario = scenarioFor(index.stations[1].stationId);
    const scorePath = join(scoreDir, `${first}${SCORE_SUFFIX}`);
    const scoreBefore = await readFile(scorePath, "utf8");
    const reviewer = await connect(replayServer.url, { roomOptions: { replayStationId: first } });
    connections.push(reviewer);
    let replay = null;
    reviewer.onState((state) => { replay = state; });
    await waitFor(() => replay?.replayDone === true, 30000, "T3 replay done");
    const wrong = await reviewer.sendIntent("score-station", { items: Object.fromEntries(otherScenario.reviewRubric.map((item) => [item.rubricId, true])) });
    check("C20 T3 wrong station rubric rejects without changing score", wrong.status === "reject" && wrong.reason === "invalid-score" && await readFile(scorePath, "utf8") === scoreBefore, JSON.stringify(wrong));
    await reviewer.leave();

    check("C20 flow completed without page errors/rejects", outcome.probe.done === true && outcome.probe.error == null && outcome.probe.rejects === 0 && outcome.pageErrors.length === 0, outcome.probe.error ?? "done");
    run.bundleCheck = await collectBundleSentry({ appDist: APP_DIST, appSrcSyncProbe: APP_SRC, extraBanned: rubricLabels });
    check("thin-client bundle/source has no server imports or rubric labels", run.bundleCheck.hits.length === 0, run.bundleCheck.hits.join(" | "));
    check("replay left trace directory byte-identical", JSON.stringify(await hashDir(traceDir)) === JSON.stringify(traceHashesBefore), "sha256 per file");
    if (options.mode === "quest") {
      const lists = await collectQuestCleanupLists({ staticPort, syncPort: replayPort, serial: options.serial });
      run.adbReverseList = lists.adbReverseList;
      run.adbForwardList = lists.adbForwardList;
      check("A8 Quest port cleanup", !lists.leaked, `reverse=${lists.adbReverseList} forward=${lists.adbForwardList}`);
    }
  } catch (error) {
    process.exitCode = 1;
    run.fatal = String(error?.stack ?? error).slice(0, 1200);
  } finally {
    for (const connection of connections) await connection.leave().catch(() => undefined);
    await recordServer?.close().catch(() => undefined);
    await replayServer?.close().catch(() => undefined);
    await staticServer?.close().catch(() => undefined);
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c21-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 240));
    console.log(`wrote ${join(outDir, "c21-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
