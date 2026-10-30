#!/usr/bin/env node
/**
 * C2 host/quest harness: server-authoritative sync probe with scripted IWER input.
 *
 * Host:  node c2-run.mjs --mode host --out <dir>
 * Quest:  node c2-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C2 author; root runs it on-device)
 *
 * Flow: start createEncounterServer (ephemeral) -> serve the built app ->
 * open sync-probe.html in an owned browser target -> the page auto-runs the
 * FIXED deterministic script through IWER (head yaw sweep 0->+30->-30->0 over
 * 6 s, aim+trigger on a1 then a2) -> collect server-side + page-side evidence
 * -> assert -> write run JSON -> cleanup (quest: also remove adb reverses and
 * verify with `adb reverse --list`).
 *
 * Host/quest plumbing lives in harness-lib.mjs (shared with c3-run.mjs).
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
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const APP_SRC_SYNC_PROBE = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "src", "sync-probe");

async function main(argv) {
  const options = parseArgs(argv);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  const { createEncounterServer } = await import(SERVER_DIST);
  const syncServer = await createEncounterServer();
  const staticServer = await startStaticServer(APP_DIST);
  const cleanup = { syncClosed: false, staticClosed: false };

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    syncUrl: syncServer.url,
    pageUrl: null,
    probe: null,
    serverState: null,
    probeStats: null,
    rttMs: null,
    frameMs: null,
    assertions: [],
    pageErrors: [],
    consoleErrors: [],
    adbReverseList: null,
    bundleCheck: null,
    elapsedMs: null,
  };

  let exitCode = 0;
  try {
    const params = new URLSearchParams({
      sync: syncServer.url,
      iwer: "1",
      autostart: "1",
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
    run.bundleCheck = await collectBundleSentry({ appDist: APP_DIST, appSrcSyncProbe: APP_SRC_SYNC_PROBE });

    const check = (name, pass, detail) => {
      run.assertions.push({ name, pass, detail: String(detail ?? "") });
      if (!pass) {
        exitCode = 1;
      }
    };

    const learnerIds = Object.keys(run.serverState.learners ?? {});
    const learner = learnerIds.length === 1 ? run.serverState.learners[learnerIds[0]] : null;
    const lastPose = probe.lastSentPose;
    check("probe completed without error", probe.done === true && probe.error == null, probe.error ?? "done");
    check("no page errors", run.pageErrors.length === 0, run.pageErrors.join(" | ").slice(0, 300) || "0 pageerrors");
    check("rejects == 0", probe.rejects === 0 && (probe.rejectDetails ?? []).length === 0, `rejects=${probe.rejects}`);
    const sentSeqs = probe.sentSeqs ?? [];
    const ackSeqs = probe.ackSeqs ?? [];
    const inOrder = sentSeqs.length > 0 && sentSeqs.length === ackSeqs.length && sentSeqs.every((seq, i) => seq === i + 1 && ackSeqs[i] === seq);
    check("every sent seq acked in order", inOrder, `sent=${sentSeqs.length} acks=${ackSeqs.length}`);
    check(
      "server learner pose equals page last sent pose (exact)",
      learner !== null && lastPose !== null && learner.lastSeq === lastPose.seq && learner.headX === lastPose.x && learner.headY === lastPose.y && learner.headZ === lastPose.z,
      `server=${learner ? `${learner.headX},${learner.headY},${learner.headZ}#${learner.lastSeq}` : "none"} page=${lastPose ? `${lastPose.x},${lastPose.y},${lastPose.z}#${lastPose.seq}` : "none"}`,
    );
    const selectedSequence = (run.probeStats.selections ?? []).map((entry) => entry.actorId);
    check("server selected-actor sequence == [a1,a2]", JSON.stringify(selectedSequence) === JSON.stringify(["a1", "a2"]), selectedSequence.join(",") || "empty");
    check("page-local selection matches server", JSON.stringify(probe.selectedLocal ?? []) === JSON.stringify(["a1", "a2"]), (probe.selectedLocal ?? []).join(",") || "empty");
    check("no select misses", (probe.selectMisses ?? 0) === 0, `misses=${probe.selectMisses ?? 0}`);
    const counts = run.probeStats.intentCounts ?? {};
    check(
      "server intent counts match page sends",
      counts.pose === (probe.sentByKind?.pose ?? -1) && counts["select-actor"] === 2 && counts["utterance-start"] === 2,
      JSON.stringify(counts),
    );
    // C3 meaning (updated from the C2 "a1+a2 speaking" assertion): each trigger
    // is select + one learner utterance, so the run ends with the learner
    // holding the turn and both actors silent. Justification: under the C3
    // server, actor speaking follows the server reply, never the trigger.
    const actors = run.serverState.actors ?? {};
    check(
      "server turn state is C3-learner-holds-turn (a1+a2 silent, learner speaking)",
      actors.a1?.speaking === false && actors.a2?.speaking === false && learner?.speaking === true && run.serverState.turnOwner === "learner",
      `a1=${actors.a1?.speaking} a2=${actors.a2?.speaking} learner=${learner?.speaking} owner=${run.serverState.turnOwner}`,
    );
    check("page snapshot caught up to final seq (page-reported)", probe.lastServerState?.learners?.[learnerIds[0]]?.lastSeq === probe.sent, `snapshotSeq=${probe.lastServerState?.learners?.[learnerIds[0]]?.lastSeq} sent=${probe.sent}`);
    check("bundle/source free of server imports", run.bundleCheck.hits.length === 0, run.bundleCheck.hits.join(" | ").slice(0, 300) || "clean");

    if (options.mode === "quest") {
      run.adbReverseList = await adb(options.serial, ["reverse", "--list"]);
      const leaked = run.adbReverseList.includes(`${staticServer.port}`) || run.adbReverseList.includes(`${syncServer.port}`);
      check("adb reverses removed", !leaked, run.adbReverseList.slice(0, 300) || "empty list");
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
    await writeFile(join(outDir, "c2-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c2-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
// A Playwright CDP connection to the device browser keeps the event loop alive
// (quest run hung after writing c2-run.json); exit explicitly.
process.exit(process.exitCode ?? 0);
