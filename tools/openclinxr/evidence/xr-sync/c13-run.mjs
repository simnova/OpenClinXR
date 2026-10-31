#!/usr/bin/env node
/**
 * C13 host/quest harness: a faculty reviewer scores a replayed station with
 * the controller and returns to the lobby, all on one connection.
 *
 * Host:  node c13-run.mjs --mode host --out <dir>
 * Quest:  node c13-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C13 author; root runs it on-device)
 *
 * Flow (imports harness-lib.mjs; reuses the c12 phase 1 via a c12-run.mjs
 * subprocess — nothing copied):
 *   phase 1 runs c12-run.mjs into <out>/c12seed: its 2-station C11-style
 *     session lands in <out>/c12seed/session (trace in .../session/trace).
 *   phase 2 boots a replay server on that trace dir with a fresh scoreDir
 *     (<out>/scores) and a 3-item reviewRubric in server config (also passed
 *     to the page via ?rubric= for the tile labels), then opens the page
 *     with ?script=c13 (host browser or Quest per --mode): the page does the
 *     C12 flow (lobby -> trigger on the station-2 tile -> replay), waits
 *     replayDone, renders one rubric tile per rubric item plus submit and
 *     back-to-lobby tiles, triggers two rubric tiles on, submits
 *     (score-station from the page's toggled set, via the trigger only),
 *     returns to the lobby (return-to-lobby, same rotate mechanism), and
 *     renders the lobby score badges.
 *
 * Assertions:
 *   K1 page sent exactly one score-station, from the submit trigger, acked;
 *      the items it sent equal the two toggled tiles (true) + the untoggled
 *      one (false).
 *   K2 the score file on disk equals the expected JSON built by the harness
 *      from the rubric and the page-reported toggled ids (exact toEqual), and
 *      contains no sessionId, no label text, no timestamp-like field.
 *   K3 page saw modes lobby -> replay -> lobby on one connection; after the
 *      return the page's lobby badge for station-2 shows checkedCount 2 and
 *      the server lobbyScores snapshot equals [{station-2, 2}].
 *   K4 replay session dir byte-identical before/after (sha256 per file);
 *      scoreDir holds exactly station-2.faculty-score.json.
 *   K5 a second replay server over the same dirs: a Node lobby client sees
 *      the same lobbyScores (read from disk).
 *   plus the C12 J1-J3 where they apply (lobby tiles, trigger select + same
 *   connection launch, replayed turns/ends/emotions/noteChars from disk).
 *
 * Host/quest plumbing comes from harness-lib.mjs (imported, never copied).
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  collectBundleSentry,
  collectQuestCleanupLists,
  parseArgs,
  runHostProbe,
  runQuestProbe,
  startStaticServer,
  summarize,
} from "./harness-lib.mjs";

const execFileAsync = promisify(execFile);

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKTREE_ROOT = resolve(HERE, "..", "..", "..", "..");
const SERVER_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "index.js");
const SERVER_ROOM_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "room.js");
const SERVER_REVIEW_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "session-review-index.js");
const CLIENT_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-client", "dist", "index.js");
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const APP_SRC_SYNC_PROBE = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "src", "sync-probe");
const C12_RUN = join(HERE, "c12-run.mjs");

// C13 review rubric: ids are the score contract, labels are tile text only
// (the score file must never contain them).
const RUBRIC = [
  { id: "hpi-onset", label: "Asked onset" },
  { id: "pe-lungs", label: "Examined lungs" },
  { id: "plan-shared", label: "Shared the plan" },
];
const LAUNCH_STATION_ID = "station-2";
const REPLAY_STEP_MS = 300;
const SCORE_FILE = `${LAUNCH_STATION_ID}.faculty-score.json`;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const TIMESTAMP_PATTERN = /sessionId|timestamp|createdAt|dateNow/i;

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
  const seedOut = join(outDir, "c12seed");
  const scoreDir = join(outDir, "scores");
  await mkdir(scoreDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    script: "c13",
    launchStationId: LAUNCH_STATION_ID,
    rubric: RUBRIC.map((entry) => ({ ...entry })),
    seedOut,
    scoreDir,
    syncUrl: null,
    pageUrl: null,
    probe: null,
    assertions: [],
    pageErrors: [],
    consoleErrors: [],
    adbReverseList: null,
    adbForwardList: null,
    bundleCheck: null,
    reviewIndex: null,
    sessionHashesBefore: null,
    sessionHashesAfter: null,
    expectedTurns: null,
    expectedEnds: null,
    expectedEmotions: null,
    expectedPhases: null,
    scoreFile: null,
    scoreRaw: null,
    k5LobbyScores: null,
    rttMs: null,
    frameMs: null,
    elapsedMs: null,
  };

  const check = (name, pass, detail) => {
    run.assertions.push({ name, pass: Boolean(pass), detail: String(detail ?? "") });
    if (!pass) {
      process.exitCode = 1;
    }
  };

  let replayServer = null;
  let replayStatic = null;
  let secondServer = null;
  const cleanup = { seedExit: null, replayClosed: false, replayStaticClosed: false, secondClosed: false, k5Left: false };
  try {
    // Phase 1: reuse the c12 pipeline as a subprocess (its session dir is the
    // C13 replay source; its exit code is the C12 regression signal).
    const seedArgs = ["--mode", options.mode, "--out", seedOut];
    if (options.mode === "quest") {
      seedArgs.push("--serial", options.serial);
    }
    try {
      await execFileAsync("node", [C12_RUN, ...seedArgs], { timeout: 1200000 });
      cleanup.seedExit = 0;
    } catch (error) {
      cleanup.seedExit = typeof error?.code === "number" ? error.code : 1;
      throw new Error(`c12 seed run failed (exit ${cleanup.seedExit}): ${String(error?.stdout ?? error).slice(0, 500)}`);
    }
    check("phase1 c12 seed run exited 0", cleanup.seedExit === 0, `exit=${cleanup.seedExit}`);

    const sessionDir = join(seedOut, "session");
    const traceDir = join(sessionDir, "trace");
    run.sessionDir = sessionDir;
    run.traceDir = traceDir;
    run.sessionHashesBefore = await hashDirFiles(sessionDir);

    const serverModule = await import(SERVER_DIST);
    const { createEncounterServer } = serverModule;
    const { C3_REPLY_TABLE } = await import(SERVER_ROOM_DIST);
    const { SESSION_REVIEW_INDEX_FILE } = await import(SERVER_REVIEW_DIST);
    const replyTexts = C3_REPLY_TABLE.map((entry) => entry.text);

    const index = JSON.parse(await readFile(join(traceDir, SESSION_REVIEW_INDEX_FILE), "utf8"));
    run.reviewIndex = index;
    const entry = (index.stations ?? []).find((s) => s.stationId === LAUNCH_STATION_ID);
    if (!entry) {
      throw new Error(`seed index has no ${LAUNCH_STATION_ID} entry`);
    }
    const trace = JSON.parse(await readFile(join(traceDir, entry.traceFile), "utf8"));
    run.expectedTurns = (trace.turns ?? []).map((t) => ({ turnId: t.turnId, actorId: t.actorId, replyId: t.replyId, cueId: t.cueId }));
    run.expectedEnds = (trace.turns ?? []).map((t) => t.end);
    run.expectedEmotions = (trace.emotions ?? []).filter((e) => e.changed === true).map((e) => e.to);
    run.expectedPhases = [...(entry.phases ?? [])];
    run.expectedNoteChars = entry.noteChars;

    // Phase 2: replay server with a fresh scoreDir + the 3-item rubric.
    replayServer = await createEncounterServer({
      replayDir: traceDir,
      replayStepMs: REPLAY_STEP_MS,
      scoreDir,
      reviewRubric: RUBRIC.map((item) => ({ ...item })),
    });
    run.syncUrl = replayServer.url;
    const replaySyncPort = replayServer.port;
    replayStatic = await startStaticServer(APP_DIST);
    const replayStaticPort = replayStatic.port;

    const replayParams = new URLSearchParams({
      sync: replayServer.url,
      iwer: "1",
      autostart: "1",
      script: "c13",
      rubric: JSON.stringify(RUBRIC),
      ...(options.mode === "quest" ? { forceIwer: "1" } : {}),
    });
    const replayPageUrl = `http://127.0.0.1:${replayStatic.port}/sync-probe.html?${replayParams.toString()}`;
    run.pageUrl = replayPageUrl;
    const replayOutcome =
      options.mode === "host"
        ? await runHostProbe({ pageUrl: replayPageUrl, outDir })
        : await runQuestProbe({ pageUrl: replayPageUrl, outDir, serial: options.serial });
    const probe = replayOutcome.probe;
    run.probe = probe;
    run.pageErrors = replayOutcome.pageErrors;
    run.consoleErrors = replayOutcome.consoleErrors;
    run.browserProduct = replayOutcome.browserProduct;
    run.rttMs = summarize(probe.rttMs ?? []);
    run.frameMs = summarize(probe.frameMs ?? []);
    run.bundleCheck = await collectBundleSentry({
      appDist: APP_DIST,
      appSrcSyncProbe: APP_SRC_SYNC_PROBE,
      extraBanned: replyTexts,
    });

    const c12 = probe.c12 ?? {};
    const c13 = probe.c13 ?? {};
    const rc10 = probe.c10 ?? {};
    const lastState = probe.lastServerState ?? {};
    const scoreSent = (probe.sentSeqsByKind ?? {})["score-station"] ?? [];
    const selectSent = (probe.sentSeqsByKind ?? {})["select-station"] ?? [];
    const returnSent = (probe.sentSeqsByKind ?? {})["return-to-lobby"] ?? [];

    // J1-J3 (C12 where it applies): the page opened with the C12 lobby flow.
    check(
      "J1 page lobby tiles equal the review index stations (stationId, turnCount, notePresent, noteChars)",
      JSON.stringify(c12.tiles ?? null) ===
        JSON.stringify((index.stations ?? []).map((s) => ({ stationId: s.stationId, stationIndex: s.stationIndex, turnCount: s.turnCount, notePresent: s.notePresent, noteChars: s.noteChars }))),
      `tiles=${JSON.stringify(c12.tiles ?? null)?.slice(0, 300)}`,
    );
    check(
      "J2 select-station sent once from the controller trigger (hit station-2) and acked",
      selectSent.length === 1 &&
        c12.hitTileId === LAUNCH_STATION_ID &&
        c12.triggerFired === true &&
        c12.selectSent === true &&
        c12.selectAcked === true &&
        probe.rejects === 0,
      `sent=${selectSent.length} hit=${c12.hitTileId} trigger=${c12.triggerFired} acked=${c12.selectAcked} rejects=${probe.rejects}`,
    );
    check(
      "J2 page saw mode lobby then mode replay with station-2 on the same connection",
      Array.isArray(c12.modes) && c12.modes[0] === "lobby" && c12.modes.includes("replay") &&
        (c12.launchStationId ?? lastState.stationId) === LAUNCH_STATION_ID &&
        typeof c12.connectionId === "string" && c12.connectionId.length > 0,
      `modes=${JSON.stringify(c12.modes)} launch=${c12.launchStationId ?? lastState.stationId}`,
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
      "J3 replayed noteChars equal the station-2 index noteChars",
      (c13.replayNoteChars ?? rc10.noteChars ?? lastState.noteChars) === run.expectedNoteChars,
      `noteChars=${c13.replayNoteChars ?? rc10.noteChars ?? lastState.noteChars} want=${run.expectedNoteChars}`,
    );

    // K1: exactly one score-station, from the submit trigger, acked, with the
    // page's toggled set (true) + the untoggled rubric item (false).
    const toggled = Array.isArray(c13.toggledIds) ? [...c13.toggledIds].sort() : [];
    const expectedItems = {};
    for (const item of RUBRIC) {
      expectedItems[item.id] = toggled.includes(item.id);
    }
    check(
      "K1 page sent exactly one score-station, from the submit trigger, acked",
      scoreSent.length === 1 &&
        (probe.sentByKind ?? {})["score-station"] === 1 &&
        c13.scoreSent === true &&
        c13.scoreAcked === true &&
        returnSent.length === 1 &&
        c13.returnSent === true &&
        c13.returnAcked === true &&
        probe.rejects === 0,
      `scoreSent=${scoreSent.length} submit=${c13.scoreSent} scoreAcked=${c13.scoreAcked} returnAcked=${c13.returnAcked} rejects=${probe.rejects}`,
    );
    check(
      "K1 sent items equal the two toggled tiles (true) + the untoggled one (false)",
      toggled.length === 2 &&
        toggled.every((id) => RUBRIC.some((item) => item.id === id)) &&
        JSON.stringify(c13.submittedItems ?? null) === JSON.stringify(expectedItems),
      `toggled=${JSON.stringify(c13.toggledIds)} submitted=${JSON.stringify(c13.submittedItems)}`,
    );

    // K2: the score file on disk equals the expected JSON, review-safe.
    const scoreRaw = await readFile(join(scoreDir, SCORE_FILE), "utf8");
    run.scoreRaw = scoreRaw;
    const scoreFile = JSON.parse(scoreRaw);
    run.scoreFile = scoreFile;
    const checkedOf = (id) => toggled.includes(id);
    check(
      "K2 score file equals the expected JSON (rubric order, checkedCount 2, rubricSize 3)",
      JSON.stringify(scoreFile) ===
        JSON.stringify({
          schema: "openclinxr.xr-sync.faculty-score.v1",
          stationId: LAUNCH_STATION_ID,
          items: RUBRIC.map((item) => ({ id: item.id, checked: checkedOf(item.id) })),
          checkedCount: 2,
          rubricSize: 3,
        }),
      `got=${scoreRaw.slice(0, 300)}`,
    );
    const leakedLabel = RUBRIC.map((item) => item.label).find((label) => scoreRaw.includes(label));
    check(
      "K2 score file has no sessionId, no label text, no timestamp-like field",
      !UUID_PATTERN.test(scoreRaw) && !TIMESTAMP_PATTERN.test(scoreRaw) && leakedLabel === undefined,
      leakedLabel === undefined ? "clean" : `leakedLabel=${leakedLabel.slice(0, 30)}`,
    );

    // K3: lobby -> replay -> lobby on one connection; badge shows 2.
    check(
      "K3 page saw modes lobby -> replay -> lobby on one connection",
      JSON.stringify(c13.modes ?? null) === JSON.stringify(["lobby", "replay", "lobby"]) &&
        lastState.mode === "lobby" &&
        typeof c13.connectionId === "string" && c13.connectionId.length > 0,
      `modes=${JSON.stringify(c13.modes)} final=${lastState.mode}`,
    );
    check(
      "K3 lobby badge for station-2 shows checkedCount 2 and server lobbyScores equal [{station-2, 2}]",
      JSON.stringify(c13.lobbyBadges ?? null) === JSON.stringify([{ stationId: LAUNCH_STATION_ID, checkedCount: 2 }]) &&
        JSON.stringify(lastState.lobbyScores ?? null) === JSON.stringify([{ stationId: LAUNCH_STATION_ID, checkedCount: 2 }]),
      `badges=${JSON.stringify(c13.lobbyBadges)} scores=${JSON.stringify(lastState.lobbyScores)}`,
    );

    await replayServer.close();
    replayServer = null;
    cleanup.replayClosed = true;
    await replayStatic.close();
    replayStatic = null;
    cleanup.replayStaticClosed = true;

    // K4: the replay wrote nothing into the session dir; scoreDir holds one file.
    run.sessionHashesAfter = await hashDirFiles(sessionDir);
    const hashKeys = new Set([...Object.keys(run.sessionHashesBefore), ...Object.keys(run.sessionHashesAfter)]);
    const hashDiffs = [...hashKeys].filter((k) => run.sessionHashesBefore[k] !== run.sessionHashesAfter[k]);
    check(
      "K4 session dir byte-identical before and after phase 2 (sha256 per file)",
      hashDiffs.length === 0,
      hashDiffs.length === 0 ? `files=${hashKeys.size}` : `diff=${hashDiffs.join(",").slice(0, 200)}`,
    );
    const scoreEntries = await readdir(scoreDir);
    check(
      "K4 scoreDir holds exactly station-2.faculty-score.json",
      JSON.stringify(scoreEntries.sort()) === JSON.stringify([SCORE_FILE]),
      `files=${scoreEntries.join(",")}`,
    );

    // K5: a second replay server over the same dirs reads the scores from disk.
    secondServer = await createEncounterServer({
      replayDir: traceDir,
      replayStepMs: REPLAY_STEP_MS,
      scoreDir,
      reviewRubric: RUBRIC.map((item) => ({ ...item })),
    });
    const { connect: connectNode } = await import(CLIENT_DIST);
    const lobby = await connectNode(secondServer.url, { roomOptions: { reviewLobby: true } });
    let lobbyLast = null;
    lobby.onState((snapshot) => {
      lobbyLast = snapshot;
    });
    const lobbyDeadline = Date.now() + 10000;
    while (((lobbyLast?.lobbyStations ?? []).length ?? 0) !== 2) {
      if (Date.now() > lobbyDeadline) {
        throw new Error("timed out waiting for K5 fresh lobby");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    run.k5LobbyScores = lobbyLast?.lobbyScores ?? null;
    check(
      "K5 second server lobby client sees the same lobbyScores from disk",
      JSON.stringify(run.k5LobbyScores) === JSON.stringify([{ stationId: LAUNCH_STATION_ID, checkedCount: 2 }]),
      `scores=${JSON.stringify(run.k5LobbyScores)}`,
    );
    await lobby.leave();
    cleanup.k5Left = true;
    await secondServer.close();
    secondServer = null;
    cleanup.secondClosed = true;

    check(
      "bundle/source free of server imports and reply-table text (phase 2)",
      (run.bundleCheck?.hits ?? []).length === 0,
      (run.bundleCheck?.hits ?? []).join(" | ").slice(0, 300) || "clean",
    );
    check("replay probe completed without error", probe.done === true && probe.error == null, probe.error ?? "done");
    check("replay probe saw no page errors", (run.pageErrors ?? []).length === 0, (run.pageErrors ?? []).join(" | ").slice(0, 300) || "0 pageerrors");
    check("replay probe selectMisses == 0", (probe.selectMisses ?? -1) === 0, `misses=${probe.selectMisses}`);

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
    if (secondServer && !cleanup.secondClosed) {
      try {
        await secondServer.close();
        cleanup.secondClosed = true;
      } catch {
        // best-effort
      }
    }
    run.cleanup = cleanup;
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c13-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c13-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
process.exit(process.exitCode ?? 0);
