#!/usr/bin/env tsx
/**
 * Aisha-parity runtime capture (lane aisha-parity, P2): renders the SAME
 * shipped Aisha GLB in the isolated-subject lab at the P1a cameras' native
 * resolutions, with the parity levers from a preset JSON.
 *
 * Usage (one preset per invocation, run through the heavy slot):
 *   tsx tools/openclinxr/evidence/aisha-parity/runtime_capture.ts \
 *     --cameras <p1a cameras.json> --out <E dir> --levers baseline
 *   --levers accepts a preset name (presets/<name>.json), a path, or inline JSON.
 *   --masks renders flat P1a-table ID colours into <out>/masks/ (registration).
 *   --normal-pass renders world-normal geometry probes (RGB=N*0.5+0.5,
 *     lighting bypassed) into <out>/<preset>-normal/<cam>.normal.png plus
 *     per-mesh morph/bone state in state.json (G-probe, three side).
 *   --calib renders the P1a chrome/grey spheres (head_front camera) into <out>/calib/.
 *   --calib-sweep <path> sweeps HDRI rotationYDeg (then exposure) for calib mode.
 *   --nohair adds hideHair:true (brows/lashes stay; lab enforces) to beauty specs.
 *   --only <cam,cam> limits cameras (e.g. head_front,head_34 for nohair).
 *
 * Output per preset dir <out>/<preset>/ (or <out>/<preset>-nohair/):
 *   <cam>.png + evidence.json (camera matrices, renderer settings, every
 *   lever readback live from the scene, wall ms, GPU string, 60-frame ms).
 */

import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "../lib/slotted-playwright.js";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";
import { sha256File } from "../skin-realism/runtime-portrait-capture.js";

/**
 * Minimal PNG decoder for 8/16-bit RGB/RGBA (P1a ships PNG16 beauty/calib;
 * canvas screenshots are 8-bit). Returns 0-1 float RGB.
 */
function decodePngFloat(file: string): { w: number; h: number; data: Float32Array } {
  const bytes = readFileSync(file);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let w = 0, h = 0, depth = 0, colour = -1;
  const idat: Uint8Array[] = [];
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    if (type === "IHDR") {
      w = dv.getUint32(off + 8); h = dv.getUint32(off + 12);
      depth = bytes[off + 16]!; colour = bytes[off + 17]!;
    } else if (type === "IDAT") idat.push(bytes.subarray(off + 8, off + 8 + len));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const chans = colour === 0 ? 1 : colour === 2 ? 3 : colour === 4 ? 2 : colour === 6 ? 4 : 0;
  if ((depth !== 8 && depth !== 16) || !chans || !w) throw new Error(`undecodable PNG ${file}`);
  const raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  const bpc = depth === 16 ? 2 : 1;
  const stride = w * chans * bpc;
  const out = new Float32Array(w * h * 3);
  const scale = depth === 16 ? 65535 : 255;
  let prev = new Uint8Array(stride), p = 0;
  const cur = new Uint8Array(stride);
  for (let y = 0; y < h; y += 1) {
    const f = raw[p++]!;
    for (let x = 0; x < stride; x += 1) {
      const rb = raw[p + x]!;
      const a = x >= chans * bpc ? cur[x - chans * bpc]! : 0, b = prev[x]!, c = x >= chans * bpc ? prev[x - chans * bpc]! : 0;
      let v: number;
      if (f === 0) v = rb; else if (f === 1) v = rb + a; else if (f === 2) v = rb + b;
      else if (f === 3) v = rb + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v = rb + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    p += stride; prev = Uint8Array.from(cur);
    for (let x = 0; x < w; x += 1) {
      for (let k = 0; k < 3; k += 1) {
        const ch = k < chans ? k : 0;
        let v: number;
        if (bpc === 2) v = (cur[(x * chans + ch) * 2]! * 256 + cur[(x * chans + ch) * 2 + 1]!) / scale;
        else v = cur[x * chans + ch]! / scale;
        out[(y * w + x) * 3 + k] = v;
      }
    }
  }
  return { w, h, data: out };
}

/** Mean absolute per-channel difference in 0-1 floats. Same dims required. */
function meanAbsDiffFloat(aPath: string, bPath: string): number {
  const a = decodePngFloat(aPath), b = decodePngFloat(bPath);
  if (a.w !== b.w || a.h !== b.h) {
    throw new Error(`meanAbsDiff dimension mismatch: ${aPath} ${a.w}x${a.h} vs ${bPath} ${b.w}x${b.h}`);
  }
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 1) sum += Math.abs(a.data[i]! - b.data[i]!);
  return sum / a.data.length;
}

const HDRI_URL = "/cagematch/aisha-parity/studio_small_09_2k.hdr";
const BODY_GLB = "generated-humanoids/mpfb-ob-patient-aisha.glb";
const PRESETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "presets");

type Vec3 = [number, number, number];

type CameraRec = {
  name: string;
  resolution: [number, number];
  vfov_deg: number;
  near: number;
  far: number;
  three: { position: Vec3; target: Vec3; up: Vec3; quaternion: [number, number, number, number] };
};

type Cli = {
  cameras: string;
  out: string;
  levers: string;
  masks: boolean;
  calib: boolean;
  normalPass: boolean;
  dumpState: boolean;
  calibSweep: string;
  rotations: number[];
  refine: number;
  window: number;
  exposures: number[];
  only: string[];
  nohair: boolean;
  cwd: string;
};

function parseCli(argv: string[]): Cli {
  const cli: Cli = {
    cameras: "",
    out: "",
    levers: "",
    masks: false,
    calib: false,
    normalPass: false,
    dumpState: false,
    calibSweep: "",
    rotations: [0, 90, 180, 270],
    refine: 5,
    window: 20,
    exposures: [],
    only: [],
    nohair: false,
    cwd: process.cwd(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = (): string => {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === "--cameras") cli.cameras = take();
    else if (arg === "--out") cli.out = take();
    else if (arg === "--levers") cli.levers = take();
    else if (arg === "--masks") cli.masks = true;
    else if (arg === "--calib") cli.calib = true;
    else if (arg === "--normal-pass") cli.normalPass = true;
    else if (arg === "--dump-state") cli.dumpState = true;
    else if (arg === "--calib-sweep") cli.calibSweep = take();
    else if (arg === "--rotations") cli.rotations = take().split(",").map(Number);
    else if (arg === "--refine") cli.refine = Number(take());
    else if (arg === "--window") cli.window = Number(take());
    else if (arg === "--exposures") cli.exposures = take().split(",").map(Number);
    else if (arg === "--only") cli.only = take().split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--nohair") cli.nohair = true;
    else if (arg === "--cwd") cli.cwd = take();
    else throw new Error(`unknown arg ${arg}`);
  }
  if (!cli.cameras) throw new Error("--cameras <p1a cameras.json> is required");
  if (!cli.out && !cli.calibSweep) throw new Error("--out <dir> is required (unless --calib-sweep writes its own path)");
  if (!cli.levers && !cli.masks) throw new Error("--levers <preset|json|path> is required (beauty/calib modes)");
  if (cli.masks && cli.calib) throw new Error("--masks and --calib are mutually exclusive");
  if (cli.normalPass && (cli.masks || cli.calib)) {
    throw new Error("--normal-pass is mutually exclusive with --masks/--calib");
  }
  if (cli.dumpState && (cli.masks || cli.calib || cli.normalPass)) {
    throw new Error("--dump-state is mutually exclusive with --masks/--calib/--normal-pass");
  }
  return cli;
}

async function resolveLevers(spec: string): Promise<{ name: string; levers: Record<string, unknown> }> {
  const inline = spec.trim().startsWith("{") ? spec : null;
  if (inline) return { name: "inline", levers: JSON.parse(inline) as Record<string, unknown> };
  const direct = path.isAbsolute(spec) ? spec : path.join(PRESETS_DIR, `${spec}.json`);
  try {
    const raw = await readFile(direct, "utf8");
    return { name: path.basename(direct, ".json"), levers: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    const raw = await readFile(path.resolve(spec), "utf8");
    return { name: path.basename(spec, ".json"), levers: JSON.parse(raw) as Record<string, unknown> };
  }
}

function loadCameras(camerasJson: string): CameraRec[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const raw = JSON.parse(camerasJson) as {
    cameras: Array<{
      name: string;
      resolution: [number, number];
      vfov_deg: number;
      near: number;
      far: number;
      three: CameraRec["three"];
    }>;
  };
  return raw.cameras.map((c) => ({
    name: c.name,
    resolution: c.resolution,
    vfov_deg: c.vfov_deg,
    near: c.near,
    far: c.far,
    three: c.three,
  }));
}

function vsub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vcross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function vnorm(a: Vec3): Vec3 {
  const n = Math.hypot(a[0], a[1], a[2]);
  if (!(n > 0)) throw new Error("zero-length camera vector — refusing");
  return [a[0] / n, a[1] / n, a[2] / n];
}

/** P1a calib placement in three-space: chrome = depth - gap*right, grey = depth + gap*right. */
function calibSpheres(headFront: CameraRec): { radiusM: number; chromeCenter: Vec3; greyCenter: Vec3 } {
  const fwd = vnorm(vsub(headFront.three.target, headFront.three.position));
  const right = vnorm(vcross(fwd, headFront.three.up));
  const gap = 0.048;
  const t = headFront.three.target;
  return {
    radiusM: 0.035,
    chromeCenter: [t[0] - gap * right[0], t[1] - gap * right[1], t[2] - gap * right[2]],
    greyCenter: [t[0] + gap * right[0], t[1] + gap * right[1], t[2] + gap * right[2]],
  };
}

function buildSpec(cam: CameraRec, opts: {
  levers: Record<string, unknown>;
  masks: boolean;
  calibSpheres: { radiusM: number; chromeCenter: Vec3; greyCenter: Vec3 } | null;
  nohair: boolean;
}): Record<string, unknown> {
  const cameraOverride = {
    position: cam.three.position,
    target: cam.three.target,
    up: cam.three.up,
    vfovDeg: cam.vfov_deg,
    width: cam.resolution[0],
    height: cam.resolution[1],
    near: cam.near,
    far: cam.far,
  };
  if (opts.masks) {
    return {
      subjectId: "aisha-parity",
      subjectKind: "glb",
      bodyGlb: BODY_GLB,
      skinShadeLoader: true,
      cameraOverride,
      masks: true,
      ...(opts.nohair ? { hideHair: true } : {}),
    };
  }
  const { rotationYDeg, intensity, ...parityLevers } = opts.levers as {
    rotationYDeg?: number;
    intensity?: number;
    [k: string]: unknown;
  };
  const spec: Record<string, unknown> = {
    subjectId: "aisha-parity",
    subjectKind: "glb",
    bodyGlb: BODY_GLB,
    skinShadeLoader: true,
    cameraOverride,
    rigOverride: {
      hdri: {
        url: HDRI_URL,
        rotationYDeg: rotationYDeg ?? 0,
        intensity: intensity ?? 1,
        background: true,
      },
    },
    parity: {
      toneMapping: "AgX",
      exposure: 1,
      ...parityLevers,
    },
    ...(opts.nohair ? { hideHair: true } : {}),
  };
  if (opts.calibSpheres) {
    (spec as Record<string, unknown>)["calib"] = { spheres: opts.calibSpheres };
  }
  return spec;
}

function subjectUrl(baseUrl: string, spec: Record<string, unknown>): string {
  const params = new URLSearchParams();
  params.set("subject", JSON.stringify(spec));
  return `${baseUrl.replace(/\/?$/, "/")}isolated-subject.html?${params.toString()}`;
}

async function waitForParityEvidence(page: Page, timeoutMs = 180_000): Promise<Record<string, unknown>> {
  await page.waitForFunction(
    () => {
      const g = globalThis as unknown as {
        __openClinXrIsolatedSubjectEvidence?: Record<string, unknown>;
        document: { querySelector(sel: string): { textContent: string | null } | null };
      };
      const evidence = g.__openClinXrIsolatedSubjectEvidence as
        | { parity?: unknown; meshCount?: unknown }
        | undefined;
      if (evidence && typeof evidence === "object" && "parity" in evidence && evidence.parity) {
        return true;
      }
      const app = g.document.querySelector("#app");
      const text = app?.textContent ?? "";
      if (text.includes("Isolated subject lab error")) return true;
      return false;
    },
    undefined,
    { timeout: timeoutMs },
  );
  const evidence = (await page.evaluate(
    () =>
      (globalThis as unknown as { __openClinXrIsolatedSubjectEvidence?: unknown })
        .__openClinXrIsolatedSubjectEvidence,
  )) as Record<string, unknown>;
  const appText = await page.evaluate(
    () =>
      (globalThis as unknown as { document: { querySelector(s: string): { textContent: string | null } | null } })
        .document.querySelector("#app")?.textContent ?? "",
  );
  if (!evidence || typeof evidence !== "object" || !("parity" in evidence)) {
    throw new Error(`lab produced no parity evidence (page says: ${String(appText).slice(0, 500)})`);
  }
  return evidence;
}

async function measureFrameMs(page: Page, frames = 60): Promise<{ medianMs: number; p95Ms: number; samples: number }> {
  const deltas = (await page.evaluate(
    (n: number) => {
      const g = globalThis as unknown as {
        __openClinXrIsolatedRenderFrame?: () => void;
        performance: { now(): number };
      };
      if (!g.__openClinXrIsolatedRenderFrame) throw new Error("no __openClinXrIsolatedRenderFrame");
      const out: number[] = [];
      for (let i = 0; i < n; i += 1) {
        const a = g.performance.now();
        g.__openClinXrIsolatedRenderFrame();
        out.push(g.performance.now() - a);
      }
      return out;
    },
    frames,
  )) as unknown as number[];
  const sorted = [...deltas].sort((a, b) => a - b);
  const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? -1;
  return { medianMs: q(0.5), p95Ms: q(0.95), samples: deltas.length };
}

async function readGpuString(page: Page): Promise<string> {
  return (await page.evaluate(
    () => {
      const g = globalThis as unknown as { document: { createElement(t: string): unknown } };
      const canvas = g.document.createElement("canvas") as unknown as {
        getContext(t: string): unknown;
      };
      const gl = canvas.getContext("webgl2") as unknown as {
        getExtension(n: string): { UNMASKED_RENDERER_WEBGL: number } | null;
        getParameter(p: number): string;
      } | null;
      if (!gl) return "no-webgl2-context";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      if (!ext) return "debug-renderer-info-unavailable";
      return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    },
  )) as unknown as string;
}

async function captureCamera(opts: {
  page: Page;
  baseUrl: string;
  cam: CameraRec;
  spec: Record<string, unknown>;
  pngPath: string;
}): Promise<{ evidence: Record<string, unknown>; frameMs: { medianMs: number; p95Ms: number; samples: number } }> {
  const [w, h] = opts.cam.resolution;
  await opts.page.setViewportSize({ width: w, height: h });
  await opts.page.goto(subjectUrl(opts.baseUrl, opts.spec), { waitUntil: "domcontentloaded", timeout: 120_000 });
  const evidence = await waitForParityEvidence(opts.page);
  await mkdir(path.dirname(opts.pngPath), { recursive: true });
  const canvas = opts.page.locator("#isolated-subject-capture-canvas");
  if ((await canvas.count()) === 0) throw new Error(`capture canvas missing for ${opts.cam.name} — refusing`);
  await canvas.screenshot({ path: opts.pngPath });
  const dims = decodePngFloat(opts.pngPath);
  if (dims.w !== w || dims.h !== h) {
    throw new Error(
      `capture ${opts.cam.name} is ${dims.w}x${dims.h}, camera wants ${w}x${h} — refusing (registration needs exact pixels)`,
    );
  }
  const frameMs = await measureFrameMs(opts.page, 60);
  return { evidence, frameMs };
}

/**
 * G-probe: swap every mesh material for a world-normal emitter
 * (RGB = worldN*0.5+0.5, lighting bypassed, normal/bump maps dropped so the
 * pass measures GEOMETRY, not shading detail), null the scene background so
 * the lab clear colour is the only background, and dump per-mesh morph/bone
 * state. Runs inside the page: no lab source changes, restored never (the
 * page is discarded after the screenshot). Materials whose shader lacks the
 * opaque_fragment/normal markers keep their (cloned, un-tonemapped) material
 * and are recorded in `skipped`.
 */
const WORLD_NORMAL_PROBE_JS = `(() => {  const g = globalThis;
  const root = g.__openClinXrIsolatedSceneRoot;
  if (!root || typeof root.traverse !== "function") throw new Error("no isolated scene root");
  const out = { isScene: !!root.isScene, meshes: [], skipped: [] };
  if (root.isScene) root.background = null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const wasArray = Array.isArray(o.material);
    const list = wasArray ? o.material : [o.material];
    const rec = {
      name: o.name || "(unnamed)",
      verts: o.geometry && o.geometry.attributes && o.geometry.attributes.position
        ? o.geometry.attributes.position.count : -1,
      skinned: !!o.isSkinnedMesh,
      mats: [],
      bones: null,
      morphs: null,
    };
    if (o.isSkinnedMesh && o.skeleton && o.skeleton.bones) {
      rec.bones = o.skeleton.bones.map((b) => b.name);
    }
    if (o.morphTargetInfluences) {
      rec.morphs = {
        names: o.morphTargetDictionary ? Object.keys(o.morphTargetDictionary) : [],
        values: Array.from(o.morphTargetInfluences),
      };
    }
    const swapped = list.map((m) => {
      const props = m && m.isMaterial
        ? {
          type: m.type,
          side: m.side,
          transparent: !!m.transparent,
          opacity: m.opacity,
          alphaTest: m.alphaTest,
          depthWrite: !!m.depthWrite,
          flatShading: !!m.flatShading,
          hasMap: !!(m.map || m.emissiveMap),
          meshVisible: o.visible !== false,
        }
        : null;
      rec.mats.push(props);
      if (!m || !m.isMaterial || typeof m.clone !== "function") return m;
      const c = m.clone();
      c.toneMapped = false;
      if ("normalMap" in c) c.normalMap = null;
      if ("bumpMap" in c) c.bumpMap = null;
      c.onBeforeCompile = (sh) => {
        if (typeof sh.fragmentShader === "string"
          && sh.fragmentShader.indexOf("#include <opaque_fragment>") !== -1
          && sh.fragmentShader.indexOf("normal_fragment_begin") !== -1) {
          sh.fragmentShader = sh.fragmentShader.replace(
            "#include <opaque_fragment>",
            "vec3 gpwN = inverseTransformDirection(normal, viewMatrix); gl_FragColor = vec4(gpwN * 0.5 + 0.5, 1.0);",
          );
          const acc = g.__openClinXrNormalPatched || (g.__openClinXrNormalPatched = []);
          acc.push(o.name + "|" + String(m.type));
        } else {
          const acc = g.__openClinXrNormalSkipped || (g.__openClinXrNormalSkipped = []);
          acc.push(o.name + "|" + String((m && m.type) || "?"));
        }
      };
      c.needsUpdate = true;
      return c;
    });
    o.material = wasArray ? swapped : swapped[0];
    out.meshes.push(rec);
  });
  out.skipped = g.__openClinXrNormalSkipped || [];
  out.patched = g.__openClinXrNormalPatched || [];
  if (typeof g.__openClinXrIsolatedRenderFrame === "function") g.__openClinXrIsolatedRenderFrame();
  out.patched = g.__openClinXrNormalPatched || [];
  out.skipped = g.__openClinXrNormalSkipped || [];
  return out;
})()`;

/** Step-2+ readback: per-mesh live material props + scene lights/env (read-only). */
const MATERIAL_DUMP_JS = `(() => {  const g = globalThis;
  const root = g.__openClinXrIsolatedSceneRoot;
  if (!root || typeof root.traverse !== "function") throw new Error("no isolated scene root");
  const matProps = (m) => {
    if (!m || !m.isMaterial) return null;
    const rec = { class: m.type };
    const cols = ["color", "emissive", "specularColor", "sheenColor", "attenuationColor"];
    for (const k of cols) {
      if (m[k] && typeof m[k].getHexString === "function") rec[k] = "#" + m[k].getHexString();
    }
    const nums = ["roughness", "metalness", "emissiveIntensity", "envMapIntensity",
      "specularIntensity", "clearcoat", "clearcoatRoughness", "sheen", "sheenRoughness",
      "opacity", "alphaTest", "side", "ior", "thickness", "transmission",
      "iridescence", "flatShading", "vertexColors", "toneMapped", "depthWrite",
      "normalScaleX", "normalScaleY"];
    for (const k of nums) {
      if (k === "normalScaleX") rec[k] = m.normalScale ? m.normalScale.x : null;
      else if (k === "normalScaleY") rec[k] = m.normalScale ? m.normalScale.y : null;
      else if (m[k] !== undefined) rec[k] = m[k];
    }
    const maps = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap",
      "alphaMap", "aoMap", "bumpMap", "clearcoatMap", "sheenColorMap"];
    for (const k of maps) rec["has_" + k] = !!(m[k] && m[k].isTexture);
    rec.transparent = !!m.transparent;
    return rec;
  };
  const out = { meshes: [], lights: [], env: null };
  root.traverse((o) => {
    if (o.isMesh) {
      const list = Array.isArray(o.material) ? o.material : [o.material];
      out.meshes.push({
        name: o.name || "(unnamed)",
        visible: o.visible !== false,
        skinned: !!o.isSkinnedMesh,
        hasNormalAttr: !!(o.geometry && o.geometry.attributes && o.geometry.attributes.normal),
        morphs: o.morphTargetInfluences ? Array.from(o.morphTargetInfluences) : null,
        mats: list.map(matProps),
      });
    }
    if (o.isLight) {
      out.lights.push({
        name: o.name || o.type, type: o.type,
        color: o.color ? "#" + o.color.getHexString() : null,
        intensity: o.intensity, position: o.position ? [o.position.x, o.position.y, o.position.z] : null,
      });
    }
  });
  if (root.isScene) {
    out.env = {
      background: root.background ? (root.background.isTexture ? "texture" : String(root.background)) : null,
      backgroundIntensity: root.backgroundIntensity,
      environmentIntensity: root.environmentIntensity,
    };
  }
  for (const k of ["__openClinXrIsolatedRenderer", "__openClinXrRenderer"]) {
    const r = g[k];
    if (r && r.isWebGLRenderer) {
      out.renderer = {
        toneMapping: r.toneMapping, toneMappingExposure: r.toneMappingExposure,
        outputColorSpace: r.outputColorSpace, shadowMapEnabled: r.shadowMap ? r.shadowMap.enabled : null,
        shadowMapType: r.shadowMap ? r.shadowMap.type : null,
      };
      break;
    }
  }
  return out;
})()`;

/** Isolation screenshots: hide meshes whose name contains `match`, re-render. */
function hideEvalJs(match: string, hide: boolean): string {
  return `(() => {
  const g = globalThis;
  const root = g.__openClinXrIsolatedSceneRoot;
  if (!root || typeof root.traverse !== "function") throw new Error("no isolated scene root");
  root.traverse((o) => {
    if (o.isMesh && o.name.indexOf("${match}") !== -1) o.visible = ${hide ? "false" : "true"};
  });
  if (typeof g.__openClinXrIsolatedRenderFrame === "function") g.__openClinXrIsolatedRenderFrame();
  return true;
})()`;
}

export async function runRuntimeCapture(argv: string[]): Promise<void> {
  const cli = parseCli(argv);
  const outAbs = cli.out ? path.resolve(cli.cwd, cli.out) : null;
  const camerasJson = await readFile(path.resolve(cli.cwd, cli.cameras), "utf8");
  const cameras = loadCameras(camerasJson).filter((c) => cli.only.length === 0 || cli.only.includes(c.name));
  if (cameras.length === 0) throw new Error("--only matched no cameras — refusing");
  const headFront = loadCameras(camerasJson).find((c) => c.name === "head_front");
  if (!headFront) throw new Error("head_front camera missing from cameras.json — refusing");

  let server: Awaited<ReturnType<typeof spawnPortlessDevServer>> | null = null;
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd: cli.cwd, readyTimeoutMs: 180_000 });
    const hdriRes = await fetch(new URL(HDRI_URL, server.url));
    const hdriBytes = Number(hdriRes.headers.get("content-length") ?? "0");
    if (!hdriRes.ok || hdriBytes < 1_000_000) {
      throw new Error(`HDRI unreachable at ${HDRI_URL} (status ${hdriRes.status}, ${hdriBytes} bytes) — refusing`);
    }
    await hdriRes.arrayBuffer();
    const serverUrl = server.url;
    const primaryLaunch = chromium.launch.bind(chromium, { headless: true, channel: "chromium", args: ["--use-angle=metal"] });
    const fallbackLaunch = chromium.launch.bind(chromium, { headless: true, args: ["--use-angle=metal"] });
    let gpuLaunch = "";
    const resilientLaunch = async (): Promise<Awaited<ReturnType<typeof chromium.launch>>> => {
      try {
        const primary = await primaryLaunch();
        gpuLaunch = "channel:chromium --use-angle=metal";
        return primary;
      } catch {
        const fallback = await fallbackLaunch();
        gpuLaunch = "fallback default-chromium --use-angle=metal";
        return fallback;
      }
    };
    await createLocalComputeServices({ browserLaunch: resilientLaunch }).sceneCapture.withBrowser("aisha-parity:runtime-capture", async (launched) => {
      const browser = launched as Awaited<ReturnType<typeof chromium.launch>>;
      const page = await browser.newPage({ viewport: { width: 1536, height: 1536 }, deviceScaleFactor: 1 });
    const gpu = await readGpuString(page);

    if (cli.calibSweep) {
      const sweepTrials: Array<{ rotationYDeg: number; exposure: number; meanAbsDiff: number; png: string }> = [];
      const sweepPath = path.resolve(cli.calibSweep);
      const p1aCalib = path.join(
        path.dirname(path.resolve(cli.cwd, cli.cameras)),
        "calib",
        "spheres.png",
      );
      const flushSweep = async (): Promise<void> => {
        const ranked = [...sweepTrials].sort((a, b) => a.meanAbsDiff - b.meanAbsDiff);
        await mkdir(path.dirname(sweepPath), { recursive: true });
        await writeFile(
          sweepPath,
          `${JSON.stringify(
            {
              p1aCalib,
              headFrontCamera: headFront.name,
              spheres: calibSpheres(headFront),
              trials: sweepTrials,
              chosen: ranked.length > 0
                ? {
                    rotationYDeg: ranked[0]!.rotationYDeg,
                    exposure: ranked[0]!.exposure,
                    meanAbsDiff: ranked[0]!.meanAbsDiff,
                  }
                : null,
              gpu,
              gpuLaunch,
            },
            null,
            2,
          )}\n`,
        );
      };
      const rotations = [...cli.rotations];
      const runCalib = async (rotationYDeg: number, exposure: number, tag: string): Promise<number> => {
        const pngPath = path.join(path.dirname(sweepPath), `sweep-${tag}.png`);
        try {
          const existing = decodePngFloat(pngPath);
          if (existing.w === headFront.resolution[0] && existing.h === headFront.resolution[1]) {
            const diff = meanAbsDiffFloat(pngPath, p1aCalib);
            console.log(`[sweep] reuse ${tag}: meanAbsDiff=${diff.toFixed(5)}`);
            sweepTrials.push({ rotationYDeg, exposure, meanAbsDiff: diff, png: pngPath });
            return diff;
          }
        } catch {
          // No usable prior capture — render it.
        }
        console.log(`[sweep] capture ${tag} (rot=${rotationYDeg} exp=${exposure}) ...`);
        const spec = buildSpec(headFront, {
          levers: { rotationYDeg, exposure },
          masks: false,
          calibSpheres: calibSpheres(headFront),
          nohair: false,
        });
        await captureCamera({ page, baseUrl: server!.url, cam: headFront, spec, pngPath });
        const diff = meanAbsDiffFloat(pngPath, p1aCalib);
        console.log(`[sweep] done ${tag}: meanAbsDiff=${diff.toFixed(5)}`);
        sweepTrials.push({ rotationYDeg, exposure, meanAbsDiff: diff, png: pngPath });
        await flushSweep();
        return diff;
      };
      for (const r of rotations) {
        await runCalib(r, 1, `rot${r}`);
      }
      let best = sweepTrials.reduce((a, b) => (a.meanAbsDiff <= b.meanAbsDiff ? a : b));
      const step = cli.refine;
      for (let r = best.rotationYDeg - cli.window; r <= best.rotationYDeg + cli.window; r += step) {
        const norm = ((Math.round(r) % 360) + 360) % 360;
        if (rotations.includes(norm)) continue;
        await runCalib(norm, 1, `rot${norm}`);
      }
      best = sweepTrials.filter((t) => t.exposure === 1).reduce((a, b) => (a.meanAbsDiff <= b.meanAbsDiff ? a : b));
      const exposures = cli.exposures.length > 0 ? cli.exposures : [best ? 1 : 1];
      if (cli.exposures.length > 0) {
        for (const e of cli.exposures) {
          await runCalib(best.rotationYDeg, e, `rot${best.rotationYDeg}-exp${e}`);
        }
        best = sweepTrials.reduce((a, b) => (a.meanAbsDiff <= b.meanAbsDiff ? a : b));
      }
      const sweepOut = {
        p1aCalib,
        headFrontCamera: headFront.name,
        spheres: calibSpheres(headFront),
        trials: sweepTrials,
        chosen: { rotationYDeg: best.rotationYDeg, exposure: best.exposure, meanAbsDiff: best.meanAbsDiff },
        gpu,
        gpuLaunch,
        partial: false,
      };
      await mkdir(path.dirname(sweepPath), { recursive: true });
      await writeFile(sweepPath, `${JSON.stringify(sweepOut, null, 2)}\n`);
      return;
    }

    if (cli.masks) {
      const dir = path.join(outAbs!, "masks");
      const perCam: Record<string, unknown> = {};
      for (const cam of cameras) {
        const spec = buildSpec(cam, { levers: {}, masks: true, calibSpheres: null, nohair: cli.nohair });
        const pngPath = path.join(dir, `${cam.name}.png`);
        const { evidence, frameMs } = await captureCamera({ page, baseUrl: serverUrl, cam, spec, pngPath });
        perCam[cam.name] = { png: pngPath, evidence, frameMs, sha256: sha256File(pngPath) };
      }
      await writeFile(
        path.join(dir, "evidence.json"),
        `${JSON.stringify({ mode: "masks", gpu, gpuLaunch, cameras: perCam }, null, 2)}\n`,
      );
      return;
    }

    if (cli.calib && outAbs) {
      const { name: presetName, levers } = await resolveLevers(cli.levers);
      const dir = path.join(outAbs, presetName);
      const spec = buildSpec(headFront, {
        levers,
        masks: false,
        calibSpheres: calibSpheres(headFront),
        nohair: cli.nohair,
      });
      const pngPath = path.join(dir, "spheres.png");
      const { evidence, frameMs } = await captureCamera({ page, baseUrl: serverUrl, cam: headFront, spec, pngPath });
      await writeFile(
        path.join(dir, "evidence.json"),
        `${JSON.stringify({ mode: "calib", preset: presetName, levers, gpu, gpuLaunch, evidence, frameMs, sha256: sha256File(pngPath) }, null, 2)}\n`,
      );
      return;
    }

    if (cli.dumpState && outAbs) {
      const { name: presetName, levers } = await resolveLevers(cli.levers);
      const dir = path.join(outAbs, cli.nohair ? `${presetName}-nohair-dump` : `${presetName}-dump`);
      const perCam: Record<string, unknown> = {};
      for (const cam of cameras) {
        const spec = buildSpec(cam, { levers, masks: false, calibSpheres: null, nohair: cli.nohair });
        const [w, h] = cam.resolution;
        await page.setViewportSize({ width: w, height: h });
        await page.goto(subjectUrl(serverUrl, spec), { waitUntil: "domcontentloaded", timeout: 120_000 });
        const evidence = await waitForParityEvidence(page);
        const dump = (await page.evaluate(MATERIAL_DUMP_JS)) as Record<string, unknown>;
        perCam[cam.name] = { dump, evidence };
        console.log(`[dump] done ${cam.name}: meshes=${(dump["meshes"] as unknown[]).length}`);
      }
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "dump.json"), `${JSON.stringify({ mode: "dump-state", preset: presetName, levers, cameras: perCam }, null, 2)}\n`);
      return;
    }

    if (cli.normalPass && outAbs) {
      const { name: presetName, levers } = await resolveLevers(cli.levers);
      const dir = path.join(outAbs, cli.nohair ? `${presetName}-nohair-normal` : `${presetName}-normal`);
      const perCam: Record<string, unknown> = {};
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        try {
          if (msg.type() === "error" || msg.type() === "warning") {
            consoleErrors.push(`[${msg.type()}] ${msg.text()}`.slice(0, 500));
          }
        } catch {
          // ignore listener faults
        }
      });
      page.on("pageerror", (e) => {
        consoleErrors.push(`[pageerror] ${String(e && (e as Error).message ? (e as Error).message : e)}`.slice(0, 500));
      });
      for (const cam of cameras) {
        const spec = buildSpec(cam, { levers, masks: false, calibSpheres: null, nohair: cli.nohair });
        const [w, h] = cam.resolution;
        await page.setViewportSize({ width: w, height: h });
        await page.goto(subjectUrl(serverUrl, spec), { waitUntil: "domcontentloaded", timeout: 120_000 });
        const evidence = await waitForParityEvidence(page);
        const state = (await page.evaluate(WORLD_NORMAL_PROBE_JS)) as Record<string, unknown>;
        const pngPath = path.join(dir, `${cam.name}.normal.png`);
        await mkdir(path.dirname(pngPath), { recursive: true });
        const canvas = page.locator("#isolated-subject-capture-canvas");
        if ((await canvas.count()) === 0) throw new Error(`capture canvas missing for ${cam.name} — refusing`);
        await canvas.screenshot({ path: pngPath });
        const dims = decodePngFloat(pngPath);
        if (dims.w !== w || dims.h !== h) {
          throw new Error(
            `normal capture ${cam.name} is ${dims.w}x${dims.h}, camera wants ${w}x${h} — refusing`,
          );
        }
        perCam[cam.name] = { png: pngPath, state, evidence, sha256: sha256File(pngPath), consoleErrors };
        console.log(`[normal] done ${cam.name}: meshes=${(state["meshes"] as unknown[]).length}`);
        if (cam.name === "body_front") {
          await page.evaluate(hideEvalJs("toigo_t_shirt", true));
          const noShirtPath = path.join(dir, `${cam.name}.noshirt.normal.png`);
          await canvas.screenshot({ path: noShirtPath });
          await page.evaluate(hideEvalJs("toigo_t_shirt", false));
          await page.evaluate(hideEvalJs("mpfb_ob_patient_aisha_v1_body", true));
          const noBodyPath = path.join(dir, `${cam.name}.nobody.normal.png`);
          await canvas.screenshot({ path: noBodyPath });
          await page.evaluate(hideEvalJs("mpfb_ob_patient_aisha_v1_body", false));
          perCam[cam.name] = { ...(perCam[cam.name] as Record<string, unknown>), noShirtPng: noShirtPath, noBodyPng: noBodyPath };
        }
      }
      await writeFile(path.join(dir, "state.json"), `${JSON.stringify({ mode: "normal-pass", preset: presetName, levers, cameras: perCam }, null, 2)}\n`);
      return;
    }

    const { name: presetName, levers } = await resolveLevers(cli.levers);
    const dir = path.join(outAbs!, cli.nohair ? `${presetName}-nohair` : presetName);
    const perCam: Record<string, unknown> = {};
    for (const cam of cameras) {
      const spec = buildSpec(cam, { levers, masks: false, calibSpheres: null, nohair: cli.nohair });
      const pngPath = path.join(dir, `${cam.name}.png`);
      console.log(`[capture] ${presetName}${cli.nohair ? "-nohair" : ""} ${cam.name} ...`);
      const { evidence, frameMs } = await captureCamera({ page, baseUrl: serverUrl, cam, spec, pngPath });
      console.log(`[capture] done ${cam.name}: medianMs=${frameMs.medianMs.toFixed(2)} p95Ms=${frameMs.p95Ms.toFixed(2)}`);
      perCam[cam.name] = { png: pngPath, evidence, frameMs, sha256: sha256File(pngPath) };
    }
    await writeFile(
      path.join(dir, "evidence.json"),
      `${JSON.stringify(
        {
          mode: "beauty",
          preset: presetName,
          nohair: cli.nohair,
          levers,
          hdriUrl: HDRI_URL,
          gpu,
          gpuLaunch,
          captureCommand: `runtime_capture.ts --cameras ${cli.cameras} --out ${cli.out} --levers ${cli.levers}${cli.nohair ? " --nohair" : ""}`,
          cameras: perCam,
        },
        null,
        2,
      )}\n`,
    );
    });
  } finally {
    if (server) await stopPortlessDevServer(server.proc).catch(() => {});
  }
}

const invoked = process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  // lane manager 2026-11-18: the dev-server pipes kept node alive 33 min after the calib sweep finished; exit explicitly.
  await runRuntimeCapture(process.argv.slice(2)).then(() => process.exit(0), (e: unknown) => { console.error(e); process.exit(1); });
}
