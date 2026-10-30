/**
 * C8 shared evidence checks for the xr-sync rotation harness.
 *
 * evaluateC8Evidence holds every C8 assertion body (E1-E3, E6, E4, F1-F6,
 * bundle, completion) in one place. c8-run.mjs owns the run flow (boot,
 * observer, page probe, waits, leave, close, c8-run.json); c9-run.mjs reuses
 * this module for its C8 regression half and adds the G1-G5 review-index
 * assertions. Neither runner copies check bodies.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const C8_STATIONS = ["station-1", "station-2"];
export const C8_EXPECTED_PHASES = ["doorway", "encounter", "note", "closed"];
export const C8_ROTATION_GAP_MAX_MS = 1000;
export const C8_ARRIVAL_LAG_MAX_MS = 1000;

export const C8_EXPECTED_EMOTIONS = [
  { from: "neutral", to: "reassured", trigger: "learner_acknowledgement", changed: true },
  { from: "reassured", to: "reassured", trigger: "learner_acknowledgement", changed: false },
  { from: "reassured", to: "concerned", trigger: "learner_interruption", changed: true },
  { from: "concerned", to: "neutral", trigger: "learner_acknowledgement", changed: true },
];

/**
 * Run every C8 check against a finished run. Reads the persisted traces from
 * traceDir (caller closes the server first). Returns the assertions plus the
 * derived gap/lag figures the runner records.
 *
 * ctx: { probe, probeStats, settledState, samples, observerStations,
 *   observerSessionId, traceDir, expectedReplyIds, expectedEmotions,
 *   replyTable, traceSchema, replayTrace, bundleCheck, stationPoseCounts,
 *   pageErrors, stations?, expectedPhases?, rotationGapMaxMs?,
 *   arrivalLagMaxMs? }
 */
export async function evaluateC8Evidence(ctx) {
  const stations = ctx.stations ?? [...C8_STATIONS];
  const expectedPhases = ctx.expectedPhases ?? [...C8_EXPECTED_PHASES];
  const rotationGapMaxMs = ctx.rotationGapMaxMs ?? C8_ROTATION_GAP_MAX_MS;
  const arrivalLagMaxMs = ctx.arrivalLagMaxMs ?? C8_ARRIVAL_LAG_MAX_MS;
  const { probe, probeStats, settledState, samples, traceDir, observerStations, observerSessionId } = ctx;
  const { expectedReplyIds, expectedEmotions, replyTable, traceSchema, replayTrace, bundleCheck } = ctx;
  const { stationPoseCounts, pageErrors } = ctx;

  const assertions = [];
  const check = (name, pass, detail) => {
    assertions.push({ name, pass: Boolean(pass), detail: String(detail ?? "") });
  };

  const station1Samples = samples.filter((s) => s.stationId === "station-1");
  const prevClosedAt = probeStats.phaseChangedAtMs?.["prev-station-closed"] ?? NaN;
  const station2DoorwayAt = probeStats.phaseChangedAtMs?.doorway ?? NaN;
  const gap = station2DoorwayAt - prevClosedAt;
  const rotationGapMs = Number.isFinite(gap) ? Math.round(gap) : null;

  const sentSeqs = probe.sentSeqs ?? [];
  const ackSeqs = probe.ackSeqs ?? [];
  const ackedInOrder =
    ackSeqs.length > 0 && ackSeqs.every((seq, i) => (i === 0 || seq > ackSeqs[i - 1]) && sentSeqs.includes(seq));

  // E6: no rotation after station-2 closed.
  const tailStations = samples.slice(-40).map((s) => s.stationId);
  check(
    "E6 no rotation after station-2 closed (state stays station-2)",
    settledState.stationId === "station-2" &&
      settledState.phase === "closed" &&
      tailStations.every((s) => s === "station-2"),
    `state=${settledState.stationId}:${settledState.phase} tail=${[...new Set(tailStations)].join(",")}`,
  );

  const traceFiles = (await readdir(traceDir)).filter((f) => f.endsWith(".conversation-trace.json")).sort();
  const persisted = [];
  for (const file of traceFiles) {
    persisted.push(JSON.parse(await readFile(join(traceDir, file), "utf8")));
  }
  const byStation = new Map(persisted.map((t) => [t.stationId, t]));

  // E1: exactly 2 trace files with phase sequences and replay.
  check(
    "E1 exactly 2 trace files with stationIds [station-1,station-2]",
    traceFiles.length === 2 &&
      JSON.stringify([...persisted.map((t) => t.stationId)].sort()) === JSON.stringify(["station-1", "station-2"]),
    `files=${traceFiles.join(",")} stations=${persisted.map((t) => t.stationId).join(",")}`,
  );
  for (const stationId of stations) {
    const trace = byStation.get(stationId);
    const phases = (trace?.events ?? []).filter((e) => e.kind === "phase-changed").map((e) => e.phase);
    check(
      `E1 ${stationId} phase-changed sequence == [doorway,encounter,note,closed]`,
      JSON.stringify(phases) === JSON.stringify(expectedPhases),
      `got=${JSON.stringify(phases)}`,
    );
    if (trace) {
      const replayed = replayTrace(trace);
      check(
        `E1 ${stationId} trace replays to itself`,
        JSON.stringify(replayed.turns) === JSON.stringify(trace.turns) &&
          JSON.stringify(replayed.emotions) === JSON.stringify(trace.emotions),
        `turns=${trace.turns?.length} emotions=${trace.emotions?.length} schema=${trace.schema}`,
      );
      check(
        `E1 ${stationId} trace schema + top-level stationId`,
        trace.schema === traceSchema && trace.stationId === stationId,
        `schema=${trace.schema} stationId=${trace.stationId}`,
      );
    } else {
      check(`E1 ${stationId} trace replays to itself`, false, "no trace file");
      check(`E1 ${stationId} trace schema + top-level stationId`, false, "no trace file");
    }
  }

  // E2: turns/feelings/cues per station.
  for (const stationId of stations) {
    const trace = byStation.get(stationId);
    const turns = trace?.turns ?? [];
    check(
      `E2 ${stationId} turns end [completed,interrupted,completed], ids [1,2,3], all a1`,
      JSON.stringify(turns.map((t) => t.end)) === JSON.stringify(["completed", "interrupted", "completed"]) &&
        JSON.stringify(turns.map((t) => t.turnId)) === JSON.stringify([1, 2, 3]) &&
        turns.every((t) => t.actorId === "a1"),
      turns.map((t) => `${t.turnId}:${t.actorId}:${t.replyId}:${t.end}`).join(" ") || "no turns",
    );
    check(
      `E2 ${stationId} replyIds equal server table/picker sequence`,
      JSON.stringify(turns.map((t) => t.replyId)) === JSON.stringify(expectedReplyIds),
      `got=${turns.map((t) => t.replyId).join(",")} want=${expectedReplyIds.join(",")}`,
    );
    const emotions = (trace?.emotions ?? []).map(({ from, to, trigger, changed }) => ({ from, to, trigger, changed }));
    check(
      `E2 ${stationId} emotions equal the policy literal for the C3 script`,
      JSON.stringify(emotions) === JSON.stringify(expectedEmotions),
      `got=${JSON.stringify(emotions)}`,
    );
    const cueByReplyId = new Map(replyTable.map((entry) => [entry.id, entry.cueId]));
    const cueIds = turns.map((t) => t.cueId);
    check(
      `E2 ${stationId} cueIds 3 distinct, each equals the table row for its replyId`,
      new Set(cueIds).size === 3 &&
        cueIds.every((cue) => typeof cue === "string" && cue.length > 0) &&
        turns.every((t) => cueByReplyId.get(t.replyId) === t.cueId),
      turns.map((t) => `${t.turnId}:${t.replyId}:${t.cueId}`).join(" ") || "no turns",
    );
  }

  // E3: server-side room-creation gap figure (kept; F4 is the arrival measure).
  check(
    "E3 rotation gap 0 <= doorway(station-2) - closed(station-1) <= 1000 ms",
    Number.isFinite(gap) && gap >= 0 && gap <= rotationGapMaxMs,
    `gap=${Number.isFinite(gap) ? Math.round(gap) : "NaN"} closed1=${Math.round(prevClosedAt)} doorway2=${Math.round(station2DoorwayAt)} samples=${samples.length}`,
  );

  // E4 stationsObserved + F6 pageLoadId before/after same (not only non-empty).
  const observedStations = (probe.stationsObserved ?? []).map((s) => s.stationId);
  check(
    "E4 (page-reported) stationsObserved == [station-1,station-2] in order",
    JSON.stringify(observedStations) === JSON.stringify(stations),
    `got=${JSON.stringify(observedStations)}`,
  );
  const loadIds = (probe.stationsObserved ?? []).map((s) => s.pageLoadId);
  const f6Pass =
    typeof probe.pageLoadId === "string" &&
    probe.pageLoadId.length > 0 &&
    loadIds.length === 2 &&
    loadIds.every((id) => id === probe.pageLoadId);
  check(
    "F6 pageLoadId compared before and after rotation (same value)",
    f6Pass,
    `pageLoadId=${String(probe.pageLoadId).slice(0, 20)} stations=${loadIds.map((id) => String(id).slice(0, 8)).join(",")}`,
  );

  // F1: observer onState stations + observerCount per station.
  const observerStationIds = observerStations.map((s) => s.stationId);
  const f1StationsPass = JSON.stringify(observerStationIds) === JSON.stringify(stations);
  const s1Count1 = station1Samples.some((s) => s.observerCount === 1);
  const s2Count1 = samples.filter((s) => s.stationId === "station-2").some((s) => s.observerCount === 1);
  check(
    "F1 observer onState stations == [station-1,station-2]",
    f1StationsPass,
    `got=${JSON.stringify(observerStationIds)}`,
  );
  check(
    "F1 each station state.observerCount == 1 while the learner is there",
    s1Count1 && s2Count1,
    `s1=${s1Count1} s2=${s2Count1} samples=${samples.length}`,
  );

  // F2: per-station presence without identity.
  const rawByStation = new Map();
  for (const file of traceFiles) {
    const raw = await readFile(join(traceDir, file), "utf8");
    const parsed = JSON.parse(raw);
    rawByStation.set(parsed.stationId, raw);
  }
  const s1Presence = ((byStation.get("station-1")?.events ?? []).filter((e) => String(e.kind).startsWith("observer-"))).map((e) => e.kind);
  const s2Presence = ((byStation.get("station-2")?.events ?? []).filter((e) => String(e.kind).startsWith("observer-"))).map((e) => e.kind);
  const s1HasOrder = JSON.stringify(s1Presence) === JSON.stringify(["observer-joined", "observer-left"]) ||
    (s1Presence.indexOf("observer-joined") >= 0 && s1Presence.indexOf("observer-left") > s1Presence.indexOf("observer-joined"));
  check(
    "F2 station-1 trace has observer-joined then observer-left",
    s1HasOrder,
    `presence=${JSON.stringify(s1Presence)}`,
  );
  check(
    "F2 station-2 trace has observer-joined",
    s2Presence.includes("observer-joined"),
    `presence=${JSON.stringify(s2Presence)}`,
  );
  const noIdentity =
    ![...(rawByStation.values())].some((raw) => typeof raw === "string" && raw.includes(observerSessionId));
  check("F2 no identity in either station trace", noIdentity, `observer=${String(observerSessionId).slice(0, 8)}`);

  // F3: lossless with pose streaming through rotation.
  const sentByKind = probe.sentByKind ?? {};
  const serverPose = Object.values(stationPoseCounts).reduce((sum, n) => sum + n, 0);
  const pagePoseSent = sentByKind.pose ?? 0;
  const outsideRejects = (probe.rejectDetails ?? []).filter((r) => r.reason === "outside-encounter-phase");
  const roomLeftRejects = (probe.rejectDetails ?? []).filter((r) => String(r.reason).includes("room left"));
  const inOrder =
    sentSeqs.length > 0 &&
    sentSeqs.length === ackSeqs.length + probe.rejects &&
    sentSeqs.every((seq, i) => seq === i + 1) &&
    ackedInOrder;
  check(
    "F3 every page intent acked in order across both rooms with pose streaming, rejects exactly 2",
    probe.rejects === 2 &&
      outsideRejects.length === 2 &&
      (sentByKind["utterance-start"] ?? 0) === 6 &&
      (sentByKind["utterance-end"] ?? 0) === 6 &&
      (sentByKind["select-actor"] ?? 0) === 4 &&
      (sentByKind.pose ?? 0) > 0 &&
      inOrder,
    `sent=${sentSeqs.length} acks=${ackSeqs.length} rejects=${probe.rejects} kinds=${JSON.stringify(sentByKind)}`,
  );
  check("F3 0 client-side room left failures (page-reported)", roomLeftRejects.length === 0, `roomLeft=${roomLeftRejects.length}`);
  check(
    "F3 server cross-check: summed pose counts == page sent pose count",
    pagePoseSent > 0 && serverPose === pagePoseSent,
    `server=${serverPose} page=${pagePoseSent} byStation=${JSON.stringify(stationPoseCounts)}`,
  );

  // F4: learner arrival lag (page clock).
  const station2Obs = (probe.stationsObserved ?? []).find((s) => s.stationId === "station-2");
  const closedBeforeStation2 = (probe.phasesObserved ?? [])
    .filter((p) => p.phase === "closed" && station2Obs && p.atMs <= station2Obs.atMs)
    .at(-1);
  const learnerLag = station2Obs && closedBeforeStation2 ? station2Obs.atMs - closedBeforeStation2.atMs : NaN;
  const learnerArrivalLagMs = Number.isFinite(learnerLag) ? Number(learnerLag.toFixed(2)) : null;
  check(
    "F4 learner arrival lag page stationsObserved[station-2] - phasesObserved[closed] <= 1000 ms",
    Number.isFinite(learnerLag) && learnerLag >= 0 && learnerLag <= arrivalLagMaxMs,
    `lag=${Number.isFinite(learnerLag) ? learnerLag.toFixed(1) : "NaN"} station2=${station2Obs?.atMs} closed=${closedBeforeStation2?.atMs}`,
  );

  // F5: observer arrival lag (host clock).
  const observerStation2 = observerStations.find((s) => s.stationId === "station-2");
  const observerLag = observerStation2 ? observerStation2.dateNowMs - prevClosedAt : NaN;
  const observerArrivalLagMs = Number.isFinite(observerLag) ? Math.round(observerLag) : null;
  check(
    "F5 observer arrival lag observer station-2 - server station-1 closed <= 1000 ms",
    Number.isFinite(observerLag) && observerLag >= 0 && observerLag <= arrivalLagMaxMs,
    `lag=${Number.isFinite(observerLag) ? Math.round(observerLag) : "NaN"} closed1=${Math.round(prevClosedAt)}`,
  );

  // Bundle + completion checks.
  check(
    "bundle/source free of server imports and reply-table text",
    bundleCheck.hits.length === 0,
    bundleCheck.hits.join(" | ").slice(0, 300) || "clean",
  );
  check("probe completed without error", probe.done === true && probe.error == null, probe.error ?? "done");
  check("no page errors", (pageErrors ?? []).length === 0, (pageErrors ?? []).join(" | ").slice(0, 300) || "0 pageerrors");
  check(
    "page snapshot caught up to final seq (page-reported)",
    probe.lastServerState?.learners?.[probe.lastServerState ? Object.keys(probe.lastServerState.learners ?? {})[0] : ""]?.lastSeq ===
      probe.sent,
    `sent=${probe.sent}`,
  );
  check(
    "page observer badge saw count 1 in both stations (page-reported)",
    (probe.observerCountsObserved ?? []).some((o) => o.stationId === "station-1" && o.observerCount === 1) &&
      (probe.observerCountsObserved ?? []).some((o) => o.stationId === "station-2" && o.observerCount === 1),
    `badge=${JSON.stringify((probe.observerCountsObserved ?? []).map((o) => `${o.stationId}:${o.observerCount}`))}`,
  );
  check(
    "no server rotation-failed trace event on the happy path",
    !(byStation.get("station-1")?.events ?? []).some((e) => e.kind === "rotation-failed") &&
      !(byStation.get("station-2")?.events ?? []).some((e) => e.kind === "rotation-failed"),
    "happy path has no rotation-failed",
  );

  return { assertions, rotationGapMs, learnerArrivalLagMs, observerArrivalLagMs, traceFiles };
}
