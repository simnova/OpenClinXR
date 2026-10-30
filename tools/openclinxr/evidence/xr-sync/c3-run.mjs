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

    // A1-A7 + probe-done/pageerrors/snapshot: shared verbatim with c4-run.mjs.
    runC3CoreChecks(check, {
      probe,
      probeStats: run.probeStats,
      serverState: run.serverState,
      expectedReplyIds,
      bundleCheck: run.bundleCheck,
      pageErrors: run.pageErrors,
    });

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
