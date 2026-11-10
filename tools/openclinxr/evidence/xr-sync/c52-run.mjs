#!/usr/bin/env node
/**
 * C52 synced/control trace capture through the production shell (IWER Quest 3), 800x600 dpr 1.
 * Usage: node c52-run.mjs --mode synced|control --run-id <id> --out <dir> [--trace 1|0]
 * Usage: node c52-run.mjs --assemble <runDir>... --out <file>
 * Slices the trace window around the largest heartbeat gap and reports top self-time tasks.
 * Trace store: /Volumes/files/openclinxr-assets/store/xr-sync/c52/<run-id>/trace.json (write-once).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { join, resolve, dirname } from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

function sliceGapWindow(events, clock, gap) {
  const list = Array.isArray(events) ? events : (events?.traceEvents ?? []);
  const sync = list.find((e) => e && e.name === "c52-sync" && (e.ph === "R" || e.ph === "I" || e.ph === "b") && typeof e.ts === "number");
  if (!sync) throw new Error("c52-sync mark not found in trace");
  const offsetMs = sync.ts / 1000 - clock.nowMs;
  const endTrace = (gap.at - clock.timeOrigin) + offsetMs;
  const startTrace = endTrace - gap.gapMs;
  return { startUs: startTrace * 1000, endUs: endTrace * 1000, mainPid: sync.pid, mainTid: sync.tid };
}

function topSelfTime(events, mainPid, mainTid, win, n = 10) {
  const list = Array.isArray(events) ? events : (events?.traceEvents ?? []);
  const raw = [];
  for (const e of list) {
    if (!e || e.pid !== mainPid || e.tid !== mainTid) continue;
    if (e.ph === "X" && typeof e.ts === "number" && typeof e.dur === "number") {
      raw.push({ name: e.name ?? "", ts: e.ts, dur: e.dur, args: e.args });
    }
  }
  const be = list.filter((e) => e && e.pid === mainPid && e.tid === mainTid && (e.ph === "B" || e.ph === "E") && typeof e.ts === "number");
  be.sort((a, b) => a.ts - b.ts);
  const stack = [];
  for (const e of be) {
    if (e.ph === "B") { stack.push(e); continue; }
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].name === e.name) {
        const b = stack.splice(i, 1)[0];
        raw.push({ name: b.name ?? "", ts: b.ts, dur: Math.max(0, e.ts - b.ts), args: b.args });
        break;
      }
    }
  }
  const clipped = [];
  for (const e of raw) {
    const cStart = Math.max(e.ts, win.startUs);
    const cEnd = Math.min(e.ts + e.dur, win.endUs);
    const cDur = cEnd - cStart;
    if (cDur <= 0) continue;
    const data = e.args?.data ?? {};
    const url = String(data.url ?? data.fileName ?? data.scriptName ?? "");
    const functionName = String(data.functionName ?? "");
    clipped.push({ name: e.name, ts: e.ts, dur: e.dur, cDur, url, functionName });
  }
  clipped.sort((a, b) => (a.ts - b.ts) || (b.dur - a.dur));
  const self = clipped.map((c) => c.cDur);
  const st = [];
  for (let i = 0; i < clipped.length; i++) {
    const cur = clipped[i];
    const curEnd = cur.ts + cur.dur;
    while (st.length > 0) {
      const top = st[st.length - 1];
      const topEnd = clipped[top].ts + clipped[top].dur;
      if (cur.ts >= topEnd || curEnd > topEnd) st.pop();
      else break;
    }
    if (st.length > 0) self[st[st.length - 1]] -= clipped[i].cDur;
    st.push(i);
  }
  const agg = new Map();
  for (let i = 0; i < clipped.length; i++) {
    const c = clipped[i];
    const key = `${c.name}|${c.url}|${c.functionName}`;
    const prev = agg.get(key);
    if (prev) prev.sumUs += Math.max(0, self[i]);
    else agg.set(key, { traceEventName: c.name, url: c.url, functionName: c.functionName, sumUs: Math.max(0, self[i]) });
  }
  return [...agg.values()]
    .map((v) => ({ traceEventName: v.traceEventName, url: v.url, functionName: v.functionName, selfMs: Math.round((v.sumUs / 1000) * 1000) / 1000 }))
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, n);
}

function cpuProfileTop(events, mainPid, mainTid, win, n = 10) {
  void mainTid;
  const list = Array.isArray(events) ? events : (events?.traceEvents ?? []);
  const getCpu = (e) => e?.args?.data?.cpuProfile ?? (Array.isArray(e?.args?.data?.samples) ? e.args.data : null);
  const chunks = list.filter((e) => e && e.pid === mainPid && (e.name === "ProfileChunk" || getCpu(e)));
  const nodeById = new Map();
  for (const e of chunks) {
    const cpu = getCpu(e);
    const nodes = cpu?.nodes;
    if (!Array.isArray(nodes)) continue;
    for (const node of nodes) {
      if (!node || node.id == null) continue;
      const cf = node.callFrame ?? {};
      nodeById.set(node.id, {
        functionName: String(cf.functionName ?? ""),
        url: String(cf.url ?? ""),
        lineNumber: cf.lineNumber,
        columnNumber: cf.columnNumber,
        parent: node.parent,
      });
    }
  }
  const profEv = list.find((e) => e && e.name === "Profile" && e.pid === mainPid);
  const base = Number(profEv?.args?.data?.startTime ?? profEv?.ts ?? 0);
  const flat = [];
  let cum = 0;
  for (const e of chunks) {
    const cpu = getCpu(e);
    const samples = cpu?.samples;
    const deltas = Array.isArray(e?.args?.data?.timeDeltas) ? e.args.data.timeDeltas : cpu?.timeDeltas;
    if (!Array.isArray(samples) || !Array.isArray(deltas)) continue;
    const m = Math.min(samples.length, deltas.length);
    for (let i = 0; i < m; i++) {
      const d = typeof deltas[i] === "number" ? deltas[i] : 0;
      cum += d;
      const sampleTs = base + cum;
      flat.push({ nodeId: samples[i], delta: d, ts: sampleTs });
    }
  }
  const startUs = win?.startUs ?? -Infinity;
  const endUs = win?.endUs ?? Infinity;
  const inWin = flat.filter((s) => s.ts >= startUs && s.ts <= endUs);
  const keyOf = (node) => `${node.functionName}|${node.url}|${node.lineNumber ?? ""}:${node.columnNumber ?? ""}`;
  const selfAgg = new Map();
  for (const s of inWin) {
    const node = nodeById.get(s.nodeId);
    if (!node) continue;
    const key = keyOf(node);
    const prev = selfAgg.get(key);
    if (prev) prev.sumUs += s.delta;
    else selfAgg.set(key, { traceEventName: "cpu_profile", url: node.url, functionName: node.functionName, lineNumber: node.lineNumber, columnNumber: node.columnNumber, sumUs: s.delta });
  }
  const self = [...selfAgg.values()]
    .map((v) => ({ traceEventName: v.traceEventName, url: v.url, functionName: v.functionName, lineNumber: v.lineNumber, columnNumber: v.columnNumber, selfMs: Math.round((v.sumUs / 1000) * 1000) / 1000, source: "cpu_profile" }))
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, n);
  const skipInc = new Set(["(root)", "(program)", "(idle)"]);
  const incAgg = new Map();
  for (const s of inWin) {
    const leaf = nodeById.get(s.nodeId);
    if (!leaf) continue;
    const seen = new Set();
    let cur = leaf;
    let guard = 0;
    while (cur && guard++ < 100000) {
      const key = keyOf(cur);
      if (!seen.has(key)) {
        seen.add(key);
        if (!skipInc.has(cur.functionName)) {
          const prev = incAgg.get(key);
          if (prev) prev.sumUs += s.delta;
          else incAgg.set(key, { traceEventName: "cpu_profile", url: cur.url, functionName: cur.functionName, lineNumber: cur.lineNumber, columnNumber: cur.columnNumber, sumUs: s.delta });
        }
      }
      cur = cur.parent == null ? null : nodeById.get(cur.parent);
    }
  }
  const inclusive = [...incAgg.values()]
    .map((v) => ({ traceEventName: v.traceEventName, url: v.url, functionName: v.functionName, lineNumber: v.lineNumber, columnNumber: v.columnNumber, inclusiveMs: Math.round((v.sumUs / 1000) * 1000) / 1000, source: "cpu_profile_inclusive" }))
    .sort((a, b) => b.inclusiveMs - a.inclusiveMs)
    .slice(0, n);
  return { self, inclusive };
}

function classify(task) {
  const name = String(task?.traceEventName ?? "");
  const url = String(task?.url ?? "");
  const fn = String(task?.functionName ?? "");
  const s = `${name} ${url} ${fn}`.toLowerCase();
  const evName = `${name} ${fn}`.toLowerCase();
  const evidenceFor = (cause) => {
    let ev = `traceEventName="${name}"`;
    if (url) ev += ` url="${url}"`;
    if (fn) ev += ` function="${fn}"`;
    ev += ` => ${cause}`;
    return ev;
  };
  const src = String(task?.source ?? "");
  if (src.startsWith("cpu_profile")) {
    if (fn === "" && url === "") return { cause: "inconclusive", evidence: `traceEventName="${name}": no url and no function name` };
    if (fn === "(garbage collector)") return { cause: "gc", evidence: evidenceFor("gc") };
    if (fn === "(program)" || fn === "(idle)") return { cause: "other", evidence: evidenceFor("other") };
  }
  if (/gltfloader|draco|meshopt|parseglb|decodegltf/.test(s)) return { cause: "glb_decode", evidence: evidenceFor("glb_decode") };
  if (evName.includes("json.parse") || evName.includes("parsejson")) return { cause: "asset_parse", evidence: evidenceFor("asset_parse") };
  if (/teximage|texsubimage|uploadtexture|compressedteximage/.test(s)) return { cause: "texture_upload", evidence: evidenceFor("texture_upload") };
  if (/compileshader|linkprogram|shadercompile|programcache|shader/.test(s)) return { cause: "shader_compile", evidence: evidenceFor("shader_compile") };
  if (/majorgc|minorgc|v8\.gc|blinkgc/.test(s)) return { cause: "gc", evidence: evidenceFor("gc") };
  if (/layout|updatelayouttree|recalculatestyles|schedulestylerecalculation|paint/.test(s)) return { cause: "layout_style", evidence: evidenceFor("layout_style") };
  if (/evaluatescript|v8\.compile|v8\.run|functioncall/.test(s) || (task?.source === "cpu_profile" && fn !== "")) return { cause: "script_eval", evidence: evidenceFor("script_eval") };
  if (url === "" && fn === "") return { cause: "inconclusive", evidence: `traceEventName="${name}": no url and no function name on the event` };
  return { cause: "other", evidence: evidenceFor("other") };
}

if (process.argv.includes("--selftest")) {
  const ev = [
    { name: "Parent", ph: "X", ts: 0, dur: 100000, pid: 1, tid: 1, args: { data: {} } },
    { name: "MajorGC", ph: "X", ts: 20000, dur: 40000, pid: 1, tid: 1, args: { data: {} } },
  ];
  const top = topSelfTime(ev, 1, 1, { startUs: 0, endUs: 100000 }, 10);
  const parent = top.find((t) => t.traceEventName === "Parent");
  const child = top.find((t) => t.traceEventName === "MajorGC");
  const assert = (cond, msg) => { if (!cond) { console.error(`SELFTEST fail: ${msg}`); process.exit(1); } };
  assert(parent && parent.selfMs === 60, `parent self expected 60 got ${JSON.stringify(parent)}`);
  assert(child && child.selfMs === 40, `child self expected 40 got ${JSON.stringify(child)}`);
  assert(classify({ traceEventName: "MajorGC", url: "", functionName: "" }).cause === "gc", "classify MajorGC should be gc");
  assert(classify({ traceEventName: "Foo", url: "", functionName: "" }).cause === "inconclusive", "classify Foo should be inconclusive");
  const profEv = [
    { name: "Profile", ph: "P", pid: 1, ts: 1000, args: { data: { startTime: 1000 } } },
    { name: "ProfileChunk", ph: "P", pid: 1, tid: 9, ts: 1000, args: { data: { cpuProfile: { nodes: [{ id: 1, callFrame: { functionName: "(root)", url: "" } }, { id: 2, parent: 1, callFrame: { functionName: "foo", url: "u.js", lineNumber: 3, columnNumber: 4 } }], samples: [2, 2] }, timeDeltas: [10, 20] } } },
    { name: "ProfileChunk", ph: "P", pid: 1, tid: 9, ts: 1000, args: { data: { cpuProfile: { nodes: [], samples: [2] }, timeDeltas: [30] } } },
  ];
  const cpuRes = cpuProfileTop(profEv, 1, 999, { startUs: 1000, endUs: 1100 }, 10);
  assert(cpuRes.self[0] && cpuRes.self[0].functionName === "foo", `cpu self top expected foo got ${JSON.stringify(cpuRes.self[0])}`);
  assert(cpuRes.self[0] && cpuRes.self[0].selfMs === 0.06, `cpu self selfMs expected 0.06 got ${JSON.stringify(cpuRes.self[0])}`);
  console.log("SELFTEST ok");
  process.exit(0);
}


/** C52b: gate a 3-run json. Exit 1 unless every run is on ANGLE Metal, plant ms <= 250 and cpu-profile inclusive <= 250. */
if (process.argv.includes("--check")) {
  const file = process.argv[process.argv.indexOf("--check") + 1];
  const LIMIT_MS = 250;
  let data;
  try { data = JSON.parse(readFileSync(resolve(file), "utf8")); } catch (e) { console.error(`c52 --check: cannot read ${file}: ${e.message}`); process.exit(2); }
  const fails = [];
  const runs = Array.isArray(data?.runs) ? data.runs : [];
  if (runs.length !== 3) fails.push(`runs=${runs.length} (need exactly 3)`);
  if (typeof data?.headSha !== "string" || !/^[0-9a-f]{40}$/.test(data.headSha)) fails.push("headSha missing");
  runs.forEach((r, i) => {
    const tag = `run${i + 1}(${r?.runId})`;
    if (!/ANGLE Metal/.test(String(r?.renderer ?? ""))) fails.push(`${tag} renderer lacks "ANGLE Metal": ${r?.renderer}`);
    const plantMs = r?.plantMs?.station1SumMs;
    const profMs = r?.plantProfile?.maxStationInclusiveMs;
    const gap = r?.largestGap?.durationMs ?? 0;
    console.log(`${tag} station1 plant ms (recordPlantStep sum, ${r?.plantMs?.station1Actors ?? "?"} actors)=${plantMs ?? "null"} cpu-profile inclusive applyAndPlantSupineDeck per-station=${JSON.stringify(r?.plantProfile?.stationInclusiveMs ?? null)} max=${profMs ?? "null"} whole-run=${r?.plantProfile?.wholeRunInclusiveMs ?? "null"} largestGapMs(reported, not gated)=${gap}`);
    if (typeof plantMs !== "number" || !(plantMs <= LIMIT_MS)) fails.push(`${tag} plant ms ${plantMs ?? "null"} > ${LIMIT_MS}`);
    if (typeof profMs !== "number" || !(profMs <= LIMIT_MS)) fails.push(`${tag} cpu-profile inclusive ${profMs ?? "null"} > ${LIMIT_MS}`);
  });
  console.log(`headSha=${data?.headSha ?? "null"}`);
  if (fails.length > 0) { for (const f of fails) console.error(`CHECK FAIL ${f}`); process.exit(1); }
  console.log("CHECK OK");
  process.exit(0);
}

{
  const argvPre = process.argv.slice(2);
  if (argvPre.includes("--assemble")) {
    const outIdx = argvPre.indexOf("--out");
    if (outIdx === -1 || !argvPre[outIdx + 1]) { console.error("c52 --assemble: missing --out <file>"); process.exit(2); }
    const runDirs = argvPre.slice(argvPre.indexOf("--assemble") + 1, outIdx);
    const outFile = resolve(argvPre[outIdx + 1]);
    if (runDirs.length === 0) { console.error("c52 --assemble: no run dirs"); process.exit(2); }
    const reports = runDirs.map((d) => JSON.parse(readFileSync(join(resolve(d), "report.json"), "utf8")));
    for (let i = 0; i < reports.length; i++) {
      if (reports[i]?.voidRun) { console.error(`c52 --assemble: voidRun in ${runDirs[i]}`); process.exit(2); }
    }
    const slim = reports.map((r) => {
      const { labelEvents, serverEvents, heartbeatGaps, syncStates, ...rest } = r ?? {};
      return rest;
    });
    const tracedMs = reports.filter((r) => r?.mode === "synced" && r?.traced && r?.largestGap).map((r) => r.largestGap.durationMs);
    const shas = [...new Set(reports.map((r) => r?.headSha))];
    if (shas.length !== 1) { console.error(`c52 --assemble: runs measured different trees ${JSON.stringify(shas)}`); process.exit(2); }
    const out = { slice: shas[0] ? "C52b" : "C52", headSha: shas[0] ?? null, generatedFrom: runDirs, runs: slim, tracingOverhead: { untracedMs: [8973, 7366, 7030], tracedMs }, verdict: null };
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`ASSEMBLED ${reports.length} runs -> ${outFile}`);
    process.exit(0);
  }
}

const ROOT = process.env.C50_ROOT ?? "/Volumes/files/src/openclinxr-wt/xr-sync-c52";
const lib = await import(join(ROOT, "tools/openclinxr/evidence/xr-sync/harness-lib.mjs"));
const SERVER_DIST = join(ROOT, "packages/openclinxr/xr-sync-server/dist/index.js");
const FIXTURES_DIST = join(ROOT, "packages/openclinxr/scenario-fixtures/dist/index.js");
const APP_DIST = join(ROOT, "apps/ui-xr/dist");
const IWER_BUNDLE = join(ROOT, "apps/arena/ui-xr-iwsdk-spike/node_modules/iwer/build/iwer.min.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const mode = argv.includes("--mode") ? argv[argv.indexOf("--mode") + 1] : "synced";
if (mode !== "synced" && mode !== "control") { console.error(`c52: bad --mode ${mode}`); process.exit(2); }
const runId = argv.includes("--run-id") ? argv[argv.indexOf("--run-id") + 1] : null;
if (!runId) { console.error("c52: missing --run-id <id>"); process.exit(2); }
if (!argv.includes("--out") || !argv[argv.indexOf("--out") + 1]) { console.error("c52: missing --out <dir>"); process.exit(2); }
const outDir = resolve(argv[argv.indexOf("--out") + 1]);
const traceFlag = argv.includes("--trace") ? argv[argv.indexOf("--trace") + 1] : "1";
const tracedWanted = traceFlag !== "0";
mkdirSync(outDir, { recursive: true });
const TRACE_DIR = join("/Volumes/files/openclinxr-assets/store/xr-sync/c52", runId);
mkdirSync(dirname(TRACE_DIR), { recursive: true });
if (existsSync(TRACE_DIR)) { console.error(`c52: trace dir already exists (write-once): ${TRACE_DIR}`); process.exit(2); }
mkdirSync(TRACE_DIR);
const tracePath = tracedWanted ? join(TRACE_DIR, "trace.json") : null;

async function startTrace(browser, page, traceFilePath) {
  if (!traceFilePath) return null;
  await browser.startTracing(page, { path: traceFilePath, categories: ["devtools.timeline", "v8", "disabled-by-default-devtools.timeline", "disabled-by-default-v8.cpu_profiler", "gpu", "blink.user_timing", "toplevel"] });
  return traceFilePath;
}

async function stopTrace(browser, traceFilePath) {
  await browser.stopTracing();
  const st = statSync(traceFilePath);
  const hash = createHash("sha256");
  await new Promise((res, rej) => {
    const rs = createReadStream(traceFilePath);
    rs.on("data", (c) => hash.update(c));
    rs.on("end", res);
    rs.on("error", rej);
  });
  return { path: traceFilePath, sha256: hash.digest("hex"), bytes: st.size };
}

const { execFileSync } = await import("node:child_process");
const headSha = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const run = { script: "c52-run", headSha, runId, mode, traced: tracedWanted, gpu: true, root: ROOT, pageErrors: [], consoleErrors: [] };
run.loadAvg = {};
const TIMING = { doorwaySeconds: 2, encounterSeconds: 12, noteSeconds: 4, breakAfterStationOrders: [] };
const slot = (n) => ({ slotId: `slot-${n}`, order: n, label: `C50 station ${n}`, requiredEnvironmentIds: [], requiredTraceTags: [] });
const blueprint = { blueprintId: "bp-evidence-c50", title: "C50 rotation", stationSlots: [slot(1), slot(2), slot(3)], timing: TIMING, requiredTraceTags: [], requiredSafetyCriticalTraceTags: [] };
function iwerGlue() {
  const device = new IWER.XRDevice(IWER.metaQuest3);
  device.installRuntime({ forceInstall: true });
}
let server = null;
let staticServer = null;
try {
  if (mode === "synced") {
    const { createEncounterServer } = await import(SERVER_DIST);
    const { edChestPainScenario, scenarioDialogueSeedBank } = await import(FIXTURES_DIST);
    const scenario = { ...edChestPainScenario, status: "approved" };
    server = await createEncounterServer({ examBlueprint: blueprint, scenarios: [scenario, scenario, scenario], dialogueSeeds: scenarioDialogueSeedBank });
  }
  staticServer = await lib.startStaticServer(APP_DIST);
  const pageUrl = mode === "synced" ? `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({ encounterSync: server.url })}` : `http://127.0.0.1:${staticServer.port}/`;
  run.pageUrl = pageUrl;
  const initScript = { content: `${readFileSync(IWER_BUNDLE, "utf8")};(${iwerGlue.toString()})();` };
  const snap = () => { const s = JSON.parse(server.getStateJSON()); return { stationId: s.stationId, stationIndex: s.stationIndex, stationCount: s.stationCount, phase: s.phase }; };
  const { chromium } = await import("playwright");
  run.loadAvg.start = os.loadavg()[0];
  const browser = await chromium.launch({ headless: true, channel: "chromium", args: ["--disable-features=WebXR", "--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] }); run.gpu = true;
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
    await context.addInitScript(initScript);
    const page = await context.newPage();
    page.on("pageerror", (e) => run.pageErrors.push(String(e).slice(0, 300)));
    page.on("console", (m) => { if (m.type() === "error") run.consoleErrors.push(m.text().slice(0, 300)); });
    await startTrace(browser, page, tracePath);
    await page.goto(pageUrl, { timeout: 60000, waitUntil: "load" });
    if (mode === "synced") {
      await page.waitForFunction(() => { const e = globalThis.__openClinXrEncounterSync; return e !== undefined && e.state !== "joining"; }, undefined, { timeout: 240000 });
      await page.locator("#room-panel").waitFor({ timeout: 60000 });
    } else {
      await page.locator("#exam-flow-station").waitFor({ timeout: 60000 });
    }
    await page.evaluate(() => { const el = document.getElementById("exam-flow-station"); globalThis.__c51 = [{ at: Date.now(), text: el.textContent }]; globalThis.__c51hb = []; let hbLast = Date.now(); setInterval(() => { const now = Date.now(); if (now - hbLast > 250) globalThis.__c51hb.push({ at: now, gapMs: now - hbLast }); hbLast = now; }, 50); const sync = globalThis.__openClinXrEncounterSync; globalThis.__c51sync = []; setInterval(() => { const e = globalThis.__openClinXrEncounterSync; const k = e ? e.state + "|" + e.sessionId : "none"; const last = globalThis.__c51sync[globalThis.__c51sync.length - 1]; if (!last || last.k !== k) globalThis.__c51sync.push({ at: Date.now(), k }); }, 50); new MutationObserver(() => globalThis.__c51.push({ at: Date.now(), text: el.textContent })).observe(el, { childList: true, characterData: true, subtree: true }); });
    await page.evaluate(() => {
      globalThis.__c52plant = new Map();
      const read = () => {
        const scene = globalThis.__openClinXrDebugScene; if (!scene) return;
        const label = document.getElementById("exam-flow-station")?.textContent ?? "";
        scene.traverse((o) => {
          const steps = o.userData?.openClinXrPlantSteps; if (!Array.isArray(steps) || steps.length === 0 || globalThis.__c52plant.has(o.uuid)) return;
          const phases = Array.isArray(o.userData.openClinXrPlantPhases) ? o.userData.openClinXrPlantPhases : [];
          const total = o.userData.openClinXrPlantTotalMs;
          globalThis.__c52plant.set(o.uuid, { name: o.name, at: Date.now(), label, steps: steps.map((s) => ({ step: s.step, ms: s.ms ?? null })), phases: phases.map((s) => ({ phase: s.phase, ms: s.ms ?? null })), totalMs: typeof total === "number" ? total : null });
        });
      };
      read(); setInterval(read, 100);
    });
    run.t0 = Date.now();
    run.clock = await page.evaluate(() => { performance.mark("c52-sync"); return { timeOrigin: performance.timeOrigin, nowMs: performance.now(), dateNow: Date.now() }; });
    const serverEvents = []; let lastIdx;
    if (mode === "synced") {
      const deadline = Date.now() + 240000;
      while (Date.now() < deadline) { const s = snap(); if (s.stationIndex !== lastIdx) { serverEvents.push({ at: Date.now(), ...s }); lastIdx = s.stationIndex; } if (s.stationIndex === 2) break; await sleep(10); }
      await sleep(15000);
    } else {
      await sleep(30000);
    }
    run.renderer = await page.evaluate(() => { const g = document.createElement("canvas").getContext("webgl"); const d = g && g.getExtension("WEBGL_debug_renderer_info"); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : null; }); console.log(`RENDERER ${run.renderer}`); const labelEvents = await page.evaluate(() => globalThis.__c51); run.heartbeatGaps = await page.evaluate(() => globalThis.__c51hb); run.syncStates = await page.evaluate(() => globalThis.__c51sync);
    run.serverEvents = serverEvents; run.labelEvents = labelEvents;
    { const actors = await page.evaluate(() => [...globalThis.__c52plant.values()]);
      const sumOf = (a) => [...a.steps.map((x) => x.ms), ...a.phases.map((x) => x.ms)].reduce((t, v) => (typeof v === "number" ? t + v : t), 0);
      const st1 = actors.filter((a) => /Station 1 of/.test(a.label));
      const havems = st1.length > 0 && st1.every((a) => a.steps.length > 0 && a.steps.every((x) => typeof x.ms === "number"));
      run.plantMs = { actors, station1Actors: st1.length, station1SumMs: havems ? Math.round(st1.reduce((t, a) => t + sumOf(a), 0) * 1000) / 1000 : null, source: "userData.openClinXrPlantSteps[].ms + openClinXrPlantPhases[].ms" }; }
    run.loadAvg.end = os.loadavg()[0];
    if (tracedWanted) {
      run.trace = await stopTrace(browser, tracePath);
    } else {
      run.trace = null;
    }
    run.driverT0 = mode === "synced" ? serverEvents[0].at : run.t0;
    run.lags = mode === "synced" ? serverEvents.map((e) => { const want = `Station ${e.stationIndex + 1} of ${e.stationCount}`; const hit = labelEvents.find((l) => l.text === want && l.at >= e.at - 5000); return { stationIndex: e.stationIndex, want, lagMs: hit ? hit.at - e.at : null }; }) : [];
    console.log(`LAGS ${JSON.stringify(run.lags)}`); console.log(`HB ${JSON.stringify(run.heartbeatGaps.map((g) => [g.at - run.driverT0, g.gapMs]))}`); console.log(`SYNC ${JSON.stringify(run.syncStates.map((x) => [x.at - run.driverT0, x.k]))}`);
    run.gaps = run.heartbeatGaps.map((g) => ({ startMs: g.at - g.gapMs - run.driverT0, endMs: g.at - run.driverT0, durationMs: g.gapMs }));
    run.largestGap = null;
    if (run.traced && run.trace && run.gaps.length > 0) {
      const rawTrace = JSON.parse(readFileSync(tracePath, "utf8"));
      const events = rawTrace.traceEvents ?? rawTrace;
      let bi = 0;
      for (let i = 1; i < run.gaps.length; i++) if (run.gaps[i].durationMs > run.gaps[bi].durationMs) bi = i;
      const gapObj = run.heartbeatGaps[bi];
      const win = sliceGapWindow(events, run.clock, gapObj);
      const top = topSelfTime(events, win.mainPid, win.mainTid, win, 10);
      const cpu = cpuProfileTop(events, win.mainPid, win.mainTid, win, 10);
      run.largestGap = {
        startMs: run.gaps[bi].startMs, endMs: run.gaps[bi].endMs, durationMs: run.gaps[bi].durationMs,
        topTasks: top.map((t) => ({ ...t, ...classify(t) })),
        cpuProfileTop: cpu.self.map((t) => ({ ...t, ...classify(t) })),
        cpuProfileInclusive: cpu.inclusive.map((t) => ({ ...t, ...classify(t) })),
        mainThread: { pid: win.mainPid, tid: win.mainTid },
      };
    }
    run.plantProfile = null;
    if (run.traced && run.trace) {
      // Same cpuProfileTop path as the gap attribution, over each station window instead of the largest gap.
      const rawTrace2 = JSON.parse(readFileSync(tracePath, "utf8"));
      const events2 = rawTrace2.traceEvents ?? rawTrace2;
      const endAt = Date.now();
      const stationAt = [];
      for (const n of [1, 2, 3]) { const hit = labelEvents.find((l) => new RegExp(`^Station ${n} of`).test(l.text)); stationAt.push(hit ? hit.at : null); }
      const bounds = [run.clock.dateNow - 600000, ...stationAt.slice(1).filter((x) => x !== null), endAt];
      const inclusiveOf = (win) => {
        const cpu = cpuProfileTop(events2, win.mainPid, win.mainTid, win, 1e9);
        return Math.round(cpu.inclusive.filter((t) => t.functionName === "applyAndPlantSupineDeck").reduce((t, v) => t + v.inclusiveMs, 0) * 1000) / 1000;
      };
      const stationInclusiveMs = [];
      for (let k = 0; k + 1 < bounds.length; k++) stationInclusiveMs.push(inclusiveOf(sliceGapWindow(events2, run.clock, { at: bounds[k + 1], gapMs: bounds[k + 1] - bounds[k] })));
      const whole = cpuProfileTop(events2, sliceGapWindow(events2, run.clock, { at: endAt, gapMs: 1 }).mainPid, 0, null, 1e9);
      const wholeRunInclusiveMs = Math.round(whole.inclusive.filter((t) => t.functionName === "applyAndPlantSupineDeck").reduce((t, v) => t + v.inclusiveMs, 0) * 1000) / 1000;
      run.plantProfile = { functionName: "applyAndPlantSupineDeck", stationInclusiveMs, maxStationInclusiveMs: Math.max(...stationInclusiveMs), wholeRunInclusiveMs };
    }
    run.voidRun = !/ANGLE Metal/.test(String(run.renderer ?? ""));
    const { script, pageUrl: _pu, loadAvg, clock, trace, driverT0, gaps, largestGap, lags, pageErrors, consoleErrors, fatal, t0, renderer, gpu, traced, voidRun, headSha: _hs, plantMs, plantProfile } = run;
    const report = { headSha, plantMs, plantProfile, runId, mode, traced, renderer, gpu: true, loadAvg, clock, trace, driverT0, gaps, largestGap, voidRun, lags, pageErrors, consoleErrors, fatal, t0 };
    writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await browser.close();
  }
} catch (error) {
  process.exitCode = 1;
  run.fatal = String(error?.stack ?? error).slice(0, 1600);
  console.log(`FATAL ${run.fatal.slice(0, 400)}`);
} finally {
  await server?.close().catch(() => undefined);
  await staticServer?.close().catch(() => undefined);
  try {
    if (!existsSync(join(outDir, "report.json"))) {
      const { script, pageUrl: _pu2, ...rest } = run;
      writeFileSync(join(outDir, "report.json"), `${JSON.stringify({ runId, mode, traced: tracedWanted, gpu: true, ...rest, gaps: run.gaps ?? [], largestGap: run.largestGap ?? null, voidRun: run.voidRun ?? true, lags: run.lags ?? [] }, null, 2)}\n`);
    }
  } catch {}
}
process.exit(process.exitCode ?? 0);
