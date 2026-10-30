#!/usr/bin/env node
/**
 * C3 host/quest harness: the SERVER drives the actor's turn.
 *
 * Host:  node c3-run.mjs --mode host --out <dir>
 * Quest:  node c3-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C3 author; root runs it on-device)
 *
 * Flow: start createEncounterServer (ephemeral) -> serve the built app ->
 * open sync-probe.html?script=c3 in an owned browser target -> the page
 * auto-runs the FIXED C3 script through IWER (short head sweep, aim+trigger
 * a1 once for select-actor only, then utterance-start/end x2, interrupt,
 * utterance-start/end) with every interrupt wait keyed on observed server
 * state -> collect server-side + page-side evidence -> assert A1-A8 ->
 * write c3-run.json -> cleanup (quest: also remove adb reverses/forwards and
 * verify with `adb reverse --list` / `adb forward --list`).
 *
 * Host/quest plumbing lives in harness-lib.mjs (shared with c2-run.mjs).
 * Exit 1 on any failed assertion. The run file is always written first.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adb,
  collectBundleSentry,
  parseArgs,
  runHostProbe,
  runQuestProbe,
  startStaticServer,
  summarize,
} from "./harness-lib.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKTREE_ROOT = resolve(HERE, "..", "..", "..", "..");
const SERVER_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "index.js");
// A3 replay inputs come from the server's own dist room module (same build as
// the server under test), never hard-coded in the harness. The C3 table/picker
// stay out of the "." public surface (psr-c6-xr-sync-c1 pins it by hash), so
// the harness reaches the room module file directly.
const SERVER_ROOM_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "room.js");
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const APP_SRC_SYNC_PROBE = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "src", "sync-probe");

async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  const serverModule = await import(SERVER_DIST);
  const { createEncounterServer } = serverModule;
  const { pickC3Reply, C3_REPLY_TABLE } = await import(SERVER_ROOM_DIST);
  const expectedReplyIds = [pickC3Reply(1).id, pickC3Reply(2).id, pickC3Reply(3).id];
  const replyTexts = C3_REPLY_TABLE.map((entry) => entry.text);
  const syncServer = await createEncounterServer();
  const staticServer = await startStaticServer(APP_DIST);
  const cleanup = { syncClosed: false, staticClosed: false };

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    script: "c3",
    syncUrl: syncServer.url,
    pageUrl: null,
    probe: null,
    serverState: null,
    probeStats: null,
    expectedReplyIds,
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

    const turns = run.probeStats.turns ?? [];

    // A1: server turn log ends, ids, and actor.
    check(
      "A1 server turns end [completed,interrupted,completed], ids [1,2,3], all a1",
      JSON.stringify(turns.map((t) => t.end)) === JSON.stringify(["completed", "interrupted", "completed"]) &&
        JSON.stringify(turns.map((t) => t.turnId)) === JSON.stringify([1, 2, 3]) &&
        turns.every((t) => t.actorId === "a1"),
      turns.map((t) => `${t.turnId}:${t.actorId}:${t.replyId}:${t.end}`).join(" ") || "no turns",
    );

    // A2: interrupt ordering from server data (endSeq of turn 2 == page's 3rd
    // utterance-start seq, and strictly before turn 3's startSeq).
    const utteranceStarts = (probe.sentSeqsByKind ?? {})["utterance-start"] ?? [];
    const thirdStart = utteranceStarts[2];
    check(
      "A2 turns[1].endSeq is page 3rd utterance-start and < turns[2].startSeq",
      turns.length === 3 && turns[1].endSeq === thirdStart && turns[1].endSeq < turns[2].startSeq,
      `endSeq=${turns[1]?.endSeq} thirdStart=${thirdStart} nextStart=${turns[2]?.startSeq}`,
    );

    // A3: replay check against the server's own table/picker (never hard-coded).
    check(
      "A3 replyIds equal server table/picker sequence",
      JSON.stringify(turns.map((t) => t.replyId)) === JSON.stringify(expectedReplyIds),
      `got=${turns.map((t) => t.replyId).join(",")} want=${expectedReplyIds.join(",")}`,
    );

    // A4: server intent counts and in-order acks.
    const counts = run.probeStats.intentCounts ?? {};
    const sentSeqs = probe.sentSeqs ?? [];
    const ackSeqs = probe.ackSeqs ?? [];
    const inOrder =
      sentSeqs.length > 0 &&
      sentSeqs.length === ackSeqs.length &&
      sentSeqs.every((seq, i) => seq === i + 1 && ackSeqs[i] === seq);
    check(
      "A4 server intents start3/end3/select1/rejects0, every seq acked in order",
      counts["utterance-start"] === 3 &&
        counts["utterance-end"] === 3 &&
        counts["select-actor"] === 1 &&
        probe.rejects === 0 &&
        (probe.rejectDetails ?? []).length === 0 &&
        inOrder,
      `counts=${JSON.stringify(counts)} rejects=${probe.rejects} sent=${sentSeqs.length} acks=${ackSeqs.length}`,
    );

    // A5: final server state.
    const learnerIds = Object.keys(run.serverState.learners ?? {});
    const learner = learnerIds.length === 1 ? run.serverState.learners[learnerIds[0]] : null;
    check(
      "A5 final server state turnOwner none, a1 silent, learner silent, turnId 3",
      run.serverState.turnOwner === "none" &&
        run.serverState.actors?.a1?.speaking === false &&
        learner?.speaking === false &&
        run.serverState.turnId === 3,
      `owner=${run.serverState.turnOwner} a1=${run.serverState.actors?.a1?.speaking} learner=${learner?.speaking} turnId=${run.serverState.turnId}`,
    );

    // A6 (page-reported): the page observed every server turn transition.
    const observed = probe.turnsObserved ?? [];
    const trueFor = (tid) => observed.some((o) => o.turnId === tid && o.speaking === true);
    const trueAt3 = observed.find((o) => o.turnId === 3 && o.speaking === true);
    const falseAfter3 = observed.some((o) => o.turnId === 3 && o.speaking === false && trueAt3 && o.atMs > trueAt3.atMs);
    check(
      "A6 (page-reported) turnsObserved has speaking=true for 1,2,3 and speaking=false after 3",
      trueFor(1) && trueFor(2) && trueFor(3) && falseAfter3,
      `observed=${observed.length} true123=${[trueFor(1), trueFor(2), trueFor(3)].join(",")} falseAfter3=${falseAfter3}`,
    );

    // A7: reply text lives on the server only (no text field was added to schema).
    check(
      "A7 bundle/source free of server imports and reply-table text",
      run.bundleCheck.hits.length === 0,
      run.bundleCheck.hits.join(" | ").slice(0, 300) || "clean",
    );

    check("probe completed without error", probe.done === true && probe.error == null, probe.error ?? "done");
    check("no page errors", run.pageErrors.length === 0, run.pageErrors.join(" | ").slice(0, 300) || "0 pageerrors");
    check(
      "page snapshot caught up to final seq (page-reported)",
      probe.lastServerState?.learners?.[learnerIds[0]]?.lastSeq === probe.sent,
      `snapshotSeq=${probe.lastServerState?.learners?.[learnerIds[0]]?.lastSeq} sent=${probe.sent}`,
    );

    if (options.mode === "quest") {
      run.adbReverseList = await adb(options.serial, ["reverse", "--list"]);
      run.adbForwardList = await adb(options.serial, ["forward", "--list"]);
      const leaked =
        run.adbReverseList.includes(`${staticServer.port}`) ||
        run.adbReverseList.includes(`${syncServer.port}`) ||
        run.adbReverseList.includes("tcp:9222") ||
        run.adbForwardList.includes(`${staticServer.port}`) ||
        run.adbForwardList.includes(`${syncServer.port}`) ||
        run.adbForwardList.includes("tcp:9222");
      check(
        "A8 adb reverse/forward lists contain neither run port nor tcp:9222 after cleanup",
        !leaked,
        `reverse=${(run.adbReverseList ?? "").slice(0, 200)} forward=${(run.adbForwardList ?? "").slice(0, 200)}`,
      );
    }
  } catch (error) {
    exitCode = 1;
    run.fatal = String(error?.stack ?? error).slice(0, 1000);
  } finally {
    try {
      await syncServer.close();
      cleanup.syncClosed = true;
    } catch {
      // best-effort
    }
    try {
      await staticServer.close();
      cleanup.staticClosed = true;
    } catch {
      // best-effort
    }
    run.cleanup = cleanup;
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c3-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c3-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
// A Playwright CDP connection to the device browser keeps the event loop alive
// (quest run hung after writing c2-run.json); exit explicitly.
process.exit(process.exitCode ?? 0);
