/**
 * Walk-clip probe (Stage 1): what does the LIVE mixer actually play?
 *
 * Loads the loco-ground vehicle (lockOff row: no stance lock, no writes to
 * the legs), steps the fake 30 fps clock, and dumps per frame:
 * - running mixer actions with effective weights,
 * - tap stanceLabel + toe world heights,
 * - raw (ungated) toe Y range over the walk.
 *
 * No screenshots, no video. Foreground only.
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/evidence/walk-clip/probe-live-mixer.ts [--frames 200]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "../lib/slotted-playwright.js";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { BROWSER_PAGE_GLOBALS_INIT_SCRIPT } from "../lib/evidence-page.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";
import {
  buildSceneClosureBundleJson,
  buildSceneClosureUrl,
  SCENE_CLOSURE_BUNDLE_ROUTE,
} from "../scene-closure/proofs/sc-05/ui-xr-bedside-approach-capture.js";

const STEP_SECONDS = 1 / 30;

const MIXER_DUMP_SOURCE = `(() => {
  const scene = globalThis.__openClinXrDebugScene;
  if (!scene) return { ok: false, reason: "no-debug-scene" };
  const out = [];
  scene.traverse((o) => {
    const mixers = o.userData && o.userData.__mixers;
    if (mixers) out.push("has-mixers-field");
  });
  // Find AnimationMixers via known slot userData instead: walk all objects,
  // read root userData playback records the runtime publishes.
  const slots = [];
  scene.traverse((o) => {
    const ud = o.userData || {};
    if (ud.openClinXrLocomotionClipPlayback) {
      slots.push({
        name: o.name,
        playback: ud.openClinXrLocomotionClipPlayback,
        legWeight: ud.openClinXrLocomotionLegWeight ?? null,
        crossfade: ud.openClinXrLocomotionCrossfade ?? null,
        stanceLabels: ud.openClinXrLocomotionStanceLabels
          ? {
              clipName: ud.openClinXrLocomotionStanceLabels.clipName,
              cycleSeconds: ud.openClinXrLocomotionStanceLabels.cycleSeconds,
              forward: ud.openClinXrLocomotionStanceLabels.forward,
              atMs: ud.openClinXrLocomotionStanceLabels.atMs,
              left: ud.openClinXrLocomotionStanceLabels.left,
              right: ud.openClinXrLocomotionStanceLabels.right,
            }
          : null,
      });
    }
  });
  return { ok: true, slots };
})()`;

const ACTIONS_DUMP_SOURCE = `(() => {
  // Reach the physician mixer through the tap bones: any skinned root with a mixer.
  const THREE_NS = globalThis.__openClinXrThree ?? null;
  return { three: THREE_NS !== null };
})()`;

async function main(): Promise<void> {
  const framesFlag = process.argv.find((a) => a.startsWith("--frames="));
  const frames = framesFlag ? Number.parseInt(framesFlag.slice("--frames=".length), 10) : 220;
  const bundleJson = buildSceneClosureBundleJson();
  const server = await spawnPortlessDevServer({ filter: "@openclinxr/ui-xr", readyTimeoutMs: 180_000 });
  const services = createLocalComputeServices();
  let context: BrowserContext | null = null;
  try {
    await services.sceneCapture.withBrowser("walk-clip-probe", async (browser) => {
      const b = browser as unknown as Browser;
      context = await b.newContext({ viewport: { width: 640, height: 360 } });
      const page = (await context.newPage()) as unknown as Page;
      await page.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
      await page.route(SCENE_CLOSURE_BUNDLE_ROUTE, async (route) => {
        await route.fulfill({ status: 200, contentType: "application/json", body: bundleJson });
      });
      await page.goto(`${buildSceneClosureUrl(server.url)}&locoGround=1&noStanceLock=1`, {
        waitUntil: "load",
        timeout: 180_000,
      });
      // Let the scene settle: wait for the tap ring to exist and walking to start.
      let ready = false;
      for (let i = 0; i < 120 && !ready; i += 1) {
        await page.clock.fastForward(STEP_SECONDS * 1000);
        const n = await page.evaluate(
          `(() => (Array.isArray(globalThis.__openClinXrLocoGroundTap) ? globalThis.__openClinXrLocoGroundTap.length : -1))()`,
        );
        if ((n as number) > 5) ready = true;
      }
      if (!ready) throw new Error("tap ring never appeared");
      // Step through the walk, then dump the whole ring + mixer records.
      for (let i = 0; i < frames; i += 1) {
        await page.clock.fastForward(STEP_SECONDS * 1000);
      }
      const ring = (await page.evaluate(
        `(() => {
          const ring = globalThis.__openClinXrLocoGroundTap ?? null;
          if (!Array.isArray(ring)) return null;
          return ring.map((r) => ({
            frame: r.frame,
            quat: r.mixer ? r.mixer.quat : null,
            toeL: r.mixer && r.mixer.toeWorld ? r.mixer.toeWorld.left : null,
            toeR: r.mixer && r.mixer.toeWorld ? r.mixer.toeWorld.right : null,
            tMs: r.meta ? r.meta.tMs : null,
            actorId: r.meta ? r.meta.actorId : null,
            phase: r.meta ? r.meta.phase : null,
            stanceLabel: r.meta ? r.meta.stanceLabel : null,
            legWeight: r.meta ? r.meta.legWeightCurrent : null,
            mixerActions: r.meta ? (r.meta.mixerActions ?? null) : null,
          }));
        })()`,
      )) as Array<{
        frame: number;
        quat: Record<string, [number, number, number, number]> | null;
        toeL: { x: number; y: number; z: number } | null;
        toeR: { x: number; y: number; z: number } | null;
        tMs: number;
        actorId: string;
        phase: string | null;
        stanceLabel: string | null;
        legWeight: number | null;
        mixerActions: Array<{ clip: string; running: boolean | null; effectiveWeight: number | null; timeSeconds: number | null }> | null;
      }> | null;
      const mixerInfo = await page.evaluate(MIXER_DUMP_SOURCE);
      void ACTIONS_DUMP_SOURCE;
      const outDir = ".openclinxr/evidence/walk-clip";
      mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, "live-mixer-probe.json");
      writeFileSync(outPath, `${JSON.stringify({ ring, mixerInfo }, null, 2)}\n`);
      // Compact console summary: ungated toe Y range + label-phase check.
      const rows = (ring ?? []).filter(
        (r) => r.phase === "walking" && r.toeL && r.toeR,
      );
      const lY = rows.map((r) => r.toeL!.y);
      const rY = rows.map((r) => r.toeR!.y);
      console.log(
        `frames=${rows.length} toeL=[${Math.min(...lY).toFixed(4)},${Math.max(...lY).toFixed(4)}] toeR=[${Math.min(...rY).toFixed(4)},${Math.max(...rY).toFixed(4)}]`,
      );
      // Per-label maxima: is the peak excluded by the stance gate?
      for (const foot of ["left", "right"] as const) {
        let gatedMax = -Infinity;
        let ungatedMax = -Infinity;
        for (const r of rows) {
          const y = foot === "left" ? r.toeL!.y : r.toeR!.y;
          ungatedMax = Math.max(ungatedMax, y);
          if (r.stanceLabel !== foot) gatedMax = Math.max(gatedMax, y);
        }
        console.log(`${foot}: ungatedMax=${ungatedMax.toFixed(4)} gatedMax=${gatedMax.toFixed(4)}`);
      }
      // Action inventory: distinct (clip, running, weight) states seen while walking.
      const seen = new Map<string, number>();
      for (const r of rows) {
        for (const a of r.mixerActions ?? []) {
          const k = `${a.clip}|running=${a.running}|w=${a.effectiveWeight}`;
          seen.set(k, (seen.get(k) ?? 0) + 1);
        }
      }
      for (const [k, n] of seen) console.log(`action ${k} frames=${n}`);
      console.log(`mixerInfo=${JSON.stringify(mixerInfo).slice(0, 1200)}`);
      console.log(`wrote ${outPath}`);
      await context?.close();
    });
  } finally {
    await stopPortlessDevServer(server.proc);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
