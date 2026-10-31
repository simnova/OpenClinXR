#!/usr/bin/env node
/**
 * C15 host/quest harness: the live multi-station exam session boots from the
 * factory's exam blueprint.
 *
 * Host:  node c15-run.mjs --mode host --out <dir>
 * Quest:  node c15-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C15 author; root runs it on-device)
 *
 * Flow: createEncounterServer({ traceDir, examBlueprint }) where the blueprint
 * is the REAL factory form createStep2CsStyleSeedBlueprint(scenarioBank,
 * { stationCount: 2 }) with a test-only timing override (the factory timing
 * doorway 60 s / encounter 900 s / note 600 s would make the run ~50 min; the
 * override is recorded below and in the RESULT) -> serve the built app ->
 * open sync-probe.html?script=c15 in an owned browser target -> the page runs
 * the FIXED C3 turn script once per blueprint station (imported, never
 * forked), renders each station's blueprint label panel, follows the server
 * rotation, finishes when the last station closes -> poll server state during
 * the run -> collect server-side + page-side evidence -> M1-M4 + adapted C7
 * rotation + C9 index checks -> write c15-run.json -> cleanup.
 *
 * Host/quest plumbing comes from harness-lib.mjs (imported, never copied).
 * C3 turn/emotion/cue expectations mirror c4/c6 (same C3 script per station).
 * Exit 1 on any failed assertion. The run file is always written first.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
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
const WORKTREE_ROOT = resolve(HERE, "..", "..", "..", "..");
const SERVER_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "index.js");
const SERVER_ROOM_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "room.js");
const SERVER_TRACE_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "conversation-trace.js");
const SERVER_REVIEW_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "session-review-index.js");
const EXAM_ASSEMBLY_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "exam-assembly", "dist", "index.js");
const SCENARIO_FIXTURES_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "scenario-fixtures", "dist", "index.js");
const CLIENT_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-client", "dist", "index.js");
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const APP_SRC_SYNC_PROBE = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "src", "sync-probe");

// C15 test-only timing override (a harness timing, never edited into the
// factory blueprint): doorway 3 s, encounter 20 s, note 3 s. Provenance: C7/C9
// (the C3 script takes 8-12 s on Quest, so a 20 s encounter covers one script
// per station with margin; doorway/note 3 s keep the run short). The factory
// timing (doorway 60 s / encounter 900 s / note 600 s) would make the run last
// ~50 min, so the blueprint is passed to the server with ONLY its timing
// replaced; slots, order, labels, and id are the factory's own.
const TIMING_OVERRIDE = { doorwaySeconds: 3, encounterSeconds: 20, noteSeconds: 3 };
// Rotation/index liveness bounds (same provenance as C8/C9: 1 doorway second).
const ROTATION_GAP_MAX_MS = 1000;
const REVIEW_INDEX_LAG_MAX_MS = 1000;
// M3 phase-duration tolerance: one phase-clock tick (the StationPhaseClock
// countdown decrements remainingS once per 1000 ms; the boundary guard fires
// at the same deadline — source: phase-clock.ts StationPhaseClock#enter).
const PHASE_TICK_TOLERANCE_MS = 1000;
const PHASE_TICK_SOURCE = "phase-clock.ts StationPhaseClock countdown interval (1000 ms)";
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
  const { createStep2CsStyleSeedBlueprint } = await import(EXAM_ASSEMBLY_DIST);
  const { scenarioBank } = await import(SCENARIO_FIXTURES_DIST);
  const { connect: connectObserver } = await import(CLIENT_DIST);
  const expectedReplyIds = [pickC3Reply(1).id, pickC3Reply(2).id, pickC3Reply(3).id];
  const replyTexts = C3_REPLY_TABLE.map((entry) => entry.text);

  // The real factory blueprint (slots, order, labels, id); timing overridden.
  const factoryBlueprint = createStep2CsStyleSeedBlueprint(scenarioBank, { stationCount: 2 });
  const blueprint = {
    ...factoryBlueprint,
    timing: { ...factoryBlueprint.timing, ...TIMING_OVERRIDE },
  };
  const slotIds = blueprint.stationSlots.map((slot) => slot.slotId);
  const slotLabels = blueprint.stationSlots.map((slot) => slot.label);

  const syncServer = await createEncounterServer({ traceDir, examBlueprint: blueprint });
  const staticServer = await startStaticServer(APP_DIST);
  const cleanup = { syncClosed: false, staticClosed: false, observerLeft: false };

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    script: "c15",
    pageScript: "c15",
    blueprintId: blueprint.blueprintId,
    blueprintSlots: blueprint.stationSlots.map((slot) => ({ slotId: slot.slotId, order: slot.order, label: slot.label })),
    factoryTiming: { ...factoryBlueprint.timing },
    timingOverride: { ...TIMING_OVERRIDE },
    timing: { ...blueprint.timing },
    traceDir,
    syncUrl: syncServer.url,
    pageUrl: null,
    probe: null,
    serverState: null,
    probeStats: null,
    serverTrace: null,
    expectedReplyIds,
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
    phaseDurationsMs: null,
    phaseTickToleranceMs: PHASE_TICK_TOLERANCE_MS,
    phaseTickSource: PHASE_TICK_SOURCE,
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
        stationLabel: state.stationLabel ?? null,
        blueprintId: state.blueprintId ?? null,
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
        seenStations.push({ stationId, stationLabel: snapshot?.stationLabel ?? null, dateNowMs: Date.now(), perfNowMs: Number(performance.now().toFixed(2)) });
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
      script: "c15",
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

    // Settle: no rotation after the last station closed.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const settledState = JSON.parse(syncServer.getStateJSON());

    // Observer leaves BEFORE server close (last trace records left).
    const observerSessionId = observer.sessionId;
    await observer.leave();
    cleanup.observerLeft = true;
    observer = null;
    run.serverState = JSON.parse(syncServer.getStateJSON());
    const stationPoseCounts = syncServer.getStationPoseCounts();

    await syncServer.close();
    cleanup.syncClosed = true;

    const lastSlot = slotIds[slotIds.length - 1];

    // M1: the server ran the blueprint's slots in blueprint order.
    const observedStations = (probe.stationsObserved ?? []).map((s) => s.stationId);
    check(
      "M1 server stationId sequence == the blueprint slotIds in order",
      JSON.stringify(observedStations) === JSON.stringify(slotIds),
      `got=${JSON.stringify(observedStations)} want=${JSON.stringify(slotIds)}`,
    );
    check(
      "M1 stationCount == blueprint slot count",
      settledState.stationCount === slotIds.length,
      `stationCount=${settledState.stationCount} slots=${slotIds.length}`,
    );
    const tailStations = samples.slice(-40).map((s) => s.stationId);
    check(
      "M1 no rotation after the last blueprint station closed",
      settledState.stationId === lastSlot &&
        settledState.phase === "closed" &&
        tailStations.every((s) => s === lastSlot),
      `state=${settledState.stationId}:${settledState.phase} tail=${[...new Set(tailStations)].join(",")}`,
    );

    // M2: the page rendered each blueprint label, in order.
    const rendered = (probe.c15?.labelsRendered ?? []).map((s) => [s.stationId, s.stationLabel]);
    check(
      "M2 the page rendered each station's blueprint label, in order",
      JSON.stringify(rendered) === JSON.stringify(slotIds.map((id, i) => [id, slotLabels[i]])),
      `got=${JSON.stringify(rendered)}`,
    );
    check(
      "M2 page panel shows the last blueprint label",
      typeof probe.c15?.panelText === "string" && probe.c15.panelText.includes(slotLabels[slotLabels.length - 1]),
      `panel=${String(probe.c15?.panelText).slice(0, 120)}`,
    );

    // M3: observed phase durations match the blueprint timing (one-tick tolerance).
    const changedAt = run.probeStats.phaseChangedAtMs ?? {};
    const doorwayDur = (changedAt.encounter ?? NaN) - (changedAt.doorway ?? NaN);
    const encounterDur = (changedAt.note ?? NaN) - (changedAt.encounter ?? NaN);
    const noteDur = (changedAt.closed ?? NaN) - (changedAt.note ?? NaN);
    run.phaseDurationsMs = {
      doorway: Number.isFinite(doorwayDur) ? Math.round(doorwayDur) : null,
      encounter: Number.isFinite(encounterDur) ? Math.round(encounterDur) : null,
      note: Number.isFinite(noteDur) ? Math.round(noteDur) : null,
    };
    const withinTick = (measured, seconds) => Number.isFinite(measured) && Math.abs(measured - seconds * 1000) <= PHASE_TICK_TOLERANCE_MS;
    check(
      "M3 doorway/encounter/note durations match the blueprint timing (tolerance one tick)",
      withinTick(doorwayDur, blueprint.timing.doorwaySeconds) &&
        withinTick(encounterDur, blueprint.timing.encounterSeconds) &&
        withinTick(noteDur, blueprint.timing.noteSeconds),
      `got=${JSON.stringify(run.phaseDurationsMs)} want=${JSON.stringify({ doorway: blueprint.timing.doorwaySeconds * 1000, encounter: blueprint.timing.encounterSeconds * 1000, note: blueprint.timing.noteSeconds * 1000 })} tol=${PHASE_TICK_TOLERANCE_MS}ms (${PHASE_TICK_SOURCE})`,
    );

    // M4: the review index records which blueprint ran.
    const dirEntries = await readdir(traceDir);
    const indexFiles = dirEntries.filter((f) => f === SESSION_REVIEW_INDEX_FILE);
    const indexRaw = indexFiles.length === 1 ? await readFile(join(traceDir, SESSION_REVIEW_INDEX_FILE), "utf8") : null;
    const index = indexRaw ? JSON.parse(indexRaw) : null;
    run.reviewIndex = index;
    check(
      "M4 review index blueprintId == the blueprint id, entries carry the slot labels in order",
      index !== null &&
        index.blueprintId === blueprint.blueprintId &&
        index.complete === true &&
        index.stationCount === slotIds.length &&
        JSON.stringify((index.stations ?? []).map((s) => [s.stationId, s.stationIndex, s.stationLabel])) ===
          JSON.stringify(slotIds.map((id, i) => [id, i, slotLabels[i]])),
      `blueprintId=${index?.blueprintId} stations=${JSON.stringify((index?.stations ?? []).map((s) => [s.stationId, s.stationLabel]))}`,
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
          `M4 ${entry.stationId} entry links its trace file and agrees with it`,
          trace !== null &&
            typeof entry.traceFile === "string" &&
            entry.traceFile.endsWith(".conversation-trace.json") &&
            trace.stationId === entry.stationId &&
            JSON.stringify(entry.phases) === JSON.stringify(tracePhases) &&
            entry.turnCount === (trace.turns ?? []).length &&
            JSON.stringify(entry.turnEnds) === JSON.stringify(traceTurnEnds),
          `traceFile=${entry.traceFile} phases=${JSON.stringify(entry.phases)}`,
        );
      }
      const learnerSessionIds = Object.keys(probe.lastServerState?.learners ?? {});
      const knownIds = [observerSessionId, ...learnerSessionIds].filter((id) => typeof id === "string" && id.length > 0);
      const leakedId = knownIds.find((id) => indexRaw.includes(id));
      const leakedText = replyTexts.find((text) => indexRaw.includes(text));
      check(
        "M4 no learner/observer sessionId, nonce, timestamp, or reply text in the index",
        leakedId === undefined &&
          !UUID_PATTERN.test(indexRaw) &&
          !/__c7|nonce/i.test(indexRaw) &&
          !/"atMs"|"timestamp"/i.test(indexRaw) &&
          leakedText === undefined,
        leakedId === undefined && leakedText === undefined ? "clean" : `leakedId=${leakedId !== undefined} leakedText=${leakedText !== undefined}`,
      );
      const closedAtMs = run.probeStats.phaseChangedAtMs?.closed ?? NaN;
      const indexStat = await stat(join(traceDir, SESSION_REVIEW_INDEX_FILE));
      const lagMs = indexStat.mtimeMs - closedAtMs;
      run.reviewIndexWriteLagMs = Number.isFinite(lagMs) ? Number(lagMs.toFixed(2)) : null;
      check(
        "M4 index written within 1000 ms of the last station closed phaseChangedAtMs",
        Number.isFinite(lagMs) && lagMs >= 0 && lagMs <= REVIEW_INDEX_LAG_MAX_MS,
        `lag=${Number.isFinite(lagMs) ? lagMs.toFixed(1) : "NaN"}ms`,
      );
    } else {
      check("M4 review index blueprintId == the blueprint id, entries carry the slot labels in order", false, "no index file");
    }

    // C7 rotation checks where they apply: gap, observer, lossless counts.
    const prevClosedAt = changedAt["prev-station-closed"] ?? NaN;
    const station2DoorwayAt = changedAt.doorway ?? NaN;
    const gap = station2DoorwayAt - prevClosedAt;
    run.rotationGapMs = Number.isFinite(gap) ? Math.round(gap) : null;
    check(
      "C7 rotation gap 0 <= doorway(last) - closed(first) <= 1000 ms",
      Number.isFinite(gap) && gap >= 0 && gap <= ROTATION_GAP_MAX_MS,
      `gap=${Number.isFinite(gap) ? Math.round(gap) : "NaN"}ms`,
    );
    const observerStationIds = run.observerReported.stations.map((s) => s.stationId);
    check(
      "C7 observer saw every blueprint station in order",
      JSON.stringify(observerStationIds) === JSON.stringify(slotIds),
      `got=${JSON.stringify(observerStationIds)}`,
    );
    const sentSeqs = probe.sentSeqs ?? [];
    const ackSeqs = probe.ackSeqs ?? [];
    const ackedInOrder =
      ackSeqs.length > 0 && ackSeqs.every((seq, i) => (i === 0 || seq > ackSeqs[i - 1]) && sentSeqs.includes(seq));
    const sentByKind = probe.sentByKind ?? {};
    const inOrder =
      sentSeqs.length > 0 &&
      sentSeqs.length === ackSeqs.length + probe.rejects &&
      sentSeqs.every((seq, i) => seq === i + 1) &&
      ackedInOrder;
    const outsideRejects = (probe.rejectDetails ?? []).filter((r) => r.reason === "outside-encounter-phase");
    check(
      "C7 every page intent acked in order across both rooms, rejects exactly 2 pre-encounter probes",
      probe.rejects === 2 &&
        outsideRejects.length === 2 &&
        (sentByKind["utterance-start"] ?? 0) === 6 &&
        (sentByKind["utterance-end"] ?? 0) === 6 &&
        (sentByKind["select-actor"] ?? 0) === 4 &&
        (sentByKind.pose ?? 0) > 0 &&
        inOrder,
      `sent=${sentSeqs.length} acks=${ackSeqs.length} rejects=${probe.rejects} kinds=${JSON.stringify(sentByKind)}`,
    );
    const serverPose = Object.values(stationPoseCounts).reduce((sum, n) => sum + n, 0);
    check(
      "C7 server cross-check: summed pose counts == page sent pose count",
      (sentByKind.pose ?? 0) > 0 && serverPose === (sentByKind.pose ?? 0),
      `server=${serverPose} page=${sentByKind.pose ?? 0}`,
    );

    // Completion + bundle sentries.
    check("probe completed without error", probe.done === true && probe.error == null, probe.error ?? "done");
    check("no page errors", (run.pageErrors ?? []).length === 0, (run.pageErrors ?? []).join(" | ").slice(0, 300) || "0 pageerrors");
    check(
      "bundle/source free of server imports and reply-table text",
      run.bundleCheck.hits.length === 0,
      run.bundleCheck.hits.join(" | ").slice(0, 300) || "clean",
    );

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
    await writeFile(join(outDir, "c15-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c15-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
process.exit(process.exitCode ?? 0);
