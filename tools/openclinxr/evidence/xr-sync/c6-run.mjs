#!/usr/bin/env node
/**
 * C6 host/quest harness: the server runs one station's phase clock
 * (doorway -> encounter -> note -> closed) from blueprint timing; conversation
 * is possible only during encounter; the headset shows phase + seconds left.
 *
 * Host:  node c6-run.mjs --mode host --out <dir>
 * Quest:  node c6-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C6 author; root runs it on-device)
 *
 * Flow: start createEncounterServer({ traceDir: <out>/trace, timing }) ->
 * serve the built app -> open sync-probe.html?script=c6 in an owned browser
 * target -> the page sends one select-actor while the server is in doorway
 * (must reject outside-encounter-phase), waits for encounter (page-observed),
 * auto-runs the FIXED C3 turn script, waits for closed (page-observed) ->
 * collect server-side + page-side evidence -> keep the C3 core assertions
 * (shared verbatim via harness-lib with expectedRejects: 1 for the gating
 * probe) and the C4 trace assertions that still apply (mirrored verbatim,
 * c4-run has no exports and runs on import) and add D1-D5 -> write
 * c6-run.json -> cleanup (quest: also remove adb reverses/forwards and verify
 * with `adb reverse --list` / `adb forward --list`).
 *
 * Host/quest plumbing lives in harness-lib.mjs (shared with c2/c3/c4/c5).
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
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const APP_SRC_SYNC_PROBE = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "src", "sync-probe");

// C6 station timing (server config, NOT client roomOptions). Provenance: the
// C3 script takes 8-12 s on Quest (c4 quest evidence), so a 20 s encounter
// covers it with margin; doorway/note 3 s keep the run short.
const TIMING = { doorwaySeconds: 3, encounterSeconds: 20, noteSeconds: 3 };
// Phase-span tolerance: 4 x the 50 ms schema patch interval.
const PHASE_TOLERANCE_MS = 200;
const EXPECTED_PHASES = ["doorway", "encounter", "note", "closed"];

// B1 literal (harness-owned, not from the build under test): the exact
// 4-transition emotion sequence the POLICY implies for the C3 script
// (complete, interrupt, complete). Same literal as c4-run.mjs.
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
  const syncServer = await createEncounterServer({ traceDir, timing: { ...TIMING } });
  const staticServer = await startStaticServer(APP_DIST);
  const cleanup = { syncClosed: false, staticClosed: false };

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    script: "c6",
    timing: { ...TIMING },
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
      script: "c6",
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

    // C3 assertions kept verbatim (shared with c3/c4/c5-run.mjs, no
    // divergence) except the gating probe: exactly 1 reject (the D3 probe).
    runC3CoreChecks(check, {
      probe,
      probeStats: run.probeStats,
      serverState: run.serverState,
      expectedReplyIds,
      bundleCheck: run.bundleCheck,
      pageErrors: run.pageErrors,
      expectedRejects: 1,
    });

    // D1: server phaseChangedAtMs spans equal configured seconds within 200 ms.
    const at = run.probeStats.phaseChangedAtMs ?? {};
    const spans = [
      (at["encounter"] ?? Number.NaN) - (at["doorway"] ?? Number.NaN),
      (at["note"] ?? Number.NaN) - (at["encounter"] ?? Number.NaN),
      (at["closed"] ?? Number.NaN) - (at["note"] ?? Number.NaN),
    ];
    const want = [TIMING.doorwaySeconds, TIMING.encounterSeconds, TIMING.noteSeconds].map((s) => s * 1000);
    const spansOk =
      spans.length === 3 &&
      spans.every((span, i) => Number.isFinite(span) && Math.abs(span - want[i]) <= PHASE_TOLERANCE_MS);
    check(
      "D1 server phaseChangedAtMs spans equal configured seconds within 200 ms",
      spansOk,
      `spans=${spans.map((s) => Math.round(s)).join(",")} want=${want.join(",")} at=${JSON.stringify(at)}`,
    );

    // D2 (live): trace phase-changed sequence == [doorway, encounter, note, closed].
    const livePhases = (run.serverTrace.events ?? []).filter((e) => e.kind === "phase-changed").map((e) => e.phase);
    check(
      "D2 trace phase-changed sequence == [doorway,encounter,note,closed]",
      JSON.stringify(livePhases) === JSON.stringify(EXPECTED_PHASES),
      `got=${JSON.stringify(livePhases)}`,
    );

    // D3: the pre-encounter select-actor was rejected outside-encounter-phase
    // (page-reported reject; the server never applied it: select-actor == 1).
    const outsideRejects = (probe.rejectDetails ?? []).filter((r) => r.reason === "outside-encounter-phase");
    const firstSelectSeq = (probe.sentSeqsByKind ?? {})["select-actor"]?.[0];
    check(
      "D3 pre-encounter select-actor rejected outside-encounter-phase and never applied",
      outsideRejects.length === 1 &&
        probe.rejects === 1 &&
        outsideRejects[0]?.seq === firstSelectSeq &&
        (run.probeStats.intentCounts ?? {})["select-actor"] === 1,
      `rejects=${JSON.stringify(probe.rejectDetails)} firstSelect=${firstSelectSeq} counts=${JSON.stringify(run.probeStats.intentCounts)}`,
    );

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

      // D2 (persisted): the file carries the same phase sequence and replays it.
      const persistedPhases = (persisted.events ?? []).filter((e) => e.kind === "phase-changed").map((e) => e.phase);
      check(
        "D2 persisted trace phase-changed sequence == [doorway,encounter,note,closed]",
        JSON.stringify(persistedPhases) === JSON.stringify(EXPECTED_PHASES),
        `got=${JSON.stringify(persistedPhases)}`,
      );

      // B4: the persisted file carries no learner sessionId and no reply text.
      // Phase events carry no identity either (actorId "" / turnId null).
      const learnerSessionIds = Object.keys(run.serverState.learners ?? {});
      const phaseEvents = (persisted.events ?? []).filter((e) => e.kind === "phase-changed");
      check(
        "B4 trace file contains no learner sessionId and no reply text",
        learnerSessionIds.every((id) => !raw.includes(id)) &&
          replyTexts.every((text) => !raw.includes(text)) &&
          phaseEvents.every((e) => e.actorId === "" && e.turnId === null && e.seq === null),
        `sessions=${learnerSessionIds.length} checked, texts=${replyTexts.length} checked, phaseEvents=${phaseEvents.length}`,
      );
    } else {
      check("B3 persisted trace schema matches and replays to itself", false, "no single trace file");
      check("B3 tampered copy (turns[0].replyId changed) replays to the untampered values", false, "no single trace file");
      check("D2 persisted trace phase-changed sequence == [doorway,encounter,note,closed]", false, "no single trace file");
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

    // D4: every reused C3/C4 check held (A1-A6, B1-B5) with rejects exactly 1.
    const abFailed = run.assertions.filter((a) => /^[AB]/.test(a.name) && !a.pass).map((a) => a.name);
    check(
      "D4 C3/C4 turn checks hold inside the encounter (A1-A6, B1-B5; rejects exactly 1)",
      abFailed.length === 0,
      abFailed.join(" | ").slice(0, 300) || "all A/B pass",
    );

    // D5 (page-reported): phasesObserved contains doorway, encounter, note,
    // closed in order and remainingS is non-increasing within each phase.
    const phasesObserved = probe.phasesObserved ?? [];
    let cursor = 0;
    for (const entry of phasesObserved) {
      if (entry.phase === EXPECTED_PHASES[cursor]) {
        cursor += 1;
      }
      if (cursor === EXPECTED_PHASES.length) {
        break;
      }
    }
    let nonIncreasing = phasesObserved.length > 0;
    let lastPhase = null;
    let lastRemaining = Number.POSITIVE_INFINITY;
    for (const entry of phasesObserved) {
      if (typeof entry.remainingS !== "number") {
        nonIncreasing = false;
        break;
      }
      if (entry.phase !== lastPhase) {
        lastPhase = entry.phase;
        lastRemaining = Number.POSITIVE_INFINITY;
      }
      if (entry.remainingS > lastRemaining) {
        nonIncreasing = false;
        break;
      }
      lastRemaining = entry.remainingS;
    }
    check(
      "D5 (page-reported) phasesObserved has doorway,encounter,note,closed in order, remainingS non-increasing",
      cursor === EXPECTED_PHASES.length && nonIncreasing,
      `n=${phasesObserved.length} phases=${[...new Set(phasesObserved.map((e) => `${e.phase}:${e.remainingS}`))].slice(0, 12).join(",")}`,
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
    await writeFile(join(outDir, "c6-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c6-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
// A Playwright CDP connection to the device browser keeps the event loop alive
// (quest run hung after writing c2-run.json); exit explicitly.
process.exit(process.exitCode ?? 0);
