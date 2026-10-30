#!/usr/bin/env node
/**
 * C10 host/quest harness: a faculty reviewer replays one recorded station on the headset.
 *
 * Host:  node c10-run.mjs --mode host --out <dir>
 * Quest:  node c10-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C10 author; root runs it on-device)
 *
 * Flow (imports harness-lib.mjs and shells out to c9-run.mjs; nothing copied):
 *   phase 1 runs the C9 session on host (child: c9-run.mjs --mode host)
 *     into <out>/session (C9 G1-G5 + all C8 checks run there, carried here).
 *   phase 2 boots a replay server on <out>/session/trace (replayStepMs 300:
 *     6 patch intervals per event) and opens the page with
 *     ?script=c10&replayStationId=station-2 (host browser or Quest per --mode).
 *
 * Assertions:
 *   H1 page-observed turns (turnId, actorId, replyId, cueId) equal the
 *      station-2 trace file's turns, read by the harness from disk.
 *   H2 page-observed ends equal trace turns[].end; emotions equal the
 *      changed:true "to" values of trace emotions; phases equal the index
 *      entry phases for station-2.
 *   H3 page saw mode "replay", stationId station-2, replayDone true; its one
 *      select-actor got reject "replay-read-only" (and nothing was acked).
 *   H4 session dir byte-identical before and after phase 2 (sha256 per file).
 *   H5 replay duration from first to last observed state change is within
 *      [N-1, N+2] x 300 ms where N = station-2 event count (one event per
 *      step; +2 for patch interval and page load jitter), measured recorded.
 * plus the C9 G1-G5 checks on phase 1 (carried from the child run).
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
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const APP_SRC_SYNC_PROBE = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "src", "sync-probe");
const C9_RUN = join(HERE, "c9-run.mjs");

const REPLAY_STEP_MS = 300;
const REPLAY_STATION_ID = "station-2";

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
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    script: "c10",
    replayStationId: REPLAY_STATION_ID,
    replayStepMs: REPLAY_STEP_MS,
    sessionDir,
    syncUrl: null,
    pageUrl: null,
    probe: null,
    phase1: null,
    sessionHashesBefore: null,
    sessionHashesAfter: null,
    expectedTurns: null,
    expectedEnds: null,
    expectedEmotions: null,
    expectedPhases: null,
    replayEventCount: null,
    replayDurationMs: null,
    rttMs: null,
    frameMs: null,
    assertions: [],
    pageErrors: [],
    consoleErrors: [],
    adbReverseList: null,
    adbForwardList: null,
    bundleCheck: null,
    elapsedMs: null,
  };
  let exitCode = 0;
  const check = (name, pass, detail) => {
    run.assertions.push({ name, pass: Boolean(pass), detail: String(detail ?? "") });
    if (!pass) {
      exitCode = 1;
    }
  };

  let syncServer = null;
  let staticServer = null;
  try {
    // Phase 1: the C9 session on host, in a child process (same as c9-run host).
    let phase1Stdout = "";
    try {
      const child = await execFileAsync(process.execPath, [C9_RUN, "--mode", "host", "--out", sessionDir], {
        timeout: 300000,
        maxBuffer: 16 * 1024 * 1024,
      });
      phase1Stdout = String(child.stdout ?? "");
    } catch (error) {
      phase1Stdout = String(error?.stdout ?? "");
      throw new Error(`phase 1 c9-run host failed: ${String(error?.message ?? error).slice(0, 300)}`);
    }
    const phase1 = JSON.parse(await readFile(join(sessionDir, "c9-run.json"), "utf8"));
    run.phase1 = {
      elapsedMs: phase1.elapsedMs ?? null,
      assertions: phase1.assertions ?? [],
      reviewIndexWriteLagMs: phase1.reviewIndexWriteLagMs ?? null,
      traceFiles: phase1.traceFiles ?? [],
      tail: phase1Stdout.trim().split("\n").slice(-8),
    };
    const phase1Failed = (phase1.assertions ?? []).filter((a) => !a.pass);
    check(
      "phase 1 c9-run host passes (C9 G1-G5 + C8 checks carried)",
      phase1Failed.length === 0,
      `failed=${phase1Failed.length} total=${(phase1.assertions ?? []).length} lag=${phase1.reviewIndexWriteLagMs}ms`,
    );
    for (const assertion of phase1.assertions ?? []) {
      if (/^G[1-5]\b|^G[1-5] /.test(assertion.name)) {
        check(`phase 1 ${assertion.name}`, assertion.pass, assertion.detail);
      }
    }

    // H4 baseline: hash the session dir before phase 2 touches it.
    const traceDir = join(sessionDir, "trace");
    run.sessionHashesBefore = await hashDirFiles(sessionDir);
    const index = JSON.parse(await readFile(join(traceDir, "exam-session.review-index.json"), "utf8"));
    const entry = (index.stations ?? []).find((s) => s.stationId === REPLAY_STATION_ID);
    if (!entry) {
      throw new Error(`phase 1 index has no ${REPLAY_STATION_ID} entry`);
    }
    const trace = JSON.parse(await readFile(join(traceDir, entry.traceFile), "utf8"));
    run.expectedTurns = (trace.turns ?? []).map((t) => ({ turnId: t.turnId, actorId: t.actorId, replyId: t.replyId, cueId: t.cueId }));
    run.expectedEnds = (trace.turns ?? []).map((t) => t.end);
    run.expectedEmotions = (trace.emotions ?? []).filter((e) => e.changed === true).map((e) => e.to);
    run.expectedPhases = [...(entry.phases ?? [])];
    run.replayEventCount = (trace.events ?? []).length;

    // Phase 2: replay server on the phase-1 session dir (read-only review).
    const serverModule = await import(SERVER_DIST);
    const { createEncounterServer } = serverModule;
    const { C3_REPLY_TABLE } = await import(SERVER_ROOM_DIST);
    const replyTexts = C3_REPLY_TABLE.map((e) => e.text);
    syncServer = await createEncounterServer({ replayDir: traceDir, replayStepMs: REPLAY_STEP_MS });
    run.syncUrl = syncServer.url;
    const syncPort = syncServer.port;
    staticServer = await startStaticServer(APP_DIST);
    const staticPort = staticServer.port;

    const params = new URLSearchParams({
      sync: syncServer.url,
      iwer: "1",
      autostart: "1",
      script: "c10",
      replayStationId: REPLAY_STATION_ID,
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
    run.rttMs = summarize(probe.rttMs ?? []);
    run.frameMs = summarize(probe.frameMs ?? []);
    run.bundleCheck = await collectBundleSentry({
      appDist: APP_DIST,
      appSrcSyncProbe: APP_SRC_SYNC_PROBE,
      extraBanned: replyTexts,
    });

    const c10 = probe.c10 ?? {};
    const lastState = probe.lastServerState ?? {};
    check(
      "H1 page-observed turns equal the station-2 trace turns from disk",
      JSON.stringify(c10.turns ?? null) === JSON.stringify(run.expectedTurns),
      `got=${JSON.stringify(c10.turns ?? null)?.slice(0, 200)}`,
    );
    check(
      "H2 page-observed ends equal trace turns[].end",
      JSON.stringify(c10.ends ?? null) === JSON.stringify(run.expectedEnds),
      `got=${JSON.stringify(c10.ends ?? null)} want=${JSON.stringify(run.expectedEnds)}`,
    );
    check(
      "H2 page-observed emotions equal the changed:true to values of trace emotions",
      JSON.stringify(c10.emotions ?? null) === JSON.stringify(run.expectedEmotions),
      `got=${JSON.stringify(c10.emotions ?? null)} want=${JSON.stringify(run.expectedEmotions)}`,
    );
    check(
      "H2 page-observed phases equal the index entry phases for station-2",
      JSON.stringify(c10.phases ?? null) === JSON.stringify(run.expectedPhases),
      `got=${JSON.stringify(c10.phases ?? null)} want=${JSON.stringify(run.expectedPhases)}`,
    );
    check(
      "H3 page saw mode replay, stationId station-2, replayDone true",
      (c10.mode ?? lastState.mode) === "replay" &&
        (c10.stationId ?? lastState.stationId) === REPLAY_STATION_ID &&
        (c10.replayDone ?? lastState.replayDone) === true,
      `mode=${c10.mode ?? lastState.mode} station=${c10.stationId ?? lastState.stationId} done=${c10.replayDone ?? lastState.replayDone}`,
    );
    const rejects = probe.rejectDetails ?? [];
    check(
      "H3 the one select-actor got reject replay-read-only (nothing acked)",
      probe.sent === 1 && probe.acks === 0 && probe.rejects === 1 &&
        rejects.length === 1 && rejects[0]?.reason === "replay-read-only",
      `sent=${probe.sent} acks=${probe.acks} rejects=${probe.rejects} reason=${rejects[0]?.reason}`,
    );

    await syncServer.close();
    syncServer = null;
    try {
      await staticServer.close();
    } catch {
      // best-effort
    }
    staticServer = null;

    // H4: the replay wrote nothing into the session dir.
    run.sessionHashesAfter = await hashDirFiles(sessionDir);
    const hashKeys = new Set([...Object.keys(run.sessionHashesBefore), ...Object.keys(run.sessionHashesAfter)]);
    const hashDiffs = [...hashKeys].filter((k) => run.sessionHashesBefore[k] !== run.sessionHashesAfter[k]);
    check(
      "H4 session dir byte-identical before and after phase 2 (sha256 per file)",
      hashDiffs.length === 0,
      hashDiffs.length === 0 ? `files=${hashKeys.size}` : `diff=${hashDiffs.join(",").slice(0, 200)}`,
    );

    // H5: replay duration within [N-1, N+2] x stepMs.
    const firstAt = c10.firstSnapshotAtMs ?? null;
    const lastAt = c10.lastChangeAtMs ?? null;
    const duration = typeof firstAt === "number" && typeof lastAt === "number" ? lastAt - firstAt : null;
    run.replayDurationMs = duration !== null ? Number(duration.toFixed(2)) : null;
    const eventCount = run.replayEventCount ?? 0;
    const lo = (eventCount - 1) * REPLAY_STEP_MS;
    const hi = (eventCount + 2) * REPLAY_STEP_MS;
    check(
      `H5 replay duration within [N-1, N+2] x ${REPLAY_STEP_MS}ms (N=${eventCount})`,
      duration !== null && duration >= lo && duration <= hi,
      `duration=${run.replayDurationMs}ms window=[${lo},${hi}]`,
    );

    check(
      "bundle/source free of server imports and reply-table text",
      (run.bundleCheck?.hits ?? []).length === 0,
      (run.bundleCheck?.hits ?? []).join(" | ").slice(0, 300) || "clean",
    );
    check("probe completed without error", probe.done === true && probe.error == null, probe.error ?? "done");
    check("no page errors", (run.pageErrors ?? []).length === 0, (run.pageErrors ?? []).join(" | ").slice(0, 300) || "0 pageerrors");

    if (options.mode === "quest") {
      const { adbReverseList, adbForwardList, leaked } = await collectQuestCleanupLists({
        staticPort,
        syncPort,
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
    if (syncServer) {
      try {
        await syncServer.close();
      } catch {
        // best-effort
      }
    }
    if (staticServer) {
      try {
        await staticServer.close();
      } catch {
        // best-effort
      }
    }
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c10-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c10-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
process.exit(process.exitCode ?? 0);
