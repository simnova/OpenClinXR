import type { CapacityMetric, MetricSample } from "../types.js";
import { makeMetric } from "../index.js";

/** A deliberately small raw-WebGL fixture. This is neither a Three.js nor an XR workload. */
export interface GraphicsFixture {
  draw: (time: number, timed?: boolean) => void;
  collect: () => void;
  metrics: () => CapacityMetric[];
  verify: () => void;
  dispose: () => void;
  drawsPerFrame: number;
  uploadBitmap?: (bitmap: ImageBitmap) => void;
}
interface TimerExtension { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
export function createGraphicsFixture(canvas: HTMLCanvasElement, level: number): GraphicsFixture | null {
  const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  canvas.width = 384;
  canvas.height = 384;
  const resources: { shaders: WebGLShader[]; queries: WebGLQuery[] } = { shaders: [], queries: [] };
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let uploadTexture: WebGLTexture | null = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const query of resources.queries) gl.deleteQuery(query);
    for (const shader of resources.shaders) gl.deleteShader(shader);
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    if (uploadTexture) gl.deleteTexture(uploadTexture);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
  try {
    const shader = (type: number, source: string) => {
      const result = gl.createShader(type);
      if (!result) throw new Error("Unable to allocate fixture shader");
      resources.shaders.push(result);
      gl.shaderSource(result, source);
      gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error("Fixture shader compilation failed");
      return result;
    };
    program = gl.createProgram();
    if (!program) throw new Error("Unable to allocate fixture program");
    gl.attachShader(program, shader(gl.VERTEX_SHADER, `#version 300 es
      in vec2 p; uniform float angle; uniform vec2 offset;
      void main(){float c=cos(angle),s=sin(angle); gl_Position=vec4(mat2(c,-s,s,c)*p+offset,0.,1.);}`));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float; uniform highp float angle; out vec4 color;
      void main(){ vec2 p=gl_FragCoord.xy/384.; float v=0.;
        for(int i=0;i<${[4, 12, 24][level - 1]};i++){v+=sin(p.x*float(i+1)+angle)*cos(p.y*float(i+1));}
        color=vec4(.2+.15*sin(v),.55+.2*cos(v),.9,1.);}`));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Fixture program linking failed");
    gl.useProgram(program);
    buffer = gl.createBuffer();
    if (!buffer) throw new Error("Unable to allocate fixture geometry");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-.14, -.13, .14, -.13, 0, .16]), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    const angle = gl.getUniformLocation(program, "angle");
    const offset = gl.getUniformLocation(program, "offset");
    const extension = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExtension | null;
    const pending: { query: WebGLQuery; at: number }[] = [];
    const samples: MetricSample[] = [];
    let dropped = 0;
    let draws = 0;
    let checks = 0;
    let renderedPixels = 0;
    let disjointSeen = false;
    const drawsPerFrame = [16, 64, 160][level - 1] ?? 16;
    const collect = () => {
      if (!extension) return;
      const disjoint = Boolean(gl.getParameter(extension.GPU_DISJOINT_EXT));
      if (disjoint) {
        disjointSeen = true;
        for (const sample of samples) { sample.valid = false; sample.disjoint = true; }
      }
      for (let i = pending.length - 1; i >= 0; i--) {
        const item = pending[i];
        if (!item || !gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) continue;
        const value = Number(gl.getQueryParameter(item.query, gl.QUERY_RESULT)) / 1e6;
        samples.push({ at: item.at, value, valid: Number.isFinite(value) && !disjointSeen, disjoint: disjointSeen });
        gl.deleteQuery(item.query);
        resources.queries.splice(resources.queries.indexOf(item.query), 1);
        pending.splice(i, 1);
      }
    };
    return {
      drawsPerFrame,
      uploadBitmap(bitmap) {
        if (disposed || gl.isContextLost()) throw new Error("WebGL context lost during upload");
        uploadTexture ??= gl.createTexture();
        if (!uploadTexture) throw new Error("Unable to allocate upload texture");
        gl.bindTexture(gl.TEXTURE_2D, uploadTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        if (gl.getError() !== gl.NO_ERROR) throw new Error("Asset texture upload failed");
      },
      draw(time, timed = true) {
        if (disposed || gl.isContextLost()) throw new Error("WebGL context lost");
        collect();
        const query = timed && extension && pending.length < 8 ? gl.createQuery() : null;
        if (timed && extension && !query) dropped++;
        if (query && extension) { resources.queries.push(query); gl.beginQuery(extension.TIME_ELAPSED_EXT, query); }
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(.025, .045, .085, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform1f(angle, time * .001);
        for (let i = 0; i < drawsPerFrame; i++) {
          gl.uniform2f(offset, ((i % 8) - 3.5) * .23, ((Math.floor(i / 8) % 8) - 3.5) * .23);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          draws++;
        }
        if (query && extension) { gl.endQuery(extension.TIME_ELAPSED_EXT); pending.push({ query, at: time }); }
        if (gl.getError() !== gl.NO_ERROR) throw new Error("WebGL fixture draw failed");
        checks++;
      },
      collect,
      verify() {
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        for (let i = 2; i < pixels.length; i += 4) if ((pixels[i] ?? 0) > 100) renderedPixels++;
        if (gl.getError() !== gl.NO_ERROR || renderedPixels === 0) throw new Error("Fixture pixel readback found no rendered triangles");
      },
      metrics: () => [
        makeMetric({ id: "render.verified-nonbackground-pixels", semantic: "counter", unit: "count", samples: [{ at: performance.now(), value: renderedPixels, valid: renderedPixels > 0 }], source: { tool: "gl.readPixels-post-timing", version: "WebGL2", processId: "browser-page" }, clockDomain: "browser-monotonic" }),
        makeMetric({ id: "render.gpu-duration", semantic: "gpu-duration", unit: "ms", kind: extension ? "measured" : "unavailable", clockDomain: "browser-monotonic", granularity: "per-frame", source: { tool: "webgl-timer-query", version: "1", processId: "browser-page" }, samples: [...samples].sort((a, b) => a.at - b.at), droppedSamples: dropped + pending.length, unavailableReason: extension ? null : "WebGL GPU timer extension unavailable; CPU submission is separate." }),
        makeMetric({ id: "render.draw-calls-submitted", semantic: "counter", unit: "count", granularity: "event", samples: [{ at: performance.now(), value: draws, valid: true }], source: { tool: "webgl-draw-submission-counter", version: "1", processId: "browser-page" }, clockDomain: "browser-monotonic" }),
        makeMetric({ id: "render.error-free-frames", semantic: "counter", unit: "count", samples: [{ at: performance.now(), value: checks, valid: true }], source: { tool: "gl.getError", version: "WebGL2", processId: "browser-page" }, clockDomain: "browser-monotonic" }),
      ],
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
