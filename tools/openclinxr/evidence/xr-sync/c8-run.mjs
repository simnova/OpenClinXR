#!/usr/bin/env node
/**
 * C8 host/quest harness: the faculty observer follows the learner through
 * rotation, and rotation loses no intent.
 *
 * Host:  node c8-run.mjs --mode host --out <dir>
 * Quest:  node c8-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C8 author; root runs it on-device)
 *
 * Flow: start createEncounterServer({ traceDir: <out>/trace, timing,
 * stations: ["station-1","station-2"] }) -> connect a host Node observer
 * (C5 pattern, role observer) BEFORE opening the page -> serve the built app
 * -> open sync-probe.html?script=c8 (the c7 station loop imported, pose
 * streaming LEFT ON across rotation) -> the page runs the FIXED C3 turn
 * script once per station with pose streaming through rotation -> finish when
 * station 2 closes -> observer leaves before server close -> collect
 * server-side + page-side + observer-side evidence -> F1-F6 + E1-E3/E6 + A8 ->
 * write c8-run.json -> cleanup.
 *
 * Host/quest plumbing comes from harness-lib.mjs (imported, never copied).
 */

import { mkdir, writeFile } from "node:fs/promises";
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
const CLIENT_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-client", "dist", "index.js");
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const APP_SRC_SYNC_PROBE = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "src", "sync-probe");

// C8 station timing: same provenance as C7 (doorway 3 s, encounter 20 s,
// note 3 s). Rotation liveness bound: 1 doorway second (1000 ms).
const TIMING = { doorwaySeconds: 3, encounterSeconds: 20, noteSeconds: 3 };

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
    script: "c8",
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
    rttMs: null,
    frameMs: null,
    assertions: [],
    pageErrors: [],
    consoleErrors: [],
    adbReverseList: null,
    adbForwardList: null,
    bundleCheck: null,
    traceFiles: [],
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

    // All E1-E3/E6/E4/F1-F6/bundle/completion bodies live in c8-checks.mjs.
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
    await writeFile(join(outDir, "c8-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c8-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
process.exit(process.exitCode ?? 0);
