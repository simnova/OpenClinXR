#!/usr/bin/env node
/**
 * C52c: does the supine plant compute the same pose in node and in the GPU browser?
 * Usage: node c52c-plant-parity.mjs [--out <json>] [--probe-offset] [--node-only]
 *   --node-only      plant in node only, check against the RED A fixture, write no json (no browser).
 *   --probe-offset   destructive probe: offset one bone by 2e-4 m in the page before the read.
 * Mechanism (worker's choice per the card): a harness page bundled by vite from the same workspace
 * packages (xr-pose, xr-station, three GLTFLoader), loading the shipped GLB bytes from
 * apps/ui-xr/public/generated-humanoids. It is not the ui-xr product bundle: no product route plants
 * an arbitrary (body, incline), and the card's write root excludes product source.
 * Runs headless Chromium on the GPU path (--use-angle=metal) and records the UNMASKED_RENDERER_WEBGL.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { comparePoses, caseKey, plantLoadedHumanoid, readPose } from "./c52c-plant-core.mjs";
import { deriveShippedCases, inputTreeHash, redACases, unionCases } from "./c52c-cases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const outFile = resolve(argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : join(HERE, "c52c-plant-parity.json"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOLERANCE_M = 1e-4;

const red = redACases(ROOT);
const shipped = await deriveShippedCases(ROOT);
const cases = unionCases(red, shipped);
console.log(`CASES ${cases.length} (red-a ${red.length}, shipped supine actors ${shipped.length})`);

// ---- page bundle (built first so --bundle-only needs no node plants and no browser) ----
const { build } = await import("vite");
const work = mkdtempSync(join(os.tmpdir(), "c52c-page-"));
const pageDir = join(work, "page");
mkdirSync(pageDir);
const wrapper = join(work, "wrapper.mjs");
writeFileSync(wrapper, [
  `import { applyAndPlantSupineOnDeck } from ${JSON.stringify(join(ROOT, "packages/openclinxr/xr-pose/dist/index.js"))};`,
  `import { buildPatientStretcher } from ${JSON.stringify(join(ROOT, "packages/openclinxr/xr-station/dist/index.js"))};`,
  `import { install } from ${JSON.stringify(join(HERE, "c52c-page-entry.mjs"))};`,
  "install({ applyAndPlantSupineOnDeck, buildPatientStretcher });",
].join("\n"));
await build({
  root: work, configFile: false, logLevel: "warn",
  resolve: { dedupe: ["three"] },
  build: {
    outDir: pageDir, emptyOutDir: true, minify: false, target: "es2022",
    lib: { entry: wrapper, formats: ["es"], fileName: () => "page.js" },
  },
});
writeFileSync(join(pageDir, "index.html"), '<!doctype html><meta charset="utf-8"><title>c52c</title><script type="module" src="/page.js"></script>');
symlinkSync(join(ROOT, "apps/ui-xr/public/generated-humanoids"), join(pageDir, "generated-humanoids"));
if (flag("--bundle-only")) { console.log(`BUNDLE ${join(pageDir, "page.js")} ${readFileSync(join(pageDir, "page.js")).length} bytes`); process.exit(0); }

// ---- node side ----
const { Group, Vector3 } = await import("three");
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
const { applyAndPlantSupineOnDeck } = await import("@openclinxr/xr-pose");
const { buildPatientStretcher } = await import("@openclinxr/xr-station");
const deps = { Group, buildPatientStretcher, applyAndPlantSupineOnDeck };

async function loadBodyInNode(body) {
  const bytes = readFileSync(join(ROOT, "apps/ui-xr/public/generated-humanoids", body));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binLength = bytes.readUInt32LE(20 + jsonLength);
  json.buffers[0].uri = `data:application/octet-stream;base64,${bytes.subarray(28 + jsonLength, 28 + jsonLength + binLength).toString("base64")}`;
  for (const material of json.materials) {
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
  }
  json.images = []; json.textures = [];
  if (!globalThis.ProgressEvent) globalThis.ProgressEvent = class extends Event {};
  return (await new GLTFLoader().parseAsync(JSON.stringify(json), "")).scene;
}

const nodeRecords = new Map();
for (const c of cases) {
  const root = await loadBodyInNode(c.body);
  plantLoadedHumanoid(root, c, deps);
  nodeRecords.set(caseKey(c), readPose(root, Vector3));
  console.log(`NODE ${caseKey(c)} bones=${Object.keys(nodeRecords.get(caseKey(c)).bones).length}`);
}

if (flag("--node-only")) {
  const fixture = JSON.parse(readFileSync(join(ROOT, "packages/openclinxr/xr-pose/src/__fixtures__/supine-plant-pose-before.json"), "utf8"));
  for (const row of fixture.cases) {
    if (row.condition === "bedless") continue;
    const rec = nodeRecords.get(caseKey({ body: row.asset, deck: "patient_stretcher", inclineDeg: row.inclineDeg }));
    const d = comparePoses({ root: row.root, bones: row.bones }, rec);
    console.log(`FIXTURE ${row.asset} ${row.condition} bone ${d.maxAbsBoneDeltaM.toExponential(2)} (${d.worstBone}) rootPos ${d.rootPosDeltaM.toExponential(2)} rootQuat ${d.rootQuatDelta.toExponential(2)}`);
  }
  process.exit(0);
}

// ---- page side ----
const headSha = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const inputTree = inputTreeHash(ROOT, cases.map((c) => c.body));
const lib = await import("./harness-lib.mjs");
const staticServer = await lib.startStaticServer(pageDir);
const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true, channel: "chromium", args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
let report;
try {
  const page = await (await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(`http://127.0.0.1:${staticServer.port}/`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => typeof globalThis.__c52c === "object", undefined, { timeout: 30000 });
  const env = await page.evaluate(() => globalThis.__c52c.environment());
  const cdp = await browser.newBrowserCDPSession();
  const info = await cdp.send("SystemInfo.getProcessInfo");
  const browserPid = info.processInfo.find((p) => p.type === "browser")?.id ?? null;
  await page.evaluate((specs) => globalThis.__c52c.start(specs), cases);
  // Wait until the registered humanoid count is stable (3 reads 500 ms apart, all cases finished) before reading.
  const polls = [];
  const deadline = Date.now() + 25 * 60 * 1000;
  for (;;) {
    const s = await page.evaluate(() => ({ count: globalThis.__c52c.count(), finished: globalThis.__c52c.state.finished, errors: globalThis.__c52c.state.errors }));
    polls.push(s.count);
    const last = polls.slice(-3);
    if (s.errors.length > 0) throw new Error(`page plant errors: ${JSON.stringify(s.errors)}`);
    if (s.finished === cases.length && s.count === cases.length && last.length === 3 && last.every((n) => n === s.count)) break;
    if (Date.now() > deadline) throw new Error(`humanoid count never stabilised: ${JSON.stringify(polls.slice(-10))}`);
    await sleep(500);
  }
  console.log(`STABLE count=${polls.at(-1)} polls=${polls.length}`);
  let probe = null;
  if (flag("--probe-offset")) {
    const key = caseKey(cases[0]);
    const boneName = Object.keys(nodeRecords.get(key).bones)[10];
    const before = (await page.evaluate(() => globalThis.__c52c.readAll())).find((r) => r.key === key).pose.bones[boneName];
    await page.evaluate(([k, b, dx]) => globalThis.__c52c.offsetBone(k, b, dx), [key, boneName, 2e-4]);
    const after = (await page.evaluate(() => globalThis.__c52c.readAll())).find((r) => r.key === key).pose.bones[boneName];
    probe = { key, boneName, offsetM: 2e-4, worldBefore: before, worldAfter: after };
    console.log(`PROBE ${key} bone ${boneName} world before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
  }
  const pageRecords = await page.evaluate(() => globalThis.__c52c.readAll());
  const rows = cases.map((c) => {
    const k = caseKey(c);
    const p = pageRecords.find((r) => r.key === k);
    if (!p) throw new Error(`page has no record for ${k}`);
    const n = nodeRecords.get(k);
    const d = comparePoses(n, p.pose);
    return { body: c.body, deck: c.deck, inclineDeg: c.inclineDeg, source: c.source, ...d, node: n, page: p.pose };
  });
  report = {
    slice: "C52c", headSha, inputTreeSha256: inputTree, nodeVersion: process.version, userAgent: env.userAgent, renderer: env.renderer,
    nodePid: process.pid, browserPid, toleranceM: TOLERANCE_M, probe, pageErrors: errors, humanoidCountPolls: polls.length,
    shippedCases: shipped, cases: rows,
  };
} finally {
  await browser.close();
  await staticServer.close();
}
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
let worst = 0;
for (const r of report.cases) {
  const m = Math.max(r.maxAbsBoneDeltaM, r.rootPosDeltaM, r.rootQuatDelta);
  worst = Math.max(worst, m);
  console.log(`CASE ${r.body} ${r.inclineDeg}deg bone ${r.maxAbsBoneDeltaM.toExponential(2)} (${r.worstBone}) rootPos ${r.rootPosDeltaM.toExponential(2)} rootQuat ${r.rootQuatDelta.toExponential(2)}`);
}
console.log(`WROTE ${outFile} worst ${worst.toExponential(2)} ${worst > TOLERANCE_M ? "STOP over 1e-4" : "within 1e-4"} renderer=${report.renderer}`);
process.exit(0);
