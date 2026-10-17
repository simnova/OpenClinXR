// biome-ignore-all lint/suspicious/noExplicitAny: probe uses untyped page globals
// biome-ignore-all lint/style/noNonNullAssertion: probe asserts non-null
/**
 * CARD tsk_6c0405833c1f5952: read back whether the three.js lab applies
 * the eye shell's per-vertex alpha. Renders front frames A/B/C per subject.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../../../evidence/lib/portless-server.js";
import { chromium } from "../../../evidence/lib/slotted-playwright.js";

const STORE = "/Volumes/files/openclinxr-assets/store";
const OUT = `${STORE}/shell-alpha-readback`;
const WORKTREE = process.cwd();

type Subject = {
  key: "aisha" | "body2";
  glbOn: string;
  glbId: string;
  variant: string;
  idVariant: string;
};

const SUBJECTS: Subject[] = [
  {
    key: "aisha",
    glbOn: `${STORE}/shell-iris-spare/r2/aisha-lidconform.glb`,
    glbId: `${OUT}/aisha-id.glb`,
    variant: `${STORE}/shell-iris-spare/r2/ss-aisha-r2.variant.json`,
    idVariant: `${STORE}/shell-iris-spare/r2/ss-aisha-r2-id.variant.json`,
  },
  {
    key: "body2",
    glbOn: `${STORE}/shell-iris-spare/r2/body2-lidconform.glb`,
    glbId: `${OUT}/body2-id.glb`,
    variant: `${STORE}/shell-iris-spare/r2/b2s4-r2.variant.json`,
    idVariant: `${STORE}/shell-iris-spare/r2/b2s4-r2-id.variant.json`,
  },
];

function loadVariant(p: string): any {
  return JSON.parse(readFileSync(p, "utf8"));
}

function prepareSpike(variant: any, glbPath: string) {
  const spikeFiles = new Map<string, { bytes: Buffer; contentType: string }>();
  const glbAbs = glbPath;
  const glbBytes = readFileSync(glbAbs);
  spikeFiles.set("/__spike/model.glb", { bytes: glbBytes, contentType: "model/gltf-binary" });
  const skinOv = { ...((variant.skinOverride ?? {}) as Record<string, unknown>) };
  let texIndex = 0;
  const serveTex = (rel: string): string => {
    const abs = rel;
    const ext = path.extname(abs).toLowerCase();
    const ct = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream";
    const served = `/__spike/tex${texIndex}${ext}`;
    texIndex += 1;
    spikeFiles.set(served, { bytes: readFileSync(abs), contentType: ct });
    return served;
  };
  if (typeof skinOv.baseColorUrl === "string" && skinOv.baseColorUrl.startsWith("/")) {
    skinOv.baseColorUrl = serveTex(skinOv.baseColorUrl);
  }
  if (typeof skinOv.normalUrl === "string" && skinOv.normalUrl.startsWith("/")) {
    skinOv.normalUrl = serveTex(skinOv.normalUrl);
  }
  if (typeof skinOv.roughnessMapUrl === "string" && skinOv.roughnessMapUrl.startsWith("/")) {
    skinOv.roughnessMapUrl = serveTex(skinOv.roughnessMapUrl);
  }
  if (typeof skinOv.aoMapUrl === "string" && skinOv.aoMapUrl.startsWith("/")) {
    skinOv.aoMapUrl = serveTex(skinOv.aoMapUrl);
  }
  const rawMatOvs = (variant.materialOverrides ?? []) as Array<Record<string, unknown>>;
  const matOvs = rawMatOvs.map((ov) => {
    const next = { ...ov };
    for (const key of ["baseColorUrl", "skinShadeCurvatureUrl"]) {
      if (typeof next[key] === "string" && (next[key] as string).startsWith("/")) {
        next[key] = serveTex(next[key] as string);
      }
    }
    return next;
  });
  const bodyGlb = "/__spike/model.glb";
  const spec: Record<string, unknown> = {
    subjectKind: "glb",
    bodyGlb,
    view: "front",
    focus: "head",
    hideHair: true,
    subjectOnly: true,
    renderSize: variant.renderSize ?? 1280,
    portrait: variant.portrait === true,
    productEnvironmentId: variant.productEnvironmentId,
    skinOverride: variant.skinOverride ? skinOv : undefined,
    materialOverrides: matOvs,
    rigOverride: variant.rigOverride ?? undefined,
    yawDegrees: 0,
  };
  return { spikeFiles, spec };
}

const INIT_SCRIPT = `
(() => {
  const patch = (proto) => {
    if (!proto) return;
    const origCreateProgram = proto.createProgram;
    proto.createProgram = function() {
      const p = origCreateProgram.call(this);
      if (!window.__trackedPrograms) window.__trackedPrograms = [];
      window.__trackedPrograms.push({ program: p, fragmentShader: null, vertexShader: null });
      return p;
    };
    const origShaderSource = proto.shaderSource;
    proto.shaderSource = function(shader, source) {
      shader.__source = source;
      return origShaderSource.call(this, shader, source);
    };
    const origCreateShader = proto.createShader;
    proto.createShader = function(type) {
      const sh = origCreateShader.call(this, type);
      if (sh) sh.type = type;
      return sh;
    };
    const origAttachShader = proto.attachShader;
    proto.attachShader = function(program, shader) {
      const rec = (window.__trackedPrograms || []).find((r) => r.program === program);
      if (rec) {
        if (shader.type === this.FRAGMENT_SHADER) rec.fragmentShader = shader;
        if (shader.type === this.VERTEX_SHADER) rec.vertexShader = shader;
      }
      return origAttachShader.call(this, program, shader);
    };
  };
  patch(typeof WebGLRenderingContext !== "undefined" ? WebGLRenderingContext.prototype : null);
  patch(typeof WebGL2RenderingContext !== "undefined" ? WebGL2RenderingContext.prototype : null);
})();
`;

async function captureOne(serverUrl: string, variantPath: string, glbPath: string, outPath: string, manipulate?: (page: any) => Promise<void>) {
  const variant = loadVariant(variantPath);
  const { spikeFiles, spec } = prepareSpike(variant, glbPath);
  const services = createLocalComputeServices({
    browserLaunch: chromium.launch.bind(chromium, {
      headless: true,
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    }),
  });
  let result: { outPath: string; readback: any } | null = null;
  await services.sceneCapture.withBrowser("skin-realism:shell-alpha-readback", async (launched) => {
    const browser = launched as any;
    const page = await browser.newPage({ viewport: { width: 1280, height: 1280 }, deviceScaleFactor: 1 });
  await page.addInitScript(INIT_SCRIPT);
  await page.route("**/__spike/*", async (route: any) => {
    const url = new URL(route.request().url());
    const entry = spikeFiles.get(url.pathname);
    if (entry) {
      await route.fulfill({ status: 200, contentType: entry.contentType, body: entry.bytes });
    } else {
      await route.abort();
    }
  });
  const fullSpec = { ...spec, subjectId: path.basename(outPath), label: path.basename(outPath) };
  // navigate
  const params = new URLSearchParams();
  params.set("subject", JSON.stringify(fullSpec));
  const url = `${serverUrl.replace(/\/?$/, "/")}isolated-subject.html?${params.toString()}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  // wait for evidence
  await page.waitForFunction(() => {
    const g = globalThis as any;
    const ev = g.__openClinXrIsolatedSubjectEvidence;
    if (ev && typeof ev.meshCount === "number" && ev.meshCount > 0) return true;
    const app = g.document?.querySelector?.("#app");
    const text = app?.textContent ?? "";
    if (text.includes("Isolated subject lab error")) throw new Error(text.slice(0, 2000));
    return false;
  }, null, { timeout: 120000 });
  if (manipulate) {
    await manipulate(page);
  }
  // render a few frames
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) (globalThis as any).__openClinXrIsolatedRenderFrame?.();
  });
  const canvas = page.locator("#isolated-subject-capture-canvas");
  await mkdirSync(path.dirname(outPath), { recursive: true });
  if (await canvas.count()) {
    await canvas.screenshot({ path: outPath });
  } else {
    await page.screenshot({ path: outPath });
  }
  // define readback
  const readback = await page.evaluate(() => {
    const g = globalThis as any;
    const root = g.__openClinXrIsolatedSceneRoot;
    let shellInfo: any = null;
    if (root) {
      root.traverse((o: any) => {
        if (shellInfo) return;
        if (!o?.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m && /openclinxr_eye_occlusion_shell/i.test(m.name)) {
            const gg = o.geometry;
            const c = gg?.getAttribute?.("color");
            shellInfo = {
              meshName: o.name,
              materialName: m.name,
              colorItemSize: c ? c.itemSize : null,
              vertexColors: !!m.vertexColors,
              transparent: !!m.transparent,
              depthWrite: !!m.depthWrite,
            };
          }
        }
      });
    }
    const tracked = g.__trackedPrograms || [];
    const nTracked = tracked.length;
    const nFrag = tracked.filter((r:any)=>r.fragmentShader).length;
    const nSource = tracked.filter((r:any)=>r.fragmentShader?.__source).length;
    const srcs = tracked.map((r: any) => r.fragmentShader?.__source).filter(Boolean);
    const joined = srcs.join("\n---\n");
    const useColorAlpha = joined.includes("USE_COLOR_ALPHA");
    const vec4VColor = /varying\s+vec4\s+vColor/.test(joined);
    const sample = (srcs.find((s: string) => /vColor/i.test(s)) || srcs[0] || "").slice(0, 800);
    return { shellInfo, useColorAlpha, vec4VColor, nPrograms: srcs.length, nTracked, nFrag, nSource, sample };
  });
    await browser.close();
    result = { outPath, readback };
  });
  return result!;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  let server: any = null;
  const results: Record<string, any> = {};
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", cwd: WORKTREE, readyTimeoutMs: 180000 });
    const baseUrl = server.url;
    // ID renders (stripped GLB) for each subject
    for (const s of SUBJECTS) {
      const idOut = `${OUT}/${s.key}-id.png`;
      const r = await captureOne(baseUrl, s.idVariant, s.glbId, idOut);
      results[`${s.key}-id`] = r;
      console.log("ID", s.key, idOut);
    }
    // Define readback from aisha A
    let defineReadback: any = null;
    // Beauty states
    for (const s of SUBJECTS) {
      for (const state of ["A", "B", "C"] as const) {
        const outPath = `${OUT}/${s.key}-${state}.png`;
        let manipulate: ((page: any) => Promise<void>) | undefined;
        if (state === "B") {
          manipulate = async (page: any) => {
            await page.evaluate(() => {
              const g = globalThis as any;
              const root = g.__openClinXrIsolatedSceneRoot;
              root?.traverse((o: any) => {
                if (!o?.isMesh) return;
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                for (const m of mats) {
                  if (m && /openclinxr_eye_occlusion_shell/i.test(m.name)) {
                    const c = o.geometry?.getAttribute?.("color");
                    if (c) {
                      for (let i = 0; i < c.count; i++) c.setXYZW(i, c.getX(i), c.getY(i), c.getZ(i), 0);
                      c.needsUpdate = true;
                    }
                  }
                }
              });
              for (let i = 0; i < 4; i++) g.__openClinXrIsolatedRenderFrame?.();
            });
          };
        } else if (state === "C") {
          manipulate = async (page: any) => {
            await page.evaluate(() => {
              const g = globalThis as any;
              const root = g.__openClinXrIsolatedSceneRoot;
              const toRemove: any[] = [];
              root?.traverse((o: any) => {
                if (!o?.isMesh) return;
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                for (const m of mats) {
                  if (m && /openclinxr_eye_occlusion_shell/i.test(m.name)) toRemove.push(o);
                }
              });
              for (const o of toRemove) o.parent?.remove(o);
              for (let i = 0; i < 4; i++) g.__openClinXrIsolatedRenderFrame?.();
            });
          };
        }
        const r = await captureOne(baseUrl, s.variant, s.glbOn, outPath, manipulate);
        results[`${s.key}-${state}`] = r;
        if (state === "A" && s.key === "aisha") defineReadback = r.readback;
        console.log("RENDER", s.key, state, outPath);
      }
    }
    writeFileSync(`${OUT}/probe-readback.json`, JSON.stringify({ defineReadback, results: Object.keys(results) }, null, 2));
  } finally {
    if (server) await stopPortlessDevServer(server.proc);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
