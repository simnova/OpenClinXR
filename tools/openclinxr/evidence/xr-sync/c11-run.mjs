#!/usr/bin/env node
/**
 * C11 host/quest harness: the learner writes a patient note in the note phase.
 *
 * Host:  node c11-run.mjs --mode host --out <dir>
 * Quest:  node c11-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C11 author; root runs it on-device)
 *
 * Flow (imports harness-lib.mjs and c8-checks.mjs constants; nothing copied):
 *   phase 1 runs one C8-shaped station on host (the ?script=c11 page: the
 *     fixed C3 turn script through the encounter, then one pre-note
 *     note-submit, one over-limit submit, and two accepted submits in the
 *     note phase) with a host Node observer, then the C11 assertions:
 *   I1 page saw noteStatus none during encounter, submitted after the first
 *      accepted submit; final noteChars equals the second note's length
 *      (read from the page's own sent text length, cross-checked against the
 *      note file on disk).
 *   I2 over-limit submit rejected note-too-long; a submit before the note
 *      phase rejected outside-note-phase (exactly these two rejects).
 *   I3 note file schema v1, text equals the second note, no learner/observer
 *      sessionId; trace file contains no note text and has two
 *      note-submitted events with matching chars.
 *   I4 review index entry notePresent true, noteChars, noteFile equals the
 *      note file basename.
 *   I5 C10 replay of that session dir on the same page (?script=c10 path)
 *      ends with noteChars equal to I1's.
 *   plus the C9 G1-G5 checks adapted to one station.
 *   phase 2 boots a replay server on <out>/trace and opens the page with
 *     ?script=c10&replayStationId=station-1 (host browser or Quest per --mode).
 *
 * Host/quest plumbing comes from harness-lib.mjs (imported, never copied).
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  C8_EXPECTED_EMOTIONS as EXPECTED_C4_EMOTIONS,
  C8_EXPECTED_PHASES as EXPECTED_PHASES,
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

// C11 station timing: C9 provenance (doorway 3 s, encounter 20 s) with a 5 s
// note phase (one over-limit + two accepted submits settle in ms). Index
// liveness bound: 1 doorway second (1000 ms).
const TIMING = { doorwaySeconds: 3, encounterSeconds: 20, noteSeconds: 5 };
const STATIONS = ["station-1"];
const NOTE_MAX_CHARS = 120;
const REVIEW_INDEX_LAG_MAX_MS = 1000;
const EXPECTED_TURN_ENDS = ["completed", "interrupted", "completed"];
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const REPLAY_STEP_MS = 300;

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
  const { PATIENT_NOTE_SCHEMA, PATIENT_NOTE_FILE_SUFFIX } = await import(SERVER_NOTE_DIST);
  const { connect: connectObserver } = await import(CLIENT_DIST);
  const expectedReplyIds = [pickC3Reply(1).id, pickC3Reply(2).id, pickC3Reply(3).id];
  const replyTexts = C3_REPLY_TABLE.map((entry) => entry.text);
  const syncServer = await createEncounterServer({ traceDir, timing: { ...TIMING }, stations: [...STATIONS], noteMaxChars: NOTE_MAX_CHARS });
  const staticServer = await startStaticServer(APP_DIST);
  const cleanup = { syncClosed: false, staticClosed: false, observerLeft: false, replayClosed: false, replayStaticClosed: false };

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    script: "c11",
    timing: { ...TIMING },
    stations: [...STATIONS],
    noteMaxChars: NOTE_MAX_CHARS,
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
    patientNoteSchema: PATIENT_NOTE_SCHEMA,
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
    noteFile: null,
    noteChars: null,
    replay: null,
    elapsedMs: null,
    observerReported: { sessionId: null },
  };

  let exitCode = 0;
  const check = (name, pass, detail) => {
    run.assertions.push({ name, pass: Boolean(pass), detail: String(detail ?? "") });
    if (!pass) {
      exitCode = 1;
    }
  };

  let observer = null;
  let replayServer = null;
  let replayStatic = null;
  try {
    observer = await connectObserver(syncServer.url, {
      roomOptions: { actors: ["a1", "a2"], role: "observer" },
    });
    run.observerReported.sessionId = observer.sessionId;

    const params = new URLSearchParams({
      sync: syncServer.url,
      iwer: "1",
      autostart: "1",
      script: "c11",
      noteMaxChars: String(NOTE_MAX_CHARS),
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

    const c11 = probe.c11 ?? {};
    const noteTexts = Array.isArray(c11.noteTexts) ? c11.noteTexts : [];
    const lastState = probe.lastServerState ?? {};
    const lenA = noteTexts.length > 0 ? noteTexts[0].length : null;
    const lenB = noteTexts.length > 1 ? noteTexts[1].length : null;

    // I1: the page saw noteStatus none during the encounter, submitted after
    // the first accepted submit; final noteChars equals the second note.
    check(
      "I1 page saw noteStatus none during encounter (before any accept)",
      c11.noteStatusDuringEncounter === "none" && c11.noteCharsDuringEncounter === 0,
      `during=${c11.noteStatusDuringEncounter}@${c11.noteCharsDuringEncounter}`,
    );
    check(
      "I1 page saw noteStatus submitted after the first accepted submit",
      c11.noteStatusAfterFirstAccept === "submitted",
      `afterFirst=${c11.noteStatusAfterFirstAccept}`,
    );
    check(
      "I1 final noteChars equals the second note's length from the page's own sent text",
      typeof lenB === "number" && lastState.noteChars === lenB && lastState.noteStatus === "submitted",
      `noteChars=${lastState.noteChars} lenB=${lenB} status=${lastState.noteStatus}`,
    );

    // I2: exactly the two expected rejects, in send order.
    const rejects = probe.rejectDetails ?? [];
    check(
      "I2 over-limit submit rejected note-too-long; pre-note submit rejected outside-note-phase",
      probe.rejects === 2 &&
        rejects.length === 2 &&
        rejects[0]?.reason === "outside-note-phase" &&
        rejects[1]?.reason === "note-too-long",
      `rejects=${probe.rejects} reasons=${rejects.map((r) => r.reason).join(",")}`,
    );

    // Observer leaves BEFORE server close (station-1 trace records left).
    const observerSessionId = observer.sessionId;
    await observer.leave();
    cleanup.observerLeft = true;
    observer = null;
    const learnerIds = Object.keys(lastState.learners ?? {});
    const learnerSessionId = learnerIds.length === 1 ? learnerIds[0] : null;

    await syncServer.close();
    cleanup.syncClosed = true;

    // I3/I4/G1-G5 read the persisted files.
    const dirEntries = await readdir(traceDir);
    const noteFiles = dirEntries.filter((f) => f.endsWith(PATIENT_NOTE_FILE_SUFFIX));
    const traceFiles = dirEntries.filter((f) => f.endsWith(".conversation-trace.json")).sort();
    run.traceFiles = [...traceFiles];
    const noteFile = noteFiles.length === 1 ? noteFiles[0] : null;
    run.noteFile = noteFile;
    const noteRaw = noteFile ? await readFile(join(traceDir, noteFile), "utf8") : null;
    const note = noteRaw ? JSON.parse(noteRaw) : null;
    run.noteChars = note?.chars ?? null;
    const traceFile = traceFiles.length === 1 ? traceFiles[0] : null;
    const trace = traceFile ? JSON.parse(await readFile(join(traceDir, traceFile), "utf8")) : null;
    check(
      "I1 note file chars cross-check the page's second-note length",
      note?.chars === lenB,
      `fileChars=${note?.chars} lenB=${lenB}`,
    );
    check(
      "I3 one patient-note file, schema v1, text equals the second note, chars match",
      noteFiles.length === 1 &&
        note?.schema === PATIENT_NOTE_SCHEMA &&
        note?.stationId === "station-1" &&
        note?.text === (noteTexts.length > 1 ? noteTexts[1] : undefined) &&
        note?.chars === lenB,
      `files=${noteFiles.join(",")} schema=${note?.schema} chars=${note?.chars}`,
    );
    const knownIds = [observerSessionId, learnerSessionId, ...(learnerIds ?? [])].filter((id) => typeof id === "string" && id.length > 0);
    const leakedId = noteRaw ? knownIds.find((id) => noteRaw.includes(id)) : "none-checked";
    check(
      "I3 no learner/observer sessionId in the note file",
      noteRaw !== null && leakedId === undefined,
      `leaked=${leakedId === undefined ? "none" : String(leakedId).slice(0, 8)}`,
    );
    const noteEvents = (trace?.events ?? []).filter((e) => e.kind === "note-submitted");
    const traceHasText =
      trace !== null && noteTexts.some((text) => typeof text === "string" && text.length > 0 && JSON.stringify(trace).includes(text));
    check(
      "I3 trace file has no note text and two note-submitted events with matching chars",
      trace !== null &&
        traceHasText === false &&
        noteEvents.length === 2 &&
        noteEvents[0]?.chars === lenA &&
        noteEvents[1]?.chars === lenB,
      `events=${noteEvents.length} chars=${noteEvents.map((e) => e.chars).join(",")} lenA=${lenA} lenB=${lenB}`,
    );

    const indexFiles = dirEntries.filter((f) => f === SESSION_REVIEW_INDEX_FILE);
    const indexRaw = indexFiles.length === 1 ? await readFile(join(traceDir, SESSION_REVIEW_INDEX_FILE), "utf8") : null;
    const index = indexRaw ? JSON.parse(indexRaw) : null;
    run.reviewIndex = index;
    check(
      "G1 exactly one exam-session.review-index.json, schema v1, complete true, stations [station-1]",
      indexFiles.length === 1 &&
        index?.schema === SESSION_REVIEW_INDEX_SCHEMA &&
        index?.complete === true &&
        index?.stationCount === 1 &&
        JSON.stringify((index?.stations ?? []).map((s) => [s.stationId, s.stationIndex])) === JSON.stringify([["station-1", 0]]),
      `files=${indexFiles.join(",")} schema=${index?.schema} complete=${index?.complete} stations=${JSON.stringify((index?.stations ?? []).map((s) => s.stationId))}`,
    );
    if (index?.stations?.length === 1) {
      const entry = index.stations[0];
      check(
        "I4 review index entry notePresent true, noteChars, noteFile equals the note file basename",
        entry.notePresent === true && entry.noteChars === lenB && entry.noteFile === noteFile,
        `notePresent=${entry.notePresent} noteChars=${entry.noteChars} noteFile=${entry.noteFile}`,
      );
      const tracePath = join(traceDir, entry.traceFile);
      let entryTrace = null;
      try {
        entryTrace = JSON.parse(await readFile(tracePath, "utf8"));
      } catch {
        entryTrace = null;
      }
      const tracePhases = (entryTrace?.events ?? []).filter((e) => e.kind === "phase-changed").map((e) => e.phase);
      const traceTurnEnds = (entryTrace?.turns ?? []).map((t) => t.end);
      check(
        "G2 station-1 entry links its trace file and agrees with it",
        entryTrace !== null &&
          typeof entry.traceFile === "string" &&
          entry.traceFile.endsWith(".conversation-trace.json") &&
          entryTrace.stationId === entry.stationId &&
          JSON.stringify(entry.phases) === JSON.stringify(tracePhases) &&
          entry.turnCount === (entryTrace.turns ?? []).length &&
          JSON.stringify(entry.turnEnds) === JSON.stringify(traceTurnEnds),
        `traceFile=${entry.traceFile} phases=${JSON.stringify(entry.phases)} turnEnds=${JSON.stringify(entry.turnEnds)}`,
      );
      check(
        "G2 station-1 turnEnds == [completed,interrupted,completed] from the C3 script",
        JSON.stringify(entry.turnEnds) === JSON.stringify(EXPECTED_TURN_ENDS),
        `got=${JSON.stringify(entry.turnEnds)}`,
      );
      check(
        "G3 observerPresent [true]",
        JSON.stringify(index.stations.map((s) => s.observerPresent)) === JSON.stringify([true]),
        `got=${JSON.stringify(index.stations.map((s) => s.observerPresent))}`,
      );
      const leakedText = replyTexts.find((text) => (indexRaw ?? "").includes(text));
      const leakedIdIndex = knownIds.find((id) => (indexRaw ?? "").includes(id));
      check(
        "G4 no learner/observer sessionId, nonce, timestamp, or reply text in the index",
        leakedIdIndex === undefined &&
          !UUID_PATTERN.test(indexRaw ?? "") &&
          !/__c7|nonce/i.test(indexRaw ?? "") &&
          !/"atMs"|"timestamp"/i.test(indexRaw ?? "") &&
          leakedText === undefined,
        `leakedId=${leakedIdIndex === undefined ? "none" : String(leakedIdIndex).slice(0, 8)} leakedText=${leakedText === undefined ? "none" : leakedText.slice(0, 30)}`,
      );
      const closedAtMs = run.probeStats.phaseChangedAtMs?.closed ?? NaN;
      const indexStat = await stat(join(traceDir, SESSION_REVIEW_INDEX_FILE));
      const lagMs = indexStat.mtimeMs - closedAtMs;
      run.reviewIndexWriteLagMs = Number.isFinite(lagMs) ? Number(lagMs.toFixed(2)) : null;
      check(
        "G5 index written within 1000 ms of the station closed phaseChangedAtMs",
        Number.isFinite(lagMs) && lagMs >= 0 && lagMs <= REVIEW_INDEX_LAG_MAX_MS,
        `lag=${Number.isFinite(lagMs) ? lagMs.toFixed(1) : "NaN"}ms closed=${Math.round(closedAtMs)} mtime=${Math.round(indexStat.mtimeMs)}`,
      );
      // The persisted C11 trace replays to itself (new kind carries through).
      try {
        const replayed = replayConversationTrace(entryTrace);
        check(
          "trace replays to itself (turns + emotions recomputed from events)",
          JSON.stringify(replayed.turns) === JSON.stringify(entryTrace.turns) &&
            JSON.stringify(replayed.emotions) === JSON.stringify(entryTrace.emotions),
          `turns=${entryTrace.turns?.length} emotions=${entryTrace.emotions?.length}`,
        );
      } catch (error) {
        check("trace replays to itself (turns + emotions recomputed from events)", false, String(error).slice(0, 200));
      }
      const phaseNames = (entryTrace?.events ?? []).filter((e) => e.kind === "phase-changed").map((e) => e.phase);
      check(
        `phase-changed sequence == [${EXPECTED_PHASES.join(",")}]`,
        JSON.stringify(phaseNames) === JSON.stringify(EXPECTED_PHASES),
        `got=${JSON.stringify(phaseNames)}`,
      );
      const emotionTos = (entryTrace?.emotions ?? []).filter((e) => e.changed === true).map((e) => e.to);
      const expectedTos = EXPECTED_C4_EMOTIONS.filter((e) => e.changed === true).map((e) => e.to);
      check(
        "trace emotions carry the C3 acknowledgement/interruption sequence",
        JSON.stringify(emotionTos) === JSON.stringify(expectedTos),
        `got=${JSON.stringify(emotionTos)}`,
      );
    } else {
      check("I4 review index entry notePresent true, noteChars, noteFile equals the note file basename", false, "no single station entry");
      check("G2 station-1 entry links its trace file and agrees with it", false, "no single station entry");
      check("G2 station-1 turnEnds == [completed,interrupted,completed] from the C3 script", false, "no single station entry");
      check("G3 observerPresent [true]", false, "no single station entry");
      check("G4 no learner/observer sessionId, nonce, timestamp, or reply text in the index", false, "no single station entry");
      check("G5 index written within 1000 ms of the station closed phaseChangedAtMs", false, "no single station entry");
    }

    check(
      "bundle/source free of server imports and reply-table text",
      (run.bundleCheck?.hits ?? []).length === 0,
      (run.bundleCheck?.hits ?? []).join(" | ").slice(0, 300) || "clean",
    );
    check("probe completed without error", probe.done === true && probe.error == null, probe.error ?? "done");
    check("no page errors", (run.pageErrors ?? []).length === 0, (run.pageErrors ?? []).join(" | ").slice(0, 300) || "0 pageerrors");

    // Phase 2: C10 replay of the recorded session dir on the same page path.
    await staticServer.close();
    cleanup.staticClosed = true;
    replayServer = await createEncounterServer({ replayDir: traceDir, replayStepMs: REPLAY_STEP_MS });
    replayStatic = await startStaticServer(APP_DIST);
    const replayChecks = { getStateJSON: null, getProbeStats: null };
    try {
      replayServer.getStateJSON();
    } catch (error) {
      replayChecks.getStateJSON = String(error instanceof Error ? error.message : error);
    }
    try {
      replayServer.getProbeStats();
    } catch (error) {
      replayChecks.getProbeStats = String(error instanceof Error ? error.message : error);
    }
    check(
      "replay server getStateJSON names the replay server (no live room by construction)",
      typeof replayChecks.getStateJSON === "string" && replayChecks.getStateJSON.includes("replay server"),
      String(replayChecks.getStateJSON).slice(0, 120),
    );
    check(
      "replay server getProbeStats names the replay server (no live room by construction)",
      typeof replayChecks.getProbeStats === "string" && replayChecks.getProbeStats.includes("replay server"),
      String(replayChecks.getProbeStats).slice(0, 120),
    );

    const replayParams = new URLSearchParams({
      sync: replayServer.url,
      iwer: "1",
      autostart: "1",
      script: "c10",
      replayStationId: "station-1",
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
    const rc10 = replayProbe.c10 ?? {};
    check(
      "I5 C10 replay of the session dir ends with noteChars equal to I1's",
      replayProbe.done === true &&
        rc10.replayDone === true &&
        rc10.mode === "replay" &&
        rc10.stationId === "station-1" &&
        rc10.noteStatus === "submitted" &&
        rc10.noteChars === lenB,
      `done=${replayProbe.done} replayDone=${rc10.replayDone} note=${rc10.noteStatus}@${rc10.noteChars} lenB=${lenB}`,
    );
    check("replay probe completed without error", replayProbe.done === true && replayProbe.error == null, replayProbe.error ?? "done");
    check(
      "replay probe saw no page errors",
      (replayOutcome.pageErrors ?? []).length === 0,
      (replayOutcome.pageErrors ?? []).join(" | ").slice(0, 300) || "0 pageerrors",
    );

    await replayServer.close();
    cleanup.replayClosed = true;
    const questStaticPort = replayStatic.port;
    const questSyncPort = replayServer.port;
    await replayStatic.close();
    cleanup.replayStaticClosed = true;
    replayServer = null;
    replayStatic = null;

    if (options.mode === "quest") {
      const { adbReverseList, adbForwardList, leaked } = await collectQuestCleanupLists({
        staticPort: questStaticPort,
        syncPort: questSyncPort,
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
    await writeFile(join(outDir, "c11-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c11-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
process.exit(process.exitCode ?? 0);
