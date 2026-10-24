import { WebGLRenderer } from 'three';
import { createRecord } from './record.js';
import { createSessionLoop } from './loop.js';
import { initializeSession } from '../stage0/profile.js';
import { RENDER_OPTIONS } from '../stage0/scene.js';
import type {ControllerMetadata,ControllerMode,ControllerRecord,ControllerRelease} from './types.js';
import {PROTOCOL_SHA256,CLARIFICATIONS_SHA256,PLAN_SHA256} from './inventory.js';
export interface Admission { accepted: boolean; admittedAt: number | null; watchdogDeadline: number | null; measurementStarted: false; phase: string; reason: string | null }
export function createController(metadata:ControllerMetadata,purpose:'readiness'|'cohort',mode:ControllerMode,slot:number|null,canvas:HTMLCanvasElement,closed:()=>void) {
  const data = createRecord(metadata,purpose,mode,slot); const { record, store, event } = data;
  let renderer: WebGLRenderer | null = null; let session: XRSession | null = null; let loop: ReturnType<typeof createSessionLoop> | null = null; let release: ControllerRelease | null = null;
  const setupAbort=new AbortController();let resolveClosed:()=>void=()=>{};const closedPromise=new Promise<void>(r=>{resolveClosed=r;});
  let started = false; let finishing: Promise<void> | null = null; let disposed = false; let endObserved = false;
  const timers = new Set<ReturnType<typeof setTimeout>>(); const listeners: (() => void)[] = [];
  const timer = (callback: () => void, ms: number) => { const handle = setTimeout(() => { timers.delete(handle); record.cleanup.controlTimers = timers.size; callback(); }, ms); timers.add(handle); record.cleanup.controlTimers = timers.size; return handle; };
  const listen = (target: EventTarget, type: string, callback: EventListener) => { target.addEventListener(type, callback); listeners.push(() => target.removeEventListener(type, callback)); record.cleanup.controlListeners = listeners.length; };
  function finish(reason?: string, stopped = false): Promise<void> {
    if (finishing) return finishing;
    disposed = true; setupAbort.abort(); record.phase = 'closing'; if (reason) { record.failureReasons.push(reason); try{event(stopped?'stopped':'failure',reason);}catch{record.storage.overflow=true;} }
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
      try{event('closed','Owned session, renderer, callbacks, guards and timers released; report buffer retained for external harvest');}catch{record.failureReasons.push('Lifecycle event storage overflow');record.status='failed';record.phase='failed';}resolveClosed();closed();
    })(); return finishing;
  }
  const api={
    identity: Object.freeze({ ...record.identity }),
    admission: Promise.resolve<Admission>({ accepted: false, admittedAt: null, watchdogDeadline: null, measurementStarted: false, phase: 'ready', reason: 'not-started' }),
    closed:closedPromise,
    configure(candidate:ControllerRelease){
      if(started||release||purpose!=='cohort')throw Error('Configure exactly once before cohort entry');
      const identity=metadata;for(const key of ['bundleSha256','protocolSha256','semanticClarificationsSha256','planSha256','inventorySha256']as const)if(candidate.identity[key]!==identity[key])throw Error('Released identity mismatch');
      const planned=metadata.plan.slots.find(s=>s.ordinal===slot);if(!planned||planned.nonce!==metadata.nonce||planned.mode!==mode||candidate.schema!=='quest-controller-release.v1'||!candidate.releaseId||!candidate.profile||!candidate.emptyBaseline||candidate.onPrograms!==candidate.emptyBaseline.programs+3||!Number.isFinite(candidate.profile.selectedTargetHz)||candidate.profile.selectedTargetHz<=0)throw Error('Fixed plan/release mismatch');
      release=structuredClone(candidate);record.releaseId=release.releaseId;
    },
    start(options: { purpose: 'readiness' | 'cohort' } = { purpose }) {
      if (started) return api.admission;
      started = true;
      api.admission = (async (): Promise<Admission> => {
        record.requestedAt = performance.now(); record.phase = 'requesting'; record.status = 'running';
        try {
          if(metadata.protocolSha256!==PROTOCOL_SHA256||metadata.semanticClarificationsSha256!==CLARIFICATIONS_SHA256||metadata.planSha256!==PLAN_SHA256)throw Error('Frozen policy identity mismatch');if(options.purpose!==purpose||(purpose==='cohort'&&!release)) throw new Error('Explicit purpose or pre-cohort release configuration missing');
          if (!navigator.xr) { record.status = 'unsupported'; throw new Error('Actual immersive WebXR is unavailable; no flat fallback'); }
          event('request-session-begin', 'immersive-vr; required local-floor; synchronous trusted-button call');
          record.entryPending=true;const pending=navigator.xr.requestSession('immersive-vr',{requiredFeatures:['local-floor']});void pending.then(late=>{record.entryPending=false;if(disposed)void late.end().catch(()=>{});},()=>{record.entryPending=false;});session=await new Promise<XRSession>((resolve,reject)=>{const cancel=()=>{clearTimeout(entryTimer);timers.delete(entryTimer);reject(Error('Ordinary XR entry stopped'));},entryTimer=timer(()=>{setupAbort.signal.removeEventListener('abort',cancel);reject(Error('Ordinary XR entry deadline30s exceeded'));},30000);setupAbort.signal.addEventListener('abort',cancel,{once:true});pending.then(value=>{clearTimeout(entryTimer);timers.delete(entryTimer);setupAbort.signal.removeEventListener('abort',cancel);resolve(value);},error=>{clearTimeout(entryTimer);timers.delete(entryTimer);setupAbort.signal.removeEventListener('abort',cancel);reject(error);});});record.nativeSession=typeof XRSession==='function'&&session instanceof XRSession;
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
        }catch(error){
          const unsupported = record.status === 'unsupported'; await finish(String(error)); if (unsupported) { record.status = 'unsupported'; record.phase = 'unsupported'; }
          return { accepted: false, admittedAt: record.admittedAt, watchdogDeadline: record.watchdogDeadline, measurementStarted: false, phase: record.phase, reason: String(error) };
        }
      })(); return api.admission;
    },
    stop(reason = 'Explicit Stop') { return finish(reason, true); },
    snapshot() {
      if (record.phase === 'sampling' || record.phase === 'warmup') { void finish('Unexpected snapshot/export during acquisition'); throw new Error('Harvest is allowed only after closure'); }
      return structuredClone({...record,frames:store.snapshot(),inputEvents:store.eventSnapshot(record.sampleStart,record.sampleEnd),storage:store.info()});
    },
  };
  return api;
}
