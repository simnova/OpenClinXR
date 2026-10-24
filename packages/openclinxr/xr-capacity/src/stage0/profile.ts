import type { WebGLRenderer } from "three";
import type { Stage0Profile } from "./types.js";
type Event = (type: string, detail: string) => void;
export interface SetupGuard { signal: AbortSignal; stopped: () => boolean; lateCleanup: () => void }
/** Native setup promises cannot be cancelled. Shared session deadline is fatal; late results only clean up. */
export function setupStep<T>(label: string, action: () => Promise<T>, event: Event, guard: SetupGuard): Promise<T> {
  if (guard.signal.aborted || guard.stopped()) return Promise.reject(new Error(`Setup stopped before ${label}`));
  event('setup-begin', label);
  let work: Promise<T>; try { work = Promise.resolve(action()); } catch (error) { event('setup-error', `${label}: ${String(error)}`); return Promise.reject(error); }
  return new Promise<T>((resolve, reject) => {
    const abort = () => { guard.signal.removeEventListener('abort', abort); event('setup-aborted', label); reject(new Error(`Setup interrupted at ${label}; shared session deadline/stop is fatal`)); };
    guard.signal.addEventListener('abort', abort, { once: true }); if (guard.signal.aborted || guard.stopped()) abort();
    work.then(value => { guard.signal.removeEventListener('abort', abort); if (guard.signal.aborted || guard.stopped()) { event('setup-late-completion', label); try { guard.lateCleanup(); } catch (error) { event('setup-late-cleanup-error', String(error)); } reject(new Error(`Late setup completion: ${label}`)); return; } event('setup-end', label); resolve(value); }, error => { guard.signal.removeEventListener('abort', abort); event(guard.signal.aborted ? 'setup-late-rejection' : 'setup-error', `${label}: ${String(error)}`); reject(error); });
  });
}
export async function initializeSession(renderer: WebGLRenderer, session: XRSession, event: Event, guard: SetupGuard) {
  await setupStep('three-xr-set-session', () => renderer.xr.setSession(session), event, guard);
  if (guard.signal.aborted || guard.stopped()) throw new Error('Stopped after binding renderer session');
  // Three0.184 setSession creates the layer, requests its configured local-floor space and starts internal XR rAF.
  const reference = renderer.xr.getReferenceSpace(); if (!reference) throw new Error('Bound renderer did not expose actual local-floor reference space');
  event('setup-reference-space', 'Actual local-floor reference returned by initialized Three XR manager; no fallback');
  const selection = await selectTarget(session, event, guard); return { reference, selection };
}
export async function selectTarget(session: XRSession, event: Event, guard?: SetupGuard) {
  const supported = Array.from(session.supportedFrameRates ?? []).filter(Number.isFinite).sort((a, b) => a - b);
  event('target-api-facts', JSON.stringify({ supportedFrameRates: supported, rawSessionFrameRate: typeof session.frameRate === 'number' ? session.frameRate : null, hasUpdateTargetFrameRate: typeof session.updateTargetFrameRate === 'function' }));
  for (const hz of [90, 72]) {
    if (!supported.some(v => Math.abs(v - hz) < .01) || !session.updateTargetFrameRate) continue;
    try { if (guard) await setupStep(`target-frame-rate-${hz}`, () => session.updateTargetFrameRate!(hz), event, guard); else await session.updateTargetFrameRate(hz); event("target-accepted", String(hz)); return { selectedTargetHz: hz, targetSelection: "target-update-accepted", supported }; }
    catch (e) { if (guard?.signal.aborted || guard?.stopped()) throw e; event("target-rejected", `${hz}: ${String(e)}`); }
  }
  if (typeof session.frameRate === "number" && Number.isFinite(session.frameRate) && session.frameRate > 0) return { selectedTargetHz: session.frameRate, targetSelection: "positive-session-readback", supported };
  throw new Error("No accepted nominal target or positive session frame-rate readback");
}
export function layerFacts(renderer: WebGLRenderer) {
  const layer = renderer.xr.getBaseLayer() as unknown as Record<string, unknown> | null;
  const width = layer?.["textureWidth"] ?? layer?.["framebufferWidth"];
  const height = layer?.["textureHeight"] ?? layer?.["framebufferHeight"];
  const foveation = layer?.["fixedFoveation"];
  const viewports = renderer.xr.getCamera().cameras.map(camera => { const v = (camera as unknown as { viewport: { x: number; y: number; z: number; w: number } }).viewport; return [v.x, v.y, v.z, v.w]; });
  return { layer, layerKind: layer?.["textureWidth"] === undefined ? "XRWebGLLayer" : "XRProjectionLayer", layerWidth: Number(width), layerHeight: Number(height), foveationReadback: typeof foveation === "number" && Number.isFinite(foveation) ? foveation : null, viewports };
}
export function profileFacts(renderer: WebGLRenderer, session: XRSession, selection: Awaited<ReturnType<typeof selectTarget>>, foveationRequested: number): Stage0Profile {
  const layer = layerFacts(renderer); const gl = renderer.getContext(); const attributes = gl.getContextAttributes();
  const raw = typeof session.frameRate === "number" && Number.isFinite(session.frameRate) ? session.frameRate : null;
  const enabled = (session as unknown as { enabledFeatures?: string[] }).enabledFeatures;
  const profile: Stage0Profile = { selectedTargetHz: selection.selectedTargetHz, targetSelection: selection.targetSelection, supportedFrameRates: selection.supported, rawSessionFrameRate: raw, actualSessionFrameRate: raw !== null && raw > 0 ? raw : null, layerKind: layer.layerKind, layerWidth: layer.layerWidth, layerHeight: layer.layerHeight, viewports: layer.viewports, foveationRequested, foveationReadback: layer.foveationReadback, framebufferScaleRequested: 1, contextAttributes: attributes ? { ...attributes } : {}, configuredSamples: renderer.getRenderTarget()?.samples ?? null, boundFramebufferSamples: Number(gl.getParameter(gl.SAMPLES)), enabledFeatures: enabled ? Array.from(enabled).sort() : null, availabilityMask: [] };
  profile.availabilityMask = ["actualSessionFrameRate", "foveationReadback", "configuredSamples", "boundFramebufferSamples", "enabledFeatures"].filter(k => profile[k as keyof Stage0Profile] === null).sort();
  return profile;
}
export function sameProfile(a: Stage0Profile, b: Stage0Profile) { return JSON.stringify(a) === JSON.stringify(b); }
