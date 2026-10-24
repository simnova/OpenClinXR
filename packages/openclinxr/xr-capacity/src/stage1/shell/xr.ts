import { WebGLRenderer } from 'three';
import { createSessionLoop } from '../../stage0/loop.js';
import { initializeSession } from '../../stage0/profile.js';
import { RENDER_OPTIONS } from '../../stage0/scene.js';
import type { Admission } from '../../stage0/shell.js';
import type { createRecord } from '../../stage0/record.js';
import type { Stage0Release } from '../../stage0/types.js';
export function createXrLifecycle(data: ReturnType<typeof createRecord>, purpose: 'readiness' | 'cohort', canvas: HTMLCanvasElement, sessionCreated: () => void, closed: () => void) {
  const { record, store, event } = data; const abort = new AbortController(); const timers = new Set<ReturnType<typeof setTimeout>>(); const listeners: (() => void)[] = [];
  let renderer: WebGLRenderer | null = null; let session: XRSession | null = null; let loop: ReturnType<typeof createSessionLoop> | null = null; let disposed = false; let endObserved = false; let finishing: Promise<void> | null = null; let started = false;
  const listen = (target: EventTarget, type: string, callback: EventListener) => { target.addEventListener(type, callback); listeners.push(() => target.removeEventListener(type, callback)); record.cleanup.controlListeners = listeners.length; };
  const timer = (callback: () => void, ms: number) => { const handle = setTimeout(() => { timers.delete(handle); record.cleanup.controlTimers = timers.size; callback(); }, ms); timers.add(handle); record.cleanup.controlTimers = timers.size; };
  function finish(reason?: string, stopped = false): Promise<void> {
    if (finishing) return finishing; disposed = true; abort.abort(); record.phase = 'closing'; if (reason) { record.failureReasons.push(reason); event(stopped ? 'stopped' : 'failure', reason); }
    finishing = (async () => {
      loop?.stop(); for (const handle of timers) clearTimeout(handle); timers.clear(); record.cleanup.controlTimers = 0;
      if (session && !endObserved) { let timeout: ReturnType<typeof setTimeout> | undefined; try { await Promise.race([session.end(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Owned XR end exceeded2500ms')), 2500); })]); record.cleanup.sessionEnded = true; } catch (error) { if (!endObserved) record.failureReasons.push(String(error)); } finally { if (timeout) clearTimeout(timeout); } } else record.cleanup.sessionEnded = !session || endObserved;
      listeners.forEach(remove => remove()); listeners.length = 0; record.cleanup.controlListeners = 0;
      try { renderer?.dispose(); renderer?.forceContextLoss(); record.cleanup.rendererDisposed = true; } catch (error) { record.failureReasons.push(String(error)); }
      canvas.hidden = true; record.cleanup.roomResourcesDisposed = true; record.cleanup.animationCallbacks = 0; record.storage = store.info(); record.endedAt = performance.now(); record.status = stopped ? 'stopped' : record.failureReasons.length ? 'failed' : 'completed'; record.phase = record.status; event('xr-closed', 'XR owned session/graphics recovered; audio final drain follows'); closed();
    })(); return finishing;
  }
  return {
    start(release: Stage0Release | null): Promise<Admission> {
      if (started) return Promise.resolve({ accepted: false, admittedAt: record.admittedAt, watchdogDeadline: record.watchdogDeadline, measurementStarted: false, phase: record.phase, reason: 'Entry already requested' }); started = true;
      return (async () => {
        record.requestedAt = performance.now(); record.phase = 'requesting'; record.status = 'running';
        try {
          if (!navigator.xr) throw new Error('Actual immersive WebXR unavailable; no flat fallback'); event('request-session-begin', 'immersive-vr; required local-floor');
          session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'] }); record.admittedAt = performance.now(); record.watchdogDeadline = record.admittedAt + (purpose === 'readiness' ? 15000 : 90000); event('session-created', 'Actual requestSession resolution; watchdog origin');
          if (disposed) { await session.end(); throw new Error('Late XR entry after stop'); }
          timer(() => { void finish('Owned XR session watchdog expired'); }, purpose === 'readiness' ? 15000 : 90000); sessionCreated();
          listen(session, 'end', () => { endObserved = true; record.cleanup.sessionEnded = true; if (!disposed) void finish('Unexpected XR end'); });
          listen(session, 'visibilitychange', () => { if (!disposed && session?.visibilityState !== 'visible') void finish('XR hidden/interrupted'); });
          listen(document, 'visibilitychange', () => { if (!disposed && record.warmupStart !== null) void finish('Document visibility changed after warmup'); });
          listen(canvas, 'webglcontextlost', () => { if (!disposed) void finish('WebGL context lost'); });
          renderer = new WebGLRenderer({ ...RENDER_OPTIONS, canvas }); renderer.setPixelRatio(1); renderer.setSize(960, 540, false); renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor'); renderer.xr.setFramebufferScaleFactor(1); renderer.xr.setFoveation(1); record.gpu.available = !!renderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2');
          const activeRenderer = renderer; const activeSession = session; const { selection, reference } = await initializeSession(activeRenderer, activeSession, event, { signal: abort.signal, stopped: () => disposed, lateCleanup: () => { activeRenderer.setAnimationLoop(null); void activeSession.end().catch(() => {}); activeRenderer.dispose(); activeRenderer.forceContextLoss(); } });
          if (disposed) throw new Error('Late XR setup after stop');
          loop = createSessionLoop(renderer, session, reference, selection, data, release, reason => { void finish(reason); }); record.phase = 'empty-before'; event('admission-ready', 'Before first owned empty/warmup/sample callback'); timer(() => loop?.start(), 0);
          return { accepted: true, admittedAt: record.admittedAt, watchdogDeadline: record.watchdogDeadline, measurementStarted: false, phase: 'empty-before', reason: null };
        } catch (error) { await finish(String(error)); return { accepted: false, admittedAt: record.admittedAt, watchdogDeadline: record.watchdogDeadline, measurementStarted: false, phase: record.phase, reason: String(error) }; }
      })();
    },
    stop: (reason = 'Explicit Stage1 stop', technical = false) => finish(reason, !technical),
  };
}
