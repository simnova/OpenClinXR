import { describe, expect, it } from "vitest";
import { at, emptyHealth, fixture, history, recount, silenceBin, syncRows } from "./fixtures.test-support.js";
import { gradeStage2Run } from "../../entrypoints/stage2.js";
import type { Stage2Mode, Stage2RunRecord } from "../../entrypoints/stage2.js";

function negative(mode: Exclude<Stage2Mode, "positive">) {
  const f = fixture(mode); const r = f.record;
  r.outcome = "failed"; r.reason = `intentional ${mode}`;
  r.negative = { intendedFault: mode, injectedAtBrowserMs: 700, observed: true, prerequisites: { uplinkDecoded: true, remoteRtp: true, remoteDecoded: true, bothDirectionsReady: true, qualifiedFiveSeconds: true, actualRelay400Hz: true }, evidence: ["pure fixture only"] };
  if (mode !== "early-peer-close") {
    Object.assign(r.sources.uplink, history(400, 1, 128, "worklet-currentFrame", [["setup", 96000]]));
    Object.assign(r.sources.downlink, history(700, 1, 960, "generated-pts", [["setup", 96000]]));
    Object.assign(r.decoded.uplink, history(400, 2, 960, "decoded-pts", [["setup", 96000]]));
    Object.assign(r.decoded.downlink, history(700, 2, 128, "worklet-currentFrame", [["setup", 96000]]));
    r.marks = []; r.clientWindow = { startMs: null, terminalMs: null };
    r.lifecycle.readyMs = null; r.lifecycle.warmupStartedMs = null; r.lifecycle.warmupEndedMs = null;
    r.lifecycle.contextClosedMs = 2600; r.lifecycle.peerClosedServerMs = 102550; r.lifecycle.driverEndedMs = 12700;
    r.cleanup.closeSentMs = 2510; r.cleanup.closeReceivedMs = 2560;
    if (r.cleanup.serverClose) r.cleanup.serverClose.atServerMs = 102550;
  }
  if (mode === "uplink-only") {
    r.sources.downlink = { ...r.sources.downlink, kind: "absent", trackId: null, senderTrackId: null, senderDrivenCalls: null, unboundCalls: null, clockId: null, initialQuantum: null, targetBinFrames: null, origin: null, final: null, total: emptyHealth(), bins: [] };
    r.decoded.downlink = { ...r.decoded.downlink, origin: null, final: null, total: emptyHealth(), bins: [], sampleRate: null, channels: null, initialQuantum: null, targetBinFrames: null, firstDecodedAtLocalMs: null, firstNonzeroAtLocalMs: null, format: null };
    r.mappings.downlink = null; syncRows(r);
  } else if (mode === "relay-instead-of-independent-return") {
    r.sources.downlink.kind = "relay";
    for (const h of [r.sources.downlink, r.decoded.downlink]) for (const b of h.bins) {
      [b.tone.real400, b.tone.real700] = [b.tone.real700, b.tone.real400]; [b.tone.power400, b.tone.power700] = [b.tone.power700, b.tone.power400];
    }
  } else if (mode === "remote-output-disconnected") {
    const zero = r.decoded.downlink.bins[1]; if (!zero) throw new Error("fixture");
    silenceBin(zero); recount(r.decoded.downlink);
    for (const row of r.decoded.downlink.bins) if (row.frameStart >= zero.frameEnd) row.phase = "warmup";
    r.marks = [{ markerId: "observed-zero", command: "warmup", server: { sentMs: 1600, receivedMs: null, ack: null }, browser: { sentMs: 1600, receivedMs: 1610, ack: { markerId: "observed-zero", command: "warmup", uplinkSource: null, downlinkMonitor: { markerId: "observed-zero", command: "warmup", phase: "warmup", position: at(r.decoded.downlink, zero.frameEnd) } } } }];
    r.receiverDecodeEvidence = {
      healthyMonitor: { sequence: 0, observedAtBrowserMs: 600 },
      start: { receiverTrackId: "downlink-receiver", ssrc: 700, observedAtBrowserMs: 1700, totalSamplesReceived: 72000, concealedSamples: 0, totalAudioEnergy: .01, totalSamplesDuration: 1.5 },
      end: { receiverTrackId: "downlink-receiver", ssrc: 700, observedAtBrowserMs: 2300, totalSamplesReceived: 100000, concealedSamples: 0, totalAudioEnergy: .02, totalSamplesDuration: 2.1 },
    };
  } else {
    for (const h of [r.sources.uplink, r.sources.downlink, r.decoded.uplink, r.decoded.downlink]) {
      const kind = h.origin?.tag.kind ?? "worklet-currentFrame";
      Object.assign(h, history(kind === "decoded-pts" || h === r.sources.uplink ? 400 : 700, h.total.channels, h.initialQuantum ?? 128, kind, [["setup", 48000], ["warmup", 480000], ["qualified", 288000]]));
    }
    r.clientWindow.terminalMs = 17006; r.negative.injectedAtBrowserMs = 17005;
    const startUp = r.marks[2]?.server.ack?.uplinkDecoded; const startDown = r.marks[2]?.browser.ack?.downlinkMonitor;
    if (!startUp || !startDown) throw new Error("fixture");
    r.negative.preInjectionCheckpoint = { identity: r.identity, binding: r.binding, requestedAtBrowserMs: 16005, receivedAtBrowserMs: 16050, browserObservedAtMs: 16040, serverClockId: "python-clock", serverAtMs: 116040, uplinkDecoded: at(r.decoded.uplink, startUp.position.processedFrames + 240000), downlinkMonitor: at(r.decoded.downlink, startDown.position.processedFrames + 240000) };
    r.marks.pop(); // Peer closes intentionally before any completed END exchange.
    r.cleanup.closeSentMs = 17005; r.cleanup.closeReceivedMs = 17055;
    r.lifecycle.contextClosedMs = 17100; r.lifecycle.peerClosedServerMs = 117050; r.lifecycle.driverEndedMs = 27150;
    if (r.cleanup.serverClose) r.cleanup.serverClose.atServerMs = 117050;
  }
  syncRows(r);
  return f;
}
describe("negative controls require independently joined intended prerequisites", () => {
  it.each(["uplink-only", "relay-instead-of-independent-return", "remote-output-disconnected", "early-peer-close"] as const)("credits actual intended %s rejection with cleanup", mode => {
    const { record, release } = negative(mode); const g = gradeStage2Run(record, release);
    expect(g.functionalPass).toBe(false); expect(g.negative).toEqual({ exercised: true, rejectedAsIntended: true });
  });
  const missing: Array<[Exclude<Stage2Mode, "positive">, string, (r: Stage2RunRecord) => void]> = [
    ["uplink-only", "no actual decoded uplink", r => { r.decoded.uplink.total.nonzeroSamples = 0; }],
    ["uplink-only", "absent intended-fault receipt", r => { if (r.negative) r.negative.observed = false; }],
    ["relay-instead-of-independent-return", "nonzero unrelated return", r => { for (const b of r.decoded.downlink.bins) { b.tone.real400 = 0; b.tone.power400 = 0; } }],
    ["relay-instead-of-independent-return", "generator error unrelated to relay", r => { r.sources.downlink.generatorErrors++; }],
    ["remote-output-disconnected", "no actual remote RTP", r => { r.decoded.downlink.rtp.packets = 0; }],
    ["remote-output-disconnected", "no receiver samples", r => { delete r.receiverDecodeEvidence; }],
    ["remote-output-disconnected", "wrong receiver track", r => { if (r.receiverDecodeEvidence) r.receiverDecodeEvidence.end.receiverTrackId = "local"; }],
    ["remote-output-disconnected", "wrong actual SSRC", r => { if (r.receiverDecodeEvidence) { r.receiverDecodeEvidence.start.ssrc = 123; r.receiverDecodeEvidence.end.ssrc = 123; } }],
    ["remote-output-disconnected", "only concealed progression", r => { if (r.receiverDecodeEvidence) r.receiverDecodeEvidence.end.concealedSamples = 28000; }],
    ["remote-output-disconnected", "pre-fault receiver statistics", r => { if (r.receiverDecodeEvidence) r.receiverDecodeEvidence.start.observedAtBrowserMs = 650; }],
    ["remote-output-disconnected", "no applied-zero bracket", r => { const m = r.marks[0]; if (m) m.browser.receivedMs = 1800; }],
    ["remote-output-disconnected", "zero frame outside mark frontier", r => { const p = r.marks[0]?.browser.ack?.downlinkMonitor; if (p) p.position = at(r.decoded.downlink, 24064); }],
    ["remote-output-disconnected", "borrowed healthy reference", r => { if (r.receiverDecodeEvidence) r.receiverDecodeEvidence.healthyMonitor.sequence = 1; }],
    ["remote-output-disconnected", "healthy receipt after fault", r => { if (r.receiverDecodeEvidence) r.receiverDecodeEvidence.healthyMonitor.observedAtBrowserMs = 701; }],
    ["remote-output-disconnected", "old zero bin before a live later marker", r => { const p = r.marks[0]?.browser.ack?.downlinkMonitor; if (p) p.position = at(r.decoded.downlink, 72192); }],
    ["remote-output-disconnected", "marker requested before applied fault", r => { const m = r.marks[0]; if (m) m.browser.sentMs = 650; }],
    ["early-peer-close", "boolean only instead of checkpoint", r => { if (r.negative) delete r.negative.preInjectionCheckpoint; }],
    ["early-peer-close", "less than five actual seconds", r => { const c = r.negative?.preInjectionCheckpoint; if (c) c.uplinkDecoded = at(r.decoded.uplink, 528000 + 239999); }],
    ["early-peer-close", "checkpoint received after injection", r => { const c = r.negative?.preInjectionCheckpoint; if (c) c.receivedAtBrowserMs = 17006; }],
    ["early-peer-close", "monitor observation after injection", r => { const c = r.negative?.preInjectionCheckpoint; if (c) c.browserObservedAtMs = 17006; }],
    ["early-peer-close", "borrowed checkpoint nonce", r => { const c = r.negative?.preInjectionCheckpoint; if (c) c.binding = { ...r.binding, runNonce: "borrowed" }; }],
    ["early-peer-close", "raw checkpoint tag mismatch", r => { const c = r.negative?.preInjectionCheckpoint; if (c) c.uplinkDecoded.tag.value++; }],
    ["early-peer-close", "unconfirmed cleanup", r => { r.cleanup.serverClose = null; }],
    ["early-peer-close", "unrelated downlink generator failure", r => { r.sources.downlink.generatorErrors++; }],
    ["early-peer-close", "unrelated decoder failure", r => { r.decoded.downlink.processorErrors++; }],
    ["early-peer-close", "unrelated pending command", r => { r.cleanup.browserRemaining.pendingCommands++; }],
    ["early-peer-close", "late cleanup after supposed injection", r => { r.lifecycle.contextClosedMs = 30000; r.cleanup.closeSentMs = 29900; r.cleanup.closeReceivedMs = 29950; }],
    ["early-peer-close", "unrelated mixed marker identity", r => { const a = r.marks[0]?.server.ack; if (a) a.binding = { ...r.binding, runNonce: "borrowed" }; }],
    ["early-peer-close", "late browser START ACK", r => { const m = r.marks[2]; if (m) m.browser.receivedMs = (r.clientWindow.startMs ?? 0) + 1; }],
    ["early-peer-close", "late server START ACK", r => { const m = r.marks[2]; if (m) m.server.receivedMs = (r.clientWindow.startMs ?? 0) + 1; }],
    ["early-peer-close", "zero warmup", r => { r.lifecycle.warmupStartedMs = r.lifecycle.warmupEndedMs; }],
    ["early-peer-close", "missing readiness", r => { r.lifecycle.readyMs = null; }],
    ["uplink-only", "injection after context close", r => { if (r.negative) r.negative.injectedAtBrowserMs = (r.lifecycle.contextClosedMs ?? 0) + 1; }],
    ["relay-instead-of-independent-return", "injection after context close", r => { if (r.negative) r.negative.injectedAtBrowserMs = (r.lifecycle.contextClosedMs ?? 0) + 1; }],
    ["uplink-only", "overflow during fault", r => { r.resources.overflow++; }],
    ["uplink-only", "missing browser reservation audit", r => { r.resources.ownerReservations.browser = null; }],
    ["relay-instead-of-independent-return", "wrong owner reservation limit", r => { const a = r.resources.ownerReservations.python; if (a) a.limitBytes = 655360; }],
    ["remote-output-disconnected", "refused gateway reservation", r => { const a = r.resources.ownerReservations.gateway; if (a) a.rejectedReservations++; }],
    ["early-peer-close", "unclosed reservation growth", r => { const a = r.resources.ownerReservations.browser; if (a) a.closed = false; }],
    ["remote-output-disconnected", "unexpected context suspension", r => { r.events.push({ atBrowserMs: 1600, atServerMs: null, type: "unexpected-context-state", detail: "suspended" }); }],
  ];
  it.each(missing)("keeps %s UNEXERCISED for %s", (mode, _name, corrupt) => {
    const { record, release } = negative(mode); corrupt(record);
    expect(gradeStage2Run(record, release).negative).toEqual({ exercised: false, rejectedAsIntended: false });
  });
  it("generic startup failure cannot turn all fault flags into exercised credit", () => {
    const { record, release } = negative("early-peer-close"); record.marks = []; record.connection.browserPair = null;
    expect(gradeStage2Run(record, release).negative?.exercised).toBe(false);
  });
  it.each(["uplink-only", "relay-instead-of-independent-return", "remote-output-disconnected", "early-peer-close"] as const)("rejects unrelated generic media-fault during %s", mode => {
    const { record, release } = negative(mode);
    record.events.push({ atBrowserMs: 800, atServerMs: null, type: "media-fault", detail: "unrelated decoder failure" });
    expect(gradeStage2Run(record, release).negative?.rejectedAsIntended).toBe(false);
  });
  it.each(["uplink-only", "relay-instead-of-independent-return", "remote-output-disconnected", "early-peer-close"] as const)("never credits zero owner reservation evidence during %s", mode => {
    for (const owner of ["browser", "python", "gateway"] as const) {
      const { record, release } = negative(mode); const audit = record.resources.ownerReservations[owner];
      if (!audit) throw new Error("fixture");
      audit.peakBytes = 0; audit.heldBytesAtClose = 0; audit.categoryPeaks = {};
      expect(gradeStage2Run(record, release).negative?.rejectedAsIntended).toBe(false);
    }
  });
  it.each(["uplink-only", "relay-instead-of-independent-return", "remote-output-disconnected"] as const)("requires actual 400Hz setup prerequisite for %s", mode => {
    const { record, release } = negative(mode);
    for (const b of record.decoded.uplink.bins) {
      b.tone.real400 = 0; b.tone.power400 = 0; b.tone.real700 = b.tone.N * .01; b.tone.power700 = .0002;
    }
    expect(gradeStage2Run(record, release).negative?.rejectedAsIntended).toBe(false);
  });
});
