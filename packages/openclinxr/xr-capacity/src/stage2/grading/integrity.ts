import { STAGE2_CONFIG, STAGE2_PROTOCOL_SHA256 } from "./config.js";
import { isCount, positive } from "./health.js";
import type { Stage2Envelope, Stage2RunRecord, Stage2RunRelease, Stage2SelectedPair, Stage2TrackMapping } from "./types.js";

const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, item]) => `${JSON.stringify(k)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(v) ?? "undefined";
};
export const exact = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export const envelopeMatches = (a: Stage2Envelope, b: Stage2Envelope) => exact(a.identity, b.identity) && exact(a.binding, b.binding);
const known = (s: string) => typeof s === "string" && s.length > 0 && !/^(unknown|unavailable)$/i.test(s);
function pathValid(pair: Stage2SelectedPair | null, r: Stage2RunRecord, observer: Stage2SelectedPair["observer"]): boolean {
  if (!pair || pair.observer !== observer || pair.nominated !== true || pair.state !== "succeeded" || !known(pair.id) || !known(pair.observationSource)) return false;
  return [pair.local, pair.remote].every(e => e.address !== null && e.inventoryAddress === e.address && r.environment.localInterfaces.some(i => i.address === e.address) && e.port !== null && isCount(e.port) && e.port > 0 && e.port <= 65535 && (e.protocol === "udp" || e.protocol === "tcp"));
}
export function mappingValid(m: Stage2TrackMapping | null, sourceId: string, sourceTrackId: string | null, senderTrackId: string | null, monitored: boolean): boolean {
  return m !== null && m.sourceId === sourceId && sourceTrackId !== null && senderTrackId !== null
    && m.sourceTrackId === sourceTrackId && m.senderTrackId === senderTrackId && known(m.receiverTrackId)
    && m.senderBindingObserved === true && m.receiverBindingObserved === true
    && m.senderMid !== null && m.senderMid === m.receiverMid && m.receiverSdpTrackId !== null
    && m.senderSsrc !== null && isCount(m.senderSsrc) && m.senderSsrc > 0 && m.senderSsrc === m.receiverSsrc
    && (!monitored || m.monitoredTrackId === m.receiverTrackId)
    && m.codec !== null && m.codec.mimeType.toLowerCase() === "audio/opus" && m.codec.clockRate === 48000
    && m.codec.channels !== null && isCount(m.codec.channels) && m.codec.channels > 0 && m.codec.payloadType !== null && isCount(m.codec.payloadType);
}
export function gradeIntegrity(r: Stage2RunRecord, release: Stage2RunRelease): string[] {
  const reasons: string[] = []; const need = (c: boolean, k: string) => { if (!c) reasons.push(k); };
  need(r.schema === "quest-stage2-host-run.v1" && release.schema === "quest-stage2-host-release.v1", "identity.schema");
  need(envelopeMatches(r, release) && r.mode === release.mode, "identity.release");
  need(["browserBundleSha256", "serverSourceSha256", "protocolSha256", "fixtureConfigSha256", "graderSourceSha256"].every(key => { const value = Object.entries(r.identity).find(([name]) => name === key)?.[1]; return typeof value === "string" && /^(sha256:)?[a-f0-9]{64}$/.test(value); }) && r.identity.protocolSha256 === STAGE2_PROTOCOL_SHA256, "identity.hashes");
  need([r.binding.runNonce, r.binding.peerTicket, r.binding.uplinkSourceId, r.binding.downlinkSourceId].every(known) && r.binding.uplinkSourceId !== r.binding.downlinkSourceId, "identity.binding");
  need(exact(r.environment, release.expectedEnvironment), "identity.environment");
  const e = r.environment;
  need(known(e.browser.executablePath) && known(e.browser.version) && Number.isFinite(e.browser.timeOriginMs) && Array.isArray(e.browser.launchFlags), "environment.browser");
  need(isCount(e.driver.processId) && e.driver.processId > 0 && known(e.driver.clockId) && Number.isFinite(e.driver.timeOriginMs), "environment.driver-clock");
  need([e.runtime.nodeVersion, e.runtime.pythonVersion, e.runtime.aiortcVersion, e.runtime.avVersion, e.runtime.aiohttpVersion, e.runtime.serverClockId].every(known) && isCount(e.runtime.serverProcessId) && e.runtime.serverProcessId > 0, "environment.runtime");
  need(Array.isArray(e.iceServers) && e.iceServers.length === 0 && e.signalingOrigins.length > 0 && e.signalingOrigins.every(origin => { const u = new URL(origin); return u.hostname === "127.0.0.1" && (u.protocol === "http:" || u.protocol === "https:"); }), "environment.local-only-config");
  need(pathValid(r.connection.browserPair, r, "browser-getStats") && pathValid(r.connection.serverPair, r, "server-ice-transport"), "connection.selected-own-host-path");
  const b = r.connection.browserPair; const s = r.connection.serverPair;
  need(b !== null && s !== null && b.local.address === s.remote.address && b.remote.address === s.local.address && b.local.port === s.remote.port && b.remote.port === s.local.port && b.local.protocol === s.remote.protocol && b.remote.protocol === s.local.protocol, "connection.matching-endpoints");
  need(["connected", "completed"].includes(r.connection.iceState) && r.connection.dtlsState === "connected", "connection.established");
  need(Array.isArray(r.notEvidenceFor) && r.notEvidenceFor.length > 0 && r.notEvidenceFor.every(known), "identity.scope-exclusions");
  return reasons;
}
export function gradeResources(r: Stage2RunRecord): string[] {
  const x = r.resources; const reasons: string[] = []; const need = (c: boolean, k: string) => { if (!c) reasons.push(`resources.${k}`); };
  const sums = { "typed-health": 0, "known-payload": 0, control: 0 };
  need(Array.isArray(x.ledger) && x.ledger.length > 0, "ledger-present");
  for (const item of x.ledger) {
    need(isCount(item.count) && isCount(item.itemBytes) && Number.isSafeInteger(item.count * item.itemBytes) && known(item.owner) && known(item.description) && Object.hasOwn(sums, item.kind), "ledger-dimensions");
    sums[item.kind] += item.count * item.itemBytes;
  }
  need(isCount(x.typedHealthBytes) && isCount(x.knownPendingPayloadBytes) && isCount(x.ownedControlBytes) && sums["typed-health"] === x.typedHealthBytes && sums["known-payload"] === x.knownPendingPayloadBytes && sums.control === x.ownedControlBytes, "ledger-recount");
  need(x.capBytes === STAGE2_CONFIG.bounds.maximumOwnedTypedAndKnownPayloadBytes && x.typedHealthBytes + x.knownPendingPayloadBytes + x.ownedControlBytes <= x.capBytes, "memory-cap");
  need(x.healthRows.uplink === r.decoded.uplink.bins.length && x.healthRows.downlink === r.decoded.downlink.bins.length && x.healthRows.uplinkSource === r.sources.uplink.bins.length && x.healthRows.downlinkSource === r.sources.downlink.bins.length && Object.values(x.healthRows).every(n => isCount(n) && n <= 512), "health-row-recount");
  need(isCount(x.maximumConcurrentControls) && x.maximumConcurrentControls <= 4 && isCount(x.maximumQueuedControlBytes) && x.maximumQueuedControlBytes <= 262144, "control-bounds");
  need(x.dropped === 0 && x.rejected === 0 && x.overflow === 0 && x.rawPcmRetainedBytes === 0 && x.totalHeapMeasured === false, "loss-unknown-memory");
  for (const owner of ["browser", "python", "gateway"] as const) {
    const audit = x.ownerReservations?.[owner];
    need(audit !== null && audit !== undefined, `${owner}-reservation-present`);
    if (!audit) continue;
    need(audit.limitBytes === STAGE2_CONFIG.bounds.ownerReservationBytes[owner], `${owner}-reservation-fixed-limit`);
    need(isCount(audit.peakBytes) && audit.peakBytes > 0 && audit.peakBytes <= audit.limitBytes && isCount(audit.heldBytesAtClose) && audit.heldBytesAtClose <= audit.peakBytes, `${owner}-reservation-counts`);
    need(audit.closed === true && audit.rejectedReservations === 0, `${owner}-reservation-closed-no-refusal`);
    need(audit.categoryPeaks !== null && typeof audit.categoryPeaks === "object" && !Array.isArray(audit.categoryPeaks) && Object.entries(audit.categoryPeaks).every(([name, bytes]) => known(name) && isCount(bytes) && bytes <= audit.peakBytes), `${owner}-reservation-categories`);
    need(audit.peakBytes === 0 || Object.values(audit.categoryPeaks).reduce((a, b) => a + b, 0) >= audit.peakBytes, `${owner}-reservation-category-coverage`);
  }
  return reasons;
}
export function gradeCleanup(r: Stage2RunRecord, release: Stage2RunRelease): string[] {
  const c = r.cleanup; const a = c.serverClose; const t = r.lifecycle;
  const reasons: string[] = []; const need = (condition: boolean, code: string) => { if (!condition) reasons.push(`cleanup.${code}`); };
  const ownershipKeys = ["peers", "tracks", "generators", "nodes", "ports", "contexts", "listeners", "timers", "pendingCommands"] as const;
  need(c.browserDrained === true && ownershipKeys.every(k => c.browserRemaining[k] === 0), "browser-zero");
  need(a !== null && a.closed === true && envelopeMatches(a, release) && a.serverClockId === r.environment.runtime.serverClockId && Number.isFinite(a.atServerMs) && [a.activePeers, a.closingPeers, a.ownedTasks, a.queuedControlBytes, a.pendingControls].every(n => n === 0), "matching-server-zero-ack");
  need(c.driver.confirmed === true && c.driver.ownedProcesses === 0 && c.driver.ownedListeners === 0, "driver-zero");
  need(c.closeSentMs !== null && c.closeReceivedMs !== null && t.contextClosedMs !== null && c.closeReceivedMs >= c.closeSentMs && t.contextClosedMs >= c.closeSentMs && Math.max(c.closeReceivedMs, t.contextClosedMs) - c.closeSentMs <= 5000, "bounded-browser-drain");
  need(t.contextClosedMs !== null && Number.isFinite(t.contextCreatedMs) && t.contextClosedMs >= t.contextCreatedMs && t.contextClosedMs - t.contextCreatedMs <= 150000, "context-lifetime");
  need(t.peerAllocatedServerMs !== null && t.peerClosedServerMs !== null && t.peerClosedServerMs >= t.peerAllocatedServerMs && t.peerClosedServerMs - t.peerAllocatedServerMs <= 150000 && a !== null && a.atServerMs === t.peerClosedServerMs, "peer-lifetime");
  need(t.driverEndedMs !== null && Number.isFinite(t.driverStartedMs) && t.driverEndedMs >= t.driverStartedMs && t.driverEndedMs - t.driverStartedMs <= 165000, "driver-lifetime");
  need(r.sources.uplink.stopped === true && r.sources.downlink.stopped === true, "sources-stopped");
  return reasons;
}
export function gradeReadyTiming(r: Stage2RunRecord): string[] {
  const t = r.lifecycle;
  if (t.readyMs === null || t.warmupStartedMs === null || t.warmupEndedMs === null || r.clientWindow.startMs === null) return ["timing.setup-warmup-missing"];
  const ok = Number.isFinite(t.contextCreatedMs) && t.readyMs >= t.contextCreatedMs && t.readyMs - t.contextCreatedMs <= 20000 && t.warmupStartedMs >= t.readyMs && t.warmupEndedMs - t.warmupStartedMs >= 10000 && r.clientWindow.startMs >= t.warmupEndedMs;
  return ok ? [] : ["timing.setup-warmup-bounds"];
}
export const actualDecoded = (frames: number, nonzero: number) => positive(frames) && positive(nonzero);
