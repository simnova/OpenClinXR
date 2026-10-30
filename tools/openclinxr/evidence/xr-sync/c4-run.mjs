#!/usr/bin/env node
/**
 * C4 host/quest harness: every actor turn carries renderable content (cueId +
 * server-driven emotion), and the room persists a review-safe trace that
 * replays to itself.
 *
 * Host:  node c4-run.mjs --mode host --out <dir>
 * Quest:  node c4-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C4 author; root runs it on-device)
 *
 * Flow: start createEncounterServer({ traceDir: <out>/trace }) -> serve the
 * built app -> open sync-probe.html?script=c3 in an owned browser target ->
 * the page auto-runs the FIXED C3 script (server turn + mid-turn interrupt) ->
 * collect server-side + page-side evidence -> keep the C3 assertions
 * (shared verbatim with c3-run.mjs via harness-lib, no copy-paste-diverge)
 * and add B1-B5 -> write c4-run.json -> cleanup (quest: also remove adb
 * reverses/forwards and verify with `adb reverse --list` / `adb forward
 * --list`).
 *
 * Host/quest plumbing lives in harness-lib.mjs (shared with c2/c3-run.mjs).
 * Exit 1 on any failed assertion. The run file is always written first.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectBundleSentry,
  collectQuestCleanupLists,
  parseArgs,
  runC3CoreChecks,
  runHostProbe,
  runQuestProbe,
  startStaticServer,
  summarize,
} from "./harness-lib.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKTREE_ROOT = resolve(HERE, "..", "..", "..", "..");
const SERVER_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "index.js");
// A3 replay inputs come from the server's own dist room module (same build as
// the server under test), never hard-coded in the harness. The C3/C4 table,
// picker, and trace reducer stay out of the "." public surface
// (psr-c6-xr-sync-c1 pins it by hash), so the harness reaches the module
// files directly.
const SERVER_ROOM_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "room.js");
const SERVER_TRACE_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "conversation-trace.js");
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const APP_SRC_SYNC_PROBE = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "src", "sync-probe");

// B1 literal (harness-owned, not from the build under test): the exact
// 4-transition emotion sequence the POLICY implies for the C3 script
// (complete, interrupt, complete). This closes the C3 grade defect that A3
// expected values came from the build under test.
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
  const syncServer = await createEncounterServer({ traceDir });
  const staticServer = await startStaticServer(APP_DIST);
  const cleanup = { syncClosed: false, staticClosed: false };

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    script: "c3",
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
    traceFile: null,
    elapsedMs: null,
  };

  let exitCode = 0;
  try {
    const params = new URLSearchParams({
      sync: syncServer.url,
      iwer: "1",
      autostart: "1",
      script: "c3",
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

    const check = (name, pass, detail) => {
      run.assertions.push({ name, pass, detail: String(detail ?? "") });
      if (!pass) {
        exitCode = 1;
      }
    };

    // C3 assertions kept verbatim (shared with c3-run.mjs, no divergence).
    runC3CoreChecks(check, {
      probe,
      probeStats: run.probeStats,
      serverState: run.serverState,
      expectedReplyIds,
      bundleCheck: run.bundleCheck,
      pageErrors: run.pageErrors,
    });

    // B1: server trace emotions (from,to,trigger,changed) equal the literal
    // sequence the policy implies for the C3 script.
    const traceEmotions = (run.serverTrace.emotions ?? []).map(({ from, to, trigger, changed }) => ({
      from,
      to,
      trigger,
      changed,
    }));
    check(
      "B1 server trace emotions equal the policy literal for the C3 script",
      JSON.stringify(traceEmotions) === JSON.stringify(EXPECTED_C4_EMOTIONS),
      `got=${JSON.stringify(traceEmotions)}`,
    );

    // B2: server trace turns cueIds: 3 distinct, each equals the server table
    // row for that replyId.
    const traceTurns = run.serverTrace.turns ?? [];
    const cueIds = traceTurns.map((t) => t.cueId);
    const cueByReplyId = new Map(C3_REPLY_TABLE.map((entry) => [entry.id, entry.cueId]));
    check(
      "B2 server trace turns cueIds 3 distinct, each equals the table row for its replyId",
      new Set(cueIds).size === 3 &&
        cueIds.every((cue) => typeof cue === "string" && cue.length > 0) &&
        traceTurns.every((t) => cueByReplyId.get(t.replyId) === t.cueId),
      traceTurns.map((t) => `${t.turnId}:${t.replyId}:${t.cueId}`).join(" ") || "no turns",
    );

    // Close the sync server BEFORE the file checks: close flushes the trace
    // file (same content the room writes on dispose).
    await syncServer.close();
    cleanup.syncClosed = true;

    // B3: exactly one persisted trace file; schema matches; it replays to
    // itself; a tampered copy replays to the untampered values.
    const traceFiles = (await readdir(traceDir)).filter((f) => f.endsWith(".conversation-trace.json"));
    check(
      "B3 exactly one *.conversation-trace.json in traceDir after server close",
      traceFiles.length === 1,
      traceFiles.join(",") || "no trace files",
    );
    if (traceFiles.length === 1) {
      const tracePath = join(traceDir, traceFiles[0]);
      run.traceFile = tracePath;
      const raw = await readFile(tracePath, "utf8");
      const persisted = JSON.parse(raw);
      check(
        "B3 persisted trace schema matches and replays to itself",
        persisted.schema === CONVERSATION_TRACE_SCHEMA &&
          JSON.stringify(replayConversationTrace(persisted).turns) === JSON.stringify(persisted.turns) &&
          JSON.stringify(replayConversationTrace(persisted).emotions) === JSON.stringify(persisted.emotions),
        `schema=${persisted.schema} turns=${persisted.turns?.length} emotions=${persisted.emotions?.length}`,
      );
      const tampered = JSON.parse(raw);
      tampered.turns[0].replyId = "tampered";
      tampered.emotions[0].to = "tampered";
      const replayed = replayConversationTrace(tampered);
      check(
        "B3 tampered copy (turns[0].replyId changed) replays to the untampered values",
        JSON.stringify(replayed.turns) === JSON.stringify(persisted.turns) &&
          JSON.stringify(replayed.emotions) === JSON.stringify(persisted.emotions),
        `replayed0=${replayed.turns?.[0]?.replyId}`,
      );

      // B4: the persisted file carries no learner sessionId and no reply text.
      const learnerSessionIds = Object.keys(run.serverState.learners ?? {});
      check(
        "B4 trace file contains no learner sessionId and no reply text",
        learnerSessionIds.every((id) => !raw.includes(id)) &&
          replyTexts.every((text) => !raw.includes(text)),
        `sessions=${learnerSessionIds.length} checked, texts=${replyTexts.length} checked`,
      );
    } else {
      check("B3 persisted trace schema matches and replays to itself", false, "no single trace file");
      check("B3 tampered copy (turns[0].replyId changed) replays to the untampered values", false, "no single trace file");
      check("B4 trace file contains no learner sessionId and no reply text", false, "no single trace file");
    }

    // B5 (page-reported): cues/emotions follow the server; the mouth never
    // moves while the server says silent, and moved while speaking.
    const cuesObserved = probe.cuesObserved ?? [];
    const emotionsObserved = probe.emotionsObserved ?? [];
    check(
      "B5 (page-reported) cuesObserved equals server turns (turnId,cueId)",
      JSON.stringify(cuesObserved) ===
        JSON.stringify(traceTurns.map((t) => ({ turnId: t.turnId, cueId: t.cueId }))),
      `observed=${JSON.stringify(cuesObserved)}`,
    );
    check(
      "B5 (page-reported) emotionsObserved contains concerned after the interrupt and ends neutral",
      emotionsObserved.includes("concerned") && emotionsObserved[emotionsObserved.length - 1] === "neutral",
      `observed=${JSON.stringify(emotionsObserved)}`,
    );
    check(
      "B5 (page-reported) mouth silent while server silent, active while speaking",
      probe.mouthActiveWhileSilentFrames === 0 && probe.mouthActiveSpeakingFrames > 0,
      `silent=${probe.mouthActiveWhileSilentFrames} speaking=${probe.mouthActiveSpeakingFrames}`,
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
    await writeFile(join(outDir, "c4-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c4-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
// A Playwright CDP connection to the device browser keeps the event loop alive
// (quest run hung after writing c2-run.json); exit explicitly.
process.exit(process.exitCode ?? 0);
