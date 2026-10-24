import { Matrix4, PerspectiveCamera, Scene, type WebGLRenderer } from 'three';
import { counts, createRoom } from './scene.js';
import { layerFacts, profileFacts, sameProfile } from './profile.js';
import type { selectTarget } from './profile.js';
import { xrPixelProof } from './proof.js';
import type { createRecord } from './record.js';
import type { Stage0Release } from './types.js';
type Context = ReturnType<typeof createRecord>;
export function createSessionLoop(renderer: WebGLRenderer, session: XRSession, reference: XRReferenceSpace, selection: Awaited<ReturnType<typeof selectTarget>>, data: Context, release: Stage0Release | null, finish: (reason?: string) => void) {
  const { record, store, event } = data; const empty = new Scene(); const camera = new PerspectiveCamera(65, 1, .05, 30); const determinant = new Matrix4();
  const head = new Float32Array(7); const views = new Float32Array(64); const row = new Float64Array(18);
  let room: ReturnType<typeof createRoom> | null = null; let phase = 0; let phaseStart: number | null = null; let phaseFrames = 0; let stateFrame = 0; let layer: Record<string, unknown> | null = null;
  let width: unknown; let height: unknown; let foveation: unknown; let rawRate: unknown; let stopped = false;
  const fail = (why: string) => { stopped = true; finish(why); };
  function profileStable() {
    const current = renderer.xr.getBaseLayer() as unknown as Record<string, unknown> | null;
    return current === layer && (current?.['textureWidth'] ?? current?.['framebufferWidth']) === width && (current?.['textureHeight'] ?? current?.['framebufferHeight']) === height && current?.['fixedFoveation'] === foveation && session.frameRate === rawRate;
  }
  function beginPhase(next: number, at: number) { phase = next; phaseFrames = 0; phaseStart = at; }
  function prepareRoom(at: number) {
    record.resources.emptyBefore = counts(renderer); const facts = layerFacts(renderer); layer = facts.layer; width = layer?.['textureWidth'] ?? layer?.['framebufferWidth']; height = layer?.['textureHeight'] ?? layer?.['framebufferHeight']; foveation = layer?.['fixedFoveation']; rawRate = session.frameRate;
    record.profile = profileFacts(renderer, session, selection, 1);
    if (!(record.profile.layerWidth > 0 && record.profile.layerHeight > 0) || record.profile.viewports.length !== 2) throw new Error('Missing actual stereo layer dimensions');
    if (release && (!sameProfile(record.profile, release.profile) || JSON.stringify(record.resources.emptyBefore) !== JSON.stringify(release.emptyBaseline))) throw new Error('Released profile or warmed-empty baseline mismatch');
    room = createRoom(); if (!room.validate()) throw new Error('Scene construction contract failed'); record.resources.ownerBefore = room.ownedCount();
    renderer.compile(room.scene, camera); record.phase = 'warmup'; beginPhase(record.purpose === 'readiness' ? 4 : 1, at); event('room-prepared', '8 meshes; 46 triangles per view; 3 geometries; 5 materials; no textures');
  }
  function onFrame(xrTimestamp: number, frame?: XRFrame) {
    const receipt = performance.now(); // First statement: user callback receipt, after Three internal XR camera preparation.
    if (stopped) return;
    try {
      if (!frame || frame.session !== session || !renderer.xr.isPresenting) throw new Error('Missing actual owned immersive XRFrame/session');
      if (session.visibilityState !== 'visible' || document.visibilityState !== 'visible' || renderer.getContext().isContextLost()) throw new Error('Hidden, interrupted or lost XR context');
      if (phaseStart === null) phaseStart = receipt;
      if ((phase === 0 || phase === 3) && receipt - phaseStart > 5000) throw new Error('Empty XR callback recovery exceeded 5000ms');
      if (phase > 0 && !profileStable()) { record.cleanup.layerStable = false; throw new Error('Actual layer/rate/foveation profile changed'); }
      if (phase === 1 && record.warmupStart !== null && receipt >= record.warmupStart + 10000) { beginPhase(2, receipt); record.phase = 'sampling'; record.sampleStart = receipt; event('sample-start', 'Primary receipt window; first callback retained'); }
      const updateStart = performance.now(); stateFrame++;
      const pose = frame.getViewerPose(reference); if (!pose || pose.views.length !== 2) throw new Error('Missing nonempty stereo viewer pose');
      const p = pose.transform.position; const q = pose.transform.orientation; head[0] = p.x; head[1] = p.y; head[2] = p.z; head[3] = q.x; head[4] = q.y; head[5] = q.z; head[6] = q.w;
      for (let j = 0; j < 7; j++) if (!Number.isFinite(head[j])) throw new Error('Nonfinite head pose');
      if (Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) > .01) throw new Error('Invalid head quaternion');
      for (let j = 0; j < 2; j++) { const view = pose.views[j]!; views.set(view.transform.matrix, j * 32); views.set(view.projectionMatrix, j * 32 + 16); determinant.fromArray(views, j * 32); if (Math.abs(determinant.determinant()) < 1e-8) throw new Error('Singular view transform'); determinant.fromArray(views, j * 32 + 16); if (Math.abs(determinant.determinant()) < 1e-8) throw new Error('Singular projection matrix'); }
      for (let j = 0; j < 64; j++) if (!Number.isFinite(views[j])) throw new Error('Nonfinite stereo matrices');
      const updateEnd = performance.now(); const submitStart = performance.now(); renderer.render(room ? room.scene : empty, camera); const submitEnd = performance.now();
      const collectorStart = performance.now(); const info = renderer.info; const roomActive = phase !== 0 && phase !== 3;
      row[0] = receipt; row[1] = xrTimestamp; row[2] = phase; row[3] = updateEnd - updateStart; row[4] = submitEnd - submitStart; row[5] = 1; row[6] = pose.views.length; row[7] = 1; row[8] = 1; row[9] = 0; row[10] = info.render.calls; row[11] = info.render.triangles; row[12] = info.programs?.length ?? 0; row[13] = info.memory.geometries; row[14] = info.memory.textures; row[15] = stateFrame;
      if (record.profile) { const cameras = renderer.xr.getCamera().cameras; for (let i = 0; i < cameras.length; i++) { const v = (cameras[i] as unknown as { viewport: { x: number; y: number; z: number; w: number } }).viewport; const expected = record.profile.viewports[i]; if (!expected || v.x !== expected[0] || v.y !== expected[1] || v.z !== expected[2] || v.w !== expected[3]) throw new Error('Active eye viewport changed'); } }
      const index = store.put(row, head, views); const afterStore = performance.now(); store.finishRow(index, afterStore - collectorStart, afterStore - receipt);
      if (index < 0 || (phase === 2 && phaseFrames >= 12000)) throw new Error('Raw callback storage bound exceeded');
      if (info.render.calls !== (roomActive ? 16 : 0) || info.render.triangles !== (roomActive ? 92 : 0)) throw new Error('Actual post-render draw/primitive contract failed');
      if (roomActive && record.resources.roomWarm && (row[12] !== record.resources.roomWarm.programs || row[13] !== record.resources.roomWarm.geometries || row[14] !== record.resources.roomWarm.textures)) throw new Error('Actual post-render program/resource contract changed');
      phaseFrames++;
      if (phase === 0 && phaseFrames === 60) { prepareRoom(receipt); return; }
      if (roomActive && record.warmupStart === null) {
        record.resources.roomWarm = counts(renderer); const baseline = record.resources.emptyBefore!;
        if (record.resources.roomWarm.geometries !== baseline.geometries + 3 || record.resources.roomWarm.textures !== baseline.textures || record.resources.roomWarm.programs !== baseline.programs + 1) throw new Error('Actual room resource delta differs from source contract');
        record.proofs.preview = xrPixelProof(renderer, xrTimestamp); if (record.proofs.preview.reason) throw new Error(record.proofs.preview.reason);
        record.warmupStart = receipt; event('warmup-start', 'Actual XR content verified outside sampling');
      }
      if ((phase === 4 && phaseFrames === 60) || (phase === 2 && receipt - record.sampleStart! >= 60000)) {
        if (phase === 2) record.sampleEnd = receipt;
        record.proofs.afterSample = xrPixelProof(renderer, xrTimestamp); if (record.proofs.afterSample.reason) throw new Error(record.proofs.afterSample.reason);
        event('window-ended', 'Last callback and actual submission retained before untimed XR readback'); room!.dispose(); record.resources.ownerAfter = room!.ownedCount(); room = null; record.cleanup.roomResourcesDisposed = true; record.phase = 'empty-after'; beginPhase(3, performance.now());
      } else if (phase === 3 && phaseFrames === 60) {
        record.resources.emptyAfter = counts(renderer); if (JSON.stringify(record.resources.emptyAfter) !== JSON.stringify(record.resources.emptyBefore)) throw new Error('Warmed empty resource counts did not recover');
        stopped = true; event('empty-recovery-completed', '60 actual XR callbacks; same layer and renderer'); finish();
      }
    } catch (error) { event('callback-abort', `receipt=${receipt};xrTimestamp=${xrTimestamp};phase=${phase};${String(error)}`); fail(String(error)); }
  }
  return { start() { renderer.setAnimationLoop(onFrame); record.cleanup.animationCallbacks = 1; }, stop() { stopped = true; renderer.setAnimationLoop(null); record.cleanup.animationCallbacks = 0; room?.dispose(); record.resources.ownerAfter = room?.ownedCount() ?? 0; room = null; record.cleanup.roomResourcesDisposed = true; } };
}
