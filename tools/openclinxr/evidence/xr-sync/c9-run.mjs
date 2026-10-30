#!/usr/bin/env node
/**
 * C9 host/quest harness: the exam session ends with one server-written
 * review index linking each station's trace.
 *
 * Host:  node c9-run.mjs --mode host --out <dir>
 * Quest:  node c9-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C9 author; root runs it on-device)
 *
 * Flow: same two-station C8 run (script=c8 page flow: the fixed C3 turn
 * script once per station with pose streaming + the host Node observer), then
 * after the session the C9 assertions:
 *   G1 exactly one exam-session.review-index.json, schema v1, complete true,
 *      stations [station-1, station-2].
 *   G2 each entry's traceFile exists and its stationId/phases/turnEnds/
 *      turnCount equal that trace (turnEnds [completed,interrupted,completed]
 *      per station from the C3 script).
 *   G3 observerPresent [true, true].
 *   G4 no learner/observer sessionId, no nonce, no timestamp, no reply text
 *      in the index (reply texts read from the server table, never hardcoded).
 *   G5 index written within 1000 ms of the last station's closed
 *      phaseChangedAtMs (measured value recorded).
 * plus all C8 checks reused via c8-checks.mjs (imported, never copied).
 *
 * Host/quest plumbing comes from harness-lib.mjs (imported, never copied).
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  C8_EXPECTED_EMOTIONS as EXPECTED_C4_EMOTIONS,
  C8_STATIONS as STATIONS,
  evaluateC8Evidence,
} from "./c8-checks.mjs";
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
const WORKTREE_ROOT = resolve(HERE, "..", "..", "..", "..");
const SERVER_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "index.js");
const SERVER_ROOM_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "room.js");
const SERVER_TRACE_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "conversation-trace.js");
const SERVER_REVIEW_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "session-review-index.js");
const CLIENT_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-client", "dist", "index.js");
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const APP_SRC_SYNC_PROBE = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "src", "sync-probe");

// C9 station timing: same provenance as C8 (doorway 3 s, encounter 20 s,
// note 3 s). Index liveness bound: 1 doorway second (1000 ms).
const TIMING = { doorwaySeconds: 3, encounterSeconds: 20, noteSeconds: 3 };
const REVIEW_INDEX_LAG_MAX_MS = 1000;
const EXPECTED_TURN_ENDS = ["completed", "interrupted", "completed"];
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function observerStationOf(snapshot) {
  return typeof snapshot?.stationId === "string" ? snapshot.stationId : "";
}

async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const traceDir = join(outDir, "trace");
  await mkdir(traceDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  const serverModule = await import(SERVER_DIST);
  const { createEncounterServer } = serverModule;
  const { pickC3Reply, C3_REPLY_TABLE } = await import(SERVER_ROOM_DIST);
  const { CONVERSATION_TRACE_SCHEMA, replayConversationTrace } = await import(SERVER_TRACE_DIST);
  const { SESSION_REVIEW_INDEX_SCHEMA, SESSION_REVIEW_INDEX_FILE } = await import(SERVER_REVIEW_DIST);
  const { connect: connectObserver } = await import(CLIENT_DIST);
  const expectedReplyIds = [pickC3Reply(1).id, pickC3Reply(2).id, pickC3Reply(3).id];
  const replyTexts = C3_REPLY_TABLE.map((entry) => entry.text);
  const syncServer = await createEncounterServer({ traceDir, timing: { ...TIMING }, stations: [...STATIONS] });
  const staticServer = await startStaticServer(APP_DIST);
  const cleanup = { syncClosed: false, staticClosed: false, observerLeft: false };

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    script: "c9",
    pageScript: "c8",
    timing: { ...TIMING },
    stations: [...STATIONS],
    traceDir,
    syncUrl: syncServer.url,
    pageUrl: null,
    probe: null,
    serverState: null,
    probeStats: null,
    serverTrace: null,
    expectedReplyIds,
    expectedEmotions: EXPECTED_C4_EMOTIONS,
    expectedTurnEnds: [...EXPECTED_TURN_ENDS],
    reviewIndexSchema: SESSION_REVIEW_INDEX_SCHEMA,
    reviewIndexFile: SESSION_REVIEW_INDEX_FILE,
    rttMs: null,
    frameMs: null,
    assertions: [],
    pageErrors: [],
    consoleErrors: [],
    adbReverseList: null,
    adbForwardList: null,
    bundleCheck: null,
    traceFiles: [],
    reviewIndex: null,
    reviewIndexWriteLagMs: null,
    rotationGapMs: null,
    learnerArrivalLagMs: null,
    observerArrivalLagMs: null,
    pollSamples: 0,
    elapsedMs: null,
    observerReported: { sessionId: null, stations: [], changes: [] },
  };

  const samples = [];
  const pollTimer = setInterval(() => {
    try {
      const state = JSON.parse(syncServer.getStateJSON());
      const stats = syncServer.getProbeStats();
      samples.push({
        atMs: Date.now(),
        stationId: state.stationId,
        phase: state.phase,
        observerCount: state.observerCount,
        phaseChangedAtMs: { ...(stats.phaseChangedAtMs ?? {}) },
        intentCounts: { ...(stats.intentCounts ?? {}) },
      });
    } catch {
      // No live room yet; skip.
    }
  }, 50);

  let exitCode = 0;
  let observer = null;
  try {
    observer = await connectObserver(syncServer.url, {
      roomOptions: { actors: ["a1", "a2"], role: "observer" },
    });
    run.observerReported.sessionId = observer.sessionId;
    const seenStations = run.observerReported.stations;
    const changes = run.observerReported.changes;
    let lastStation = null;
    observer.onState((snapshot) => {
      const stationId = observerStationOf(snapshot);
      if (stationId !== "" && stationId !== lastStation) {
        lastStation = stationId;
        seenStations.push({ stationId, dateNowMs: Date.now(), perfNowMs: Number(performance.now().toFixed(2)) });
      }
      changes.push({
        stationId,
        observerCount: snapshot?.observerCount ?? null,
        dateNowMs: Date.now(),
      });
    });

    const params = new URLSearchParams({
      sync: syncServer.url,
      iwer: "1",
      autostart: "1",
      script: "c8",
      ...(options.mode === "quest" ? { forceIwer: "1" } : {}),
    });
    run.pageUrl = `http://127.0.0.1:${staticServer.port}/sync-probe.html?${params.toString()}`;

    const outcome =
      options.mode === "host"
        ? await runHostProbe({ pageUrl: run.pageUrl, outDir })
        : await runQuestProbe({ pageUrl: run.pageUrl, outDir, serial: options.serial });
    run.probe = outcome.probe;
    run.pageErrors = outcome.pageErrors;
    run.consoleErrors = outcome.consoleErrors;
    run.browserProduct = outcome.browserProduct;
    run.pollSamples = samples.length;

    const probe = outcome.probe;
    run.serverState = JSON.parse(syncServer.getStateJSON());
    run.probeStats = syncServer.getProbeStats();
    run.serverTrace = syncServer.getConversationTrace();
    run.rttMs = summarize(probe.rttMs ?? []);
    run.frameMs = summarize(probe.frameMs ?? []);
    run.bundleCheck = await collectBundleSentry({
      appDist: APP_DIST,
      appSrcSyncProbe: APP_SRC_SYNC_PROBE,
      extraBanned: replyTexts,
    });

    const check = (name, pass, detail) => {
      run.assertions.push({ name, pass: Boolean(pass), detail: String(detail ?? "") });
      if (!pass) {
        exitCode = 1;
      }
    };

    // E6: no rotation after station-2 closed (settledState feeds the shared E6 check).
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const settledState = JSON.parse(syncServer.getStateJSON());

    // Observer leaves BEFORE server close (station-2 trace records left).
    const observerSessionId = observer.sessionId;
    await observer.leave();
    cleanup.observerLeft = true;
    observer = null;
    run.serverState = JSON.parse(syncServer.getStateJSON());
    const stationPoseCounts = syncServer.getStationPoseCounts();

    await syncServer.close();
    cleanup.syncClosed = true;

    // All C8 checks reused (imported, never copied).
    const c8 = await evaluateC8Evidence({
      probe,
      probeStats: run.probeStats,
      settledState,
      samples,
      observerStations: run.observerReported.stations,
      observerSessionId,
      traceDir,
      expectedReplyIds,
      expectedEmotions: EXPECTED_C4_EMOTIONS,
      replyTable: C3_REPLY_TABLE,
      traceSchema: CONVERSATION_TRACE_SCHEMA,
      replayTrace: replayConversationTrace,
      bundleCheck: run.bundleCheck,
      stationPoseCounts,
      pageErrors: run.pageErrors,
    });
    run.traceFiles = c8.traceFiles;
    run.rotationGapMs = c8.rotationGapMs;
    run.learnerArrivalLagMs = c8.learnerArrivalLagMs;
    run.observerArrivalLagMs = c8.observerArrivalLagMs;
    run.stationPoseCounts = stationPoseCounts;
    for (const assertion of c8.assertions) {
      check(assertion.name, assertion.pass, assertion.detail);
    }

    // C9 G1-G5: the exam session review index.
    const dirEntries = await readdir(traceDir);
    const indexFiles = dirEntries.filter((f) => f === SESSION_REVIEW_INDEX_FILE);
    const indexRaw = indexFiles.length === 1 ? await readFile(join(traceDir, SESSION_REVIEW_INDEX_FILE), "utf8") : null;
    const index = indexRaw ? JSON.parse(indexRaw) : null;
    run.reviewIndex = index;
    check(
      "G1 exactly one exam-session.review-index.json, schema v1, complete true, stations [station-1,station-2]",
      indexFiles.length === 1 &&
        index?.schema === SESSION_REVIEW_INDEX_SCHEMA &&
        index?.complete === true &&
        index?.stationCount === 2 &&
        JSON.stringify((index?.stations ?? []).map((s) => [s.stationId, s.stationIndex])) ===
          JSON.stringify([["station-1", 0], ["station-2", 1]]),
      `files=${indexFiles.join(",")} schema=${index?.schema} complete=${index?.complete} stations=${JSON.stringify((index?.stations ?? []).map((s) => s.stationId))}`,
    );
    if (index) {
      for (const entry of index.stations) {
        const tracePath = join(traceDir, entry.traceFile);
        let trace = null;
        try {
          trace = JSON.parse(await readFile(tracePath, "utf8"));
        } catch {
          trace = null;
        }
        const tracePhases = (trace?.events ?? []).filter((e) => e.kind === "phase-changed").map((e) => e.phase);
        const traceTurnEnds = (trace?.turns ?? []).map((t) => t.end);
        check(
          `G2 ${entry.stationId} entry links its trace file and agrees with it`,
          trace !== null &&
            typeof entry.traceFile === "string" &&
            entry.traceFile.endsWith(".conversation-trace.json") &&
            trace.stationId === entry.stationId &&
            JSON.stringify(entry.phases) === JSON.stringify(tracePhases) &&
            entry.turnCount === (trace.turns ?? []).length &&
            JSON.stringify(entry.turnEnds) === JSON.stringify(traceTurnEnds),
          `traceFile=${entry.traceFile} phases=${JSON.stringify(entry.phases)} turnEnds=${JSON.stringify(entry.turnEnds)}`,
        );
        check(
          `G2 ${entry.stationId} turnEnds == [completed,interrupted,completed] from the C3 script`,
          JSON.stringify(entry.turnEnds) === JSON.stringify(EXPECTED_TURN_ENDS),
          `got=${JSON.stringify(entry.turnEnds)}`,
        );
      }
      check(
        "G3 observerPresent [true, true]",
        JSON.stringify(index.stations.map((s) => s.observerPresent)) === JSON.stringify([true, true]),
        `got=${JSON.stringify(index.stations.map((s) => s.observerPresent))}`,
      );
      const learnerSessionIds = Object.keys(probe.lastServerState?.learners ?? {});
      const knownIds = [observerSessionId, ...learnerSessionIds].filter((id) => typeof id === "string" && id.length > 0);
      const leakedId = knownIds.find((id) => indexRaw.includes(id));
      const leakedText = replyTexts.find((text) => indexRaw.includes(text));
      check(
        "G4 no learner/observer sessionId, nonce, timestamp, or reply text in the index",
        leakedId === undefined &&
          !UUID_PATTERN.test(indexRaw) &&
          !/__c7|nonce/i.test(indexRaw) &&
          !/"atMs"|"timestamp"/i.test(indexRaw) &&
          leakedText === undefined,
        `leakedId=${leakedId === undefined ? "none" : String(leakedId).slice(0, 8)} uuid=${UUID_PATTERN.test(indexRaw)} leakedText=${leakedText === undefined ? "none" : leakedText.slice(0, 30)}`,
      );
      const closedAtMs = run.probeStats.phaseChangedAtMs?.closed ?? NaN;
      const indexStat = await stat(join(traceDir, SESSION_REVIEW_INDEX_FILE));
      const lagMs = indexStat.mtimeMs - closedAtMs;
      run.reviewIndexWriteLagMs = Number.isFinite(lagMs) ? Number(lagMs.toFixed(2)) : null;
      check(
        "G5 index written within 1000 ms of the last station closed phaseChangedAtMs",
        Number.isFinite(lagMs) && lagMs >= 0 && lagMs <= REVIEW_INDEX_LAG_MAX_MS,
        `lag=${Number.isFinite(lagMs) ? lagMs.toFixed(1) : "NaN"}ms closed=${Math.round(closedAtMs)} mtime=${Math.round(indexStat.mtimeMs)}`,
      );
    } else {
      check("G1 exactly one exam-session.review-index.json, schema v1, complete true, stations [station-1,station-2]", false, "no index file");
      check("G3 observerPresent [true, true]", false, "no index file");
      check("G4 no learner/observer sessionId, nonce, timestamp, or reply text in the index", false, "no index file");
      check("G5 index written within 1000 ms of the last station closed phaseChangedAtMs", false, "no index file");
    }

    if (options.mode === "quest") {
      const { adbReverseList, adbForwardList, leaked } = await collectQuestCleanupLists({
        staticPort: staticServer.port,
        syncPort: syncServer.port,
        serial: options.serial,
      });
      run.adbReverseList = adbReverseList;
      run.adbForwardList = adbForwardList;
      check(
        "A8 adb reverse/forward lists contain neither run port nor tcp:9222 after cleanup",
        !leaked,
        `reverse=${(adbReverseList ?? "").slice(0, 200)} forward=${(adbForwardList ?? "").slice(0, 200)}`,
      );
    }
  } catch (error) {
    exitCode = 1;
    run.fatal = String(error?.stack ?? error).slice(0, 1000);
  } finally {
    clearInterval(pollTimer);
    if (observer) {
      try {
        await observer.leave();
        cleanup.observerLeft = true;
      } catch {
        // best-effort
      }
    }
    if (!cleanup.syncClosed) {
      try {
        await syncServer.close();
        cleanup.syncClosed = true;
      } catch {
        // best-effort
      }
    }
    try {
      await staticServer.close();
      cleanup.staticClosed = true;
    } catch {
      // best-effort
    }
    run.cleanup = cleanup;
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c9-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c9-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
process.exit(process.exitCode ?? 0);
