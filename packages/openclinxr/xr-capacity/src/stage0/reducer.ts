import type { ResourceCounts, Stage0Frame, Stage0Record, Stage0Release } from "./types.js";
import { sameProfile } from "./profile.js";
export function quantile(values: number[], q: number) { const sorted = values.slice().sort((a, b) => a - b); return sorted.length ? sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]! : null; }
export function median(values: number[]) { const sorted = values.slice().sort((a, b) => a - b); const m = Math.floor(sorted.length / 2); return sorted.length ? sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2 : null; }
export function determinant(a: ArrayLike<number>, o = 0) {
  const m = Array.from({ length: 16 }, (_, i) => a[o + i] ?? NaN);
  const [a0,a1,a2,a3,a4,a5,a6,a7,a8,a9,a10,a11,a12,a13,a14,a15] = m as [number,number,number,number,number,number,number,number,number,number,number,number,number,number,number,number];
  return a0*(a5*(a10*a15-a11*a14)-a9*(a6*a15-a7*a14)+a13*(a6*a11-a7*a10))-a4*(a1*(a10*a15-a11*a14)-a9*(a2*a15-a3*a14)+a13*(a2*a11-a3*a10))+a8*(a1*(a6*a15-a7*a14)-a5*(a2*a15-a3*a14)+a13*(a2*a7-a3*a6))-a12*(a1*(a6*a11-a7*a10)-a5*(a2*a11-a3*a10)+a9*(a2*a7-a3*a6));
}
export function validPose(frame: Pick<Stage0Frame, "head" | "viewCount" | "viewMatrices">) {
  if (frame.viewCount !== 2 || frame.head.length !== 7 || frame.viewMatrices.length !== 64 || ![...frame.head, ...frame.viewMatrices].every(Number.isFinite)) return false;
  const norm = Math.hypot(...frame.head.slice(3));
  return norm > .99 && norm < 1.01 && [0, 16, 32, 48].every(o => Math.abs(determinant(frame.viewMatrices, o)) > 1e-8);
}
function sameCounts(a: ResourceCounts | null, b: ResourceCounts | null) { return !!a && !!b && ["geometries", "textures", "programs"].every(k => a[k as keyof ResourceCounts] === b[k as keyof ResourceCounts]); }
export function pacing(receipts: number[], targetHz: number) {
  const intervals = receipts.slice(1).map((at, i) => at - receipts[i]!); const valid = receipts.length >= 2 && receipts.every(Number.isFinite) && intervals.every(dt => Number.isFinite(dt) && dt > 0) && Number.isFinite(targetHz) && targetHz > 0;
  if (!valid) return { valid: false, intervals, p95: null, median: null, maximum: null, observed: intervals.length, gapDeficit: null, cumulativeExpected: null, globalDeficit: null, E: null, denominator: null, estimatedMissedFraction: null, receiptCoverageRatio: null };
  const T = 1000 / targetHz; const observed = intervals.length; const gapDeficit = intervals.reduce((n, dt) => n + Math.max(0, Math.floor(dt / T + .5) - 1), 0); const cumulativeExpected = Math.floor((receipts.at(-1)! - receipts[0]!) / T + .5); const globalDeficit = Math.max(0, cumulativeExpected - observed); const E = Math.max(gapDeficit, globalDeficit);
  return { valid, intervals, p95: quantile(intervals, .95), median: median(intervals), maximum: Math.max(...intervals), observed, gapDeficit, cumulativeExpected, globalDeficit, E, denominator: observed + E, estimatedMissedFraction: E / (observed + E), receiptCoverageRatio: cumulativeExpected > 0 ? observed / cumulativeExpected : null };
}
export function gradeRun(record: Stage0Record, release: Stage0Release) {
  const rows = record.frames.filter(f => f.phase === 2); const cpu = rows.map(f => f.updateMs + f.submissionMs); const target = record.profile?.selectedTargetHz ?? NaN; const T = 1000 / target; const cadence = pacing(rows.map(f => f.receipt), target); const reasons: string[] = [];
  const require = (ok: boolean, why: string) => { if (!ok) reasons.push(why); };
  require(record.purpose === "cohort" && record.status === "completed", "cohort-incomplete-or-censored"); require(record.releaseId === release.releaseId, "release-id-mismatch");
  require(["bundleSha256", "protocolSha256", "sceneManifestSha256"].every(k => record.identity[k as keyof typeof record.identity] === release.identity[k as keyof typeof release.identity] && /^[a-f0-9]{64}$/.test(String(release.identity[k as keyof typeof release.identity]))), "source-identity-mismatch");
  require(!!record.profile && sameProfile(record.profile, release.profile), "profile-mismatch"); require(rows.length >= 2 && rows.length <= 12000 && !record.storage.overflow && !record.storage.released, "missing-or-censored-samples");
  require(record.storage.retainedFrames === record.frames.length && record.frames.every((f, i) => [0,1,2,3].includes(f.phase) && Number.isFinite(f.receipt) && Number.isFinite(f.xrTimestamp) && (i === 0 || (f.phase >= record.frames[i-1]!.phase && f.receipt > record.frames[i-1]!.receipt && f.xrTimestamp > record.frames[i-1]!.xrTimestamp && f.stateFrame === record.frames[i-1]!.stateFrame + 1))), "lifecycle-or-retained-row-accounting");
  require(record.admittedAt !== null && Number.isFinite(record.admittedAt) && record.watchdogDeadline === record.admittedAt + 90000 && record.warmupStart !== null && Number.isFinite(record.warmupStart) && record.warmupStart >= record.admittedAt && record.sampleEnd !== null && record.sampleEnd <= record.watchdogDeadline, "session-clock-or-watchdog-invalid");
  require(record.sampleStart === rows[0]?.receipt && record.sampleEnd === rows.at(-1)?.receipt && (record.sampleEnd ?? 0) - (record.sampleStart ?? Infinity) >= 60000, "incomplete-window");
  require(cadence.valid && rows.every((f, i) => Number.isFinite(f.xrTimestamp) && (i === 0 || f.xrTimestamp > rows[i - 1]!.xrTimestamp)), "invalid-clock");
  require(rows.every((f, i) => f.poseValid && validPose(f) && f.presenting && f.visible && !f.contextLost && f.renderCalls === 8 * f.viewCount && f.triangles === 46 * f.viewCount && (i === 0 || f.stateFrame === rows[i - 1]!.stateFrame + 1)), "invalid-pose-flat-or-content");
  require(rows.length > 0 && rows.every(f => f.programs === record.resources.roomWarm?.programs && f.geometries === record.resources.roomWarm?.geometries && f.textures === record.resources.roomWarm?.textures), "program-or-resource-changed-in-window"); require(cpu.length > 0 && rows.every(f => [f.updateMs, f.submissionMs, f.collectorMs, f.observedBodyMs].every(n => Number.isFinite(n) && n >= 0)), "invalid-cpu-spans");
  require([record.proofs.preview, record.proofs.afterSample].every(p => p !== null && p.reason === null && p.source === "active-XR-resolved-render-target-untimed" && p.nonBackgroundPixels >= Math.max(16, .01 * p.testedPixels) && p.nonBackgroundPixels <= p.testedPixels && p.testedPixels > 0 && p.testedPixels <= 57600 && Number.isFinite(p.xrTimestamp) && !!p.image && p.image.startsWith("data:image/png;base64,") && p.image.length <= 600000), "visible-scene-proof-missing");
  const before = record.frames.filter(f => f.phase === 0); const after = record.frames.filter(f => f.phase === 3);
  require([before, after].every(pass => pass.length === 60 && pass.at(-1)!.receipt - pass[0]!.receipt <= 5000 && pass.every(f => f.poseValid && validPose(f) && f.presenting && f.visible && !f.contextLost && f.renderCalls === 0 && f.triangles === 0)), "empty-pass-incomplete-or-invalid");
  require(record.warmupStart !== null && record.sampleStart !== null && record.sampleStart - record.warmupStart >= 10000 && record.frames.some(f => f.phase === 1 && f.receipt === record.warmupStart), "warmup-incomplete");
  require(record.resources.ownerBefore === 8 && !!record.resources.roomWarm && record.resources.roomWarm.geometries === release.emptyBaseline.geometries + 3 && record.resources.roomWarm.textures === release.emptyBaseline.textures && record.resources.roomWarm.programs === release.emptyBaseline.programs + 1, "source-room-resource-contract");
  require(sameCounts(record.resources.emptyBefore, release.emptyBaseline) && sameCounts(record.resources.emptyAfter, release.emptyBaseline) && record.resources.ownerAfter === 0 && record.cleanup.roomResourcesDisposed, "resource-recovery-failed");
  require(record.cleanup.sessionEnded && record.cleanup.rendererDisposed && record.cleanup.layerStable && record.cleanup.workloadListeners === 0 && record.cleanup.workloadTimers === 0 && record.cleanup.queries === 0 && record.cleanup.controlListeners === 0 && record.cleanup.controlTimers === 0 && record.cleanup.animationCallbacks === 0 && record.failureReasons.length === 0, "cleanup-or-failure");
  const cpuP95 = cpu.every(Number.isFinite) ? quantile(cpu, .95) : null;
  const performancePass = cadence.valid && cadence.p95! <= 1.25*T && cadence.estimatedMissedFraction! <= .01 && cadence.maximum! <= 3*T;
  return { valid: reasons.length === 0, reasons, performancePass, candidatePass: reasons.length === 0 && performancePass, cadence, cpuP95, cpuAdvisoryMet: cpuP95 !== null && cpuP95 <= .25*T, cpuZerosQuantized: rows.some(f => f.updateMs === 0 || f.submissionMs === 0), targetHz: target };
}
export function gradeCohort(records: Stage0Record[], release: Stage0Release) {
  const runs = records.map(r => gradeRun(r, release)); const T = 1000 / release.profile.selectedTargetHz; const spread = (v: number[]) => v.length ? Math.max(...v) - Math.min(...v) : Infinity;
  const cpu = runs.map(r => r.cpuP95 ?? Infinity); const intervalMedianSpread = spread(runs.map(r => r.cadence.median ?? Infinity)); const intervalP95Spread = spread(runs.map(r => r.cadence.p95 ?? Infinity)); const cpuP95Spread = spread(cpu); const cpuLimit = Math.max(.25, .25 * (median(cpu) ?? Infinity));
  return { candidatePass: runs.length === 3 && new Set(records.map(r => r.identity.nonce)).size === 3 && runs.every(r => r.candidatePass) && intervalMedianSpread <= .05*T && intervalP95Spread <= .10*T && cpuP95Spread <= cpuLimit, runs, intervalMedianSpread, intervalP95Spread, cpuP95Spread, cpuP95SpreadLimit: cpuLimit, interpretation: "Engineering callback/profile repeatability policy; not compositor FPS, native GPU capacity or physical readiness." };
}
