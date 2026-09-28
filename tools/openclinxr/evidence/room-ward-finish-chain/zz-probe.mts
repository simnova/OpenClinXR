/** TEMPORARY diagnostic probe (deleted after use). */
import { chromium } from "playwright";
import { BROWSER_PAGE_GLOBALS_INIT_SCRIPT } from "../lib/evidence-page.js";
import {
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "../lib/portless-server.js";
import {
  buildSceneClosureBundleJson,
  buildSceneClosureUrl,
  SCENE_CLOSURE_BUNDLE_ROUTE,
} from "../scene-closure/proofs/sc-05/ui-xr-bedside-approach-capture.ts";

const bundleJson = buildSceneClosureBundleJson();
let server: { proc: unknown; url: string } | null = null;
try {
  server = (await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 })) as unknown as {
    proc: unknown;
    url: string;
  };
  console.log(`[probe] server up`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("console", (msg) => console.log(`[page:${msg.type()}] ${msg.text().slice(0, 300)}`));
  page.on("pageerror", (err) => console.log(`[pageerror] ${String(err).slice(0, 500)}`));
  page.on("requestfailed", (req) => console.log(`[reqfail] ${req.url().slice(0, 160)} :: ${req.failure()?.errorText}`));
  await page.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
  await page.route(SCENE_CLOSURE_BUNDLE_ROUTE, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
  });
  await page.goto(buildSceneClosureUrl(server.url), { waitUntil: "networkidle", timeout: 180_000 });
  console.log("[probe] goto ok, polling scene state 8x30s ...");
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(30_000);
    const state = await page.evaluate(`(() => {
      const g = globalThis;
      const scene = g.__openClinXrDebugScene;
      if (!scene) return { debugScene: false };
      let hull = false, meshes = 0, roomRoot = false;
      try {
        scene.traverse((o) => {
          if (o.isMesh) meshes += 1;
          if (o.userData && o.userData["openClinXrEnvironmentSource"] === "infinigen-generated-room") hull = true;
          if (o.name === "openclinxr.station-environment.infinigen-room") roomRoot = true;
        });
      } catch (e) { return { debugScene: true, err: String(e).slice(0,200) }; }
      const st = scene.userData ? scene.userData["openClinXrInfinigenEnvironmentStatus"] : undefined;
      return { debugScene: true, hull, meshes, roomRoot, envStatus: st ? JSON.stringify(st).slice(0,300) : null };
    })()`);
    console.log(`[probe t=${(i + 1) * 30}s] ${JSON.stringify(state)}`);
  }
  await browser.close();
} finally {
  if (server) await stopPortlessDevServer((server as unknown as { proc: never }).proc);
}
console.log("[probe] done");
