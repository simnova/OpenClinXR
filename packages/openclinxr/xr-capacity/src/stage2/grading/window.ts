import { STAGE2_PHASE_FOR_COMMAND } from "./config.js";
import { positionValid, qualifiedRangeMatches, tagSeconds } from "./health.js";
import { envelopeMatches } from "./integrity.js";
import type { Stage2AudioPosition, Stage2Latch, Stage2MarkExchange, Stage2RunRecord, Stage2RunRelease } from "./types.js";

export interface Stage2Coverage { clientMs: number; uplinkDecodedSeconds: number; downlinkDecodedSeconds: number; uplinkSourceSeconds: number; downlinkSourceSeconds: number }
export type Stage2Path = "uplinkDecoded" | "downlinkDecoded" | "uplinkSource" | "downlinkSource";
export function latch(mark: Stage2MarkExchange | undefined, path: Stage2Path): Stage2Latch | null {
  if (!mark) return null;
  if (path === "uplinkDecoded") return mark.server.ack?.uplinkDecoded ?? null;
  if (path === "downlinkSource") return mark.server.ack?.downlinkSource ?? null;
  if (path === "uplinkSource") return mark.browser.ack?.uplinkSource ?? null;
  return mark.browser.ack?.downlinkMonitor ?? null;
}
export function positionDelta(start: Stage2AudioPosition | null, end: Stage2AudioPosition | null): number {
  if (!start || !end || !positionValid(start) || !positionValid(end) || start.sampleRate !== end.sampleRate || start.channels !== end.channels || end.processedFrames < start.processedFrames) return 0;
  return (end.processedFrames - start.processedFrames) / start.sampleRate;
}
export function within(position: Stage2AudioPosition, origin: Stage2AudioPosition | null, final: Stage2AudioPosition | null): boolean {
  return origin !== null && final !== null && positionValid(position) && position.sampleRate === origin.sampleRate && position.channels === origin.channels && position.processedFrames >= origin.processedFrames && position.processedFrames <= final.processedFrames && position.tag.kind === origin.tag.kind && position.tag.timeBaseNumerator === origin.tag.timeBaseNumerator && position.tag.timeBaseDenominator === origin.tag.timeBaseDenominator && Math.abs((tagSeconds(position.tag) - tagSeconds(origin.tag)) * origin.sampleRate - position.processedFrames) <= 1e-5;
}
/** Missing exchanges can be the expected fault; present exchanges must never borrow another run/clock. */
export function existingControlsValid(r: Stage2RunRecord, release: Stage2RunRelease): boolean {
  const histories = { uplinkDecoded: r.decoded.uplink, downlinkDecoded: r.decoded.downlink, uplinkSource: r.sources.uplink, downlinkSource: r.sources.downlink };
  return r.marks.length <= 4 && new Set(r.marks.map(m => m.command)).size === r.marks.length && new Set(r.marks.map(m => m.markerId)).size === r.marks.length && r.marks.every(m => {
    const a = m.server.ack; const b = m.browser.ack;
    if (a !== null && (!envelopeMatches(a, release) || a.serverClockId !== r.environment.runtime.serverClockId || a.markerId !== m.markerId || a.command !== m.command || !Number.isFinite(a.serverAtMs))) return false;
    if (b !== null && (b.markerId !== m.markerId || b.command !== m.command)) return false;
    if (![m.server, m.browser].every(part => Number.isFinite(part.sentMs) && part.sentMs >= r.lifecycle.contextCreatedMs && (part.receivedMs === null || Number.isFinite(part.receivedMs) && part.receivedMs >= part.sentMs && r.cleanup.closeSentMs !== null && part.receivedMs <= r.cleanup.closeSentMs))) return false;
    return (Object.keys(histories) as Stage2Path[]).every(path => {
      const l = latch(m, path); const h = histories[path];
      return l === null || l.markerId === m.markerId && l.command === m.command && l.phase === STAGE2_PHASE_FOR_COMMAND[m.command] && within(l.position, h.origin, h.final);
    });
  });
}
/** Partial cuts and phase labels are earned by this exact path's actual latches, never by a producer label. */
export function historyBoundariesValid(r: Stage2RunRecord, path: Stage2Path): boolean {
  const h = path === "uplinkDecoded" ? r.decoded.uplink : path === "downlinkDecoded" ? r.decoded.downlink : path === "uplinkSource" ? r.sources.uplink : r.sources.downlink;
  const applied = r.marks.flatMap(m => { const l = latch(m, path); return l ? [l] : []; });
  return h.bins.every(b => {
    let phase: Stage2Latch["phase"] = "setup";
    for (const l of applied) if (l.position.processedFrames <= b.frameStart) phase = l.phase;
    if (b.phase !== phase) return false;
    if (b.partialReason !== "phase-boundary") return true;
    return applied.some(l => l.position.processedFrames === b.frameEnd);
  });
}
/** The early-close negative must first earn the same readiness, full warmup and START admission as a positive. */
export function prequalifiedConditionsValid(r: Stage2RunRecord): boolean {
  const t = r.lifecycle; const client = r.clientWindow.startMs;
  if (client === null || t.readyMs === null || t.warmupStartedMs === null || t.warmupEndedMs === null || !Number.isFinite(t.contextCreatedMs) || t.readyMs < t.contextCreatedMs || t.readyMs - t.contextCreatedMs > 20000 || t.warmupStartedMs < t.readyMs || t.warmupEndedMs - t.warmupStartedMs < 10000 || client < t.warmupEndedMs) return false;
  const ready = r.marks.find(m => m.command === "ready"); const warmup = r.marks.find(m => m.command === "warmup"); const start = r.marks.find(m => m.command === "start");
  if (!ready || !warmup || !start || !ready.server.ack || !warmup.server.ack || !start.server.ack) return false;
  if (![ready.server, ready.browser].every(p => p.receivedMs !== null && p.receivedMs <= (t.readyMs ?? -Infinity)) || ![warmup.server, warmup.browser].every(p => p.receivedMs !== null && p.receivedMs <= (t.warmupStartedMs ?? -Infinity)) || ![start.server, start.browser].every(p => p.receivedMs !== null && p.receivedMs <= client && p.sentMs >= (t.warmupEndedMs ?? Infinity))) return false;
  if (ready.server.ack.serverAtMs > warmup.server.ack.serverAtMs || warmup.server.ack.serverAtMs > start.server.ack.serverAtMs) return false;
  for (const path of ["uplinkDecoded", "downlinkDecoded", "uplinkSource", "downlinkSource"] as const) {
    const a = latch(ready, path); const b = latch(warmup, path); const c = latch(start, path);
    if (!a || !b || !c || a.position.processedFrames > b.position.processedFrames || b.position.processedFrames > c.position.processedFrames) return false;
  }
  const u = r.decoded.uplink; const d = r.decoded.downlink;
  return u.firstNonzeroAtLocalMs !== null && u.firstDecodedAtLocalMs !== null && u.firstDecodedAtLocalMs <= u.firstNonzeroAtLocalMs && u.firstNonzeroAtLocalMs <= ready.server.ack.serverAtMs && d.firstNonzeroAtLocalMs !== null && d.firstDecodedAtLocalMs !== null && d.firstDecodedAtLocalMs <= d.firstNonzeroAtLocalMs && ready.browser.receivedMs !== null && d.firstNonzeroAtLocalMs <= ready.browser.receivedMs;
}
export function gradeWindow(r: Stage2RunRecord, release: Stage2RunRelease): { reasons: string[]; coverage: Stage2Coverage } {
  const reasons: string[] = []; const need = (c: boolean, k: string) => { if (!c) reasons.push(`window.${k}`); };
  const start = r.marks.find(m => m.command === "start"); const end = r.marks.find(m => m.command === "end");
  const paths = ["uplinkDecoded", "downlinkDecoded", "uplinkSource", "downlinkSource"] as const;
  const histories = { uplinkDecoded: r.decoded.uplink, downlinkDecoded: r.decoded.downlink, uplinkSource: r.sources.uplink, downlinkSource: r.sources.downlink };
  const coverage: Stage2Coverage = {
    clientMs: r.clientWindow.startMs !== null && r.clientWindow.terminalMs !== null ? r.clientWindow.terminalMs - r.clientWindow.startMs : 0,
    uplinkDecodedSeconds: positionDelta(latch(start, "uplinkDecoded")?.position ?? null, latch(end, "uplinkDecoded")?.position ?? null),
    downlinkDecodedSeconds: positionDelta(latch(start, "downlinkDecoded")?.position ?? null, latch(end, "downlinkDecoded")?.position ?? null),
    uplinkSourceSeconds: positionDelta(latch(start, "uplinkSource")?.position ?? null, latch(end, "uplinkSource")?.position ?? null),
    downlinkSourceSeconds: positionDelta(latch(start, "downlinkSource")?.position ?? null, latch(end, "downlinkSource")?.position ?? null),
  };
  need(Number.isFinite(coverage.clientMs) && coverage.clientMs >= 70000, "client-70000ms");
  need(r.marks.length === 4 && new Set(r.marks.map(m => m.markerId)).size === 4 && ["ready", "warmup", "start", "end"].every((command, index) => r.marks[index]?.command === command), "four-unique-commands");
  for (const m of r.marks) {
    const ack = m.server.ack;
    need(typeof m.markerId === "string" && m.markerId.length > 0 && ack !== null && envelopeMatches(ack, release) && ack.markerId === m.markerId && ack.command === m.command && ack.serverClockId === r.environment.runtime.serverClockId && Number.isFinite(ack.serverAtMs), `server-${m.command}-identity`);
    need(m.browser.ack !== null && m.browser.ack.markerId === m.markerId && m.browser.ack.command === m.command, `browser-${m.command}-identity`);
    need([m.server, m.browser].every(part => Number.isFinite(part.sentMs) && part.receivedMs !== null && Number.isFinite(part.receivedMs) && part.receivedMs >= part.sentMs && part.sentMs >= r.lifecycle.contextCreatedMs && r.cleanup.closeSentMs !== null && part.receivedMs <= r.cleanup.closeSentMs), `causal-${m.command}-ack`);
    for (const path of paths) {
      const l = latch(m, path); const h = histories[path];
      need(l !== null && l.markerId === m.markerId && l.command === m.command && l.phase === STAGE2_PHASE_FOR_COMMAND[m.command] && within(l.position, h.origin, h.final), `${path}-${m.command}-latch`);
    }
  }
  need(start !== undefined && r.clientWindow.startMs !== null && [start.server, start.browser].every(p => p.receivedMs !== null && p.receivedMs <= (r.clientWindow.startMs ?? -Infinity)), "start-acks-before-client");
  need(end !== undefined && r.clientWindow.terminalMs !== null && [end.server, end.browser].every(p => p.sentMs >= (r.clientWindow.terminalMs ?? Infinity)), "end-sent-after-client");
  for (const path of paths) {
    const a = latch(start, path)?.position; const b = latch(end, path)?.position; const h = histories[path];
    need(a !== undefined && b !== undefined && positionDelta(a, b) >= 70, `${path}-70000ms-in-phase`);
    need(a !== undefined && b !== undefined && qualifiedRangeMatches(h.bins, a, b), `${path}-qualified-bin-boundaries`);
    let frontier = -1;
    for (const command of ["ready", "warmup", "start", "end"]) {
      const mark = r.marks.find(m => m.command === command); const p = latch(mark, path)?.position;
      need(p !== undefined && p.processedFrames >= frontier, `${path}-ordered-${command}`);
      if (p) frontier = p.processedFrames;
    }
  }
  const ready = r.marks.find(m => m.command === "ready");
  const warmup = r.marks.find(m => m.command === "warmup");
  need(warmup !== undefined && r.lifecycle.warmupStartedMs !== null && [warmup.server, warmup.browser].every(part => part.receivedMs !== null && part.receivedMs <= (r.lifecycle.warmupStartedMs ?? -Infinity)), "warmup-after-both-acks");
  need(start !== undefined && r.lifecycle.warmupEndedMs !== null && [start.server, start.browser].every(part => part.sentMs >= (r.lifecycle.warmupEndedMs ?? Infinity)), "start-after-warmup");
  const u = r.decoded.uplink; const d = r.decoded.downlink;
  need(ready?.server.ack !== null && ready?.server.ack !== undefined && u.firstNonzeroAtLocalMs !== null && u.firstDecodedAtLocalMs !== null && u.firstDecodedAtLocalMs <= u.firstNonzeroAtLocalMs && u.firstNonzeroAtLocalMs <= ready.server.ack.serverAtMs, "uplink-ready-actual-nonzero");
  need(ready?.browser.receivedMs !== null && ready?.browser.receivedMs !== undefined && d.firstNonzeroAtLocalMs !== null && d.firstDecodedAtLocalMs !== null && d.firstDecodedAtLocalMs <= d.firstNonzeroAtLocalMs && d.firstNonzeroAtLocalMs <= ready.browser.receivedMs, "downlink-ready-actual-nonzero");
  need(ready !== undefined && r.lifecycle.readyMs !== null && [ready.server, ready.browser].every(p => p.receivedMs !== null && p.receivedMs <= (r.lifecycle.readyMs ?? -Infinity)), "ready-after-both-acks");
  return { reasons, coverage };
}
