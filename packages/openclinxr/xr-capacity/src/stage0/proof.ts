import type { WebGLRenderer } from 'three';
import { knownScenePixels } from './proof-pixels.js';
import { SCENE_MANIFEST } from './scene.js';
import type { Stage0Proof } from './types.js';
/** Untimed resolved framebuffer readback. This never runs inside the sampled interval. */
export function xrPixelProof(renderer: WebGLRenderer, xrTimestamp: number): Stage0Proof {
  const gl = renderer.getContext(); const cameras = renderer.xr.getCamera().cameras;
  const v = (cameras[0] as unknown as { viewport?: { x: number; y: number; z: number; w: number } })?.viewport;
  const viewport = v ? [v.x, v.y, v.z, v.w] : []; const target = renderer.getRenderTarget();
  const fail = (reason: string): Stage0Proof => ({ at: performance.now(), source: 'active-XR-resolved-render-target-untimed', xrTimestamp, viewport, nonBackgroundPixels: 0, testedPixels: 0, image: null, reason });
  if (!v || !target || !(v.z > 0 && v.w > 0) || v.z * v.w > 8388608) return fail('Missing or oversized active XR viewport');
  try {
    const pixels = new Uint8Array(v.z * v.w * 4); renderer.readRenderTargetPixels(target, v.x, v.y, v.z, v.w, pixels);
    const error = gl.getError(); if (error !== gl.NO_ERROR) return fail(`XR readback GL error ${error}`);
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; const context = canvas.getContext('2d');
    if (!context) return fail('No image encoder context');
    const out = context.createImageData(canvas.width, canvas.height); let nonBackgroundPixels = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const source = (Math.min(v.w - 1, Math.floor((1 - (y + .5) / canvas.height) * v.w)) * v.z + Math.min(v.z - 1, Math.floor((x + .5) / canvas.width * v.z))) * 4; const dest = (y * canvas.width + x) * 4;
      const r = pixels[source] ?? 0; const g = pixels[source + 1] ?? 0; const b = pixels[source + 2] ?? 0;
      out.data[dest] = r; out.data[dest + 1] = g; out.data[dest + 2] = b; out.data[dest + 3] = 255;
      out.data[dest + 3] = pixels[source + 3] ?? 0;
    }
    nonBackgroundPixels = knownScenePixels(out.data, SCENE_MANIFEST.colors);
    context.putImageData(out, 0, 0); const image = canvas.toDataURL('image/png');
    return { at: performance.now(), source: 'active-XR-resolved-render-target-untimed', xrTimestamp, viewport, nonBackgroundPixels, testedPixels: canvas.width * canvas.height, image: image.length <= 600000 ? image : null, reason: nonBackgroundPixels >= 576 && image.length <= 600000 ? null : 'No colored actual XR scene pixels or image bound exceeded' };
  } catch (error) { return fail(String(error)); }
}
