#!/usr/bin/env node
/**
 * C16 host/quest harness: every exam station is CAST from its scenario.
 *
 * Host:  node c16-run.mjs --mode host --out <dir>
 * Quest:  node c16-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C16 author; root runs it on-device)
 *
 * Flow: createEncounterServer({ traceDir, examBlueprint, scenarios }) where the
 * blueprint is the REAL factory form createStep2CsStyleSeedBlueprint(scenarioBank,
 * { stationCount: 2 }) with a test-only timing override (the factory timing
 * doorway 60 s / encounter 900 s / note 600 s would make the run ~50 min; the
 * override is recorded below and in the RESULT) and the scenarios are the ones
 * exam-assembly maps to those slots (selectExamStationScenarios reproduces the
 * blueprint's own selection; evaluateBlueprintScenarioReadiness documents it).
 * The bank holds ONE approved scenario, so the draft slot scenario runs as an
 * approved COPY ({ ...scenario, status: "approved" }) — a test-only override
 * named below and in the RESULT, as C15 named its timing override. The cast
 * content (actors, emotionPolicy) is the bank's own.
 *
 * Then: serve the built app -> open sync-probe.html?script=c16 in an owned
 * browser target -> the page joins the cast server, renders each station's
 * scenario title + cast panel, selects one cast actor per station via the
 * existing select-actor intent, runs the C3 turn script per station, rejects a
 * physician outsider per station, follows the server rotation, finishes when
 * the last station closes -> poll server state during the run -> collect
 * server-side + page-side evidence -> N1-N4 + C15 M1/M3 checks -> write
 * c16-run.json -> cleanup.
 *
 * Host/quest plumbing comes from harness-lib.mjs (imported, never copied).
 * C3 turn/emotion/cue expectations mirror c4/c6 (same C3 script per station).
 * Exit 1 on any failed assertion. The run file is always written first.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectBundleSentry,
  collectQuestCleanupLists,
  parseArgs,
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
const SERVER_REVIEW_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "session-review-index.js");
const EXAM_ASSEMBLY_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "exam-assembly", "dist", "index.js");
const SCENARIO_FIXTURES_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "scenario-fixtures", "dist", "index.js");
const CLIENT_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-client", "dist", "index.js");
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const APP_SRC_SYNC_PROBE = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "src", "sync-probe");

// C15 test-only timing override (a harness timing, never edited into the
// factory blueprint): doorway 3 s, encounter 20 s, note 3 s. Provenance: C7/C9
// (the C3 script takes 8-12 s on Quest, so a 20 s encounter covers one script
// per station with margin; doorway/note 3 s keep the run short). The factory
// timing (doorway 60 s / encounter 900 s / note 600 s) would make the run last
// ~50 min, so the blueprint is passed to the server with ONLY its timing
// replaced; slots, order, labels, and id are the factory's own.
const TIMING_OVERRIDE = { doorwaySeconds: 3, encounterSeconds: 20, noteSeconds: 3 };
// Rotation/index liveness bounds (same provenance as C8/C9: 1 doorway second).
const ROTATION_GAP_MAX_MS = 1000;
const REVIEW_INDEX_LAG_MAX_MS = 1000;
// M3 phase-duration tolerance: one phase-clock tick (the StationPhaseClock
// countdown decrements remainingS once per 1000 ms; the boundary guard fires
// at the same deadline — source: phase-clock.ts StationPhaseClock#enter).
const PHASE_TICK_TOLERANCE_MS = 1000;
const PHASE_TICK_SOURCE = "phase-clock.ts StationPhaseClock countdown interval (1000 ms)";
const EXPECTED_TURN_ENDS = ["completed", "interrupted", "completed"];
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function observerStationOf(snapshot) {
  return typeof snapshot?.stationId === "string" ? snapshot.stationId : "";
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
  const { SESSION_REVIEW_INDEX_SCHEMA, SESSION_REVIEW_INDEX_FILE } = await import(SERVER_REVIEW_DIST);
  const { createStep2CsStyleSeedBlueprint, selectExamStationScenarios, evaluateBlueprintScenarioReadiness } = await import(EXAM_ASSEMBLY_DIST);
  const { scenarioBank } = await import(SCENARIO_FIXTURES_DIST);
  const { connect: connectObserver } = await import(CLIENT_DIST);
  const expectedReplyIds = [pickC3Reply(1).id, pickC3Reply(2).id, pickC3Reply(3).id];
  const replyTexts = C3_REPLY_TABLE.map((entry) => entry.text);

  // The real factory blueprint (slots, order, labels, id); timing overridden.
  const factoryBlueprint = createStep2CsStyleSeedBlueprint(scenarioBank, { stationCount: 2 });
  const blueprint = {
    ...factoryBlueprint,
    timing: { ...factoryBlueprint.timing, ...TIMING_OVERRIDE },
  };
  // The scenarios exam-assembly maps to those slots: the assembler's own
  // selection (same call the blueprint was built from) aligned slot i <-
  // scenarios[i], the assembleExamForm mapping. The readiness helper documents
  // eligibility; the bank holds one approved scenario, so the draft slot
  // scenario runs as an approved copy (test-only override, named here).
  const selected = selectExamStationScenarios(scenarioBank, 2);
  const readiness = evaluateBlueprintScenarioReadiness(blueprint, selected);
  const scenarioApprovalOverride = [];
  const scenarios = selected.map((scenario) => {
    if (scenario.status === "approved") {
      return scenario;
    }
    scenarioApprovalOverride.push(scenario.scenarioId);
    return { ...scenario, status: "approved" };
  });
  const sortedSlots = [...blueprint.stationSlots].sort((a, b) => a.order - b.order || (a.slotId < b.slotId ? -1 : 1));
  const expected = sortedSlots.map((slot, i) => {
    const scenario = scenarios[i];
    return {
      stationId: slot.slotId,
      order: slot.order,
      stationLabel: slot.label,
      scenarioId: scenario.scenarioId,
      scenarioTitle: scenario.title,
      actorIds: [...new Set(scenario.actors.map((actor) => actor.actorId))].sort(),
      baseline: scenario.emotionPolicy?.baseline ?? "neutral",
    };
  });
  const slotIds = expected.map((entry) => entry.stationId);

  const syncServer = await createEncounterServer({ traceDir, examBlueprint: blueprint, scenarios });
  const staticServer = await startStaticServer(APP_DIST);
  const cleanup = { syncClosed: false, staticClosed: false, observerLeft: false };

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    script: "c16",
    pageScript: "c16",
    blueprintId: blueprint.blueprintId,
    blueprintSlots: blueprint.stationSlots.map((slot) => ({ slotId: slot.slotId, order: slot.order, label: slot.label })),
    factoryTiming: { ...factoryBlueprint.timing },
    timingOverride: { ...TIMING_OVERRIDE },
    timing: { ...blueprint.timing },
    scenarioSelection: selected.map((scenario) => ({ scenarioId: scenario.scenarioId, status: scenario.status })),
    scenarioApprovalOverride,
    readiness: {
      canAssembleReadyForm: readiness.canAssembleReadyForm,
      blockedScenarioIds: readiness.blockedScenarioIds,
    },
    expectedStations: expected,
    traceDir,
    syncUrl: syncServer.url,
    pageUrl: null,
    probe: null,
    c16: null,
    serverState: null,
    probeStats: null,
    serverTrace: null,
    expectedReplyIds,
    reviewIndexSchema: SESSION_REVIEW_INDEX_SCHEMA,
    reviewIndexFile: SESSION_REVIEW_INDEX_FILE,
    rttMs: null,
    frameMs: null,
    assertions: [],
    pageErrors: [],
    consoleErrors: [],
    adbReverseList: null,
    adbForwardList: null,
    bundleCheck: null,
    traceFiles: [],
    reviewIndex: null,
    reviewIndexWriteLagMs: null,
    rotationGapMs: null,
    learnerArrivalLagMs: null,
    observerArrivalLagMs: null,
    phaseDurationsMs: null,
    phaseTickToleranceMs: PHASE_TICK_TOLERANCE_MS,
    phaseTickSource: PHASE_TICK_SOURCE,
    pollSamples: 0,
    elapsedMs: null,
    observerReported: { sessionId: null, stations: [], changes: [] },
  };

  const samples = [];
  const pollTimer = setInterval(() => {
    try {
      const state = JSON.parse(syncServer.getStateJSON());
      const stats = syncServer.getProbeStats();
      const actors = state.actors ?? {};
      const actorIds = Object.keys(actors).sort();
      const actorEmotions = {};
      for (const id of actorIds) {
        actorEmotions[id] = actors[id]?.emotion ?? null;
      }
      samples.push({
        atMs: Date.now(),
        stationId: state.stationId,
        stationIndex: state.stationIndex,
        phase: state.phase,
        scenarioId: state.scenarioId ?? null,
        scenarioTitle: state.scenarioTitle ?? null,
        stationLabel: state.stationLabel ?? null,
        blueprintId: state.blueprintId ?? null,
        actorIds,
        actorEmotions,
        observerCount: state.observerCount,
        phaseChangedAtMs: { ...(stats.phaseChangedAtMs ?? {}) },
        intentCounts: { ...(stats.intentCounts ?? {}) },
      });
    } catch {
      // No live room yet; skip.
    }
  }, 50);

  let exitCode = 0;
  let observer = null;
  try {
    observer = await connectObserver(syncServer.url, {
      roomOptions: { actors: ["a1", "a2"], role: "observer" },
    });
    run.observerReported.sessionId = observer.sessionId;
    const seenStations = run.observerReported.stations;
    const changes = run.observerReported.changes;
    let lastStation = null;
    observer.onState((snapshot) => {
      const stationId = observerStationOf(snapshot);
      if (stationId !== "" && stationId !== lastStation) {
        lastStation = stationId;
        seenStations.push({ stationId, stationLabel: snapshot?.stationLabel ?? null, scenarioId: snapshot?.scenarioId ?? null, dateNowMs: Date.now(), perfNowMs: Number(performance.now().toFixed(2)) });
      }
      changes.push({
        stationId,
        observerCount: snapshot?.observerCount ?? null,
        dateNowMs: Date.now(),
      });
    });

    const params = new URLSearchParams({
      sync: syncServer.url,
      iwer: "1",
      autostart: "1",
      script: "c16",
      ...(options.mode === "quest" ? { forceIwer: "1" } : {}),
    });
    run.pageUrl = `http://127.0.0.1:${staticServer.port}/sync-probe.html?${params.toString()}`;

    const outcome =
      options.mode === "host"
        ? await runHostProbe({ pageUrl: run.pageUrl, outDir })
        : await runQuestProbe({ pageUrl: run.pageUrl, outDir, serial: options.serial });
    run.probe = outcome.probe;
    run.c16 = outcome.probe?.c16 ?? null;
    run.pageErrors = outcome.pageErrors;
    run.consoleErrors = outcome.consoleErrors;
    run.browserProduct = outcome.browserProduct;
    run.pollSamples = samples.length;

    const probe = outcome.probe;
    const c16 = probe?.c16 ?? null;
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

    // Settle: no rotation after the last station closed.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const settledState = JSON.parse(syncServer.getStateJSON());

    // Observer leaves BEFORE server close (last trace records left).
    const observerSessionId = observer.sessionId;
    await observer.leave();
    cleanup.observerLeft = true;
    observer = null;
    run.serverState = JSON.parse(syncServer.getStateJSON());
    const stationPoseCounts = syncServer.getStationPoseCounts();

    await syncServer.close();
    cleanup.syncClosed = true;

    const lastSlot = slotIds[slotIds.length - 1];

    // N1: per station, server scenarioId/scenarioTitle == the slot's scenario;
    // actor ids == that scenario's actorIds exactly.
    for (const want of expected) {
      const stationSamples = samples.filter((sample) => sample.stationId === want.stationId);
      check(
        `N1 ${want.stationId} server ran the slot's scenario (${want.scenarioId})`,
        stationSamples.length > 0 &&
          stationSamples.every((sample) => sample.scenarioId === want.scenarioId && sample.scenarioTitle === want.scenarioTitle),
        `samples=${stationSamples.length} scenarioIds=${[...new Set(stationSamples.map((s) => s.scenarioId))].join(",")}`,
      );
      check(
        `N1 ${want.stationId} cast roster is exactly the scenario actorIds (no physician/patient, no client ids)`,
        stationSamples.length > 0 &&
          stationSamples.every((sample) => JSON.stringify(sample.actorIds) === JSON.stringify(want.actorIds)) &&
          !want.actorIds.includes("physician") &&
          !want.actorIds.includes("patient") &&
          !want.actorIds.includes("a1") &&
          !want.actorIds.includes("a2"),
        `got=${JSON.stringify(stationSamples.length > 0 ? stationSamples[0].actorIds : [])} want=${JSON.stringify(want.actorIds)}`,
      );
    }

    // N2: the page rendered each station's scenario title and cast, in slot order.
    const rendered = (c16?.stationsRendered ?? []).map((entry) => [
      entry.stationId,
      entry.scenarioId,
      entry.scenarioTitle,
      entry.actorIds,
    ]);
    check(
      "N2 the page rendered each station's scenario title and cast, in slot order",
      JSON.stringify(rendered) === JSON.stringify(expected.map((entry) => [entry.stationId, entry.scenarioId, entry.scenarioTitle, entry.actorIds])),
      `got=${JSON.stringify(rendered)}`,
    );
    check(
      "N2 page panel shows the last scenario title",
      typeof c16?.panelText === "string" && c16.panelText.includes(expected[expected.length - 1].scenarioTitle),
      `panel=${String(c16?.panelText).slice(0, 160)}`,
    );
    const serverAgree = expected.every((want) => {
      const stationSamples = samples.filter((sample) => sample.stationId === want.stationId);
      const pageEntry = (c16?.stationsRendered ?? []).find((entry) => entry.stationId === want.stationId);
      return (
        pageEntry !== undefined &&
        stationSamples.length > 0 &&
        stationSamples.every(
          (sample) => sample.scenarioId === pageEntry.scenarioId && sample.scenarioTitle === pageEntry.scenarioTitle,
        )
      );
    });
    check("N2 page-reported cast agrees with server state per station", serverAgree, serverAgree ? "agree" : "mismatch");

    // N3: per station, each cast actor's starting emotion; cast select acks; physician rejects.
    for (const want of expected) {
      const pageEntry = (c16?.stationsRendered ?? []).find((entry) => entry.stationId === want.stationId);
      const emotions = pageEntry ? Object.values(pageEntry.actorEmotions ?? {}) : [];
      check(
        `N3 ${want.stationId} cast starts at baseline ${want.baseline}`,
        pageEntry !== undefined &&
          Object.keys(pageEntry.actorEmotions ?? {}).sort().join(",") === want.actorIds.join(",") &&
          emotions.length === want.actorIds.length &&
          emotions.every((emotion) => emotion === want.baseline),
        `got=${JSON.stringify(pageEntry?.actorEmotions ?? null)} want=${want.baseline} x${want.actorIds.length}`,
      );
      const stationSelects = (c16?.selects ?? []).filter((entry) => entry.stationId === want.stationId);
      check(
        `N3 ${want.stationId} cast select acks, physician select rejects`,
        stationSelects.length === 2 &&
          stationSelects[0].actorId === want.actorIds[0] &&
          stationSelects[0].settled === "ack" &&
          stationSelects[1].actorId === "physician" &&
          stationSelects[1].settled === "reject",
        `got=${JSON.stringify(stationSelects)}`,
      );
    }
    const sentByKind = probe.sentByKind ?? {};
    const rejects = probe.rejectDetails ?? [];
    const unknownActorRejects = rejects.filter((entry) => entry.reason === "unknown-actor");
    const outsideRejects = rejects.filter((entry) => entry.reason === "outside-encounter-phase");
    check(
      "N3 select-actor on physician rejects unknown-actor once per station; pre-encounter probes reject outside-encounter-phase",
      unknownActorRejects.length === expected.length &&
        outsideRejects.length === 2 &&
        probe.sent === 2 + expected.length * 8 &&
        probe.acks === expected.length * 7 &&
        probe.rejects === 2 + expected.length,
      `sent=${probe.sent} acks=${probe.acks} rejects=${probe.rejects} unknown-actor=${unknownActorRejects.length} outside=${outsideRejects.length} kinds=${JSON.stringify(sentByKind)}`,
    );

    // N4: the review index carries scenarioId in slot order; C15 fields still present; no session id.
    const dirEntries = await readdir(traceDir);
    const indexFiles = dirEntries.filter((f) => f === SESSION_REVIEW_INDEX_FILE);
    const indexRaw = indexFiles.length === 1 ? await readFile(join(traceDir, SESSION_REVIEW_INDEX_FILE), "utf8") : null;
    const index = indexRaw ? JSON.parse(indexRaw) : null;
    run.reviewIndex = index;
    check(
      "N4 review index entries carry scenarioId in slot order",
      index !== null &&
        index.complete === true &&
        index.stationCount === expected.length &&
        JSON.stringify((index.stations ?? []).map((s) => [s.stationId, s.scenarioId])) ===
          JSON.stringify(expected.map((entry) => [entry.stationId, entry.scenarioId])),
      `stations=${JSON.stringify((index?.stations ?? []).map((s) => [s.stationId, s.scenarioId]))}`,
    );
    check(
      "N4 C15 blueprintId/stationLabel still present on a cast session",
      index !== null &&
        index.blueprintId === blueprint.blueprintId &&
        JSON.stringify((index.stations ?? []).map((s) => [s.stationId, s.stationLabel])) ===
          JSON.stringify(expected.map((entry) => [entry.stationId, entry.stationLabel])),
      `blueprintId=${index?.blueprintId} labels=${JSON.stringify((index?.stations ?? []).map((s) => s.stationLabel))}`,
    );
    if (index) {
      const learnerSessionIds = Object.keys(probe.lastServerState?.learners ?? {});
      const knownIds = [observerSessionId, ...learnerSessionIds].filter((id) => typeof id === "string" && id.length > 0);
      const leakedId = knownIds.find((id) => indexRaw.includes(id));
      const leakedText = replyTexts.find((text) => indexRaw.includes(text));
      check(
        "N4 no learner/observer sessionId, nonce, timestamp, or reply text in the index",
        leakedId === undefined &&
          !UUID_PATTERN.test(indexRaw) &&
          !/__c7|nonce/i.test(indexRaw) &&
          !/"atMs"|"timestamp"/i.test(indexRaw) &&
          leakedText === undefined,
        leakedId === undefined && leakedText === undefined ? "clean" : `leakedId=${leakedId !== undefined} leakedText=${leakedText !== undefined}`,
      );
      const closedAtMs = run.probeStats.phaseChangedAtMs?.closed ?? NaN;
      const indexStat = await stat(join(traceDir, SESSION_REVIEW_INDEX_FILE));
      const lagMs = indexStat.mtimeMs - closedAtMs;
      run.reviewIndexWriteLagMs = Number.isFinite(lagMs) ? Number(lagMs.toFixed(2)) : null;
      check(
        "N4 index written within 1000 ms of the last station closed phaseChangedAtMs",
        Number.isFinite(lagMs) && lagMs >= 0 && lagMs <= REVIEW_INDEX_LAG_MAX_MS,
        `lag=${Number.isFinite(lagMs) ? lagMs.toFixed(1) : "NaN"}ms`,
      );
      for (const entry of index.stations) {
        const tracePath = join(traceDir, entry.traceFile);
        let trace = null;
        try {
          trace = JSON.parse(await readFile(tracePath, "utf8"));
        } catch {
          trace = null;
        }
        const traceTurnEnds = (trace?.turns ?? []).map((t) => t.end);
        check(
          `N4 ${entry.stationId} entry links its trace file and turn ends match`,
          trace !== null &&
            typeof entry.traceFile === "string" &&
            entry.traceFile.endsWith(".conversation-trace.json") &&
            trace.stationId === entry.stationId &&
            JSON.stringify(traceTurnEnds) === JSON.stringify(EXPECTED_TURN_ENDS),
          `traceFile=${entry.traceFile} turnEnds=${JSON.stringify(traceTurnEnds)}`,
        );
      }
    } else {
      check("N4 review index entries carry scenarioId in slot order", false, "no index file");
    }

    // C15 M1 where it applies: the server ran the blueprint slots in order.
    const observedStations = (probe.stationsObserved ?? []).map((s) => s.stationId);
    check(
      "M1 server stationId sequence == the blueprint slotIds in order",
      JSON.stringify(observedStations) === JSON.stringify(slotIds),
      `got=${JSON.stringify(observedStations)} want=${JSON.stringify(slotIds)}`,
    );
    check(
      "M1 stationCount == blueprint slot count",
      settledState.stationCount === slotIds.length,
      `stationCount=${settledState.stationCount} slots=${slotIds.length}`,
    );
    const tailStations = samples.slice(-40).map((s) => s.stationId);
    check(
      "M1 no rotation after the last blueprint station closed",
      settledState.stationId === lastSlot &&
        settledState.phase === "closed" &&
        tailStations.every((s) => s === lastSlot),
      `state=${settledState.stationId}:${settledState.phase} tail=${[...new Set(tailStations)].join(",")}`,
    );

    // C15 M3 where it applies: observed phase durations match the timing.
    const changedAt = run.probeStats.phaseChangedAtMs ?? {};
    const doorwayDur = (changedAt.encounter ?? NaN) - (changedAt.doorway ?? NaN);
    const encounterDur = (changedAt.note ?? NaN) - (changedAt.encounter ?? NaN);
    const noteDur = (changedAt.closed ?? NaN) - (changedAt.note ?? NaN);
    run.phaseDurationsMs = {
      doorway: Number.isFinite(doorwayDur) ? Math.round(doorwayDur) : null,
      encounter: Number.isFinite(encounterDur) ? Math.round(encounterDur) : null,
      note: Number.isFinite(noteDur) ? Math.round(noteDur) : null,
    };
    const withinTick = (measured, seconds) => Number.isFinite(measured) && Math.abs(measured - seconds * 1000) <= PHASE_TICK_TOLERANCE_MS;
    check(
      "M3 doorway/encounter/note durations match the blueprint timing (tolerance one tick)",
      withinTick(doorwayDur, blueprint.timing.doorwaySeconds) &&
        withinTick(encounterDur, blueprint.timing.encounterSeconds) &&
        withinTick(noteDur, blueprint.timing.noteSeconds),
      `got=${JSON.stringify(run.phaseDurationsMs)} want=${JSON.stringify({ doorway: blueprint.timing.doorwaySeconds * 1000, encounter: blueprint.timing.encounterSeconds * 1000, note: blueprint.timing.noteSeconds * 1000 })} tol=${PHASE_TICK_TOLERANCE_MS}ms (${PHASE_TICK_SOURCE})`,
    );

    // C7 rotation where it applies: gap + observer coverage.
    const prevClosedAt = changedAt["prev-station-closed"] ?? NaN;
    const station2DoorwayAt = changedAt.doorway ?? NaN;
    const gap = station2DoorwayAt - prevClosedAt;
    run.rotationGapMs = Number.isFinite(gap) ? Math.round(gap) : null;
    check(
      "C7 rotation gap 0 <= doorway(last) - closed(first) <= 1000 ms",
      Number.isFinite(gap) && gap >= 0 && gap <= ROTATION_GAP_MAX_MS,
      `gap=${Number.isFinite(gap) ? Math.round(gap) : "NaN"}ms`,
    );
    const observerStationIds = run.observerReported.stations.map((s) => s.stationId);
    check(
      "C7 observer saw every cast station in order",
      JSON.stringify(observerStationIds) === JSON.stringify(slotIds),
      `got=${JSON.stringify(observerStationIds)}`,
    );

    // Completion + bundle sentries.
    check("probe completed without error", probe.done === true && probe.error == null, probe.error ?? "done");
    check("page c16 evidence present", c16 !== null && Array.isArray(c16.stationsRendered), c16 === null ? "no c16 evidence" : `${c16.stationsRendered.length} stations`);
    check("no page errors", (run.pageErrors ?? []).length === 0, (run.pageErrors ?? []).join(" | ").slice(0, 300) || "0 pageerrors");
    check(
      "bundle/source free of server imports and reply-table text",
      run.bundleCheck.hits.length === 0,
      run.bundleCheck.hits.join(" | ").slice(0, 300) || "clean",
    );
    void stationPoseCounts;

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
    clearInterval(pollTimer);
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
    await writeFile(join(outDir, "c16-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c16-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
process.exit(process.exitCode ?? 0);
