#!/usr/bin/env node
/**
 * C14 host/quest harness: the reviewer scores every station, then signs off
 * from the lobby with the controller; the server writes one review packet
 * and locks the scores, all on one connection.
 *
 * Host:  node c14-run.mjs --mode host --out <dir>
 * Quest:  node c14-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C14 author; root runs it on-device)
 *
 * Flow (imports harness-lib.mjs; reuses the c12 phase 1 via a c12-run.mjs
 * subprocess — nothing copied):
 *   phase 1 runs c12-run.mjs into <out>/c12seed: its 2-station C11-style
 *     session lands in <out>/c12seed/session (trace in .../session/trace).
 *   phase 2 seeds a valid station-1 faculty score into a fresh scoreDir
 *     (<out>/scores, beside — never inside — the session dir), boots a replay
 *     server on that trace dir with the scoreDir + a 3-item reviewRubric in
 *     server config (also passed to the page via ?rubric= for the tile
 *     labels), then opens the page with ?script=c14 (host browser or Quest
 *     per --mode): the page does the C13 flow for station-2 (lobby ->
 *     trigger on the station-2 tile -> replay -> toggle two rubric tiles ->
 *     submit -> back to lobby), then renders a "sign off" tile, aims the
 *     IWER controller at it and triggers (finalize-review leaves through
 *     that trigger, never a direct call), and records the server
 *     reviewFinalized flag plus the sign-off badge it renders.
 *
 * Assertions:
 *   L1 page sent exactly one finalize-review, from the sign-off trigger,
 *      acked; the page saw reviewFinalized true.
 *   L2 the packet on disk equals the expected JSON built by the harness
 *      from the session index, the note file texts and both score files
 *      (exact match), and contains no sessionId, no label text, no
 *      timestamp-like field.
 *   L3 a Node replay client then sends score-station for station-2 ->
 *      reject review-finalized; both score files byte-identical before/after.
 *   L4 replay session dir byte-identical before/after (sha256 per file);
 *      scoreDir holds exactly the two score files + the packet.
 *   L5 a second replay server over the same dirs: a Node lobby client sees
 *      reviewFinalized true (read from disk).
 *   plus the C13 K1, K3 where they apply (one score-station from the submit
 *   trigger with the toggled set; lobby -> replay -> lobby with the
 *   station-2 badge) and the C12 J1-J3 where they apply.
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

// C14 review rubric: ids are the score contract, labels are tile text only
// (the score files and the packet must never contain them).
const RUBRIC = [
  { id: "hpi-onset", label: "Asked onset" },
  { id: "pe-lungs", label: "Examined lungs" },
  { id: "plan-shared", label: "Shared the plan" },
];
// Station the page scores live (station-1 is seeded by the harness).
const SCORE_STATION_ID = "station-2";
const SEED_STATION_ID = "station-1";
const REPLAY_STEP_MS = 300;
const PACKET_FILE = "exam-session.review-packet.json";
// Harness-seeded station-1 score (valid C13 file: checkedCount agrees, own id, rubric order).
const SEED_ITEMS = [
  { id: "hpi-onset", checked: true },
  { id: "pe-lungs", checked: false },
  { id: "plan-shared", checked: true },
];
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
    script: "c14",
    scoreStationId: SCORE_STATION_ID,
    seedStationId: SEED_STATION_ID,
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
    packet: null,
    packetRaw: null,
    l3ScoresBefore: null,
    l3ScoresAfter: null,
    l5ReviewFinalized: null,
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
  const cleanup = { seedExit: null, replayClosed: false, replayStaticClosed: false, secondClosed: false, l3Left: false, l5Left: false };
  try {
    // Phase 1: reuse the c12 pipeline as a subprocess (its session dir is the
    // C14 replay source; its exit code is the C12 regression signal).
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
    const scoreEntry = (index.stations ?? []).find((s) => s.stationId === SCORE_STATION_ID);
    if (!scoreEntry) {
      throw new Error(`seed index has no ${SCORE_STATION_ID} entry`);
    }
    const trace = JSON.parse(await readFile(join(traceDir, scoreEntry.traceFile), "utf8"));
    run.expectedTurns = (trace.turns ?? []).map((t) => ({ turnId: t.turnId, actorId: t.actorId, replyId: t.replyId, cueId: t.cueId }));
    run.expectedEnds = (trace.turns ?? []).map((t) => t.end);
    run.expectedEmotions = (trace.emotions ?? []).filter((e) => e.changed === true).map((e) => e.to);
    run.expectedPhases = [...(scoreEntry.phases ?? [])];
    run.expectedNoteChars = scoreEntry.noteChars;

    // Phase 2: seed a valid station-1 score beside the session dir, then boot
    // the replay server with the fresh scoreDir + the 3-item rubric.
    const seedScore = {
      schema: "openclinxr.xr-sync.faculty-score.v1",
      stationId: SEED_STATION_ID,
      items: SEED_ITEMS.map((item) => ({ ...item })),
      checkedCount: SEED_ITEMS.filter((item) => item.checked).length,
      rubricSize: RUBRIC.length,
    };
    await writeFile(join(scoreDir, `${SEED_STATION_ID}.faculty-score.json`), `${JSON.stringify(seedScore)}\n`, "utf8");
    run.seedScore = seedScore;

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
      script: "c14",
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
    const c14 = probe.c14 ?? {};
    const rc10 = probe.c10 ?? {};
    const lastState = probe.lastServerState ?? {};
    const scoreSent = (probe.sentSeqsByKind ?? {})["score-station"] ?? [];
    const selectSent = (probe.sentSeqsByKind ?? {})["select-station"] ?? [];
    const returnSent = (probe.sentSeqsByKind ?? {})["return-to-lobby"] ?? [];
    const finalizeSent = (probe.sentSeqsByKind ?? {})["finalize-review"] ?? [];
    run.c14 = { ...c14 };

    // J1-J3 (C12/C13 where they apply): the page opened with the C12 lobby flow.
    check(
      "J1 page lobby tiles equal the review index stations (stationId, turnCount, notePresent, noteChars)",
      JSON.stringify(c12.tiles ?? null) ===
        JSON.stringify((index.stations ?? []).map((s) => ({ stationId: s.stationId, stationIndex: s.stationIndex, turnCount: s.turnCount, notePresent: s.notePresent, noteChars: s.noteChars }))),
      `tiles=${JSON.stringify(c12.tiles ?? null)?.slice(0, 300)}`,
    );
    check(
      "J2 select-station sent once from the controller trigger (hit station-2) and acked",
      selectSent.length === 1 &&
        c12.hitTileId === SCORE_STATION_ID &&
        c12.triggerFired === true &&
        c12.selectSent === true &&
        c12.selectAcked === true,
      `sent=${selectSent.length} hit=${c12.hitTileId} trigger=${c12.triggerFired} acked=${c12.selectAcked}`,
    );
    check(
      "J2 page saw mode lobby then mode replay with station-2 on the same connection",
      Array.isArray(c12.modes) && c12.modes[0] === "lobby" && c12.modes.includes("replay") &&
        (c12.launchStationId ?? lastState.stationId) === SCORE_STATION_ID &&
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

    // K1 (C13 where it applies): exactly one score-station from the submit trigger.
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
        c13.returnAcked === true,
      `scoreSent=${scoreSent.length} submit=${c13.scoreSent} scoreAcked=${c13.scoreAcked} returnAcked=${c13.returnAcked} rejects=${probe.rejects}`,
    );
    check(
      "K1 sent items equal the two toggled tiles (true) + the untoggled one (false)",
      toggled.length === 2 &&
        toggled.every((id) => RUBRIC.some((item) => item.id === id)) &&
        JSON.stringify(c13.submittedItems ?? null) === JSON.stringify(expectedItems),
      `toggled=${JSON.stringify(c13.toggledIds)} submitted=${JSON.stringify(c13.submittedItems)}`,
    );

    // K3 (C13 where it applies): lobby -> replay -> lobby, both badges visible.
    const station2Score = {
      schema: "openclinxr.xr-sync.faculty-score.v1",
      stationId: SCORE_STATION_ID,
      items: RUBRIC.map((item) => ({ id: item.id, checked: expectedItems[item.id] === true })),
      checkedCount: 2,
      rubricSize: RUBRIC.length,
    };
    check(
      "K3 page saw modes lobby -> replay -> lobby on one connection",
      JSON.stringify(c13.modes ?? null) === JSON.stringify(["lobby", "replay", "lobby"]) &&
        lastState.mode === "lobby" &&
        typeof c13.connectionId === "string" && c13.connectionId.length > 0,
      `modes=${JSON.stringify(c13.modes)} final=${lastState.mode}`,
    );
    check(
      "K3 lobby badges show the seeded station-1 score and station-2 checkedCount 2",
      JSON.stringify(c13.lobbyBadges ?? null) ===
        JSON.stringify([
          { stationId: SEED_STATION_ID, checkedCount: seedScore.checkedCount },
          { stationId: SCORE_STATION_ID, checkedCount: 2 },
        ]),
      `badges=${JSON.stringify(c13.lobbyBadges)}`,
    );

    // L1: exactly one finalize-review, from the sign-off trigger, acked; finalized seen.
    check(
      "L1 page sent exactly one finalize-review, from the sign-off trigger, acked",
      finalizeSent.length === 1 &&
        (probe.sentByKind ?? {})["finalize-review"] === 1 &&
        c14.hitTileId === "c14:signoff" &&
        c14.triggerFired === true &&
        c14.signoffSent === true &&
        c14.signoffAcked === true &&
        probe.rejects === 0,
      `finalizeSent=${finalizeSent.length} hit=${c14.hitTileId} trigger=${c14.triggerFired} acked=${c14.signoffAcked} rejects=${probe.rejects}`,
    );
    check(
      "L1 page saw reviewFinalized true and rendered the finalized badge",
      c14.reviewFinalized === true &&
        c14.signoffBadge === "signoff:finalized" &&
        lastState.reviewFinalized === true,
      `flag=${c14.reviewFinalized} badge=${c14.signoffBadge} server=${lastState.reviewFinalized}`,
    );

    // L2: the packet on disk equals the harness-built expected JSON.
    const packetRaw = await readFile(join(scoreDir, PACKET_FILE), "utf8");
    run.packetRaw = packetRaw;
    const packet = JSON.parse(packetRaw);
    run.packet = packet;
    const expectedStations = [];
    for (const entry of index.stations ?? []) {
      const stationTrace = JSON.parse(await readFile(join(traceDir, entry.traceFile), "utf8"));
      const stationEnds = (stationTrace.turns ?? []).map((t) => t.end);
      const noteText =
        entry.notePresent === true && typeof entry.noteFile === "string"
          ? JSON.parse(await readFile(join(traceDir, entry.noteFile), "utf8")).text
          : null;
      const scoreFile = JSON.parse(await readFile(join(scoreDir, `${entry.stationId}.faculty-score.json`), "utf8"));
      expectedStations.push({
        stationId: entry.stationId,
        stationIndex: entry.stationIndex,
        turnCount: (stationTrace.turns ?? []).length,
        turnEnds: stationEnds,
        notePresent: entry.notePresent,
        noteText,
        score: {
          items: scoreFile.items,
          checkedCount: scoreFile.checkedCount,
          rubricSize: scoreFile.rubricSize,
        },
      });
    }
    const expectedPacket = {
      schema: "openclinxr.xr-sync.faculty-review-packet.v1",
      sessionComplete: index.complete,
      stationCount: (index.stations ?? []).length,
      stations: expectedStations,
      totalChecked: expectedStations.reduce((sum, s) => sum + s.score.checkedCount, 0),
      totalPossible: expectedStations.length * RUBRIC.length,
    };
    run.expectedPacket = expectedPacket;
    check(
      "L2 packet on disk equals the expected JSON (index rows, note texts, both scores)",
      JSON.stringify(packet) === JSON.stringify(expectedPacket),
      `got=${packetRaw.slice(0, 300)}`,
    );
    const leakedLabel = RUBRIC.map((item) => item.label).find((label) => packetRaw.includes(label));
    check(
      "L2 packet has no sessionId, no label text, no timestamp-like field",
      !UUID_PATTERN.test(packetRaw) && !TIMESTAMP_PATTERN.test(packetRaw) && leakedLabel === undefined,
      leakedLabel === undefined ? "clean" : `leakedLabel=${leakedLabel.slice(0, 30)}`,
    );

    await replayServer.close();
    replayServer = null;
    cleanup.replayClosed = true;
    await replayStatic.close();
    replayStatic = null;
    cleanup.replayStaticClosed = true;

    // L3: scores lock after sign-off (Node replay client).
    const { connect: connectNode } = await import(CLIENT_DIST);
    const lockServer = await createEncounterServer({
      replayDir: traceDir,
      replayStepMs: REPLAY_STEP_MS,
      scoreDir,
      reviewRubric: RUBRIC.map((item) => ({ ...item })),
    });
    const before1 = await readFile(join(scoreDir, `${SEED_STATION_ID}.faculty-score.json`), "utf8");
    const before2 = await readFile(join(scoreDir, `${SCORE_STATION_ID}.faculty-score.json`), "utf8");
    run.l3ScoresBefore = { station1: before1, station2: before2 };
    const scorer = await connectNode(lockServer.url, { roomOptions: { replayStationId: SCORE_STATION_ID } });
    let scorerLast = null;
    scorer.onState((snapshot) => {
      scorerLast = snapshot;
    });
    const scorerDeadline = Date.now() + 10000;
    while ((scorerLast?.mode ?? "") !== "replay" && Date.now() < scorerDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const lockResult = await scorer.sendIntent("score-station", { items: { "hpi-onset": false, "pe-lungs": false, "plan-shared": false } });
    check(
      "L3 score-station after sign-off rejects review-finalized",
      lockResult.status === "reject" && lockResult.reason === "review-finalized",
      `status=${lockResult.status} reason=${lockResult.status === "reject" ? lockResult.reason : "-"}`,
    );
    await scorer.leave();
    cleanup.l3Left = true;
    await lockServer.close();
    const after1 = await readFile(join(scoreDir, `${SEED_STATION_ID}.faculty-score.json`), "utf8");
    const after2 = await readFile(join(scoreDir, `${SCORE_STATION_ID}.faculty-score.json`), "utf8");
    run.l3ScoresAfter = { station1: after1, station2: after2 };
    check(
      "L3 both score files byte-identical before/after the rejected write",
      before1 === after1 && before2 === after2,
      before1 === after1 && before2 === after2 ? "unchanged" : "MUTATED",
    );

    // L4: the replay wrote nothing into the session dir; scoreDir holds 3 files.
    run.sessionHashesAfter = await hashDirFiles(sessionDir);
    const hashKeys = new Set([...Object.keys(run.sessionHashesBefore), ...Object.keys(run.sessionHashesAfter)]);
    const hashDiffs = [...hashKeys].filter((k) => run.sessionHashesBefore[k] !== run.sessionHashesAfter[k]);
    check(
      "L4 session dir byte-identical before and after phase 2 (sha256 per file)",
      hashDiffs.length === 0,
      hashDiffs.length === 0 ? `files=${hashKeys.size}` : `diff=${hashDiffs.join(",").slice(0, 200)}`,
    );
    const scoreEntries = (await readdir(scoreDir)).sort();
    check(
      "L4 scoreDir holds exactly the two score files + the packet",
      JSON.stringify(scoreEntries) ===
        JSON.stringify([PACKET_FILE, `${SEED_STATION_ID}.faculty-score.json`, `${SCORE_STATION_ID}.faculty-score.json`].sort()),
      `files=${scoreEntries.join(",")}`,
    );

    // L5: a second replay server over the same dirs reads the finalized flag from disk.
    secondServer = await createEncounterServer({
      replayDir: traceDir,
      replayStepMs: REPLAY_STEP_MS,
      scoreDir,
      reviewRubric: RUBRIC.map((item) => ({ ...item })),
    });
    const lobby = await connectNode(secondServer.url, { roomOptions: { reviewLobby: true } });
    let lobbyLast = null;
    lobby.onState((snapshot) => {
      lobbyLast = snapshot;
    });
    const lobbyDeadline = Date.now() + 10000;
    while (((lobbyLast?.lobbyStations ?? []).length ?? 0) !== 2 && Date.now() < lobbyDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    run.l5ReviewFinalized = lobbyLast?.reviewFinalized ?? null;
    check(
      "L5 second server lobby client sees reviewFinalized true (read from disk)",
      lobbyLast?.reviewFinalized === true,
      `reviewFinalized=${lobbyLast?.reviewFinalized}`,
    );
    await lobby.leave();
    cleanup.l5Left = true;
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
    await writeFile(join(outDir, "c14-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c14-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
process.exit(process.exitCode ?? 0);
