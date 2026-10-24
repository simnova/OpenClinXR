import { BufferAttribute, BufferGeometry, Camera, Color, DoubleSide, GLSL3, type Group, LinearSRGBColorSpace, type Material, Mesh, NoToneMapping, Object3D, PerspectiveCamera, REVISION, RawShaderMaterial, Scene, Vector2, WebGLRenderer } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { makeMetric } from "../index.js";
import type { CapacityMetric, MetricSample } from "../types.js";
import type { GraphicsFixture } from "./graphics.js";

const source = { tool: "three-browser-fixture", version: REVISION, processId: "browser-page" };
function measured(id: string, semantic: CapacityMetric["semantic"], unit: CapacityMetric["unit"], samples: MetricSample[]): CapacityMetric {
  return makeMetric({ id, semantic, unit, samples, source, granularity: "event", clockDomain: "browser-monotonic" });
}
function rendererFor(canvas: HTMLCanvasElement): { renderer: WebGLRenderer; gl: WebGL2RenderingContext } | null {
  const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const renderer = new WebGLRenderer({ canvas, context: gl, antialias: false });
  renderer.setPixelRatio(1); renderer.setSize(384, 384, false); renderer.sortObjects = false;
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.setClearColor(new Color(.025, .045, .085), 1);
  return { renderer, gl };
}
function verifyPixels(gl: WebGL2RenderingContext): number {
  const bytes = new Uint8Array(384 * 384 * 4);
  gl.readPixels(0, 0, 384, 384, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  let count = 0;
  for (let i = 2; i < bytes.length; i += 4) if ((bytes[i] ?? 0) > 100) count++;
  if (!count || gl.getError() !== gl.NO_ERROR) throw new Error("Three.js pixel verification found no rendered fixture");
  return count;
}
/** Same positions, shader arithmetic, resolution and draw count as the raw fixture. */
export function createThreeFixture(canvas: HTMLCanvasElement, level: number): GraphicsFixture | null {
  const setup = rendererFor(canvas); if (!setup) return null;
  const { renderer, gl } = setup;
  const scene = new Scene(); const camera = new Camera();
  const geometry = new BufferGeometry(); geometry.setAttribute("p", new BufferAttribute(new Float32Array([-.14, -.13, .14, -.13, 0, .16]), 2));
  // The renderer requires a position attribute for its draw-range count; the shader uses p.
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([-.14, -.13, 0, .14, -.13, 0, 0, .16, 0]), 3));
  const drawsPerFrame = [16, 64, 160][level - 1] ?? 16;
  const materials: RawShaderMaterial[] = [];
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  const pending: { query: WebGLQuery; at: number }[] = []; const samples: MetricSample[] = [];
  let dropped = 0; let disjoint = false; let draws = 0; let verified = 0; let frames = 0; let disposed = false;
  const originalDraw = gl.drawArrays.bind(gl);
  gl.drawArrays = (...args) => { originalDraw(...args); draws++; };
  for (let i = 0; i < drawsPerFrame; i++) {
    const material = new RawShaderMaterial({ glslVersion: GLSL3, depthTest: false, depthWrite: false, side: DoubleSide,
      uniforms: { angle: { value: 0 }, offset: { value: new Vector2(((i % 8) - 3.5) * .23, ((Math.floor(i / 8) % 8) - 3.5) * .23) } },
      vertexShader: "precision highp float; in vec2 p; uniform float angle; uniform vec2 offset; void main(){float c=cos(angle),s=sin(angle); gl_Position=vec4(mat2(c,-s,s,c)*p+offset,0.,1.);}",
      fragmentShader: `precision mediump float; uniform highp float angle; out vec4 color; void main(){ vec2 p=gl_FragCoord.xy/384.; float v=0.; for(int i=0;i<${[4, 12, 24][level - 1]};i++){v+=sin(p.x*float(i+1)+angle)*cos(p.y*float(i+1));} color=vec4(.2+.15*sin(v),.55+.2*cos(v),.9,1.);}`,
    });
    materials.push(material); const mesh = new Mesh(geometry, material); mesh.frustumCulled = false; scene.add(mesh);
  }
  const collect = () => {
    if (!timer) return;
    if (gl.getParameter(timer.GPU_DISJOINT_EXT)) { disjoint = true; for (const sample of samples) { sample.valid = false; sample.disjoint = true; } }
    for (let i = pending.length - 1; i >= 0; i--) { const item = pending[i]; if (!item || !gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) continue;
      const value = Number(gl.getQueryParameter(item.query, gl.QUERY_RESULT)) / 1e6;
      samples.push({ at: item.at, value, valid: Number.isFinite(value) && !disjoint, disjoint }); gl.deleteQuery(item.query); pending.splice(i, 1);
    }
  };
  return {
    drawsPerFrame, collect,
    draw(at, timed = true) {
      if (disposed || gl.isContextLost()) throw new Error("Three.js fixture context lost");
      collect();
      for (const material of materials) { const uniform = material.uniforms['angle']; if (uniform) uniform.value = at * .001; }
      const query = timed && timer && pending.length < 8 ? gl.createQuery() : null; if (timed && timer && !query) dropped++;
      if (query && timer) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      try { renderer.render(scene, camera); frames++; }
      finally { if (query && timer) { gl.endQuery(timer.TIME_ELAPSED_EXT); pending.push({ query, at }); } }
      if (gl.getError() !== gl.NO_ERROR) throw new Error("Three.js fixture draw failed");
    },
    verify() { verified = verifyPixels(gl); },
    metrics() { return [
      makeMetric({ id: "render.draw-calls-submitted", semantic: "counter", unit: "count", granularity: "event", samples: [{ at: performance.now(), value: draws, valid: true }], source: { tool: "webgl-draw-submission-counter", version: "1", processId: "browser-page" }, clockDomain: "browser-monotonic" }),
      makeMetric({ id: "render.error-free-frames", semantic: "counter", unit: "count", samples: [{ at: performance.now(), value: frames, valid: true }], source: { tool: "gl.getError", version: "WebGL2", processId: "browser-page" }, clockDomain: "browser-monotonic" }),
      makeMetric({ id: "render.verified-nonbackground-pixels", semantic: "counter", unit: "count", samples: [{ at: performance.now(), value: verified, valid: verified > 0 }], source: { tool: "gl.readPixels-post-timing", version: "WebGL2", processId: "browser-page" }, clockDomain: "browser-monotonic" }),
      makeMetric({ id: "render.gpu-duration", semantic: "gpu-duration", unit: "ms", kind: timer ? "measured" : "unavailable", granularity: "per-frame", clockDomain: "browser-monotonic", source: { tool: "webgl-timer-query", version: "1", processId: "browser-page" }, samples: samples.slice().sort((a, b) => a.at - b.at), droppedSamples: dropped + pending.length, unavailableReason: timer ? null : "WebGL GPU timer extension unavailable" }),
    ]; },
    dispose() { if (disposed) return; disposed = true; for (const item of pending) gl.deleteQuery(item.query); pending.length = 0; geometry.dispose(); for (const material of materials) material.dispose(); scene.clear(); renderer.dispose(); gl.drawArrays = originalDraw; renderer.forceContextLoss(); },
  };
}
export function createMovementFixture(level: number): { update: (frame: number) => number; dispose: () => void; objectCount: number } {
  const objectCount = [64, 256, 1024][level - 1] ?? 64;
  const root = new Object3D(); const objects = Array.from({ length: objectCount }, () => new Object3D());
  for (const object of objects) root.add(object);
  return { objectCount, update(frame) { let checksum = 0; for (let i = 0; i < objects.length; i++) { const object = objects[i]; if (!object) continue; const phase = (frame + i) * .01; object.position.set(Math.sin(phase), Math.cos(phase), i * .001); object.rotation.set(phase, phase * .5, phase * .25); } root.updateMatrixWorld(true); for (const object of objects) checksum += object.matrixWorld.elements[12] ?? 0; return Math.abs(checksum); }, dispose() { root.clear(); objects.length = 0; } };
}
function makeGlb(): ArrayBuffer {
  const binary = new Float32Array([-.8, -.65, 0, .8, -.65, 0, 0, .8, 0]);
  const doc = { asset: { version: "2.0", generator: "OpenClinXR bounded capacity fixture v1" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }], materials: [{ pbrMetallicRoughness: { baseColorFactor: [.25, .6, .95, 1], metallicFactor: 0, roughnessFactor: 1 }, emissiveFactor: [.25, .6, .95], doubleSided: true }], buffers: [{ byteLength: binary.byteLength }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binary.byteLength }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-.8, -.65, 0], max: [.8, .8, 0] }] };
  const json = new TextEncoder().encode(JSON.stringify(doc)); const length = Math.ceil(json.length / 4) * 4;
  const result = new ArrayBuffer(12 + 8 + length + 8 + binary.byteLength); const view = new DataView(result);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, result.byteLength, true);
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true); new Uint8Array(result, 20, length).fill(32); new Uint8Array(result, 20, json.length).set(json);
  view.setUint32(20 + length, binary.byteLength, true); view.setUint32(24 + length, 0x004e4942, true); new Uint8Array(result, 28 + length).set(new Uint8Array(binary.buffer));
  return result;
}
/** In-memory generated GLB: real parsing and upload, no external fetch or production asset claim. */
export async function runGlbFixture(canvas: HTMLCanvasElement, level: number, signal: AbortSignal, onPreview?: (dataUrl: string) => void): Promise<CapacityMetric[]> {
  const setup = rendererFor(canvas); if (!setup) return [makeMetric({ id: "asset.glb-first-usable", semantic: "asset-duration", unit: "ms", kind: "unavailable", samples: [], unavailableReason: "WebGL2 unavailable", source, clockDomain: "browser-monotonic" })];
  const { renderer, gl } = setup; const payload = makeGlb(); const start = performance.now(); let scene: Group | undefined;
  try {
    const gltf = await new GLTFLoader().parseAsync(payload, ""); scene = gltf.scene;
    if (signal.aborted) throw new DOMException("GLB probe stopped", "AbortError");
    const parsed = performance.now();
    const clones = [1, 8, 32][level - 1] ?? 1;
    const original = scene.children[0]; if (original) for (let i = 1; i < clones; i++) { const copy = original.clone(); copy.position.x = (i % 4) * .03; scene.add(copy); }
    const camera = new PerspectiveCamera(50, 1, .1, 10); camera.position.z = 2.5;
    renderer.compile(scene, camera); const prepared = performance.now();
    renderer.render(scene, camera); const submitted = performance.now(); const pixels = verifyPixels(gl); const usable = performance.now();
    onPreview?.(canvas.toDataURL("image/png"));
    return [
      measured("asset.glb-parse", "asset-duration", "ms", [{ at: parsed, value: parsed - start, valid: true }]),
      measured("asset.glb-driver-prepare", "asset-duration", "ms", [{ at: prepared, value: prepared - parsed, valid: true }]),
      measured("asset.glb-first-render-submit", "cpu-duration", "ms", [{ at: submitted, value: submitted - prepared, valid: true }]),
      measured("asset.glb-readback-after-submit", "asset-duration", "ms", [{ at: usable, value: usable - submitted, valid: true }]),
      measured("asset.glb-first-usable", "asset-duration", "ms", [{ at: usable, value: usable - start, valid: true }]),
      measured("asset.glb-encoded-bytes", "bytes", "bytes", [{ at: usable, value: payload.byteLength, valid: true }]),
      measured("asset.glb-rendered-instances", "counter", "count", [{ at: usable, value: clones, valid: renderer.info.render.calls === clones }]),
      measured("asset.glb-verified-pixels", "counter", "count", [{ at: usable, value: pixels, valid: pixels > 0 }]),
    ];
  } finally {
    const geometries = new Set<BufferGeometry>(); const materials = new Set<Material>();
    scene?.traverse((object) => { if (object instanceof Mesh) { geometries.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); } });
    for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose(); scene?.clear(); renderer.dispose(); renderer.forceContextLoss();
  }
}
