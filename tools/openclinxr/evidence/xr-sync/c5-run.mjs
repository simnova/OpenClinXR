#!/usr/bin/env node
/**
 * C5 host/quest harness: a faculty observer joins the SAME encounter read-only
 * while the headset learner converses, sees turn/cue/emotion state live through
 * schema sync, cannot change anything, and is recorded in the review-safe trace
 * without identity.
 *
 * Host:  node c5-run.mjs --mode host --out <dir>
 * Quest:  node c5-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C5 author; root runs it on-device)
 *
 * Flow: start createEncounterServer({ traceDir: <out>/trace }) -> BEFORE
 * opening the page, connect a host Node observer with
 * connect(url, { roomOptions: { actors: ["a1","a2"], role: "observer" } })
 * (same actors so room creation is identical whichever client arrives first)
 * -> record every observer snapshot change of
 * turnId/turnOwner/actors.a1.{speaking,cueId,emotion} with host receive time
 * (performance.now + Date.now) -> the page runs ?script=c3 as in C4 -> after
 * the script the observer sends one intent of each kind and records the
 * replies -> observer leaves before server close -> write c5-run.json.
 *
 * Host/quest plumbing and the C3 core checks come from harness-lib.mjs
 * (imported, never copied). B1-B5 mirror c4-run.mjs verbatim in assertion
 * name and pass logic (c4-run has no exports and runs on import, so its
 * checks cannot be imported; the shared runner runC3CoreChecks IS imported).
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
const SERVER_ROOM_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "room.js");
const SERVER_TRACE_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "conversation-trace.js");
const CLIENT_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-client", "dist", "index.js");
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const APP_SRC_SYNC_PROBE = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "src", "sync-probe");

// B1 literal (harness-owned, not from the build under test): the exact
// 4-transition emotion sequence the POLICY implies for the C3 script
// (complete, interrupt, complete). Same literal as c4-run.mjs.
const EXPECTED_C4_EMOTIONS = [
  { from: "neutral", to: "reassured", trigger: "learner_acknowledgement", changed: true },
  { from: "reassured", to: "reassured", trigger: "learner_acknowledgement", changed: false },
  { from: "reassured", to: "concerned", trigger: "learner_interruption", changed: true },
  { from: "concerned", to: "neutral", trigger: "learner_acknowledgement", changed: true },
];

// C5 observer lag bound: 1000 ms. Provenance: 20x the 50 ms schema patch
// interval; host and Quest share the host clock because the server and the
// Node observer both run on the host.
const OBSERVER_LAG_MAX_MS = 1000;

function observerKey(snapshot) {
  const a1 = snapshot?.actors?.a1 ?? {};
  return JSON.stringify({
    turnId: snapshot?.turnId ?? null,
    turnOwner: snapshot?.turnOwner ?? null,
    speaking: a1.speaking ?? null,
    cueId: a1.cueId ?? null,
    emotion: a1.emotion ?? null,
  });
}

async function waitFor(condition, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (condition()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

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
  const { connect: connectObserver } = await import(CLIENT_DIST);
  const expectedReplyIds = [pickC3Reply(1).id, pickC3Reply(2).id, pickC3Reply(3).id];
  const replyTexts = C3_REPLY_TABLE.map((entry) => entry.text);
  const syncServer = await createEncounterServer({ traceDir });
  const staticServer = await startStaticServer(APP_DIST);
  const cleanup = { syncClosed: false, staticClosed: false, observerLeft: false };

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
    // C5 observer-reported evidence (Node observer on the host).
    observerReported: {
      sessionId: null,
      changes: [],
      finalSnapshot: null,
      intentReplies: [],
      intentCountsBefore: null,
      intentCountsAfter: null,
      serverTickBefore: null,
      serverTickAfter: null,
      lagMs: null,
    },
  };

  let exitCode = 0;
  let observer = null;
  try {
    // The faculty observer joins BEFORE the page, with the same actors so
    // room creation is identical whichever client arrives first.
    observer = await connectObserver(syncServer.url, {
      roomOptions: { actors: ["a1", "a2"], role: "observer" },
    });
    run.observerReported.sessionId = observer.sessionId;
    const changes = run.observerReported.changes;
    let lastKey = null;
    observer.onState((snapshot) => {
      const key = observerKey(snapshot);
      if (key === lastKey) return;
      lastKey = key;
      const a1 = snapshot?.actors?.a1 ?? {};
      changes.push({
        turnId: snapshot?.turnId ?? null,
        turnOwner: snapshot?.turnOwner ?? null,
        speaking: a1.speaking ?? null,
        cueId: a1.cueId ?? null,
        emotion: a1.emotion ?? null,
        perfNowMs: Number(performance.now().toFixed(2)),
        dateNowMs: Date.now(),
      });
    });

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
      run.assertions.push({ name, pass: Boolean(pass), detail: String(detail ?? "") });
      if (!pass) {
        exitCode = 1;
      }
    };

    // C1: all C4 assertions (A1-A8, B1-B5) still pass with an observer present.
    // A1-A7 + probe-done + page errors + snapshot catchup, shared verbatim.
    runC3CoreChecks(check, {
      probe,
      probeStats: run.probeStats,
      serverState: run.serverState,
      expectedReplyIds,
      bundleCheck: run.bundleCheck,
      pageErrors: run.pageErrors,
    });

    // B1-B5 mirror c4-run.mjs (same names, same pass logic).
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

    const traceTurns = run.serverTrace.turns ?? [];
    const cueIds = traceTurns.map((t) => t.cueId);
    const cueByReplyId = new Map(C3_REPLY_TABLE.map((entry) => [entry.id, entry.cueId]));

    // The observer sends one intent of each kind AFTER the script and records
    // the replies. Server tick + intent counts are captured across the sends.
    const tickBefore = JSON.parse(syncServer.getStateJSON()).serverTick;
    const countsBefore = { ...syncServer.getProbeStats().intentCounts };
    run.observerReported.serverTickBefore = tickBefore;
    run.observerReported.intentCountsBefore = countsBefore;
    const observerIntents = [
      ["pose", { x: 1, y: 1, z: 1 }],
      ["select-actor", { actorId: "a2" }],
      ["utterance-start", { actorId: "a1" }],
      ["utterance-end", { actorId: "a1" }],
    ];
    for (const [kind, payload] of observerIntents) {
      const reply = await observer.sendIntent(kind, payload);
      run.observerReported.intentReplies.push({ kind, status: reply.status, reason: reply.reason ?? null, seq: reply.seq });
    }
    run.observerReported.serverTickAfter = JSON.parse(syncServer.getStateJSON()).serverTick;
    run.observerReported.intentCountsAfter = { ...syncServer.getProbeStats().intentCounts };
    // Refresh server views after the observer sends (state must be unchanged).
    run.serverState = JSON.parse(syncServer.getStateJSON());
    run.probeStats = syncServer.getProbeStats();
    run.serverTrace = syncServer.getConversationTrace();

    check(
      "B2 server trace turns cueIds 3 distinct, each equals the table row for its replyId",
      new Set(cueIds).size === 3 &&
        cueIds.every((cue) => typeof cue === "string" && cue.length > 0) &&
        traceTurns.every((t) => cueByReplyId.get(t.replyId) === t.cueId),
      traceTurns.map((t) => `${t.turnId}:${t.replyId}:${t.cueId}`).join(" ") || "no turns",
    );

    // C2: the observer saw speaking=true for turnIds 1,2,3 through schema
    // sync, and its final state equals the server final state for turnId,
    // turnOwner, a1.{speaking,cueId,emotion} (observer-reported).
    const seenSpeaking = (tid) => changes.some((c) => c.turnId === tid && c.speaking === true);
    const saw123 = seenSpeaking(1) && seenSpeaking(2) && seenSpeaking(3);
    let finalMatch = false;
    let finalDetail = "no observer changes";
    try {
      await waitFor(() => {
        const last = changes[changes.length - 1];
        if (!last) return false;
        const s = run.serverState;
        return (
          last.turnId === s.turnId &&
          last.turnOwner === s.turnOwner &&
          last.speaking === s.actors?.a1?.speaking &&
          last.cueId === s.actors?.a1?.cueId &&
          last.emotion === s.actors?.a1?.emotion
        );
      }, 10000, "observer final snapshot catchup");
      finalMatch = true;
      finalDetail = "observer-reported final equals server final";
    } catch {
      const last = changes[changes.length - 1];
      const s = run.serverState;
      finalDetail = `observer=${JSON.stringify(last)} server=turnId:${s.turnId},owner:${s.turnOwner},a1:${JSON.stringify(s.actors?.a1)}`;
    }
    run.observerReported.finalSnapshot = changes[changes.length - 1] ?? null;
    check(
      "C2 (observer-reported) observer saw speaking=true for turnIds 1,2,3 and final equals server final",
      saw123 && finalMatch,
      `saw123=${[seenSpeaking(1), seenSpeaking(2), seenSpeaking(3)].join(",")} ${finalDetail}`,
    );

    // C3: observer emotion sequence (changes only) contains reassured,
    // concerned, neutral in order (observer-reported).
    const emotionChanges = [];
    let prevEmotion = changes.length > 0 ? changes[0].emotion : null;
    for (let i = 1; i < changes.length; i += 1) {
      const e = changes[i].emotion;
      if (e !== prevEmotion) {
        emotionChanges.push(e);
        prevEmotion = e;
      }
    }
    const order = ["reassured", "concerned", "neutral"];
    let cursor = 0;
    for (const e of emotionChanges) {
      if (e === order[cursor]) cursor += 1;
      if (cursor === order.length) break;
    }
    check(
      "C3 (observer-reported) emotion changes contain reassured, concerned, neutral in order",
      cursor === order.length,
      `changes=${JSON.stringify(emotionChanges)}`,
    );

    // C4: observer lag per opened turn = observer receive Date.now -
    // probeStats turnOpenedAtMs. Every turn observed (finite lag), max < 1000.
    const openedAt = run.probeStats.turnOpenedAtMs ?? {};
    const lags = [];
    for (const turn of run.probeStats.turns ?? []) {
      const at = openedAt[turn.turnId];
      const firstSeen = changes.find((c) => c.turnId === turn.turnId && c.speaking === true);
      if (typeof at === "number" && firstSeen) {
        lags.push({ turnId: turn.turnId, lagMs: firstSeen.dateNowMs - at });
      } else {
        lags.push({ turnId: turn.turnId, lagMs: null });
      }
    }
    const finiteLags = lags.filter((l) => typeof l.lagMs === "number").map((l) => l.lagMs);
    const lagSummary = summarize(finiteLags);
    run.observerReported.lagMs = { perTurn: lags, summary: lagSummary };
    check(
      "C4 (observer-reported) every opened turn observed with lag < 1000 ms",
      lags.length > 0 && lags.every((l) => typeof l.lagMs === "number") && lagSummary.max < OBSERVER_LAG_MAX_MS,
      `n=${lagSummary.n} p50=${lagSummary.p50} max=${lagSummary.max} ${JSON.stringify(lags.map((l) => `${l.turnId}:${l.lagMs}`))}`,
    );

    // C5: every observer intent rejected observer-read-only; intentCounts and
    // serverTick unchanged across the 4 sends; learners[] holds exactly the page.
    const allRejected = run.observerReported.intentReplies.every(
      (r) => r.status === "reject" && r.reason === "observer-read-only",
    );
    const countsSame =
      JSON.stringify(run.observerReported.intentCountsAfter) === JSON.stringify(run.observerReported.intentCountsBefore);
    const tickSame = run.observerReported.serverTickAfter === run.observerReported.serverTickBefore;
    const learnerIds = Object.keys(run.serverState.learners ?? {});
    check(
      "C5 observer intents all rejected observer-read-only, counts+tick unchanged, one learner",
      allRejected &&
        countsSame &&
        tickSame &&
        learnerIds.length === 1 &&
        run.serverState.observerCount === 1,
      `replies=${JSON.stringify(run.observerReported.intentReplies.map((r) => r.reason))} tick=${tickBefore}->${run.observerReported.serverTickAfter} learners=${learnerIds.length} observers=${run.serverState.observerCount}`,
    );

    // The observer leaves BEFORE server close (C6 needs exactly one
    // observer-left in the persisted trace).
    const observerSessionId = observer.sessionId;
    await observer.leave();
    cleanup.observerLeft = true;
    observer = null;
    await waitFor(() => JSON.parse(syncServer.getStateJSON()).observerCount === 0, 10000, "observer gone");
    run.serverState = JSON.parse(syncServer.getStateJSON());

    // Close the sync server BEFORE the file checks: close flushes the trace
    // file (same content the room writes on dispose).
    await syncServer.close();
    cleanup.syncClosed = true;

    // B3-B4 + C6 over the persisted file.
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

      const learnerSessionIds = Object.keys(run.serverState.learners ?? {});
      check(
        "B4 trace file contains no learner sessionId and no reply text",
        learnerSessionIds.every((id) => !raw.includes(id)) &&
          !raw.includes(observerSessionId) &&
          replyTexts.every((text) => !raw.includes(text)),
        `sessions=${learnerSessionIds.length} checked + observer, texts=${replyTexts.length} checked`,
      );

      // C6: exactly one observer-joined and one observer-left, no session
      // ids, and the file replays to itself (covered by B3; presence events
      // must not change turns/emotions).
      const presence = (persisted.events ?? []).filter((e) => String(e.kind).startsWith("observer-"));
      check(
        "C6 persisted trace has exactly one observer-joined and one observer-left, no session ids",
        JSON.stringify(presence) ===
          JSON.stringify([
            { seq: null, kind: "observer-joined", actorId: "", turnId: null },
            { seq: null, kind: "observer-left", actorId: "", turnId: null },
          ]) &&
          !raw.includes(observerSessionId),
        `presence=${JSON.stringify(presence.map((e) => e.kind))}`,
      );
    } else {
      check("B3 persisted trace schema matches and replays to itself", false, "no single trace file");
      check("B3 tampered copy (turns[0].replyId changed) replays to the untampered values", false, "no single trace file");
      check("B4 trace file contains no learner sessionId and no reply text", false, "no single trace file");
      check("C6 persisted trace has exactly one observer-joined and one observer-left, no session ids", false, "no single trace file");
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
    try {
      await staticServer.close();
      cleanup.staticClosed = true;
    } catch {
      // best-effort
    }
    run.cleanup = cleanup;
    run.elapsedMs = Date.now() - startedMs;
    await writeFile(join(outDir, "c5-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c5-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
// A Playwright CDP connection to the device browser keeps the event loop alive
// (quest run hung after writing c2-run.json); exit explicitly.
process.exit(process.exitCode ?? 0);
