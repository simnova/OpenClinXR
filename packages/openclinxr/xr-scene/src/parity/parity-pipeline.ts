/**
 * Aisha-parity render pipeline (lever b + c): MSAA / SMAA / SSAA and GTAO.
 *
 * - msaa: EffectComposer over a WebGLRenderTarget with samples=8.
 * - smaa: EffectComposer + SMAAPass.
 * - ssaa: scene at 2x into an HDR target, exact 2x2 box-downsample to a 1x
 *   linear target, then a tone-mapped basic quad to the canvas (tone mapping
 *   + sRGB apply only on the screen pass, per WebGLPrograms).
 * - ao gtao: GTAOPass with recorded radius/blendIntensity.
 * Direct path (no aa, no ao): plain renderer.render, pixel-identical default.
 */

import {
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type WebGLRenderer,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import type { ParityAo, ParityLevers, ParitySsaa } from "./parity-types.js";

export type PipelineReadback = {
  mode: "direct" | "composer-msaa" | "composer-smaa" | "ssaa-box2x" | "ssaa-kernel" | "composer-ao-only";
  samples?: number | undefined;
  gtao?: { radius: number; blendIntensity: number } | null | undefined;
  bufferSizes?: { render: [number, number] } | undefined;
  /** SSAA kernel path only: super-sample factor + kernel id. */
  ssaa?: { scale: number; filter: string } | undefined;
};

export function needsComposer(parity: ParityLevers | undefined): boolean {
  return parity?.aa != null || parity?.ao != null;
}

export type ParityPipeline = {
  renderFrame: () => void;
  readback: PipelineReadback;
  dispose: () => void;
};

/** Exact 2x2 box downsample (linear in, linear out, no tone mapping here). */
function makeBoxDownsampler(srcTexelX: number, srcTexelY: number): {
  scene: Scene;
  camera: OrthographicCamera;
  material: ShaderMaterial;
} {
  const material = new ShaderMaterial({
    uniforms: {
      tSrc: { value: null },
      uTexel: { value: new Vector2(srcTexelX, srcTexelY) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc;
      uniform vec2 uTexel;
      varying vec2 vUv;
      void main() {
        vec3 c0 = texture2D( tSrc, vUv + vec2( -0.25, -0.25 ) * uTexel ).rgb;
        vec3 c1 = texture2D( tSrc, vUv + vec2(  0.25, -0.25 ) * uTexel ).rgb;
        vec3 c2 = texture2D( tSrc, vUv + vec2( -0.25,  0.25 ) * uTexel ).rgb;
        vec3 c3 = texture2D( tSrc, vUv + vec2(  0.25,  0.25 ) * uTexel ).rgb;
        gl_FragColor = vec4( ( c0 + c1 + c2 + c3 ) * 0.25, 1.0 );
      }`,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const quadScene = new Scene();
  const quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  quadScene.add(quad);
  return { scene: quadScene, camera: quadCam, material };
}

function buildSsaa(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  width: number,
  height: number,
  gtao: ParityAo | null,
  ssaa: ParitySsaa | undefined,
): ParityPipeline {
  const scale = ssaa?.scale ?? 2;
  const filter = ssaa?.filter ?? "box";
  if (scale !== 2 && scale !== 3 && scale !== 4) {
    throw new Error(`parity ssaa refuses scale=${String(scale)} (need 2, 3 or 4) — refusing`);
  }
  if (filter !== "box" && filter !== "gauss15") {
    throw new Error(`parity ssaa refuses filter=${String(filter)} (need box or gauss15) — refusing`);
  }
  if (filter === "box" && scale !== 2) {
    throw new Error("parity ssaa box filter is exact-2x2 only — use gauss15 at scale 3/4");
  }
  if (filter === "box") return buildSsaaBox2x(renderer, scene, camera, width, height);
  return gtao
    ? buildSsaaKernelAo(renderer, scene, camera, width, height, scale, gtao)
    : buildSsaaKernel(renderer, scene, camera, width, height, scale);
}

/**
 * Aisha-parity (P2b step 3): scale-3/4 SSAA with the Cycles-like 1.5px
 * Gaussian pixel filter. Each native pixel gathers hires texels within
 * 0.75px native radius, Gaussian-weighted (sigma 0.37), normalized.
 * The tap list is baked into the shader at pass build (no weight uniforms).
 */
function buildGauss15Downsampler(
  width: number,
  height: number,
  scale: number,
): {
  scene: Scene;
  camera: OrthographicCamera;
  material: ShaderMaterial;
  target: WebGLRenderTarget;
} {
  const SIGMA = 0.37;
  const CUTOFF = 0.75;
  const R = Math.ceil(CUTOFF * scale);
  const taps: Array<{ dx: number; dy: number; w: number }> = [];
  let wSum = 0;
  for (let dy = -R; dy <= R; dy += 1) {
    for (let dx = -R; dx <= R; dx += 1) {
      const dn = Math.hypot(dx, dy) / scale;
      if (dn > CUTOFF) continue;
      const w = Math.exp(-0.5 * (dn / SIGMA) * (dn / SIGMA));
      taps.push({ dx, dy, w });
      wSum += w;
    }
  }
  if (taps.length === 0 || !(wSum > 0)) {
    throw new Error("parity ssaa kernel built zero taps — refusing");
  }
  const acc = taps
    .map((t) => `    acc += ${(t.w / wSum).toPrecision(8)} * texture2D( tSrc, vUv + uTexel * vec2( ${t.dx}.0, ${t.dy}.0 ) ).rgb;`)
    .join("\n");
  const material = new ShaderMaterial({
    uniforms: {
      tSrc: { value: null },
      uTexel: { value: new Vector2(1 / (width * scale), 1 / (height * scale)) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSrc;
      uniform vec2 uTexel;
      varying vec2 vUv;
      void main() {
        vec3 acc = vec3( 0.0 );
${acc}
        gl_FragColor = vec4( acc, 1.0 );
      }`,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const quadScene = new Scene();
  const quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  quadScene.add(quad);
  const target = new WebGLRenderTarget(width, height, { type: HalfFloatType });
  return { scene: quadScene, camera: quadCam, material, target };
}

function buildSsaaKernel(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  width: number,
  height: number,
  scale: number,
): ParityPipeline {
  const kernel = buildGauss15Downsampler(width, height, scale);
  const rtHi = new WebGLRenderTarget(width * scale, height * scale, { type: HalfFloatType });
  rtHi.texture.minFilter = LinearFilter;
  rtHi.texture.magFilter = LinearFilter;
  (kernel.material.uniforms["tSrc"] as { value: unknown }).value = rtHi.texture;
  const screenMat = new MeshBasicMaterial({ map: kernel.target.texture });
  const screenScene = new Scene();
  const screenQuad = new Mesh(new PlaneGeometry(2, 2), screenMat);
  screenQuad.frustumCulled = false;
  screenScene.add(screenQuad);
  const screenCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    renderFrame: () => {
      renderer.setRenderTarget(rtHi);
      renderer.render(scene, camera);
      renderer.setRenderTarget(kernel.target);
      renderer.render(kernel.scene, kernel.camera);
      renderer.setRenderTarget(null);
      renderer.render(screenScene, screenCam);
    },
    readback: {
      mode: "ssaa-kernel",
      gtao: null,
      bufferSizes: { render: [width * scale, height * scale] },
      ssaa: { scale, filter: "gauss15" },
    },
    dispose: () => {
      rtHi.dispose();
      kernel.target.dispose();
      kernel.material.dispose();
      screenMat.dispose();
    },
  };
}

/**
 * Aisha-parity (P2b step 3): SSAA kernel + GTAO combined. The composer
 * (RenderPass + GTAOPass, NO OutputPass) renders linear HDR at hires; the
 * 1.5px Gaussian kernel downsamples in linear; the tone-mapped screen quad
 * applies AgX exactly like the box path. No MSAA samples at hires — the
 * super-sample grid is the antialiasing.
 */
function buildSsaaKernelAo(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  width: number,
  height: number,
  scale: number,
  gtao: ParityAo,
): ParityPipeline {
  const composer = new EffectComposer(
    renderer,
    new WebGLRenderTarget(width * scale, height * scale, { type: HalfFloatType }),
  );
  composer.setPixelRatio(1);
  composer.setSize(width * scale, height * scale);
  // The kernel reads composer.readBuffer: the last pass must land in the
  // buffer, not on the canvas (EffectComposer defaults renderToScreen=true).
  composer.renderToScreen = false;
  composer.addPass(new RenderPass(scene, camera));
  const aoPass = new GTAOPass(scene, camera, width * scale, height * scale);
  aoPass.updateGtaoMaterial({ radius: gtao.radius });
  aoPass.blendIntensity = gtao.intensity;
  composer.addPass(aoPass);
  const kernel = buildGauss15Downsampler(width, height, scale);
  (kernel.material.uniforms["tSrc"] as { value: unknown }).value = composer.readBuffer.texture;
  const screenMat = new MeshBasicMaterial({ map: kernel.target.texture });
  const screenScene = new Scene();
  const screenQuad = new Mesh(new PlaneGeometry(2, 2), screenMat);
  screenQuad.frustumCulled = false;
  screenScene.add(screenQuad);
  const screenCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    renderFrame: () => {
      composer.render();
      (kernel.material.uniforms["tSrc"] as { value: unknown }).value = composer.readBuffer.texture;
      renderer.setRenderTarget(kernel.target);
      renderer.render(kernel.scene, kernel.camera);
      renderer.setRenderTarget(null);
      renderer.render(screenScene, screenCam);
    },
    readback: {
      mode: "ssaa-kernel",
      gtao: { radius: gtao.radius, blendIntensity: gtao.intensity },
      bufferSizes: { render: [width * scale, height * scale] },
      ssaa: { scale, filter: "gauss15" },
    },
    dispose: () => {
      composer.dispose();
      kernel.material.dispose();
      kernel.target.dispose();
      screenMat.dispose();
    },
  };
}

function buildSsaaBox2x(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  width: number,
  height: number,
): ParityPipeline {
  const rt2 = new WebGLRenderTarget(width * 2, height * 2, { type: HalfFloatType });
  rt2.texture.minFilter = LinearFilter;
  rt2.texture.magFilter = LinearFilter;
  const rt1 = new WebGLRenderTarget(width, height, { type: HalfFloatType });
  const box = makeBoxDownsampler(1 / (width * 2), 1 / (height * 2));
  (box.material.uniforms["tSrc"] as { value: unknown }).value = rt2.texture;
  const screenMat = new MeshBasicMaterial({ map: rt1.texture });
  const screenScene = new Scene();
  const screenQuad = new Mesh(new PlaneGeometry(2, 2), screenMat);
  screenQuad.frustumCulled = false;
  screenScene.add(screenQuad);
  const screenCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    renderFrame: () => {
      renderer.setRenderTarget(rt2);
      renderer.render(scene, camera);
      renderer.setRenderTarget(rt1);
      renderer.render(box.scene, box.camera);
      renderer.setRenderTarget(null);
      renderer.render(screenScene, screenCam);
    },
    readback: {
      mode: "ssaa-box2x",
      gtao: null,
      bufferSizes: { render: [width * 2, height * 2] },
    },
    dispose: () => {
      rt2.dispose();
      rt1.dispose();
      box.material.dispose();
      screenMat.dispose();
    },
  };
}

function buildComposer(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  width: number,
  height: number,
  aa: "msaa" | "smaa" | undefined,
  gtao: ParityAo | null,
): ParityPipeline {
  const composer =
    aa === "msaa"
      ? new EffectComposer(
          renderer,
          new WebGLRenderTarget(width, height, { samples: 8, type: HalfFloatType }),
        )
      : new EffectComposer(renderer);
  composer.setPixelRatio(1);
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  if (aa === "smaa") composer.addPass(new SMAAPass());
  if (gtao) {
    const pass = new GTAOPass(scene, camera, width, height);
    pass.updateGtaoMaterial({ radius: gtao.radius });
    pass.blendIntensity = gtao.intensity;
    composer.addPass(pass);
  }
  composer.addPass(new OutputPass());
  const rt = composer.renderTarget1 as WebGLRenderTarget & { samples?: number };
  const mode =
    aa === "msaa" ? "composer-msaa" : aa === "smaa" ? "composer-smaa" : "composer-ao-only";
  return {
    renderFrame: () => composer.render(),
    readback: {
      mode,
      samples: typeof rt.samples === "number" ? rt.samples : undefined,
      gtao: gtao ? { radius: gtao.radius, blendIntensity: gtao.intensity } : null,
      bufferSizes: { render: [width, height] },
    },
    dispose: () => composer.dispose(),
  };
}

export function buildParityPipeline(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  parity: ParityLevers | undefined,
  width: number,
  height: number,
): ParityPipeline {
  const gtao = parity?.ao?.kind === "gtao" ? parity.ao : null;
  const aa = parity?.aa ?? null;
  if (!aa && !gtao) {
    return {
      renderFrame: () => renderer.render(scene, camera),
      readback: { mode: "direct", gtao: null },
      dispose: () => {},
    };
  }
  if (aa === "ssaa") return buildSsaa(renderer, scene, camera, width, height, gtao, parity?.ssaa);
  return buildComposer(renderer, scene, camera, width, height, aa ?? undefined, gtao);
}
