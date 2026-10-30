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
const STATIONS = ["station-1", "station-2"];
const EXPECTED_PHASES = ["doorway", "encounter", "note", "closed"];
const ROTATION_GAP_MAX_MS = 1000;
const ARRIVAL_LAG_MAX_MS = 1000;

const EXPECTED_C4_EMOTIONS = [
  { from: "neutral", to: "reassured", trigger: "learner_acknowledgement", changed: true },
  { from: "reassured", to: "reassured", trigger: "learner_acknowledgement", changed: false },
  { from: "reassured", to: "concerned", trigger: "learner_interruption", changed: true },
  { from: "concerned", to: "neutral", trigger: "learner_acknowledgement", changed: true },
];

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

    const station1Samples = samples.filter((s) => s.stationId === "station-1");
    const prevClosedAt = run.probeStats.phaseChangedAtMs?.["prev-station-closed"] ?? NaN;
    const station2DoorwayAt = run.probeStats.phaseChangedAtMs?.doorway ?? NaN;
    const gap = station2DoorwayAt - prevClosedAt;
    run.rotationGapMs = Number.isFinite(gap) ? Math.round(gap) : null;

    const sentSeqs = probe.sentSeqs ?? [];
    const ackSeqs = probe.ackSeqs ?? [];
    const ackedInOrder =
      ackSeqs.length > 0 && ackSeqs.every((seq, i) => (i === 0 || seq > ackSeqs[i - 1]) && sentSeqs.includes(seq));

    // E6: no rotation after station-2 closed.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const settledState = JSON.parse(syncServer.getStateJSON());
    const tailStations = samples.slice(-40).map((s) => s.stationId);
    check(
      "E6 no rotation after station-2 closed (state stays station-2)",
      settledState.stationId === "station-2" &&
        settledState.phase === "closed" &&
        tailStations.every((s) => s === "station-2"),
      `state=${settledState.stationId}:${settledState.phase} tail=${[...new Set(tailStations)].join(",")}`,
    );

    // Observer leaves BEFORE server close (station-2 trace records left).
    const observerSessionId = observer.sessionId;
    await observer.leave();
    cleanup.observerLeft = true;
    observer = null;
    run.serverState = JSON.parse(syncServer.getStateJSON());

    await syncServer.close();
    cleanup.syncClosed = true;

    const traceFiles = (await readdir(traceDir)).filter((f) => f.endsWith(".conversation-trace.json"));
    run.traceFiles = [...traceFiles].sort();
    const persisted = [];
    for (const file of run.traceFiles) {
      persisted.push(JSON.parse(await readFile(join(traceDir, file), "utf8")));
    }
    const byStation = new Map(persisted.map((t) => [t.stationId, t]));

    // E1: exactly 2 trace files with phase sequences and replay.
    check(
      "E1 exactly 2 trace files with stationIds [station-1,station-2]",
      run.traceFiles.length === 2 &&
        JSON.stringify([...persisted.map((t) => t.stationId)].sort()) === JSON.stringify(["station-1", "station-2"]),
      `files=${run.traceFiles.join(",")} stations=${persisted.map((t) => t.stationId).join(",")}`,
    );
    for (const stationId of STATIONS) {
      const trace = byStation.get(stationId);
      const phases = (trace?.events ?? []).filter((e) => e.kind === "phase-changed").map((e) => e.phase);
      check(
        `E1 ${stationId} phase-changed sequence == [doorway,encounter,note,closed]`,
        JSON.stringify(phases) === JSON.stringify(EXPECTED_PHASES),
        `got=${JSON.stringify(phases)}`,
      );
      if (trace) {
        const replayed = replayConversationTrace(trace);
        check(
          `E1 ${stationId} trace replays to itself`,
          JSON.stringify(replayed.turns) === JSON.stringify(trace.turns) &&
            JSON.stringify(replayed.emotions) === JSON.stringify(trace.emotions),
          `turns=${trace.turns?.length} emotions=${trace.emotions?.length} schema=${trace.schema}`,
        );
        check(
          `E1 ${stationId} trace schema + top-level stationId`,
          trace.schema === CONVERSATION_TRACE_SCHEMA && trace.stationId === stationId,
          `schema=${trace.schema} stationId=${trace.stationId}`,
        );
      } else {
        check(`E1 ${stationId} trace replays to itself`, false, "no trace file");
        check(`E1 ${stationId} trace schema + top-level stationId`, false, "no trace file");
      }
    }

    // E2: turns/feelings/cues per station.
    for (const stationId of STATIONS) {
      const trace = byStation.get(stationId);
      const turns = trace?.turns ?? [];
      check(
        `E2 ${stationId} turns end [completed,interrupted,completed], ids [1,2,3], all a1`,
        JSON.stringify(turns.map((t) => t.end)) === JSON.stringify(["completed", "interrupted", "completed"]) &&
          JSON.stringify(turns.map((t) => t.turnId)) === JSON.stringify([1, 2, 3]) &&
          turns.every((t) => t.actorId === "a1"),
        turns.map((t) => `${t.turnId}:${t.actorId}:${t.replyId}:${t.end}`).join(" ") || "no turns",
      );
      check(
        `E2 ${stationId} replyIds equal server table/picker sequence`,
        JSON.stringify(turns.map((t) => t.replyId)) === JSON.stringify(expectedReplyIds),
        `got=${turns.map((t) => t.replyId).join(",")} want=${expectedReplyIds.join(",")}`,
      );
      const emotions = (trace?.emotions ?? []).map(({ from, to, trigger, changed }) => ({ from, to, trigger, changed }));
      check(
        `E2 ${stationId} emotions equal the policy literal for the C3 script`,
        JSON.stringify(emotions) === JSON.stringify(EXPECTED_C4_EMOTIONS),
        `got=${JSON.stringify(emotions)}`,
      );
      const cueByReplyId = new Map(C3_REPLY_TABLE.map((entry) => [entry.id, entry.cueId]));
      const cueIds = turns.map((t) => t.cueId);
      check(
        `E2 ${stationId} cueIds 3 distinct, each equals the table row for its replyId`,
        new Set(cueIds).size === 3 &&
          cueIds.every((cue) => typeof cue === "string" && cue.length > 0) &&
          turns.every((t) => cueByReplyId.get(t.replyId) === t.cueId),
        turns.map((t) => `${t.turnId}:${t.replyId}:${t.cueId}`).join(" ") || "no turns",
      );
    }

    // E3: server-side room-creation gap figure (kept; F4 is the arrival measure).
    check(
      "E3 rotation gap 0 <= doorway(station-2) - closed(station-1) <= 1000 ms",
      Number.isFinite(gap) && gap >= 0 && gap <= ROTATION_GAP_MAX_MS,
      `gap=${Number.isFinite(gap) ? Math.round(gap) : "NaN"} closed1=${Math.round(prevClosedAt)} doorway2=${Math.round(station2DoorwayAt)} samples=${samples.length}`,
    );

    // E4 stationsObserved + F6 pageLoadId before/after same (not only non-empty).
    const observedStations = (probe.stationsObserved ?? []).map((s) => s.stationId);
    check(
      "E4 (page-reported) stationsObserved == [station-1,station-2] in order",
      JSON.stringify(observedStations) === JSON.stringify(STATIONS),
      `got=${JSON.stringify(observedStations)}`,
    );
    const loadIds = (probe.stationsObserved ?? []).map((s) => s.pageLoadId);
    const f6Pass =
      typeof probe.pageLoadId === "string" &&
      probe.pageLoadId.length > 0 &&
      loadIds.length === 2 &&
      loadIds.every((id) => id === probe.pageLoadId);
    check(
      "F6 pageLoadId compared before and after rotation (same value)",
      f6Pass,
      `pageLoadId=${String(probe.pageLoadId).slice(0, 20)} stations=${loadIds.map((id) => String(id).slice(0, 8)).join(",")}`,
    );

    // F1: observer onState stations + observerCount per station.
    const observerStations = seenStations.map((s) => s.stationId);
    const f1StationsPass = JSON.stringify(observerStations) === JSON.stringify(STATIONS);
    const s1Count1 = station1Samples.some((s) => s.observerCount === 1);
    const s2Count1 = samples.filter((s) => s.stationId === "station-2").some((s) => s.observerCount === 1);
    check(
      "F1 observer onState stations == [station-1,station-2]",
      f1StationsPass,
      `got=${JSON.stringify(observerStations)}`,
    );
    check(
      "F1 each station state.observerCount == 1 while the learner is there",
      s1Count1 && s2Count1,
      `s1=${s1Count1} s2=${s2Count1} samples=${samples.length}`,
    );

    // F2: per-station presence without identity.
    const rawByStation = new Map();
    for (const file of run.traceFiles) {
      const raw = await readFile(join(traceDir, file), "utf8");
      const parsed = JSON.parse(raw);
      rawByStation.set(parsed.stationId, raw);
    }
    const s1Presence = ((byStation.get("station-1")?.events ?? []).filter((e) => String(e.kind).startsWith("observer-"))).map((e) => e.kind);
    const s2Presence = ((byStation.get("station-2")?.events ?? []).filter((e) => String(e.kind).startsWith("observer-"))).map((e) => e.kind);
    const s1HasOrder = JSON.stringify(s1Presence) === JSON.stringify(["observer-joined", "observer-left"]) ||
      (s1Presence.indexOf("observer-joined") >= 0 && s1Presence.indexOf("observer-left") > s1Presence.indexOf("observer-joined"));
    check(
      "F2 station-1 trace has observer-joined then observer-left",
      s1HasOrder,
      `presence=${JSON.stringify(s1Presence)}`,
    );
    check(
      "F2 station-2 trace has observer-joined",
      s2Presence.includes("observer-joined"),
      `presence=${JSON.stringify(s2Presence)}`,
    );
    const noIdentity =
      ![...(rawByStation.values())].some((raw) => typeof raw === "string" && raw.includes(observerSessionId));
    check("F2 no identity in either station trace", noIdentity, `observer=${String(observerSessionId).slice(0, 8)}`);

    // F3: lossless with pose streaming through rotation.
    const sentByKind = probe.sentByKind ?? {};
    const poseCounts = syncServer.getStationPoseCounts();
    const serverPose = Object.values(poseCounts).reduce((sum, n) => sum + n, 0);
    const pagePoseSent = sentByKind.pose ?? 0;
    const outsideRejects = (probe.rejectDetails ?? []).filter((r) => r.reason === "outside-encounter-phase");
    const roomLeftRejects = (probe.rejectDetails ?? []).filter((r) => String(r.reason).includes("room left"));
    const inOrder =
      sentSeqs.length > 0 &&
      sentSeqs.length === ackSeqs.length + probe.rejects &&
      sentSeqs.every((seq, i) => seq === i + 1) &&
      ackedInOrder;
    check(
      "F3 every page intent acked in order across both rooms with pose streaming, rejects exactly 2",
      probe.rejects === 2 &&
        outsideRejects.length === 2 &&
        (sentByKind["utterance-start"] ?? 0) === 6 &&
        (sentByKind["utterance-end"] ?? 0) === 6 &&
        (sentByKind["select-actor"] ?? 0) === 4 &&
        (sentByKind.pose ?? 0) > 0 &&
        inOrder,
      `sent=${sentSeqs.length} acks=${ackSeqs.length} rejects=${probe.rejects} kinds=${JSON.stringify(sentByKind)}`,
    );
    check("F3 0 client-side room left failures (page-reported)", roomLeftRejects.length === 0, `roomLeft=${roomLeftRejects.length}`);
    check(
      "F3 server cross-check: summed pose counts == page sent pose count",
      pagePoseSent > 0 && serverPose === pagePoseSent,
      `server=${serverPose} page=${pagePoseSent} byStation=${JSON.stringify(poseCounts)}`,
    );

    // F4: learner arrival lag (page clock).
    const station2Obs = (probe.stationsObserved ?? []).find((s) => s.stationId === "station-2");
    const closedBeforeStation2 = (probe.phasesObserved ?? [])
      .filter((p) => p.phase === "closed" && station2Obs && p.atMs <= station2Obs.atMs)
      .at(-1);
    const learnerLag = station2Obs && closedBeforeStation2 ? station2Obs.atMs - closedBeforeStation2.atMs : NaN;
    run.learnerArrivalLagMs = Number.isFinite(learnerLag) ? Number(learnerLag.toFixed(2)) : null;
    check(
      "F4 learner arrival lag page stationsObserved[station-2] - phasesObserved[closed] <= 1000 ms",
      Number.isFinite(learnerLag) && learnerLag >= 0 && learnerLag <= ARRIVAL_LAG_MAX_MS,
      `lag=${Number.isFinite(learnerLag) ? learnerLag.toFixed(1) : "NaN"} station2=${station2Obs?.atMs} closed=${closedBeforeStation2?.atMs}`,
    );

    // F5: observer arrival lag (host clock).
    const observerStation2 = seenStations.find((s) => s.stationId === "station-2");
    const observerLag = observerStation2 ? observerStation2.dateNowMs - prevClosedAt : NaN;
    run.observerArrivalLagMs = Number.isFinite(observerLag) ? Math.round(observerLag) : null;
    run.stationPoseCounts = poseCounts;
    check(
      "F5 observer arrival lag observer station-2 - server station-1 closed <= 1000 ms",
      Number.isFinite(observerLag) && observerLag >= 0 && observerLag <= ARRIVAL_LAG_MAX_MS,
      `lag=${Number.isFinite(observerLag) ? Math.round(observerLag) : "NaN"} closed1=${Math.round(prevClosedAt)}`,
    );

    // Bundle + completion checks.
    check(
      "bundle/source free of server imports and reply-table text",
      run.bundleCheck.hits.length === 0,
      run.bundleCheck.hits.join(" | ").slice(0, 300) || "clean",
    );
    check("probe completed without error", probe.done === true && probe.error == null, probe.error ?? "done");
    check("no page errors", (run.pageErrors ?? []).length === 0, (run.pageErrors ?? []).join(" | ").slice(0, 300) || "0 pageerrors");
    check(
      "page snapshot caught up to final seq (page-reported)",
      probe.lastServerState?.learners?.[probe.lastServerState ? Object.keys(probe.lastServerState.learners ?? {})[0] : ""]?.lastSeq ===
        probe.sent,
      `sent=${probe.sent}`,
    );
    check(
      "page observer badge saw count 1 in both stations (page-reported)",
      (probe.observerCountsObserved ?? []).some((o) => o.stationId === "station-1" && o.observerCount === 1) &&
        (probe.observerCountsObserved ?? []).some((o) => o.stationId === "station-2" && o.observerCount === 1),
      `badge=${JSON.stringify((probe.observerCountsObserved ?? []).map((o) => `${o.stationId}:${o.observerCount}`))}`,
    );
    check(
      "no server rotation-failed trace event on the happy path",
      !(byStation.get("station-1")?.events ?? []).some((e) => e.kind === "rotation-failed") &&
        !(byStation.get("station-2")?.events ?? []).some((e) => e.kind === "rotation-failed"),
      "happy path has no rotation-failed",
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
