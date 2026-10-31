#!/usr/bin/env node
/**
 * C17 host/quest harness: a cast actor speaks and feels from its scenario.
 *
 * Host:  node c17-run.mjs --mode host --out <dir>
 * Quest:  node c17-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C17 author; root runs it on-device)
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
 * named below and in the RESULT, as C16 named its approval override. The cast
 * voice (displayName, openingUtterance) and emotionPolicy are the bank's own.
 *
 * Then: serve the built app -> open sync-probe.html?script=c17 in an owned
 * browser target -> the page joins the cast server, addresses EVERY cast actor
 * once per station (select-actor + one utterance pair each), renders each
 * speaking actor's caption in the visible panel, follows the server rotation,
 * finishes when the last station closes -> poll server state during the run ->
 * collect server-side + page-side evidence -> P1-P4 + C16 N1/M1 checks ->
 * write c17-run.json -> cleanup.
 *
 * Host/quest plumbing comes from harness-lib.mjs (imported, never copied).
 * Expected replyIds/captions/emotions are computed from the SCENARIO objects,
 * never from server output. Exit 1 on any failed assertion. The run file is
 * always written first.
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
const SERVER_REVIEW_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "session-review-index.js");
const EXAM_ASSEMBLY_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "exam-assembly", "dist", "index.js");
const SCENARIO_FIXTURES_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "scenario-fixtures", "dist", "index.js");
const CLIENT_DIST = join(WORKTREE_ROOT, "packages", "openclinxr", "xr-sync-client", "dist", "index.js");
const APP_DIST = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "dist");
const APP_SRC_SYNC_PROBE = join(WORKTREE_ROOT, "apps", "arena", "ui-xr-iwsdk-spike", "src", "sync-probe");

// C15 test-only timing override (a harness timing, never edited into the
// factory blueprint): doorway 3 s, encounter 20 s, note 3 s. Provenance: C7/C9
// (one opening turn per actor takes ~3 s; the largest bank cast has 4 actors,
// so a 20 s encounter covers every opening with margin; doorway/note 3 s keep
// the run short). The factory timing (doorway 60 s / encounter 900 s / note
// 600 s) would make the run last ~50 min, so the blueprint is passed to the
// server with ONLY its timing replaced; slots, order, labels, and id are the
// factory's own.
const TIMING_OVERRIDE = { doorwaySeconds: 3, encounterSeconds: 20, noteSeconds: 3 };
// Rotation liveness bound (same provenance as C8/C9: 1 doorway second).
const ROTATION_GAP_MAX_MS = 1000;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Independent emotion expectation: one learner_acknowledgement from the
// scenario baseline through that scenario's emotionPolicy (replicates the
// EmotionEngine resolver + clamp without importing it: first (from, trigger)
// match wins; no match holds; a match clamps into [upperBound, lowerBound]).
// A scenario with no policy holds its baseline (the server's empty-policy).
const DIALOGUE_ORDER = ["anxious", "concerned", "neutral", "reassured"];
function emotionRank(emotion) {
  const index = DIALOGUE_ORDER.indexOf(emotion);
  return index >= 0 ? index : DIALOGUE_ORDER.indexOf("neutral");
}
function expectedPostTurnEmotion(scenario, baseline) {
  const policy = scenario.emotionPolicy ?? null;
  if (policy === null) {
    return { emotion: baseline, policy: "none (holds baseline)" };
  }
  const rule = (policy.transitions ?? []).find(
    (entry) => entry.from === baseline && entry.triggeredBy === "learner_acknowledgement",
  );
  if (rule === undefined) {
    return { emotion: baseline, policy: `${policy.baseline} + no acknowledgement rule (holds)` };
  }
  let target = rule.to;
  if (emotionRank(target) < emotionRank(policy.upperBound)) {
    target = policy.upperBound;
  } else if (emotionRank(target) > emotionRank(policy.lowerBound)) {
    target = policy.lowerBound;
  }
  return { emotion: target, policy: `${rule.from} --ack--> ${rule.to} (bounds ${policy.upperBound}/${policy.lowerBound})` };
}

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
  const { SESSION_REVIEW_INDEX_FILE } = await import(SERVER_REVIEW_DIST);
  const { createStep2CsStyleSeedBlueprint, selectExamStationScenarios, evaluateBlueprintScenarioReadiness } = await import(EXAM_ASSEMBLY_DIST);
  const { scenarioBank } = await import(SCENARIO_FIXTURES_DIST);
  const { connect: connectObserver } = await import(CLIENT_DIST);
  const replyTexts = (C3_REPLY_TABLE ?? []).map((entry) => entry.text);

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
  const scenarios = selected.map((scenario) => {
    if (scenario.status === "approved") {
      return scenario;
    }
    scenarioApprovalOverride.push(scenario.scenarioId);
    return { ...scenario, status: "approved" };
  });
  const sortedSlots = [...blueprint.stationSlots].sort((a, b) => a.order - b.order || (a.slotId < b.slotId ? -1 : 1));
  // Expected voice per station, computed from the SCENARIO objects (never
  // from server output): sorted actor order is the page's addressing order.
  const expected = sortedSlots.map((slot, i) => {
    const scenario = scenarios[i];
    const baseline = scenario.emotionPolicy?.baseline ?? "neutral";
    const actors = [...new Set(scenario.actors.map((actor) => actor.actorId))].sort().map((actorId) => {
      const actor = scenario.actors.find((entry) => entry.actorId === actorId);
      const displayName = typeof actor.displayName === "string" && actor.displayName.length > 0 ? actor.displayName : actorId;
      const opening = typeof actor.openingUtterance === "string" ? actor.openingUtterance : "";
      return {
        actorId,
        replyId: `${actorId}:opening`,
        caption: `${displayName}: ${opening}`,
        opening,
        baseline,
        ...expectedPostTurnEmotion(scenario, baseline),
      };
    });
    return {
      stationId: slot.slotId,
      order: slot.order,
      stationLabel: slot.label,
      scenarioId: scenario.scenarioId,
      scenarioTitle: scenario.title,
      actorIds: actors.map((entry) => entry.actorId),
      actors,
      baseline,
    };
  });
  const slotIds = expected.map((entry) => entry.stationId);
  const totalActors = expected.reduce((sum, entry) => sum + entry.actorIds.length, 0);
  const openingTexts = [...new Set(expected.flatMap((entry) => entry.actors.map((actor) => actor.opening).filter((text) => text !== "")))];
  const captionTexts = [...new Set(expected.flatMap((entry) => entry.actors.map((actor) => actor.caption)))];

  const syncServer = await createEncounterServer({ traceDir, examBlueprint: blueprint, scenarios });
  const staticServer = await startStaticServer(APP_DIST);
  const cleanup = { syncClosed: false, staticClosed: false, observerLeft: false };

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    script: "c17",
    pageScript: "c17",
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
    c17: null,
    serverState: null,
    probeStats: null,
    serverTrace: null,
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
      script: "c17",
      ...(options.mode === "quest" ? { forceIwer: "1" } : {}),
    });
    run.pageUrl = `http://127.0.0.1:${staticServer.port}/sync-probe.html?${params.toString()}`;

    const outcome =
      options.mode === "host"
        ? await runHostProbe({ pageUrl: run.pageUrl, outDir })
        : await runQuestProbe({ pageUrl: run.pageUrl, outDir, serial: options.serial });
    run.probe = outcome.probe;
    run.c17 = outcome.probe?.c17 ?? null;
    run.pageErrors = outcome.pageErrors;
    run.consoleErrors = outcome.consoleErrors;
    run.browserProduct = outcome.browserProduct;
    run.pollSamples = samples.length;

    const probe = outcome.probe;
    const c17 = probe?.c17 ?? null;
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

    // P1: per station, each addressed cast actor's first replyId ==
    // `${actorId}:opening` and caption == the scenario-computed caption
    // (server samples + page selects + live turn log).
    for (const want of expected) {
      const station = stationSamples(want.stationId);
      const selects = (c17?.selects ?? []).filter((entry) => entry.stationId === want.stationId);
      check(
        `P1 ${want.stationId} page selected every cast actor once (ack)`,
        JSON.stringify(selects.map((entry) => [entry.actorId, entry.settled])) ===
          JSON.stringify(want.actorIds.map((actorId) => [actorId, "ack"])),
        `got=${JSON.stringify(selects.map((entry) => [entry.actorId, entry.settled]))}`,
      );
      for (const actor of want.actors) {
        const speaking = station.filter((sample) => sample.actorState[actor.actorId]?.speaking === true);
        check(
          `P1 ${want.stationId} ${actor.actorId} first replyId == ${actor.replyId} (server)`,
          speaking.length > 0 && speaking.every((sample) => sample.actorState[actor.actorId]?.replyId === actor.replyId),
          `speakingSamples=${speaking.length} replyIds=${[...new Set(speaking.map((s) => s.actorState[actor.actorId]?.replyId))].join(",")}`,
        );
        const captioned = station.filter((sample) => {
          const caption = sample.actorState[actor.actorId]?.caption;
          return typeof caption === "string" && caption !== "";
        });
        check(
          `P1 ${want.stationId} ${actor.actorId} caption == scenario caption (server)`,
          captioned.length > 0 && captioned.every((sample) => sample.actorState[actor.actorId]?.caption === actor.caption),
          `captionedSamples=${captioned.length} caption=${JSON.stringify(captioned.length > 0 ? captioned[0].actorState[actor.actorId]?.caption : null)}`,
        );
      }
      const strayReplies = station.flatMap((sample) =>
        want.actorIds
          .filter((actorId) => typeof sample.actorState[actorId]?.replyId === "string" && sample.actorState[actorId].replyId !== "" && !sample.actorState[actorId].replyId.endsWith(":opening"))
          .map((actorId) => `${actorId}=${sample.actorState[actorId].replyId}`),
      );
      check(
        `P1 ${want.stationId} no C3 replyIds on the opening-only run (server)`,
        strayReplies.length === 0,
        strayReplies.length === 0 ? "all :opening" : `stray=${[...new Set(strayReplies)].join(",")}`,
      );
    }
    const liveTurns = run.probeStats?.turns ?? [];
    check(
      "P1 live turnLog carries :opening replyIds (final room)",
      liveTurns.length === expected[expected.length - 1].actorIds.length &&
        liveTurns.every((turn) => typeof turn.replyId === "string" && turn.replyId.endsWith(":opening") && turn.end === "completed"),
      `turns=${JSON.stringify(liveTurns.map((turn) => [turn.actorId, turn.replyId, turn.end]))}`,
    );

    // P2: the page rendered each caption, in order (page-reported + server agree).
    const rendered = (c17?.captionsRendered ?? []).map((entry) => [entry.stationId, entry.actorId, entry.replyId, entry.caption]);
    const wanted = expected.flatMap((station) => station.actors.map((actor) => [station.stationId, actor.actorId, actor.replyId, actor.caption]));
    check(
      "P2 page rendered each caption, in station order then sorted actor order",
      JSON.stringify(rendered) === JSON.stringify(wanted),
      `got=${rendered.length} want=${wanted.length} first=${JSON.stringify(rendered[0] ?? null)}`,
    );
    const serverAgree = (c17?.captionsRendered ?? []).every((entry) =>
      stationSamples(entry.stationId).some(
        (sample) =>
          sample.actorState[entry.actorId]?.replyId === entry.replyId &&
          sample.actorState[entry.actorId]?.caption === entry.caption,
      ),
    );
    check("P2 page-reported captions agree with server state", serverAgree && rendered.length === wanted.length, serverAgree ? "agree" : "mismatch");
    check(
      "P2 caption panel is a non-empty string",
      typeof c17?.panelText === "string" && c17.panelText.length > 0,
      `panel=${String(c17?.panelText).slice(0, 160)}`,
    );

    // P3: per station, emotion after the turn == the scenario policy's
    // acknowledgement result from baseline (computed independently above).
    for (const want of expected) {
      const station = stationSamples(want.stationId);
      for (const actor of want.actors) {
        const firstSpeaking = station.findIndex((sample) => sample.actorState[actor.actorId]?.speaking === true);
        const before = firstSpeaking < 0 ? [] : station.slice(0, firstSpeaking);
        const after = firstSpeaking < 0 ? [] : station.slice(firstSpeaking + 1).filter((sample) => sample.actorState[actor.actorId]?.speaking === false);
        check(
          `P3 ${want.stationId} ${actor.actorId} post-turn emotion == ${actor.emotion} (${actor.policy})`,
          firstSpeaking >= 0 &&
            after.length > 0 &&
            after.every((sample) => sample.actorState[actor.actorId]?.emotion === actor.emotion),
          `afterSamples=${after.length} emotions=${[...new Set(after.map((s) => s.actorState[actor.actorId]?.emotion))].join(",")}`,
        );
        check(
          `P3 ${want.stationId} ${actor.actorId} pre-turn emotion == baseline ${actor.baseline}`,
          firstSpeaking >= 0 &&
            before.length > 0 &&
            before.every((sample) => sample.actorState[actor.actorId]?.emotion === actor.baseline),
          `beforeSamples=${before.length}`,
        );
      }
    }

    // P4: trace files after close carry no opening/caption text and no session
    // id; the live turns above carry the :opening replyIds.
    const dirEntries = await readdir(traceDir);
    const traceFiles = dirEntries.filter((f) => f.endsWith(".conversation-trace.json"));
    run.traceFiles = traceFiles;
    const learnerSessionIds = Object.keys(probe.lastServerState?.learners ?? {}).filter((id) => typeof id === "string" && id.length > 0);
    const knownIds = [...new Set([observerSessionId, ...learnerSessionIds])];
    let traceTurnTotal = 0;
    for (const file of traceFiles) {
      const raw = await readFile(join(traceDir, file), "utf8");
      const leakedOpening = openingTexts.find((text) => raw.includes(text));
      const leakedCaption = captionTexts.find((text) => raw.includes(text));
      const leakedText = replyTexts.find((text) => raw.includes(text));
      const leakedId = knownIds.find((id) => raw.includes(id));
      check(
        `P4 ${file} carries no opening/caption/reply text and no session id`,
        leakedOpening === undefined && leakedCaption === undefined && leakedText === undefined && leakedId === undefined && !UUID_PATTERN.test(raw),
        leakedOpening ?? leakedCaption ?? leakedText ?? leakedId ?? "clean",
      );
      const trace = JSON.parse(raw);
      traceTurnTotal += (trace.turns ?? []).length;
      const stationWant = expected.find((entry) => entry.stationId === trace.stationId);
      check(
        `P4 ${file} one completed turn per addressed cast actor`,
        stationWant !== undefined &&
          (trace.turns ?? []).length === stationWant.actorIds.length &&
          (trace.turns ?? []).every((turn) => turn.end === "completed"),
        `turns=${JSON.stringify((trace.turns ?? []).map((turn) => [turn.actorId, turn.replyId, turn.end]))}`,
      );
    }
    check(
      "P4 one trace file per station",
      traceFiles.length === expected.length,
      `files=${JSON.stringify(traceFiles)}`,
    );
    void traceTurnTotal;

    // Review index links the traces and stays text-free (C16 N4 where it applies).
    const indexFiles = dirEntries.filter((f) => f === SESSION_REVIEW_INDEX_FILE);
    const indexRaw = indexFiles.length === 1 ? await readFile(join(traceDir, SESSION_REVIEW_INDEX_FILE), "utf8") : null;
    const index = indexRaw ? JSON.parse(indexRaw) : null;
    run.reviewIndex = index;
    check(
      "P4 review index links each station trace and carries no opening text",
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

    // Deterministic intent counts: 3 acked intents per addressed actor
    // (select + utterance-start + utterance-end) plus one rejected doorway
    // pre-encounter select per station (connect probe + one per rotation).
    const sentByKind = probe.sentByKind ?? {};
    const rejects = probe.rejectDetails ?? [];
    const outsideRejects = rejects.filter((entry) => entry.reason === "outside-encounter-phase");
    check(
      "intent counts: 3 acked per actor, 1 outside-encounter-phase reject per station",
      probe.sent === 3 * totalActors + slotIds.length &&
        probe.acks === 3 * totalActors &&
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
    check("page c17 evidence present", c17 !== null && Array.isArray(c17.captionsRendered), c17 === null ? "no c17 evidence" : `${c17.captionsRendered.length} captions`);
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
    await writeFile(join(outDir, "c17-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c17-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
process.exit(process.exitCode ?? 0);
