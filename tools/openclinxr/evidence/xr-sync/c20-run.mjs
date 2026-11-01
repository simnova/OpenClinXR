#!/usr/bin/env node
/**
 * C20 host/quest harness: faculty scores each replayed cast station against
 * THAT station's scenario reviewRubric.
 *
 * Host:  node c20-run.mjs --mode host --out <dir>
 * Quest:  node c20-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C20 author; root runs it on-device)
 *
 * Flow (imports harness-lib.mjs; reuses the c18 phase A recording via a
 * c18-run.mjs subprocess and the c13/c14 scoring shape — nothing copied):
 *   phase 1 runs c18-run.mjs into <out>/c18seed: its 2-station cast session
 *     lands in <out>/c18seed/trace (factory blueprint + the c16/c17 named
 *     overrides: 3/20/3 s timing, draft slot scenarios as approved copies).
 *     The scenarios bank is resolved from the persisted traces' scenarioIds
 *     against the scenario fixtures (approved copies, reviewRubric as filed).
 *   phase 2 boots a replay server on that trace dir with a fresh scoreDir
 *     (<out>/scores) + the scenarios bank in server config, then opens the
 *     page with ?script=c20 (host browser or Quest per --mode): the page does
 *     the c13 flow per station in lobby order (lobby -> trigger the tile ->
 *     replay -> render the station's checklist labels in order in a visible
 *     panel -> trigger the even-index tiles on -> submit score-station from
 *     the toggled set in rubric order -> back to lobby), and records
 *     (stationId, rubric ids, ack) per station.
 *
 * Assertions:
 *   T1 per station, a Node replay client sees replayRubric == that scenario's
 *      reviewRubric (ids + labels, computed from the scenario object).
 *   T2 per station score file: scenarioId, items in rubric order with the
 *      page's checked pattern (even index true), rubricSize; no label text,
 *      no session id, no timestamp.
 *   T3 a wrong-rubric score (other station's ids) rejects invalid-score and
 *      leaves the score file untouched; lobby lobbyScores reflect each
 *      station's checkedCount.
 *   T4 per station the page rendered the checklist in scenario rubric order
 *      (ids + labels); page and server agree.
 *   plus C13/C14 checks where they apply (lobby -> replay -> lobby per
 *   station on one connection; session dir byte-identical; scoreDir file set;
 *   second server reads badges from disk; finalize writes the packet with
 *   per-station rubricSizes and locks the scores).
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
const SCENARIO_FIXTURES_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "scenario-fixtures", "dist", "index.js");
const CLIENT_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-client", "dist", "index.js");
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const APP_SRC_SYNC_PROBE = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "src", "sync-probe");
const C18_RUN = join(HERE, "c18-run.mjs");

const REPLAY_STEP_MS = 300;
const PACKET_FILE = "exam-session.review-packet.json";
const SCORE_SUFFIX = ".faculty-score.json";
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

function checkedPattern(length) {
  return Array.from({ length }, (_, index) => index % 2 === 0);
}

async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const seedOut = join(outDir, "c18seed");
  const scoreDir = join(outDir, "scores");
  await mkdir(scoreDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    script: "c20",
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
    scenarios: null,
    sessionHashesBefore: null,
    sessionHashesAfter: null,
    scoreFiles: null,
    packet: null,
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
  const nodeConns = [];
  const cleanup = { seedExit: null, replayClosed: false, replayStaticClosed: false, secondClosed: false };
  const track = (conn) => {
    nodeConns.push(conn);
    return conn;
  };
  try {
    // Phase 1: reuse the c18 pipeline as a subprocess (its cast session is
    // the C20 replay source; its exit code is the C18 regression signal).
    const seedArgs = ["--mode", options.mode, "--out", seedOut];
    if (options.mode === "quest") {
      seedArgs.push("--serial", options.serial);
    }
    try {
      await execFileAsync("node", [C18_RUN, ...seedArgs], { timeout: 1800000 });
      cleanup.seedExit = 0;
    } catch (error) {
      cleanup.seedExit = typeof error?.code === "number" ? error.code : 1;
      throw new Error(`c18 seed run failed (exit ${cleanup.seedExit}): ${String(error?.stdout ?? error).slice(0, 500)}`);
    }
    check("phase1 c18 seed run exited 0", cleanup.seedExit === 0, `exit=${cleanup.seedExit}`);

    const traceDir = join(seedOut, "trace");
    run.traceDir = traceDir;
    run.sessionHashesBefore = await hashDirFiles(traceDir);

    const serverModule = await import(SERVER_DIST);
    const { createEncounterServer } = serverModule;
    const { C3_REPLY_TABLE } = await import(SERVER_ROOM_DIST);
    const { SESSION_REVIEW_INDEX_FILE } = await import(SERVER_REVIEW_DIST);
    const { scenarioBank } = await import(SCENARIO_FIXTURES_DIST);
    const { connect: connectNode } = await import(CLIENT_DIST);
    const replyTexts = C3_REPLY_TABLE.map((entry) => entry.text);

    const index = JSON.parse(await readFile(join(traceDir, SESSION_REVIEW_INDEX_FILE), "utf8"));
    run.reviewIndex = index;
    check(
      "phase1 review index complete with one entry per station",
      index !== null && index.complete === true && (index.stations ?? []).length === 2,
      `stations=${(index.stations ?? []).length}`,
    );

    // The scenarios bank: each persisted trace's scenarioId resolved against
    // the fixtures (approved copies, reviewRubric as filed), in index order.
    const bank = [];
    const traceByStation = new Map();
    for (const entry of index.stations ?? []) {
      const trace = JSON.parse(await readFile(join(traceDir, entry.traceFile), "utf8"));
      traceByStation.set(entry.stationId, trace);
      const fixture = scenarioBank.find((s) => s.scenarioId === trace.scenarioId);
      if (!fixture) {
        throw new Error(`no fixture for trace scenarioId ${trace.scenarioId}`);
      }
      bank.push(fixture.status === "approved" ? fixture : { ...fixture, status: "approved" });
    }
    // C23: when the two fixtures' rubrics are the same size, the replay bank
    // drops the second rubric's last item so a summed totalPossible differs
    // from first size x station count.
    if (bank[0] && bank[1] && bank[1].reviewRubric.length === bank[0].reviewRubric.length && bank[1].reviewRubric.length > 1) {
      bank[1] = { ...bank[1], reviewRubric: bank[1].reviewRubric.slice(0, -1) };
    }
    run.scenarios = bank.map((s) => ({
      scenarioId: s.scenarioId,
      status: s.status,
      reviewRubric: s.reviewRubric.map((item) => ({ rubricId: item.rubricId, label: item.label })),
    }));
    // C23 RED (carried C20 defect): with equal rubric sizes, a packet whose
    // totalPossible is first-size x station count passes the sum check below.
    check(
      "C23 bank rubrics differ in size, so a summed totalPossible is distinguishable",
      bank.length === 2 && new Set(bank.map((s) => s.reviewRubric.length)).size === bank.length,
      `sizes=${bank.map((s) => s.reviewRubric.length).join(",")}`,
    );
    run.scenarioApprovalOverride = bank
      .filter((s) => scenarioBank.find((f) => f.scenarioId === s.scenarioId)?.status !== "approved")
      .map((s) => s.scenarioId);
    check(
      "phase1 traces carry distinct scenarioIds, each resolved in the bank",
      traceByStation.size === 2 && new Set([...traceByStation.values()].map((t) => t.scenarioId)).size === 2,
      `scenarioIds=${[...traceByStation.values()].map((t) => t.scenarioId).join(",")}`,
    );
    const stationIds = (index.stations ?? []).map((s) => s.stationId);
    const scenarioOf = (stationId) => bank[(index.stations ?? []).findIndex((s) => s.stationId === stationId)];
    const rubricOf = (stationId) => scenarioOf(stationId).reviewRubric.map((item) => ({ id: item.rubricId, label: item.label }));
    const openingTexts = [...new Set(bank.flatMap((s) => (s.actors ?? []).map((a) => a.openingUtterance).filter((t) => typeof t === "string" && t !== "")))];

    // Phase 2: replay server with the fresh scoreDir + the scenarios bank.
    replayServer = await createEncounterServer({
      replayDir: traceDir,
      replayStepMs: REPLAY_STEP_MS,
      scoreDir,
      scenarios: bank,
    });
    run.syncUrl = replayServer.url;
    const replaySyncPort = replayServer.port;
    replayStatic = await startStaticServer(APP_DIST);
    const replayStaticPort = replayStatic.port;

    const replayParams = new URLSearchParams({
      sync: replayServer.url,
      iwer: "1",
      autostart: "1",
      script: "c20",
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
      extraBanned: [...replyTexts, ...openingTexts, ...bank.flatMap((s) => s.reviewRubric.map((item) => item.label))],
    });

    const c12 = probe.c12 ?? {};
    const c20 = probe.c20 ?? {};
    const lastState = probe.lastServerState ?? {};

    // T4 + page flow: the page scored every station in lobby order on one
    // connection, with (stationId, rubric ids, ack) per station.
    check(
      "page scored every index station in lobby order on one connection",
      JSON.stringify((c20.stations ?? []).map((s) => s.stationId)) === JSON.stringify(stationIds) &&
        typeof c20.connectionId === "string" && c20.connectionId.length > 0 &&
        typeof c12.connectionId === "string" && c12.connectionId.length > 0,
      `stations=${JSON.stringify((c20.stations ?? []).map((s) => s.stationId))}`,
    );
    check(
      "page saw modes lobby -> replay -> lobby per station with no rejects",
      JSON.stringify(c12.modes ?? null) === JSON.stringify(["lobby", "replay", "lobby", "replay", "lobby"]) &&
        lastState.mode === "lobby" &&
        probe.rejects === 0 &&
        (probe.selectMisses ?? -1) === 0,
      `modes=${JSON.stringify(c12.modes)} rejects=${probe.rejects}`,
    );
    for (const stationId of stationIds) {
      const record = (c20.stations ?? []).find((s) => s.stationId === stationId);
      const wantRubric = rubricOf(stationId);
      check(
        `T4 ${stationId} page checklist ids in scenario rubric order`,
        JSON.stringify((record?.rubric ?? []).map((item) => item.id)) === JSON.stringify(wantRubric.map((item) => item.id)),
        `got=${JSON.stringify((record?.rubric ?? []).map((item) => item.id))}`,
      );
      check(
        `T4 ${stationId} page rendered each checklist label in order`,
        JSON.stringify(record?.renderedIds ?? null) === JSON.stringify(wantRubric.map((item) => item.id)) &&
          JSON.stringify((record?.rubric ?? []).map((item) => item.label)) === JSON.stringify(wantRubric.map((item) => item.label)),
        `rendered=${JSON.stringify(record?.renderedIds)}`,
      );
      const wantChecked = checkedPattern(wantRubric.length);
      check(
        `page ${stationId} submitted the deterministic checked pattern with both acks`,
        JSON.stringify(Object.values(record?.submittedItems ?? {})) === JSON.stringify(wantChecked) &&
          record?.scoreAcked === true && record?.returnAcked === true,
        `submitted=${JSON.stringify(record?.submittedItems)}`,
      );
    }

    // T1: a Node replay client per station sees that scenario's rubric.
    for (const stationId of stationIds) {
      const reviewer = track(await connectNode(replayServer.url, { roomOptions: { replayStationId: stationId } }));
      let last = null;
      reviewer.onState((snapshot) => {
        last = snapshot;
      });
      const deadline = Date.now() + 20000;
      while (last?.replayDone !== true) {
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for replayDone ${stationId}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const wantRubric = rubricOf(stationId);
      check(
        `T1 ${stationId} replayRubric == that scenario's reviewRubric (ids + labels)`,
        JSON.stringify(last?.replayRubric ?? null) === JSON.stringify(wantRubric),
        `got=${JSON.stringify(last?.replayRubric)?.slice(0, 200)}`,
      );
      await reviewer.leave();
    }

    // T2: per-station score files (scenarioId, rubric order, no label text).
    run.scoreFiles = {};
    for (const stationId of stationIds) {
      const scenario = scenarioOf(stationId);
      const wantRubric = rubricOf(stationId);
      const wantChecked = checkedPattern(wantRubric.length);
      const raw = await readFile(join(scoreDir, `${stationId}${SCORE_SUFFIX}`), "utf8");
      const file = JSON.parse(raw);
      run.scoreFiles[stationId] = file;
      check(
        `T2 ${stationId} score file names the scenario and follows its rubric order`,
        JSON.stringify(file) ===
          JSON.stringify({
            schema: "openclinxr.xr-sync.faculty-score.v1",
            stationId,
            scenarioId: scenario.scenarioId,
            items: wantRubric.map((item, idx) => ({ id: item.id, checked: wantChecked[idx] })),
            checkedCount: wantChecked.filter(Boolean).length,
            rubricSize: wantRubric.length,
          }),
        `got=${raw.slice(0, 300)}`,
      );
      const leakedLabel = scenario.reviewRubric.map((item) => item.label).find((label) => raw.includes(label));
      check(
        `T2 ${stationId} score file has no label text, no session id, no timestamp-like field`,
        leakedLabel === undefined && !UUID_PATTERN.test(raw) && !TIMESTAMP_PATTERN.test(raw),
        leakedLabel === undefined ? "clean" : `leakedLabel=${leakedLabel.slice(0, 30)}`,
      );
    }

    // T3: a wrong-rubric score (other station's ids) rejects invalid-score
    // and leaves the file untouched; lobbyScores reflect each checkedCount.
    const [firstStation, secondStation] = stationIds;
    const filesBefore = {};
    for (const stationId of stationIds) {
      filesBefore[stationId] = await readFile(join(scoreDir, `${stationId}${SCORE_SUFFIX}`), "utf8");
    }
    for (const [stationId, otherId] of [[firstStation, secondStation], [secondStation, firstStation]]) {
      const reviewer = track(await connectNode(replayServer.url, { roomOptions: { replayStationId: stationId } }));
      let last = null;
      reviewer.onState((snapshot) => {
        last = snapshot;
      });
      const deadline = Date.now() + 20000;
      while (last?.replayDone !== true) {
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for replayDone ${stationId}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const otherRubric = rubricOf(otherId);
      const wrongItems = Object.fromEntries(otherRubric.map((item, idx) => [item.id, idx % 2 === 0]));
      const verdict = await reviewer.sendIntent("score-station", { items: wrongItems });
      check(
        `T3 ${stationId} wrong-rubric score (other station's ids) rejects invalid-score`,
        verdict.status === "reject" && verdict.reason === "invalid-score",
        `got=${JSON.stringify(verdict)}`,
      );
      await reviewer.leave();
    }
    for (const stationId of stationIds) {
      const after = await readFile(join(scoreDir, `${stationId}${SCORE_SUFFIX}`), "utf8");
      check(`T3 ${stationId} score file untouched by the wrong-rubric submit`, after === filesBefore[stationId], "byte-identical");
    }
    const lobby = track(await connectNode(replayServer.url, { roomOptions: { reviewLobby: true } }));
    let lobbyLast = null;
    lobby.onState((snapshot) => {
      lobbyLast = snapshot;
    });
    {
      const deadline = Date.now() + 10000;
      while (((lobbyLast?.lobbyStations ?? []).length ?? 0) !== stationIds.length) {
        if (Date.now() > deadline) {
          throw new Error("timed out waiting for T3 lobby");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    const wantBadges = stationIds.map((stationId) => {
      const wantChecked = checkedPattern(rubricOf(stationId).length).filter(Boolean).length;
      return { stationId, checkedCount: wantChecked };
    });
    check(
      "T3 lobby lobbyScores reflect each station's checkedCount",
      JSON.stringify(lobbyLast?.lobbyScores ?? null) === JSON.stringify(wantBadges),
      `scores=${JSON.stringify(lobbyLast?.lobbyScores)}`,
    );
    // Page badges agree with the server lobby.
    const pageBadges = {};
    for (const record of c20.stations ?? []) {
      pageBadges[record.stationId] = record.badgeCheckedCount;
    }
    check(
      "T4 page and server agree on each station's checkedCount",
      stationIds.every((stationId, i) => pageBadges[stationId] === wantBadges[i].checkedCount),
      `page=${JSON.stringify(pageBadges)} server=${JSON.stringify(wantBadges)}`,
    );

    // C14 where it applies: sign off from the lobby; the packet carries each
    // station's own rubricSize and totalPossible is the sum.
    const finalize = await lobby.sendIntent("finalize-review", {});
    check(
      "C14 finalize-review acked once every station carries its scenario score",
      finalize.status === "ack",
      `got=${JSON.stringify(finalize)}`,
    );
    const packetRaw = await readFile(join(scoreDir, PACKET_FILE), "utf8");
    const packet = JSON.parse(packetRaw);
    run.packet = packet;
    const expectedStations = [];
    for (const entry of index.stations ?? []) {
      const stationTrace = traceByStation.get(entry.stationId);
      const noteText =
        entry.notePresent === true && typeof entry.noteFile === "string"
          ? JSON.parse(await readFile(join(traceDir, entry.noteFile), "utf8")).text
          : null;
      const scoreFile = JSON.parse(await readFile(join(scoreDir, `${entry.stationId}${SCORE_SUFFIX}`), "utf8"));
      expectedStations.push({
        stationId: entry.stationId,
        stationIndex: entry.stationIndex,
        turnCount: (stationTrace.turns ?? []).length,
        turnEnds: (stationTrace.turns ?? []).map((t) => t.end),
        notePresent: entry.notePresent,
        noteText,
        score: { items: scoreFile.items, checkedCount: scoreFile.checkedCount, rubricSize: scoreFile.rubricSize },
      });
    }
    const expectedPacket = {
      schema: "openclinxr.xr-sync.faculty-review-packet.v1",
      sessionComplete: index.complete,
      stationCount: stationIds.length,
      stations: expectedStations,
      totalChecked: expectedStations.reduce((sum, s) => sum + s.score.checkedCount, 0),
      totalPossible: expectedStations.reduce((sum, s) => sum + s.score.rubricSize, 0),
    };
    run.expectedPacket = expectedPacket;
    check(
      "C14 packet equals the expected JSON (per-station rubricSize, summed totalPossible)",
      JSON.stringify(packet) === JSON.stringify(expectedPacket),
      `got=${packetRaw.slice(0, 300)}`,
    );
    check(
      "C23 packet totalPossible is the sum of the bank rubric sizes, not first size x station count",
      packet !== null &&
        packet.totalPossible === bank.reduce((sum, s) => sum + s.reviewRubric.length, 0) &&
        packet.totalPossible !== (bank[0]?.reviewRubric.length ?? 0) * bank.length,
      `totalPossible=${packet?.totalPossible} sizes=${bank.map((s) => s.reviewRubric.length).join(",")}`,
    );
    const leakedPacketLabel = bank.flatMap((s) => s.reviewRubric.map((item) => item.label)).find((label) => packetRaw.includes(label));
    check(
      "C14 packet has no label text, no session id, no timestamp-like field",
      leakedPacketLabel === undefined && !UUID_PATTERN.test(packetRaw) && !TIMESTAMP_PATTERN.test(packetRaw),
      leakedPacketLabel === undefined ? "clean" : `leakedLabel=${leakedPacketLabel.slice(0, 30)}`,
    );
    const locked = track(await connectNode(replayServer.url, { roomOptions: { replayStationId: firstStation } }));
    let lockedLast = null;
    locked.onState((snapshot) => {
      lockedLast = snapshot;
    });
    {
      const deadline = Date.now() + 20000;
      while (lockedLast?.replayDone !== true) {
        if (Date.now() > deadline) {
          throw new Error("timed out waiting for locked replayDone");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    const lockedVerdict = await locked.sendIntent("score-station", {
      items: Object.fromEntries(rubricOf(firstStation).map((item, idx) => [item.id, idx % 2 === 0])),
    });
    check(
      "C14 score-station after sign-off rejects review-finalized",
      lockedVerdict.status === "reject" && lockedVerdict.reason === "review-finalized",
      `got=${JSON.stringify(lockedVerdict)}`,
    );
    await locked.leave();
    await lobby.leave();

    await replayServer.close();
    replayServer = null;
    cleanup.replayClosed = true;
    await replayStatic.close();
    replayStatic = null;
    cleanup.replayStaticClosed = true;

    // C13 where it applies: the replay wrote nothing into the trace dir;
    // scoreDir holds exactly the two score files + the packet.
    run.sessionHashesAfter = await hashDirFiles(traceDir);
    const hashKeys = new Set([...Object.keys(run.sessionHashesBefore), ...Object.keys(run.sessionHashesAfter)]);
    const hashDiffs = [...hashKeys].filter((k) => run.sessionHashesBefore[k] !== run.sessionHashesAfter[k]);
    check(
      "session dir byte-identical before and after phase 2 (sha256 per file)",
      hashDiffs.length === 0,
      hashDiffs.length === 0 ? `files=${hashKeys.size}` : `diff=${hashDiffs.join(",").slice(0, 200)}`,
    );
    const scoreEntries = (await readdir(scoreDir)).sort();
    check(
      "scoreDir holds exactly the two score files + the packet",
      JSON.stringify(scoreEntries) === JSON.stringify([...stationIds.map((id) => `${id}${SCORE_SUFFIX}`), PACKET_FILE].sort()),
      `files=${scoreEntries.join(",")}`,
    );

    // A second replay server over the same dirs reads badges + finalized from disk.
    secondServer = await createEncounterServer({ replayDir: traceDir, replayStepMs: REPLAY_STEP_MS, scoreDir, scenarios: bank });
    const lobby2 = track(await connectNode(secondServer.url, { roomOptions: { reviewLobby: true } }));
    let lobby2Last = null;
    lobby2.onState((snapshot) => {
      lobby2Last = snapshot;
    });
    {
      const deadline = Date.now() + 10000;
      while (((lobby2Last?.lobbyStations ?? []).length ?? 0) !== stationIds.length) {
        if (Date.now() > deadline) {
          throw new Error("timed out waiting for second lobby");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    check(
      "second server lobby sees the same badges plus finalized from disk",
      JSON.stringify(lobby2Last?.lobbyScores ?? null) === JSON.stringify(wantBadges) && lobby2Last?.reviewFinalized === true,
      `scores=${JSON.stringify(lobby2Last?.lobbyScores)} finalized=${lobby2Last?.reviewFinalized}`,
    );
    await lobby2.leave();
    await secondServer.close();
    secondServer = null;
    cleanup.secondClosed = true;

    check(
      "bundle/source free of server imports, reply-table text, opening text, and rubric labels (phase 2)",
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
    for (const conn of nodeConns.splice(0)) {
      try {
        await conn.leave();
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
    await writeFile(join(outDir, "c20-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c20-run.json")}`);
  }
  process.exit(process.exitCode ?? 0);
}

await main(process.argv.slice(2));
process.exit(process.exitCode ?? 0);
