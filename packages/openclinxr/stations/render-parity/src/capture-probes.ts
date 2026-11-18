/** Capture probes: PNG compare helpers, live page evidence readers, and the world-normal/material dump scripts (station render-parity). */

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import type { Page } from "./slotted-playwright.js";

export function decodePngFloat(file: string): { w: number; h: number; data: Float32Array } {
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
export function meanAbsDiffFloat(aPath: string, bPath: string): number {
  const a = decodePngFloat(aPath), b = decodePngFloat(bPath);
  if (a.w !== b.w || a.h !== b.h) {
    throw new Error(`meanAbsDiff dimension mismatch: ${aPath} ${a.w}x${a.h} vs ${bPath} ${b.w}x${b.h}`);
  }
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 1) sum += Math.abs(a.data[i]! - b.data[i]!);
  return sum / a.data.length;
}
export async function waitForParityEvidence(page: Page, timeoutMs = 180_000): Promise<Record<string, unknown>> {
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

export async function measureFrameMs(page: Page, frames = 60): Promise<{ medianMs: number; p95Ms: number; samples: number }> {
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

export async function readGpuString(page: Page): Promise<string> {
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
export const WORLD_NORMAL_PROBE_JS = `(() => {  const g = globalThis;
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
export const MATERIAL_DUMP_JS = `(() => {  const g = globalThis;
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
export function hideEvalJs(match: string, hide: boolean): string {
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
