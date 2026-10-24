import { WebGLRenderer } from 'three';
import { createRecord } from './record.js';
import { createSessionLoop } from './loop.js';
import { initializeSession } from './profile.js';
import { RENDER_OPTIONS } from './scene.js';
import type { ResourceCounts, Stage0Metadata, Stage0Profile, Stage0Release } from './types.js';
export interface Admission { accepted: boolean; admittedAt: number | null; watchdogDeadline: number | null; measurementStarted: false; phase: string; reason: string | null }
export function createStage0(metadata: Stage0Metadata, purpose: 'readiness' | 'cohort', canvas: HTMLCanvasElement, closed: () => void) {
  const data = createRecord(metadata, purpose); const { record, store, event } = data;
  let renderer: WebGLRenderer | null = null; let session: XRSession | null = null; let loop: ReturnType<typeof createSessionLoop> | null = null; let release: Stage0Release | null = null;
  const setupAbort = new AbortController();
  let started = false; let finishing: Promise<void> | null = null; let disposed = false; let endObserved = false;
  const timers = new Set<ReturnType<typeof setTimeout>>(); const listeners: (() => void)[] = [];
  const timer = (callback: () => void, ms: number) => { const handle = setTimeout(() => { timers.delete(handle); record.cleanup.controlTimers = timers.size; callback(); }, ms); timers.add(handle); record.cleanup.controlTimers = timers.size; return handle; };
  const listen = (target: EventTarget, type: string, callback: EventListener) => { target.addEventListener(type, callback); listeners.push(() => target.removeEventListener(type, callback)); record.cleanup.controlListeners = listeners.length; };
  function finish(reason?: string, stopped = false): Promise<void> {
    if (finishing) return finishing;
    disposed = true; setupAbort.abort(); record.phase = 'closing'; if (reason) { record.failureReasons.push(reason); event(stopped ? 'stopped' : 'failure', reason); }
    finishing = (async () => {
      loop?.stop(); for (const t of timers) clearTimeout(t); timers.clear(); record.cleanup.controlTimers = 0;
      if (session && !endObserved) {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([session.end(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Owned session end exceeded2500ms')), 2500); })]); record.cleanup.sessionEnded = true; }
        catch (error) { if (!endObserved) record.failureReasons.push(String(error)); }
        finally { if (timeout) clearTimeout(timeout); }
      } else record.cleanup.sessionEnded = !session || endObserved;
      for (const remove of listeners) remove(); listeners.length = 0; record.cleanup.controlListeners = 0;
      try { renderer?.dispose(); renderer?.forceContextLoss(); record.cleanup.rendererDisposed = true; } catch (error) { record.failureReasons.push(String(error)); }
      canvas.hidden = true; record.cleanup.roomResourcesDisposed = true; record.cleanup.animationCallbacks = 0;
      record.storage = store.info(); record.endedAt = performance.now();
      record.status = stopped ? 'stopped' : record.failureReasons.length ? 'failed' : 'completed'; record.phase = record.status;
      event('closed', 'Owned session, renderer, callbacks, guards and timers released; report buffer retained for external harvest'); closed();
    })(); return finishing;
  }
  const api = {
    identity: Object.freeze({ ...record.identity }),
    admission: Promise.resolve<Admission>({ accepted: false, admittedAt: null, watchdogDeadline: null, measurementStarted: false, phase: 'ready', reason: 'not-started' }),
    configure(options: { profile?: Stage0Profile; releaseId?: string; emptyBaseline?: ResourceCounts }) {
      if (started || release || purpose !== 'cohort') throw new Error('Configuration allowed exactly once before cohort entry');
      if (!options.profile || !options.emptyBaseline || !options.releaseId || !Number.isFinite(options.profile.selectedTargetHz) || options.profile.selectedTargetHz <= 0 || !Object.values(options.emptyBaseline).every(n => Number.isInteger(n) && n >= 0)) throw new Error('Complete released profile/id/emptyBaseline required');
      release = structuredClone({ profile: options.profile, releaseId: options.releaseId, emptyBaseline: options.emptyBaseline, identity: { bundleSha256: metadata.bundleSha256, protocolSha256: metadata.protocolSha256, sceneManifestSha256: metadata.sceneManifestSha256 } }); record.releaseId = release.releaseId;
    },
    start(options: { purpose: 'readiness' | 'cohort' } = { purpose }) {
      if (started) return api.admission;
      started = true;
      api.admission = (async (): Promise<Admission> => {
        record.requestedAt = performance.now(); record.phase = 'requesting'; record.status = 'running';
        try {
          if (options.purpose !== purpose || (purpose === 'cohort' && !release)) throw new Error('Explicit purpose or pre-cohort release configuration missing');
          if (!navigator.xr) { record.status = 'unsupported'; throw new Error('Actual immersive WebXR is unavailable; no flat fallback'); }
          event('request-session-begin', 'immersive-vr; required local-floor; synchronous trusted-button call');
          session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'] });
          record.admittedAt = performance.now(); record.watchdogDeadline = record.admittedAt + (purpose === 'readiness' ? 15000 : 90000); event('session-created', 'Successful immersive requestSession resolution; watchdog origin');
          if (disposed) { await session.end(); throw new Error('Entry completed after owned stop'); }
          timer(() => { void finish('Owned session watchdog expired'); }, purpose === 'readiness' ? 15000 : 90000);
          listen(session, 'end', () => { endObserved = true; record.cleanup.sessionEnded = true; if (!disposed) void finish('Unexpected owned XR session end'); });
          listen(session, 'visibilitychange', () => { if (!disposed && session?.visibilityState !== 'visible') void finish('XR session became hidden or interrupted'); });
          listen(document, 'visibilitychange', () => { if (!disposed && record.warmupStart !== null) void finish('Document visibility changed after warmup began'); });
          listen(canvas, 'webglcontextlost', () => { if (!disposed) void finish('WebGL context lost'); });
          event('renderer-create-begin', 'Fixed source context flags');
          renderer = new WebGLRenderer({ ...RENDER_OPTIONS, canvas }); renderer.setPixelRatio(1); renderer.setSize(960, 540, false); renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor'); renderer.xr.setFramebufferScaleFactor(1); renderer.xr.setFoveation(1);
          event('renderer-create-end', 'Fixed scale1/foveation1; no sampled workload started');
          record.gpu.available = !!renderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2');
          const activeRenderer = renderer; const activeSession = session;
          const { selection, reference } = await initializeSession(activeRenderer, activeSession, event, { signal: setupAbort.signal, stopped: () => disposed, lateCleanup: () => { activeRenderer.setAnimationLoop(null); void activeSession.end().catch(() => {}); activeRenderer.dispose(); activeRenderer.forceContextLoss(); } });
          if (disposed) throw new Error('Setup completed after owned stop');
          loop = createSessionLoop(renderer, session, reference, selection, data, release, reason => { void finish(reason); }); record.phase = 'empty-before';
          const admission: Admission = { accepted: true, admittedAt: record.admittedAt, watchdogDeadline: record.watchdogDeadline, measurementStarted: false, phase: 'empty-before', reason: null };
          event('admission-ready', 'Before first empty/warmup/sample callback; collector awaits this once'); timer(() => loop?.start(), 0); return admission;
        } catch (error) {
          const unsupported = record.status === 'unsupported'; await finish(String(error)); if (unsupported) { record.status = 'unsupported'; record.phase = 'unsupported'; }
          return { accepted: false, admittedAt: record.admittedAt, watchdogDeadline: record.watchdogDeadline, measurementStarted: false, phase: record.phase, reason: String(error) };
        }
      })(); return api.admission;
    },
    stop(reason = 'Explicit Stop') { return finish(reason, true); },
    snapshot() {
      if (record.phase === 'sampling' || record.phase === 'warmup') { void finish('Unexpected snapshot/export during acquisition'); throw new Error('Harvest is allowed only after closure'); }
      return structuredClone({ ...record, frames: store.snapshot(), storage: store.info() });
    },
  };
  return api;
}
