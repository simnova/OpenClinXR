#!/usr/bin/env node
/**
 * C18 host/quest harness: the saved trace and the faculty replay of a cast
 * station say what the live station said.
 *
 * Host:  node c18-run.mjs --mode host --out <dir>
 * Quest:  node c18-run.mjs --mode quest --serial <serial> --out <dir>
 *         (implemented, NOT executed by the C18 author; root runs it on-device)
 *
 * Flow:
 *   phase A records a cast session on host from the factory blueprint (the
 *   REAL factory form createStep2CsStyleSeedBlueprint(scenarioBank,
 *   { stationCount: 2 }) with the same test-only overrides as C16/C17:
 *   timing doorway 3 s / encounter 20 s / note 3 s, and the draft slot
 *   scenario as an approved COPY) with the c17 page script (every cast actor
 *   once per station, captions rendered).
 *   phase B serves that traceDir as a replay server and runs the page with
 *   ?script=c18 for each station (host browser or Quest per --mode).
 *
 * Assertions:
 *   R1 each persisted trace scenarioId == the cast scenario; turns
 *      replyId/cueId == the live turns recorded in phase A, in order.
 *   R2 trace emotions == live emotions in phase A, per actor, in order.
 *   R3 replay page rendered the same replyIds and emotions per station, in
 *      order (page-reported + replay server state agree); replay actors'
 *      first rendered emotion == the cast baseline.
 *   R4 no persisted file contains any openingUtterance or caption text; no
 *      session id.
 *   plus C10 replay checks where they apply (H1-H4 + duration window).
 *
 * Host/quest plumbing comes from harness-lib.mjs (imported, never copied).
 * Exit 1 on any failed assertion. The run file is always written first.
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
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

const TIMING_OVERRIDE = { doorwaySeconds: 3, encounterSeconds: 20, noteSeconds: 3 };
const REPLAY_STEP_MS = 300;
const ROTATION_GAP_MAX_MS = 1000;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CAST_OPENING_CUE_ID = "cue-opening-01";

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

  const factoryBlueprint = createStep2CsStyleSeedBlueprint(scenarioBank, { stationCount: 2 });
  const blueprint = {
    ...factoryBlueprint,
    timing: { ...factoryBlueprint.timing, ...TIMING_OVERRIDE },
  };
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
    const baseline = scenario.emotionPolicy?.baseline ?? "neutral";
    const actors = [...new Set(scenario.actors.map((actor) => actor.actorId))].sort().map((actorId) => {
      const actor = scenario.actors.find((entry) => entry.actorId === actorId);
      const displayName = typeof actor.displayName === "string" && actor.displayName.length > 0 ? actor.displayName : actorId;
      const opening = typeof actor.openingUtterance === "string" ? actor.openingUtterance : "";
      return {
        actorId,
        replyId: `${actorId}:opening`,
        cueId: CAST_OPENING_CUE_ID,
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
  const openingTexts = [...new Set(expected.flatMap((entry) => entry.actors.map((actor) => actor.opening).filter((text) => text !== "")))];
  const captionTexts = [...new Set(expected.flatMap((entry) => entry.actors.map((actor) => actor.caption)))];

  const run = {
    mode: options.mode,
    serial: options.mode === "quest" ? options.serial : null,
    startedAt,
    script: "c18",
    pageScriptRecord: "c17",
    pageScriptReplay: "c18",
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
    phaseA: null,
    phaseB: [],
    assertions: [],
    pageErrors: [],
    consoleErrors: [],
    bundleCheck: null,
    reviewIndex: null,
    traceFiles: [],
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
  let observer = null;
  const samples = [];
  let pollTimer = null;
  try {
    syncServer = await createEncounterServer({ traceDir, examBlueprint: blueprint, scenarios });
    staticServer = await startStaticServer(APP_DIST);

    pollTimer = setInterval(() => {
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
          actorIds: Object.keys(actors).sort(),
          actorState,
          intentCounts: { ...(stats.intentCounts ?? {}) },
        });
      } catch {
        // No live room yet; skip.
      }
    }, 50);

    observer = await connectObserver(syncServer.url, { roomOptions: { actors: ["a1", "a2"], role: "observer" } });
    const observerSessionId = observer.sessionId;
    const seenStations = [];
    observer.onState((snapshot) => {
      const stationId = observerStationOf(snapshot);
      if (stationId !== "" && seenStations.at(-1) !== stationId) {
        seenStations.push(stationId);
      }
    });

    const paramsA = new URLSearchParams({
      sync: syncServer.url,
      iwer: "1",
      autostart: "1",
      script: "c17",
      ...(options.mode === "quest" ? { forceIwer: "1" } : {}),
    });
    const pageUrlA = `http://127.0.0.1:${staticServer.port}/sync-probe.html?${paramsA.toString()}`;
    const outcomeA =
      options.mode === "host"
        ? await runHostProbe({ pageUrl: pageUrlA, outDir })
        : await runQuestProbe({ pageUrl: pageUrlA, outDir, serial: options.serial });
    const probeA = outcomeA.probe;
    const c17 = probeA?.c17 ?? null;
    run.phaseA = {
      pageUrl: pageUrlA,
      probe: { sent: probeA.sent, acks: probeA.acks, rejects: probeA.rejects, done: probeA.done, error: probeA.error },
      c17: { selects: c17?.selects ?? null, captionsRendered: c17?.captionsRendered ?? null, panelText: c17?.panelText ?? null },
      pageErrors: outcomeA.pageErrors,
      consoleErrors: outcomeA.consoleErrors,
      browserProduct: outcomeA.browserProduct,
    };
    run.pageErrors.push(...outcomeA.pageErrors);
    run.consoleErrors.push(...outcomeA.consoleErrors);
    run.probeStatsA = syncServer.getProbeStats();
    run.rttMsA = summarize(probeA.rttMs ?? []);
    run.frameMsA = summarize(probeA.frameMs ?? []);
    run.bundleCheck = await collectBundleSentry({
      appDist: APP_DIST,
      appSrcSyncProbe: APP_SRC_SYNC_PROBE,
      extraBanned: [...replyTexts, ...openingTexts],
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));
    const settledState = JSON.parse(syncServer.getStateJSON());
    await observer.leave();
    observer = null;
    const learnerSessionIds = Object.keys(probeA.lastServerState?.learners ?? {});
    clearInterval(pollTimer);
    pollTimer = null;
    await syncServer.close();
    syncServer = null;

    const stationSamples = (stationId) => samples.filter((sample) => sample.stationId === stationId);

    // Phase A live record: every cast actor spoke its opening with the scenario caption (server + page agree).
    for (const want of expected) {
      const station = stationSamples(want.stationId);
      const selects = (c17?.selects ?? []).filter((entry) => entry.stationId === want.stationId);
      check(
        `phaseA ${want.stationId} page selected every cast actor once (ack)`,
        JSON.stringify(selects.map((entry) => [entry.actorId, entry.settled])) ===
          JSON.stringify(want.actorIds.map((actorId) => [actorId, "ack"])),
        `got=${JSON.stringify(selects.map((entry) => [entry.actorId, entry.settled]))}`,
      );
      for (const actor of want.actors) {
        const speaking = station.filter((sample) => sample.actorState[actor.actorId]?.speaking === true);
        check(
          `phaseA ${want.stationId} ${actor.actorId} live replyId == ${actor.replyId} (server)`,
          speaking.length > 0 && speaking.every((sample) => sample.actorState[actor.actorId]?.replyId === actor.replyId),
          `speakingSamples=${speaking.length}`,
        );
      }
    }
    const renderedA = (c17?.captionsRendered ?? []).map((entry) => [entry.stationId, entry.actorId, entry.replyId]);
    const wantedA = expected.flatMap((station) => station.actors.map((actor) => [station.stationId, actor.actorId, actor.replyId]));
    check(
      "phaseA page rendered each opening, in station order then sorted actor order",
      JSON.stringify(renderedA) === JSON.stringify(wantedA),
      `got=${renderedA.length} want=${wantedA.length}`,
    );

    // Persisted traces + review index.
    const dirEntries = await readdir(traceDir);
    const traceFiles = dirEntries.filter((f) => f.endsWith(".conversation-trace.json"));
    run.traceFiles = traceFiles;
    const indexRaw = await readFile(join(traceDir, SESSION_REVIEW_INDEX_FILE), "utf8");
    const index = JSON.parse(indexRaw);
    run.reviewIndex = index;
    check(
      "phaseA review index complete with one entry per station",
      index !== null && index.complete === true && (index.stations ?? []).length === expected.length,
      `stations=${(index.stations ?? []).length}`,
    );

    const tracesByStation = new Map();
    for (const file of traceFiles) {
      const trace = JSON.parse(await readFile(join(traceDir, file), "utf8"));
      tracesByStation.set(trace.stationId, { file, trace });
    }
    check("phaseA one trace file per station", tracesByStation.size === expected.length, `files=${JSON.stringify(traceFiles)}`);

    // R1: each persisted trace scenarioId == the cast scenario; turns replyId/cueId == the live turns, in order.
    for (const want of expected) {
      const found = tracesByStation.get(want.stationId);
      check(`R1 ${want.stationId} trace present`, found !== undefined, found ? found.file : "missing");
      if (!found) continue;
      const trace = found.trace;
      check(
        `R1 ${want.stationId} trace scenarioId == ${want.scenarioId}`,
        trace.scenarioId === want.scenarioId,
        `got=${trace.scenarioId}`,
      );
      const wantReplies = want.actors.map((actor) => [actor.actorId, actor.replyId, actor.cueId]);
      const gotReplies = (trace.turns ?? []).map((turn) => [turn.actorId, turn.replyId, turn.cueId]);
      check(
        `R1 ${want.stationId} trace turns replyId/cueId == live openings, in order`,
        JSON.stringify(gotReplies) === JSON.stringify(wantReplies),
        `got=${JSON.stringify(gotReplies)} want=${JSON.stringify(wantReplies)}`,
      );
      const liveRendered = (c17?.captionsRendered ?? [])
        .filter((entry) => entry.stationId === want.stationId)
        .map((entry) => [entry.actorId, entry.replyId]);
      check(
        `R1 ${want.stationId} trace turns agree with phase-A page evidence`,
        JSON.stringify((trace.turns ?? []).map((t) => [t.actorId, t.replyId])) === JSON.stringify(liveRendered),
        `trace=${JSON.stringify((trace.turns ?? []).map((t) => t.replyId))}`,
      );
      const first = (trace.turns ?? [])[0];
      check(
        `R1 ${want.stationId} first turn ${want.actors[0]?.actorId}:opening with cue-opening-01`,
        first?.replyId === `${want.actors[0]?.actorId}:opening` && first?.cueId === "cue-opening-01",
        `got=${first?.replyId}/${first?.cueId}`,
      );
    }

    // R2: trace emotions == live emotions in phase A, per actor, in order.
    for (const want of expected) {
      const found = tracesByStation.get(want.stationId);
      if (!found) continue;
      const trace = found.trace;
      const wantEmotions = want.actors.map((actor) => actor.emotion);
      const gotEmotions = (trace.emotions ?? []).map((emotion) => emotion.to);
      check(
        `R2 ${want.stationId} trace emotions == live post-turn emotions, in order`,
        JSON.stringify(gotEmotions) === JSON.stringify(wantEmotions),
        `got=${JSON.stringify(gotEmotions)} want=${JSON.stringify(wantEmotions)}`,
      );
      const station = stationSamples(want.stationId);
      for (const actor of want.actors) {
        const after = station.filter((sample) => sample.actorState[actor.actorId]?.speaking === false).slice(-5);
        const liveHolds = after.length > 0 && after.every((sample) => sample.actorState[actor.actorId]?.emotion === actor.emotion);
        check(
          `R2 ${want.stationId} ${actor.actorId} live post-turn emotion == ${actor.emotion} (server)`,
          liveHolds,
          `afterSamples=${after.length}`,
        );
      }
    }

    // R4 (phase-A half): no persisted file carries opening/caption text or a session id.
    const knownIds = [...new Set([observerSessionId, ...learnerSessionIds])];
    for (const file of [...traceFiles, SESSION_REVIEW_INDEX_FILE]) {
      const raw = await readFile(join(traceDir, file), "utf8");
      const leakedOpening = openingTexts.find((text) => text !== "" && raw.includes(text));
      const leakedCaption = captionTexts.find((text) => raw.includes(text));
      const leakedText = replyTexts.find((text) => raw.includes(text));
      const leakedId = knownIds.find((id) => typeof id === "string" && id !== "" && raw.includes(id));
      check(
        `R4 ${file} carries no opening/caption/reply text and no session id`,
        leakedOpening === undefined && leakedCaption === undefined && leakedText === undefined && leakedId === undefined && !UUID_PATTERN.test(raw),
        leakedOpening ?? leakedCaption ?? leakedText ?? leakedId ?? "clean",
      );
    }

    // Phase B: replay each station with ?script=c18.
    const hashesBefore = await hashDirFiles(traceDir);
    const replayServer = await createEncounterServer({ replayDir: traceDir, replayStepMs: REPLAY_STEP_MS });
    const replaySyncPort = replayServer.port;
    const staticPort = staticServer.port;
    for (const want of expected) {
      const found = tracesByStation.get(want.stationId);
      const trace = found.trace;
      const paramsB = new URLSearchParams({
        sync: replayServer.url,
        iwer: "1",
        autostart: "1",
        script: "c18",
        replayStationId: want.stationId,
        ...(options.mode === "quest" ? { forceIwer: "1" } : {}),
      });
      const pageUrlB = `http://127.0.0.1:${staticPort}/sync-probe.html?${paramsB.toString()}`;
      const outcomeB =
        options.mode === "host"
          ? await runHostProbe({ pageUrl: pageUrlB, outDir })
          : await runQuestProbe({ pageUrl: pageUrlB, outDir, serial: options.serial });
      const probeB = outcomeB.probe;
      const c10 = probeB.c10 ?? {};
      const c18 = probeB.c18 ?? {};
      run.phaseB.push({
        stationId: want.stationId,
        pageUrl: pageUrlB,
        sent: probeB.sent,
        acks: probeB.acks,
        rejects: probeB.rejects,
        done: probeB.done,
        c10Turns: c10.turns ?? null,
        c10Ends: c10.ends ?? null,
        c10Emotions: c10.emotions ?? null,
        c10Phases: c10.phases ?? null,
        c10Mode: c10.mode ?? null,
        c18Rendered: c18.rendered ?? null,
        c18PanelText: c18.panelText ?? null,
        pageErrors: outcomeB.pageErrors,
      });
      run.pageErrors.push(...outcomeB.pageErrors);
      run.consoleErrors.push(...outcomeB.consoleErrors);

      const expectedTurns = (trace.turns ?? []).map((t) => ({ turnId: t.turnId, actorId: t.actorId, replyId: t.replyId, cueId: t.cueId }));
      check(
        `phaseB ${want.stationId} H1 page-observed turns equal the trace turns from disk`,
        JSON.stringify(c10.turns ?? null) === JSON.stringify(expectedTurns),
        `got=${JSON.stringify(c10.turns ?? null)?.slice(0, 200)}`,
      );
      check(
        `phaseB ${want.stationId} H2 page-observed ends equal trace turns[].end`,
        JSON.stringify(c10.ends ?? null) === JSON.stringify((trace.turns ?? []).map((t) => t.end)),
        `got=${JSON.stringify(c10.ends ?? null)}`,
      );
      const indexEntry = (index.stations ?? []).find((s) => s.stationId === want.stationId);
      check(
        `phaseB ${want.stationId} H2 page-observed phases equal the index entry phases`,
        JSON.stringify(c10.phases ?? null) === JSON.stringify(indexEntry?.phases ?? null),
        `got=${JSON.stringify(c10.phases ?? null)}`,
      );
      check(
        `phaseB ${want.stationId} H3 page saw mode replay, stationId, replayDone true`,
        (c10.mode ?? probeB.lastServerState?.mode) === "replay" &&
          (c10.stationId ?? probeB.lastServerState?.stationId) === want.stationId &&
          (c10.replayDone ?? probeB.lastServerState?.replayDone) === true,
        `mode=${c10.mode} station=${c10.stationId} done=${c10.replayDone}`,
      );
      const rejects = probeB.rejectDetails ?? [];
      check(
        `phaseB ${want.stationId} H3 the one select-actor got reject replay-read-only (nothing acked)`,
        probeB.sent === 1 && probeB.acks === 0 && probeB.rejects === 1 &&
          rejects.length === 1 && rejects[0]?.reason === "replay-read-only",
        `sent=${probeB.sent} acks=${probeB.acks} rejects=${probeB.rejects} reason=${rejects[0]?.reason}`,
      );

      // R3: replay page rendered the same replyIds and emotions per station, in order.
      const wantRendered = (trace.turns ?? []).map((turn, i) => [
        turn.actorId,
        turn.replyId,
        (trace.emotions ?? [])[i]?.to ?? null,
      ]);
      const gotRendered = (c18.rendered ?? []).map((entry) => [entry.actorId, entry.replyId, entry.emotion]);
      check(
        `R3 ${want.stationId} replay page rendered the same replyIds and emotions, in order`,
        JSON.stringify(gotRendered) === JSON.stringify(wantRendered),
        `got=${JSON.stringify(gotRendered)} want=${JSON.stringify(wantRendered)}`,
      );
      const firstRendered = (c18.rendered ?? [])[0];
      check(
        `R3 ${want.stationId} replay actors' first rendered emotion == the cast baseline ${want.baseline}`,
        firstRendered !== undefined && firstRendered.emotion === want.baseline,
        `got=${firstRendered?.emotion}`,
      );
      const c10Agree = JSON.stringify((c10.turns ?? []).map((t) => [t.actorId, t.replyId])) ===
        JSON.stringify((c18.rendered ?? []).map((entry) => [entry.actorId, entry.replyId]));
      check(
        `R3 ${want.stationId} page-reported c10 turns and c18 panel agree with replay server state`,
        c10Agree && typeof c18.panelText === "string" && c18.panelText.length > 0,
        `panel=${String(c18.panelText).slice(0, 120)}`,
      );
      check(`phaseB ${want.stationId} probe completed without error`, probeB.done === true && probeB.error == null, probeB.error ?? "done");
      check(`phaseB ${want.stationId} no page errors`, (outcomeB.pageErrors ?? []).length === 0, (outcomeB.pageErrors ?? []).join(" | ").slice(0, 300) || "0 pageerrors");
    }
    await replayServer.close();

    // H4: the replay wrote nothing into the session dir.
    const hashesAfter = await hashDirFiles(traceDir);
    const hashKeys = new Set([...Object.keys(hashesBefore), ...Object.keys(hashesAfter)]);
    const hashDiffs = [...hashKeys].filter((k) => hashesBefore[k] !== hashesAfter[k]);
    check(
      "H4 session dir byte-identical before and after phase B (sha256 per file)",
      hashDiffs.length === 0,
      hashDiffs.length === 0 ? `files=${hashKeys.size}` : `diff=${hashDiffs.join(",").slice(0, 200)}`,
    );

    check(
      "bundle/source free of server imports, reply-table text, and opening text",
      run.bundleCheck.hits.length === 0,
      run.bundleCheck.hits.join(" | ").slice(0, 300) || "clean",
    );
    check("probe phaseA completed without error", run.phaseA.probe.done === true && run.phaseA.probe.error == null, run.phaseA.probe.error ?? "done");

    if (options.mode === "quest") {
      const { adbReverseList, adbForwardList, leaked } = await collectQuestCleanupLists({
        staticPort,
        syncPort: replaySyncPort,
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
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    if (observer) {
      try {
        await observer.leave();
      } catch {
        // best-effort
      }
    }
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
    await writeFile(join(outDir, "c18-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    for (const assertion of run.assertions) {
      console.log(`${assertion.pass ? "PASS" : "FAIL"} ${assertion.name} ${assertion.detail}`.slice(0, 220));
    }
    console.log(`wrote ${join(outDir, "c18-run.json")}`);
  }
  process.exitCode = exitCode;
}

await main(process.argv.slice(2));
process.exit(process.exitCode ?? 0);
