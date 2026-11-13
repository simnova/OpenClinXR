#!/usr/bin/env node
/** Measure cold and warm learner scene-to-interior-latch load time for XS-READY S0. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GPU_ARGS, VIEWPORT } from "../site/capture/capture-instrument.mjs";
import { startStaticServer, summarize } from "./harness-lib.mjs";
import { sceneHumanoidAssetsReady } from "./rr1-run.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const APP_DIST = join(ROOT, "apps", "ui-xr", "dist");
const SERVER_DIST = join(ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "index.js");
const DEV_STACK_DIST = join(ROOT, "packages", "openclinxr", "xr-sync-server", "dist", "dev-stack.js");
const FIXTURES_DIST = join(ROOT, "packages", "openclinxr", "scenario-fixtures", "dist", "index.js");
const RR1_RUN = join(HERE, "rr1-run.mjs");
const COLD_LOADS = 5;
const WARM_LOADS = 5;
const LOAD_TIMEOUT_MS = 180_000;

function parseArgs(argv) {
  const options = { out: null, blueprints: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out" && options.out === null && argv[i + 1]) {
      options.out = resolve(argv[i + 1]);
      i += 1;
    } else if (arg === "--blueprint" && argv[i + 1]) {
      options.blueprints.push(argv[i + 1]);
      i += 1;
    } else {
      throw new Error(`unknown or incomplete argument: ${arg}\n${usage()}`);
    }
  }
  if (options.out === null || options.blueprints.length === 0) {
    throw new Error(usage());
  }
  if (new Set(options.blueprints).size !== options.blueprints.length) {
    throw new Error(`duplicate --blueprint id\n${usage()}`);
  }
  return options;
}

function usage() {
  return "usage: node xs-ready-scene-load.mjs --blueprint rr1 [--blueprint <shipped-scenario-id> ...] --out <dir>";
}

function sourceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    throw new Error(`rr1 ${label} source markers changed`);
  }
  return source.slice(start, end);
}

/**
 * Reuse RR1's page init verbatim without editing the protected runner. The
 * readiness predicate is imported above; these source markers deliberately
 * fail closed if RR1 renames or reshapes its init instead of silently drifting.
 */
function rr1LearnerPageCaptureInitSource() {
  const source = readFileSync(RR1_RUN, "utf8");
  return sourceBetween(
    source,
    "function learnerPageCaptureInit(config) {",
    "\n\nfunction facultyStatusObserverInit(config) {",
    "learnerPageCaptureInit",
  );
}

function rr1InitScript() {
  const config = {
    presentationCss: "",
    dialogue: false,
    phaseAgreement: false,
    visibleDomText: false,
    sceneReady: true,
  };
  return `const sceneHumanoidAssetsReady=${sceneHumanoidAssetsReady.toString()};(${rr1LearnerPageCaptureInitSource()})(${JSON.stringify(config)});`;
}

/** Build the exact current RR1 server options from RR1's own source block. */
export function createRr1ServerConfig(fixtures) {
  const source = readFileSync(RR1_RUN, "utf8");
  const slotSource = sourceBetween(source, "function slot(order) {", "\n\nasync function blockout", "slot factory");
  const blueprintSource = sourceBetween(
    source,
    "  const timing = { doorwaySeconds: 4, encounterSeconds: 10, noteSeconds: 2, breakAfterStationOrders: [] };",
    "\n  const fixtures = await import(FIXTURES_DIST);",
    "blueprint",
  );
  const scenarioSource = sourceBetween(
    source,
    "  const scenario = { ...fixtures.edChestPainScenario, status: \"approved\" };",
    "\n  const patient = scenario.actors.find",
    "scenario",
  );
  // The evidence tool evaluates trusted, checked-in RR1 source so its three-slot
  // blueprint cannot silently drift from the runner while remaining unexported.
  const build = Function(
    "fixtures",
    `"use strict"; ${slotSource}; ${blueprintSource}; ${scenarioSource}; return { examBlueprint: blueprint, scenarios: [scenario, scenario, scenario], dialogueSeeds: fixtures.scenarioDialogueSeedBank, scenarioId: scenario.scenarioId, castSize: scenario.actors.length };`,
  );
  return build(fixtures);
}

async function resolveBlueprintConfig(id, fixtures) {
  if (id === "rr1") {
    return createRr1ServerConfig(fixtures);
  }
  const { resolveDevStack } = await import(DEV_STACK_DIST);
  const stack = resolveDevStack({ XR_SYNC_SCENARIO: id }, fixtures);
  return {
    examBlueprint: stack.examBlueprint,
    scenarios: stack.scenarios,
    dialogueSeeds: stack.dialogueSeeds,
    scenarioId: stack.scenarioId,
    castSize: stack.actorCount,
  };
}

export { resolveBlueprintConfig, rr1InitScript };

function assertRuntimeBundleCast(config) {
  const path = join(APP_DIST, "xr-assets", "generated", config.scenarioId, "learner-runtime-bundle.v1.json");
  if (!existsSync(path)) {
    throw new Error(`learner runtime bundle missing for ${config.scenarioId}: ${path}`);
  }
  const bundle = JSON.parse(readFileSync(path, "utf8"));
  const bundleCastSize = Array.isArray(bundle.actors) ? bundle.actors.length : -1;
  if (bundle.scenarioId !== config.scenarioId || bundleCastSize !== config.castSize) {
    throw new Error(`learner runtime bundle cast mismatch for ${config.scenarioId}: server=${config.castSize} bundle=${bundleCastSize}`);
  }
}

async function waitForSceneLoad(page) {
  await page.waitForFunction(
    () => typeof globalThis.__openClinXrSceneReadyWallMs === "number"
      && typeof globalThis.__openClinXrInteriorLatchWallMs === "number",
    undefined,
    { timeout: LOAD_TIMEOUT_MS },
  );
  return page.evaluate(() => ({
    navStartWallMs: performance.timeOrigin,
    sceneReadyWallMs: globalThis.__openClinXrSceneReadyWallMs,
    latchWallMs: globalThis.__openClinXrInteriorLatchWallMs,
  }));
}

async function navigateAndMeasure(page, learnerUrl, cache, i, blueprint, castSize) {
  if (cache === "warm") {
    await page.reload({ timeout: 60_000, waitUntil: "load" });
  } else {
    await page.goto(learnerUrl, { timeout: 60_000, waitUntil: "load" });
  }
  const stamps = await waitForSceneLoad(page);
  return {
    i,
    cache,
    blueprint,
    castSize,
    ...stamps,
    loadMs: stamps.latchWallMs - stamps.navStartWallMs,
  };
}

async function main() {
  const { out, blueprints } = parseArgs(process.argv.slice(2));
  if (existsSync(out)) {
    throw new Error(`write-once output directory already exists: ${out}`);
  }
  for (const required of [join(APP_DIST, "index.html"), SERVER_DIST, DEV_STACK_DIST, FIXTURES_DIST, RR1_RUN]) {
    if (!existsSync(required)) throw new Error(`required build/input missing: ${required}`);
  }

  let staticServer;
  let browser;
  const loads = [];

  try {
    const { createEncounterServer } = await import(SERVER_DIST);
    const fixtures = await import(FIXTURES_DIST);
    const { chromium } = await import("playwright");
    staticServer = await startStaticServer(APP_DIST);
    browser = await chromium.launch({ headless: true, channel: "chromium", args: GPU_ARGS });
    const initScript = rr1InitScript();

    for (const blueprint of blueprints) {
      const config = await resolveBlueprintConfig(blueprint, fixtures);
      assertRuntimeBundleCast(config);
      const encounterServer = await createEncounterServer({
        examBlueprint: config.examBlueprint,
        scenarios: config.scenarios,
        dialogueSeeds: config.dialogueSeeds,
      });
      try {
        const learnerUrl = `http://127.0.0.1:${staticServer.port}/?${new URLSearchParams({
          encounterSync: encounterServer.url,
          ...(blueprint === "rr1" ? {} : { scenarioId: config.scenarioId }),
        })}`;
        for (let i = 0; i < COLD_LOADS; i += 1) {
          const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
          try {
            await context.addInitScript({ content: initScript });
            const page = await context.newPage();
            loads.push(await navigateAndMeasure(page, learnerUrl, "cold", loads.length, blueprint, config.castSize));
          } finally {
            await context.close();
          }
        }

        const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
        try {
          await context.addInitScript({ content: initScript });
          const page = await context.newPage();
          await page.goto(learnerUrl, { timeout: 60_000, waitUntil: "load" });
          await waitForSceneLoad(page); // Prime this context; only the following reloads are warm samples.
          for (let i = 0; i < WARM_LOADS; i += 1) {
            loads.push(await navigateAndMeasure(page, learnerUrl, "warm", loads.length, blueprint, config.castSize));
          }
        } finally {
          await context.close();
        }
      } finally {
        await encounterServer.close().catch(() => undefined);
      }
    }
  } finally {
    await browser?.close().catch(() => undefined);
    await staticServer?.close().catch(() => undefined);
  }

  const stats = summarize(loads.map((load) => load.loadMs));
  const perBlueprint = Object.fromEntries(blueprints.map((blueprint) => [
    blueprint,
    Object.fromEntries(["cold", "warm"].map((cache) => {
      const group = summarize(loads.filter((load) => load.blueprint === blueprint && load.cache === cache).map((load) => load.loadMs));
      return [cache, { n: group.n, maxLoadMs: group.max, p50LoadMs: group.p50 }];
    })),
  ]));
  const report = {
    headSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    loads,
    perBlueprint,
    maxLoadMs: stats.max,
    p50LoadMs: stats.p50,
    readyTimeoutSeconds: Math.ceil((2 * stats.max) / 1000),
  };
  if (existsSync(out)) {
    throw new Error(`write-once output directory appeared during capture: ${out}`);
  }
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(out);
  writeFileSync(join(out, "scene-load.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`wrote ${loads.length} XS-READY scene loads to ${join(out, "scene-load.json")}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
