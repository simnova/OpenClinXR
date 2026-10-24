import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeSession } from "../entrypoints/stage0.js";
import { xrPixelProof } from "../entrypoints/stage0.js";
import { createRecord } from "../entrypoints/stage0.js";
import { gradeCohort, gradeRun } from "../entrypoints/stage0.js";
import type { Stage0Frame, Stage0Metadata, Stage0Profile, Stage0Record, Stage0Release } from "../entrypoints/stage0.js";
const hash = 'a'.repeat(64);
const metadata: Stage0Metadata = { bundleSha256: hash, protocolSha256: hash, sceneManifestSha256: hash, nonce: 'unique-session-nonce-1', protocol: {}, foveationRequested: 1, rendererVersion: '0.184.0', sourceFiles: {} };
const profile: Stage0Profile = { selectedTargetHz: 90, targetSelection: 'target-update-accepted', rawSessionFrameRate: 0, actualSessionFrameRate: null, supportedFrameRates: [72, 90], layerKind: 'XRProjectionLayer', layerWidth: 3360, layerHeight: 1760, viewports: [[0, 0, 1680, 1760], [1680, 0, 1680, 1760]], foveationRequested: 1, foveationReadback: 1, framebufferScaleRequested: 1, contextAttributes: { antialias: true }, configuredSamples: 4, boundFramebufferSamples: 4, enabledFeatures: ['local-floor', 'viewer'], availabilityMask: ['actualSessionFrameRate'] };
const release: Stage0Release = { releaseId: 'release-1', identity: { bundleSha256: hash, protocolSha256: hash, sceneManifestSha256: hash }, profile, emptyBaseline: { geometries: 0, textures: 0, programs: 0 } };
const matrix = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function fixture(): Stage0Record {
  const r = createRecord(metadata, 'cohort').record; r.releaseId = release.releaseId; r.status = 'completed'; r.phase = 'completed'; r.profile = structuredClone(profile); r.warmupStart = 1000; r.sampleStart = 11000; r.sampleEnd = 71000; r.admittedAt = 0; r.watchdogDeadline = 90000;
  const row = (receipt: number, phase: number): Stage0Frame => ({ receipt, xrTimestamp: receipt + 5, phase, updateMs: .1, submissionMs: .2, collectorMs: .1, observedBodyMs: .5, poseValid: true, viewCount: 2, presenting: true, visible: true, contextLost: false, renderCalls: phase === 0 || phase === 3 ? 0 : 16, triangles: phase === 0 || phase === 3 ? 0 : 92, programs: phase === 0 || phase === 3 ? 0 : 1, geometries: phase === 0 || phase === 3 ? 0 : 3, textures: 0, stateFrame: 0, head: [0, 1.6, 0, 0, 0, 0, 1], viewMatrices: [...matrix, ...matrix, ...matrix, ...matrix] });
  r.frames = [...Array.from({ length: 60 }, (_, i) => row(i * 1000 / 90, 0)), row(1000, 1), ...Array.from({ length: 5401 }, (_, i) => row(11000 + i * 1000 / 90, 2)), ...Array.from({ length: 60 }, (_, i) => row(72000 + i * 1000 / 90, 3))]; r.frames.forEach((f, i) => { f.stateFrame = i + 1; }); r.storage.retainedFrames = r.frames.length;
  r.resources = { emptyBefore: { ...release.emptyBaseline }, roomWarm: { geometries: 3, textures: 0, programs: 1 }, emptyAfter: { ...release.emptyBaseline }, ownerBefore: 8, ownerAfter: 0 };
  const proof = { at: 72000, source: 'active-XR-resolved-render-target-untimed', xrTimestamp: 72000, viewport: [0, 0, 1680, 1760], nonBackgroundPixels: 5000, testedPixels: 57600, image: 'data:image/png;base64,fixture', reason: null };
  r.proofs = { preview: { ...proof, at: 999 }, afterSample: proof }; r.cleanup = { sessionEnded: true, rendererDisposed: true, workloadListeners: 0, workloadTimers: 0, controlListeners: 0, controlTimers: 0, animationCallbacks: 0, queries: 0, layerStable: true, roomResourcesDisposed: true }; return r;
}
// Exercise cadence and quantiles through the supported run-grade result, retaining invalid rows.
function pacing(receipts: number[], targetHz: number) {
  const record = fixture(); const template = record.frames.find(row => row.phase === 2)!;
  record.frames = receipts.map(receipt => ({ ...template, receipt, xrTimestamp: receipt }));
  record.profile!.selectedTargetHz = targetHz;
  return gradeRun(record, release).cadence;
}
function proofForPixels(values: number[]) {
  const count = values.length / 4;
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData: () => {} }),
    toDataURL: () => "data:image/png;base64,synthetic-unit-proof",
  }) });
  const renderer = { getContext: () => ({ NO_ERROR: 0, getError: () => 0 }),
    xr: { getCamera: () => ({ cameras: [{ viewport: { x: 0, y: 0, z: count, w: 1 } }] }) },
    getRenderTarget: () => ({}), readRenderTargetPixels: (_target: unknown, _x: number, _y: number, _w: number, _h: number, into: Uint8Array) => into.set(values),
  } as unknown as import("three").WebGLRenderer;
  return xrPixelProof(renderer, 123);
}
afterEach(() => vi.unstubAllGlobals());
describe('Stage0 prospective callback estimator', () => {
  it('uses N=m-1 and nearest-rank inclusive quantiles', () => { const record = fixture(); record.frames.filter(row => row.phase === 2).forEach((row, index) => { row.updateMs = [4, 1, 3, 2][index % 4]!; row.submissionMs = 0; }); expect(gradeRun(record, release).cpuP95).toBe(4); expect(pacing([0, 1, 3, 6, 10], 100).median).toBe(2.5); const p = pacing([0, 10, 20], 100); expect(p.observed).toBe(2); expect(p.E).toBe(0); expect(p.denominator).toBe(2); });
  it('catches systematically72 callbacks against90nominal independently of per-gap rounding', () => { const p = pacing(Array.from({ length: 721 }, (_, i) => i * 1000 / 72), 90); expect(p.gapDeficit).toBe(0); expect(p.globalDeficit).toBe(180); expect(p.estimatedMissedFraction).toBeCloseTo(.2); });
  it('retains stalls and refuses empty, duplicate, backwards/nonfinite clocks', () => { expect(pacing([0, 10, 50], 100).gapDeficit).toBe(3); for (const times of [[], [1], [1, 1], [2, 1], [0, NaN]]) expect(pacing(times, 90).valid).toBe(false); });
  it('accepts a complete genuine-shaped record with raw0 rate remaining unknown', () => { const r = fixture(); const g = gradeRun(r, release); expect(g.reasons).toEqual([]); expect(g.candidatePass).toBe(true); expect(r.profile!.actualSessionFrameRate).toBeNull(); expect(r.profile!.rawSessionFrameRate).toBe(0); });
  it.each(['flat', 'missing-pose', 'singular-view', 'no-draw', 'wrong-primitives', 'changed-memory', 'changed-program', 'hidden', 'loss', 'cpu-negative', 'clock-backward', 'censored', 'source', 'profile', 'cleanup', 'short-warm', 'missing-empty', 'row-count', 'phase-order', 'watchdog', 'missing-warm', 'proof'] as const)('rejects%s without deleting bad rows', kind => {
    const r = fixture(); const f = r.frames.find(item => item.phase === 2)!; const count = r.frames.length;
    if (kind === 'flat') f.presenting = false; if (kind === 'missing-pose') { f.head = []; f.viewMatrices = []; f.viewCount = 0; } if (kind === 'singular-view') f.viewMatrices.fill(0); if (kind === 'no-draw') f.renderCalls = 0; if (kind === 'wrong-primitives') f.triangles--; if (kind === 'changed-memory') f.geometries++; if (kind === 'changed-program') f.programs++; if (kind === 'hidden') f.visible = false; if (kind === 'loss') f.contextLost = true; if (kind === 'cpu-negative') f.updateMs = -1; if (kind === 'clock-backward') f.receipt = -1; if (kind === 'censored') r.status = 'stopped'; if (kind === 'source') r.identity.bundleSha256 = 'b'.repeat(64); if (kind === 'profile') r.profile!.foveationReadback = 0; if (kind === 'cleanup') r.cleanup.controlTimers = 1; if (kind === 'short-warm') r.warmupStart = 1001; if (kind === 'missing-empty') r.frames[0]!.phase = 9; if (kind === 'row-count') r.storage.retainedFrames--; if (kind === 'phase-order') r.frames[60]!.phase = 3; if (kind === 'watchdog') r.watchdogDeadline = NaN; if (kind === 'missing-warm') r.frames[60]!.phase = 0; if (kind === 'proof') r.proofs.afterSample = null;
    expect(gradeRun(r, release).candidatePass).toBe(false); expect(r.frames).toHaveLength(count);
  });
  it('does not trust a forged self-reported warm resource contract', () => { const r = fixture(); r.resources.roomWarm!.geometries = 100; r.frames.filter(f => f.phase === 2).forEach(f => { f.geometries = 100; }); expect(gradeRun(r, release).reasons).toContain('source-room-resource-contract'); });
  it('keeps CPU advisory separate from hard cadence validity and quantized zeros', () => { const r = fixture(); r.frames.forEach(f => { f.updateMs = 0; f.submissionMs = 20; }); const g = gradeRun(r, release); expect(g.candidatePass).toBe(true); expect(g.cpuAdvisoryMet).toBe(false); expect(g.cpuZerosQuantized).toBe(true); });
  it('requires three distinct complete sessions and hardCPUspread without pooling', () => { const runs = [fixture(), fixture(), fixture()]; runs.forEach((r, i) => { r.identity.nonce += i; }); expect(gradeCohort(runs, release).candidatePass).toBe(true); runs[2]!.frames.forEach(f => { f.updateMs = 3; }); expect(gradeCohort(runs, release).candidatePass).toBe(false); expect(gradeCohort(runs.slice(0, 2), release).candidatePass).toBe(false); });
  it('rejects clear-only, black and transparent pixel witnesses', () => { for (const rgba of [[16,24,32,255], [0,0,0,255], [0,0,0,0]]) { const proof = proofForPixels(Array.from({ length: 100 }, () => rgba).flat()); expect(proof.nonBackgroundPixels).toBe(0); expect(proof.reason).toContain('No colored actual XR scene pixels'); } const colored = proofForPixels([38,70,56,255]); expect(colored.nonBackgroundPixels).toBe(57600); expect(colored.reason).toBeNull(); const r = fixture(); r.frames.find(f => f.phase === 2)!.viewMatrices.fill(0, 16, 32); expect(gradeRun(r, release).valid).toBe(false); });
  it('bounds storage and preserves zero spans without growth', () => { const s = createRecord(metadata, 'cohort').store; const row = new Float64Array(18); const pose = new Float32Array(64); expect(s.put(row, new Float32Array(7), pose)).toBe(0); const capacity = s.info().maximumFrames; for (let i = 1; i < capacity; i++) expect(s.put(row, [], pose)).toBe(i); expect(s.put(row, [], pose)).toBe(-1); expect(s.info().overflow).toBe(true); expect(s.snapshot()[0]!.updateMs).toBe(0); s.release(); expect(s.snapshot()).toEqual([]); });
});

describe('Stage0 bounded setup order (host stubs; no physical cause claim)', () => {
  function stub() {
    const events: string[] = []; const abort = new AbortController(); let bound = false; let raf = false; let lateCleanup = 0; let rateCalls = 0; let waiting: (() => void) | null = null;
    const reference = {} as XRReferenceSpace;
    const session = { supportedFrameRates: [72, 90], frameRate: 0, updateTargetFrameRate: async () => { rateCalls++; if (bound && raf) return; await new Promise<void>(done => { waiting = done; }); } } as unknown as XRSession;
    const renderer = { xr: { setSession: async () => { bound = true; raf = true; waiting?.(); }, getReferenceSpace: () => reference } } as unknown as import('three').WebGLRenderer;
    const event = (type: string, detail: string) => { events.push(`${type}:${detail}`); }; const guard = { signal: abort.signal, stopped: () => abort.signal.aborted, lateCleanup: () => { lateCleanup++; } };
    return { session, renderer, reference, abort, event, guard, events, counters: () => ({ bound, raf, lateCleanup, rateCalls }), resolveRate: () => waiting?.() };
  }
  it('reproduces old unbound-rate pending and resolves the new bind/rAF-before-rate order', async () => {
    const old = stub(); let oldFinished = false; const oldSelection = old.session.updateTargetFrameRate!(90).then(() => { oldFinished = true; }); await Promise.resolve(); expect(old.counters()).toMatchObject({ bound: false, rateCalls: 1 }); expect(oldFinished).toBe(false); old.resolveRate(); await oldSelection; expect(oldFinished).toBe(true);
    const current = stub(); const result = await initializeSession(current.renderer, current.session, current.event, current.guard); expect(result.reference).toBe(current.reference); expect(result.selection.selectedTargetHz).toBe(90); expect(current.counters()).toMatchObject({ bound: true, raf: true, rateCalls: 1 }); expect(current.events.indexOf('setup-end:three-xr-set-session')).toBeLessThan(current.events.indexOf('setup-begin:target-frame-rate-90'));
  });
  it('does not invent a local-floor reference or request a target after missing binding output', async () => { const s = stub(); s.renderer.xr.getReferenceSpace = () => null; await expect(initializeSession(s.renderer, s.session, s.event, s.guard)).rejects.toThrow('actual local-floor'); expect(s.counters().rateCalls).toBe(0); });
  it('aborts a pending rate as fatal without fallback, and cleans late completion', async () => {
    const s = stub(); let resolve: (() => void) | undefined; s.session.updateTargetFrameRate = () => new Promise<void>(done => { resolve = done; }); const pending = initializeSession(s.renderer, s.session, s.event, s.guard); const rejection = pending.catch(error => String(error)); for (let i = 0; i < 8; i++) await Promise.resolve(); expect(s.events).toContain('setup-begin:target-frame-rate-90'); s.abort.abort(); expect(await rejection).toContain('Setup interrupted'); resolve?.(); for (let i = 0; i < 4; i++) await Promise.resolve(); expect(s.events.some(e => e.includes('target-frame-rate-72'))).toBe(false); expect(s.events).toContain('setup-late-completion:target-frame-rate-90'); expect(s.counters().lateCleanup).toBe(1);
  });
  it('does not initialize target or user loop after a late renderer binding', async () => {
    const s = stub(); let resolve: (() => void) | undefined; s.renderer.xr.setSession = () => new Promise<void>(done => { resolve = done; }); const pending = initializeSession(s.renderer, s.session, s.event, s.guard); const rejection = pending.catch(error => String(error)); s.abort.abort(); expect(await rejection).toContain('Setup interrupted'); resolve?.(); for (let i = 0; i < 4; i++) await Promise.resolve(); expect(s.counters().rateCalls).toBe(0); expect(s.counters().lateCleanup).toBe(1); expect(s.events).toContain('setup-late-completion:three-xr-set-session');
  });
  it('retains ordinary90 rejection then accepts the declared72 fallback', async () => { const s = stub(); const calls: number[] = []; s.session.updateTargetFrameRate = async hz => { calls.push(hz); if (hz === 90) throw new Error('ordinary rejection'); }; const result = await initializeSession(s.renderer, s.session, s.event, s.guard); expect(calls).toEqual([90, 72]); expect(result.selection.selectedTargetHz).toBe(72); expect(s.events.some(e => e.startsWith('target-rejected:90:'))).toBe(true); });
});
