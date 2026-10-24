import { describe, expect, it } from "vitest";
import { gradeStage1Cohort, gradeStage1Run, normalizeAudioSettings, parseStage1Record } from "@openclinxr/xr-capacity/stage1/grading";
import { recordFixture, releaseFixture } from "./fixtures.test-support.js";

describe("Stage1 pure scalar fixtures (no browser or hardware qualification)", () => {
  it("composes unchanged Stage0 policy with full causally broader audio proof", () => {
    const release = releaseFixture(), r = recordFixture(1, release), g = gradeStage1Run(r, release);
    expect(g.reasons).toEqual([]); expect(g.candidatePass).toBe(true);
    expect(g.audio!.inputMarkedDurationMs).toBe(60000);
    expect(g.audio!.scope).toContain("broader-than-XR-window");
    expect(r.xr.frames).toHaveLength(5522);
  });
  it("treats OFF audio as not applicable and verifies no factory/resource creation", () => {
    const release = releaseFixture(), r = recordFixture(0, release);
    expect(gradeStage1Run(r, release).candidatePass).toBe(true);
    expect(gradeStage1Run(r, release).audio!.scope).toBe("not-applicable");
    r.audioOwnership.created.contexts = 1;
    expect(gradeStage1Run(r, release).reasons).toContain("off-created-or-reused-audio");
    r.audioOwnership.created.contexts = 0; r.audio = recordFixture().audio;
    expect(gradeStage1Run(r, release).candidatePass).toBe(false);
  });
  it.each(["source", "old-slot", "nonce", "origin", "worklet", "config", "effective", "synthetic", "muted", "suspended", "queue", "storage", "pcm", "cleanup", "oscillator", "missing-mark", "late-mark", "mark-before-row", "short-marked-window", "stop-before-XR-close", "context-budget", "graph-budget", "drain-budget", "late-ready", "fractional-count", "channel-count", "rate-change", "software-gap", "clipped-partial", "invalid-partial", "nonzero-zero-energy", "nonzero-over-finite", "wrong-output", "missing-final", "event-order", "track-event"] as const)("rejects %s without repairing retained evidence", kind => {
    const release = releaseFixture(), r = recordFixture(1, release), a = r.audio!, rows = r.xr.frames.length, windows = a.input.windows.length;
    if (kind === "source") r.xr.identity.bundleSha256 = "d".repeat(64);
    if (kind === "old-slot") r.slot.position = 2 === r.slot.position ? 1 : 2;
    if (kind === "nonce") a.source.runNonce = "old-session";
    if (kind === "origin") a.source.timeOriginMs++;
    if (kind === "worklet") a.source.workletSha256 = "d".repeat(64);
    if (kind === "config") a.source.configSha256 = "d".repeat(64);
    if (kind === "effective") a.actual.trackSettings!.echoCancellation = true;
    if (kind === "synthetic") a.source.input = "synthetic-host";
    if (kind === "muted") a.actual.trackMuted = true;
    if (kind === "suspended") a.actual.contextState = "suspended";
    if (kind === "queue") a.queue.dropped = 1;
    if (kind === "storage") a.memory.ownedTypedBytes = 524289;
    if (kind === "pcm") (a.memory as { rawPcmRetainedBytes: number }).rawPcmRetainedBytes = 128;
    if (kind === "cleanup") a.cleanup.remaining.pendingMarks = 1;
    if (kind === "oscillator") r.audioOwnership.remaining.oscillators = 1;
    if (kind === "missing-mark") a.marks.pop();
    if (kind === "late-mark") a.marks[1]!.receivedMs = a.marks[1]!.sentMs + 1000.001;
    if (kind === "mark-before-row") a.marks[1]!.sentMs = r.xr.sampleStart! - 1;
    if (kind === "short-marked-window") a.marks[2]!.input.frame -= 48001;
    if (kind === "stop-before-XR-close") a.timing.stopRequestedMs = r.xr.endedAt! - 1;
    if (kind === "context-budget") a.timing.stoppedMs = a.timing.contextCreatedMs + 180001;
    if (kind === "graph-budget") a.timing.stoppedMs = a.preparation.graphActivatedMs! + 150001;
    if (kind === "drain-budget") a.timing.stoppedMs = a.timing.stopRequestedMs! + 5000.001;
    if (kind === "late-ready") a.preparation.readyMs = r.xr.requestedAt! + 1;
    if (kind === "fractional-count") a.input.windows[0]!.blocks += .5;
    if (kind === "channel-count") a.input.windows[0]!.channelFrames++;
    if (kind === "rate-change") a.input.windows[0]!.sampleRateChanges++;
    if (kind === "software-gap") a.input.windows[0]!.frameDiscontinuities++;
    if (kind === "clipped-partial") a.input.windows.find(w => w.partial)!.clipSamples++;
    if (kind === "invalid-partial") a.input.windows.find(w => w.partial)!.nonfiniteSamples++;
    if (kind === "nonzero-zero-energy") a.input.windows[0]!.sumSquares = 0;
    if (kind === "nonzero-over-finite") a.input.windows[0]!.nonzeroSamples = a.input.windows[0]!.finiteSamples + 1;
    if (kind === "wrong-output") a.output.windows[0]!.peak = .02;
    if (kind === "missing-final") a.output.finalReceived = false;
    if (kind === "event-order") a.events[1]!.atMs = 1;
    if (kind === "track-event") a.events.splice(1, 0, { atMs: 40000, type: "track-mute", detail: "true" });
    expect(gradeStage1Run(r, release).candidatePass).toBe(false);
    expect(r.xr.frames).toHaveLength(rows); expect(a.input.windows).toHaveLength(windows);
  });
  it("rejects initial activity followed by zero complete sample bins even with consistent totals", () => {
    const release = releaseFixture(), r = recordFixture(1, release), a = r.audio!;
    const row = a.input.windows.find(w => w.phase === "sample" && !w.partial)!;
    a.input.nonzeroSamples -= row.nonzeroSamples; a.input.sumSquares -= row.sumSquares;
    for (const mark of [a.marks[2]!]) { mark.input.counters.nonzeroSamples -= row.nonzeroSamples; mark.input.counters.sumSquares -= row.sumSquares; }
    row.nonzeroSamples = 0; row.sumSquares = 0; row.peak = 0;
    expect(gradeStage1Run(r, release).reasons).toContain("input-complete-bin-no-observed-activity");
    row.partial = true;
    expect(gradeStage1Run(r, release).reasons).toContain("input-bin-accounting-or-partial-bound");
  });
  it("does not credit stale or swapped phase cumulative counters", () => {
    const release = releaseFixture(), r = recordFixture(1, release);
    r.audio!.marks[2]!.input.counters.sumSquares++;
    expect(gradeStage1Run(r, release).reasons).toContain("input-phase-latch-bin-recount");
  });
  it("retains coalescing as telemetry and separates API estimates from physical latency", () => {
    const release = releaseFixture(), r = recordFixture(1, release);
    r.audio!.queue.coalesced = 40; r.audio!.latency.baseLatencySeconds = .02; r.audio!.latency.outputLatencySeconds = .03;
    expect(gradeStage1Run(r, release).candidatePass).toBe(true);
    (r.audio!.latency as { physicalRttMs: number | null }).physicalRttMs = 10;
    expect(gradeStage1Run(r, release).candidatePass).toBe(false);
  });
  it("normalizes only volatile route IDs and retains effective numeric/processing fields", () => {
    const release = releaseFixture(), r = recordFixture(1, release);
    Object.assign(r.audio!.actual.trackSettings!, { deviceId: "new-private-token", groupId: "new-group" });
    expect(gradeStage1Run(r, release).candidatePass).toBe(true);
    expect(normalizeAudioSettings({ deviceId: "x", groupId: "y", sampleRate: 44100 })).toEqual({ sampleRate: 44100 });
    r.audio!.actual.trackSettings!.sampleRate = 44100;
    expect(gradeStage1Run(r, release).candidatePass).toBe(false);
  });
  it.each([null, {}, [], { schema: "quest-stage1-record.v1" }, { ...recordFixture(), pageTimeOriginMs: NaN }])("fails malformed record safely", value => {
    expect(() => parseStage1Record(value)).toThrow(); expect(gradeStage1Run(value, releaseFixture()).candidatePass).toBe(false);
  });
  it("does not allow coercible booleans into unchanged truthiness-based Stage0 checks", () => {
    const r = recordFixture(); (r.xr.frames[100] as unknown as { presenting: string }).presenting = "true";
    expect(gradeStage1Run(r, releaseFixture()).candidatePass).toBe(false);
  });
  it.each(["empty-windows", "missing-queue", "raw-pcm-field", "forged-clip-count", "sample-rate-jump", "missing-clock", "all-partial"] as const)("rejects %s evidence corruption", kind => {
    const release = releaseFixture(), r = recordFixture(1, release), a = r.audio!;
    if (kind === "empty-windows") a.input.windows = [];
    if (kind === "missing-queue") delete (a as unknown as Record<string, unknown>)["queue"];
    if (kind === "raw-pcm-field") (a as unknown as Record<string, unknown>)["rawPcm"] = [0, .1];
    if (kind === "forged-clip-count") a.input.windows[0]!.peak = 1;
    if (kind === "sample-rate-jump") a.input.windows[10]!.sampleRate = 44100;
    if (kind === "missing-clock") delete (r as unknown as Record<string, unknown>)["pageTimeOriginMs"];
    if (kind === "all-partial") a.input.windows.forEach(w => { w.partial = true; });
    expect(gradeStage1Run(r, release).candidatePass).toBe(false);
  });
  it.each([null, {}, { ...releaseFixture(), slots: null }, { ...releaseFixture(), profile: null }])("rejects malformed release without throwing", value => {
    const release = value as unknown as ReturnType<typeof releaseFixture>;
    expect(gradeStage1Run(recordFixture(), release).candidatePass).toBe(false);
    expect(gradeStage1Cohort([recordFixture()], release).candidatePass).toBe(false);
  });
  it.each(["permission-deadline", "resume-deadline", "stale-state", "processor-error", "fake-label", "no-created-graph"] as const)("rejects %s setup/ownership evidence", kind => {
    const release = releaseFixture(), r = recordFixture(1, release), a = r.audio!;
    if (kind === "permission-deadline") a.preparation.captureGrantedMs = a.preparation.startedMs + 30001;
    if (kind === "resume-deadline") a.preparation.contextRunningMs = a.preparation.startedMs + 30001;
    if (kind === "stale-state") a.actual.observedAtMs = a.preparation.readyMs;
    if (kind === "processor-error") a.processorErrors = 1;
    if (kind === "fake-label") a.actual.trackLabel = "Fake Audio Input";
    if (kind === "no-created-graph") { a.ownership.created.contexts = 0; r.audioOwnership.created.contexts = 0; }
    expect(gradeStage1Run(r, release).candidatePass).toBe(false);
  });
  it("permits controlled construction suspension only before readiness", () => {
    const release = releaseFixture(), r = recordFixture(1, release);
    r.audio!.events.unshift({ atMs: 180, type: "context-state", detail: "suspended" });
    expect(gradeStage1Run(r, release).candidatePass).toBe(true);
    r.audio!.events.splice(2, 0, { atMs: 50000, type: "context-state", detail: "suspended" });
    expect(gradeStage1Run(r, release).candidatePass).toBe(false);
  });
  it("uses the inclusive predeclared ACK deadline", () => {
    const release = releaseFixture(), r = recordFixture(1, release);
    r.audio!.marks.forEach(m => { m.receivedMs = m.sentMs + 1000; });
    expect(gradeStage1Run(r, release).candidatePass).toBe(true);
  });
  it("rejects phase ACKs dispatched after stop even if XR labels/counters match", () => {
    const release = releaseFixture(), r = recordFixture(1, release), mark = r.audio!.marks[2]!;
    mark.sentMs = r.audio!.timing.stopRequestedMs! + 1; mark.receivedMs = mark.sentMs + 1;
    expect(gradeStage1Run(r, release).reasons).toEqual(["audio-mark-causal-or-ACK-deadline"]);
  });
  it("requires retained nonzero quiet-ready counters, not a zero first quantum", () => {
    const release = releaseFixture(), r = recordFixture(1, release), c = r.audio!.preparation.inputReadyAck!.counters;
    c.nonzeroSamples = 0; c.peak = 0; c.sumSquares = 0;
    expect(gradeStage1Run(r, release).reasons).toEqual(["input-first-work-or-ready-evidence"]);
  });
  it("rejects internally consistent audio frame spans beyond the declared graph lifetime", () => {
    const release = releaseFixture(), r = recordFixture(1, release), n = r.audio!.input;
    n.windows = n.windows.filter(w => w.phase !== "ended");
    let start = n.windows.at(-1)!.frameEnd; const end = n.sampleRate * 151;
    const template = { ...n.windows.find(w => !w.partial)! };
    while (start < end) {
      const finish = Math.min(end, start + 24064), frames = finish - start;
      n.windows.push({ ...template, sequence: n.windows.length, phase: "ended", partial: frames < 24000, frameStart: start, frameEnd: finish, frames, channelFrames: frames, finiteSamples: frames, nonzeroSamples: frames, blocks: frames / 128, sumSquares: frames * .01 ** 2 });
      start = finish;
    }
    Object.assign(n, { frameEnd: end, frames: end, channelFrames: end, finiteSamples: end, nonzeroSamples: end, blocks: end / 128, sumSquares: end * .01 ** 2 });
    expect(gradeStage1Run(r, release).reasons).toEqual(["input-frame-lifetime-bound"]);
  });
  it.each(["missing", "late-connect", "late-disconnect", "wrong-construction"] as const)("rejects %s bootstrap source/configuration evidence", kind => {
    const release = releaseFixture(), r = recordFixture(1, release), a = r.audio!;
    if (kind === "missing") a.preparation.bootstrapDisconnectedMs = null;
    if (kind === "late-connect") a.preparation.bootstrapStartedMs = a.preparation.captureGrantedMs! + 1;
    if (kind === "late-disconnect") a.preparation.bootstrapDisconnectedMs = a.preparation.graphActivatedMs! + 1;
    if (kind === "wrong-construction") (a.config as { construction: string }).construction = "unrecorded-construction";
    expect(gradeStage1Run(r, release).candidatePass).toBe(false);
  });
});

describe("Stage1 paired cohort", () => {
  const fixture = () => { const release = releaseFixture(); return { release, records: release.slots.map((_, i) => recordFixture(i, release)) }; };
  it("requires six exact scheduled sessions and grades modes separately", () => {
    const { release, records } = fixture(), result = gradeStage1Cohort(records, release);
    expect(result.reasons).toEqual([]); expect(result.candidatePass).toBe(true);
    expect(result.modes.off?.runs).toHaveLength(3); expect(result.modes.duplex?.runs).toHaveLength(3);
    expect(result.pairs.map(p => p.order)).toEqual([["off", "duplex"], ["duplex", "off"], ["off", "duplex"]]);
    expect(result.pairs[0]!.meanDifferences.xrMainThreadWallMs).toBe(0);
    expect(result.notEvidenceFor).toContain("DAC underruns");
  });
  it.each(["missing", "extra", "swap", "duplicate", "one-failure", "mode-cpu-spread", "changed-profile", "unreleased-nonce"] as const)("does not rescue %s with pooling/replacement", kind => {
    const { release, records } = fixture();
    if (kind === "missing") records.pop();
    if (kind === "extra") records.push(recordFixture(0, release));
    if (kind === "swap") [records[0], records[1]] = [records[1]!, records[0]!];
    if (kind === "duplicate") records[5] = structuredClone(records[1]!);
    if (kind === "one-failure") records[1]!.audio!.actual.trackMuted = true;
    if (kind === "mode-cpu-spread") records[5]!.xr.frames.forEach(f => { f.updateMs = 5; });
    if (kind === "changed-profile") records[1]!.xr.profile!.foveationReadback = 0;
    if (kind === "unreleased-nonce") { records[5]!.xr.identity.nonce += "new"; records[5]!.slot.nonce += "new"; records[5]!.audio!.source.runNonce += "new"; }
    expect(gradeStage1Cohort(records, release).candidatePass).toBe(false);
  });
  it("does not add an across-mode CPU budget or subtract quantiles", () => {
    const { release, records } = fixture();
    for (const r of records.filter(item => item.mode === "duplex")) r.xr.frames.forEach(f => { f.updateMs += 5; });
    const result = gradeStage1Cohort(records, release);
    expect(result.candidatePass).toBe(true); expect(result.runs[1]!.xr!.cpuAdvisoryMet).toBe(false);
    expect(result.pairs[0]!.meanDifferences.xrMainThreadWallMs).toBeCloseTo(5);
    expect(Object.keys(result.pairs[0]!.meanDifferences)).toEqual(["callbackIntervalMs", "xrMainThreadWallMs"]);
  });
  it("retains valid measured CPU repeatability failures as failed candidates", () => {
    const { release, records } = fixture(); records[5]!.xr.frames.forEach(f => { f.updateMs = 5; });
    const result = gradeStage1Cohort(records, release);
    expect(result.valid).toBe(true); expect(result.candidatePass).toBe(false);
    expect(result.reasons).toContain("duplex-three-run-repeatability-or-hard-gate");
  });
});
