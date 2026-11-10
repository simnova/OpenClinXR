#!/usr/bin/env node
/**
 * C55' falsifier: does the synced Encounter Flow panel (#exam-flow-timer, #exam-flow-advance, .timer-row span) follow the server phase?
 * GPU path (chromium channel, metal). 3-station rotation, one break after station 1. Samples every ~200 ms; each sample reads the node-side
 * server phase and, in one page.evaluate, the three panel texts plus the room's countdown (#room-countdown, rendered from the snapshot's phaseRemainingS).
 * Samples within 1 tick (1000 ms) of an observed phase boundary are skipped and counted per phase.
 * Usage: node c55-falsifier.mjs --out <file.json>   (C55_ROOT selects the build under test; defaults to this checkout)
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
const outFile = resolve(argv[argv.indexOf("--out") + 1]);
mkdirSync(dirname(outFile), { recursive: true });
const TICK_MS = 1000;
const TOLERANCE_S = 1;
const TIMING = { doorwaySeconds: 15, encounterSeconds: 10, noteSeconds: 8, breakSeconds: 8, breakAfterStationOrders: [1] };
const slot = (n) => ({ slotId: `slot-${n}`, order: n, label: `C55 station ${n}`, requiredEnvironmentIds: [], requiredTraceTags: [] });
const blueprint = { blueprintId: "bp-evidence-c55", title: "C55 rotation", stationSlots: [slot(1), slot(2), slot(3)], timing: TIMING, requiredTraceTags: [], requiredSafetyCriticalTraceTags: [] };
function iwerGlue() { const device = new IWER.XRDevice(IWER.metaQuest3); device.installRuntime({ forceInstall: true }); }
const out = { script: "c55-falsifier", root: ROOT, treeSha: "", timing: TIMING, toleranceS: TOLERANCE_S, tickMs: TICK_MS, renderer: null, humanoids: null, rows: [], skippedBoundarySamples: {}, serverBreaks: [], verdict: "other", verdictNote: "", pageErrors: [] };
try { out.treeSha = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { out.treeSha = "unknown"; }
try {
  out.treeDirty = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim() !== "";
  const assets = join(APP_DIST, "assets"); const mainJs = readdirSync(assets).filter((f) => /^main-.*\.js$/u.test(f));
  out.dist = mainJs.map((f) => ({ file: f, bytes: statSync(join(assets, f)).size, mtime: statSync(join(assets, f)).mtime.toISOString(), sha256: createHash("sha256").update(readFileSync(join(assets, f))).digest("hex"), containsServerRotation: readFileSync(join(assets, f), "utf8").includes("server rotation") }));
} catch (e) { out.distError = String(e).slice(0, 200); }
const norm = (s) => String(s ?? "").replace(/\s+/gu, " ").trim();
let server = null; let staticServer = null;
try {
  const { createEncounterServer } = await import(SERVER_DIST);
  const { edChestPainScenario, scenarioDialogueSeedBank } = await import(FIXTURES_DIST);
  const scenario = { ...edChestPainScenario, status: "approved" };
  server = await createEncounterServer({ examBlueprint: blueprint, scenarios: [scenario, scenario, scenario], dialogueSeeds: scenarioDialogueSeedBank });
  staticServer = await lib.startStaticServer(APP_DIST);
  const pageUrl = `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({ encounterSync: server.url })}`;
  const snap = () => { const s = JSON.parse(server.getStateJSON()); return { stationIndex: s.stationIndex, phase: s.phase, remaining: s.phaseRemainingS }; };
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, channel: "chromium", args: ["--disable-features=WebXR", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
    await context.addInitScript({ content: `${readFileSync(IWER_BUNDLE, "utf8")};(${iwerGlue.toString()})();` });
    const page = await context.newPage();
    page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 300)));
    await page.goto(pageUrl, { timeout: 60000, waitUntil: "load" });
    out.renderer = await page.evaluate(() => { const g = document.createElement("canvas").getContext("webgl"); const d = g && g.getExtension("WEBGL_debug_renderer_info"); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : null; });
    console.log("RENDERER " + out.renderer);
    await page.waitForFunction(() => { const e = globalThis.__openClinXrEncounterSync; return e !== undefined && e.state !== "joining"; }, undefined, { timeout: 240000 });
    await page.locator("#room-panel").waitFor({ timeout: 60000 });
    const humanoids = () => page.evaluate(() => { const sc = window.__openClinXrDebugScene; if (!sc) return { ids: [] }; const tops = new Set(); sc.traverse((o) => { if (!o.isSkinnedMesh) return; let a = o; let top = o; while (a && a !== sc) { top = a; a = a.parent; } tops.add(top.name); }); return { ids: [...tops].sort() }; });
    let last = ""; let same = 0; const t0 = Date.now();
    for (;;) { const h = await humanoids(); const sig = JSON.stringify(h); same = sig === last ? same + 1 : 1; last = sig; if (same >= 6) { out.humanoids = { stable: true, count: h.ids.length, ids: h.ids, waitedMs: Date.now() - t0 }; break; } if (Date.now() - t0 > 20000) { out.humanoids = { stable: false, count: h.ids.length, ids: h.ids, waitedMs: Date.now() - t0 }; break; } await sleep(250); }
    console.log("HUMANOIDS " + JSON.stringify(out.humanoids));
    const series = []; const samples = [];
    const deadline = Date.now() + 200000; let doorway2At = null;
    while (Date.now() < deadline) {
      const before = snap();
      const page_ = await page.evaluate(() => { const t = (sel) => document.querySelector(sel)?.textContent ?? null; return { at: Date.now(), timer: t("#exam-flow-timer"), advance: t("#exam-flow-advance"), label: t(".timer-row span"), room: t("#room-countdown") }; });
      const after = snap();
      const key = `${before.stationIndex}|${before.phase}`;
      if (series.length === 0 || series[series.length - 1].key !== key) series.push({ key, at: page_.at, stationIndex: before.stationIndex, phase: before.phase });
      samples.push({ before, after, ...page_ });
      if (before.stationIndex === 1 && before.phase === "doorway") { doorway2At ??= Date.now(); if (Date.now() - doorway2At > 4000) break; }
      await sleep(200);
    }
    out.serverBreaks = series.filter((p) => p.phase === "break").map((p) => ({ stationIndex: p.stationIndex }));
    const boundaries = series.slice(1).map((p) => p.at);
    for (const s of samples) {
      const phase = s.before.phase;
      if (s.before.phase !== s.after.phase || s.before.stationIndex !== s.after.stationIndex) { out.skippedBoundarySamples[phase] = (out.skippedBoundarySamples[phase] ?? 0) + 1; continue; }
      if (boundaries.some((b) => Math.abs(b - s.at) <= TICK_MS)) { out.skippedBoundarySamples[phase] = (out.skippedBoundarySamples[phase] ?? 0) + 1; continue; }
      const roomRemaining = /(\d+) s(?: left)?$/u.exec(s.room ?? "")?.[1];
      const phaseRemainingS = roomRemaining === undefined ? null : Number(roomRemaining);
      const timer = norm(s.timer);
      const m = /^([A-Za-z]+) (\d\d):(\d\d)( left)?$/u.exec(timer);
      const timerSeconds = m ? Number(m[2]) * 60 + Number(m[3]) : null;
      const timerFollows = m !== null && m[1].toLowerCase() === phase && phaseRemainingS !== null && Math.abs(timerSeconds - phaseRemainingS) <= TOLERANCE_S;
      const labelFollows = norm(s.label).toLowerCase() === phase;
      out.rows.push({ stationIndex: s.before.stationIndex, phase, phaseRemainingS, serverRemainingBefore: s.before.remaining, timer, advance: norm(s.advance), label: norm(s.label), timerFollows, labelFollows });
    }
    const phasesSeen = [...new Set(out.rows.map((r) => r.phase))];
    const wanted = ["doorway", "encounter", "note", "break"];
    const missing = wanted.filter((p) => !phasesSeen.includes(p));
    const allFollow = out.rows.length > 0 && out.rows.every((r) => r.timerFollows && r.labelFollows);
    const someFollow = out.rows.some((r) => r.timerFollows || r.labelFollows);
    out.verdict = missing.length > 0 ? "other" : allFollow ? "already_follows_server" : "local_clock_shown";
    out.verdictNote = `${out.rows.length} rows over phases ${phasesSeen.join(",")}; missing ${JSON.stringify(missing)}; timerFollows ${out.rows.filter((r) => r.timerFollows).length}, labelFollows ${out.rows.filter((r) => r.labelFollows).length}; some follow ${someFollow}; server breaks ${JSON.stringify(out.serverBreaks)}`;
    await context.close();
  } finally { await browser.close(); }
} catch (error) { process.exitCode = 1; out.fatal = String(error?.stack ?? error).slice(0, 1600); console.log("FATAL " + out.fatal.slice(0, 400)); }
finally { await server?.close().catch(() => undefined); await staticServer?.close().catch(() => undefined); writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`); }
console.log("VERDICT " + out.verdict + " " + out.verdictNote);
process.exit(process.exitCode ?? 0);
