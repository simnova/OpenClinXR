import { decodedHealthy, gradeHistory, positive, toneMatches } from "./health.js";
import { envelopeMatches, gradeCleanup, gradeIntegrity, gradeReadyTiming, gradeResources, mappingValid } from "./integrity.js";
import { stage2ReceiverDecodeAdvances } from "./receiver-contract.js";
import type { Stage2DecodedConsumer, Stage2RunRecord, Stage2RunRelease } from "./types.js";
import { existingControlsValid, gradeWindow, historyBoundariesValid, latch, positionDelta, prequalifiedConditionsValid, within } from "./window.js";
import type { Stage2Coverage } from "./window.js";

export interface Stage2Grade {
  functionalPass: boolean;
  negative: { exercised: boolean; rejectedAsIntended: boolean } | null;
  reasons: string[];
  coverage: Stage2Coverage;
}
const emptyCoverage = (): Stage2Coverage => ({ clientMs: 0, uplinkDecodedSeconds: 0, downlinkDecodedSeconds: 0, uplinkSourceSeconds: 0, downlinkSourceSeconds: 0 });
function decodedMetadataValid(d: Stage2DecodedConsumer, sourceId: string, browser: boolean): boolean {
  const diagnostics = [d.rtp.packets, d.rtp.bytes, d.rtp.concealedSamples].every(n => n === null || Number.isSafeInteger(n) && n >= 0)
    && (d.rtp.packetsLost === null || Number.isSafeInteger(d.rtp.packetsLost)) && (d.rtp.jitterSeconds === null || Number.isFinite(d.rtp.jitterSeconds) && d.rtp.jitterSeconds >= 0);
  return diagnostics && d.id === (browser ? "browser-downlink-monitor" : "server-uplink-decoded") && d.sourceId === sourceId && d.origin !== null && d.sampleRate === d.origin.sampleRate && d.channels === d.origin.channels && d.origin.tag.kind === (browser ? "worklet-currentFrame" : "decoded-pts") && typeof d.clockId === "string" && d.clockId.length > 0 && d.processorErrors === 0 && d.rejected === 0 && d.overflow === 0 && d.format !== null && d.format.allChannelsChecked === true && d.format.projection === "channel-0";
}
function receiverFaultPrerequisite(r: Stage2RunRecord): boolean {
  const e = r.receiverDecodeEvidence; const fault = r.negative; const m = r.mappings.downlink;
  if (!e || !fault || fault.injectedAtBrowserMs === null || !m) return false;
  const b = r.decoded.downlink.bins.find(item => item.sequence === e.healthyMonitor.sequence);
  const zero = r.decoded.downlink.bins.find(z => z.sequence > (b?.sequence ?? Infinity) && z.partialReason === null && z.frames > 0 && z.nonzeroSamples === 0 && z.sumSquares === 0 && z.peak === 0);
  const applied = r.marks.find(mark => mark.command === "warmup"); const position = applied?.browser.ack?.downlinkMonitor?.position;
  const zeroThroughLatch = zero && position ? r.decoded.downlink.bins.filter(row => row.frameStart >= zero.frameStart && row.frameEnd <= position.processedFrames) : [];
  return b !== undefined && b.partialReason === null && b.nonzeroSamples > 0 && toneMatches(b.tone, 700)
    && Number.isFinite(e.healthyMonitor.observedAtBrowserMs) && r.decoded.downlink.firstDecodedAtLocalMs !== null && e.healthyMonitor.observedAtBrowserMs >= r.decoded.downlink.firstDecodedAtLocalMs && e.healthyMonitor.observedAtBrowserMs < fault.injectedAtBrowserMs
    && e.start.observedAtBrowserMs >= fault.injectedAtBrowserMs && stage2ReceiverDecodeAdvances(e.start, e.end)
    && e.start.receiverTrackId === m.receiverTrackId && e.start.ssrc === m.receiverSsrc
    && zero !== undefined && position !== undefined && within(position, r.decoded.downlink.origin, r.decoded.downlink.final) && position.processedFrames >= zero.frameEnd
    && zeroThroughLatch.length > 0 && zeroThroughLatch.every(row => row.nonzeroSamples === 0 && row.sumSquares === 0 && row.peak === 0) && zeroThroughLatch.at(-1)?.frameEnd === position.processedFrames
    && applied?.browser.receivedMs !== null && applied?.browser.receivedMs !== undefined && applied.browser.receivedMs >= fault.injectedAtBrowserMs && applied.browser.receivedMs <= e.start.observedAtBrowserMs
    && applied.browser.sentMs >= fault.injectedAtBrowserMs
    && applied.browser.ack?.markerId === applied.markerId && applied.browser.ack.command === "warmup"
    && r.cleanup.closeSentMs !== null && e.end.observedAtBrowserMs <= r.cleanup.closeSentMs;
}
function earlyClosePrerequisite(r: Stage2RunRecord, release: Stage2RunRelease): boolean {
  const fault = r.negative; const c = fault?.preInjectionCheckpoint; const start = r.marks.find(m => m.command === "start");
  const u = latch(start, "uplinkDecoded"); const d = latch(start, "downlinkDecoded");
  if (!fault || fault.injectedAtBrowserMs === null || !c || !u || !d || r.clientWindow.startMs === null) return false;
  return envelopeMatches(c, release) && c.serverClockId === r.environment.runtime.serverClockId && Number.isFinite(c.serverAtMs)
    && Number.isFinite(c.requestedAtBrowserMs) && c.requestedAtBrowserMs >= r.clientWindow.startMs
    && c.receivedAtBrowserMs >= c.requestedAtBrowserMs && c.receivedAtBrowserMs < fault.injectedAtBrowserMs
    && c.browserObservedAtMs >= r.clientWindow.startMs && c.browserObservedAtMs < fault.injectedAtBrowserMs
    && start?.server.ack !== null && start?.server.ack !== undefined && c.serverAtMs >= start.server.ack.serverAtMs
    && within(c.uplinkDecoded, r.decoded.uplink.origin, r.decoded.uplink.final) && within(c.downlinkMonitor, r.decoded.downlink.origin, r.decoded.downlink.final)
    && positionDelta(u.position, c.uplinkDecoded) >= 5 && positionDelta(d.position, c.downlinkMonitor) >= 5
    && fault.injectedAtBrowserMs - r.clientWindow.startMs >= 5000
    && r.cleanup.closeSentMs !== null && r.cleanup.closeSentMs >= fault.injectedAtBrowserMs && r.cleanup.closeReceivedMs !== null && r.lifecycle.contextClosedMs !== null
    && Math.max(r.cleanup.closeReceivedMs, r.lifecycle.contextClosedMs) - fault.injectedAtBrowserMs <= 5000;
}
function negativeGrade(r: Stage2RunRecord, release: Stage2RunRelease, reasons: string[], baseValid: boolean): Stage2Grade["negative"] {
  if (r.mode === "positive") return null;
  const fault = r.negative;
  if (!fault || fault.intendedFault !== r.mode || fault.observed !== true || fault.injectedAtBrowserMs === null || !Number.isFinite(fault.injectedAtBrowserMs) || !baseValid || !Object.values(fault.prerequisites).every(value => typeof value === "boolean")) return { exercised: false, rejectedAsIntended: false };
  if (fault.injectedAtBrowserMs < r.lifecycle.contextCreatedMs || r.lifecycle.contextClosedMs === null || fault.injectedAtBrowserMs > r.lifecycle.contextClosedMs || r.cleanup.closeSentMs === null || fault.injectedAtBrowserMs > r.cleanup.closeSentMs) return { exercised: false, rejectedAsIntended: false };
  const up = r.sources.uplink; const down = r.sources.downlink;
  const uplink = decodedHealthy(r.decoded.uplink) && gradeHistory(r.decoded.uplink, "up", 400).length === 0 && decodedMetadataValid(r.decoded.uplink, r.binding.uplinkSourceId, false) && gradeHistory(up, "up", null).length === 0 && up.kind === "browser-generated-worklet" && up.id === r.binding.uplinkSourceId && up.origin?.tag.kind === "worklet-currentFrame" && up.generatorErrors === 0 && up.senderDrivenCalls === null && up.unboundCalls === null && mappingValid(r.mappings.uplink, r.binding.uplinkSourceId, up.trackId, up.senderTrackId, false);
  const downMapped = mappingValid(r.mappings.downlink, r.binding.downlinkSourceId, down.trackId, down.senderTrackId, true);
  const independent = down.kind === "server-independent-generator" && down.id === r.binding.downlinkSourceId && down.origin?.tag.kind === "generated-pts" && Number.isSafeInteger(down.senderDrivenCalls) && (down.senderDrivenCalls ?? 0) > 0 && down.unboundCalls === 0 && down.generatorErrors === 0 && gradeHistory(down, "down", null).length === 0;
  const p = fault.prerequisites;
  // These negative controls need an observed 400Hz uplink, rather than an unrelated nonzero source.
  const completeUplink = r.decoded.uplink.bins.filter(b => b.partialReason === null);
  if (completeUplink.length === 0 || !completeUplink.every(b => b.nonzeroSamples > 0 && toneMatches(b.tone, 400))) return { exercised: false, rejectedAsIntended: false };
  let exercised = false; let targeted = false;
  if (r.mode === "uplink-only") {
    exercised = p.uplinkDecoded && uplink && down.kind === "absent" && down.total.frames === 0 && down.bins.length === 0 && down.generatorErrors === 0 && r.mappings.downlink === null && r.decoded.downlink.total.frames === 0 && r.decoded.downlink.bins.length === 0 && r.decoded.downlink.processorErrors === 0 && r.decoded.downlink.rejected === 0 && r.decoded.downlink.overflow === 0;
    targeted = reasons.some(s => s.startsWith("downlink."));
  } else if (r.mode === "relay-instead-of-independent-return") {
    const actual400 = r.decoded.downlink.bins.some(b => b.partialReason === null && b.nonzeroSamples > 0 && toneMatches(b.tone, 400));
    exercised = p.uplinkDecoded && p.actualRelay400Hz && uplink && mappingValid(r.mappings.downlink, down.id, down.trackId, down.senderTrackId, true) && down.kind === "relay" && down.generatorErrors === 0 && gradeHistory(down, "down", null).length === 0 && decodedMetadataValid(r.decoded.downlink, down.id, true) && decodedHealthy(r.decoded.downlink) && gradeHistory(r.decoded.downlink, "down", 400).length === 0 && actual400;
    targeted = reasons.includes("downlink.independent-sender");
  } else if (r.mode === "remote-output-disconnected") {
    const prior = r.receiverDecodeEvidence?.healthyMonitor.sequence;
    const missingAfterHealthy = prior !== undefined && r.decoded.downlink.bins.some(b => b.sequence > prior && (b.nonzeroSamples === 0 || b.missingFrames > 0));
    const otherwiseHealthy = gradeHistory(r.decoded.downlink, "down", null).every(reason => reason.includes("qualified-zero"));
    exercised = p.uplinkDecoded && p.remoteRtp && p.remoteDecoded && uplink && downMapped && independent && decodedMetadataValid(r.decoded.downlink, r.binding.downlinkSourceId, true) && otherwiseHealthy && positive(r.decoded.downlink.rtp.packets ?? 0) && receiverFaultPrerequisite(r) && missingAfterHealthy;
    targeted = reasons.some(s => s.startsWith("downlink.decoded."));
  } else if (r.mode === "early-peer-close") {
    exercised = p.bothDirectionsReady && p.qualifiedFiveSeconds && uplink && independent && decodedHealthy(r.decoded.downlink) && decodedMetadataValid(r.decoded.downlink, r.binding.downlinkSourceId, true) && gradeHistory(r.decoded.downlink, "down", 700).length === 0 && downMapped && prequalifiedConditionsValid(r) && earlyClosePrerequisite(r, release);
    targeted = reasons.some(s => s.startsWith("window.") && (s.includes("70000ms") || s.includes("end") || s.includes("qualified-bin-boundaries")));
  }
  return { exercised, rejectedAsIntended: exercised && targeted };
}
/** Pure audit. Producer outcome is retained but cannot supply identity, window, content, or cleanup evidence. */
export function gradeStage2Run(r: Stage2RunRecord, release: Stage2RunRelease): Stage2Grade {
  try {
    const integrity = gradeIntegrity(r, release); const resources = gradeResources(r); const cleanup = gradeCleanup(r, release);
    const window = gradeWindow(r, release);
    const reasons = [...integrity, ...resources, ...cleanup, ...gradeReadyTiming(r), ...window.reasons];
    const unexpected = r.events.filter(e => ["unexpected-context-state", "unexpected-track-ended", "unexpected-peer-state", "processor-error", "audio-health-failure", "media-fault"].includes(e.type));
    for (const event of unexpected) reasons.push(`lifecycle.${event.type}`);
    if (r.events.some(e => e.type === "media-fault")) reasons.push("lifecycle.media-fault");
    const need = (condition: boolean, code: string) => { if (!condition) reasons.push(code); };
    const up = r.sources.uplink; const down = r.sources.downlink;
    const boundaries = ["uplinkDecoded", "downlinkDecoded", "uplinkSource", "downlinkSource"].every(path => historyBoundariesValid(r, path as "uplinkDecoded" | "downlinkDecoded" | "uplinkSource" | "downlinkSource"));
    need(boundaries, "window.actual-latch-bin-boundaries");
    reasons.push(...gradeHistory(up, "uplink.source", null), ...gradeHistory(down, "downlink.source", null));
    reasons.push(...gradeHistory(r.decoded.uplink, "uplink.decoded", 400), ...gradeHistory(r.decoded.downlink, "downlink.decoded", 700));
    need(up.kind === "browser-generated-worklet" && up.origin?.tag.kind === "worklet-currentFrame" && up.id === r.binding.uplinkSourceId && up.senderDrivenCalls === null && up.unboundCalls === null && up.generatorErrors === 0 && up.total.frames > 0, "uplink.generated-source");
    need(down.kind === "server-independent-generator" && down.origin?.tag.kind === "generated-pts" && down.id === r.binding.downlinkSourceId && down.senderDrivenCalls !== null && Number.isSafeInteger(down.senderDrivenCalls) && down.senderDrivenCalls > 0 && down.unboundCalls === 0 && down.generatorErrors === 0 && down.total.frames > 0, "downlink.independent-sender");
    need(mappingValid(r.mappings.uplink, r.binding.uplinkSourceId, up.trackId, up.senderTrackId, false), "uplink.sender-receiver-mapping");
    need(mappingValid(r.mappings.downlink, r.binding.downlinkSourceId, down.trackId, down.senderTrackId, true), "downlink.sender-receiver-mapping");
    for (const [name, d] of Object.entries(r.decoded)) {
      need(d.id === (name === "uplink" ? "server-uplink-decoded" : "browser-downlink-monitor") && d.sourceId === (name === "uplink" ? r.binding.uplinkSourceId : r.binding.downlinkSourceId), `${name}.decoded.identity`);
      need(d.processorErrors === 0 && d.rejected === 0 && d.overflow === 0 && d.total.frames > 0 && d.format !== null && d.format.allChannelsChecked === true && d.format.projection === "channel-0", `${name}.decoded.function`);
      need(decodedMetadataValid(d, name === "uplink" ? r.binding.uplinkSourceId : r.binding.downlinkSourceId, name === "downlink"), `${name}.decoded.actual-rate-channels-clock-diagnostics`);
    }
    need(r.outcome === "completed" && r.reason === null, "outcome.not-completed");
    need(r.negative === null || r.mode !== "positive", "identity.unexpected-negative");
    if (r.mode === "remote-output-disconnected" && receiverFaultPrerequisite(r)) reasons.push("downlink.decoded.observed-output-disconnection");
    const negative = negativeGrade(r, release, reasons, integrity.length === 0 && resources.length === 0 && cleanup.length === 0 && unexpected.length === 0 && boundaries && existingControlsValid(r, release));
    const deduplicated = [...new Set(reasons)];
    return { functionalPass: r.mode === "positive" && deduplicated.length === 0, negative, reasons: deduplicated, coverage: window.coverage };
  } catch (error) {
    return { functionalPass: false, negative: r?.mode === "positive" ? null : { exercised: false, rejectedAsIntended: false }, reasons: [`schema.invalid-record: ${error instanceof Error ? error.message : "malformed evidence"}`], coverage: emptyCoverage() };
  }
}
