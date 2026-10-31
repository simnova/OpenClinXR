#!/usr/bin/env node
/**
 * C19 host/quest harness: a cast station runs its scenario's eventSchedule on the server clock.
 *
 * Host:  node c19-run.mjs --mode host --out <dir>
 * Quest:  node c19-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C19 author; root runs it on-device)
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
 * named below and in the RESULT, as C16/C17 named their approval override.
 * PLUS a schedule override: each scenario's eventSchedule entries (which fire
 * at 240-420 s of the 900 s factory encounter) are COPIES with atSecond
 * rescaled so every entry fires inside the 20 s test encounter:
 *   rescaled atSecond = 5 + 3 * entryIndex (entries sorted by original
 *   atSecond; the harness refuses to run if any rescaled atSecond is not <
 *   the encounter length). The mapping is recorded per station below.
 *
 * Then: serve the built app -> open sync-probe.html?script=c19 in an owned
 * browser target -> the page joins the cast server and WATCHES with no
 * learner intent (the connect-time doorway probe is the only intent the page
 * sends), renders each scheduled interjection while the server speaks it,
 * follows the server rotation, finishes when the last station closes ->
 * poll server state during the run -> serve the recorded traceDir as a replay
 * server and watch each station's scheduled turns replay (direct client, no
 * page) -> collect evidence -> S1-S4 + C17/C18 checks -> write c19-run.json.
 *
 * Host/quest plumbing comes from harness-lib.mjs (imported, never copied).
 * Expected replyIds/schedules are computed from the SCENARIO objects, never
 * from server output. Exit 1 on any failed assertion. The run file is always
 * written first.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
// (a 20 s encounter covers every schedule entry with margin; doorway/note 3 s
// keep the run short). The factory timing (doorway 60 s / encounter 900 s /
// note 600 s) would make the run last ~50 min, so the blueprint is passed to
// the server with ONLY its timing replaced; slots, order, labels, and id are
// the factory's own.
const TIMING_OVERRIDE = { doorwaySeconds: 3, encounterSeconds: 20, noteSeconds: 3 };
// Rotation liveness bound (same provenance as C8/C9: 1 doorway second).
const ROTATION_GAP_MAX_MS = 1000;
// Schedule rescale (a harness timing, never edited into the scenario bank):
// the bank entries fire at 240-420 s of the 900 s factory encounter, so each
// entry runs as a copy with atSecond = SCHEDULE_BASE_S + SCHEDULE_STEP_S *
// entryIndex (entries sorted by original atSecond). One C3 first-row reply
// lasts 2 s, so the 3 s step keeps interjections disjoint with margin.
const SCHEDULE_BASE_S = 5;
const SCHEDULE_STEP_S = 3;
// Server-observed fire tolerance: one 1000 ms phase tick (the RED contract).
const SCHEDULE_TICK_MS = 1000;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const REPLAY_STEP_MS = 300;

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
  const { C3_REPLY_TABLE } = await import(SERVER_ROOM_DIST);
  const { replayConversationTrace } = await import(SERVER_TRACE_DIST);
  const { SESSION_REVIEW_INDEX_FILE } = await import(SERVER_REVIEW_DIST);
  const { createStep2CsStyleSeedBlueprint, selectExamStationScenarios, evaluateBlueprintScenarioReadiness } = await import(EXAM_ASSEMBLY_DIST);
  const { scenarioBank } = await import(SCENARIO_FIXTURES_DIST);
  const { connect: connectObserver, connect: connectReviewer } = await import(CLIENT_DIST);
  const replyTexts = (C3_REPLY_TABLE ?? []).map((entry) => entry.text);
  const scheduledDurationMs = (C3_REPLY_TABLE ?? [])[0]?.durationMs ?? 2000;

  // The real factory blueprint (slots, order, labels, id); timing overridden.
  const factoryBlueprint = createStep2CsStyleSeedBlueprint(scenarioBank, { stationCount: 2 });
  const blueprint = {
    ...factoryBlueprint,
    timing: { ...factoryBlueprint.timing, ...TIMING_OVERRIDE },
  };
  // The scenarios exam-assembly maps to those slots (same selection the
  // blueprint was built from). The bank holds one approved scenario, so the
  // draft slot scenario runs as an approved copy (test-only override, named).
  const selected = selectExamStationScenarios(scenarioBank, 2);
  const readiness = evaluateBlueprintScenarioReadiness(blueprint, selected);
  const scenarioApprovalOverride = [];
  const scheduleOverride = [];
  const scenarios = selected.map((scenario) => {
    const approved = scenario.status === "approved" ? scenario : { ...scenario, status: "approved" };
    if (scenario.status !== "approved") {
      scenarioApprovalOverride.push(scenario.scenarioId);
    }
    const sorted = [...(approved.eventSchedule ?? [])].sort((a, b) => a.atSecond - b.atSecond || (a.eventId < b.eventId ? -1 : 1));
    const rescaled = sorted.map((entry, index) => {
      const atSecond = SCHEDULE_BASE_S + SCHEDULE_STEP_S * index;
      scheduleOverride.push({ scenarioId: scenario.scenarioId, eventId: entry.eventId, originalAtSecond: entry.atSecond, rescaledAtSecond: atSecond });
      return { ...entry, atSecond };
    });
    for (const entry of rescaled) {
      if (!(entry.atSecond < TIMING_OVERRIDE.encounterSeconds)) {
        throw new Error(`schedule rescale overflow: ${entry.eventId} atSecond ${entry.atSecond} >= encounter ${TIMING_OVERRIDE.encounterSeconds}`);
      }
    }
    return { ...approved, eventSchedule: rescaled };
  });
  const sortedSlots = [...blueprint.stationSlots].sort((a, b) => a.order - b.order || (a.slotId < b.slotId ? -1 : 1));
  // Expected schedule per station, computed from the SCENARIO objects (never
  // from server output): entries in original-atSecond order with rescaled times.
  const expected = sortedSlots.map((slot, i) => {
    const scenario = scenarios[i];
    const baseline = scenario.emotionPolicy?.baseline ?? "neutral";
    return {
      stationId: slot.slotId,
      order: slot.order,
      stationLabel: slot.label,
      scenarioId: scenario.scenarioId,
      scenarioTitle: scenario.title,
      actorIds: [...new Set(scenario.actors.map((actor) => actor.actorId))].sort(),
      baseline,
      schedule: [...scenario.eventSchedule].map((entry) => ({
        eventId: entry.eventId,
        atSecond: entry.atSecond,
        actorId: entry.actorId,
        tag: entry.tag,
        replyId: `scheduled:${entry.eventId}`,
      })),
    };
  });
  const slotIds = expected.map((entry) => entry.stationId);
  const openingTexts = [...new Set(selected.flatMap((scenario) => scenario.actors.map((actor) => actor.openingUtterance).filter((text) => typeof text === "string" && text !== "")))];
  const captionTexts = [...new Set(selected.flatMap((scenario) => scenario.actors.map((actor) => {
    const name = typeof actor.displayName === "string" && actor.displayName.length > 0 ? actor.displayName : actor.actorId;
    const opening = typeof actor.openingUtterance === "string" ? actor.openingUtterance : "";
    return `${name}: ${opening}`;
  })))];

  const syncServer = await createEncounterServer({ traceDir, examBlueprint: blueprint, scenarios });
  const staticServer = await startStaticServer(APP_DIST);
  const cleanup = { syncClosed: false, staticClosed: false, observerLeft: false, replayClosed: false };

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    script: "c19",
    pageScript: "c19",
    blueprintId: blueprint.blueprintId,
    blueprintSlots: blueprint.stationSlots.map((slot) => ({ slotId: slot.slotId, order: slot.order, label: slot.label })),
    factoryTiming: { ...factoryBlueprint.timing },
    timingOverride: { ...TIMING_OVERRIDE },
    timing: { ...blueprint.timing },
    scenarioSelection: selected.map((scenario) => ({ scenarioId: scenario.scenarioId, status: scenario.status })),
    scenarioApprovalOverride,
    scheduleOverride,
    scheduleRescale: { baseS: SCHEDULE_BASE_S, stepS: SCHEDULE_STEP_S, tickToleranceMs: SCHEDULE_TICK_MS, scheduledDurationMs },
    readiness: {
      canAssembleReadyForm: readiness.canAssembleReadyForm,
      blockedScenarioIds: readiness.blockedScenarioIds,
    },
    expectedStations: expected,
    traceDir,
    syncUrl: syncServer.url,
    pageUrl: null,
    probe: null,
    c19: null,
    serverState: null,
    probeStats: null,
    serverTrace: null,
    replay: null,
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
    rotationGapMs: null,
    learnerArrivalLagMs: null,
    observerArrivalLagMs: null,
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
      const actorState = {};
      for (const id of Object.keys(actors).sort()) {
        actorState[id] = {
          replyId: actors[id]?.replyId ?? null,
          caption: actors[id]?.caption ?? null,
          emotion: actors[id]?.emotion ?? null,
          speaking: actors[id]?.speaking ?? null,
        };
      }
      samples.push({
        atMs: Date.now(),
        stationId: state.stationId,
        stationIndex: state.stationIndex,
        phase: state.phase,
        turnId: state.turnId,
        turnOwner: state.turnOwner,
        lastScheduledEventId: state.lastScheduledEventId ?? null,
        scenarioId: state.scenarioId ?? null,
        scenarioTitle: state.scenarioTitle ?? null,
        actorIds: Object.keys(actors).sort(),
        actorState,
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
      script: "c19",
      ...(options.mode === "quest" ? { forceIwer: "1" } : {}),
    });
    run.pageUrl = `http://127.0.0.1:${staticServer.port}/sync-probe.html?${params.toString()}`;

    const outcome =
      options.mode === "host"
        ? await runHostProbe({ pageUrl: run.pageUrl, outDir })
        : await runQuestProbe({ pageUrl: run.pageUrl, outDir: outDir, serial: options.serial });
    run.probe = outcome.probe;
    run.c19 = outcome.probe?.c19 ?? null;
    run.pageErrors = outcome.pageErrors;
    run.consoleErrors = outcome.consoleErrors;
    run.browserProduct = outcome.browserProduct;
    run.pollSamples = samples.length;

    const probe = outcome.probe;
    const c19 = probe?.c19 ?? null;
    run.serverState = JSON.parse(syncServer.getStateJSON());
    run.probeStats = syncServer.getProbeStats();
    run.serverTrace = syncServer.getConversationTrace();
    run.rttMs = summarize(probe.rttMs ?? []);
    run.frameMs = summarize(probe.frameMs ?? []);
    run.bundleCheck = await collectBundleSentry({
      appDist: APP_DIST,
      appSrcSyncProbe: APP_SRC_SYNC_PROBE,
      extraBanned: [...replyTexts, ...openingTexts],
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

    await syncServer.close();
    cleanup.syncClosed = true;

    const lastSlot = slotIds[slotIds.length - 1];
    const stationSamples = (stationId) => samples.filter((sample) => sample.stationId === stationId);
    const encounterStartOf = (stationId) => {
      const first = stationSamples(stationId).find((sample) => sample.phase === "encounter");
      return first ? first.atMs : null;
    };

    // C16 N1 where it applies: per station, server scenarioId/scenarioTitle ==
    // the slot's scenario; actor ids == that scenario's actorIds exactly.
    for (const want of expected) {
      const station = stationSamples(want.stationId);
      check(
        `N1 ${want.stationId} server ran the slot's scenario (${want.scenarioId})`,
        station.length > 0 &&
          station.every((sample) => sample.scenarioId === want.scenarioId && sample.scenarioTitle === want.scenarioTitle),
        `samples=${station.length} scenarioIds=${[...new Set(station.map((s) => s.scenarioId))].join(",")}`,
      );
      check(
        `N1 ${want.stationId} cast roster is exactly the scenario actorIds`,
        station.length > 0 &&
          station.every((sample) => JSON.stringify(sample.actorIds) === JSON.stringify(want.actorIds)),
        `got=${JSON.stringify(station.length > 0 ? station[0].actorIds : [])} want=${JSON.stringify(want.actorIds)}`,
      );
    }

    // S1: per station, each schedule entry fired once at atSecond (rescaled)
    // after encounter start within one tick (server-observed), with the named
    // actor speaking `scheduled:<eventId>`.
    for (const want of expected) {
      const station = stationSamples(want.stationId);
      const encounterStart = encounterStartOf(want.stationId);
      check(
        `S1 ${want.stationId} encounter started (server-observed)`,
        encounterStart !== null,
        encounterStart === null ? "no encounter sample" : `t0=${encounterStart}`,
      );
      const compressed = [];
      for (const sample of station) {
        if (compressed.at(-1) !== sample.lastScheduledEventId) {
          compressed.push(sample.lastScheduledEventId);
        }
      }
      const firedIds = compressed.filter((id) => id !== "" && id !== null);
      check(
        `S1 ${want.stationId} each schedule entry fired exactly once, in order`,
        JSON.stringify(firedIds) === JSON.stringify(want.schedule.map((entry) => entry.eventId)),
        `got=${JSON.stringify(firedIds)} want=${JSON.stringify(want.schedule.map((entry) => entry.eventId))}`,
      );
      for (const entry of want.schedule) {
        const firedSample = station.find((sample) => sample.lastScheduledEventId === entry.eventId);
        const firedAt = firedSample ? firedSample.atMs : null;
        const skew = firedAt !== null && encounterStart !== null ? firedAt - encounterStart - entry.atSecond * 1000 : null;
        check(
          `S1 ${want.stationId} ${entry.eventId} fired at atSecond=${entry.atSecond}s within one tick`,
          firedAt !== null && encounterStart !== null && Math.abs(skew) <= SCHEDULE_TICK_MS,
          firedAt === null ? "never fired" : `skew=${skew}ms tolerance=${SCHEDULE_TICK_MS}ms`,
        );
        const speaking = station.filter(
          (sample) => sample.actorState[entry.actorId]?.speaking === true && sample.actorState[entry.actorId]?.replyId === entry.replyId,
        );
        check(
          `S1 ${want.stationId} ${entry.eventId} named actor ${entry.actorId} spoke ${entry.replyId} (server)`,
          speaking.length > 0 && speaking.every((sample) => sample.actorState[entry.actorId]?.replyId === entry.replyId),
          `speakingSamples=${speaking.length}`,
        );
      }
      const strayReplies = station.flatMap((sample) =>
        want.actorIds
          .filter((actorId) => typeof sample.actorState[actorId]?.replyId === "string" && sample.actorState[actorId].replyId !== "" && !sample.actorState[actorId].replyId.startsWith("scheduled:"))
          .map((actorId) => `${actorId}=${sample.actorState[actorId].replyId}`),
      );
      check(
        `S1 ${want.stationId} no non-scheduled replyIds on the watch-only run (server)`,
        strayReplies.length === 0,
        strayReplies.length === 0 ? "all scheduled:" : `stray=${[...new Set(strayReplies)].join(",")}`,
      );
    }

    // S2: the page rendered each fired event in order; page and server agree.
    const rendered = (c19?.scheduledRendered ?? []).map((entry) => [entry.stationId, entry.eventId, entry.actorId, entry.replyId]);
    const wanted = expected.flatMap((station) => station.schedule.map((entry) => [station.stationId, entry.eventId, entry.actorId, entry.replyId]));
    check(
      "S2 page rendered each fired event, in station order then schedule order",
      JSON.stringify(rendered) === JSON.stringify(wanted),
      `got=${rendered.length} want=${wanted.length} first=${JSON.stringify(rendered[0] ?? null)}`,
    );
    const serverAgree = (c19?.scheduledRendered ?? []).every((entry) =>
      stationSamples(entry.stationId).some(
        (sample) =>
          sample.actorState[entry.actorId]?.speaking === true &&
          sample.actorState[entry.actorId]?.replyId === entry.replyId,
      ),
    );
    check("S2 page-reported events agree with server state", serverAgree && rendered.length === wanted.length, serverAgree ? "agree" : "mismatch");
    check(
      "S2 scheduled panel is a non-empty string",
      typeof c19?.panelText === "string" && c19.panelText.length > 0,
      `panel=${String(c19?.panelText).slice(0, 160)}`,
    );

    // S3: trace files after close carry one scheduled-event per entry with
    // its tag; the C18 reducer/replay reproduces the stored turns/emotions.
    const dirEntries = await readdir(traceDir);
    const traceFiles = dirEntries.filter((f) => f.endsWith(".conversation-trace.json"));
    run.traceFiles = traceFiles;
    const learnerSessionIds = Object.keys(probe.lastServerState?.learners ?? {}).filter((id) => typeof id === "string" && id.length > 0);
    const knownIds = [...new Set([observerSessionId, ...learnerSessionIds])];
    for (const file of traceFiles) {
      const raw = await readFile(join(traceDir, file), "utf8");
      const trace = JSON.parse(raw);
      const stationWant = expected.find((entry) => entry.stationId === trace.stationId);
      check(
        `S3 ${file} names its cast scenario (C18 R1)`,
        stationWant !== undefined && trace.scenarioId === stationWant.scenarioId,
        `scenarioId=${trace.scenarioId}`,
      );
      const scheduledEvents = (trace.events ?? []).filter((event) => event.kind === "scheduled-event");
      const scheduledSummary = scheduledEvents.map((event) => [event.actorId, event.eventId, event.tag]);
      const wantSummary = stationWant ? stationWant.schedule.map((entry) => [entry.actorId, entry.eventId, entry.tag]) : [];
      check(
        `S3 ${file} carries one scheduled-event per entry with its tag, in order`,
        stationWant !== undefined && JSON.stringify(scheduledSummary) === JSON.stringify(wantSummary),
        `got=${JSON.stringify(scheduledSummary)}`,
      );
      check(
        `S3 ${file} scheduled events carry turnIds and no text`,
        scheduledEvents.every((event) => typeof event.turnId === "number" && typeof event.eventId === "string" && typeof event.tag === "string"),
        `n=${scheduledEvents.length}`,
      );
      let replayed = null;
      let replayError = null;
      try {
        replayed = replayConversationTrace(trace);
      } catch (error) {
        replayError = String(error?.message ?? error);
      }
      check(
        `S3 ${file} reducer/replay reproduces the stored turns and emotions`,
        replayError === null &&
          JSON.stringify(replayed?.turns) === JSON.stringify(trace.turns) &&
          JSON.stringify(replayed?.emotions) === JSON.stringify(trace.emotions),
        replayError ?? `turns=${(trace.turns ?? []).length} emotions=${(trace.emotions ?? []).length}`,
      );
      const scheduledTurns = (trace.turns ?? []).filter((turn) => typeof turn.replyId === "string" && turn.replyId.startsWith("scheduled:"));
      check(
        `S3 ${file} scheduled turns replay the fired replyIds as completed turns`,
        stationWant !== undefined &&
          JSON.stringify(scheduledTurns.map((turn) => turn.replyId)) === JSON.stringify(stationWant.schedule.map((entry) => entry.replyId)) &&
          scheduledTurns.every((turn) => turn.end === "completed"),
        `turns=${JSON.stringify(scheduledTurns.map((turn) => [turn.replyId, turn.end]))}`,
      );
      const leakedOpening = openingTexts.find((text) => raw.includes(text));
      const leakedCaption = captionTexts.find((text) => raw.includes(text));
      const leakedText = replyTexts.find((text) => raw.includes(text));
      const leakedId = knownIds.find((id) => raw.includes(id));
      check(
        `S3 ${file} carries no opening/caption/reply text and no session id`,
        leakedOpening === undefined && leakedCaption === undefined && leakedText === undefined && leakedId === undefined && !UUID_PATTERN.test(raw),
        leakedOpening ?? leakedCaption ?? leakedText ?? leakedId ?? "clean",
      );
    }
    check(
      "S3 one trace file per station",
      traceFiles.length === expected.length,
      `files=${JSON.stringify(traceFiles)}`,
    );

    // S3 replay-server half: each station's scheduled turns replay as recorded.
    const replayServer = await createEncounterServer({ replayDir: traceDir, replayStepMs: REPLAY_STEP_MS });
    try {
      const replayedStations = [];
      for (const want of expected) {
        const reviewer = await connectReviewer(replayServer.url, { roomOptions: { actors: ["a1", "a2"], replayStationId: want.stationId } });
        const replyIds = [];
        let done = false;
        reviewer.onState((snapshot) => {
          for (const actor of Object.values(snapshot?.actors ?? {})) {
            if (actor?.speaking && replyIds.at(-1) !== actor.replyId) {
              replyIds.push(actor.replyId);
            }
          }
          if (snapshot?.replayDone === true) {
            done = true;
          }
        });
        const deadline = Date.now() + 30000;
        while (!done) {
          if (Date.now() > deadline) {
            throw new Error(`timed out waiting for replayDone ${want.stationId}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await reviewer.leave();
        replayedStations.push({ stationId: want.stationId, replyIds });
      }
      run.replay = replayedStations;
      for (const [index, want] of expected.entries()) {
        const seen = replayedStations[index]?.replyIds ?? [];
        check(
          `S3 replay of ${want.stationId} shows the recorded scheduled replyIds`,
          JSON.stringify(seen) === JSON.stringify(want.schedule.map((entry) => entry.replyId)),
          `got=${JSON.stringify(seen)}`,
        );
      }
    } finally {
      await replayServer.close();
      cleanup.replayClosed = true;
    }

    // S4: no two actors speak at once at any sample.
    const overlap = samples.filter((sample) => Object.values(sample.actorState ?? {}).filter((actor) => actor?.speaking === true).length > 1);
    check(
      "S4 no two actors speak at once at any sample (server)",
      overlap.length === 0,
      overlap.length === 0 ? `${samples.length} samples clean` : `overlap=${overlap.length} first=${JSON.stringify(overlap[0]).slice(0, 200)}`,
    );

    // Review index links the traces and stays text-free.
    const indexFiles = dirEntries.filter((f) => f === SESSION_REVIEW_INDEX_FILE);
    const indexRaw = indexFiles.length === 1 ? await readFile(join(traceDir, SESSION_REVIEW_INDEX_FILE), "utf8") : null;
    const index = indexRaw ? JSON.parse(indexRaw) : null;
    run.reviewIndex = index;
    check(
      "review index links each station trace and carries no opening text",
      index !== null &&
        index.complete === true &&
        (index.stations ?? []).length === expected.length &&
        openingTexts.every((text) => !indexRaw.includes(text)),
      index === null ? "no index file" : `stations=${(index.stations ?? []).length}`,
    );

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

    // Final-room live turn log: one completed scheduled turn per entry.
    const liveTurns = run.probeStats?.turns ?? [];
    const lastWant = expected[expected.length - 1];
    check(
      "live turnLog carries one completed scheduled turn per entry (final room)",
      liveTurns.length === lastWant.schedule.length &&
        liveTurns.every((turn) => typeof turn.replyId === "string" && turn.replyId.startsWith("scheduled:") && turn.end === "completed"),
      `turns=${JSON.stringify(liveTurns.map((turn) => [turn.actorId, turn.replyId, turn.end]))}`,
    );

    // Deterministic intent counts: the doorway probe rejects once per station
    // (outside-encounter-phase); the page sends nothing else.
    const sentByKind = probe.sentByKind ?? {};
    const rejects = probe.rejectDetails ?? [];
    const outsideRejects = rejects.filter((entry) => entry.reason === "outside-encounter-phase");
    check(
      "intent counts: 1 doorway select per station, all rejected outside-encounter-phase, 0 acked",
      probe.sent === slotIds.length &&
        probe.acks === 0 &&
        probe.rejects === slotIds.length &&
        outsideRejects.length === slotIds.length,
      `sent=${probe.sent} acks=${probe.acks} rejects=${probe.rejects} outside=${outsideRejects.length} kinds=${JSON.stringify(sentByKind)}`,
    );

    // C7 rotation where it applies: gap + observer coverage.
    const changedAt = run.probeStats.phaseChangedAtMs ?? {};
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
    check("page c19 evidence present", c19 !== null && Array.isArray(c19.scheduledRendered), c19 === null ? "no c19 evidence" : `${c19.scheduledRendered.length} scheduled`);
    check("no page errors", (run.pageErrors ?? []).length === 0, (run.pageErrors ?? []).join(" | ").slice(0, 300) || "0 pageerrors");
    check(
      "bundle/source free of server imports, reply-table text, and opening text",
      run.bundleCheck.hits.length === 0,
      run.bundleCheck.hits.join(" | ").slice(0, 300) || "clean",
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
    await writeFile(join(outDir, "c19-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c19-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
process.exit(process.exitCode ?? 0);
