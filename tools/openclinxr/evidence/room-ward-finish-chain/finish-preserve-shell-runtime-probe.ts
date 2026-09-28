/**
 * finish-preserve-shell runtime material probe: verifies at the real
 * ui-xr/three.js material level (not just GLB bytes) that the materials for
 * the wall (pose 02), ceiling tile (pose 03), and door leaf carry live
 * normalMap + roughnessMap instances after the three.js loader resolves
 * them. Mechanism copies ward-finish-chain-capture.ts verbatim (portless
 * dev server, environment-GLB route override, room-root ancestry), but
 * takes no screenshots: it traverses the room subtree and records per-mesh
 * material map presence as JSON.
 *
 * Env: STAGE2_CAPTURE_GLB (required, finished ward GLB path),
 *   FPS_PROBE_OUT (required, output JSON path).
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { BROWSER_PAGE_GLOBALS_INIT_SCRIPT } from "../lib/evidence-page.js";
import {
  spawnPortlessDevServer,
  stopPortlessDevServer,
} from "../lib/portless-server.js";
import { CASE_FROZEN_SCENE_PLANS } from "@openclinxr/asset-registry/case-frozen-scene-plans";
import {
  buildSceneClosureBundleJson,
  buildSceneClosureUrl,
  SCENE_CLOSURE_SCENARIO_ID,
  SCENE_CLOSURE_BUNDLE_ROUTE,
} from "../scene-closure/proofs/sc-05/ui-xr-bedside-approach-capture.ts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const STAGE2_GLB = process.env["STAGE2_CAPTURE_GLB"];
if (!STAGE2_GLB) throw new Error("STAGE2_CAPTURE_GLB is required (finished ward GLB path)");
const OUT = process.env["FPS_PROBE_OUT"];
if (!OUT) throw new Error("FPS_PROBE_OUT is required (output JSON path)");
const OUT_PATH: string = OUT;
const FINISHED_WARD_GLB = path.resolve(process.cwd(), STAGE2_GLB);

const PROBE_SOURCE = `
(() => {
  const scene = globalThis.__openClinXrDebugScene;
  if (!scene) return { ok: false, reason: "no-debug-scene" };
  let room = null;
  scene.traverse((o) => {
    if (!room && o.name === "openclinxr.station-environment.infinigen-room") room = o;
  });
  if (!room) return { ok: false, reason: "no-room-root" };
  const seen = new Set();
  const rows = [];
  room.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      const key = String(o.name) + "::" + String(m.name);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        mesh: o.name,
        material: m.name,
        map: !!m.map,
        normalMap: !!m.normalMap,
        roughnessMap: !!m.roughnessMap,
        metalness: m.metalness ?? null,
        roughness: m.roughness ?? null,
      });
    }
  });
  rows.sort((a, b) => (String(a.material) + "::" + String(a.mesh)).localeCompare(String(b.material) + "::" + String(b.mesh)));
  return { ok: true, rows };
})()
`;

async function main(): Promise<void> {
  const bundleJson = buildSceneClosureBundleJson();
  let server = null;
  try {
    server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
    await page.route(SCENE_CLOSURE_BUNDLE_ROUTE, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
    });
    const bytes = await readFile(FINISHED_WARD_GLB);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await page.route(`**/xr-assets/environment/infinigen-inpatient-ward.glb`, async (route) => {
      await route.fulfill({ status: 200, contentType: "model/gltf-binary", body: bytes });
    });
    await page.goto(buildSceneClosureUrl(server.url), { waitUntil: "networkidle", timeout: 180_000 });
    await page.waitForFunction(
      () => {
        const g = globalThis as unknown as { __openClinXrDebugScene?: { traverse: (fn: (o: never) => void) => void } };
        const scene = g.__openClinXrDebugScene;
        if (!scene?.traverse) return false;
        let hull = false;
        scene.traverse((o: { userData?: Record<string, unknown> }) => {
          if (o.userData?.["openClinXrEnvironmentSource"] === "infinigen-generated-room") hull = true;
        });
        return hull;
      },
      undefined,
      { timeout: 180_000 },
    );
    await page.waitForTimeout(3000);
    const probed = (await page.evaluate(PROBE_SOURCE)) as
      | { ok: false; reason: string }
      | { ok: true; rows: Array<Record<string, unknown>> };
    if (!probed.ok) throw new Error(`runtime probe failed: ${probed.reason}`);
    await writeFile(OUT_PATH, `${JSON.stringify({ glb: FINISHED_WARD_GLB, glbSha256: sha256, ...probed }, null, 2)}\n`, "utf8");
    process.stdout.write(`[probe] ${(probed as { rows: unknown[] }).rows.length} mesh-material rows -> ${OUT_PATH}\n`);
    await browser.close();
  } finally {
    if (server) await stopPortlessDevServer(server.proc);
  }
}

const invokedAsMain = (process.argv[1] ?? "").endsWith("finish-preserve-shell-runtime-probe.ts");
if (invokedAsMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}

void CASE_FROZEN_SCENE_PLANS;
void SCENE_CLOSURE_SCENARIO_ID;
