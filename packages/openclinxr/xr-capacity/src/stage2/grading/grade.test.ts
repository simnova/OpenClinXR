import { describe, expect, it } from "vitest";
import { at, fixture, recount, silenceBin, syncRows } from "./fixtures.test-support.js";
import { gradeStage2Run } from "../../entrypoints/stage2.js";
import type { Stage2RunRecord } from "../../entrypoints/stage2.js";

describe("pure host-only synthetic duplex grade", () => {
  it("accepts one exact source-bound synthetic fixture and never mutates input", () => {
    const { record, release } = fixture(); const before = JSON.stringify(record);
    const grade = gradeStage2Run(record, release);
    expect(grade.reasons).toEqual([]);
    expect(grade.functionalPass).toBe(true);
    expect(grade.coverage).toEqual({ clientMs: 70000, uplinkDecodedSeconds: 70, downlinkDecodedSeconds: 70, uplinkSourceSeconds: 70, downlinkSourceSeconds: 70 });
    expect(JSON.stringify(record)).toBe(before);
  });
  const corruptions: Array<[string, (r: Stage2RunRecord) => void]> = [
    ["old schema", r => { r.schema = "old" as Stage2RunRecord["schema"]; }],
    ["wrong source hash", r => { r.identity.browserBundleSha256 = "f".repeat(64); }],
    ["unavailable identity", r => { r.identity.serverSourceSha256 = "unavailable"; }],
    ["wrong nonce", r => { r.binding.runNonce = "borrowed"; }],
    ["wrong close ticket", r => { if (r.cleanup.serverClose) r.cleanup.serverClose.binding = { ...r.binding, peerTicket: "borrowed" }; }],
    ["mixed server marker nonce", r => { const a = r.marks[2]?.server.ack; if (a) a.binding = { ...r.binding, runNonce: "stale" }; }],
    ["browser version changed", r => { r.environment.browser.version = "different-browser"; }],
    ["unknown driver clock", r => { r.environment.driver.clockId = "unknown"; }],
    ["unproven own-host media", r => { if (r.connection.browserPair) r.connection.browserPair.remote.inventoryAddress = null; }],
    ["mismatched UDP peers", r => { if (r.connection.serverPair) r.connection.serverPair.local.port = 33333; }],
    ["redacted path", r => { r.connection.serverPair = null; }],
    ["unbound receiver", r => { if (r.mappings.downlink) r.mappings.downlink.receiverBindingObserved = false; }],
    ["wrong actual monitored receiver", r => { if (r.mappings.downlink) r.mappings.downlink.monitoredTrackId = "local-oscillator"; }],
    ["nonfinite RTP diagnostic", r => { r.decoded.downlink.rtp.jitterSeconds = NaN; }],
    ["missing negotiated codec", r => { if (r.mappings.downlink) r.mappings.downlink.codec = null; }],
    ["wrong codec", r => { if (r.mappings.uplink?.codec) r.mappings.uplink.codec.mimeType = "audio/PCMU"; }],
    ["relay constructor as independence", r => { r.sources.downlink.kind = "relay"; }],
    ["generator manually pumped", r => { r.sources.downlink.unboundCalls = 1; }],
    ["fake browser sender-pull callbacks", r => { r.sources.uplink.senderDrivenCalls = 30000; }],
    ["no independent sender pulls", r => { r.sources.downlink.senderDrivenCalls = 0; }],
    ["short UI window", r => { r.clientWindow.terminalMs = 80000; }],
    ["start ACK after UI interval", r => { const m = r.marks[2]; if (m) m.browser.receivedMs = 11006; }],
    ["stop request before UI terminal", r => { const m = r.marks[3]; if (m) m.server.sentMs = 81000; }],
    ["lifetime frames stand in for qualified", r => { const l = r.marks[2]?.server.ack?.uplinkDecoded; if (l) l.position = at(r.decoded.uplink, 600000); }],
    ["stereo sample inflation", r => { const l = r.marks[3]?.server.ack?.uplinkDecoded; if (l) l.position.processedFrames *= 2; }],
    ["wrong tone N units", r => { const b = r.decoded.downlink.bins[0]; if (b) b.tone.N *= 2; }],
    ["first callback lost", r => { r.decoded.downlink.bins.shift(); syncRows(r); }],
    ["startup clock discontinuity", r => { const b = r.decoded.downlink.bins[0]; if (b) b.tagStart.value += 128; }],
    ["startup nonfinite", r => { const b = r.decoded.downlink.bins[0]; if (b) { b.nonfiniteSamples++; b.finiteSamples--; } recount(r.decoded.downlink); }],
    ["startup clipping", r => { const b = r.decoded.downlink.bins[0]; if (b) { b.clippedSamples++; b.peak = .98; } recount(r.decoded.downlink); }],
    ["fake partial first full bin", r => { const b = r.decoded.downlink.bins[0]; if (b) b.partialReason = "phase-boundary"; }],
    ["empty partial row", r => { const b = r.decoded.downlink.bins[0]; if (b) b.frames = 0; }],
    ["lost final partial tail", r => { r.decoded.downlink.bins.pop(); syncRows(r); recount(r.decoded.downlink); }],
    ["claimed source bin omitted", r => { r.sources.uplink.bins.pop(); syncRows(r); }],
    ["wrong first quantum rounding", r => { r.decoded.uplink.targetBinFrames = 24064; }],
    ["fractional frame counter", r => { r.decoded.uplink.total.frames += .5; }],
    ["unaccounted channel samples", r => { r.decoded.uplink.total.channelSamples++; }],
    ["known payload cap", r => { r.resources.knownPendingPayloadBytes = 1048576; }],
    ["underreported known payload", r => { r.resources.knownPendingPayloadBytes--; }],
    ["lost health row accounting", r => { r.resources.healthRows.downlink--; }],
    ["control overflow", r => { r.resources.overflow = 1; }],
    ["queued control cap", r => { r.resources.maximumQueuedControlBytes = 262145; }],
    ["unconfirmed server drain", r => { r.cleanup.serverClose = null; }],
    ["closing server peer", r => { if (r.cleanup.serverClose) r.cleanup.serverClose.closingPeers = 1; }],
    ["owned browser port", r => { r.cleanup.browserRemaining.ports = 1; }],
    ["pending command", r => { r.cleanup.browserRemaining.pendingCommands = 1; }],
    ["unconfirmed driver cleanup", r => { r.cleanup.driver.confirmed = false; }],
    ["drain timeout", r => { r.cleanup.closeReceivedMs = 90000; }],
    ["context origin reset", r => { r.lifecycle.contextCreatedMs = 1000; }],
    ["driver lifetime exceeded", r => { r.lifecycle.driverEndedMs = 180000; }],
    ["producer failure", r => { r.outcome = "failed"; }],
    ["unexpected context suspension", r => { r.events.push({ atBrowserMs: 5000, atServerMs: null, type: "unexpected-context-state", detail: "suspended" }); }],
  ];
  it.each(corruptions)("rejects %s", (_name, corrupt) => {
    const { record, release } = fixture(); corrupt(record);
    expect(gradeStage2Run(record, release).functionalPass).toBe(false);
  });
  it("rejects a later quiet complete qualified bin even after a healthy first bin", () => {
    const { record, release } = fixture(); const b = record.decoded.downlink.bins.find(item => item.phase === "qualified" && item.sequence > 30);
    if (!b) throw new Error("fixture has no qualified bin"); silenceBin(b); recount(record.decoded.downlink);
    expect(gradeStage2Run(record, release).reasons).toContain(`downlink.decoded.bin-${b.sequence}-qualified-zero`);
  });
  it("rejects zero qualified boundary partial without discarding its valid numerical counters", () => {
    const { record, release } = fixture(); const b = record.decoded.downlink.bins.find(item => item.phase === "qualified" && item.partialReason !== null);
    if (!b) throw new Error("fixture has no boundary partial"); silenceBin(b); recount(record.decoded.downlink);
    expect(gradeStage2Run(record, release).reasons).toContain(`downlink.decoded.bin-${b.sequence}-qualified-zero`);
  });
  it("rejects relay waveform from raw coherent aggregates despite nonzero totals and producer success", () => {
    const { record, release } = fixture();
    for (const b of record.decoded.downlink.bins) { [b.tone.real400, b.tone.real700] = [b.tone.real700, b.tone.real400]; [b.tone.power400, b.tone.power700] = [b.tone.power700, b.tone.power400]; }
    expect(gradeStage2Run(record, release).reasons.some(s => s.includes("decoded-700Hz"))).toBe(true);
  });
  it("rejects fabricated power without trusting precomputed classifier fields", () => {
    const { record, release } = fixture(); const b = record.decoded.downlink.bins.find(item => item.phase === "qualified");
    if (!b) throw new Error("fixture"); b.tone.real700 = 0;
    expect(gradeStage2Run(record, release).functionalPass).toBe(false);
  });
  it("malformed empty or missing records fail closed", () => {
    for (const bad of [{}, null, { schema: "quest-stage2-host-run.v1" }, []]) {
      const { release } = fixture(); expect(gradeStage2Run(bad as Stage2RunRecord, release).functionalPass).toBe(false);
    }
  });
});
