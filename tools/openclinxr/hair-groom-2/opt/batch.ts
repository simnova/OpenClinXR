// batch.ts <batch.json> <outDir>: one dev-server boot for many head crops (copy of the lane's EV/sheen/tools/batch.ts with
// import paths for this directory). batch.json: [{ glb, view, outName, rig?: LightRig, hideHair?, matte? }]
// matte:true (A1b): besides <outName> (the colour crop) writes <outName minus .png>-hair.png (body meshes hidden, hair
// meshes only, same camera, same page) and -empty.png (every mesh hidden: the background alone). Matte mask =
// (|hair - empty| > 3/255) & (|colour - nohair| > 3/255), see matte.py. Done with a page-side wrapper around the
// harness-called __openClinXrApplyEquirectEnvironment (runs after the lab settles, before the harness screenshot), so
// isolated-subject-harness.ts, isolated-subject-lab.ts and isolated-subject-rig-variants.ts are untouched.
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium as rawChromium } from "playwright";
import { renderHeadFocusCrops, type HeadCropSpec } from "../../evidence/isolated-subject-harness.js";
import { rigOverrideFor, type LightRig } from "../cards/light_rig.js";
const [file, outDir] = process.argv.slice(2);
const items = JSON.parse(readFileSync(file!, "utf8")) as Array<{ glb: string; view: string; outName: string; rig?: LightRig; hideHair?: boolean; matte?: boolean }>;

if (items.some((it) => it.matte)) {
  let idx = 0;
  const orig = rawChromium.launch.bind(rawChromium);
  (rawChromium as { launch: unknown }).launch = async (...a: Parameters<typeof orig>) => {
    const browser = await orig(...a);
    return new Proxy(browser, {
      get(t, p) {
        if (p === "newPage") {
          return async (...x: Parameters<typeof t.newPage>) => {
            const page = await t.newPage(...x);
            await page.exposeFunction("__optMatte", async (mode: string) => {
              const it = items[idx];
              if (mode === "begin") return !!it?.matte;
              if (mode === "end") { idx += 1; return true; }
              const base = path.join(process.cwd(), outDir!, it!.outName.replace(/\.png$/, "") + "-" + mode + ".png");
              await page.locator("#isolated-subject-capture-canvas").screenshot({ path: base });
              return true;
            });
            // string, not a function: tsx/esbuild injects __name helpers into serialized functions that the page lacks
            await page.addInitScript(`(() => {
              const w = window;
              let inner;
              Object.defineProperty(w, "__openClinXrApplyEquirectEnvironment", {
                configurable: true,
                get: () => inner && (async (e) => {
                  const r = await inner(e);
                  if (await w.__optMatte("begin")) {
                    const meshes = [];
                    w.__openClinXrIsolatedSceneRoot.traverse((o) => { if (o.isMesh) meshes.push([o, o.visible, /hair/i.test(o.name || (o.geometry && o.geometry.name) || "")]); });
                    const frame = async () => { w.__openClinXrIsolatedRenderFrame(); await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))); w.__openClinXrIsolatedRenderFrame(); };
                    for (const [o, , h] of meshes) o.visible = h;
                    await frame(); await w.__optMatte("hair");
                    for (const [o] of meshes) o.visible = false;
                    await frame(); await w.__optMatte("empty");
                    for (const [o, v] of meshes) o.visible = v;
                    await frame();
                  }
                  await w.__optMatte("end");
                  return r;
                }),
                set: (f) => { inner = f; },
              });
            })()`);
            return page;
          };
        }
        const v = Reflect.get(t, p, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  };
}

const specs: HeadCropSpec[] = items.map((it) => ({
  rail: "mpfb", role: "sheen", glb: it.glb, outName: it.outName, view: it.view as HeadCropSpec["view"],
  headBodyFrame: { belowHeads: 1.5 },
  ...(it.rig ? { rigOverride: rigOverrideFor(it.rig, it.view) } : {}),
  ...(it.hideHair ? { hideHair: true } : {}),
  ...(it.rig?.environmentEquirect ? { equirectEnvironment: it.rig.environmentEquirect } : {}),
}));
const run = await renderHeadFocusCrops({ cwd: process.cwd(), outputRoot: outDir!, specs });
console.log(JSON.stringify(run.summary));
