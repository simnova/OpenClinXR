#!/usr/bin/env node
/**
 * C55' stills: the Encounter Flow panel at 800x600 dpr 1 on the GPU path (ANGLE Metal), synced encounter, note and break, plus the non-synced shell.
 * Each still waits for a stable registered humanoid count, scrolls #exam-flow-timer into view, reads the panel texts, the room countdown and the server phase, then shoots.
 * Usage: node c55-stills.mjs --out <dir>   (C55_ROOT selects the build under test; defaults to this checkout)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.C55_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const lib = await import(join(ROOT, "tools/openclinxr/evidence/xr-sync/harness-lib.mjs"));
const SERVER_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/index.js");
const FIXTURES_DIST = join(ROOT, "packages/openclinxr/scenario-fixtures/dist/index.js");
const APP_DIST = join(ROOT, "apps/ui-xr/dist");
const IWER_BUNDLE = join(ROOT, "apps/arena/ui-xr-iwsdk-spike/node_modules/iwer/build/iwer.min.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const outDir = resolve(argv[argv.indexOf("--out") + 1]);
const tag = argv.includes("--tag") ? argv[argv.indexOf("--tag") + 1] : "run";
mkdirSync(outDir, { recursive: true });
const TIMING = { doorwaySeconds: 4, encounterSeconds: 60, noteSeconds: 40, breakSeconds: 40, breakAfterStationOrders: [1] };
const slot = (n) => ({ slotId: `slot-${n}`, order: n, label: `C55 station ${n}`, requiredEnvironmentIds: [], requiredTraceTags: [] });
const blueprint = { blueprintId: "bp-evidence-c55", title: "C55 rotation", stationSlots: [slot(1), slot(2), slot(3)], timing: TIMING, requiredTraceTags: [], requiredSafetyCriticalTraceTags: [] };
function iwerGlue() { const device = new IWER.XRDevice(IWER.metaQuest3); device.installRuntime({ forceInstall: true }); }
const run = { script: "c55-stills", tag, root: ROOT, renderer: null, stills: [], pageErrors: [] };
let server = null; let staticServer = null;
try {
  const { createEncounterServer } = await import(SERVER_DIST);
  const { edChestPainScenario, scenarioDialogueSeedBank } = await import(FIXTURES_DIST);
  const scenario = { ...edChestPainScenario, status: "approved" };
  server = await createEncounterServer({ examBlueprint: blueprint, scenarios: [scenario, scenario, scenario], dialogueSeeds: scenarioDialogueSeedBank });
  staticServer = await lib.startStaticServer(APP_DIST);
  const base = `http://127.0.0.1:${staticServer.port}/`;
  const snap = () => { const s = JSON.parse(server.getStateJSON()); return { stationIndex: s.stationIndex, phase: s.phase, remaining: s.phaseRemainingS }; };
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, channel: "chromium", args: ["--disable-features=WebXR", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
  try {
    const open = async (url, synced) => {
      const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
      await context.addInitScript({ content: `${readFileSync(IWER_BUNDLE, "utf8")};(${iwerGlue.toString()})();` });
      const page = await context.newPage();
      page.on("pageerror", (e) => run.pageErrors.push(String(e).slice(0, 300)));
      await page.goto(url, { timeout: 60000, waitUntil: "load" });
      if (synced) { await page.waitForFunction(() => { const e = globalThis.__openClinXrEncounterSync; return e !== undefined && e.state !== "joining"; }, undefined, { timeout: 240000 }); await page.locator("#room-panel").waitFor({ timeout: 60000 }); } else await sleep(4000);
      return { context, page };
    };
    const humanoids = (page) => page.evaluate(() => { const sc = window.__openClinXrDebugScene; if (!sc) return { ids: [] }; const tops = new Set(); sc.traverse((o) => { if (!o.isSkinnedMesh) return; let a = o; let top = o; while (a && a !== sc) { top = a; a = a.parent; } tops.add(top.name); }); return { ids: [...tops].sort() }; });
    const stable = async (page) => { let last = ""; let same = 0; const t0 = Date.now(); for (;;) { const h = await humanoids(page); const sig = JSON.stringify(h); same = sig === last ? same + 1 : 1; last = sig; if (same >= 6) return { stable: true, count: h.ids.length, ids: h.ids, waitedMs: Date.now() - t0 }; if (Date.now() - t0 > 20000) return { stable: false, count: h.ids.length, ids: h.ids, waitedMs: Date.now() - t0 }; await sleep(250); } };
    const shoot = async (page, name, synced) => {
      const humanoidsRow = await stable(page);
      await page.evaluate(() => { document.getElementById("exam-flow-timer")?.scrollIntoView({ block: "center" }); });
      const read = () => page.evaluate(() => { const t = (s) => document.querySelector(s)?.textContent ?? null; const r = document.getElementById("exam-flow-timer")?.getBoundingClientRect(); return { label: t(".timer-row span"), clock: t("#station-clock"), timer: t("#exam-flow-timer"), advance: t("#exam-flow-advance"), room: t("#room-countdown"), timerRect: r ? { top: r.top, bottom: r.bottom } : null }; });
      const serverBefore = synced ? snap() : null; const panel = await read();
      await page.screenshot({ path: join(outDir, name + ".png"), timeout: 30000 });
      const row = { name, still: name + ".png", humanoids: humanoidsRow, humanoidsAfter: await humanoids(page), serverBefore, panel, serverAfter: synced ? snap() : null };
      run.stills.push(row);
      console.log("STILL " + name + " humanoids " + humanoidsRow.count + " stable=" + humanoidsRow.stable + " ids " + JSON.stringify(humanoidsRow.ids.map((x) => x.replace("openclinxr.ed-chest-pain.", ""))) + " after " + row.humanoidsAfter.ids.length + " server " + JSON.stringify(serverBefore) + " panel " + JSON.stringify(panel));
    };
    const until = async (fn, label) => { const deadline = Date.now() + 150000; while (!fn(snap())) { if (Date.now() > deadline) throw new Error("timed out waiting for " + label); await sleep(50); } };
    const { context: sctx, page: spage } = await open(`${base}?${new URLSearchParams({ encounterSync: server.url })}`, true);
    run.renderer = await spage.evaluate(() => { const g = document.createElement("canvas").getContext("webgl"); const d = g && g.getExtension("WEBGL_debug_renderer_info"); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : null; });
    console.log("RENDERER " + run.renderer);
    await until((s) => s.stationIndex === 0 && s.phase === "encounter" && s.remaining <= 50, "encounter");
    await shoot(spage, "synced-encounter", true);
    await until((s) => s.stationIndex === 0 && s.phase === "note" && s.remaining <= 30, "note");
    await shoot(spage, "synced-note", true);
    await until((s) => s.stationIndex === 0 && s.phase === "break" && s.remaining <= 30, "break");
    await shoot(spage, "synced-break", true);
    await sctx.close();
    const { context: nctx, page: npage } = await open(base, false);
    await shoot(npage, "non-synced", false);
    await nctx.close();
  } finally { await browser.close(); }
} catch (error) { process.exitCode = 1; run.fatal = String(error?.stack ?? error).slice(0, 1600); console.log("FATAL " + run.fatal.slice(0, 400)); }
finally { await server?.close().catch(() => undefined); await staticServer?.close().catch(() => undefined); writeFileSync(join(outDir, "report.json"), `${JSON.stringify(run, null, 2)}\n`); }
process.exit(process.exitCode ?? 0);
