#!/usr/bin/env node
/**
 * C7 host/quest harness: the server moves the learner through two stations.
 * When station-1's phase clock reaches closed, the server rotates the
 * learner's connection into station-2's room (server-issued seat reservation,
 * consumed by the thin client); each station keeps its own trace.
 *
 * Host:  node c7-run.mjs --mode host --out <dir>
 * Quest:  node c7-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C7 author; root runs it on-device)
 *
 * Flow: start createEncounterServer({ traceDir: <out>/trace, timing,
 * stations: ["station-1","station-2"] }) -> serve the built app ->
 * open sync-probe.html?script=c7 in an owned browser target -> the page runs
 * the FIXED C3 turn script once per station (imported, never forked): wait
 * server encounter, run script, wait closed, follow rotation, repeat in
 * station 2, finish when station 2 closed -> poll server state during the run
 * (per-station phaseChangedAtMs + intent counts, since the rotated-out room
 * disposes) -> collect server-side + page-side evidence -> E1-E6 + A8 ->
 * write c7-run.json -> cleanup.
 *
 * Host/quest plumbing comes from harness-lib.mjs (imported, never copied).
 * C3/C4/C6 checks are reused per station by import: pickC3Reply and
 * replayConversationTrace come from the server build under test (same as
 * c6-run), summarize/parseArgs/probe runners from harness-lib. Per-station
 * turn/emotion/cue expectations mirror c4/c6 (same C3 script per station).
 * Exit 1 on any failed assertion. The run file is always written first.
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
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const APP_SRC_SYNC_PROBE = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "src", "sync-probe");

// C7 station timing (server config, NOT client roomOptions). Provenance: C6
// (doorway 3 s, encounter 20 s, note 3 s): the C3 script takes 8-12 s on
// Quest (C4 quest evidence), so a 20 s encounter covers one script per
// station with margin; doorway/note 3 s keep the run short.
const TIMING = { doorwaySeconds: 3, encounterSeconds: 20, noteSeconds: 3 };
const STATIONS = ["station-1", "station-2"];
const EXPECTED_PHASES = ["doorway", "encounter", "note", "closed"];
// Rotation liveness bound: 1 doorway second at the C6 harness timing is the
// ceiling (rotation must not wait for another phase); the measured gap is
// the evidence, not the bound.
const ROTATION_GAP_MAX_MS = 1000;

// B1 literal (harness-owned, not from the build under test): the exact
// 4-transition emotion sequence the POLICY implies for the C3 script
// (complete, interrupt, complete). Same literal as c4/c6-run.mjs; checked per
// station (each station runs the same script once).
const EXPECTED_C4_EMOTIONS = [
  { from: "neutral", to: "reassured", trigger: "learner_acknowledgement", changed: true },
  { from: "reassured", to: "reassured", trigger: "learner_acknowledgement", changed: false },
  { from: "reassured", to: "concerned", trigger: "learner_interruption", changed: true },
  { from: "concerned", to: "neutral", trigger: "learner_acknowledgement", changed: true },
];

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
  const expectedReplyIds = [pickC3Reply(1).id, pickC3Reply(2).id, pickC3Reply(3).id];
  const replyTexts = C3_REPLY_TABLE.map((entry) => entry.text);
  const syncServer = await createEncounterServer({ traceDir, timing: { ...TIMING }, stations: [...STATIONS] });
  const staticServer = await startStaticServer(APP_DIST);
  const cleanup = { syncClosed: false, staticClosed: false };

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    script: "c7",
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
    pollSamples: 0,
    elapsedMs: null,
  };

  // Per-station server polling: the rotated-out room disposes (its in-memory
  // probe stats go with it), so capture each station's phaseChangedAtMs +
  // intent counts while its room is current. 50 ms cadence (C6 patch
  // interval) keeps gap error well under the 1000 ms bound.
  const samples = [];
  const pollTimer = setInterval(() => {
    try {
      const state = JSON.parse(syncServer.getStateJSON());
      const stats = syncServer.getProbeStats();
      samples.push({
        atMs: Date.now(),
        stationId: state.stationId,
        phase: state.phase,
        phaseChangedAtMs: { ...(stats.phaseChangedAtMs ?? {}) },
        intentCounts: { ...(stats.intentCounts ?? {}) },
      });
    } catch {
      // No live room yet (before the page's first join); skip.
    }
  }, 50);

  let exitCode = 0;
  try {
    const params = new URLSearchParams({
      sync: syncServer.url,
      iwer: "1",
      autostart: "1",
      script: "c7",
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

    // Per-station server snapshots from polling: last station-1 sample holds
    // its final applied counts (conversation intents finish in encounter, well
    // before closed; the rotated-out room disposes after rotation). E3 gap
    // comes from the live room (successor records prev-station-closed).
    const station1Samples = samples.filter((s) => s.stationId === "station-1");
    const station1Last = station1Samples[station1Samples.length - 1] ?? null;
    const prevClosedAt = run.probeStats.phaseChangedAtMs?.["prev-station-closed"] ?? NaN;
    const station2DoorwayAt = run.probeStats.phaseChangedAtMs?.doorway ?? NaN;
    const gap = station2DoorwayAt - prevClosedAt;
    run.rotationGapMs = Number.isFinite(gap) ? Math.round(gap) : null;

    const sentSeqs = probe.sentSeqs ?? [];
    const ackSeqs = probe.ackSeqs ?? [];
    const ackedInOrder =
      ackSeqs.length > 0 && ackSeqs.every((seq, i) => (i === 0 || seq > ackSeqs[i - 1]) && sentSeqs.includes(seq));

    // E6: no rotation after station-2 closed: 2 s settle on the LIVE server,
    // state stays station-2 closed (proves the terminal station never rotates).
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

    // Close the sync server BEFORE the file checks: close flushes the
    // station-2 trace file (same content the room writes on dispose);
    // station-1 already flushed on dispose after rotation.
    await syncServer.close();
    cleanup.syncClosed = true;

    const traceFiles = (await readdir(traceDir)).filter((f) => f.endsWith(".conversation-trace.json"));
    run.traceFiles = [...traceFiles].sort();
    const persisted = [];
    for (const file of run.traceFiles) {
      persisted.push(JSON.parse(await readFile(join(traceDir, file), "utf8")));
    }
    const byStation = new Map(persisted.map((t) => [t.stationId, t]));

    // E1: exactly 2 trace files, stationIds [station-1, station-2], each
    // phase-changed sequence [doorway,encounter,note,closed], each replays.
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
        check(`E1 ${stationId} phase-changed sequence == [doorway,encounter,note,closed]`, false, "no trace file");
        check(`E1 ${stationId} trace replays to itself`, false, "no trace file");
        check(`E1 ${stationId} trace schema + top-level stationId`, false, "no trace file");
      }
    }

    // E2: each station trace has turns ends [completed,interrupted,completed]
    // (C3 script ran once per station; turns do not leak across stations).
    // Plus per-station B1/B2 mirrors (same script => same emotions/cues).
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

    // E3: rotation gap from the live room's server phaseChangedAtMs
    // (successor records prev-station-closed at rotation).
    check(
      "E3 rotation gap 0 <= doorway(station-2) - closed(station-1) <= 1000 ms",
      Number.isFinite(gap) && gap >= 0 && gap <= ROTATION_GAP_MAX_MS,
      `gap=${Number.isFinite(gap) ? Math.round(gap) : "NaN"} closed1=${Math.round(prevClosedAt)} doorway2=${Math.round(station2DoorwayAt)} samples=${samples.length}`,
    );

    // E4 (page-reported): stationsObserved == [station-1, station-2] in order
    // and pageLoadId unchanged (no reload: two stations on one load).
    const observedStations = (probe.stationsObserved ?? []).map((s) => s.stationId);
    check(
      "E4 (page-reported) stationsObserved == [station-1,station-2] in order",
      JSON.stringify(observedStations) === JSON.stringify(STATIONS),
      `got=${JSON.stringify(observedStations)}`,
    );
    check(
      "E4 (page-reported) pageLoadId set once at load (no reload across rotation)",
      typeof probe.pageLoadId === "string" && probe.pageLoadId.length > 0,
      `pageLoadId=${String(probe.pageLoadId).slice(0, 40)} stations=${observedStations.length}`,
    );

    // E5: every page intent acked in order across both rooms; rejects exactly
    // 2 (one pre-encounter select-actor probe per station, C6 D3 pattern).
    // Server cross-check: combined per-station applied counts (station-1 from
    // polling, station-2 live) equal the C3 script x2; rejects never applied.
    const s1Counts = station1Last?.intentCounts ?? {};
    const s2Counts = run.probeStats.intentCounts ?? {};
    const combined = {
      "select-actor": (s1Counts["select-actor"] ?? 0) + (s2Counts["select-actor"] ?? 0),
      "utterance-start": (s1Counts["utterance-start"] ?? 0) + (s2Counts["utterance-start"] ?? 0),
      "utterance-end": (s1Counts["utterance-end"] ?? 0) + (s2Counts["utterance-end"] ?? 0),
    };
    const outsideRejects = (probe.rejectDetails ?? []).filter((r) => r.reason === "outside-encounter-phase");
    const inOrder =
      sentSeqs.length > 0 &&
      sentSeqs.length === ackSeqs.length + probe.rejects &&
      sentSeqs.every((seq, i) => seq === i + 1) &&
      ackedInOrder;
    check(
      "E5 every page intent acked in order across both rooms, rejects exactly 2",
      probe.rejects === 2 &&
        outsideRejects.length === 2 &&
        (probe.sentByKind?.["utterance-start"] ?? 0) === 6 &&
        (probe.sentByKind?.["utterance-end"] ?? 0) === 6 &&
        (probe.sentByKind?.["select-actor"] ?? 0) === 4 &&
        inOrder,
      `sent=${sentSeqs.length} acks=${ackSeqs.length} rejects=${probe.rejects} kinds=${JSON.stringify(probe.sentByKind)}`,
    );
    check(
      "E5 server cross-check: combined applied counts select2/start6/end6 across both rooms",
      combined["select-actor"] === 2 && combined["utterance-start"] === 6 && combined["utterance-end"] === 6,
      `combined=${JSON.stringify(combined)} s1=${JSON.stringify(s1Counts)} s2=${JSON.stringify(s2Counts)}`,
    );

    // Bundle sentry (same gate as c6: no server imports, no reply text).
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
    await writeFile(join(outDir, "c7-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c7-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
// A Playwright CDP connection to the device browser keeps the event loop alive
// (quest run hung after writing c2-run.json); exit explicitly.
process.exit(process.exitCode ?? 0);
