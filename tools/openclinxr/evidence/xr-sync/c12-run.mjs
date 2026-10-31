#!/usr/bin/env node
/**
 * C12 host/quest harness: a faculty reviewer picks a recorded station from a
 * lobby on the headset and watches its replay, all on one connection.
 *
 * Host:  node c12-run.mjs --mode host --out <dir>
 * Quest:  node c12-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C12 author; root runs it on-device)
 *
 * Flow (imports harness-lib.mjs and c8-checks.mjs; nothing copied):
 *   phase 1 runs a 2-station C11-style session on host into <out>/session:
 *     the ?script=c8 page drives the fixed C3 turn script per station with a
 *     host Node observer, while a second host Node learner submits one
 *     patient note per station in its note phase (different text lengths).
 *     The C8 checks run via evaluateC8Evidence plus the C11 file checks
 *     (note files, index note entries) and the C9 G1-G5 checks.
 *   phase 2 boots a replay server on <out>/session/trace and opens the page
 *     with ?script=c12 (host browser or Quest per --mode): the page joins
 *     the lobby, renders one tile per lobbyStations entry, aims the IWER
 *     controller at the station-2 tile and triggers (the select-station
 *     intent leaves through that trigger, never a direct call), then watches
 *     the launched replay with the C10/C11 renderers.
 *
 * Assertions:
 *   J1 page lobby tiles equal the review index stations (stationId,
 *      turnCount, notePresent, noteChars) read from disk.
 *   J2 the select-station intent was sent from the controller trigger (page
 *      records the hit tile id and the trigger event) and acked; the page
 *      saw mode lobby, then mode replay with stationId station-2 on the
 *      same connection (same sessionId-independent page connection object;
 *      the page records a connection id).
 *   J3 replayed turns/ends/emotions/noteChars equal station-2's trace +
 *      note file read from disk.
 *   J4 session dir byte-identical before and after phase 2 (sha256 per file).
 *   plus the C11 file checks and C9 G1-G5 on phase 1 where they apply.
 *
 * Host/quest plumbing comes from harness-lib.mjs (imported, never copied).
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  C8_EXPECTED_EMOTIONS as EXPECTED_C4_EMOTIONS,
  C8_EXPECTED_PHASES as EXPECTED_PHASES,
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
const SERVER_NOTE_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "patient-note.js");
const CLIENT_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-client", "dist", "index.js");
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const APP_SRC_SYNC_PROBE = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "src", "sync-probe");

// C12 phase-1 timing: C9 provenance (doorway 3 s, encounter 20 s) with a 5 s
// note phase per station (one accepted submit per station settles in ms).
// Index liveness bound: 1 doorway second (1000 ms).
const TIMING = { doorwaySeconds: 3, encounterSeconds: 20, noteSeconds: 5 };
const NOTE_MAX_CHARS = 120;
const REVIEW_INDEX_LAG_MAX_MS = 1000;
const EXPECTED_TURN_ENDS = ["completed", "interrupted", "completed"];
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const REPLAY_STEP_MS = 300;
const LAUNCH_STATION_ID = "station-2";
// One accepted note per station, different text lengths (C11 bound: <= 120).
const NOTE_S1 = "c12 s1 note: HPI cough 3 days, PE clear, plan CXR.";
const NOTE_S2 = "c12 s2 note: HPI chest pain today, no radiation; lungs clear; ECG sinus; plan troponin + cardiology.";

async function hashDirFiles(root) {
  const out = {};
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const bytes = await readFile(full);
        out[relative(root, full)] = createHash("sha256").update(bytes).digest("hex");
      }
    }
  }
  await walk(root);
  return out;
}

async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const sessionDir = join(outDir, "session");
  await mkdir(sessionDir, { recursive: true });
  const traceDir = join(sessionDir, "trace");
  await mkdir(traceDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  const serverModule = await import(SERVER_DIST);
  const { createEncounterServer } = serverModule;
  const { pickC3Reply, C3_REPLY_TABLE } = await import(SERVER_ROOM_DIST);
  const { CONVERSATION_TRACE_SCHEMA, replayConversationTrace } = await import(SERVER_TRACE_DIST);
  const { SESSION_REVIEW_INDEX_SCHEMA, SESSION_REVIEW_INDEX_FILE } = await import(SERVER_REVIEW_DIST);
  const { PATIENT_NOTE_SCHEMA, PATIENT_NOTE_FILE_SUFFIX } = await import(SERVER_NOTE_DIST);
  const { connect: connectNode } = await import(CLIENT_DIST);
  const expectedReplyIds = [pickC3Reply(1).id, pickC3Reply(2).id, pickC3Reply(3).id];
  const replyTexts = C3_REPLY_TABLE.map((entry) => entry.text);
  const syncServer = await createEncounterServer({ traceDir, timing: { ...TIMING }, stations: [...STATIONS], noteMaxChars: NOTE_MAX_CHARS });
  const staticServer = await startStaticServer(APP_DIST);
  const cleanup = { syncClosed: false, staticClosed: false, observerLeft: false, noterLeft: false, replayClosed: false, replayStaticClosed: false };

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    script: "c12",
    launchStationId: LAUNCH_STATION_ID,
    timing: { ...TIMING },
    stations: [...STATIONS],
    noteMaxChars: NOTE_MAX_CHARS,
    sessionDir,
    traceDir,
    syncUrl: syncServer.url,
    pageUrl: null,
    probe: null,
    phase1: null,
    serverState: null,
    probeStats: null,
    serverTrace: null,
    expectedReplyIds,
    expectedEmotions: EXPECTED_C4_EMOTIONS,
    expectedTurnEnds: [...EXPECTED_TURN_ENDS],
    reviewIndexSchema: SESSION_REVIEW_INDEX_SCHEMA,
    reviewIndexFile: SESSION_REVIEW_INDEX_FILE,
    patientNoteSchema: PATIENT_NOTE_SCHEMA,
    noteS1Length: NOTE_S1.length,
    noteS2Length: NOTE_S2.length,
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
    sessionHashesBefore: null,
    sessionHashesAfter: null,
    expectedTurns: null,
    expectedEnds: null,
    expectedEmotions: null,
    expectedPhases: null,
    replayEventCount: null,
    replayDurationMs: null,
    elapsedMs: null,
    observerReported: { sessionId: null, stations: [], changes: [] },
    noterReported: { sessionId: null, submitted: [] },
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

  const check = (name, pass, detail) => {
    run.assertions.push({ name, pass: Boolean(pass), detail: String(detail ?? "") });
    if (!pass) {
      process.exitCode = 1;
    }
  };

  let observer = null;
  let noter = null;
  let replayServer = null;
  let replayStatic = null;
  try {
    observer = await connectNode(syncServer.url, {
      roomOptions: { actors: ["a1", "a2"], role: "observer" },
    });
    run.observerReported.sessionId = observer.sessionId;
    const seenStations = run.observerReported.stations;
    const changes = run.observerReported.changes;
    let lastStation = null;
    observer.onState((snapshot) => {
      const stationId = typeof snapshot?.stationId === "string" ? snapshot.stationId : "";
      if (stationId !== "" && stationId !== lastStation) {
        lastStation = stationId;
        seenStations.push({ stationId, dateNowMs: Date.now(), perfNowMs: Number(performance.now().toFixed(2)) });
      }
      changes.push({ stationId, observerCount: snapshot?.observerCount ?? null, dateNowMs: Date.now() });
    });

    // Second host learner: one accepted patient note per station, submitted
    // in that station's note phase (the ?script=c8 page drives turns only).
    noter = await connectNode(syncServer.url, { roomOptions: { actors: ["a1", "a2"] } });
    run.noterReported.sessionId = noter.sessionId;
    const noted = new Set();
    noter.onState((snapshot) => {
      const stationId = typeof snapshot?.stationId === "string" ? snapshot.stationId : "";
      const phase = typeof snapshot?.phase === "string" ? snapshot.phase : "";
      if (phase !== "note" || stationId === "" || noted.has(stationId)) {
        return;
      }
      noted.add(stationId);
      const text = stationId === "station-1" ? NOTE_S1 : NOTE_S2;
      void noter.sendIntent("note-submit", { text }).then((result) => {
        run.noterReported.submitted.push({ stationId, status: result.status, reason: result.status === "reject" ? result.reason : null });
      }).catch((error) => {
        run.noterReported.submitted.push({ stationId, status: "error", reason: String(error).slice(0, 120) });
      });
    });

    const params = new URLSearchParams({
      sync: syncServer.url,
      iwer: "1",
      autostart: "1",
      script: "c8",
    });
    run.pageUrl = `http://127.0.0.1:${staticServer.port}/sync-probe.html?${params.toString()}`;

    // Phase 1 is host-only (the c10 pattern): the page always runs on host.
    const outcome = await runHostProbe({ pageUrl: run.pageUrl, outDir });
    run.phase1 = { probe: outcome.probe, pageErrors: outcome.pageErrors, browserProduct: outcome.browserProduct };
    run.probe = outcome.probe;
    run.pageErrors = outcome.pageErrors;
    run.consoleErrors = outcome.consoleErrors;
    run.browserProduct = outcome.browserProduct;

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

    // E6: no rotation after station-2 closed.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const settledState = JSON.parse(syncServer.getStateJSON());

    const observerSessionId = observer.sessionId;
    await observer.leave();
    cleanup.observerLeft = true;
    observer = null;
    if (noter) {
      await noter.leave();
      cleanup.noterLeft = true;
      noter = null;
    }
    run.serverState = JSON.parse(syncServer.getStateJSON());
    const stationPoseCounts = syncServer.getStationPoseCounts();

    await syncServer.close();
    cleanup.syncClosed = true;

    // C8 regression on the 2-station turn flow (imported, never copied).
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
      // Two learners share each room (the page + the note submitter), so the
      // single-learner catch-up body cannot apply verbatim: it is carried as
      // a two-learner substitute below instead of being copied.
      if (assertion.name === "page snapshot caught up to final seq (page-reported)") {
        continue;
      }
      check(`phase1 ${assertion.name}`, assertion.pass, assertion.detail);
    }
    check(
      "phase1 page learner caught up to final seq (page-reported, two learners)",
      Object.values(probe.lastServerState?.learners ?? {}).some((learner) => learner?.lastSeq === probe.sent),
      `sent=${probe.sent} lastSeqs=${JSON.stringify(Object.values(probe.lastServerState?.learners ?? {}).map((learner) => learner?.lastSeq))}`,
    );

    // Phase-1 C11 file checks (both stations noted, different lengths).
    check(
      "phase1 noter submitted one accepted note per station",
      run.noterReported.submitted.length === 2 &&
        run.noterReported.submitted.every((s) => s.status === "ack"),
      JSON.stringify(run.noterReported.submitted),
    );
    const dirEntries = await readdir(traceDir);
    const noteFiles = dirEntries.filter((f) => f.endsWith(PATIENT_NOTE_FILE_SUFFIX)).sort();
    check("phase1 two patient-note files (one per station)", noteFiles.length === 2, `files=${noteFiles.join(",")}`);
    const notesByStation = new Map();
    for (const file of noteFiles) {
      const raw = await readFile(join(traceDir, file), "utf8");
      const note = JSON.parse(raw);
      notesByStation.set(note.stationId, { file, note, raw });
    }
    check(
      "phase1 station-1 note text/chars equal NOTE_S1, station-2 equal NOTE_S2",
      notesByStation.get("station-1")?.note?.text === NOTE_S1 &&
        notesByStation.get("station-1")?.note?.chars === NOTE_S1.length &&
        notesByStation.get("station-2")?.note?.text === NOTE_S2 &&
        notesByStation.get("station-2")?.note?.chars === NOTE_S2.length,
      `s1chars=${notesByStation.get("station-1")?.note?.chars} s2chars=${notesByStation.get("station-2")?.note?.chars}`,
    );
    for (const [stationId, { note, raw }] of notesByStation) {
      const leaked = [observerSessionId, run.noterReported.sessionId].filter((id) => typeof id === "string" && id.length > 0 && raw.includes(id));
      check(`phase1 ${stationId} note schema v1, no sessionId`, note?.schema === PATIENT_NOTE_SCHEMA && leaked.length === 0, `schema=${note?.schema} leaked=${leaked.length}`);
    }

    // Phase-1 C9 G1-G5 adapted to 2 noted stations.
    const indexFiles = dirEntries.filter((f) => f === SESSION_REVIEW_INDEX_FILE);
    const indexRaw = indexFiles.length === 1 ? await readFile(join(traceDir, SESSION_REVIEW_INDEX_FILE), "utf8") : null;
    const index = indexRaw ? JSON.parse(indexRaw) : null;
    run.reviewIndex = index;
    check(
      "phase1 G1 exactly one exam-session.review-index.json, schema v1, complete true, stations [station-1,station-2]",
      indexFiles.length === 1 &&
        index?.schema === SESSION_REVIEW_INDEX_SCHEMA &&
        index?.complete === true &&
        index?.stationCount === 2 &&
        JSON.stringify((index?.stations ?? []).map((s) => [s.stationId, s.stationIndex])) ===
          JSON.stringify([["station-1", 0], ["station-2", 1]]),
      `files=${indexFiles.join(",")} schema=${index?.schema} complete=${index?.complete}`,
    );
    if (index?.stations?.length === 2) {
      for (const entry of index.stations) {
        const wantChars = entry.stationId === "station-1" ? NOTE_S1.length : NOTE_S2.length;
        const noteRec = notesByStation.get(entry.stationId);
        check(
          `phase1 I4 ${entry.stationId} index entry notePresent true, noteChars ${wantChars}, noteFile matches`,
          entry.notePresent === true && entry.noteChars === wantChars && entry.noteFile === noteRec?.file,
          `notePresent=${entry.notePresent} noteChars=${entry.noteChars} noteFile=${entry.noteFile}`,
        );
        let entryTrace = null;
        try {
          entryTrace = JSON.parse(await readFile(join(traceDir, entry.traceFile), "utf8"));
        } catch {
          entryTrace = null;
        }
        const tracePhases = (entryTrace?.events ?? []).filter((e) => e.kind === "phase-changed").map((e) => e.phase);
        check(
          `phase1 G2 ${entry.stationId} entry links its trace file and agrees with it`,
          entryTrace !== null && entryTrace.stationId === entry.stationId &&
            JSON.stringify(entry.phases) === JSON.stringify(tracePhases) &&
            JSON.stringify(entry.phases) === JSON.stringify(EXPECTED_PHASES),
          `traceFile=${entry.traceFile} phases=${JSON.stringify(entry.phases)}`,
        );
      }
      const leakedText = replyTexts.find((text) => (indexRaw ?? "").includes(text));
      check(
        "phase1 G4 no sessionId, nonce, timestamp, or reply text in the index",
        !UUID_PATTERN.test(indexRaw ?? "") && !/__c7|nonce/i.test(indexRaw ?? "") && leakedText === undefined,
        leakedText === undefined ? "clean" : `leakedText=${leakedText.slice(0, 30)}`,
      );
      const closedAtMs = run.probeStats.phaseChangedAtMs?.closed ?? NaN;
      const indexStat = await stat(join(traceDir, SESSION_REVIEW_INDEX_FILE));
      const lagMs = indexStat.mtimeMs - closedAtMs;
      run.reviewIndexWriteLagMs = Number.isFinite(lagMs) ? Number(lagMs.toFixed(2)) : null;
      check(
        "phase1 G5 index written within 1000 ms of the last station closed",
        Number.isFinite(lagMs) && lagMs >= 0 && lagMs <= REVIEW_INDEX_LAG_MAX_MS,
        `lag=${Number.isFinite(lagMs) ? lagMs.toFixed(1) : "NaN"}ms`,
      );
    } else {
      check("phase1 I4/G2 index entries for both noted stations", false, "no two-station index");
    }

    await staticServer.close();
    cleanup.staticClosed = true;

    // Phase 2: lobby + launch on the phase-1 session dir (read-only review).
    run.sessionHashesBefore = await hashDirFiles(sessionDir);
    const entry = (index.stations ?? []).find((s) => s.stationId === LAUNCH_STATION_ID);
    if (!entry) {
      throw new Error(`phase 1 index has no ${LAUNCH_STATION_ID} entry`);
    }
    const trace = JSON.parse(await readFile(join(traceDir, entry.traceFile), "utf8"));
    run.expectedTurns = (trace.turns ?? []).map((t) => ({ turnId: t.turnId, actorId: t.actorId, replyId: t.replyId, cueId: t.cueId }));
    run.expectedEnds = (trace.turns ?? []).map((t) => t.end);
    run.expectedEmotions = (trace.emotions ?? []).filter((e) => e.changed === true).map((e) => e.to);
    run.expectedPhases = [...(entry.phases ?? [])];
    run.expectedNoteChars = entry.noteChars;
    run.replayEventCount = (trace.events ?? []).length;

    replayServer = await createEncounterServer({ replayDir: traceDir, replayStepMs: REPLAY_STEP_MS });
    run.replayUrl = replayServer.url;
    const replaySyncPort = replayServer.port;
    replayStatic = await startStaticServer(APP_DIST);
    const replayStaticPort = replayStatic.port;

    const replayParams = new URLSearchParams({
      sync: replayServer.url,
      iwer: "1",
      autostart: "1",
      script: "c12",
      ...(options.mode === "quest" ? { forceIwer: "1" } : {}),
    });
    const replayPageUrl = `http://127.0.0.1:${replayStatic.port}/sync-probe.html?${replayParams.toString()}`;
    const replayOutcome =
      options.mode === "host"
        ? await runHostProbe({ pageUrl: replayPageUrl, outDir })
        : await runQuestProbe({ pageUrl: replayPageUrl, outDir, serial: options.serial });
    const replayProbe = replayOutcome.probe;
    run.replay = {
      pageUrl: replayPageUrl,
      probe: replayProbe,
      pageErrors: replayOutcome.pageErrors,
      consoleErrors: replayOutcome.consoleErrors,
      browserProduct: replayOutcome.browserProduct,
    };
    run.replayRttMs = summarize(replayProbe.rttMs ?? []);
    run.bundleCheckReplay = await collectBundleSentry({
      appDist: APP_DIST,
      appSrcSyncProbe: APP_SRC_SYNC_PROBE,
      extraBanned: replyTexts,
    });

    const c12 = replayProbe.c12 ?? {};
    const rc10 = replayProbe.c10 ?? {};
    const lastState = replayProbe.lastServerState ?? {};
    check(
      "J1 page lobby tiles equal the review index stations (stationId, turnCount, notePresent, noteChars)",
      JSON.stringify(c12.tiles ?? null) ===
        JSON.stringify((index.stations ?? []).map((s) => ({ stationId: s.stationId, stationIndex: s.stationIndex, turnCount: s.turnCount, notePresent: s.notePresent, noteChars: s.noteChars }))),
      `tiles=${JSON.stringify(c12.tiles ?? null)?.slice(0, 300)}`,
    );
    const selectSent = (replayProbe.sentSeqsByKind ?? {})["select-station"] ?? [];
    check(
      "J2 select-station sent once from the controller trigger (hit station-2) and acked",
      selectSent.length === 1 &&
        c12.hitTileId === LAUNCH_STATION_ID &&
        c12.triggerFired === true &&
        c12.selectSent === true &&
        c12.selectAcked === true &&
        replayProbe.acks === 1 &&
        replayProbe.rejects === 0,
      `sent=${selectSent.length} hit=${c12.hitTileId} trigger=${c12.triggerFired} acked=${c12.selectAcked} acks=${replayProbe.acks} rejects=${replayProbe.rejects}`,
    );
    check(
      "J2 page saw mode lobby then mode replay with station-2 on the same connection",
      Array.isArray(c12.modes) && c12.modes[0] === "lobby" && c12.modes.at(-1) === "replay" &&
        (c12.launchStationId ?? lastState.stationId) === LAUNCH_STATION_ID &&
        lastState.mode === "replay" && lastState.stationId === LAUNCH_STATION_ID &&
        typeof c12.connectionId === "string" && c12.connectionId.length > 0,
      `modes=${JSON.stringify(c12.modes)} launch=${c12.launchStationId ?? lastState.stationId} conn=${String(c12.connectionId).slice(0, 24)}`,
    );
    check(
      "J3 page-observed replay turns equal the station-2 trace turns from disk",
      JSON.stringify(rc10.turns ?? null) === JSON.stringify(run.expectedTurns),
      `got=${JSON.stringify(rc10.turns ?? null)?.slice(0, 200)}`,
    );
    check(
      "J3 page-observed ends/emotions/phases equal station-2 trace + index entry",
      JSON.stringify(rc10.ends ?? null) === JSON.stringify(run.expectedEnds) &&
        JSON.stringify(rc10.emotions ?? null) === JSON.stringify(run.expectedEmotions) &&
        JSON.stringify(rc10.phases ?? null) === JSON.stringify(run.expectedPhases),
      `ends=${JSON.stringify(rc10.ends)} emotions=${JSON.stringify(rc10.emotions)} phases=${JSON.stringify(rc10.phases)}`,
    );
    check(
      "J3 replayed noteChars equal the station-2 note file chars",
      (rc10.noteChars ?? lastState.noteChars) === run.expectedNoteChars && run.expectedNoteChars === NOTE_S2.length,
      `noteChars=${rc10.noteChars ?? lastState.noteChars} want=${run.expectedNoteChars} lenB=${NOTE_S2.length}`,
    );

    await replayServer.close();
    replayServer = null;
    cleanup.replayClosed = true;
    await replayStatic.close();
    replayStatic = null;
    cleanup.replayStaticClosed = true;

    // J4: the replay wrote nothing into the session dir.
    run.sessionHashesAfter = await hashDirFiles(sessionDir);
    const hashKeys = new Set([...Object.keys(run.sessionHashesBefore), ...Object.keys(run.sessionHashesAfter)]);
    const hashDiffs = [...hashKeys].filter((k) => run.sessionHashesBefore[k] !== run.sessionHashesAfter[k]);
    check(
      "J4 session dir byte-identical before and after phase 2 (sha256 per file)",
      hashDiffs.length === 0,
      hashDiffs.length === 0 ? `files=${hashKeys.size}` : `diff=${hashDiffs.join(",").slice(0, 200)}`,
    );

    check(
      "bundle/source free of server imports and reply-table text (phase 2)",
      (run.bundleCheckReplay?.hits ?? []).length === 0,
      (run.bundleCheckReplay?.hits ?? []).join(" | ").slice(0, 300) || "clean",
    );
    check("replay probe completed without error", replayProbe.done === true && replayProbe.error == null, replayProbe.error ?? "done");
    check("replay probe saw no page errors", (run.replay.pageErrors ?? []).length === 0, (run.replay.pageErrors ?? []).join(" | ").slice(0, 300) || "0 pageerrors");
    check("replay probe selectMisses == 0", (replayProbe.selectMisses ?? -1) === 0, `misses=${replayProbe.selectMisses}`);

    if (options.mode === "quest") {
      const { adbReverseList, adbForwardList, leaked } = await collectQuestCleanupLists({
        staticPort: replayStaticPort,
        syncPort: replaySyncPort,
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
    process.exitCode = 1;
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
    if (noter) {
      try {
        await noter.leave();
        cleanup.noterLeft = true;
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
    if (!cleanup.staticClosed) {
      try {
        await staticServer.close();
        cleanup.staticClosed = true;
      } catch {
        // best-effort
      }
    }
    if (replayServer && !cleanup.replayClosed) {
      try {
        await replayServer.close();
        cleanup.replayClosed = true;
      } catch {
        // best-effort
      }
    }
    if (replayStatic && !cleanup.replayStaticClosed) {
      try {
        await replayStatic.close();
        cleanup.replayStaticClosed = true;
      } catch {
        // best-effort
      }
    }
    run.cleanup = cleanup;
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c12-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c12-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
process.exit(process.exitCode ?? 0);
