import { describe, expect, it } from "vitest";
import { recordFixture as oldRecord } from "../../stage1/grading/fixtures.test-support.js";
import { gradeWitnessedCohort, gradeWitnessedRun, parseWitnessedStage1Record } from "@openclinxr/xr-capacity/stage1-witnessed/grading";
import { witnessedRecordFixture, witnessedReleaseFixture } from "./fixtures.test-support.js";
import type { WitnessedStage1Record } from "@openclinxr/xr-capacity/stage1-witnessed/grading";

function shiftTargets(r: WitnessedStage1Record, offset: number) {
  const a = r.audio!;
  for (const side of ["input", "output"] as const) {
    a[side].frameStart += offset; a[side].frameEnd += offset;
    a[side].windows.forEach(row => { row.frameStart += offset; row.frameEnd += offset; });
    for (const m of a.marks) { m[side].frame += offset; m[side].counters.frameStart += offset; m[side].counters.frameEnd += offset; }
    const ready = a.preparation[side === "input" ? "inputReadyAck" : "outputReadyAck"]!;
    ready.frame += offset; ready.counters.frameStart += offset; ready.counters.frameEnd += offset;
  }
}

describe("New witnessed variant scalar grading (no browser/Quest qualification)", () => {
  it("requires the three-processor graph, complete witness lifetime, and causal frontier", () => {
    const release = witnessedReleaseFixture(), r = witnessedRecordFixture(1, release), result = gradeWitnessedRun(r, release);
    expect(result.reasons).toEqual([]); expect(result.candidatePass).toBe(true);
    expect(result.audio?.witness?.memory.knownBytes).toBe(515840);
    expect(result.audio?.witness?.frontierFrameStart).toBe(896);
  });
  it("OFF creates no audio and has the same new release", () => {
    const release = witnessedReleaseFixture(), r = witnessedRecordFixture(0, release);
    expect(gradeWitnessedRun(r, release).candidatePass).toBe(true); r.audioOwnership.created.ports = 1;
    expect(gradeWitnessedRun(r, release).candidatePass).toBe(false);
  });
  it("rejects the entire old schema instead of casting/relabeling it", () => {
    expect(() => parseWitnessedStage1Record(oldRecord())).toThrow();
    expect(gradeWitnessedRun(oldRecord(), witnessedReleaseFixture()).candidatePass).toBe(false);
  });
  it("uses the received frame START frontier without inventing a later attachment ordinal", () => {
    const release = witnessedReleaseFixture(), r = witnessedRecordFixture(1, release);
    shiftTargets(r, -128); // Target first frame equals witness's last received frame START.
    expect(gradeWitnessedRun(r, release).candidatePass).toBe(true);
    shiftTargets(r, -128);
    expect(gradeWitnessedRun(r, release).reasons).toEqual(["witness-frontier-not-before-both-targets"]);
  });
  it.each([null, {}, [], { ...witnessedRecordFixture(), schema: "quest-stage1-record.v1" }])("fails malformed/new-variant identity safely", value => {
    expect(gradeWitnessedRun(value, witnessedReleaseFixture()).candidatePass).toBe(false);
  });
  it.each(["missing-witness", "witness-hash", "old-protocol", "changed-target", "five-nodes", "two-ports", "port-leak", "missing-first-eight", "wrong-ordinal", "prime-gap", "prime-clock", "wrong-frontier", "input-before-frontier", "output-before-frontier", "constructor-before-prime", "missing-target-bracket", "prime-deadline", "reset-graph-clock", "setup-reset", "setup-origin", "attach-missing", "attach-before-target", "witness-stopped-early", "no-final", "stale-final", "overflow", "queue-drop", "fractional-blocks", "rate-change", "witness-output", "witness-nonfinite", "missing-tail", "forged-partial", "partial-tail-output", "partial-tail-counter", "memory-omit-witness", "memory-omit-payload", "memory-dimension", "memory-cap", "source-nonce", "target-clipped", "mark-after-stop"] as const)("rejects %s without removing retained evidence", kind => {
    const release = witnessedReleaseFixture(), r = witnessedRecordFixture(1, release), a = r.audio!, w = a.witness;
    const frameCount = r.xr.frames.length, bins = w.windows.length;
    if (kind === "missing-witness") delete (a as unknown as Record<string, unknown>)["witness"];
    if (kind === "witness-hash") a.source.witnessWorkletSha256 = "0".repeat(64);
    if (kind === "old-protocol") { release.identity.protocolSha256 = "a".repeat(64); r.xr.identity.protocolSha256 = release.identity.protocolSha256; }
    if (kind === "changed-target") { release.workletSha256 = "a".repeat(64); a.source.workletSha256 = release.workletSha256; a.source.expectedWorkletSha256 = release.workletSha256; }
    if (kind === "five-nodes") { a.ownership.created.nodes = 5; r.audioOwnership.created.nodes = 5; }
    if (kind === "two-ports") { a.ownership.created.ports = 2; r.audioOwnership.created.ports = 2; }
    if (kind === "port-leak") { a.ownership.remaining.ports = 1; r.audioOwnership.remaining.ports = 1; }
    if (kind === "missing-first-eight") w.firstEight.pop();
    if (kind === "wrong-ordinal") w.firstEight[7]![0] = 8;
    if (kind === "prime-gap") w.firstEight[4]![1]! += 128;
    if (kind === "prime-clock") w.firstEight[4]![2]! += 1;
    if (kind === "wrong-frontier") w.receivedFrontierFrameStart = 1024;
    if (kind === "input-before-frontier") a.input.frameStart = 0;
    if (kind === "output-before-frontier") a.output.frameStart = 0;
    if (kind === "constructor-before-prime") w.targetCreation.input!.beforeMs = 224;
    if (kind === "missing-target-bracket") w.targetCreation.output = null;
    if (kind === "prime-deadline") w.primingReceivedMs = w.createdMs! + 1000.1;
    if (kind === "reset-graph-clock") a.preparation.graphActivatedMs = w.targetConnectedMs;
    if (kind === "setup-reset") a.preparation.setupDeadlineMs! += 1000;
    if (kind === "setup-origin") a.preparation.setupStartedMs = a.preparation.contextRunningMs;
    if (kind === "attach-missing") w.attachSeen = null;
    if (kind === "attach-before-target") w.attachedSentMs = w.creationBeforeMs! - 1;
    if (kind === "witness-stopped-early") w.frameEnd = a.input.frameEnd - 128;
    if (kind === "no-final") w.finalReceived = false;
    if (kind === "stale-final") w.finalReceivedMs = a.timing.stopRequestedMs! - 1;
    if (kind === "overflow") w.overflow = 1;
    if (kind === "queue-drop") a.queue.dropped = 1;
    if (kind === "fractional-blocks") w.windows[0]!.blocks += .5;
    if (kind === "rate-change") w.windows[0]!.sampleRateChanges = 1;
    if (kind === "witness-output") w.windows[0]!.nonzeroOutputSamples = 1;
    if (kind === "witness-nonfinite") w.windows[0]!.nonfiniteOutputSamples = 1;
    if (kind === "missing-tail") w.windows.pop();
    if (kind === "forged-partial") w.windows[0]!.partial = true;
    if (kind === "partial-tail-output") w.windows.at(-1)!.nonzeroOutputSamples = 1;
    if (kind === "partial-tail-counter") w.windows.at(-1)!.frames--;
    if (kind === "memory-omit-witness") a.memory.ownedTypedBytes = 409600;
    if (kind === "memory-omit-payload") a.memory.maximumKnownPayloadBytes = 0;
    if (kind === "memory-dimension") a.memory.ledger["witnessMainAndWorkletStores"] = 1;
    if (kind === "memory-cap") a.memory.capBytes = 600000;
    if (kind === "source-nonce") a.source.runNonce = "earlier-failed-campaign";
    if (kind === "target-clipped") a.input.windows[0]!.clipSamples = 1;
    if (kind === "mark-after-stop") { a.marks[2]!.sentMs = a.timing.stopRequestedMs! + 1; a.marks[2]!.receivedMs = a.marks[2]!.sentMs + 1; }
    expect(gradeWitnessedRun(r, release).candidatePass).toBe(false);
    expect(r.xr.frames.length).toBe(frameCount); expect(w.windows.length).toBe(kind === "missing-tail" ? bins - 1 : bins);
  });
  it("does not waive a complete zero microphone bin merely because witness is healthy", () => {
    const release = witnessedReleaseFixture(), r = witnessedRecordFixture(1, release), a = r.audio!, row = a.input.windows.find(v => v.phase === "sample" && !v.partial)!;
    a.input.nonzeroSamples -= row.nonzeroSamples; a.input.sumSquares -= row.sumSquares;
    a.marks[2]!.input.counters.nonzeroSamples -= row.nonzeroSamples; a.marks[2]!.input.counters.sumSquares -= row.sumSquares;
    row.nonzeroSamples = 0; row.sumSquares = 0; row.peak = 0;
    expect(gradeWitnessedRun(r, release).reasons).toContain("input-complete-bin-no-observed-activity");
  });
  it("retains witness gaps as failures even when all reported totals agree", () => {
    const release = witnessedReleaseFixture(), r = witnessedRecordFixture(1, release), w = r.audio!.witness;
    w.frameDiscontinuities = 1; w.windows[1]!.frameDiscontinuities = 1;
    w.gaps.push({ expected: 24192, actual: 24320, quantum: 128, ordinal: 189 });
    expect(gradeWitnessedRun(r, release).reasons).toContain("witness-whole-lifetime-software-continuity-or-zero-output");
  });
});

describe("Witnessed prospective matched cohort", () => {
  it("requires six new exact ordered slots and unchanged separate mode gates", () => {
    const release = witnessedReleaseFixture(), records = release.slots.map((_, i) => witnessedRecordFixture(i, release));
    const result = gradeWitnessedCohort(records, release);
    expect(result.reasons).toEqual([]); expect(result.candidatePass).toBe(true);
    expect(result.modes.off?.runs.length).toBe(3); expect(result.modes.duplex?.runs.length).toBe(3);
    expect(gradeWitnessedCohort(records.slice(0, 2), release).candidatePass).toBe(false);
    [records[0], records[1]] = [records[1]!, records[0]!];
    expect(gradeWitnessedCohort(records, release).candidatePass).toBe(false);
  });
  it("does not rescue one failed target/witness with other runs or fit a new CPU budget", () => {
    const release = witnessedReleaseFixture(), records = release.slots.map((_, i) => witnessedRecordFixture(i, release));
    for (const r of records.filter(value => value.mode === "duplex")) r.xr.frames.forEach(row => { row.updateMs += 5; });
    expect(gradeWitnessedCohort(records, release).candidatePass).toBe(true);
    records[2]!.audio!.witness.overflow = 1;
    expect(gradeWitnessedCohort(records, release).candidatePass).toBe(false);
  });
});
